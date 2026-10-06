import { describe, it, expect } from 'vitest';
import { importStatementRows, computeImportSummary } from './pipeline';
import type { ParsedRow } from './types';
import { paise, sum } from '@/money/money';
import { generateId } from '@/lib/ulid';
import type { Account } from '@/db/client';

const mockAccount: Account = {
  id: generateId(),
  name: 'Test Bank',
  kind: 'asset',
  subkind: 'bank',
  isSystem: false,
  createdAt: new Date().toISOString(),
  excluded: false,
};

describe('import pipeline', () => {
  it('should create entries from parsed rows', async () => {
    const rows: ParsedRow[] = [
      { date: '2026-01-01', narration: 'Test transaction', debit: paise(50000) },
      {
        date: '2026-01-02',
        narration: 'Another transaction',
        credit: paise(30000),
      },
    ];

    const result = await importStatementRows(rows, mockAccount);

    expect(result.isOk()).toBe(true);
    expect(result.getOrNull()).toHaveLength(2);
  });

  it('should balance every entry it creates, debit and credit alike', async () => {
    const rows: ParsedRow[] = [
      { date: '2026-01-01', narration: 'Money out', debit: paise(50000) },
      { date: '2026-01-02', narration: 'Money in', credit: paise(30000) },
    ];

    const entries = (await importStatementRows(rows, mockAccount)).getOrNull()!;

    for (const entry of entries) {
      expect(entry.postings).toHaveLength(2);
      expect(sum(entry.postings.map((p) => p.amount))).toBe(0);
    }
  });

  it('should post a debit as negative on the source account', async () => {
    const rows: ParsedRow[] = [
      { date: '2026-01-01', narration: 'Money out', debit: paise(50000) },
    ];

    const entries = (await importStatementRows(rows, mockAccount)).getOrNull()!;
    const sourcePosting = entries[0].postings.find(
      (p) => p.accountId === mockAccount.id
    );

    expect(sourcePosting!.amount).toBe(-50000);
    expect(entries[0].entry.kind).toBe('expense');
  });

  it('should post a credit as positive on the source account', async () => {
    const rows: ParsedRow[] = [
      { date: '2026-01-01', narration: 'Money in', credit: paise(30000) },
    ];

    const entries = (await importStatementRows(rows, mockAccount)).getOrNull()!;
    const sourcePosting = entries[0].postings.find(
      (p) => p.accountId === mockAccount.id
    );

    expect(sourcePosting!.amount).toBe(30000);
    expect(entries[0].entry.kind).toBe('income');
  });

  it('should detect duplicates', async () => {
    const rows: ParsedRow[] = [
      { date: '2026-01-01', narration: 'Duplicate test', debit: paise(50000) },
      { date: '2026-01-01', narration: 'Duplicate test', debit: paise(50000) },
    ];

    const entries = (await importStatementRows(rows, mockAccount)).getOrNull()!;

    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.isDuplicate)).toHaveLength(1);
  });

  it('should compute import summary', async () => {
    const rows: ParsedRow[] = [
      { date: '2026-01-01', narration: 'Transaction 1', debit: paise(50000) },
      { date: '2026-01-01', narration: 'Transaction 1', debit: paise(50000) },
      { date: '2026-01-02', narration: 'Transaction 2', credit: paise(30000) },
    ];

    const entries = (await importStatementRows(rows, mockAccount)).getOrNull()!;
    const summary = computeImportSummary(entries);

    expect(summary.rowsParsed).toBe(3);
    expect(summary.duplicatesSkipped).toBe(1);
    expect(summary.rowsNeedingReview).toBe(2);
  });

  it('should handle empty row list', async () => {
    const result = await importStatementRows([], mockAccount);

    expect(result.isOk()).toBe(true);
    expect(result.getOrNull()).toHaveLength(0);
  });
});
