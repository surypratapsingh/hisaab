import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { importStatement } from './import';
import { monthSummary, recategorise, accountsWithBalances } from './views';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';

const HDFC_HEADER =
  'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description';

const statement = (rows: string[]): string => [HDFC_HEADER, ...rows].join('\n');

const JANUARY = new Date(2026, 0, 15);

describe('investments in a statement', () => {
  let db: Database;
  let account: Account;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    account = db
      .createAccount({
        name: 'HDFC Savings',
        kind: 'asset',
        subkind: 'bank',
        last4: '1234',
        isSystem: false,
      })
      .getOrNull()!;
  });

  afterEach(() => db.close());

  const runImport = (rows: string[]) =>
    importStatement(db, {
      text: statement(rows),
      sourceRef: 'test.csv',
      source: 'statement_csv',
      account,
    }).getOrNull()!;

  const entryFor = (narration: string) =>
    db.getEntries({ search: narration }).getOrNull()![0];

  const legAccounts = (entryId: Id) =>
    db.getPostings(entryId).getOrNull()!.map((p) => p.accountId);

  it('moves a SIP debit into Investments instead of counting it as spending', () => {
    runImport([
      '2026-01-05,2026-01-05,,50000.00,550000.00,SALARY ACME CORP',
      '2026-01-07,2026-01-07,5000.00,,545000.00,ACH D- BSE LTD ICCL-MF-12345678',
      '2026-01-09,2026-01-09,1200.00,,543800.00,SWIGGY ORDER 4451',
    ]);

    const sip = entryFor('ICCL');
    const queue = db.getReviewQueue(0.7, 100).getOrNull()!.map((e) => e.id);
    expect(queue).not.toContain(sip.id);
    expect(sip.kind).toBe('investment');
    expect(sip.categoryId).toBe('cat_investment');

    const summary = monthSummary(db, JANUARY);
    expect(format(summary.spent)).toBe('Rs 1,200.00');
    expect(format(summary.received)).toBe('Rs 50,000.00');

    const investments = accountsWithBalances(db).find((a) => a.name === 'Investments');
    expect(format(investments!.balance)).toBe('Rs 5,000.00');
  });

  it('keeps money in the family: net worth does not drop when a SIP goes out', () => {
    runImport([
      '2026-01-05,2026-01-05,,50000.00,550000.00,SALARY ACME CORP',
      '2026-01-07,2026-01-07,5000.00,,545000.00,SIP HDFC MID CAP OPP FUND',
    ]);

    const total = accountsWithBalances(db).reduce((sum, a) => sum + a.balance, 0);
    expect(format(paise(total))).toBe('Rs 5,50,000.00');
  });

  it('does not create an Investments account for a statement without any', () => {
    runImport(['2026-01-09,2026-01-09,1200.00,,498800.00,SWIGGY ORDER 4451']);
    expect(accountsWithBalances(db).map((a) => a.name)).not.toContain('Investments');
  });

  it('files an entry under Investment when the user says so, and learns it', () => {
    runImport([
      '2026-01-07,2026-01-07,3000.00,,497000.00,QWERTY WEALTH 7781',
    ]);
    const first = entryFor('QWERTY');
    expect(first.kind).toBe('expense');
    expect(legAccounts(first.id)).toContain(SYSTEM_ACCOUNT_IDS.SUSPENSE);

    recategorise(db, {
      entryId: first.id,
      categoryId: 'cat_investment' as Id,
      applyToAll: true,
    });

    const corrected = db.getEntry(first.id).getOrNull()!;
    expect(corrected.kind).toBe('investment');
    expect(legAccounts(first.id)).not.toContain(SYSTEM_ACCOUNT_IDS.SUSPENSE);
    expect(format(monthSummary(db, JANUARY).spent)).toBe('Rs 0.00');

    // Next month's statement: the merchant is now known to be an investment.
    runImport([
      '2026-01-07,2026-01-07,3000.00,,497000.00,QWERTY WEALTH 7781',
      '2026-02-07,2026-02-07,3000.00,,494000.00,QWERTY WEALTH 7781',
    ]);
    const february = db
      .getEntries({ search: 'QWERTY' })
      .getOrNull()!
      .filter((e) => e.occurredAt.startsWith('2026-02'));
    expect(february).toHaveLength(1);
    expect(february[0].kind).toBe('investment');
    expect(db.verifyLedger().isOk()).toBe(true);
  });

  it('puts an investment back into spending if the user changes their mind', () => {
    runImport(['2026-01-07,2026-01-07,5000.00,,495000.00,SIP HDFC MID CAP OPP FUND']);
    const sip = entryFor('SIP');

    recategorise(db, { entryId: sip.id, categoryId: 'cat_shopping' as Id });

    expect(db.getEntry(sip.id).getOrNull()!.kind).toBe('expense');
    expect(legAccounts(sip.id)).toContain(SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE);
    expect(format(monthSummary(db, JANUARY).spent)).toBe('Rs 5,000.00');
  });

  it('takes a corrected entry out of Suspense, so the unexplained share falls', () => {
    runImport(['2026-01-07,2026-01-07,1500.00,,498500.00,QRSTUV WXYZ 99182']);
    const before = db.suspenseRatio(SYSTEM_ACCOUNT_IDS.SUSPENSE).getOrNull()!;
    expect(before).toBeGreaterThan(0);

    recategorise(db, { entryId: entryFor('QRSTUV').id, categoryId: 'cat_food' as Id });

    expect(db.suspenseRatio(SYSTEM_ACCOUNT_IDS.SUSPENSE).getOrNull()).toBe(0);
    expect(db.verifyLedger().isOk()).toBe(true);
  });
});
