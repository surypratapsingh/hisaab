import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { parseBill } from './bill';
import { billMatches, saveBill } from './repo';
import { recordTransaction, cashAccount } from '@/repo/manual';
import { listProducts } from '@/inventory/repo';
import { monthSummary } from '@/repo/views';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

const LINES = [
  'FRESH MART',
  'Date: 26/09/2026',
  'Amul Paneer 200g 1 90.00 90.00',
  'Bread Brown 400g 2 x 45.00 90.00',
  'Grand Total 180.00',
];

describe('saving a bill', () => {
  let db: Database;
  let bankId: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bankId = db
      .createAccount({ name: 'HDFC Savings', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('finds the payment the bill belongs to', () => {
    const paid = recordTransaction(db, {
      kind: 'expense',
      amount: paise(18000),
      accountId: bankId,
      description: 'UPI-FRESHMART',
      occurredAt: '2026-09-27',
    }).getOrNull()!;
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(18000),
      accountId: bankId,
      description: 'Too long ago',
      occurredAt: '2026-09-10',
    });

    const matches = billMatches(db, parseBill(LINES));
    expect(matches.map((m) => m.entryId)).toEqual([paid.id]);
    expect(matches[0].account).toBe('HDFC Savings');
  });

  it('itemises a matched payment without spending it twice', () => {
    const paid = recordTransaction(db, {
      kind: 'expense',
      amount: paise(18000),
      accountId: bankId,
      description: 'UPI-FRESHMART',
      occurredAt: '2026-09-26',
    }).getOrNull()!;
    const bill = parseBill(LINES);

    const saved = saveBill(db, { bill, text: LINES.join('\n'), sourceRef: 'photo.jpg', entryId: paid.id, items: bill.items });
    expect(saved.getOrNull()).toEqual({ entryId: paid.id, purchases: 2 });

    const products = listProducts(db);
    expect(products.map((p) => p.name).sort()).toEqual(['Amul Paneer 200g', 'Bread Brown 400g']);
    expect(format(monthSummary(db, new Date(2026, 8, 15)).spent)).toBe('Rs 180.00');
    expect(db.getRawRecords().getOrNull()!.some((r) => r.source === 'receipt')).toBe(true);
  });

  it('refuses the same bill a second time, so its items are not counted twice', () => {
    const cash = cashAccount(db).getOrNull()!;
    const bill = parseBill(LINES);
    const input = { bill, text: LINES.join('\n'), sourceRef: 'photo.jpg', recordFrom: cash.id, items: bill.items };
    expect(saveBill(db, input).isOk()).toBe(true);

    const again = saveBill(db, input);
    expect(again.isErr() && again.error.code).toBe('SAVED');
    expect(format(monthSummary(db, new Date(2026, 8, 15)).spent)).toBe('Rs 180.00');
    expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM purchases').getOrNull()![0].n).toBe(2);
  });

  it('records a cash bill as an expense from Cash', () => {
    const cash = cashAccount(db).getOrNull()!;
    const bill = parseBill(LINES);
    const saved = saveBill(db, { bill, text: 'x', sourceRef: 'photo.jpg', recordFrom: cash.id, items: bill.items });

    expect(saved.isOk()).toBe(true);
    expect(format(monthSummary(db, new Date(2026, 8, 15)).spent)).toBe('Rs 180.00');
  });

  it('refuses items that add up to more than the bill', () => {
    const bill = parseBill(LINES);
    const saved = saveBill(db, {
      bill,
      text: 'x',
      sourceRef: 'photo.jpg',
      items: [...bill.items, { name: 'Extra', amount: paise(100) }],
    });
    expect(saved.isErr() && saved.error.code).toBe('TOO_MUCH');
  });
});
