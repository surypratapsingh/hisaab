import { Paise, paise, sum, subtract, format, isNegative } from '@/money/money';
import { daysBetween, shortDate, monthYear } from '@/lib/date';
import { priceRuns, NOT_A_PRICE } from './priceSteps';

export type InsightKind =
  | 'category_drift'
  | 'unusual_amount'
  | 'subscription_creep'
  | 'duplicate_charge'
  | 'price_move'
  | 'bill_due'
  | 'savings_rate';

export type Insight = {
  kind: InsightKind;
  /** One sentence, stated plainly. Never a recommendation. */
  sentence: string;
  /** Ids of the entries this is drawn from, so the user can check the claim. */
  evidence: string[];
};

export type InsightEntry = {
  id: string;
  date: string;
  merchant: string;
  categoryId: string;
  /** Signed: money out is negative. */
  amount: Paise;
  /**
   * Typed in by hand, or brought over from a hand-kept tracker: nobody billed this, so
   * paying the same shop twice in a day is a habit, not a duplicate charge.
   */
  logged?: boolean;
  /**
   * False when the name is only the bank's channel ("Mob Bk", "Money sent"): it covers
   * anyone and anything, so two of them on the same day are not a repeat charge and their
   * amounts say nothing about a price. Anything else, including a payee's truncated name,
   * counts as a name.
   */
  named?: boolean;
};

export type InsightInput = {
  today: string;
  entries: InsightEntry[];
  /** A longer stretch of entries, for prices, which need a year to show a pattern. */
  priceEntries?: InsightEntry[];
  /** Months of history available. Insights stay silent below three. */
  monthsOfHistory: number;
  income?: Paise;
  upcomingBill?: { label: string; amount: Paise; dueDate: string };
  projectedBalance?: Paise;
  /** Readable names for category ids, so a sentence never shows "cat_food". */
  categoryNames?: Record<string, string>;
  /**
   * Payees detected as subscriptions. Imports file Netflix under
   * Entertainment, not Subscriptions, so the category alone misses them.
   */
  subscriptionMerchants?: string[];
};

const MIN_MONTHS = 3;

const monthKey = (date: string): string => date.slice(0, 7);

const outgoing = (entries: InsightEntry[]): InsightEntry[] =>
  entries.filter((e) => isNegative(e.amount));

const magnitude = (amount: Paise): Paise => paise(Math.abs(amount));

const totalOut = (entries: InsightEntry[]): Paise =>
  sum(entries.map((e) => magnitude(e.amount)));

/** Spend per category shifted noticeably against the previous month. */
const categoryDrift = (input: InsightInput): Insight[] => {
  const months = [...new Set(input.entries.map((e) => monthKey(e.date)))].sort();
  if (months.length < 2) return [];

  const [previous, current] = months.slice(-2);
  const insights: Insight[] = [];

  const categories = new Set(outgoing(input.entries).map((e) => e.categoryId));

  for (const categoryId of categories) {
    const inMonth = (month: string) =>
      outgoing(input.entries).filter(
        (e) => e.categoryId === categoryId && monthKey(e.date) === month
      );

    const before = totalOut(inMonth(previous));
    const after = inMonth(current);
    const now = totalOut(after);

    if (before === paise(0) || now === paise(0)) continue;

    const ratio = now / before;
    if (ratio < 1.5) continue;

    insights.push({
      kind: 'category_drift',
      sentence: `You spent ${ratio.toFixed(1)}x your usual on ${input.categoryNames?.[categoryId] ?? categoryId} this month, ${format(now)} against ${format(before)}.`,
      evidence: after.map((e) => e.id),
    });
  }

  return insights;
};

/** A charge far above what this merchant normally takes. */
const unusualAmount = (input: InsightInput): Insight[] => {
  const byMerchant = new Map<string, InsightEntry[]>();
  for (const entry of outgoing(input.entries)) {
    const list = byMerchant.get(entry.merchant) ?? [];
    list.push(entry);
    byMerchant.set(entry.merchant, list);
  }

  const insights: Insight[] = [];

  for (const [merchant, entries] of byMerchant) {
    if (entries.length < 4 || entries[0].named === false) continue;

    const sorted = [...entries].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const latest = sorted[sorted.length - 1];
    const history = sorted.slice(0, -1);

    const average = paise(Math.round(totalOut(history) / history.length));
    if (average === paise(0)) continue;

    const latestAmount = magnitude(latest.amount);
    if (latestAmount < average * 2) continue;

    insights.push({
      kind: 'unusual_amount',
      sentence: `${merchant} charged ${format(latestAmount)}, about ${(latestAmount / average).toFixed(1)}x its usual ${format(average)}.`,
      evidence: [latest.id],
    });
  }

  return insights;
};

/** Recurring charges taking a larger share of spending than the month before. */
const subscriptionCreep = (input: InsightInput): Insight[] => {
  const months = [...new Set(input.entries.map((e) => monthKey(e.date)))].sort();
  if (months.length < 2) return [];

  const [previous, current] = months.slice(-2);
  const detected = input.subscriptionMerchants
    ? new Set(input.subscriptionMerchants)
    : null;
  const subs = outgoing(input.entries).filter((e) =>
    detected ? detected.has(e.merchant) : e.categoryId === 'cat_subscriptions'
  );

  const before = totalOut(subs.filter((e) => monthKey(e.date) === previous));
  const after = subs.filter((e) => monthKey(e.date) === current);
  const now = totalOut(after);

  if (before === paise(0) || now <= before) return [];

  return [
    {
      kind: 'subscription_creep',
      sentence: `Subscriptions cost ${format(subtract(now, before))} more than last month, now ${format(now)}.`,
      evidence: after.map((e) => e.id),
    },
  ];
};

/** The same merchant charging the same amount twice within three days. Bank charges only. */
const duplicateCharge = (input: InsightInput): Insight[] => {
  const entries = outgoing(input.entries).filter((e) => !e.logged && e.named !== false);

  // Only the same merchant and amount can pair, so pairs are looked for within those groups:
  // comparing every pair of half a year's entries cost more than all the other insights.
  const groups = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const key = JSON.stringify([e.merchant, magnitude(e.amount)]);
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  });

  const pairs: Array<[number, number]> = [];
  const reported = new Set<string>();
  for (const group of groups.values()) {
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        const a = entries[group[x]];
        const b = entries[group[y]];

        if (Math.abs(daysBetween(new Date(a.date), new Date(b.date))) > 3) continue;
        if (reported.has(a.id) || reported.has(b.id)) continue;

        reported.add(a.id);
        reported.add(b.id);
        pairs.push([group[x], group[y]]);
      }
    }
  }

  // In the order a scan of every pair would have found them.
  return pairs
    .sort((p, q) => p[0] - q[0] || p[1] - q[1])
    .map(([i, j]): Insight => ({
      kind: 'duplicate_charge',
      sentence: `${entries[i].merchant} charged ${format(magnitude(entries[i].amount))} twice within three days.`,
      evidence: [entries[i].id, entries[j].id],
    }));
};

/**
 * Something bought again and again that now costs a different amount than it did: chicken
 * 170, now 180. Only when the amounts behave like a price (`priceRuns`), the new price has
 * held for a few purchases, and the change is recent enough to be news.
 */
const priceMoves = (input: InsightInput): Insight[] => {
  const byName = new Map<string, InsightEntry[]>();
  for (const entry of outgoing(input.priceEntries ?? input.entries)) {
    if (entry.named === false || NOT_A_PRICE.has(entry.categoryId)) continue;
    const key = entry.merchant.trim().toLowerCase();
    const list = byName.get(key);
    if (list) list.push(entry);
    else byName.set(key, [entry]);
  }

  const insights: Insight[] = [];
  for (const list of byName.values()) {
    const runs = priceRuns(
      list.map((e) => ({ id: e.id, date: e.date, amount: magnitude(e.amount) }))
    );
    if (!runs) continue;

    const first = runs[0];
    const current = runs[runs.length - 1];
    const before = runs[runs.length - 2];
    const today = new Date(input.today);
    if (daysBetween(new Date(current.to), today) > 45) continue;
    if (daysBetween(new Date(current.from), today) > 90) continue;

    const name = list[list.length - 1].merchant;
    const percent = Math.round((Math.abs(current.amount - before.amount) / before.amount) * 100);
    const direction = current.amount > before.amount ? 'up' : 'down';
    const history =
      runs.length > 2 ? ` It was ${format(first.amount)} in ${monthYear(first.from)}.` : '';

    insights.push({
      kind: 'price_move',
      sentence: `${name} now costs ${format(current.amount)}, ${direction} ${percent}% on ${format(before.amount)}, since ${shortDate(current.from)}.${history}`,
      evidence: [...before.ids.slice(-2), ...current.ids.slice(0, 3)],
    });
  }
  return insights;
};

/** A bill landing, and what the balance looks like once it clears. */
const billDue = (input: InsightInput): Insight[] => {
  if (!input.upcomingBill || input.projectedBalance === undefined) return [];

  const { label, amount, dueDate } = input.upcomingBill;
  const after = subtract(input.projectedBalance, amount);

  return [
    {
      kind: 'bill_due',
      sentence: `${label} takes ${format(amount)} on ${shortDate(dueDate)}, leaving ${format(after)}.`,
      evidence: [],
    },
  ];
};

/**
 * How much of what came in stayed in. `income` is one month's, so only that
 * month's spending is set against it — the latest month in the entries.
 */
const savingsRate = (input: InsightInput): Insight[] => {
  if (!input.income || input.income === paise(0)) return [];

  const months = [...new Set(input.entries.map((e) => monthKey(e.date)))].sort();
  const latest = months[months.length - 1];
  const thisMonth = outgoing(input.entries).filter((e) => monthKey(e.date) === latest);

  const spent = totalOut(thisMonth);
  const kept = subtract(input.income, spent);

  if (isNegative(kept)) {
    return [
      {
        kind: 'savings_rate',
        sentence: `You spent ${format(subtract(paise(0), kept))} more than came in this month, ${format(spent)} against ${format(input.income)}.`,
        evidence: thisMonth.map((e) => e.id),
      },
    ];
  }

  const rate = (kept / input.income) * 100;

  return [
    {
      kind: 'savings_rate',
      sentence: `You kept ${rate.toFixed(0)}% of what came in this month, ${format(kept)} of ${format(input.income)}.`,
      evidence: [],
    },
  ];
};

/**
 * Deterministic observations over the ledger. Each one states what happened
 * and carries the entries behind it, so every claim can be checked.
 *
 * These describe spending only. They never name, rank or suggest a security,
 * fund or product: that is regulated investment advice in India and needs a
 * SEBI registration this app does not hold.
 */
export const generateInsights = (input: InsightInput): Insight[] => {
  if (input.monthsOfHistory < MIN_MONTHS) return [];

  return [
    ...categoryDrift(input),
    ...unusualAmount(input),
    ...subscriptionCreep(input),
    ...duplicateCharge(input),
    ...priceMoves(input),
    ...billDue(input),
    ...savingsRate(input),
  ];
};
