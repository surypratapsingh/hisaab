import { Database, type DatabaseError } from '@/db/client';
import { generateId, type Id } from '@/lib/ulid';
import { toUTC, now, isoDate, addDays, addMonths, localDate } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise } from '@/money/money';

/** Same cadences the mandate card already names, so the wording matches. */
export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';

export type RecurringItem = {
  id: Id;
  name: string;
  amount: Paise;
  cadence: Cadence;
  nextDue: string;
  note?: string;
  createdAt: string;
};

export type RecurringError = {
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DATABASE';
  message: string;
};

type RecurringRow = {
  id: string;
  name: string;
  amount: number;
  cadence: string;
  next_due: string;
  note: string | null;
  archived_at: string | null;
  created_at: string;
};

const toRecurring = (row: RecurringRow): RecurringItem => ({
  id: row.id as Id,
  name: row.name,
  amount: paise(row.amount),
  cadence: row.cadence as Cadence,
  nextDue: row.next_due,
  note: row.note ?? undefined,
  createdAt: row.created_at,
});

const invalid = (message: string): Result<never, RecurringError> =>
  err({ code: 'INVALID_INPUT', message });

const fromDb = (error: DatabaseError): RecurringError => ({ code: 'DATABASE', message: error.message });

const DATE = /^\d{4}-\d{2}-\d{2}/;
const CADENCES: Cadence[] = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'];

/** The next date this cadence falls on, counting forward from the one just paid. */
export const nextOccurrence = (from: string, cadence: Cadence): string => {
  const date = localDate(from);
  switch (cadence) {
    case 'weekly':
      return isoDate(addDays(date, 7));
    case 'monthly':
      return isoDate(addMonths(date, 1));
    case 'quarterly':
      return isoDate(addMonths(date, 3));
    case 'half-yearly':
      return isoDate(addMonths(date, 6));
    case 'yearly':
      return isoDate(addMonths(date, 12));
  }
};

export const listRecurring = (db: Database): RecurringItem[] => {
  const rows = db.query<RecurringRow>(
    `SELECT * FROM recurring_items WHERE archived_at IS NULL ORDER BY next_due`
  );
  return rows.isOk() ? rows.value.map(toRecurring) : [];
};

export const getRecurring = (db: Database, id: Id): RecurringItem | null => {
  const rows = db.query<RecurringRow>(`SELECT * FROM recurring_items WHERE id = ?`, [id]);
  return rows.isOk() && rows.value[0] ? toRecurring(rows.value[0]) : null;
};

export type NewRecurring = {
  name: string;
  amount: Paise;
  cadence: Cadence;
  nextDue: string;
  note?: string;
};

export const createRecurring = (db: Database, input: NewRecurring): Result<RecurringItem, RecurringError> => {
  const name = input.name.trim();
  if (!name) return invalid('Say what this is for');
  if (!Number.isInteger(input.amount) || input.amount <= 0) return invalid('Enter an amount above zero');
  if (!CADENCES.includes(input.cadence)) return invalid('Choose how often it repeats');
  if (!DATE.test(input.nextDue)) return invalid('Enter the next date it is due');

  const item: RecurringItem = {
    id: generateId(),
    name,
    amount: input.amount,
    cadence: input.cadence,
    nextDue: input.nextDue.slice(0, 10),
    note: input.note?.trim() || undefined,
    createdAt: toUTC(now()),
  };

  const written = db.run(
    `INSERT INTO recurring_items (id, name, amount, cadence, next_due, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.name, item.amount, item.cadence, item.nextDue, item.note ?? null, item.createdAt]
  );

  return written.isOk() ? ok(item) : err(fromDb(written.error));
};

/** Rolls a reminder forward to its next date, once the user has paid this one. */
export const markRecurringPaid = (db: Database, id: Id): Result<RecurringItem, RecurringError> => {
  const existing = getRecurring(db, id);
  if (!existing) return err({ code: 'NOT_FOUND', message: 'No such reminder' });

  const next: RecurringItem = { ...existing, nextDue: nextOccurrence(existing.nextDue, existing.cadence) };
  const written = db.run(`UPDATE recurring_items SET next_due = ? WHERE id = ?`, [next.nextDue, id]);
  return written.isOk() ? ok(next) : err(fromDb(written.error));
};

export const deleteRecurring = (db: Database, id: Id): Result<void, RecurringError> => {
  const written = db.run(`UPDATE recurring_items SET archived_at = ? WHERE id = ?`, [toUTC(now()), id]);
  return written.isOk() ? ok(undefined) : err(fromDb(written.error));
};
