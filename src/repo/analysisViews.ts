import { Database, type EntryKind } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { isoDate, daysBetween, monthRange, localDate, shiftDate } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise, sum } from '@/money/money';
import { normalise } from '@/intel/normalise';
import {
  safeToSpend,
  dailyDiscretionaryFrom,
  type SafeToSpend,
  type Commitment,
} from '@/analysis/safeToSpend';
import {
  detectSubscriptions,
  summariseAll,
  totalAnnualised,
  monthlyEquivalent,
  overlapping,
  renewalOnOrAfter,
  type ChargeGroup,
  type SubscriptionSummary,
} from '@/analysis/subscriptions';
import { generateInsights, type Insight, type InsightEntry } from '@/analysis/insights';
import { detectPayday, nextPayday } from '@/analysis/payday';
import { balanceUnknown } from '@/wealth/repo';

export const SETTING_PAYDAY = 'payday_day';
export const SETTING_CASH_FLOOR = 'cash_floor_paise';

/** One entry, with the amount that moved on the user's own spending accounts. */
export type LedgerLine = {
  id: Id;
  date: string;
  kind: EntryKind;
  /** The merchant when one was recognised, otherwise the bank's narration. */
  name: string;
  merchantId?: Id;
  categoryId?: Id;
  amount: Paise;
  /** Typed in by hand or imported from a hand-kept tracker, rather than read from a bank. */
  logged: boolean;
};

type LineRow = {
  id: string;
  occurred_at: string;
  description: string;
  kind: string;
  category_id: string | null;
  merchant_id: string | null;
  merchant: string | null;
  amount: number;
  logged: number;
};

/**
 * Entries on or after `from`. Investments accounts are left out of the sum, so
 * an investment reads as money leaving the bank rather than netting to nothing.
 */
const scanLines = (db: Database, from: string): LedgerLine[] => {
  const rows = db.query<LineRow>(
    `SELECT e.id, e.occurred_at, e.description, e.kind, e.category_id, e.merchant_id,
            m.canonical AS merchant, SUM(p.amount) AS amount, (r.source = 'manual') AS logged
     FROM journal_entries e
     LEFT JOIN raw_records r ON r.id = e.raw_id
     JOIN postings p ON p.entry_id = e.id
     JOIN accounts a ON a.id = p.account_id
       AND a.is_system = 0 AND a.excluded = 0 AND a.kind = 'asset'
       AND (a.subkind IS NULL OR a.subkind <> 'investment')
     LEFT JOIN merchants m ON m.id = e.merchant_id
     WHERE substr(e.occurred_at, 1, 10) >= ?
     GROUP BY e.id
     ORDER BY e.occurred_at, e.created_at`,
    [from]
  );

  return (rows.getOrNull() ?? []).map((row) => ({
    id: row.id as Id,
    date: row.occurred_at.slice(0, 10),
    kind: row.kind as EntryKind,
    name: row.merchant ?? row.description,
    merchantId: (row.merchant_id ?? undefined) as Id | undefined,
    categoryId: (row.category_id ?? undefined) as Id | undefined,
    amount: paise(row.amount),
    logged: row.logged === 1,
  }));
};

/** The scan a read pass is sharing: the longest window asked for so far. `undefined` means no pass is open. */
let shared: { db: Database; from: string; lines: LedgerLine[] } | null | undefined;

/**
 * Every view after a change asks for the same entries over different windows (400 days for
 * subscriptions, prices and bills, 190 for insights, 90 for usual spending). Inside this
 * call they are all cut from one scan instead of each running the join again. Nothing may
 * write while it runs, so the lines cannot go stale.
 */
export const sharedLedgerScan = <T>(read: () => T): T => {
  if (shared !== undefined) return read();
  shared = null;
  try {
    return read();
  } finally {
    shared = undefined;
  }
};

/** Read-only: inside a pass every view is handed the same lines. */
export const ledgerLines = (db: Database, from: string): ReadonlyArray<Readonly<LedgerLine>> => {
  if (shared === undefined) return scanLines(db, from);
  // Same rows, same order: a later window is the earlier one with its first days dropped.
  if (shared && shared.db === db && shared.from <= from) return shared.lines.filter((l) => l.date >= from);
  const lines = scanLines(db, from);
  shared = { db, from, lines };
  return lines;
};

/**
 * The day the data runs up to. Statements arrive after the fact, so "this
 * month" and "not charged lately" are judged against the latest data, not the
 * calendar — otherwise a month-old import makes every subscription look dead.
 */
export const dataDate = (db: Database, today: Date): string => {
  const rows = db.query<{ latest: string | null }>(
    `SELECT MAX(substr(occurred_at, 1, 10)) AS latest FROM journal_entries`
  );
  const latest = rows.getOrNull()?.[0]?.latest;
  const now = isoDate(today);
  return latest && latest < now ? latest : now;
};

const liquidAccounts = (db: Database) =>
  (db.getAllAccounts().getOrNull() ?? []).filter(
    (a) => !a.isSystem && !a.excluded && a.kind === 'asset' && a.subkind !== 'investment' && !balanceUnknown(db, a)
  );

/**
 * Groups charges by payee. Unrecognised narrations usually carry a reference
 * number that differs every time, so digits are dropped before comparing.
 */
const groupCharges = (lines: LedgerLine[]): ChargeGroup[] => {
  const groups = new Map<string, ChargeGroup>();

  for (const line of lines) {
    const key = line.merchantId ?? normalise(line.name).replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    const group = groups.get(key) ?? { name: line.name, categoryId: line.categoryId, charges: [] };
    group.charges.push({ date: line.date, amount: line.amount });
    group.categoryId = line.categoryId ?? group.categoryId;
    groups.set(key, group);
  }

  return [...groups.values()];
};

// ------------------------------------------------------------ subscriptions

export type SubscriptionsView = {
  asOf: string;
  active: SubscriptionSummary[];
  /** Nothing charged in 90 days — possibly cancelled, possibly forgotten. */
  dormant: SubscriptionSummary[];
  totalAnnual: Paise;
  /** The same total spread over twelve months, for "₹X a month". */
  totalMonthly: Paise;
  /** More than one live subscription filed under the same category. */
  sharedCategories: Array<{ category: string; merchants: string[] }>;
};

/** Regular charges of one kind over the last year and a bit of data. */
const recurring = (db: Database, asOf: string, kind: EntryKind) => {
  const lines = ledgerLines(db, shiftDate(asOf, -400)).filter(
    (l) => l.kind === kind && l.amount < 0
  );
  const subscriptions = detectSubscriptions(groupCharges(lines));
  return { subscriptions, summaries: summariseAll(subscriptions, asOf) };
};

export const subscriptionsView = (db: Database, today = new Date()): SubscriptionsView => {
  const asOf = dataDate(db, today);
  const { subscriptions, summaries } = recurring(db, asOf, 'expense');
  const names = new Map((db.getCategories().getOrNull() ?? []).map((c) => [c.id, c.name]));

  return {
    asOf,
    active: summaries.filter((s) => s.dormantSinceDays === undefined),
    dormant: summaries.filter((s) => s.dormantSinceDays !== undefined),
    totalAnnual: totalAnnualised(summaries),
    totalMonthly: monthlyEquivalent(totalAnnualised(summaries)),
    sharedCategories: overlapping(subscriptions, asOf).map((o) => ({
      category: names.get(o.categoryId as Id) ?? 'Unknown',
      merchants: o.merchants,
    })),
  };
};

// ------------------------------------------------------------ safe to spend

export type PaydaySource = 'set' | 'salary' | 'pattern';

export const paydayOf = (
  db: Database,
  today = new Date()
): { day: number; source: PaydaySource } | null => {
  const stored = Number(db.getSetting(SETTING_PAYDAY).getOrNull());
  if (Number.isInteger(stored) && stored >= 1 && stored <= 31) {
    return { day: stored, source: 'set' };
  }

  const asOf = dataDate(db, today);
  const credits = ledgerLines(db, shiftDate(asOf, -120))
    .filter((l) => l.kind === 'income' && l.amount > 0)
    .map((l) => ({ date: l.date, amount: l.amount, categoryId: l.categoryId }));

  const found = detectPayday(credits);
  return found ? { day: found.day, source: found.source } : null;
};

export const cashFloorOf = (db: Database): Paise => {
  const stored = Number(db.getSetting(SETTING_CASH_FLOOR).getOrNull());
  return Number.isInteger(stored) && stored > 0 ? paise(stored) : paise(0);
};

export type SafeToSpendView =
  | { status: 'needs_payday'; cashFloor: Paise }
  | {
      status: 'ready';
      result: SafeToSpend;
      nextIncome: string;
      payday: { day: number; source: PaydaySource };
      cashFloor: Paise;
      dailyDiscretionary: Paise;
      /** Days of spending the daily figure is averaged over. */
      basisDays: number;
      /** The oldest statement balance used, when any balance came from one. */
      balanceAsOf?: string;
      /** Bank accounts not counted because their balance is not known. */
      leftOut: string[];
    };

const FORECAST_WINDOW_DAYS = 90;

/**
 * Everything Safe-to-Spend needs, read from the ledger.
 *
 * Bills are the detected subscriptions renewing before payday; scheduled
 * investments are recurring ones. Usual spending is averaged over the latest
 * 90 days of data with those regular charges taken out, so a bill is never
 * counted once as a bill and again as everyday spend.
 */
export const safeToSpendView = (db: Database, today = new Date()): SafeToSpendView => {
  const cashFloor = cashFloorOf(db);
  const payday = paydayOf(db, today);
  if (!payday) return { status: 'needs_payday', cashFloor };

  const todayIso = isoDate(today);
  const nextIncome = nextPayday(payday.day, today);

  const accounts = liquidAccounts(db);
  const liquid = sum(accounts.map((a) => db.reportedBalance(a.id).getOrNull() ?? paise(0)));

  // Only accounts that get statements: a hand-kept wallet has none to bring up to date.
  const anchors = accounts
    .filter((a) => a.subkind !== 'cash')
    .map((a) => db.getBalanceAnchor(a.id).getOrNull()?.asOf)
    .filter((d): d is string => d !== undefined)
    .sort();

  const toCommitment = (s: SubscriptionSummary): Commitment[] => {
    const due = renewalOnOrAfter(s, todayIso);
    return due ? [{ label: s.merchantName, amount: s.latestAmount, dueDate: due }] : [];
  };
  const live = (s: SubscriptionSummary) => s.dormantSinceDays === undefined;

  const asOf = dataDate(db, today);
  const bills = recurring(db, asOf, 'expense');
  const investments = recurring(db, asOf, 'investment').summaries.filter(live).flatMap(toCommitment);

  // Usual spending, from the latest 90 days of data. Charges that belong to a
  // detected subscription are taken out by the charge itself — an unrecognised
  // payee's narration differs every month, so matching on its name would miss
  // them and count each bill twice.
  const regular = new Set(
    bills.subscriptions.flatMap((s) => s.charges.map((c) => `${c.date}|${c.amount}`))
  );
  const recent = ledgerLines(db, shiftDate(asOf, -FORECAST_WINDOW_DAYS));
  const everyday = recent
    .filter((l) => l.kind === 'expense' && l.amount < 0 && !regular.has(`${l.date}|${l.amount}`))
    .map((l) => l.amount);

  const firstDate = recent[0]?.date;
  const basisDays = firstDate
    ? Math.min(FORECAST_WINDOW_DAYS, daysBetween(localDate(firstDate), localDate(asOf)) + 1)
    : 0;
  const dailyDiscretionary = dailyDiscretionaryFrom(everyday, basisDays);

  const result = safeToSpend({
    today: todayIso,
    nextIncomeDate: nextIncome,
    liquidBalance: liquid,
    bills: bills.summaries.filter(live).flatMap(toCommitment),
    cardDues: [],
    scheduledInvestments: investments,
    cashFloor,
    dailyDiscretionary,
  });

  return {
    status: 'ready',
    result,
    nextIncome,
    payday,
    cashFloor,
    dailyDiscretionary,
    basisDays,
    balanceAsOf: anchors[0],
    leftOut: (db.getAllAccounts().getOrNull() ?? [])
      .filter((a) => !a.isSystem && !a.excluded && balanceUnknown(db, a))
      .map((a) => a.name),
  };
};

// ----------------------------------------------------------------- insights

export type EvidenceLine = { id: Id; name: string; date: string; amount: Paise };

export type InsightsView = {
  insights: Insight[];
  monthsOfHistory: number;
  /** The entries each insight cites, so every claim can be checked. */
  evidence: Record<string, EvidenceLine>;
};

const monthsBetween = (from: string, to: string): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
  1;

const PRICE_WINDOW_DAYS = 400;

/** What an entry is called when the message never said who: the bank's own channel. */
export const CHANNEL_NAME = /^(mob(ile)?\s*bk(\s+rev\s+tran)?|money\s+(sent|received)|cash\s+withdrawal|upi|imps|neft|rtgs)$/i;

export const insightsView = (
  db: Database,
  today = new Date(),
  /** Passed in when already read for the same day, so it is not worked out twice. */
  subs: SubscriptionsView = subscriptionsView(db, today)
): InsightsView => {
  const asOf = dataDate(db, today);

  const first = db
    .query<{ first: string | null }>(
      `SELECT MIN(substr(occurred_at, 1, 10)) AS first FROM journal_entries`
    )
    .getOrNull()?.[0]?.first;

  const monthsOfHistory = first ? monthsBetween(first, asOf) : 0;

  const lines = ledgerLines(db, shiftDate(asOf, -190)).filter(
    (l) => l.kind !== 'transfer' && l.kind !== 'investment'
  );

  const asEntry = (l: LedgerLine): InsightEntry => ({
    id: l.id,
    date: l.date,
    merchant: l.name,
    categoryId: l.categoryId ?? 'cat_unknown',
    amount: l.amount,
    logged: l.logged,
    named: l.logged || l.merchantId !== undefined || !CHANNEL_NAME.test(l.name.trim()),
  });
  const entries = lines.map(asEntry);

  // Prices need a longer look than the six months the other insights use.
  const longLines = ledgerLines(db, shiftDate(asOf, -PRICE_WINDOW_DAYS)).filter(
    (l) => l.kind !== 'transfer' && l.kind !== 'investment'
  );
  const priceEntries = longLines.map(asEntry);

  const categoryNames = Object.fromEntries(
    (db.getCategories().getOrNull() ?? []).map((c) => [c.id, c.name])
  );

  const month = monthRange(localDate(asOf));
  const income = db.monthTotals(month.from, month.to).getOrNull()?.received;

  const todayIso = isoDate(today);
  const soon = subs.active
    .map((s) => ({ s, due: renewalOnOrAfter(s, todayIso) }))
    .filter((x): x is { s: SubscriptionSummary; due: string } => x.due !== undefined)
    .filter((x) => daysBetween(localDate(todayIso), localDate(x.due)) <= 14)
    .sort((a, b) => (a.due < b.due ? -1 : 1))[0];

  const liquid = sum(
    liquidAccounts(db).map((a) => db.reportedBalance(a.id).getOrNull() ?? paise(0))
  );

  const insights = generateInsights({
    today: asOf,
    entries,
    priceEntries,
    monthsOfHistory,
    income,
    upcomingBill: soon
      ? { label: soon.s.merchantName, amount: soon.s.latestAmount, dueDate: soon.due }
      : undefined,
    projectedBalance: soon ? liquid : undefined,
    categoryNames,
    subscriptionMerchants: subs.active.map((s) => s.merchantName),
  });

  const byId = new Map(longLines.map((l) => [l.id, l]));
  const evidence: Record<string, EvidenceLine> = {};
  for (const insight of insights) {
    for (const id of insight.evidence) {
      const line = byId.get(id as Id);
      if (line) evidence[id] = { id: line.id, name: line.name, date: line.date, amount: line.amount };
    }
  }

  return { insights, monthsOfHistory, evidence };
};

// -------------------------------------------------------------- one refresh

/**
 * The three views a refresh shows, sharing one ledger scan. Subscriptions are read first
 * because they ask for the longest window: asked first, payday detection's 120 days would
 * be scanned on its own and then scanned again for the 400.
 */
export const readAnalysis = (db: Database, today = new Date()) =>
  sharedLedgerScan(() => {
    const subscriptions = subscriptionsView(db, today);
    return { safeToSpend: safeToSpendView(db, today), subscriptions, insights: insightsView(db, today, subscriptions) };
  });

// ----------------------------------------------------------------- settings

export type SettingsError = { code: 'INVALID_INPUT' | 'DATABASE'; message: string };

/** Sets the day of the month salary arrives, or clears it to go back to detection. */
export const setPayday = (db: Database, day: number | null): Result<void, SettingsError> => {
  if (day !== null && !(Number.isInteger(day) && day >= 1 && day <= 31)) {
    return err({ code: 'INVALID_INPUT', message: 'Choose a day between 1 and 31' });
  }
  const written = db.setSetting(SETTING_PAYDAY, day === null ? null : String(day));
  return written.isOk() ? ok(undefined) : err({ code: 'DATABASE', message: written.error.message });
};

export const setCashFloor = (db: Database, amount: Paise): Result<void, SettingsError> => {
  if (!Number.isInteger(amount) || amount < 0) {
    return err({ code: 'INVALID_INPUT', message: 'Enter an amount of zero or more' });
  }
  const written = db.setSetting(SETTING_CASH_FLOOR, amount === 0 ? null : String(amount));
  return written.isOk() ? ok(undefined) : err({ code: 'DATABASE', message: written.error.message });
};
