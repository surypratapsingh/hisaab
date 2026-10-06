import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { importCas, wealthView, isCas } from './repo';
import { MF_CAS, DEMAT_CAS } from './casFixtures';
import { recordTransaction } from '@/repo/manual';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import { exportLedger, importBackup, deleteAllData, DELETE_CONFIRMATION } from '@/security/backup';

describe('total wealth from CAS statements', () => {
  let db: Database;
  let bankId: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bankId = db
      .createAccount({ name: 'HDFC Savings', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!.id;
    db.recordBalanceAnchor(bankId, '2026-09-20', paise(50000000));
  });

  afterEach(() => db.close());

  const part = (name: string) => wealthView(db).parts.find((p) => p.name === name)!;

  it('knows a CAS from a bank statement', () => {
    expect(isCas(MF_CAS)).toBe(true);
    expect(isCas('Booking Date,Value Date,Debit Amount')).toBe(false);
  });

  it('puts mutual funds in Investments, valued as of the CAS date', () => {
    const result = importCas(db, MF_CAS, 'cas.pdf').getOrNull()!;
    expect(result).toMatchObject({ kind: 'mutual_fund', asOf: '2026-09-25', holdings: 2 });
    expect(format(result.total)).toBe('Rs 1,05,567.40');

    const investments = part('Investments');
    expect(format(investments.value)).toBe('Rs 1,05,567.40');
    expect(investments.asOf).toBe('2026-09-25');
    expect(investments.source).toBe('CAMS + KFintech CAS');
    expect(investments.holdings[0].name).toMatch(/^Parag Parikh/);
    expect(format(investments.holdings[0].gain!)).toBe('Rs 13,405.37');
  });

  it('adds a SIP made after the CAS on top of it', () => {
    importCas(db, MF_CAS, 'cas.pdf');
    recordTransaction(db, {
      kind: 'investment',
      amount: paise(500000),
      accountId: bankId,
      description: 'SIP',
      occurredAt: '2026-10-05',
    });
    expect(format(part('Investments').value)).toBe('Rs 1,10,567.40');
  });

  it('puts demat holdings in their own account and adds everything up', () => {
    importCas(db, MF_CAS, 'mf.pdf');
    importCas(db, DEMAT_CAS, 'nsdl.pdf');

    const stocks = part('Stocks & bonds');
    expect(format(stocks.value)).toBe('Rs 68,461.25');
    expect(stocks.holdings).toHaveLength(3);

    // Rs 5,00,000 in the bank + Rs 1,05,567.40 funds + Rs 68,461.25 demat.
    expect(format(wealthView(db).total)).toBe('Rs 6,74,028.65');
    expect(wealthView(db).parts.map((p) => p.kind)).toEqual(['investment', 'investment', 'bank']);
  });

  it('refuses the same CAS twice and keeps an older one from replacing a newer value', () => {
    importCas(db, MF_CAS, 'cas.pdf');
    const again = importCas(db, MF_CAS, 'cas-copy.pdf');
    expect(again.isErr() && again.error.code).toBe('ALREADY_IMPORTED');

    const older = MF_CAS.replaceAll('25-Sep-2026', '25-Jun-2026').replace('95,405.37', '90,000.00');
    importCas(db, older, 'june.pdf');
    expect(part('Investments').asOf).toBe('2026-09-25');
    expect(format(part('Investments').value)).toBe('Rs 1,05,567.40');
  });

  it('keeps the document and says why when it is not a CAS', () => {
    const result = importCas(db, 'Dear customer, thanks for banking with us.', 'letter.pdf');
    expect(result.isErr() && result.error.code).toBe('NOT_A_CAS');
    const [raw] = db.getRawRecords().getOrNull()!;
    expect(raw.parseError).toMatch(/not look like a CAS/);
  });

  it('survives a backup and restore', () => {
    importCas(db, MF_CAS, 'cas.pdf');
    const backup = exportLedger(db).getOrNull()!;

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    expect(importBackup(fresh, backup.data).isOk()).toBe(true);
    const restored = wealthView(fresh).parts.find((p) => p.name === 'Investments')!;
    expect(format(restored.value)).toBe('Rs 1,05,567.40');
    expect(restored.holdings).toHaveLength(2);

    expect(deleteAllData(fresh, DELETE_CONFIRMATION).isOk()).toBe(true);
    fresh.close();
  });
});

describe('a bank account whose balance was never told', () => {
  it('is left out of total wealth until the balance is known', async () => {
    const { setBalanceNow } = await import('@/repo/manual');
    const { paise } = await import('@/money/money');
    const db = new Database(new NodeSqliteDriver());
    db.initialize();
    const sbi = db.createAccount({ name: 'SBI', kind: 'asset', subkind: 'bank', last4: '7702', isSystem: false }).getOrNull()!;
    db.createJournalEntry(
      { occurredAt: '2023-07-27', description: 'Rent', kind: 'expense', confidence: 1 },
      [
        { accountId: sbi.id, amount: paise(-423898) },
        { accountId: 'acc_unknown_expense' as never, amount: paise(423898) },
      ]
    );

    const before = wealthView(db);
    expect(before.parts.find((p) => p.accountId === sbi.id)!.unknown).toBe(true);
    expect(before.total).toBe(paise(0));

    setBalanceNow(db, sbi.id, paise(1250000), '2026-09-26');
    expect(wealthView(db).total).toBe(paise(1250000));
    db.close();
  });
});
