import { Paise, paise, sum, subtract, multiply, divide } from '@/money/money';
import { addMonths, daysBetween, isoDate, localDate, shiftDate } from '@/lib/date';

export type Charge = {
  date: string;
  amount: Paise;
};

export type Subscription = {
  merchantName: string;
  charges: Charge[];
  categoryId?: string;
};

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular';

export type SubscriptionSummary = {
  merchantName: string;
  cadence: Cadence;
  latestAmount: Paise;
  annualisedCost: Paise;
  nextExpected?: string;
  /** Set when the most recent charge is higher than the one before it. */
  priceIncrease?: { from: Paise; to: Paise };
  /** Set when nothing has been charged for 90 days or more. */
  dormantSinceDays?: number;
};

const CADENCE_DAYS: Record<Exclude<Cadence, 'irregular'>, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

/** Charges in a year: a month is a calendar month, not 30 days. */
const PER_YEAR: Record<Exclude<Cadence, 'irregular'>, number> = {
  weekly: 365 / 7,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** The charge after one on `iso`, on the same day of the month (or the month's last day). */
const nextCharge = (iso: string, cadence: Exclude<Cadence, 'irregular'>): string =>
  cadence === 'weekly' ? shiftDate(iso, 7) : isoDate(addMonths(localDate(iso), 12 / PER_YEAR[cadence]));

const cadenceFor = (days: number): Cadence => {
  if (Math.abs(days - 7) <= 2) return 'weekly';
  if (Math.abs(days - 30) <= 4) return 'monthly';
  if (Math.abs(days - 91) <= 7) return 'quarterly';
  if (Math.abs(days - 365) <= 14) return 'yearly';
  return 'irregular';
};

/** Oldest first. Each date is read once, not once per comparison. */
const sortedByDate = (charges: Charge[]): Charge[] =>
  charges
    .map((charge) => ({ charge, time: new Date(charge.date).getTime() }))
    .sort((a, b) => a.time - b.time)
    .map(({ charge }) => charge);

const averageInterval = (charges: Charge[]): number => {
  if (charges.length < 2) return 0;

  const gaps: number[] = [];
  for (let i = 1; i < charges.length; i++) {
    gaps.push(
      Math.abs(daysBetween(new Date(charges[i - 1].date), new Date(charges[i].date)))
    );
  }

  return Math.round(sum(gaps.map((g) => paise(g))) / gaps.length);
};

const DORMANT_AFTER_DAYS = 90;

const TOLERANCE_DAYS: Record<Exclude<Cadence, 'irregular'>, number> = {
  weekly: 2,
  monthly: 4,
  quarterly: 7,
  yearly: 14,
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
};

const gapsBetween = (charges: Charge[]): number[] => {
  const ordered = sortedByDate(charges);
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    gaps.push(
      Math.abs(daysBetween(new Date(ordered[i - 1].date), new Date(ordered[i].date)))
    );
  }
  return gaps;
};

/**
 * Whether a run of charges is a subscription rather than a habit.
 *
 * Grocery orders can average one a week without being weekly, so it takes
 * both: most gaps close to one cadence, and most amounts within 5% of the
 * typical one. "Most" rather than "all" lets a single price rise through.
 */
export const isRecurring = (charges: Charge[], minCharges = 3): boolean => {
  if (charges.length < minCharges) return false;

  const gaps = gapsBetween(charges);
  const cadence = cadenceFor(median(gaps));
  if (cadence === 'irregular') return false;

  const regular = gaps.filter(
    (gap) => Math.abs(gap - CADENCE_DAYS[cadence]) <= TOLERANCE_DAYS[cadence]
  ).length;
  if (regular * 3 < gaps.length * 2) return false;

  const amounts = charges.map((c) => Math.abs(c.amount));
  const typical = median(amounts);
  const similar = amounts.filter((a) => Math.abs(a - typical) * 20 <= typical).length;

  return similar >= minCharges && similar * 3 >= amounts.length * 2;
};

export type ChargeGroup = {
  name: string;
  categoryId?: string;
  charges: Charge[];
};

/** Keeps the groups of charges that behave like subscriptions. */
export const detectSubscriptions = (
  groups: ChargeGroup[],
  minCharges = 3
): Subscription[] =>
  groups
    .filter((group) => isRecurring(group.charges, minCharges))
    .map((group) => ({
      merchantName: group.name,
      categoryId: group.categoryId,
      charges: group.charges,
    }));

export const summarise = (
  subscription: Subscription,
  today: string
): SubscriptionSummary => {
  const charges = sortedByDate(subscription.charges);
  const latest = charges[charges.length - 1];
  const previous = charges[charges.length - 2];

  const interval = averageInterval(charges);
  const cadence = cadenceFor(interval);

  const latestAmount = paise(Math.abs(latest.amount));
  const annualisedCost =
    cadence === 'irregular'
      ? latestAmount
      : multiply(latestAmount, PER_YEAR[cadence]);

  const sinceLast = daysBetween(new Date(latest.date), new Date(today));

  const summary: SubscriptionSummary = {
    merchantName: subscription.merchantName,
    cadence,
    latestAmount,
    annualisedCost,
  };

  if (cadence !== 'irregular') {
    summary.nextExpected = nextCharge(latest.date, cadence);
  }

  if (previous) {
    const before = paise(Math.abs(previous.amount));
    if (latestAmount > before) {
      summary.priceIncrease = { from: before, to: latestAmount };
    }
  }

  if (sinceLast >= DORMANT_AFTER_DAYS) {
    summary.dormantSinceDays = sinceLast;
  }

  return summary;
};

export const summariseAll = (
  subscriptions: Subscription[],
  today: string
): SubscriptionSummary[] =>
  subscriptions
    .filter((s) => s.charges.length > 0)
    .map((s) => summarise(s, today))
    .sort((a, b) => b.annualisedCost - a.annualisedCost);

/** A yearly cost spread over twelve months, to the nearest paisa. */
export const monthlyEquivalent = (annual: Paise): Paise => divide(annual, 12);

/** What every active subscription costs over a year, taken together. */
export const totalAnnualised = (summaries: SubscriptionSummary[]): Paise =>
  sum(
    summaries
      .filter((s) => s.dormantSinceDays === undefined)
      .map((s) => s.annualisedCost)
  );

/**
 * Subscriptions that overlap: more than one live service in the same category.
 * Worth surfacing because paying twice for the same thing is invisible when
 * each charge looks reasonable on its own.
 */
export const overlapping = (
  subscriptions: Subscription[],
  today: string
): Array<{ categoryId: string; merchants: string[] }> => {
  const live = subscriptions.filter(
    (s) => s.categoryId && summarise(s, today).dormantSinceDays === undefined
  );

  const byCategory = new Map<string, string[]>();
  for (const s of live) {
    const list = byCategory.get(s.categoryId!) ?? [];
    list.push(s.merchantName);
    byCategory.set(s.categoryId!, list);
  }

  return [...byCategory.entries()]
    .filter(([, merchants]) => merchants.length > 1)
    .map(([categoryId, merchants]) => ({ categoryId, merchants }));
};

/** Renewals landing inside the next `days`, soonest first. */
export const renewalsWithin = (
  summaries: SubscriptionSummary[],
  today: string,
  days: number
): SubscriptionSummary[] =>
  summaries
    .filter((s) => {
      if (!s.nextExpected || s.dormantSinceDays !== undefined) return false;
      const out = daysBetween(new Date(today), new Date(s.nextExpected));
      return out >= 0 && out <= days;
    })
    .sort(
      (a, b) =>
        new Date(a.nextExpected!).getTime() - new Date(b.nextExpected!).getTime()
    );

/**
 * The first expected renewal on or after `date`, stepping forward by the
 * cadence when the last projection has already passed.
 */
export const renewalOnOrAfter = (
  summary: SubscriptionSummary,
  date: string
): string | undefined => {
  if (!summary.nextExpected || summary.cadence === 'irregular') return undefined;

  let next = summary.nextExpected;
  while (next < date) {
    next = nextCharge(next, summary.cadence);
  }
  return next;
};

export const increaseAmount = (summary: SubscriptionSummary): Paise =>
  summary.priceIncrease
    ? subtract(summary.priceIncrease.to, summary.priceIncrease.from)
    : paise(0);
