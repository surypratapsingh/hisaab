import { Database, type DatabaseError } from '@/db/client';
import { generateId, type Id } from '@/lib/ulid';
import { toUTC, now } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise } from '@/money/money';

export type Goal = {
  id: Id;
  name: string;
  targetAmount: Paise;
  savedAmount: Paise;
  targetDate?: string;
  createdAt: string;
};

export type GoalError = {
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DATABASE';
  message: string;
};

type GoalRow = {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
  archived_at: string | null;
  created_at: string;
};

const toGoal = (row: GoalRow): Goal => ({
  id: row.id as Id,
  name: row.name,
  targetAmount: paise(row.target_amount),
  savedAmount: paise(row.saved_amount),
  targetDate: row.target_date ?? undefined,
  createdAt: row.created_at,
});

const invalid = (message: string): Result<never, GoalError> =>
  err({ code: 'INVALID_INPUT', message });

const fromDb = (error: DatabaseError): GoalError => ({ code: 'DATABASE', message: error.message });

const DATE = /^\d{4}-\d{2}-\d{2}/;

export const listGoals = (db: Database): Goal[] => {
  const rows = db.query<GoalRow>(
    `SELECT * FROM goals WHERE archived_at IS NULL ORDER BY (target_date IS NULL), target_date, created_at`
  );
  return rows.isOk() ? rows.value.map(toGoal) : [];
};

export const getGoal = (db: Database, id: Id): Goal | null => {
  const rows = db.query<GoalRow>(`SELECT * FROM goals WHERE id = ?`, [id]);
  return rows.isOk() && rows.value[0] ? toGoal(rows.value[0]) : null;
};

export type NewGoal = {
  name: string;
  targetAmount: Paise;
  targetDate?: string;
};

export const createGoal = (db: Database, input: NewGoal): Result<Goal, GoalError> => {
  const name = input.name.trim();
  if (!name) return invalid('Give the goal a name');
  if (!Number.isInteger(input.targetAmount) || input.targetAmount <= 0) {
    return invalid('Enter a target above zero');
  }
  if (input.targetDate && !DATE.test(input.targetDate)) return invalid('Enter a valid date');

  const goal: Goal = {
    id: generateId(),
    name,
    targetAmount: input.targetAmount,
    savedAmount: paise(0),
    targetDate: input.targetDate,
    createdAt: toUTC(now()),
  };

  const written = db.run(
    `INSERT INTO goals (id, name, target_amount, saved_amount, target_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [goal.id, goal.name, goal.targetAmount, goal.savedAmount, goal.targetDate ?? null, goal.createdAt]
  );

  return written.isOk() ? ok(goal) : err(fromDb(written.error));
};

export const editGoal = (
  db: Database,
  id: Id,
  patch: { name?: string; targetAmount?: Paise; targetDate?: string | null }
): Result<Goal, GoalError> => {
  const existing = getGoal(db, id);
  if (!existing) return err({ code: 'NOT_FOUND', message: 'No such goal' });

  const next: Goal = {
    ...existing,
    name: (patch.name ?? existing.name).trim(),
    targetAmount: patch.targetAmount ?? existing.targetAmount,
    targetDate: patch.targetDate === null ? undefined : (patch.targetDate ?? existing.targetDate),
  };
  if (!next.name) return invalid('Give the goal a name');
  if (!Number.isInteger(next.targetAmount) || next.targetAmount <= 0) {
    return invalid('Enter a target above zero');
  }
  if (next.targetDate && !DATE.test(next.targetDate)) return invalid('Enter a valid date');

  const written = db.run(`UPDATE goals SET name = ?, target_amount = ?, target_date = ? WHERE id = ?`, [
    next.name,
    next.targetAmount,
    next.targetDate ?? null,
    id,
  ]);

  return written.isOk() ? ok(next) : err(fromDb(written.error));
};

/** Adds to what has been saved so far — a running total the user keeps by hand. */
export const contributeToGoal = (db: Database, id: Id, amount: Paise): Result<Goal, GoalError> => {
  if (!Number.isInteger(amount) || amount === 0) return invalid('Enter an amount');
  const existing = getGoal(db, id);
  if (!existing) return err({ code: 'NOT_FOUND', message: 'No such goal' });

  const savedAmount = paise(Math.max(0, existing.savedAmount + amount));
  const written = db.run(`UPDATE goals SET saved_amount = ? WHERE id = ?`, [savedAmount, id]);
  return written.isOk() ? ok({ ...existing, savedAmount }) : err(fromDb(written.error));
};

export const deleteGoal = (db: Database, id: Id): Result<void, GoalError> => {
  const written = db.run(`UPDATE goals SET archived_at = ? WHERE id = ?`, [toUTC(now()), id]);
  return written.isOk() ? ok(undefined) : err(fromDb(written.error));
};
