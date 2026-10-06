import { paise, type Paise } from '@/money/money';

/**
 * How this month's days compare with the user's own daily average from before
 * the month: how many came in under it, how many in a row up to today, and the
 * longest run so far. It counts days; it does not judge them or say what to do.
 */
export type SpendingScore = {
  /** What went out a day, on average, over the days before this month. */
  average: Paise;
  /** How many days that average is taken over (up to 90). */
  basisDays: number;
  /** Days of this month so far, today included. */
  days: number;
  /** Of those, the days that spent less than the average (a day with nothing spent is one). */
  under: number;
  /** Days in a row up to today that came in under. Today counts as it stands so far. */
  streak: number;
  /** The longest run of such days this month. */
  best: number;
};

/** Fewer days of history than this and an average says too little to compare with. */
export const MIN_BASIS_DAYS = 14;

/**
 * `month` is what went out on each day of this month (the 1st first), `dayNow` today's date
 * in it, and `before` the spending over the days before the month began. Null when there is
 * too little history, or nothing was spent in it, to make an average worth comparing with.
 */
export const spendingScore = (
  month: Paise[],
  dayNow: number,
  before: { total: Paise; days: number }
): SpendingScore | null => {
  if (before.days < MIN_BASIS_DAYS || before.total <= 0) return null;
  const average = paise(Math.round(before.total / before.days));

  const soFar = month.slice(0, Math.max(0, Math.min(dayNow, month.length)));
  const isUnder = soFar.map((spent) => spent < average);

  let run = 0;
  let best = 0;
  for (const under of isUnder) {
    run = under ? run + 1 : 0;
    best = Math.max(best, run);
  }

  return {
    average,
    basisDays: before.days,
    days: soFar.length,
    under: isUnder.filter(Boolean).length,
    streak: run,
    best,
  };
};
