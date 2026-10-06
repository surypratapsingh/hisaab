import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { priceStories } from './priceStories';
import { paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

describe('priceStories', () => {
  let db: Database;
  let cash: Id;

  /** `count` purchases of `name` at `rupees`, one every three days from `start`. */
  const buy = (name: string, rupees: number, start: string, count: number, categoryId = 'cat_food') => {
    for (let i = 0; i < count; i++) {
      const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 3 * 86_400_000).toISOString().slice(0, 10);
      recordTransaction(db, {
        kind: 'expense',
        amount: paise(rupees * 100),
        accountId: cash,
        description: name,
        occurredAt: day,
        categoryId: categoryId as Id,
      });
    }
  };

  const today = new Date(2026, 8, 27);

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    cash = db.createAccount({ name: 'Cash', kind: 'asset', subkind: 'cash', isSystem: false }).getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('lists what got dearer, with the prices it went through', () => {
    buy('Chicken', 150, '2025-10-01', 12);
    buy('Chicken', 170, '2026-01-01', 20);
    buy('Chicken', 180, '2026-09-03', 4);

    const [chicken] = priceStories(db, today);
    expect(chicken.name).toBe('Chicken');
    expect(chicken.prices.map((p) => p.amount / 100)).toEqual([150, 170, 180]);
    expect(chicken.prices[2].from).toBe('2026-09-03');
    expect(chicken.changePercent).toBe(20);
  });

  it('says less when it got cheaper, and keeps the most recently bought first', () => {
    buy('Bread', 65, '2026-01-01', 10);
    buy('Bread', 60, '2026-07-01', 5);
    buy('Chicken', 170, '2026-05-01', 10);
    buy('Chicken', 180, '2026-09-03', 4);

    const stories = priceStories(db, today);
    expect(stories.map((s) => s.name)).toEqual(['Chicken', 'Bread']);
    expect(stories[1].changePercent).toBe(-8);
  });

  it('leaves out what has one price, too few purchases, or amounts that only vary', () => {
    buy('Netflix', 199, '2025-10-01', 12);
    buy('Mango', 100, '2026-08-01', 2);
    buy('Mango', 120, '2026-09-01', 2);
    buy('Petrol', 200, '2026-03-01', 4, 'cat_transport');
    buy('Petrol', 300, '2026-05-01', 4, 'cat_transport');
    buy('Petrol', 200, '2026-07-01', 4, 'cat_transport');
    buy('Petrol', 300, '2026-08-15', 4, 'cat_transport');
    expect(priceStories(db, today)).toEqual([]);
  });

  it('leaves out family and savings, and things no longer bought', () => {
    buy('Atul', 10000, '2026-05-01', 6, 'cat_family');
    buy('Atul', 12000, '2026-08-01', 4, 'cat_family');
    buy('Sugar', 40, '2025-01-01', 10);
    buy('Sugar', 45, '2025-06-01', 10);
    expect(priceStories(db, today)).toEqual([]);
  });

  it('ignores bank narrations: only what was typed in counts', () => {
    const notification = db.saveRawRecord({ source: 'notification', payload: '{}' }).getOrNull()!;
    for (let i = 0; i < 10; i++) {
      db.createJournalEntry(
        { occurredAt: `2026-0${1 + (i % 9)}-05`, description: 'Chickenfarm', rawId: notification.id, kind: 'expense', confidence: 1 },
        [
          { accountId: cash, amount: paise(-(i < 5 ? 15000 : 18000)) },
          { accountId: 'acc_unknown_expense' as Id, amount: paise(i < 5 ? 15000 : 18000) },
        ]
      );
    }
    expect(priceStories(db, today)).toEqual([]);
  });
});
