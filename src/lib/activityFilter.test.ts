import { describe, it, expect } from 'vitest';
import { fitsFilter } from './activityFilter';

describe('Activity filters', () => {
  const salary = { amount: 5000000, kind: 'income' };
  const lunch = { amount: -25000, kind: 'expense' };
  const toSavings = { amount: -1000000, kind: 'transfer' };
  const sip = { amount: -500000, kind: 'investment' };

  it('shows everything under All', () => {
    for (const row of [salary, lunch, toSavings, sip]) expect(fitsFilter(row, 'All')).toBe(true);
  });

  it('keeps income and expense to money actually earned or spent', () => {
    expect(fitsFilter(salary, 'Income')).toBe(true);
    expect(fitsFilter(lunch, 'Income')).toBe(false);
    expect(fitsFilter(lunch, 'Expense')).toBe(true);
    expect(fitsFilter(salary, 'Expense')).toBe(false);
  });

  it('never counts a transfer or an investment as an expense', () => {
    expect(fitsFilter(toSavings, 'Expense')).toBe(false);
    expect(fitsFilter(sip, 'Expense')).toBe(false);
    expect(fitsFilter(toSavings, 'Transfers')).toBe(true);
    expect(fitsFilter(sip, 'Transfers')).toBe(true);
    expect(fitsFilter(lunch, 'Transfers')).toBe(false);
  });

  it('files an entry with no kind by its sign', () => {
    expect(fitsFilter({ amount: 100 }, 'Income')).toBe(true);
    expect(fitsFilter({ amount: -100 }, 'Expense')).toBe(true);
  });
});
