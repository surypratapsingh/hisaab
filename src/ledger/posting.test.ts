import { describe, it, expect } from 'vitest';
import { createPostings, validateBalance } from './posting';
import { paise } from '@/money/money';
import { generateId } from '@/lib/ulid';

describe('posting', () => {
  describe('createPostings', () => {
    it('should create balanced postings', () => {
      const accountId1 = generateId();
      const accountId2 = generateId();

      const result = createPostings([
        { accountId: accountId1, amount: paise(1000) },
        { accountId: accountId2, amount: paise(-1000) },
      ]);

      expect(result.isOk()).toBe(true);
      const postings = result.getOrNull();
      expect(postings).toHaveLength(2);
      expect(postings![0].id).toBeDefined();
      expect(postings![1].id).toBeDefined();
    });

    it('should reject unbalanced postings', () => {
      const accountId1 = generateId();
      const accountId2 = generateId();

      const result = createPostings([
        { accountId: accountId1, amount: paise(1000) },
        { accountId: accountId2, amount: paise(-900) },
      ]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('UNBALANCED');
      }
    });

    it('should reject single posting', () => {
      const accountId = generateId();

      const result = createPostings([
        { accountId: accountId, amount: paise(1000) },
      ]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('INSUFFICIENT_POSTINGS');
      }
    });

    it('should reject empty postings', () => {
      const result = createPostings([]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('INSUFFICIENT_POSTINGS');
      }
    });

    it('should create multi-leg postings', () => {
      const acc1 = generateId();
      const acc2 = generateId();
      const acc3 = generateId();

      const result = createPostings([
        { accountId: acc1, amount: paise(1000) },
        { accountId: acc2, amount: paise(-600) },
        { accountId: acc3, amount: paise(-400) },
      ]);

      expect(result.isOk()).toBe(true);
      const postings = result.getOrNull();
      expect(postings).toHaveLength(3);
    });
  });

  describe('validateBalance', () => {
    it('should validate balanced postings', () => {
      const accountId1 = generateId();
      const accountId2 = generateId();

      const postings = [
        { id: generateId(), accountId: accountId1, amount: paise(500) },
        { id: generateId(), accountId: accountId2, amount: paise(-500) },
      ];

      expect(validateBalance(postings)).toBe(true);
    });

    it('should reject unbalanced postings', () => {
      const accountId1 = generateId();
      const accountId2 = generateId();

      const postings = [
        { id: generateId(), accountId: accountId1, amount: paise(500) },
        { id: generateId(), accountId: accountId2, amount: paise(-400) },
      ];

      expect(validateBalance(postings)).toBe(false);
    });

    it('should handle multi-leg validation', () => {
      const acc1 = generateId();
      const acc2 = generateId();
      const acc3 = generateId();

      const postings = [
        { id: generateId(), accountId: acc1, amount: paise(1000) },
        { id: generateId(), accountId: acc2, amount: paise(-600) },
        { id: generateId(), accountId: acc3, amount: paise(-400) },
      ];

      expect(validateBalance(postings)).toBe(true);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle a simple expense', () => {
      const bankAccount = generateId();
      const expenseAccount = generateId();

      const result = createPostings([
        { accountId: bankAccount, amount: paise(-50000) }, // Bank debit
        { accountId: expenseAccount, amount: paise(50000) }, // Expense credit
      ]);

      expect(result.isOk()).toBe(true);
    });

    it('should handle a transfer between accounts', () => {
      const savingsAccount = generateId();
      const checkingAccount = generateId();

      const result = createPostings([
        { accountId: savingsAccount, amount: paise(-200000) }, // Debit savings
        { accountId: checkingAccount, amount: paise(200000) }, // Credit checking
      ]);

      expect(result.isOk()).toBe(true);
    });

    it('should handle a split payment', () => {
      const bankAccount = generateId();
      const groceriesCategory = generateId();
      const transportCategory = generateId();

      const result = createPostings([
        { accountId: bankAccount, amount: paise(-75000) }, // Total spent
        { accountId: groceriesCategory, amount: paise(50000) }, // Groceries portion
        { accountId: transportCategory, amount: paise(25000) }, // Transport portion
      ]);

      expect(result.isOk()).toBe(true);
      const postings = result.getOrNull();
      expect(postings).toHaveLength(3);
    });
  });
});
