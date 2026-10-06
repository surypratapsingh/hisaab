import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { usualPurchases, usualFor } from './usual';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

describe('usualPurchases', () => {
  let db: Database;
  let cash: Id;

  const spend = (description: string, amount: number, date: string, categoryId?: string) =>
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(amount),
      accountId: cash,
      description,
      occurredAt: date,
      categoryId: categoryId as Id | undefined,
    });

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    cash = db.createAccount({ name: 'Cash', kind: 'asset', subkind: 'cash', isSystem: false }).getOrNull()!.id;

    spend('Chicken', 18000, '2026-09-03', 'cat_food');
    spend('Chicken', 20000, '2026-09-10', 'cat_food');
    spend('chicken', 16000, '2026-09-17', 'cat_groceries');
    spend('Paneer', 12000, '2026-09-05', 'cat_groceries');
  });

  afterEach(() => db.close());

  it('offers the most-bought names that start like the text, with what they cost the last time', () => {
    const [chicken] = usualPurchases(db, 'chi');
    expect(chicken.count).toBe(3);
    expect(format(chicken.latest)).toBe('Rs 160.00'); // the 17th, the most recent
    expect(format(chicken.low)).toBe('Rs 160.00');
    expect(format(chicken.high)).toBe('Rs 200.00');
    expect(chicken.lastDate).toBe('2026-09-17');
  });

  it('follows the price when it moves: chicken that was 170 and is now 180 is still chicken', () => {
    for (const day of ['05', '12', '19']) spend('Peanut butter', 17000, `2026-08-${day}`);
    spend('Peanut butter', 18000, '2026-09-20');

    const [butter] = usualPurchases(db, 'peanut');
    expect(butter.count).toBe(4);
    expect(format(butter.latest)).toBe('Rs 180.00');
    expect(format(butter.low)).toBe('Rs 170.00');
  });

  it('says what it was when the price stepped up: curd 170 for months, now 180', () => {
    for (const day of ['02', '09', '16', '23']) spend('Curd', 17000, `2026-05-${day}`, 'cat_food');
    for (const day of ['02', '09', '16']) spend('Curd', 18000, `2026-08-${day}`, 'cat_food');
    const [curd] = usualPurchases(db, 'cur');
    expect(format(curd.latest)).toBe('Rs 180.00');
    expect(curd.was && format(curd.was.amount)).toBe('Rs 170.00');
    expect(curd.was?.until).toBe('2026-05-23');
  });

  it('gives no "was" for an amount that just varies, like petrol', () => {
    for (const [i, amount] of [20000, 30000, 20000, 30000, 20000, 30000, 20000, 30000].entries()) {
      spend('Petrol', amount, `2026-0${i + 1}-10`, 'cat_transport');
    }
    expect(usualPurchases(db, 'pet')[0].was).toBeUndefined();
  });

  it('gives no "was" for money sent to family, whose amount is a choice and not a price', () => {
    for (const day of ['02', '09', '16']) spend('Atul', 1000000, `2026-05-${day}`, 'cat_family');
    for (const day of ['02', '09', '16']) spend('Atul', 4000000, `2026-08-${day}`, 'cat_family');
    expect(usualPurchases(db, 'atu')[0].was).toBeUndefined();
  });

  it('counts different capitalisations as one thing, filed under its usual category', () => {
    const chicken = usualPurchases(db, 'chi')[0];
    expect(usualPurchases(db, 'chi')).toHaveLength(1);
    expect(chicken.categoryId).toBe('cat_food');
  });

  it('puts the most-bought first', () => {
    expect(usualPurchases(db, 'p').map((u) => u.name)).toEqual([]); // one letter is too little to guess from
    spend('Paneer', 12000, '2026-09-12');
    spend('Paneer', 12000, '2026-09-19');
    spend('Pav', 3000, '2026-09-19');
    expect(usualPurchases(db, 'pa').map((u) => [u.name, u.count])).toEqual([
      ['Paneer', 3],
      ['Pav', 1],
    ]);
  });

  it('finds an exact name, and nothing for one never typed before', () => {
    expect(usualFor(db, 'Chicken')?.count).toBe(3);
    expect(usualFor(db, 'chicken ')?.count).toBe(3);
    expect(usualFor(db, 'Mutton')).toBeUndefined();
  });

  it('ignores bank narrations and money that was not spent', () => {
    const notification = db.saveRawRecord({ source: 'notification', payload: '{}' }).getOrNull()!;
    db.createJournalEntry(
      { occurredAt: '2026-09-20', description: 'Chickenfarm UPI', rawId: notification.id, kind: 'expense', confidence: 1 },
      [
        { accountId: cash, amount: paise(-50000) },
        { accountId: 'acc_unknown_expense' as Id, amount: paise(50000) },
      ]
    );
    recordTransaction(db, { kind: 'income', amount: paise(90000), accountId: cash, description: 'Chicken refund', occurredAt: '2026-09-21' });

    expect(usualPurchases(db, 'chick').map((u) => u.name)).toEqual(['Chicken']);
  });

  it('treats % and _ in what was typed as ordinary characters', () => {
    expect(usualPurchases(db, '%%')).toEqual([]);
    expect(usualPurchases(db, 'c_')).toEqual([]);
  });
});
