import type { MomentType } from './moments';

/**
 * When a number crosses a line worth noticing. Only upward crossings count,
 * only the highest line crossed by one change, and only once.
 */

const GOAL_LINES: Array<{ percent: number; type: MomentType }> = [
  { percent: 100, type: 'GOAL_COMPLETE' },
  { percent: 75, type: 'GOAL_75' },
  { percent: 50, type: 'GOAL_50' },
  { percent: 25, type: 'GOAL_25' },
];

/** Whole percent of a goal reached, never above 100. */
export const goalPercent = (saved: number, target: number): number =>
  target <= 0 ? 0 : Math.min(100, Math.floor((saved * 100) / target));

/**
 * The milestone a contribution reached, if any: 25, 50, 75 or the goal itself.
 * Going from 10% to 60% is a 50% moment, not 25% and 50%. Going down, or
 * staying within a band, is nothing.
 */
export const goalMilestone = (before: number, after: number, target: number): MomentType | undefined => {
  const from = goalPercent(before, target);
  const to = goalPercent(after, target);
  return GOAL_LINES.find((line) => from < line.percent && to >= line.percent)?.type;
};

/** Net-worth lines in paise: ₹1L, 2.5L, 5L, 10L, 25L, 50L, 1Cr, 2.5Cr, 5Cr, 10Cr. */
export const NET_WORTH_LINES: readonly number[] = [
  100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000,
].map((rupees) => rupees * 100);

/** The highest line at or below a total, or 0 when it is under the first. */
export const netWorthLine = (total: number): number =>
  NET_WORTH_LINES.filter((line) => total >= line).reduce((top, line) => Math.max(top, line), 0);
