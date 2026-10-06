import { Database, type DatabaseError } from '@/db/client';
import { generateId, type Id } from '@/lib/ulid';
import { toUTC, now, monthRange } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise, subtract, isNegative, sum } from '@/money/money';

export type Budget = {
  id: Id;
  categoryId: Id;
  amount: Paise;
  createdAt: string;
  /** YYYY-MM from which unspent money carries into the next month; null when it does not. */
  rolloverFrom: string | null;
};

export type BudgetError = {
  code: 'INVALID_INPUT' | 'DUPLICATE' | 'NOT_FOUND' | 'DATABASE';
  message: string;
};

type BudgetRow = {
  id: string;
  category_id: string;
  amount: number;
  created_at: string;
  rollover_from: string | null;
};

const toBudget = (row: BudgetRow): Budget => ({
  id: row.id as Id,
  categoryId: row.category_id as Id,
  amount: paise(row.amount),
  createdAt: row.created_at,
  rolloverFrom: row.rollover_from ?? null,
});

const invalid = (message: string): Result<never, BudgetError> =>
  err({ code: 'INVALID_INPUT', message });

const fromDb = (error: DatabaseError): BudgetError => ({ code: 'DATABASE', message: error.message });

export const listBudgets = (db: Database): Budget[] => {
  const rows = db.query<BudgetRow>(`SELECT * FROM budgets ORDER BY created_at`);
  return rows.isOk() ? rows.value.map(toBudget) : [];
};

const findByCategory = (db: Database, categoryId: Id): Budget | null => {
  const rows = db.query<BudgetRow>(`SELECT * FROM budgets WHERE category_id = ?`, [categoryId]);
  return rows.isOk() && rows.value[0] ? toBudget(rows.value[0]) : null;
};

export const createBudget = (db: Database, categoryId: Id, amount: Paise): Result<Budget, BudgetError> => {
  if (!Number.isInteger(amount) || amount <= 0) return invalid('Enter a limit above zero');
  if (findByCategory(db, categoryId)) {
    return err({ code: 'DUPLICATE', message: 'This category already has a budget — edit it instead' });
  }

  const budget: Budget = { id: generateId(), categoryId, amount, createdAt: toUTC(now()), rolloverFrom: null };
  const written = db.run(`INSERT INTO budgets (id, category_id, amount, created_at) VALUES (?, ?, ?, ?)`, [
    budget.id,
    budget.categoryId,
    budget.amount,
    budget.createdAt,
  ]);

  return written.isOk() ? ok(budget) : err(fromDb(written.error));
};

export const editBudget = (db: Database, id: Id, amount: Paise): Result<void, BudgetError> => {
  if (!Number.isInteger(amount) || amount <= 0) return invalid('Enter a limit above zero');
  const written = db.run(`UPDATE budgets SET amount = ? WHERE id = ?`, [amount, id]);
  return written.isOk() ? ok(undefined) : err(fromDb(written.error));
};

const monthKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * Turns rollover on from this month (what is left at its end carries into the next) or off.
 * Turning it off and on again starts afresh: nothing from before carries.
 */
export const setRollover = (db: Database, id: Id, on: boolean, month = new Date()): Result<void, BudgetError> => {
  const written = db.run(`UPDATE budgets SET rollover_from = ? WHERE id = ?`, [on ? monthKey(month) : null, id]);
  return written.isOk() ? ok(undefined) : err(fromDb(written.error));
};

export const deleteBudget = (db: Database, id: Id): Result<void, BudgetError> => {
  const written = db.run(`DELETE FROM budgets WHERE id = ?`, [id]);
  return written.isOk() ? ok(undefined) : err(fromDb(written.error));
};

export type BudgetProgress = {
  id: Id;
  categoryId: Id;
  categoryName: string;
  amount: Paise;
  spent: Paise;
  remaining: Paise;
  /** Can run over 100 — the screen clamps the bar, the figure still shows it. */
  percentage: number;
  over: boolean;
  /** Days of the month left, today included. */
  daysLeft: number;
  /** What is left spread over the days left; zero once the budget is used up. */
  perDay: Paise;
  /** How far through the month it is, whole percent — where an even pace would be on the bar. */
  pace: number;
  rollover: boolean;
  /** Unspent money carried in from earlier months; zero without rollover. Part of `limit`. */
  carried: Paise;
  /** What can be spent this month: the monthly amount plus what was carried in. */
  limit: Paise;
};

/**
 * What carries into `month`: each month from the one rollover began in up to the month before,
 * what was left of (amount + carried) moves on. An overspent month carries nothing and does not
 * eat into the next one. Past months are measured against today's amount, as limits are not
 * kept per month.
 */
const carriedInto = (db: Database, budget: Budget, month: Date): Paise => {
  if (!budget.rolloverFrom) return paise(0);
  const [year, mon] = budget.rolloverFrom.split('-').map(Number);
  let cursor = new Date(year, mon - 1, 1);
  const stop = new Date(month.getFullYear(), month.getMonth(), 1);
  let carried = paise(0);
  for (let guard = 0; cursor < stop && guard < 240; guard++) {
    const { from, to } = monthRange(cursor);
    const spent =
      (db.categoryTotals(from, to).getOrNull() ?? []).find((row) => row.categoryId === budget.categoryId)?.total ??
      paise(0);
    const left = subtract(sum([budget.amount, carried]), spent);
    carried = isNegative(left) ? paise(0) : left;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return carried;
};

/** Every budget against what its category actually spent this month. */
export const budgetsView = (db: Database, month = new Date()): BudgetProgress[] => {
  const budgets = listBudgets(db);
  if (budgets.length === 0) return [];

  const { from, to } = monthRange(month);
  const spentByCategory = new Map(
    (db.categoryTotals(from, to).getOrNull() ?? []).map((row) => [row.categoryId, row.total])
  );
  const categories = new Map((db.getCategories().getOrNull() ?? []).map((c) => [c.id, c.name]));

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - month.getDate() + 1;
  const pace = Math.round((month.getDate() / daysInMonth) * 100);

  return budgets.map((budget) => {
    const spent = spentByCategory.get(budget.categoryId) ?? paise(0);
    const carried = carriedInto(db, budget, month);
    const limit = sum([budget.amount, carried]);
    const remaining = subtract(limit, spent);
    return {
      rollover: budget.rolloverFrom !== null,
      carried,
      limit,
      daysLeft,
      pace,
      perDay: isNegative(remaining) ? paise(0) : paise(Math.floor(remaining / daysLeft)),
      id: budget.id,
      categoryId: budget.categoryId,
      categoryName: categories.get(budget.categoryId) ?? 'Unknown',
      amount: budget.amount,
      spent,
      remaining,
      percentage: limit > 0 ? Math.round((spent / limit) * 100) : 0,
      over: isNegative(remaining),
    };
  });
};

/**
 * Budgets that ended last month within their limit, having spent something.
 * A budget made this month had no last month, so it is not counted.
 */
export const budgetsKeptLastMonth = (
  db: Database,
  today = new Date()
): Array<{ id: Id; name: string; month: string }> => {
  const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const thisMonthStart = toUTC(new Date(today.getFullYear(), today.getMonth(), 1));
  const month = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
  const existed = new Set(listBudgets(db).filter((b) => b.createdAt < thisMonthStart).map((b) => b.id));

  return budgetsView(db, previous)
    .filter((b) => existed.has(b.id) && !b.over && b.spent > 0)
    .map((b) => ({ id: b.id, name: b.categoryName, month }));
};
