import { describe, it, expect } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { spentBefore } from '@/repo/reports';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import { spendingScore } from './spendingScore';

const rupees = (...amounts: number[]) => amounts.map((r) => paise(r * 100));

describe('spendingScore', () => {
  const before = { total: paise(90 * 100 * 100), days: 90 }; // ₹100 a day

  it('counts the days under the average, the run up to today and the longest run', () => {
    // 1st–7th: under, under, OVER, under, under, under, OVER (today, so far)
    const score = spendingScore(rupees(50, 0, 300, 20, 99, 0, 150, 400, 400), 7, before)!;
    expect(format(score.average)).toBe('Rs 100.00');
    expect(score).toMatchObject({ days: 7, under: 5, streak: 0, best: 3, basisDays: 90 });
  });

  it('counts today in the run while it stays under, and a day of exactly the average is not under', () => {
    expect(spendingScore(rupees(10, 100, 5, 0), 4, before)).toMatchObject({ under: 3, streak: 2, best: 2 });
  });

  it('says nothing without two weeks of history or any spending in it', () => {
    expect(spendingScore(rupees(10), 1, { total: paise(5000), days: 13 })).toBeNull();
    expect(spendingScore(rupees(10), 1, { total: paise(0), days: 90 })).toBeNull();
  });
});

describe('spentBefore', () => {
  it('takes the 90 days before the month, fewer when the records start later, by the totals rule', () => {
    const db = new Database(new NodeSqliteDriver());
    db.initialize();
    const bank = db.createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false }).getOrNull()!.id;
    const cash = db.createAccount({ name: 'Cash', kind: 'asset', subkind: 'cash', isSystem: false }).getOrNull()!.id;
    const spend = (amount: number, date: string) =>
      recordTransaction(db, { kind: 'expense', amount: paise(amount), accountId: bank, description: 'x', occurredAt: date, categoryId: 'cat_food' as Id });

    expect(spentBefore(db, '2026-10')).toEqual({ total: paise(0), days: 0 });

    spend(30000, '2026-09-11'); // records start here: 20 days before October
    spend(12000, '2026-09-30');
    spend(99900, '2026-10-01'); // in the month itself: not part of the basis
    recordTransaction(db, { kind: 'transfer', amount: paise(500000), accountId: bank, toAccountId: cash, description: 'cash', occurredAt: '2026-09-20' });
    expect(spentBefore(db, '2026-10')).toEqual({ total: paise(42000), days: 20 });

    spend(7000, '2026-01-02'); // older than 90 days: the window is the full 90
    expect(spentBefore(db, '2026-10')).toEqual({ total: paise(42000), days: 90 });
    db.close();
  });
});
