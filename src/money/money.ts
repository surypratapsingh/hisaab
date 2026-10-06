import { parseDecimal } from '@/lib/decimal';

export type Paise = number & { readonly __brand: 'Paise' };

export const paise = (n: number): Paise => {
  if (!Number.isInteger(n)) {
    throw new Error(`Non-integer paise: ${n}`);
  }
  return n as Paise;
};

export const fromRupeeString = (s: string): Paise => {
  const value = parseDecimal(s, 2);
  if (value === null) {
    throw new Error(`Invalid rupee string: ${s}`);
  }
  return paise(value);
};

/** "1234.56" — no symbol or grouping, for pre-filling an input. Integer maths only. */
export const toPlainRupees = (p: Paise): string => {
  const sign = p < 0 ? '-' : '';
  const whole = Math.abs(p);
  return `${sign}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, '0')}`;
};

/** Like fromRupeeString, but for user input: null instead of throwing. */
export const tryRupeeString = (s: string): Paise | null => {
  const value = parseDecimal(s, 2);
  return value === null ? null : paise(value);
};

export const fromRupees = (rupees: number): Paise => {
  return paise(Math.round(rupees * 100));
};

export const toRupees = (p: Paise): number => {
  return p / 100;
};

export const format = (p: Paise): string => {
  const rupees = Math.abs(p) / 100;
  const sign = p < 0 ? '-' : '';
  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}Rs ${formatted}`;
};

export const add = (a: Paise, b: Paise): Paise => {
  return paise(a + b);
};

export const subtract = (a: Paise, b: Paise): Paise => {
  return paise(a - b);
};

export const multiply = (p: Paise, multiplier: number): Paise => {
  return paise(Math.round(p * multiplier));
};

export const divide = (p: Paise, divisor: number): Paise => {
  return paise(Math.round(p / divisor));
};

export const abs = (p: Paise): Paise => {
  return paise(Math.abs(p));
};

export const sum = (amounts: Paise[]): Paise => {
  return amounts.reduce((acc, curr) => add(acc, curr), paise(0));
};

/** Whole-percent change from `before` to `value`; undefined when there is nothing before to compare against. */
export const percentChange = (value: Paise, before: Paise): number | undefined =>
  before > 0 ? Math.round(((value - before) / before) * 100) : undefined;

export const isZero = (p: Paise): boolean => {
  return p === 0;
};

export const isPositive = (p: Paise): boolean => {
  return p > 0;
};

export const isNegative = (p: Paise): boolean => {
  return p < 0;
};
