import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectParser } from './index';
import { format } from '@/money/money';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../test/fixtures/${name}`, import.meta.url)),
    'utf8'
  );

const cases = [
  { file: 'hdfc_sample.csv', bank: 'HDFC', rows: 12 },
  { file: 'sbi_sample.csv', bank: 'SBI', rows: 8 },
  { file: 'icici_sample.csv', bank: 'ICICI', rows: 8 },
];

describe.each(cases)('$file', ({ file, bank, rows }) => {
  const text = fixture(file);

  it('routes to the right parser', () => {
    expect(detectParser(text)?.bank).toBe(bank);
  });

  it('parses every row and reconciles the balance walk', () => {
    const result = detectParser(text)!.parse(text);

    expect(result.isOk()).toBe(true);
    expect(result.getOrNull()).toHaveLength(rows);
  });

  it('gives every row an ISO date and a signed amount', () => {
    const parsed = detectParser(text)!.parse(text).getOrNull()!;

    for (const row of parsed) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.debit ?? row.credit).toBeDefined();
      expect(Number.isInteger(row.debit ?? row.credit)).toBe(true);
    }
  });

  it('refuses the import when a row is removed', () => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    // Drop a middle row: the running balance can no longer reconcile.
    const tampered = [...lines.slice(0, 2), ...lines.slice(3)].join('\n');

    const result = detectParser(tampered)!.parse(tampered);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('BALANCE_CHECK_FAILED');
    }
  });
});

describe('ICICI fixture specifics', () => {
  const text = fixture('icici_sample.csv');

  it('preserves a quoted narration containing a comma', () => {
    const parsed = detectParser(text)!.parse(text).getOrNull()!;
    const zomato = parsed.find((r) => r.narration.includes('ZOMATO'));

    expect(zomato!.narration).toBe('UPI/ZOMATO@UPI/ORDER, DINNER');
  });

  it('reads the refund as a credit, not a debit', () => {
    const parsed = detectParser(text)!.parse(text).getOrNull()!;
    const refund = parsed.find((r) => r.narration.includes('REFUND'));

    expect(refund!.credit).toBe(189900);
    expect(refund!.debit).toBeUndefined();
    expect(format(refund!.credit!)).toBe('Rs 1,899.00');
  });
});
