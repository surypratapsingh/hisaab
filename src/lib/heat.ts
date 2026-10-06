/**
 * How dark to draw each day of a calendar: 0 for a day with nothing spent, then 1–4
 * by where the day stands among the days that had spending (a quarter each), so a
 * single very large day does not make every other day look the same.
 */
export const shades = (amounts: number[]): number[] => {
  const spent = amounts.filter((a) => a > 0).sort((a, b) => a - b);
  if (spent.length === 0) return amounts.map(() => 0);

  return amounts.map((a) => {
    if (a <= 0) return 0;
    // The share of spending days that cost no more than this one; ties share a shade.
    const upTo = spent.filter((s) => s <= a).length;
    return Math.min(4, Math.max(1, Math.ceil((upTo / spent.length) * 4)));
  });
};
