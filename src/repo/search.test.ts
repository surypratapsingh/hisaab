import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { timeline } from '@/repo/views';
import { searchEntries } from './search';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

describe('searchEntries', () => {
  let db: Database;
  let bank: Id;
  let cash: Id;

  const spend = (description: string, amount: number, date: string, categoryId?: string, accountId = bank) =>
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(amount),
      accountId,
      description,
      occurredAt: date,
      categoryId: categoryId as Id | undefined,
    });

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db.createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false }).getOrNull()!.id;
    cash = db.createAccount({ name: 'Cash', kind: 'asset', subkind: 'cash', isSystem: false }).getOrNull()!.id;

    recordTransaction(db, { kind: 'income', amount: paise(5000000), accountId: bank, description: 'Salary', occurredAt: '2026-09-01' });
    spend('Chicken', 18000, '2026-09-03', 'cat_food', cash);
    spend('Chicken vala', 20000, '2026-09-10', 'cat_food', cash);
    spend('Paneer', 12000, '2026-09-10', 'cat_groceries', cash);
    spend('Electricity', 180000, '2026-09-12', 'cat_utilities');
  });

  afterEach(() => db.close());

  it('finds words in the narration whatever their case, newest day first', () => {
    const found = searchEntries(db, 'CHICKEN');
    expect(found.days.map((d) => d.entries.map((e) => e.merchant))).toEqual([['Chicken vala'], ['Chicken']]);
    expect(found.count).toBe(2);
    expect(found.truncated).toBe(false);
    expect(format(found.days[0].entries[0].amount)).toBe('-Rs 200.00');
  });

  it('finds by category name too', () => {
    const found = searchEntries(db, 'groceries');
    expect(found.days.flatMap((d) => d.entries.map((e) => e.merchant))).toEqual(['Paneer']);
  });

  it('finds an entry for exactly that many rupees', () => {
    expect(searchEntries(db, '180').days.flatMap((d) => d.entries.map((e) => e.merchant))).toEqual(['Chicken']);
    expect(searchEntries(db, '180.00').count).toBe(1);
    expect(searchEntries(db, '1800').days.flatMap((d) => d.entries.map((e) => e.merchant))).toEqual(['Electricity']);
    expect(searchEntries(db, '17').count).toBe(0);
  });

  it('adds up the money in and out of what matched, never counting a transfer or an investment', () => {
    recordTransaction(db, { kind: 'investment', amount: paise(900000), accountId: bank, description: 'Chicken farm fund', occurredAt: '2026-09-05' });
    const found = searchEntries(db, 'chicken');
    expect(format(found.expense)).toBe('Rs 380.00');
    expect(format(found.income)).toBe('Rs 0.00');
    expect(format(found.net)).toBe('-Rs 380.00');
    expect(found.count).toBe(3); // the investment is listed, just not added up

    const salary = searchEntries(db, 'salary');
    expect(format(salary.income)).toBe('Rs 50,000.00');
    expect(format(salary.net)).toBe('Rs 50,000.00');
  });

  it('shows the leg that left for a move between two own accounts', () => {
    recordTransaction(db, { kind: 'transfer', amount: paise(300000), accountId: bank, toAccountId: cash, description: 'Cash for the week', occurredAt: '2026-09-14' });
    const found = searchEntries(db, 'cash for');
    expect(format(found.days[0].entries[0].amount)).toBe('-Rs 3,000.00');
    expect(format(found.expense)).toBe('Rs 0.00');
  });

  it('adds up what left as transfers and investments apart from spending, once per move', () => {
    recordTransaction(db, { kind: 'transfer', amount: paise(300000), accountId: bank, toAccountId: cash, description: 'Cash for the week', occurredAt: '2026-09-14' });
    recordTransaction(db, { kind: 'investment', amount: paise(90000), accountId: bank, description: 'Weekly fund', occurredAt: '2026-09-15' });
    spend('Weekly tea', 5000, '2026-09-16');
    const found = searchEntries(db, 'week');
    // Cash in hand is still the user's money: the bank leg counts, the cash leg does not add to it.
    expect(format(found.moved)).toBe('Rs 3,900.00');
    expect(format(found.expense)).toBe('Rs 50.00');
    expect(format(searchEntries(db, 'chicken').moved)).toBe('Rs 0.00');
  });

  it('reaches entries far older than the newest page Activity shows', () => {
    spend('Ancient tea', 1500, '2024-01-05');

    // Activity reads one page of the newest entries; the oldest is past the end of it.
    expect(timeline(db, 5).flatMap((d) => d.entries).some((e) => e.merchant === 'Ancient tea')).toBe(false);
    const found = searchEntries(db, 'ancient');
    expect(found.days.flatMap((d) => d.entries.map((e) => e.merchant))).toEqual(['Ancient tea']);
  });

  it('lists the newest when many match, and says how many there really were', () => {
    const found = searchEntries(db, 'chicken', 1);
    expect(found.truncated).toBe(true);
    expect(found.count).toBe(2);
    expect(found.days.flatMap((d) => d.entries.map((e) => e.merchant))).toEqual(['Chicken vala']);
    // The totals still cover everything that matched, not just what is listed.
    expect(format(found.expense)).toBe('Rs 380.00');
  });

  it('treats % and _ as ordinary characters, and nothing as nothing', () => {
    expect(searchEntries(db, '%').count).toBe(0);
    expect(searchEntries(db, 'c_icken').count).toBe(0);
    expect(searchEntries(db, '   ').days).toEqual([]);
  });
});
