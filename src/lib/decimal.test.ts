import { describe, it, expect } from 'vitest';
import { parseDecimal } from './decimal';

describe('parseDecimal', () => {
  it('scales a plain decimal to an integer', () => {
    expect(parseDecimal('123.45', 2)).toBe(12345);
  });

  it('strips Indian digit grouping', () => {
    expect(parseDecimal('12,34,567.89', 2)).toBe(123456789);
  });

  it('pads a short fraction', () => {
    expect(parseDecimal('1.5', 3)).toBe(1500);
    expect(parseDecimal('7', 2)).toBe(700);
  });

  it('never drifts the way float multiplication does', () => {
    // 0.1 * 100 in floating point is 10.000000000000002.
    expect(parseDecimal('0.1', 2)).toBe(10);
    expect(parseDecimal('1.005', 2)).toBe(101);
  });

  it('rounds extra fraction digits half away from zero', () => {
    expect(parseDecimal('2.344', 2)).toBe(234);
    expect(parseDecimal('2.345', 2)).toBe(235);
    expect(parseDecimal('-2.345', 2)).toBe(-235);
  });

  it('accepts a leading or trailing point', () => {
    expect(parseDecimal('.5', 2)).toBe(50);
    expect(parseDecimal('5.', 2)).toBe(500);
  });

  it('keeps the sign, and never returns negative zero', () => {
    expect(parseDecimal('-12.50', 2)).toBe(-1250);
    expect(parseDecimal('-0', 2)).toBe(0);
  });

  it('rejects anything that is not a plain number', () => {
    expect(parseDecimal('', 2)).toBeNull();
    expect(parseDecimal('abc', 2)).toBeNull();
    expect(parseDecimal('1e5', 2)).toBeNull();
    expect(parseDecimal('1.2.3', 2)).toBeNull();
    expect(parseDecimal('-', 2)).toBeNull();
  });
});
