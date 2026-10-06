import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { entriesCsv } from './search';
import { paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

describe('exporting entries as CSV', () => {
  let db: Database;
  let bank: Id;
  let cash: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db.createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false }).getOrNull()!.id;
    cash = db.createAccount({ name: 'Cash', kind: 'asset', subkind: 'cash', isSystem: false }).getOrNull()!.id;

    recordTransaction(db, { kind: 'income', amount: paise(5000000), accountId: bank, description: 'Salary', occurredAt: '2026-09-01' });
    recordTransaction(db, { kind: 'transfer', amount: paise(200000), accountId: bank, toAccountId: cash, description: 'ATM', occurredAt: '2026-09-02' });
    recordTransaction(db, {
      kind: 'expense', amount: paise(18050), accountId: cash, description: 'Chicken, "fresh"', occurredAt: '2026-09-03', categoryId: 'cat_food' as Id,
    });
    recordTransaction(db, { kind: 'expense', amount: paise(9900), accountId: bank, description: '=HYPERLINK("x")', occurredAt: '2026-09-04' });
  });

  afterEach(() => db.close());

  const lines = (csv: string) => csv.trimEnd().split('\r\n');

  it('writes every entry oldest first, with signed amounts and the accounts it touched', () => {
    const rows = lines(entriesCsv(db));
    expect(rows[0]).toBe('Date,Description,Payee,Category,Type,Account,Amount,Notes');
    expect(rows).toHaveLength(5);
    expect(rows[1]).toMatch(/^2026-09-01,Salary,,[^,]*,income,Bank,50000\.00,$/);
    expect(rows[2]).toMatch(/^2026-09-02,ATM,,[^,]*,transfer,Bank → Cash,-2000\.00,$/);
    expect(rows[3]).toBe('2026-09-03,"Chicken, ""fresh""",,Food & Dining,expense,Cash,-180.50,');
  });

  it('defuses text a spreadsheet would run as a formula', () => {
    const last = lines(entriesCsv(db))[4];
    expect(last.startsWith(`2026-09-04,"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(last).toContain(',-99.00,');
  });

  it('exports only what a search matches', () => {
    const rows = lines(entriesCsv(db, 'chicken'));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('Chicken');
  });
});
