import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectParser } from './parsers';
import { importStatementRows, computeImportSummary } from './pipeline';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { sum, paise, format } from '@/money/money';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';
import type { ParsedRow } from './types';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)),
    'utf8'
  );

const openAccount = (db: Database) => {
  db.initialize();
  const account = db.createAccount({
    name: 'HDFC Savings',
    kind: 'asset',
    subkind: 'bank',
    last4: '1234',
    isSystem: false,
  });
  return account.getOrNull()!;
};

describe('statement to ledger, end to end', () => {
  it('imports a real fixture into a ledger that balances', async () => {
    const text = fixture('hdfc_sample.csv');
    const db = new Database(new NodeSqliteDriver());
    const account = openAccount(db);

    const rows = detectParser(text)!.parse(text).getOrNull()!;
    const entries = (await importStatementRows(rows, account)).getOrNull()!;

    for (const { entry, postings, isDuplicate } of entries) {
      if (isDuplicate) continue;
      const written = db.createJournalEntry(entry, postings);
      expect(written.isOk()).toBe(true);
    }

    expect(db.verifyLedger().getOrNull()).toBe(true);
  });

  it('lands every unexplained rupee in Suspense, never nowhere', async () => {
    const text = fixture('hdfc_sample.csv');
    const db = new Database(new NodeSqliteDriver());
    const account = openAccount(db);

    const rows = detectParser(text)!.parse(text).getOrNull()!;
    const entries = (await importStatementRows(rows, account)).getOrNull()!;

    for (const { entry, postings } of entries) {
      db.createJournalEntry(entry, postings);
    }

    const bankBalance = db.getBalance(account.id).getOrNull()!;
    const suspenseBalance = (
      db.getBalance(SYSTEM_ACCOUNT_IDS.SUSPENSE)
    ).getOrNull()!;

    // Nothing is categorised yet, so Suspense mirrors the account exactly.
    expect(sum([bankBalance, suspenseBalance])).toBe(0);
  });

  it('nets the fixture month to the statement movement', async () => {
    const text = fixture('hdfc_sample.csv');
    const db = new Database(new NodeSqliteDriver());
    const account = openAccount(db);

    const rows = detectParser(text)!.parse(text).getOrNull()!;
    const entries = (await importStatementRows(rows, account)).getOrNull()!;

    for (const { entry, postings } of entries) {
      db.createJournalEntry(entry, postings);
    }

    // The ledger records movement, not the opening balance the bank carried
    // in: 1,50,000.00 credited less 26,300.50 debited across the 12 rows.
    const balance = db.getBalance(account.id).getOrNull()!;
    expect(format(balance)).toBe('Rs 1,23,699.50');
  });

  it('skips duplicates when the same statement is imported twice', async () => {
    const text = fixture('hdfc_sample.csv');
    const db = new Database(new NodeSqliteDriver());
    const account = openAccount(db);

    const rows = detectParser(text)!.parse(text).getOrNull()!;
    const doubled = [...rows, ...rows];

    const entries = (await importStatementRows(doubled, account)).getOrNull()!;
    const summary = computeImportSummary(entries);

    expect(summary.duplicatesSkipped).toBe(rows.length);
    expect(summary.rowsNeedingReview).toBe(rows.length);
  });
});

describe('performance budgets', () => {
  const syntheticRows = (count: number): ParsedRow[] =>
    Array.from({ length: count }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      narration: `UPI/MERCHANT${i}@YBL/TXN${i}`,
      debit: paise(100 + i),
    }));

  it('runs 5,000 rows through the pipeline in under 3 seconds', async () => {
    const db = new Database(new NodeSqliteDriver());
    const account = openAccount(db);
    const rows = syntheticRows(5000);

    const start = performance.now();
    const result = await importStatementRows(rows, account);
    const elapsed = performance.now() - start;

    expect(result.getOrNull()).toHaveLength(5000);
    expect(elapsed).toBeLessThan(3000);
  });

  it('parses 5,000 statement rows in under 8 seconds', () => {
    const header =
      'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description';
    let balance = 500000;
    const lines = [header];

    for (let i = 0; i < 5000; i++) {
      balance -= 1;
      lines.push(
        `2026-01-05,2026-01-05,1.00,,${balance.toFixed(2)},MERCHANT ${i}`
      );
    }

    const start = performance.now();
    const result = detectParser(lines.join('\n'))!.parse(lines.join('\n'));
    const elapsed = performance.now() - start;

    expect(result.getOrNull()).toHaveLength(5000);
    expect(elapsed).toBeLessThan(8000);
  });
});
