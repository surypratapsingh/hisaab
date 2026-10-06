import type { Paise } from '@/money/money';
import { daysBetween, isoDate } from '@/lib/date';

export type Credit = {
  date: string;
  amount: Paise;
  categoryId?: string;
};

export type Payday = {
  /** Day of the month the money arrives, 1–31. */
  day: number;
  source: 'salary' | 'pattern';
  lastPaid: string;
};

const dayOf = (date: string): number => Number(date.slice(8, 10));

const byDate = (a: Credit, b: Credit): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

const MONTH = 30;
const MONTH_TOLERANCE = 4;

/**
 * When the user gets paid, read from what has come in.
 *
 * Anything the user marked as salary wins outright. Failing that, a salary is
 * usually the largest credit that recurs about a month apart, so look for a
 * big credit with another big one roughly thirty days before it. A one-off
 * bonus on its own does not qualify, because nothing matches it a month back.
 */
export const detectPayday = (credits: Credit[]): Payday | null => {
  const incoming = credits.filter((c) => c.amount > 0).sort(byDate);

  const salaries = incoming.filter((c) => c.categoryId === 'cat_salary');
  if (salaries.length > 0) {
    const last = salaries[salaries.length - 1];
    return { day: dayOf(last.date), source: 'salary', lastPaid: last.date.slice(0, 10) };
  }

  if (incoming.length < 2) return null;

  const largest = Math.max(...incoming.map((c) => c.amount));
  const big = incoming.filter((c) => c.amount * 2 >= largest);

  for (let i = big.length - 1; i > 0; i--) {
    const latest = big[i];
    const monthBefore = big.slice(0, i).some(
      (earlier) =>
        Math.abs(
          daysBetween(new Date(earlier.date), new Date(latest.date)) - MONTH
        ) <= MONTH_TOLERANCE
    );
    if (monthBefore) {
      return { day: dayOf(latest.date), source: 'pattern', lastPaid: latest.date.slice(0, 10) };
    }
  }

  return null;
};

/**
 * The next time that day of the month comes round, as YYYY-MM-DD. On payday
 * itself the answer is next month: the window runs until the next salary, not
 * the one that has just arrived. A payday of the 31st lands on the last day of
 * shorter months.
 */
export const nextPayday = (day: number, today: Date): string => {
  const lastDay = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const year = today.getFullYear();
  const month = today.getMonth();

  const thisMonth = Math.min(day, lastDay(year, month));
  if (today.getDate() < thisMonth) return isoDate(new Date(year, month, thisMonth));

  return isoDate(new Date(year, month + 1, Math.min(day, lastDay(year, month + 1))));
};
