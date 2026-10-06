import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { classify, dropNamesFoundInsideWords, importStatement, replayRawRecord, statementImports } from './import';
import { importedEntries } from './search';
import { recordTransaction } from './manual';
import {
  monthSummary,
  topCategories,
  recentEntries,
  timeline,
  accountsWithBalances,
  reviewCards,
  recategorise,
  weeklyHealth,
} from './views';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)),
    'utf8'
  );

const HDFC_HEADER =
  'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description';

const statement = (rows: string[]): string => [HDFC_HEADER, ...rows].join('\n');

describe('import service', () => {
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

  const runImport = (text: string) =>
    importStatement(db, {
      text,
      sourceRef: 'test.csv',
      source: 'statement_csv',
      account,
    });

  it('takes CRED off an entry named for CREDIT, and only that one', () => {
    runImport(
      statement([
        '2026-01-05,2026-01-05,,50000.00,550000.00,SALARY CREDIT FROM EMPLOYER',
        '2026-01-06,2026-01-06,2500.00,,547500.00,UPI/CRED.CLUB@AXISB/BILL',
        '2026-01-07,2026-01-07,,300.00,547800.00,Mob Bk',
      ])
    );
    const entries = db.getEntries().getOrNull()!;
    const byText = (text: string) => entries.find((e) => e.description === text)!;
    const cred = byText('UPI/CRED.CLUB@AXISB/BILL').merchantId!;
    // As the old rule named them: CRED inside CREDIT, and a name a statement row gave.
    db.updateEntry(byText('SALARY CREDIT FROM EMPLOYER').id, { merchantId: cred });
    db.updateEntry(byText('Mob Bk').id, { merchantId: cred });

    expect(dropNamesFoundInsideWords(db)).toBe(1);
    const merchantOf = (text: string) => db.getEntry(byText(text).id).getOrNull()!.merchantId;
    expect(merchantOf('SALARY CREDIT FROM EMPLOYER')).toBeUndefined();
    expect(merchantOf('UPI/CRED.CLUB@AXISB/BILL')).toBe(cred);
    expect(merchantOf('Mob Bk')).toBe(cred);
    expect(dropNamesFoundInsideWords(db)).toBe(0);
  });

  it('never files interest paid in under Fees & Charges', () => {
    expect(classify(db, 'SB INTEREST CREDITED', false, [], [])).toMatchObject({ merchantId: undefined, categoryId: undefined });
    expect(classify(db, 'INTEREST CHARGED ON OVERDRAFT', true, [], [])?.categoryId).toBe('cat_fees');
  });

  it('stores the raw text before anything is parsed from it', () => {
    runImport(fixture('hdfc_sample.csv'));

    const rows = db
      .getEntries({ limit: 1 })
      .getOrNull()!
      .map((e) => e.rawId);
    const raw = db.getRawRecord(rows[0]!).getOrNull()!;

    expect(raw.payload).toContain('Booking Date');
    expect(raw.parser).toBe('hdfc_savings_csv_v1');
    expect(raw.parsedAt).toBeTruthy();
  });

  it('keeps the raw text even when no parser recognises it', () => {
    const result = importStatement(db, {
      text: 'Some unrelated document',
      sourceRef: 'mystery.txt',
      source: 'statement_csv',
      account,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NO_PARSER');

    const [stored] = db.getRawRecords().getOrNull()!;
    expect(stored.payload).toBe('Some unrelated document');
    expect(stored.parseError).toContain('No parser');
  });

  it('records the failing line when the balance walk breaks', () => {
    const result = runImport(
      statement([
        '2026-01-05,2026-01-05,,50000.00,500000.00,SALARY',
        '2026-01-06,2026-01-06,2500.00,,499000.00,AMAZON PURCHASE',
      ])
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('PARSE_FAILED');
      expect(result.error.rowNumber).toBe(3);
    }
  });

  it('creates a balanced ledger from a real fixture', () => {
    const result = runImport(fixture('hdfc_sample.csv'));

    expect(result.isOk()).toBe(true);
    expect(result.getOrNull()!.rowsParsed).toBe(12);
    expect(db.verifyLedger().getOrNull()).toBe(true);
  });

  it('resolves a known merchant and files it under a category', () => {
    runImport(
      statement([
        '2026-01-05,2026-01-05,2500.00,,497500.00,UPI/NETFLIX SUBSCRIPTION',
      ])
    );

    const entry = db.getEntries().getOrNull()![0];
    const merchant = db.getMerchant(entry.merchantId!).getOrNull()!;

    expect(merchant.canonical).toBe('Netflix');
    expect(entry.categoryId).toBe('cat_entertainment');
    expect(entry.confidence).toBeGreaterThan(0.7);
  });

  it('sends a narration nobody claimed to Suspense', () => {
    runImport(
      statement(['2026-01-05,2026-01-05,1500.00,,498500.00,QRSTUV WXYZ 99182'])
    );

    const entry = db.getEntries().getOrNull()![0];
    const postings = db.getPostings(entry.id).getOrNull()!;

    expect(entry.merchantId).toBeUndefined();
    expect(postings.some((p) => p.accountId === SYSTEM_ACCOUNT_IDS.SUSPENSE)).toBe(
      true
    );
  });

  it('shows the raw narration when no merchant was matched', () => {
    runImport(
      statement(['2026-01-05,2026-01-05,1500.00,,498500.00,QRSTUV WXYZ 99182'])
    );

    expect(recentEntries(db)[0].merchant).toBe('QRSTUV WXYZ 99182');
  });

  it('adds nothing when the same statement is imported twice', () => {
    const text = fixture('hdfc_sample.csv');

    const first = runImport(text).getOrNull()!;
    const second = runImport(text).getOrNull()!;

    expect(first.rowsParsed).toBe(12);
    expect(second.rowsParsed).toBe(0);
    expect(second.duplicatesSkipped).toBe(12);
    expect(db.getEntries({ limit: 500 }).getOrNull()).toHaveLength(12);
  });

  it('replays stored text without the user re-uploading', () => {
    runImport(fixture('hdfc_sample.csv'));
    const rawId = db.getEntries().getOrNull()![0].rawId!;

    db.run(`DELETE FROM journal_entries`, []);
    expect(db.getEntries().getOrNull()).toHaveLength(0);

    const replayed = replayRawRecord(db, rawId, account);

    expect(replayed.isOk()).toBe(true);
    expect(replayed.getOrNull()!.rowsParsed).toBe(12);
  });

  it('says which account, which dates and what closing balance an import covered', () => {
    const result = runImport(fixture('hdfc_sample.csv')).getOrNull()!;

    expect(result).toMatchObject({ accountId: account.id, from: '2026-01-05', to: '2026-02-01' });
    expect(format(result.closingBalance!)).toBe('Rs 5,73,699.50');
    expect(db.getRawRecords().getOrNull()!.map((r) => r.id)).toContain(result.rawId);
  });

  it('lists each import once, with what it brought in, and can list exactly those entries', () => {
    // Typed in by hand first: the statement claims it rather than adding a second one.
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(75000),
      accountId: account.id,
      description: 'Coffee',
      occurredAt: '2026-01-18',
    });
    const first = runImport(fixture('hdfc_sample.csv')).getOrNull()!;
    runImport(fixture('hdfc_sample.csv'));

    const imports = statementImports(db);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({
      rawId: first.rawId,
      fileName: 'test.csv',
      account: 'HDFC Savings •••• 1234',
      from: '2026-01-05',
      to: '2026-02-01',
      entries: 12,
    });

    const listed = importedEntries(db, first.rawId!);
    expect(listed.count).toBe(12);
    const names = listed.days.flatMap((d) => d.entries.map((e) => e.merchant));
    expect(names).toContain('Coffee');
  });
});

describe('transfers never count as spending', () => {
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

  it('leaves a transfer out of the month total', () => {
    importStatement(db, {
      text: statement([
        '2026-01-05,2026-01-05,50000.00,,450000.00,NEFT TRANSFER TO SELF 5678',
        '2026-01-06,2026-01-06,2500.00,,447500.00,AMAZON PURCHASE',
      ]),
      sourceRef: 'test.csv',
      source: 'statement_csv',
      account,
      ownAccounts: [{ last4: '5678', id: 'acc_other' }],
    });

    const entries = db.getEntries().getOrNull()!;
    expect(entries.some((e) => e.kind === 'transfer')).toBe(true);

    // 50,000 moved between the user's own accounts; only the 2,500 was spent.
    const summary = monthSummary(db, new Date('2026-01-15'));
    expect(format(summary.spent)).toBe('Rs 2,500.00');
  });
});

describe('the correction loop', () => {
  let db: Database;
  let account: Account;

  const importNarration = (narration: string, count = 1) => {
    const rows: string[] = [];
    let balance = 500000;
    for (let i = 0; i < count; i++) {
      balance -= 100;
      rows.push(
        `2026-01-${String(i + 1).padStart(2, '0')},2026-01-${String(i + 1).padStart(2, '0')},100.00,,${balance.toFixed(2)},${narration}`
      );
    }
    return importStatement(db, {
      text: statement(rows),
      sourceRef: 'test.csv',
      source: 'statement_csv',
      account,
    });
  };

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    account = db
      .createAccount({ name: 'Bank', kind: 'asset', isSystem: false })
      .getOrNull()!;
  });

  afterEach(() => db.close());

  it('fixes just the one entry by default', () => {
    importNarration('QRSTUV WXYZ 99182', 3);
    const entries = db.getEntries().getOrNull()!;

    const result = recategorise(db, {
      entryId: entries[0].id,
      categoryId: 'cat_food' as Id,
    });

    expect(result.getOrNull()!.updated).toBe(1);
    expect(db.getEntry(entries[0].id).getOrNull()!.categoryId).toBe('cat_food');
    expect(db.getEntry(entries[1].id).getOrNull()!.categoryId).toBeUndefined();
  });

  it('backfills every past entry from the same merchant', () => {
    importNarration('QRSTUV WXYZ 99182', 3);
    const entries = db.getEntries().getOrNull()!;

    const result = recategorise(db, {
      entryId: entries[0].id,
      categoryId: 'cat_food' as Id,
      applyToAll: true,
    });

    expect(result.isOk()).toBe(true);
    for (const entry of db.getEntries().getOrNull()!) {
      expect(entry.categoryId).toBe('cat_food');
      expect(entry.confidence).toBe(1);
    }
  });

  it('remembers the correction so the next import matches it', () => {
    importNarration('QRSTUV WXYZ 99182', 1);
    const first = db.getEntries().getOrNull()![0];

    expect(first.merchantId).toBeUndefined();

    recategorise(db, {
      entryId: first.id,
      categoryId: 'cat_food' as Id,
      applyToAll: true,
    });

    // A different date, so it is a new row rather than a duplicate.
    importStatement(db, {
      text: statement([
        '2026-06-09,2026-06-09,100.00,,499900.00,QRSTUV WXYZ 99182',
      ]),
      sourceRef: 'later.csv',
      source: 'statement_csv',
      account,
    });

    const latest = db
      .getEntries()
      .getOrNull()!
      .find((e) => e.occurredAt === '2026-06-09')!;

    expect(latest.merchantId).toBeDefined();
    expect(latest.categoryId).toBe('cat_food');
    expect(latest.confidence).toBeGreaterThan(0.7);
  });

  it('credits the pattern that matched', () => {
    importNarration('QRSTUV WXYZ 99182', 1);
    const entry = db.getEntries().getOrNull()![0];

    recategorise(db, {
      entryId: entry.id,
      categoryId: 'cat_food' as Id,
      applyToAll: true,
    });

    importStatement(db, {
      text: statement([
        '2026-06-09,2026-06-09,100.00,,499900.00,QRSTUV WXYZ 99182',
      ]),
      sourceRef: 'later.csv',
      source: 'statement_csv',
      account,
    });

    const patterns = db.getPatterns().getOrNull()!;
    expect(patterns[0].hits).toBeGreaterThan(0);
    expect(patterns[0].source).toBe('user');
  });

  it('refuses to correct an entry that does not exist', () => {
    const result = recategorise(db, {
      entryId: 'nope' as Id,
      categoryId: 'cat_food' as Id,
    });

    expect(result.isErr()).toBe(true);
  });
});

describe('screen views', () => {
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
        institution: 'HDFC',
        last4: '1234',
        isSystem: false,
      })
      .getOrNull()!;

    importStatement(db, {
      text: fixture('hdfc_sample.csv'),
      sourceRef: 'hdfc_sample.csv',
      source: 'statement_csv',
      account,
    });
  });

  afterEach(() => db.close());

  it('summarises the month from the ledger', () => {
    const summary = monthSummary(db, new Date('2026-01-15'));

    expect(format(summary.spent)).toBe('Rs 25,300.50');
    expect(format(summary.received)).toBe('Rs 1,50,000.00');
    expect(format(summary.net)).toBe('Rs 1,24,699.50');
  });

  it('ranks categories to a hundred percent or less', () => {
    const categories = topCategories(db, new Date('2026-01-15'));

    expect(categories.length).toBeGreaterThan(0);
    const total = categories.reduce((acc, c) => acc + c.percentage, 0);
    expect(total).toBeLessThanOrEqual(101);
  });

  it('groups the timeline by day with a running day total', () => {
    const days = timeline(db);

    expect(days.length).toBeGreaterThan(0);
    for (const day of days) {
      const dayTotal = day.entries.reduce((acc, e) => acc + e.amount, 0);
      expect(day.dayTotal).toBe(dayTotal);
    }
  });

  it('lists accounts with their balances and hides system accounts', () => {
    const accounts = accountsWithBalances(db);

    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('HDFC Savings');
    expect(accounts[0].institution).toBe('HDFC');
    // The bank's closing balance on the statement, not just the movements
    // imported (which would read Rs 1,23,699.50 and leave out what was already
    // in the account).
    expect(format(accounts[0].balance)).toBe('Rs 5,73,699.50');
  });

  it('offers alternatives that exclude the current guess', () => {
    const cards = reviewCards(db);

    for (const card of cards) {
      expect(card.alternatives).not.toContain(card.bestGuess);
      expect(card.narration.length).toBeGreaterThan(0);
    }
  });

  it('reports the three weekly numbers', () => {
    const health = weeklyHealth(db);

    expect(health.suspenseRatio).toBeGreaterThanOrEqual(0);
    expect(health.suspenseRatio).toBeLessThanOrEqual(1);
    expect(health.unmatchedNarrations).toBeGreaterThanOrEqual(0);
    expect(health.reviewQueue).toBeGreaterThanOrEqual(0);
  });
});

describe('net worth', () => {
  it('is assets less liabilities', () => {
    const db = new Database(new NodeSqliteDriver());
    db.initialize();

    const bank = db
      .createAccount({ name: 'Bank', kind: 'asset', isSystem: false })
      .getOrNull()!;
    const card = db
      .createAccount({
        name: 'Credit card',
        kind: 'liability',
        subkind: 'credit_card',
        isSystem: false,
      })
      .getOrNull()!;

    const entry = {
      occurredAt: '2026-01-01',
      description: 'Opening',
      kind: 'income' as const,
      confidence: 1,
    };

    db.createJournalEntry(entry, [
      { accountId: bank.id, amount: paise(50000000) },
      { accountId: SYSTEM_ACCOUNT_IDS.OPENING_BALANCE, amount: paise(-50000000) },
    ]);
    db.createJournalEntry(entry, [
      { accountId: card.id, amount: paise(-1845000) },
      { accountId: SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE, amount: paise(1845000) },
    ]);

    const worth = db.netWorth().getOrNull()!;

    expect(format(worth.assets)).toBe('Rs 5,00,000.00');
    expect(format(worth.liabilities)).toBe('-Rs 18,450.00');
    expect(format(worth.net)).toBe('Rs 4,81,550.00');

    db.close();
  });
});
