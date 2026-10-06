import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { createBudget, editBudget, deleteBudget, listBudgets, budgetsView, setRollover, budgetsKeptLastMonth } from './budgets';
import { recordTransaction } from '@/repo/manual';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import { exportLedger, importBackup } from '@/security/backup';

describe('budgets', () => {
  let db: Database;
  let bankId: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bankId = db
      .createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('refuses a second budget on the same category', () => {
    createBudget(db, 'cat_food' as Id, paise(400000));
    const again = createBudget(db, 'cat_food' as Id, paise(500000));
    expect(again.isErr() && again.error.code).toBe('DUPLICATE');
    expect(listBudgets(db)).toHaveLength(1);
  });

  it('shows what a category has spent against its limit', () => {
    createBudget(db, 'cat_food' as Id, paise(400000));
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(150000),
      accountId: bankId,
      description: 'Groceries',
      occurredAt: new Date().toISOString().slice(0, 10),
      categoryId: 'cat_food' as Id,
    });

    const [progress] = budgetsView(db, new Date());
    expect(progress.categoryName).toBe('Food & Dining');
    expect(format(progress.spent)).toBe('Rs 1,500.00');
    expect(format(progress.remaining)).toBe('Rs 2,500.00');
    expect(progress.percentage).toBe(38);
    expect(progress.over).toBe(false);
  });

  it('flags a budget that has been overspent', () => {
    createBudget(db, 'cat_food' as Id, paise(100000));
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(150000),
      accountId: bankId,
      description: 'Overspent',
      occurredAt: new Date().toISOString().slice(0, 10),
      categoryId: 'cat_food' as Id,
    });

    const [progress] = budgetsView(db, new Date());
    expect(progress.over).toBe(true);
    expect(format(progress.remaining)).toBe('-Rs 500.00');
  });

  it('spreads what is left over the days left, and says how far through the month it is', () => {
    createBudget(db, 'cat_food' as Id, paise(300000));
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(120000),
      accountId: bankId,
      description: 'Groceries',
      occurredAt: '2026-09-05',
      categoryId: 'cat_food' as Id,
    });

    const [onThe21st] = budgetsView(db, new Date(2026, 8, 21, 12));
    expect(onThe21st.daysLeft).toBe(10); // the 21st to the 30th, today included
    expect(format(onThe21st.perDay)).toBe('Rs 180.00');
    expect(onThe21st.pace).toBe(70);

    const [lastDay] = budgetsView(db, new Date(2026, 8, 30, 12));
    expect(lastDay.daysLeft).toBe(1);
    expect(format(lastDay.perDay)).toBe('Rs 1,800.00');
    expect(lastDay.pace).toBe(100);
  });

  it('has nothing left per day once the budget is used up', () => {
    createBudget(db, 'cat_food' as Id, paise(100000));
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(150000),
      accountId: bankId,
      description: 'Big shop',
      occurredAt: '2026-09-05',
      categoryId: 'cat_food' as Id,
    });
    expect(format(budgetsView(db, new Date(2026, 8, 21, 12))[0].perDay)).toBe('Rs 0.00');
  });

  it('edits the limit and can be deleted', () => {
    const budget = createBudget(db, 'cat_food' as Id, paise(100000)).getOrNull()!;
    editBudget(db, budget.id, paise(200000));
    expect(format(listBudgets(db)[0].amount)).toBe('Rs 2,000.00');

    deleteBudget(db, budget.id);
    expect(listBudgets(db)).toHaveLength(0);
  });
});

describe('budget rollover', () => {
  let db: Database;
  let bankId: Id;
  const JULY = new Date(2026, 6, 15);
  const AUGUST = new Date(2026, 7, 15);
  const SEPTEMBER = new Date(2026, 8, 15);
  const OCTOBER = new Date(2026, 9, 15);

  const spend = (rupees: number, date: string) =>
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(rupees * 100),
      accountId: bankId,
      description: 'Food',
      occurredAt: date,
      categoryId: 'cat_food' as Id,
    });

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bankId = db
      .createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('carries nothing without rollover', () => {
    createBudget(db, 'cat_food' as Id, paise(400000));
    spend(1000, '2026-08-10');
    const [progress] = budgetsView(db, SEPTEMBER);
    expect(progress).toMatchObject({ rollover: false, carried: paise(0), limit: paise(400000) });
  });

  it('adds what was left last month to this month', () => {
    const budget = createBudget(db, 'cat_food' as Id, paise(400000)).getOrNull()!;
    setRollover(db, budget.id, true, AUGUST);
    spend(3000, '2026-08-10');
    spend(500, '2026-09-02');

    const [progress] = budgetsView(db, SEPTEMBER);
    expect(format(progress.carried)).toBe('Rs 1,000.00');
    expect(format(progress.limit)).toBe('Rs 5,000.00');
    expect(format(progress.remaining)).toBe('Rs 4,500.00');
    expect(progress.percentage).toBe(10);
  });

  it('keeps adding up over several months, and an overspent month carries nothing', () => {
    const budget = createBudget(db, 'cat_food' as Id, paise(400000)).getOrNull()!;
    setRollover(db, budget.id, true, JULY);
    spend(3000, '2026-07-10'); // Rs 1,000 left
    spend(4500, '2026-08-10'); // 4,000 + 1,000 - 4,500 = Rs 500 left
    expect(format(budgetsView(db, SEPTEMBER)[0].carried)).toBe('Rs 500.00');

    spend(9000, '2026-09-10'); // over: nothing carries, and October is not cut
    expect(format(budgetsView(db, OCTOBER)[0].carried)).toBe('Rs 0.00');
    expect(format(budgetsView(db, OCTOBER)[0].limit)).toBe('Rs 4,000.00');
  });

  it('adds the rollover column to a phone that already had budgets', () => {
    const driver = new NodeSqliteDriver();
    const old = new Database(driver);
    old.initialize();
    driver.exec('ALTER TABLE budgets DROP COLUMN rollover_from'); // as a version 6 phone has it
    expect(old.initialize().isOk()).toBe(true);
    const columns = driver.all<{ name: string }>('PRAGMA table_info(budgets)').map((c) => c.name);
    expect(columns).toContain('rollover_from');
    old.close();
  });

  it('keeps rollover and its start month across a backup and restore', () => {
    const budget = createBudget(db, 'cat_food' as Id, paise(400000)).getOrNull()!;
    setRollover(db, budget.id, true, AUGUST);
    spend(3000, '2026-08-10');
    const backup = exportLedger(db).getOrNull()!;

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    expect(importBackup(fresh, backup.data).isOk()).toBe(true);
    expect(listBudgets(fresh)[0].rolloverFrom).toBe('2026-08');
    expect(format(budgetsView(fresh, SEPTEMBER)[0].carried)).toBe('Rs 1,000.00');
    fresh.close();
  });

  it('carries nothing from months before it was turned on, and stops when turned off', () => {
    const budget = createBudget(db, 'cat_food' as Id, paise(400000)).getOrNull()!;
    spend(1000, '2026-08-10');
    setRollover(db, budget.id, true, SEPTEMBER);
    expect(format(budgetsView(db, SEPTEMBER)[0].carried)).toBe('Rs 0.00');
    expect(format(budgetsView(db, OCTOBER)[0].carried)).toBe('Rs 4,000.00');

    setRollover(db, budget.id, false);
    expect(budgetsView(db, OCTOBER)[0]).toMatchObject({ rollover: false, carried: paise(0) });
  });
});

describe('budgetsKeptLastMonth', () => {
  let db: Database;
  let bankId: Id;

  const spend = (amount: number, date: string, categoryId: string) =>
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(amount),
      accountId: bankId,
      description: 'Spend',
      occurredAt: date,
      categoryId: categoryId as Id,
    });

  /** A budget as if it had been made on `createdAt`. */
  const budget = (categoryId: string, amount: number, createdAt: string) => {
    const made = createBudget(db, categoryId as Id, paise(amount)).getOrNull()!;
    db.run(`UPDATE budgets SET created_at = ? WHERE id = ?`, [createdAt, made.id]);
    return made.id;
  };

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bankId = db
      .createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  const today = new Date(2026, 9, 3); // 3 October 2026

  it('names a budget that ended September within its limit', () => {
    const id = budget('cat_food', 400000, '2026-08-01T00:00:00.000Z');
    spend(150000, '2026-09-12', 'cat_food');
    expect(budgetsKeptLastMonth(db, today)).toEqual([{ id, name: 'Food & Dining', month: '2026-09' }]);
  });

  it('leaves out a budget that ran over, one that spent nothing, and one made this month', () => {
    budget('cat_food', 100000, '2026-08-01T00:00:00.000Z');
    spend(150000, '2026-09-12', 'cat_food');
    budget('cat_transport', 100000, '2026-08-01T00:00:00.000Z');
    budget('cat_shopping', 100000, '2026-10-01T09:00:00.000Z');
    spend(50000, '2026-09-20', 'cat_shopping');
    expect(budgetsKeptLastMonth(db, today)).toEqual([]);
  });

  it('counts a spend of exactly the limit as kept', () => {
    budget('cat_food', 100000, '2026-08-01T00:00:00.000Z');
    spend(100000, '2026-09-12', 'cat_food');
    expect(budgetsKeptLastMonth(db, today)).toHaveLength(1);
  });
});
