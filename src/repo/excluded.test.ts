import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction, setBalanceNow } from '@/repo/manual';
import { monthSummary, netWorthOf, accountsWithBalances, timeline } from '@/repo/views';
import { reportView } from '@/repo/reports';
import { searchEntries } from '@/repo/search';
import { safeToSpendView, SETTING_PAYDAY } from '@/repo/analysisViews';
import { wealthView } from '@/wealth/repo';
import { wealthSplit } from '@/wealth/split';
import { exportLedger, importBackup } from '@/security/backup';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

const TODAY = new Date(2026, 8, 20, 12); // 20 Sep 2026

describe('an account left out of totals', () => {
  let db: Database;
  let bank: Id;
  let side: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db.createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false }).getOrNull()!.id;
    side = db.createAccount({ name: 'Shop till', kind: 'asset', subkind: 'bank', last4: '9999', isSystem: false }).getOrNull()!.id;
    setBalanceNow(db, bank, paise(5000000), '2026-09-01');
    setBalanceNow(db, side, paise(2000000), '2026-09-01');

    recordTransaction(db, { kind: 'income', amount: paise(3000000), accountId: bank, description: 'Salary', occurredAt: '2026-09-02', categoryId: 'cat_salary' as Id });
    recordTransaction(db, { kind: 'expense', amount: paise(50000), accountId: bank, description: 'Tea stall', occurredAt: '2026-09-05', categoryId: 'cat_food' as Id });
    recordTransaction(db, { kind: 'expense', amount: paise(700000), accountId: side, description: 'Stock for the shop', occurredAt: '2026-09-06', categoryId: 'cat_shopping' as Id });
    recordTransaction(db, { kind: 'income', amount: paise(900000), accountId: side, description: 'Shop takings', occurredAt: '2026-09-07' });
    db.setSetting(SETTING_PAYDAY, '1');
  });

  afterEach(() => db.close());

  it('counts every account until one is left out', () => {
    expect(format(monthSummary(db, TODAY).spent)).toBe('Rs 7,500.00');
    expect(db.setAccountExcluded(side, true).isOk()).toBe(true);
    expect(db.getAllAccounts().getOrNull()!.find((a) => a.id === side)!.excluded).toBe(true);
  });

  it('leaves its money out of spending, income, reports and search totals', () => {
    db.setAccountExcluded(side, true);

    const month = monthSummary(db, TODAY);
    expect(format(month.spent)).toBe('Rs 500.00');
    expect(format(month.received)).toBe('Rs 30,000.00');

    const report = reportView(db, '2026-09', TODAY);
    expect(format(report.expense)).toBe('Rs 500.00');
    expect(report.categories.map((c) => c.name)).toEqual(['Food & Dining']);

    const found = searchEntries(db, 'shop');
    expect(found.count).toBe(2); // still listed
    expect(format(found.expense)).toBe('Rs 0.00');
    expect(format(found.income)).toBe('Rs 0.00');
  });

  it('leaves its balance out of wealth, net worth and Safe to spend, but keeps it listed', () => {
    const before = safeToSpendView(db, TODAY);
    db.setAccountExcluded(side, true);

    const wealth = wealthView(db);
    expect(wealth.parts.find((p) => p.accountId === side)).toMatchObject({ excluded: true });
    expect(format(wealth.total)).toBe('Rs 79,500.00');
    expect(format(wealthSplit(wealth).bankAndCash)).toBe('Rs 79,500.00');
    expect(format(netWorthOf(db).net)).toBe('Rs 79,500.00');
    expect(accountsWithBalances(db).find((a) => a.id === side)).toMatchObject({ excluded: true });

    const after = safeToSpendView(db, TODAY);
    if (before.status !== 'ready' || after.status !== 'ready') throw new Error('payday is set');
    const balance = (v: typeof after) => v.result.lines[0].amount;
    expect(format(balance(before))).toBe('Rs 1,01,500.00');
    expect(format(balance(after))).toBe('Rs 79,500.00');

    // Its entries still show where entries are listed.
    expect(timeline(db, 50).flatMap((d) => d.entries.map((e) => e.merchant))).toContain('Stock for the shop');
  });

  it('counts it again when switched back', () => {
    db.setAccountExcluded(side, true);
    db.setAccountExcluded(side, false);
    expect(format(monthSummary(db, TODAY).spent)).toBe('Rs 7,500.00');
    expect(format(wealthView(db).total)).toBe('Rs 1,01,500.00');
  });

  it('survives a backup, and an older backup restores every account as counted', () => {
    db.setAccountExcluded(side, true);
    const data = exportLedger(db).getOrNull()!.data;

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    expect(importBackup(fresh, data).isOk()).toBe(true);
    expect(fresh.getAllAccounts().getOrNull()!.find((a) => a.id === side)!.excluded).toBe(true);

    const older = JSON.parse(data);
    for (const account of older.accounts) delete account.excluded;
    const oldFresh = new Database(new NodeSqliteDriver());
    oldFresh.initialize();
    expect(importBackup(oldFresh, JSON.stringify({ ...older, version: 7 })).isOk()).toBe(true);
    expect(oldFresh.getAllAccounts().getOrNull()!.find((a) => a.id === side)!.excluded).toBe(false);
    fresh.close();
    oldFresh.close();
  });
});

describe('a phone database from before accounts could be left out', () => {
  it('gains the column on open, every account counted', () => {
    const driver = new NodeSqliteDriver();
    driver.exec(`CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
      subkind TEXT CHECK (subkind IN ('bank', 'credit_card', 'cash', 'wallet', 'loan', 'investment')),
      last4 TEXT, institution TEXT, is_system INTEGER NOT NULL DEFAULT 0, archived_at TEXT, created_at TEXT NOT NULL)`);
    driver.run(`INSERT INTO accounts (id, name, kind, subkind, is_system, created_at) VALUES ('old', 'Old bank', 'asset', 'bank', 0, '2026-01-01')`);

    const db = new Database(driver);
    expect(db.initialize().isOk()).toBe(true);
    expect(db.getAllAccounts().getOrNull()!.find((a) => a.id === ('old' as Id))!.excluded).toBe(false);
    db.close();
  });
});
