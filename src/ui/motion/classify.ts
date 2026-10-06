import type { NewMoney } from '@/repo/moments';
import type { Moment } from './moments';

/**
 * From entries that have just appeared in the ledger to the Money Moments
 * worth answering. Pure: the database read lives in `repo/moments.ts`.
 */

export type ClassifyContext = {
  /** The biggest credit already filed as Salary, in paise; 0 when there has been none. */
  largestSalary: number;
  /** Whether a salary of this size was already answered recently (a manual entry then a bank message). */
  salaryAnswered: (amount: number) => boolean;
};

/** A first salary with nothing to compare against has to be at least this, in paise. */
const FIRST_SALARY_FLOOR = 10_000 * 100;
/** A statement or backup brings many entries at once; that is history, not a moment. */
const BULK = 5;
const RECENT_DAYS = 3;

const dayMs = 86_400_000;

const dateOf = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/**
 * Salary is money the user (or the app) filed under Salary, and big enough to
 * be one: at least half of the biggest salary before it, or ₹10,000 when there
 * is none. A ₹200 refund a manual entry happened to file under Salary is just income.
 */
export const isSalary = (row: NewMoney, largestSalary: number): boolean =>
  row.kind === 'income' &&
  row.categoryId === 'cat_salary' &&
  row.net >= (largestSalary > 0 ? largestSalary / 2 : FIRST_SALARY_FLOOR);

export const classifyNew = (rows: NewMoney[], context: ClassifyContext): Moment[] => {
  if (rows.length === 0 || rows.length > BULK) return [];

  const best = new Map<Moment['type'], Moment>();
  const keep = (moment: Moment) => {
    const held = best.get(moment.type);
    if (!held || (moment.amount ?? 0) > (held.amount ?? 0)) best.set(moment.type, moment);
  };

  for (const row of rows) {
    // Something dated well before it arrived is history being filled in.
    if (dateOf(row.createdAt) - dateOf(row.occurredAt) > RECENT_DAYS * dayMs) continue;
    const at = Date.parse(row.createdAt);
    const base = { at: Number.isNaN(at) ? Date.now() : at, key: '', label: row.category };

    if (isSalary(row, context.largestSalary)) {
      if (context.salaryAnswered(row.net)) continue;
      keep({ ...base, type: 'SALARY_RECEIVED', key: `SALARY_RECEIVED:${row.id}`, amount: row.net });
    } else if ((row.kind === 'income' || row.kind === 'refund') && row.net > 0) {
      keep({ ...base, type: 'INCOME_RECEIVED', key: `INCOME_RECEIVED:${row.id}`, amount: row.net });
    } else if ((row.kind === 'expense' || row.kind === 'fee') && row.net < 0) {
      keep({ ...base, type: 'EXPENSE_RECORDED', key: `EXPENSE_RECORDED:${row.id}`, amount: -row.net });
    } else if (row.kind === 'investment' && row.outflow > 0) {
      keep({ ...base, type: 'INVESTED', key: `INVESTED:${row.id}`, amount: row.outflow });
    }
  }

  return [...best.values()];
};
