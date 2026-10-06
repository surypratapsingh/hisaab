import { Paise } from '@/money/money';

/** One purchase of something that is usually bought the same way: when, and what it cost. */
export type PricePoint = { id: string; date: string; amount: Paise };

/** A stretch of time in which something cost the same. */
export type PriceRun = {
  amount: Paise;
  /** First and last day it was bought at this price. */
  from: string;
  to: string;
  count: number;
  ids: string[];
};

/** An amount is a price, not a one-off, once it has been paid this often. */
const MIN_AT_A_PRICE = 3;

/**
 * A price moves a little at a time. A jump of more than about a third (330 to 180) is
 * another pack, size or brand, not the same thing costing more or less.
 */
const MAX_STEP = 0.35;

/**
 * Categories where the amount is what someone chose to send or set aside, not what a thing
 * costs: repeated amounts to family or into savings say nothing about a price.
 */
export const NOT_A_PRICE = new Set(['cat_family', 'cat_investment', 'cat_savings', 'cat_transfers']);

const join = (into: PriceRun, next: PriceRun): void => {
  into.to = next.to;
  into.count += next.count;
  into.ids.push(...next.ids);
};

/**
 * The prices something has cost, in the order it held them: "150 for months, then 170,
 * now 180". Built from amounts alone, so it only speaks when the amounts behave like a
 * price: each is paid at least three times (the newest, twice in a row), and the buying
 * moves forward from one to the next without ever coming back. Someone who buys petrol for
 * 200 one week and 300 the next is choosing a quantity, not seeing a price move, so that
 * gives nothing. One odd purchase in between (a larger shop) is ignored, and so is anything
 * from before a jump too big to be a price moving (only what came after it is the story).
 *
 * Returns null when there is no story to tell (fewer than two prices, or one that comes
 * back), otherwise the runs oldest first, the last being the current price.
 */
export const priceRuns = (points: PricePoint[]): PriceRun[] | null => {
  const sorted = [...points]
    .filter((p) => Number.isInteger(p.amount) && p.amount > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  if (sorted.length < MIN_AT_A_PRICE) return null;

  const counts = new Map<number, number>();
  for (const p of sorted) counts.set(p.amount, (counts.get(p.amount) ?? 0) + 1);

  const prices = new Set([...counts].filter(([, n]) => n >= MIN_AT_A_PRICE).map(([amount]) => amount));
  // A price that has only just changed has fewer purchases so far; two in a row confirm it.
  const last = sorted[sorted.length - 1];
  const beforeLast = sorted[sorted.length - 2];
  if (last.amount === beforeLast.amount) prices.add(last.amount);

  const runs: PriceRun[] = [];
  for (const p of sorted) {
    if (!prices.has(p.amount)) continue;
    const run = runs[runs.length - 1];
    if (run && run.amount === p.amount) {
      run.to = p.date;
      run.count += 1;
      run.ids.push(p.id);
    } else {
      runs.push({ amount: p.amount, from: p.date, to: p.date, count: 1, ids: [p.id] });
    }
  }

  // A short spell at some price, before the current one, is not a price of its own.
  for (let i = 0; i < runs.length - 1; ) {
    if (runs[i].count < MIN_AT_A_PRICE) runs.splice(i, 1);
    else i += 1;
  }
  // Stretches that now sit side by side at the same price are one stretch.
  for (let i = 1; i < runs.length; ) {
    if (runs[i].amount === runs[i - 1].amount) {
      join(runs[i - 1], runs[i]);
      runs.splice(i, 1);
    } else {
      i += 1;
    }
  }

  if (new Set(runs.map((r) => r.amount)).size !== runs.length) return null;

  // Keep only the stretch since the last jump too big to be a price moving.
  let start = 0;
  for (let i = runs.length - 1; i > 0; i -= 1) {
    if (Math.abs(runs[i].amount - runs[i - 1].amount) / runs[i - 1].amount > MAX_STEP) {
      start = i;
      break;
    }
  }
  const story = runs.slice(start);

  if (story.length < 2) return null;
  if (story[story.length - 1].count < 2) return null;
  return story;
};
