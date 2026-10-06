import { describe, it, expect } from 'vitest';
import { paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import type { WealthPart } from './repo';
import { asOfLine } from './labels';

const part = (over: Partial<WealthPart>): WealthPart => ({
  accountId: 'acc_1' as Id,
  name: 'x',
  kind: 'bank',
  value: paise(0),
  holdings: [],
  ...over,
});

describe('where a wealth figure comes from', () => {
  it('names the source and date of a fund', () => {
    expect(asOfLine(part({ kind: 'investment', source: 'CAMS', asOf: '2026-09-25' }))).toBe('CAMS · as of 25 Sep');
  });

  it('says a bank balance is a statement figure plus what came after', () => {
    expect(asOfLine(part({ asOf: '2026-09-27' }))).toBe('Statement balance as of 27 Sep, plus what came after');
  });

  it('says so when a balance is unknown, rather than dating a number that is not one', () => {
    expect(asOfLine(part({ unknown: true, asOf: '2026-09-27' }))).toBe('Balance not known yet');
  });

  it('describes cash and hand-kept accounts', () => {
    expect(asOfLine(part({ kind: 'cash' }))).toBe('Cash taken out and not yet spent');
    expect(asOfLine(part({ kind: 'other' }))).toBe('From what you have recorded');
  });
});
