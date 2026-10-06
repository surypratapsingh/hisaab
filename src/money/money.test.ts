import { describe, it, expect } from 'vitest';
import {
  paise,
  fromRupeeString,
  fromRupees,
  toRupees,
  format,
  add,
  subtract,
  multiply,
  divide,
  abs,
  sum,
  isZero,
  isPositive,
  isNegative,
} from './money';

describe('money', () => {
  describe('paise constructor', () => {
    it('should create valid paise amounts', () => {
      const amount = paise(100);
      expect(amount).toBe(100);
    });

    it('should reject non-integer values', () => {
      expect(() => paise(123.45)).toThrow('Non-integer paise');
    });

    it('should accept zero', () => {
      expect(paise(0)).toBe(0);
    });

    it('should accept negative values', () => {
      const amount = paise(-500);
      expect(amount).toBe(-500);
    });
  });

  describe('fromRupeeString', () => {
    it('should parse simple rupee values', () => {
      const amount = fromRupeeString('123.45');
      expect(amount).toBe(12345);
    });

    it('should handle comma-separated values', () => {
      const amount = fromRupeeString('1,234.56');
      expect(amount).toBe(123456);
    });

    it('should handle large values', () => {
      const amount = fromRupeeString('12,34,567.89');
      expect(amount).toBe(123456789);
    });

    it('should handle values without paise', () => {
      const amount = fromRupeeString('1234');
      expect(amount).toBe(123400);
    });

    it('should handle zero', () => {
      const amount = fromRupeeString('0');
      expect(amount).toBe(0);
    });

    it('should reject invalid strings', () => {
      expect(() => fromRupeeString('abc')).toThrow();
    });

    it('should trim whitespace', () => {
      const amount = fromRupeeString('  123.45  ');
      expect(amount).toBe(12345);
    });
  });

  describe('fromRupees', () => {
    it('should convert rupees to paise', () => {
      const amount = fromRupees(100);
      expect(amount).toBe(10000);
    });

    it('should round correctly', () => {
      const amount = fromRupees(100.126);
      expect(amount).toBe(10013);
    });

    it('should handle decimals', () => {
      const amount = fromRupees(100.50);
      expect(amount).toBe(10050);
    });
  });

  describe('toRupees', () => {
    it('should convert paise to rupees', () => {
      const rupees = toRupees(paise(10000));
      expect(rupees).toBe(100);
    });

    it('should handle non-round values', () => {
      const rupees = toRupees(paise(12345));
      expect(rupees).toBe(123.45);
    });
  });

  describe('format', () => {
    it('should format as rupee string', () => {
      const formatted = format(paise(12345));
      expect(formatted).toBe('Rs 123.45');
    });

    it('should handle negative values', () => {
      const formatted = format(paise(-12345));
      expect(formatted).toBe('-Rs 123.45');
    });

    it('should format zero', () => {
      const formatted = format(paise(0));
      expect(formatted).toBe('Rs 0.00');
    });

    it('should format large values with commas', () => {
      const formatted = format(paise(123456789));
      expect(formatted).toContain('Rs 12,34,567.89');
    });
  });

  describe('add', () => {
    it('should add positive values', () => {
      const result = add(paise(100), paise(200));
      expect(result).toBe(300);
    });

    it('should handle zero', () => {
      const result = add(paise(100), paise(0));
      expect(result).toBe(100);
    });

    it('should add negative values', () => {
      const result = add(paise(100), paise(-50));
      expect(result).toBe(50);
    });

    it('should result in zero when canceling out', () => {
      const result = add(paise(100), paise(-100));
      expect(result).toBe(0);
    });
  });

  describe('subtract', () => {
    it('should subtract values', () => {
      const result = subtract(paise(100), paise(30));
      expect(result).toBe(70);
    });

    it('should handle going negative', () => {
      const result = subtract(paise(30), paise(100));
      expect(result).toBe(-70);
    });
  });

  describe('multiply', () => {
    it('should multiply by positive number', () => {
      const result = multiply(paise(100), 3);
      expect(result).toBe(300);
    });

    it('should multiply by zero', () => {
      const result = multiply(paise(100), 0);
      expect(result).toBe(0);
    });

    it('should multiply by decimal', () => {
      const result = multiply(paise(100), 1.5);
      expect(result).toBe(150);
    });

    it('should round correctly', () => {
      const result = multiply(paise(100), 0.15);
      expect(result).toBe(15);
    });
  });

  describe('divide', () => {
    it('should divide evenly', () => {
      const result = divide(paise(300), 3);
      expect(result).toBe(100);
    });

    it('should round on uneven division', () => {
      const result = divide(paise(100), 3);
      expect(result).toBe(33);
    });

    it('should handle division by 1', () => {
      const result = divide(paise(100), 1);
      expect(result).toBe(100);
    });
  });

  describe('abs', () => {
    it('should make negative positive', () => {
      const result = abs(paise(-100));
      expect(result).toBe(100);
    });

    it('should keep positive values the same', () => {
      const result = abs(paise(100));
      expect(result).toBe(100);
    });

    it('should handle zero', () => {
      const result = abs(paise(0));
      expect(result).toBe(0);
    });
  });

  describe('sum', () => {
    it('should sum multiple values', () => {
      const result = sum([paise(100), paise(200), paise(300)]);
      expect(result).toBe(600);
    });

    it('should handle empty array', () => {
      const result = sum([]);
      expect(result).toBe(0);
    });

    it('should sum with negative values', () => {
      const result = sum([paise(100), paise(-50), paise(200)]);
      expect(result).toBe(250);
    });
  });

  describe('predicates', () => {
    it('isZero should return true for zero', () => {
      expect(isZero(paise(0))).toBe(true);
      expect(isZero(paise(100))).toBe(false);
    });

    it('isPositive should return true for positive', () => {
      expect(isPositive(paise(100))).toBe(true);
      expect(isPositive(paise(0))).toBe(false);
      expect(isPositive(paise(-100))).toBe(false);
    });

    it('isNegative should return true for negative', () => {
      expect(isNegative(paise(-100))).toBe(true);
      expect(isNegative(paise(0))).toBe(false);
      expect(isNegative(paise(100))).toBe(false);
    });
  });

  describe('type safety', () => {
    it('should only accept Paise where required', () => {
      const amount = paise(100);
      const result = add(amount, paise(50));

      // This test just verifies the types compile - the real check is TypeScript
      expect(result).toBe(150);
    });
  });

  describe('edge cases', () => {
    it('should handle maximum safe integer for paise', () => {
      const max = paise(Number.MAX_SAFE_INTEGER);
      expect(max).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle minimum safe integer for paise', () => {
      const min = paise(Number.MIN_SAFE_INTEGER);
      expect(min).toBe(Number.MIN_SAFE_INTEGER);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle a typical expense transaction', () => {
      // User spends Rs 450.75 on groceries
      const spent = fromRupeeString('450.75');
      const balance = fromRupees(5000);
      const remaining = subtract(balance, spent);

      expect(format(remaining)).toContain('4,549');
    });

    it('should handle a transfer between accounts', () => {
      const fromAccount = fromRupees(10000);
      const toAccount = fromRupees(5000);
      const transferAmount = fromRupees(2000);

      const newFromBalance = subtract(fromAccount, transferAmount);
      const newToBalance = add(toAccount, transferAmount);

      expect(newFromBalance).toBe(800000);
      expect(newToBalance).toBe(700000);
    });

    it('should handle monthly summary', () => {
      const expenses = [
        fromRupeeString('450.50'),
        fromRupeeString('1200'),
        fromRupeeString('340.25'),
      ];

      const totalExpenses = sum(expenses);
      expect(format(totalExpenses)).toContain('1,990.75');
    });
  });
});
