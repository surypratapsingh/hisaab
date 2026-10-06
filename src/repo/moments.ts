import { Database } from '@/db/client';
import { toUTC, now } from '@/lib/date';

/**
 * What has appeared in the ledger since a moment in time, for the motion
 * system to answer. Read only, except for the cursor that remembers how far
 * it has looked.
 */

export type NewMoney = {
  id: string;
  kind: 'expense' | 'income' | 'transfer' | 'refund' | 'fee' | 'investment';
  categoryId?: string;
  category?: string;
  occurredAt: string;
  createdAt: string;
  /** Sum of the postings on the user's own accounts (positive: money in). */
  net: number;
  /** Money that left the user's accounts, always positive. */
  outflow: number;
};

const CURSOR = 'moments_cursor';

/** Entries created after `since`, oldest first, with their effect on the user's own accounts. */
export const newMoney = (db: Database, since: string, limit = 50): NewMoney[] =>
  (
    db
      .query<{
        id: string;
        kind: NewMoney['kind'];
        category_id: string | null;
        category: string | null;
        occurred_at: string;
        created_at: string;
        net: number;
        outflow: number;
      }>(
        `SELECT e.id, e.kind, e.category_id, c.name AS category, e.occurred_at, e.created_at,
                SUM(p.amount) AS net,
                SUM(CASE WHEN p.amount < 0 THEN -p.amount ELSE 0 END) AS outflow
         FROM journal_entries e
         JOIN postings p ON p.entry_id = e.id
         JOIN accounts a ON a.id = p.account_id AND a.kind = 'asset' AND a.is_system = 0 AND a.excluded = 0
         LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.created_at > ?
         GROUP BY e.id
         ORDER BY e.created_at
         LIMIT ?`,
        [since, limit]
      )
      .getOrNull() ?? []
  ).map((row) => ({
    id: row.id,
    kind: row.kind,
    categoryId: row.category_id ?? undefined,
    category: row.category ?? undefined,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    net: row.net,
    outflow: row.outflow,
  }));

/** The biggest credit filed as Salary among entries created up to `until`; 0 when there is none. */
export const largestSalary = (db: Database, until: string): number => {
  const [row] =
    db
      .query<{ biggest: number | null }>(
        `SELECT MAX(net) AS biggest FROM (
           SELECT SUM(p.amount) AS net
           FROM journal_entries e
           JOIN postings p ON p.entry_id = e.id
           JOIN accounts a ON a.id = p.account_id AND a.kind = 'asset' AND a.is_system = 0 AND a.excluded = 0
           WHERE e.kind = 'income' AND e.category_id = 'cat_salary' AND e.created_at <= ?
           GROUP BY e.id
         )`,
        [until]
      )
      .getOrNull() ?? [];
  return row?.biggest && row.biggest > 0 ? row.biggest : 0;
};

/**
 * Where the last look ended. The first time, it is set to now, so the history
 * already in the ledger is never answered as if it had just happened.
 */
export const momentsCursor = (db: Database): string => {
  const stored = db.getSetting(CURSOR).getOrNull();
  if (stored) return stored;
  const start = toUTC(now());
  db.setSetting(CURSOR, start);
  return start;
};

export const advanceMomentsCursor = (db: Database, to: string): void => {
  db.setSetting(CURSOR, to);
};

// ---------------------------------------------------------------- what was answered

const SALARY = 'moment_salary';
const TEN_DAYS = 10 * 86_400_000;

/**
 * A salary that a hand-typed entry has already celebrated is not celebrated a
 * second time when the bank's message for the same money lands (the two are
 * reconciled into one entry, but the second can look like a new arrival).
 */
export const salaryAnswered = (db: Database, amount: number, at = Date.now()): boolean => {
  const stored = db.getSetting(SALARY).getOrNull();
  if (!stored) return false;
  try {
    const seen = JSON.parse(stored) as { amount: number; at: number };
    return at - seen.at < TEN_DAYS && Math.abs(amount - seen.amount) <= seen.amount * 0.01;
  } catch {
    return false;
  }
};

export const rememberSalary = (db: Database, amount: number, at = Date.now()): void => {
  db.setSetting(SALARY, JSON.stringify({ amount, at }));
};

/** The highest goal line (25, 50, 75, 100) already celebrated for a goal, or 0. */
export const goalLineSeen = (db: Database, goalId: string): number =>
  Number(db.getSetting(`goal_line:${goalId}`).getOrNull() ?? 0) || 0;

export const markGoalLine = (db: Database, goalId: string, percent: number): void => {
  db.setSetting(`goal_line:${goalId}`, String(percent));
};

/**
 * The net-worth line last celebrated, in paise. The first time it is asked it
 * is set to where the money already is, so the past is never celebrated.
 * Returns the line before this call (undefined the first time).
 */
export const netWorthLineSeen = (db: Database, current: number): number | undefined => {
  const stored = db.getSetting('networth_line').getOrNull();
  if (stored === null) {
    db.setSetting('networth_line', String(current));
    return undefined;
  }
  return Number(stored) || 0;
};

export const markNetWorthLine = (db: Database, line: number): void => {
  db.setSetting('networth_line', String(line));
};

/** A budget kept in a month is celebrated once, the first time its screen is opened after. */
export const keptSeen = (db: Database, budgetId: string, month: string): boolean =>
  db.getSetting(`budget_kept:${budgetId}:${month}`).getOrNull() === 'yes';

export const markKeptSeen = (db: Database, budgetId: string, month: string): void => {
  db.setSetting(`budget_kept:${budgetId}:${month}`, 'yes');
};
