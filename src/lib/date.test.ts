import { describe, it, expect } from 'vitest';
import { datePeriod } from './date';

describe('a statement period in words', () => {
  it.each([
    ['2026-08-01', '2026-08-31', '1 Aug to 31 Aug 2026'],
    ['2025-12-28', '2026-01-03', '28 Dec 2025 to 3 Jan 2026'],
    ['2026-08-05', '2026-08-05', '5 Aug 2026'],
  ])('%s to %s reads "%s"', (from, to, words) => {
    expect(datePeriod(from, to)).toBe(words);
  });
});
