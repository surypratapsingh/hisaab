import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { ingestAlert } from '@/capture/ingest';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import { cashAccount, recordTransaction } from './manual';
import { monthSummary } from './views';
import { maybeTwice, sameAsBank, twoPayments } from './doubles';

const SWIGGY = 'Rs.450.00 debited from a/c **1234 on 25-09-26 to VPA swiggy@icici (UPI Ref No 526812345678).';

describe('a bank payment and a typed entry of the same amount', () => {
  let db: Database;
  let typedId: Id;
  let bankId: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    db.createAccount({ name: 'HDFC Savings', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false });
    const recorded = ingestAlert(db, { app: 'com.google.android.apps.messaging', text: SWIGGY, postedAt: '2026-09-25T10:00:00+05:30' });
    bankId = (recorded.getOrNull() as { entryId: Id }).entryId;
    const cash = cashAccount(db).getOrNull()!;
    const typed = (day: string) =>
      recordTransaction(db, {
        kind: 'expense',
        amount: paise(45000),
        accountId: cash.id,
        description: 'Dinner with Ravi',
        occurredAt: day,
        categoryId: 'cat_food' as Id,
      }).getOrNull()!.id;
    typedId = typed('2026-09-26');
    typed('2026-09-30'); // five days later: too far to be the same payment
  });

  afterEach(() => db.close());

  const spent = () => format(monthSummary(db, new Date(2026, 8, 15)).spent);

  it('is offered once, and "Same payment" keeps the bank entry in the user\'s words', () => {
    const pairs = maybeTwice(db);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ bank: { id: bankId, account: 'HDFC Savings' }, typed: { id: typedId, account: 'Cash' } });
    expect(format(pairs[0].amount)).toBe('Rs 450.00');
    expect(spent()).toBe('Rs 1,350.00');

    expect(sameAsBank(db, pairs[0]).isOk()).toBe(true);

    expect(spent()).toBe('Rs 900.00');
    expect(db.getEntry(typedId).getOrNull()).toBeNull();
    expect(db.getEntry(bankId).getOrNull()).toMatchObject({ description: 'Dinner with Ravi', categoryId: 'cat_food', kind: 'expense' });
    expect(maybeTwice(db)).toHaveLength(0);
  });

  it('"Two payments" keeps both and does not ask again', () => {
    expect(twoPayments(db, maybeTwice(db)[0]).isOk()).toBe(true);
    expect(maybeTwice(db)).toHaveLength(0);
    expect(spent()).toBe('Rs 1,350.00');
  });
});
