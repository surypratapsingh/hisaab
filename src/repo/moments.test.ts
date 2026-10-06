import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import {
  newMoney,
  largestSalary,
  momentsCursor,
  advanceMomentsCursor,
  salaryAnswered,
  rememberSalary,
  goalLineSeen,
  markGoalLine,
  netWorthLineSeen,
  markNetWorthLine,
} from './moments';
import { classifyNew } from '@/ui/motion/classify';

describe('newMoney', () => {
  let db: Database;
  let bank: Id;
  let savings: Id;

  const stamp = (id: string, at: string) => db.run(`UPDATE journal_entries SET created_at = ? WHERE id = ?`, [at, id]);

  const record = (
    kind: 'expense' | 'income' | 'investment' | 'transfer',
    amount: number,
    createdAt: string,
    extra: { categoryId?: string; description?: string; toAccountId?: Id } = {}
  ) => {
    const entry = recordTransaction(db, {
      kind,
      amount: paise(amount),
      accountId: bank,
      description: extra.description ?? kind,
      occurredAt: createdAt.slice(0, 10),
      categoryId: extra.categoryId as Id | undefined,
      toAccountId: extra.toAccountId,
    }).getOrNull()!;
    stamp(entry.id, createdAt);
    return entry.id;
  };

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db.createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false }).getOrNull()!.id;
    savings = db.createAccount({ name: 'Savings', kind: 'asset', subkind: 'bank', last4: '5678', isSystem: false }).getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('returns entries created after the cursor, oldest first, with their effect on own accounts', () => {
    record('expense', 129_900, '2026-09-28T08:00:00.000Z', { categoryId: 'cat_shopping', description: 'Amazon' });
    record('income', 6_800_000, '2026-09-29T09:00:00.000Z', { categoryId: 'cat_salary' });
    record('expense', 5_000, '2026-09-29T10:00:00.000Z');

    const found = newMoney(db, '2026-09-28T12:00:00.000Z');
    expect(found.map((r) => r.kind)).toEqual(['income', 'expense']);
    expect(found[0]).toMatchObject({ net: 6_800_000, outflow: 0, categoryId: 'cat_salary', category: 'Salary' });
    expect(found[1]).toMatchObject({ net: -5_000, outflow: 5_000 });
  });

  it('reads an investment by the money that left the bank, though it stays in the user’s hands', () => {
    record('investment', 500_000, '2026-09-29T09:00:00.000Z');
    const [row] = newMoney(db, '2026-09-29T00:00:00.000Z');
    expect(row.kind).toBe('investment');
    expect(row.outflow).toBe(500_000);
    expect(row.net).toBe(0);
  });

  it('reads a transfer between own accounts as no net movement', () => {
    record('transfer', 200_000, '2026-09-29T09:00:00.000Z', { toAccountId: savings });
    const [row] = newMoney(db, '2026-09-29T00:00:00.000Z');
    expect(row.kind).toBe('transfer');
    expect(row.net).toBe(0);
  });

  it('finds the biggest salary already in the ledger before a moment', () => {
    record('income', 5_000_000, '2026-07-01T09:00:00.000Z', { categoryId: 'cat_salary' });
    record('income', 6_000_000, '2026-08-01T09:00:00.000Z', { categoryId: 'cat_salary' });
    record('income', 9_000_000, '2026-09-29T09:00:00.000Z', { categoryId: 'cat_salary' });
    record('income', 9_900_000, '2026-08-05T09:00:00.000Z', { categoryId: 'cat_savings' });
    expect(largestSalary(db, '2026-09-01T00:00:00.000Z')).toBe(6_000_000);
    expect(largestSalary(db, '2026-01-01T00:00:00.000Z')).toBe(0);
  });

  it('starts its cursor at now, so history is never answered, and then holds where it was put', () => {
    record('expense', 100, '2026-01-01T00:00:00.000Z');
    const first = momentsCursor(db);
    expect(newMoney(db, first)).toEqual([]);
    expect(momentsCursor(db)).toBe(first);
    advanceMomentsCursor(db, '2026-09-29T10:00:00.000Z');
    expect(momentsCursor(db)).toBe('2026-09-29T10:00:00.000Z');
  });

  it('feeds the classifier: a fresh salary from the ledger becomes a salary moment', () => {
    record('income', 6_000_000, '2026-08-01T09:00:00.000Z', { categoryId: 'cat_salary' });
    record('income', 6_400_000, '2026-09-29T09:00:00.000Z', { categoryId: 'cat_salary' });
    const since = '2026-09-01T00:00:00.000Z';
    const moments = classifyNew(newMoney(db, since), { largestSalary: largestSalary(db, since), salaryAnswered: () => false });
    expect(moments.map((m) => m.type)).toEqual(['SALARY_RECEIVED']);
    expect(moments[0].amount).toBe(6_400_000);
  });

  it('remembers a salary for ten days, within a hundredth of its size', () => {
    const day = 86_400_000;
    expect(salaryAnswered(db, 6_800_000, 0)).toBe(false);
    rememberSalary(db, 6_800_000, 1000);
    expect(salaryAnswered(db, 6_800_000, 1000 + 2 * day)).toBe(true);
    expect(salaryAnswered(db, 6_790_000, 1000 + 2 * day)).toBe(true);
    expect(salaryAnswered(db, 6_000_000, 1000 + 2 * day)).toBe(false);
    expect(salaryAnswered(db, 6_800_000, 1000 + 11 * day)).toBe(false);
  });

  it('remembers the highest line celebrated for a goal', () => {
    expect(goalLineSeen(db, 'g1')).toBe(0);
    markGoalLine(db, 'g1', 50);
    expect(goalLineSeen(db, 'g1')).toBe(50);
    expect(goalLineSeen(db, 'g2')).toBe(0);
  });

  it('sets the net-worth line to where the money already is the first time', () => {
    expect(netWorthLineSeen(db, 2_562_692)).toBeUndefined();
    expect(netWorthLineSeen(db, 9_999_999)).toBe(2_562_692);
    markNetWorthLine(db, 10_000_000);
    expect(netWorthLineSeen(db, 1)).toBe(10_000_000);
  });
});
