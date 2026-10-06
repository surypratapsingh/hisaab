import { Database, type Category, type JournalEntry } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Paise, paise, sum, subtract } from '@/money/money';
import { Result, ok, err } from '@/lib/result';
import { monthRange, dateWithYear, isoDate, previousMonth } from '@/lib/date';
import { normalise } from '@/intel/normalise';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';
import { investmentAccount } from '@/repo/manual';
import { spendByDay, spentBefore, monthKeyOf } from '@/repo/reports';
import { spendingScore, type SpendingScore } from '@/analysis/spendingScore';

const INVESTMENT_CATEGORY = 'cat_investment' as Id;
import type { MonthSummary, TopCategory, RecentEntry } from '@/ui/screens/HomeScreen';
import type { TimelineEntry } from '@/ui/screens/TimelineScreen';
import type { AccountItem } from '@/ui/screens/AccountsScreen';
import type { ReviewCard } from '@/ui/screens/ReviewQueueScreen';

export const monthBounds = monthRange;

/**
 * One month's money in and out. With `throughDay`, only up to and including that day of the
 * month (clamped to the month's length): this month so far set against last month's same days,
 * not against all of it, which would read as a big fall on the 3rd.
 */
export const monthSummary = (db: Database, month: Date, throughDay?: number): MonthSummary => {
  const bounds = monthBounds(month);
  const from = bounds.from;
  const to =
    throughDay === undefined
      ? bounds.to
      : `${bounds.to.slice(0, 8)}${String(Math.min(throughDay, Number(bounds.to.slice(8, 10)))).padStart(2, '0')}${bounds.to.slice(10)}`;
  const totals = db.monthTotals(from, to).getOrNull();

  if (!totals) {
    return { spent: paise(0), received: paise(0), net: paise(0) };
  }

  return {
    spent: totals.spent,
    received: totals.received,
    net: subtract(totals.received, totals.spent),
  };
};

const categoryNames = (db: Database): Map<Id, string> => {
  const categories = db.getCategories().getOrNull() ?? [];
  return new Map(categories.map((c: Category) => [c.id, c.name]));
};

export const topCategories = (
  db: Database,
  month: Date,
  limit = 5
): TopCategory[] => {
  const { from, to } = monthBounds(month);
  const totals = db.categoryTotals(from, to).getOrNull() ?? [];
  const names = categoryNames(db);

  const overall = sum(totals.map((t) => t.total));
  if (overall === paise(0)) return [];

  return totals.slice(0, limit).map((row) => ({
    name: row.categoryId ? (names.get(row.categoryId) ?? 'Unknown') : 'Unknown',
    amount: row.total,
    percentage: Math.round((row.total / overall) * 100),
  }));
};

const merchantNames = (db: Database): Map<Id, string> => {
  const merchants = db.getAllMerchants().getOrNull() ?? [];
  return new Map(merchants.map((m) => [m.id, m.canonical]));
};

/** What to show as the payee: the resolved merchant, or the raw narration. */
const displayName = (entry: JournalEntry, merchants: Map<Id, string>): string =>
  (entry.merchantId ? merchants.get(entry.merchantId) : undefined) ??
  entry.description;

/** The user's own accounts, read once by a list that signs many entries. */
const ownAccountIds = (db: Database): Set<Id> =>
  new Set((db.getAllAccounts().getOrNull() ?? []).filter((a) => !a.isSystem).map((a) => a.id));

/** What each entry did to the user's own accounts, read in one query rather than one per entry. */
const signedAmounts = (db: Database, entries: JournalEntry[], own: Set<Id>): Map<Id, Paise> => {
  const rows = entries.length
    ? (db
        .query<{ entry_id: string; account_id: string; amount: number }>(
          `SELECT entry_id, account_id, amount FROM postings WHERE entry_id IN (${entries.map(() => '?').join(', ')})`,
          entries.map((e) => e.id)
        )
        .getOrNull() ?? [])
    : [];
  const legs = new Map<string, Paise[]>();
  for (const row of rows) {
    if (!own.has(row.account_id as Id)) continue;
    const list = legs.get(row.entry_id);
    if (list) list.push(paise(row.amount));
    else legs.set(row.entry_id, [paise(row.amount)]);
  }

  return new Map(
    entries.map((entry) => {
      const mine = legs.get(entry.id) ?? [];
      const net = sum(mine);
      // Money moved between two of the user's own accounts — into investments,
      // say — nets to zero, which would read as nothing happening. Show the leg
      // that left instead.
      return [entry.id, net === paise(0) && mine.length > 1 ? (mine.find((a) => a < 0) ?? net) : net];
    })
  );
};

/** "Today", or "2 Oct 2026": the stored date is already the user's calendar day. */
export const dayLabel = (occurredAt: string, today = new Date()): string =>
  occurredAt.slice(0, 10) === isoDate(today) ? 'Today' : dateWithYear(occurredAt);

export const recentEntries = (db: Database, limit = 15): RecentEntry[] => {
  const entries = db.getEntries({ limit }).getOrNull() ?? [];
  const merchants = merchantNames(db);
  const categories = categoryNames(db);
  const amounts = signedAmounts(db, entries, ownAccountIds(db));

  return entries.map((entry) => ({
    id: entry.id,
    merchant: displayName(entry, merchants),
    category: entry.categoryId
      ? (categories.get(entry.categoryId) ?? 'Unknown')
      : 'Unknown',
    amount: amounts.get(entry.id)!,
    date: dayLabel(entry.occurredAt),
  }));
};

export const timeline = (db: Database, limit = 200): TimelineEntry[] => {
  const entries = db.getEntries({ limit }).getOrNull() ?? [];
  const merchants = merchantNames(db);
  const categories = categoryNames(db);
  const amounts = signedAmounts(db, entries, ownAccountIds(db));

  const byDay = new Map<string, TimelineEntry>();

  for (const entry of entries) {
    const key = entry.occurredAt.slice(0, 10);
    const amount = amounts.get(entry.id)!;

    const day = byDay.get(key) ?? {
      date: dayLabel(entry.occurredAt),
      dayTotal: paise(0),
      entries: [],
    };

    day.dayTotal = sum([day.dayTotal, amount]);
    day.entries.push({
      id: entry.id,
      merchant: displayName(entry, merchants),
      category: entry.categoryId
        ? (categories.get(entry.categoryId) ?? 'Unknown')
        : 'Unknown',
      amount,
      kind: entry.kind,
    });

    byDay.set(key, day);
  }

  return [...byDay.values()];
};

export const accountsWithBalances = (db: Database): AccountItem[] => {
  const accounts = db.getAllAccounts().getOrNull() ?? [];

  return accounts
    .filter((account) => !account.isSystem)
    .map((account) => ({
      id: account.id,
      name: account.name,
      // The bank's figure, not just the movements imported so far.
      balance: db.reportedBalance(account.id).getOrNull() ?? paise(0),
      institution: account.institution,
      last4: account.last4,
      // Without a statement, a typed balance or an "Avl Bal" alert, the figure
      // is only the movements seen so far, not what the account holds.
      balanceKnown: db.getBalanceAnchor(account.id).getOrNull() != null,
      takesStatements:
        account.kind === 'asset' && account.subkind !== 'investment' && account.subkind !== 'cash',
      excluded: account.excluded,
    }));
};

export const reviewCards = (db: Database, limit = 50): ReviewCard[] => {
  const entries = db.getReviewQueue(0.7, limit).getOrNull() ?? [];
  const categories = db.getCategories().getOrNull() ?? [];
  const names = categories.map((c) => c.name);
  const amounts = signedAmounts(db, entries, ownAccountIds(db));

  return entries.map((entry) => {
    const guess = entry.categoryId
      ? (categories.find((c) => c.id === entry.categoryId)?.name ?? 'Unknown')
      : 'Unknown';

    return {
      id: entry.id,
      narration: entry.description,
      amount: amounts.get(entry.id)!,
      bestGuess: guess,
      alternatives: names.filter((name) => name !== guess).slice(0, 3),
    };
  });
};

export type EntryDetail = {
  id: Id;
  date: string;
  merchant: string;
  merchantId?: Id;
  category: string;
  categoryId?: Id;
  amount: Paise;
  account: string;
  narration: string;
  notes?: string;
  matchCount: number;
  /** Only a hand-typed entry can be deleted — a bank record is never removed. */
  canDelete: boolean;
};

export const entryDetail = (db: Database, id: Id): EntryDetail | null => {
  const entry = db.getEntry(id).getOrNull();
  if (!entry) return null;

  const raw = entry.rawId ? db.getRawRecord(entry.rawId).getOrNull() : null;
  const merchants = merchantNames(db);
  const categories = categoryNames(db);
  const postings = db.getPostings(id).getOrNull() ?? [];
  const accounts = db.getAllAccounts().getOrNull() ?? [];
  const own = accounts.filter((a) => !a.isSystem);
  const ownIds = new Set(own.map((a) => a.id));

  const onOwn = postings.find((p) => ownIds.has(p.accountId));

  return {
    id: entry.id,
    date: entry.occurredAt,
    merchant: displayName(entry, merchants),
    merchantId: entry.merchantId,
    category: entry.categoryId
      ? (categories.get(entry.categoryId) ?? 'Unknown')
      : 'Unknown',
    categoryId: entry.categoryId,
    amount: onOwn?.amount ?? paise(0),
    account: own.find((a) => a.id === onOwn?.accountId)?.name ?? 'Unknown',
    narration: entry.description,
    notes: entry.notes,
    matchCount: entry.merchantId
      ? (db.countEntriesForMerchant(entry.merchantId).getOrNull() ?? 1)
      : 1,
    canDelete: raw?.source === 'manual',
  };
};

/**
 * Everything owned less everything owed, using each account's real balance.
 * The ledger's own sum only counts movements since the first import, which
 * leaves out whatever was already in the account.
 */
export const netWorthOf = (
  db: Database
): { assets: Paise; liabilities: Paise; net: Paise } => {
  // An asset account whose balance was never stated (no statement, typed figure or "Avl Bal"
  // alert) has only the movements seen so far, which is not what it holds. It stays out, as
  // it does on Accounts and Home, instead of counting a few debits as a negative balance.
  const accounts = (db.getAllAccounts().getOrNull() ?? []).filter(
    (a) =>
      !a.isSystem &&
      !a.excluded &&
      (a.kind === 'liability' || (a.kind === 'asset' && db.getBalanceAnchor(a.id).getOrNull() != null))
  );

  const balanceOf = (id: Id) => db.reportedBalance(id).getOrNull() ?? paise(0);

  const assets = sum(accounts.filter((a) => a.kind === 'asset').map((a) => balanceOf(a.id)));
  const liabilities = sum(
    accounts.filter((a) => a.kind === 'liability').map((a) => balanceOf(a.id))
  );

  return { assets, liabilities, net: sum([assets, liabilities]) };
};

export type LedgerSnapshot = {
  summary: MonthSummary;
  lastMonth: MonthSummary;
  /** What went out on each day of the month, the 1st first — for the Home calendar. */
  spendByDay: Paise[];
  /** This month's days against the daily average from before it; null with too little history. */
  spendingScore: SpendingScore | null;
  topCategories: TopCategory[];
  recent: RecentEntry[];
  timeline: TimelineEntry[];
  accounts: AccountItem[];
  reviewCards: ReviewCard[];
  netWorth: { assets: Paise; liabilities: Paise; net: Paise };
  suspenseRatio: number;
};

/** Everything the screens render, read in one pass after any change. */
export const snapshot = (db: Database, month = new Date()): LedgerSnapshot => {
  const days = spendByDay(db, monthKeyOf(month));
  return {
    summary: monthSummary(db, month),
    // The same days of last month, so the comparison is like for like all month long.
    lastMonth: monthSummary(db, previousMonth(month), month.getDate()),
    spendByDay: days,
    spendingScore: spendingScore(days, month.getDate(), spentBefore(db, monthKeyOf(month))),
    topCategories: topCategories(db, month),
    recent: recentEntries(db),
    timeline: timeline(db),
    accounts: accountsWithBalances(db),
    reviewCards: reviewCards(db),
    netWorth: netWorthOf(db),
    suspenseRatio: db.suspenseRatio('acc_suspense' as Id).getOrNull() ?? 0,
  };
};

export type CorrectionError = { code: string; message: string };

/**
 * A correction, applied and remembered.
 *
 * Beyond fixing the one entry, this teaches the merchant a category and writes
 * the narration back as a pattern, so the same payee is recognised next time.
 * That feedback loop is the product: every correction makes the next import
 * quieter.
 */
export const recategorise = (
  db: Database,
  input: {
    entryId: Id;
    categoryId: Id;
    /** Backfills every past entry from the same merchant. */
    applyToAll?: boolean;
  }
): Result<{ updated: number }, CorrectionError> => {
  const found = db.getEntry(input.entryId);
  if (found.isErr()) return err(found.error);
  if (!found.value) {
    return err({ code: 'NOT_FOUND', message: `No entry ${input.entryId}` });
  }

  const entry = found.value;

  let merchantId = entry.merchantId;
  if (!merchantId) {
    // Nothing claimed this narration, so the normalised text becomes the
    // merchant's first pattern.
    const created = db.upsertMerchant(entry.description, input.categoryId);
    if (created.isErr()) return err(created.error);
    merchantId = created.value.id;

    const recorded = db.recordPattern({
      merchantId,
      pattern: normalise(entry.description),
      kind: 'substring',
      source: 'user',
    });
    if (recorded.isErr()) return err(recorded.error);

    // Every entry with this narration is the same payee, so they all get the
    // new merchant — otherwise a backfill would miss the ones the user did
    // not happen to open.
    const linked = db.linkEntriesByDescription(entry.description, merchantId);
    if (linked.isErr()) return err(linked.error);
  }

  const owner = merchantId;
  return db.transaction(() => {
    if (input.applyToAll) {
      const applied = db.applyCategoryToMerchant(owner, input.categoryId);
      if (applied.isErr()) return err(applied.error);

      // LIMIT -1 is SQLite for "no limit": every entry the backfill touched.
      const entries = db.getEntries({ merchantId: owner, limit: -1 }).getOrNull() ?? [];
      for (const each of entries) {
        const settled = settleEntry(db, each.id, input.categoryId);
        if (settled.isErr()) return err(settled.error);
      }
      return ok({ updated: applied.value });
    }

    const updated = db.updateEntry(entry.id, {
      categoryId: input.categoryId,
      confidence: 1,
      reviewedAt: new Date().toISOString(),
    });
    if (updated.isErr()) return err(updated.error);

    const settled = settleEntry(db, entry.id, input.categoryId);
    if (settled.isErr()) return err(settled.error);

    return ok({ updated: 1 });
  }, 'CORRECTION_FAILED');
};

/** Where the other side of an entry sits while nobody has explained it. */
const PLACEHOLDER_ACCOUNTS = new Set<Id>([
  SYSTEM_ACCOUNT_IDS.SUSPENSE,
  SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE,
  SYSTEM_ACCOUNT_IDS.UNKNOWN_INCOME,
]);

/**
 * Once the user has said what an entry is, its other side belongs somewhere
 * definite: out of Suspense, and into the Investments account if they filed
 * a debit under Investment (or back out, if they changed their mind).
 * Transfers and entries with more than two legs are left as they are.
 */
export const settleEntry = (
  db: Database,
  entryId: Id,
  categoryId: Id
): Result<void, CorrectionError> => {
  const entry = db.getEntry(entryId).getOrNull();
  if (!entry || entry.kind === 'transfer') return ok(undefined);

  const legs = db.getPostings(entryId).getOrNull() ?? [];
  if (legs.length !== 2) return ok(undefined);

  const isInvestmentAccount = (id: Id) =>
    db.getAccount(id).getOrNull()?.subkind === 'investment';
  const counter =
    legs.find((l) => PLACEHOLDER_ACCOUNTS.has(l.accountId)) ??
    legs.find((l) => isInvestmentAccount(l.accountId));
  const own = legs.find((l) => l !== counter);
  if (!counter || !own) return ok(undefined);

  const outgoing = own.amount < 0;
  const invested = outgoing && categoryId === INVESTMENT_CATEGORY;

  let target: Id;
  if (invested) {
    const account = investmentAccount(db);
    if (account.isErr()) return err(account.error);
    target = account.value.id;
  } else {
    target = outgoing ? SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE : SYSTEM_ACCOUNT_IDS.UNKNOWN_INCOME;
  }

  if (counter.accountId !== target) {
    const moved = db.moveLeg(counter.id, target);
    if (moved.isErr()) return err(moved.error);
  }

  const kind = invested ? 'investment' : outgoing ? 'expense' : 'income';
  if (entry.kind !== kind) {
    const updated = db.updateEntry(entryId, { kind });
    if (updated.isErr()) return err(updated.error);
  }
  return ok(undefined);
};

/** The three numbers to report every Friday. */
export const weeklyHealth = (
  db: Database
): { suspenseRatio: number; unmatchedNarrations: number; reviewQueue: number } => ({
  suspenseRatio: db.suspenseRatio('acc_suspense' as Id).getOrNull() ?? 0,
  unmatchedNarrations: (db.unmatchedNarrations(500).getOrNull() ?? []).length,
  reviewQueue: (db.getReviewQueue(0.7, 1000).getOrNull() ?? []).length,
});
