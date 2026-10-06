import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from './manual';
import { importStatement } from './import';
import { monthSummary, accountsWithBalances, recentEntries, reviewCards } from './views';
import { paise, format } from '@/money/money';
import type { Id } from '@/lib/ulid';

const HDFC_HEADER =
  'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description';

const SEPT = new Date(2026, 8, 15);

let db: Database;
let bank: Account;

beforeEach(() => {
  db = new Database(new NodeSqliteDriver());
  db.initialize();
  bank = db
    .createAccount({ name: 'HDFC Savings', kind: 'asset', last4: '1234', isSystem: false })
    .getOrNull()!;
});

afterEach(() => db.close());

const salary = (date = '2026-09-01', amount = 7500000) =>
  recordTransaction(db, {
    kind: 'income',
    amount: paise(amount),
    accountId: bank.id,
    description: 'September salary',
    occurredAt: date,
  });

describe('recording by hand', () => {
  it('records a salary as income, filed under Salary', () => {
    const entry = salary().getOrNull()!;

    expect(entry.categoryId).toBe('cat_salary');
    expect(format(monthSummary(db, SEPT).received)).toBe('Rs 75,000.00');
    expect(format(db.getBalance(bank.id).getOrNull()!)).toBe('Rs 75,000.00');
  });

  it('does not ask the user to review what they typed themselves', () => {
    salary();
    expect(reviewCards(db)).toHaveLength(0);
  });

  it('records an expense as spending', () => {
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(120000),
      accountId: bank.id,
      description: 'Rent share',
      occurredAt: '2026-09-05',
      categoryId: 'cat_utilities' as Id,
    });

    expect(format(monthSummary(db, SEPT).spent)).toBe('Rs 1,200.00');
  });

  it('keeps what was typed as a raw record', () => {
    salary();
    const [raw] = db.getRawRecords().getOrNull()!;

    expect(raw.source).toBe('manual');
    expect(raw.payload).toContain('September salary');
  });

  it('balances every entry it writes', () => {
    salary();
    recordTransaction(db, {
      kind: 'investment',
      amount: paise(1000000),
      accountId: bank.id,
      description: 'Index fund SIP',
      occurredAt: '2026-09-05',
    });

    expect(db.verifyLedger().getOrNull()).toBe(true);
  });

  it('refuses nothing, blanks and system accounts', () => {
    const base = {
      kind: 'expense' as const,
      amount: paise(100),
      accountId: bank.id,
      description: 'Tea',
      occurredAt: '2026-09-05',
    };

    expect(recordTransaction(db, { ...base, amount: paise(0) }).isErr()).toBe(true);
    expect(recordTransaction(db, { ...base, description: '  ' }).isErr()).toBe(true);
    expect(recordTransaction(db, { ...base, accountId: 'acc_suspense' as Id }).isErr()).toBe(true);
    expect(recordTransaction(db, { ...base, occurredAt: 'today' }).isErr()).toBe(true);
  });
});

describe('investing', () => {
  const invest = (amount = 1000000) =>
    recordTransaction(db, {
      kind: 'investment',
      amount: paise(amount),
      accountId: bank.id,
      description: 'Index fund SIP',
      occurredAt: '2026-09-05',
    });

  it('moves money into an Investments account rather than spending it', () => {
    salary();
    invest();

    const summary = monthSummary(db, SEPT);
    expect(format(summary.spent)).toBe('Rs 0.00');
    expect(format(summary.received)).toBe('Rs 75,000.00');

    const investments = accountsWithBalances(db).find((a) => a.name === 'Investments')!;
    expect(format(investments.balance)).toBe('Rs 10,000.00');
  });

  it('leaves net worth unchanged, because the money is still yours', () => {
    salary();
    const before = db.netWorth().getOrNull()!.net;
    invest();
    expect(db.netWorth().getOrNull()!.net).toBe(before);
  });

  it('reuses the same Investments account every time', () => {
    invest();
    invest(500000);

    const investmentAccounts = accountsWithBalances(db).filter((a) => a.name === 'Investments');
    expect(investmentAccounts).toHaveLength(1);
    expect(format(investmentAccounts[0].balance)).toBe('Rs 15,000.00');
  });

  it('shows the money leaving the bank, not a net zero', () => {
    invest();
    expect(format(recentEntries(db)[0].amount)).toBe('-Rs 10,000.00');
  });
});

describe('a typed-in entry meeting its statement row', () => {
  const statement = (rows: string[]) =>
    importStatement(db, {
      text: [HDFC_HEADER, ...rows].join('\n'),
      sourceRef: 'sept.csv',
      source: 'statement_csv',
      account: bank,
    });

  const salaryRow = '2026-09-02,2026-09-02,,75000.00,175000.00,NEFT/ACME CORP/SALARY SEP';

  it('is absorbed rather than counted twice', () => {
    salary('2026-09-01');
    const result = statement([salaryRow]).getOrNull()!;

    expect(result.rowsParsed).toBe(0);
    expect(result.duplicatesSkipped).toBe(1);
    expect(format(monthSummary(db, SEPT).received)).toBe('Rs 75,000.00');
  });

  it('keeps the description the user wrote', () => {
    salary('2026-09-01');
    statement([salaryRow]);

    expect(db.getEntries().getOrNull()![0].description).toBe('September salary');
  });

  it('still adds nothing when the same statement is imported again', () => {
    salary('2026-09-01');
    statement([salaryRow]);
    const again = statement([salaryRow]).getOrNull()!;

    expect(again.rowsParsed).toBe(0);
    expect(format(monthSummary(db, SEPT).received)).toBe('Rs 75,000.00');
  });

  it('absorbs only one row, so a second real credit is kept', () => {
    salary('2026-09-01');
    statement([
      salaryRow,
      '2026-09-03,2026-09-03,,75000.00,250000.00,NEFT/ACME CORP/ARREARS',
    ]);

    expect(format(monthSummary(db, SEPT).received)).toBe('Rs 1,50,000.00');
  });

  it('ignores a statement row too far from the typed date', () => {
    salary('2026-09-01');
    statement(['2026-09-10,2026-09-10,,75000.00,175000.00,NEFT/ACME CORP/SALARY SEP']);

    expect(format(monthSummary(db, SEPT).received)).toBe('Rs 1,50,000.00');
  });

  it('ignores a statement row for a different amount', () => {
    salary('2026-09-01');
    statement(['2026-09-02,2026-09-02,,74999.00,174999.00,NEFT/ACME CORP/SALARY SEP']);

    expect(format(monthSummary(db, SEPT).received)).toBe('Rs 1,49,999.00');
  });
});

describe('moving money between your own accounts', () => {
  const wallet = () =>
    db.createAccount({ name: 'Cash', kind: 'asset', subkind: 'cash', isSystem: false }).getOrNull()!;

  const move = (toAccountId: Id | undefined, amount = 200000, description = '') =>
    recordTransaction(db, {
      kind: 'transfer',
      amount: paise(amount),
      accountId: bank.id,
      toAccountId,
      description,
      occurredAt: '2026-09-10',
    });

  it('moves the money and changes neither spending nor income', () => {
    salary();
    const cash = wallet();
    const entry = move(cash.id).getOrNull()!;

    expect(entry.kind).toBe('transfer');
    const balances = new Map(accountsWithBalances(db).map((a) => [a.name, format(a.balance)]));
    expect(balances.get('HDFC Savings')).toBe('Rs 73,000.00');
    expect(balances.get('Cash')).toBe('Rs 2,000.00');

    const month = monthSummary(db, SEPT);
    expect(format(month.spent)).toBe('Rs 0.00');
    expect(format(month.received)).toBe('Rs 75,000.00');
    expect(db.verifyLedger().isOk()).toBe(true);
  });

  it('describes itself when nothing is typed, and keeps what was', () => {
    const cash = wallet();
    expect(db.getEntry(move(cash.id).getOrNull()!.id).getOrNull()!.description).toBe('Transfer to Cash');
    expect(db.getEntry(move(cash.id, 100, 'ATM top-up').getOrNull()!.id).getOrNull()!.description).toBe('ATM top-up');
  });

  it('needs a different, real account of the user\'s to move it to', () => {
    expect(move(undefined).isErr()).toBe(true);
    expect(move(bank.id).isErr()).toBe(true);
    expect(move('acc_suspense' as Id).isErr()).toBe(true);
    expect(db.getEntries().getOrNull()).toHaveLength(0);
  });
});
