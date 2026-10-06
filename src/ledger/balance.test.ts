import { describe, it, expect } from 'vitest';
import { calculateBalance, calculateBalances, netBalance } from './balance';
import { paise } from '@/money/money';
import { generateId } from '@/lib/ulid';
import type { Posting } from '@/db/client';

describe('balance', () => {
  describe('calculateBalance', () => {
    it('should calculate balance for a single account', () => {
      const accountId = generateId();
      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: accountId,
          amount: paise(1000),
        },
      ];

      const balance = calculateBalance(postings);
      expect(balance).toBe(1000);
    });

    it('should handle negative postings', () => {
      const accountId = generateId();
      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: accountId,
          amount: paise(-500),
        },
      ];

      const balance = calculateBalance(postings);
      expect(balance).toBe(-500);
    });

    it('should sum multiple postings for same account', () => {
      const accountId = generateId();
      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: accountId,
          amount: paise(1000),
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: accountId,
          amount: paise(500),
        },
      ];

      const balance = calculateBalance(postings);
      expect(balance).toBe(1500);
    });

    it('should handle mixed positive and negative', () => {
      const accountId = generateId();
      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: accountId,
          amount: paise(2000),
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: accountId,
          amount: paise(-800),
        },
      ];

      const balance = calculateBalance(postings);
      expect(balance).toBe(1200);
    });

    it('should return zero for empty postings', () => {
      const balance = calculateBalance([]);
      expect(balance).toBe(0);
    });
  });

  describe('calculateBalances', () => {
    it('should calculate balances for multiple accounts', () => {
      const acc1 = generateId();
      const acc2 = generateId();

      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: acc1,
          amount: paise(1000),
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: acc2,
          amount: paise(-1000),
        },
      ];

      const balances = calculateBalances(postings);

      expect(balances.get(acc1)).toBe(1000);
      expect(balances.get(acc2)).toBe(-1000);
    });

    it('should accumulate postings per account', () => {
      const acc1 = generateId();
      const acc2 = generateId();

      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: acc1,
          amount: paise(500),
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: acc2,
          amount: paise(300),
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: acc1,
          amount: paise(200),
        },
      ];

      const balances = calculateBalances(postings);

      expect(balances.get(acc1)).toBe(700);
      expect(balances.get(acc2)).toBe(300);
    });

    it('should handle empty postings', () => {
      const balances = calculateBalances([]);
      expect(balances.size).toBe(0);
    });
  });

  describe('netBalance', () => {
    it('should sum all account balances', () => {
      const acc1 = generateId();
      const acc2 = generateId();
      const acc3 = generateId();

      const balances = new Map([
        [acc1, paise(1000)],
        [acc2, paise(2000)],
        [acc3, paise(500)],
      ]);

      const total = netBalance(balances);
      expect(total).toBe(3500);
    });

    it('should handle negative balances', () => {
      const acc1 = generateId();
      const acc2 = generateId();

      const balances = new Map([
        [acc1, paise(5000)],
        [acc2, paise(-2000)],
      ]);

      const total = netBalance(balances);
      expect(total).toBe(3000);
    });

    it('should return zero for empty balances', () => {
      const balances = new Map<any, any>();
      const total = netBalance(balances);
      expect(total).toBe(0);
    });
  });

  describe('real-world scenarios', () => {
    it('should calculate checking account balance after multiple transactions', () => {
      const checkingAccount = generateId();

      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: checkingAccount,
          amount: paise(500000), // Opening balance
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: checkingAccount,
          amount: paise(-50000), // Grocery purchase
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: checkingAccount,
          amount: paise(-15000), // Gas
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: checkingAccount,
          amount: paise(100000), // Salary deposit
        },
      ];

      const balance = calculateBalance(postings);
      expect(balance).toBe(535000);
    });

    it('should track asset and liability balances separately', () => {
      const bankAsset = generateId();
      const creditCardLiability = generateId();

      const postings: Posting[] = [
        {
          id: generateId(),
          entryId: generateId(),
          accountId: bankAsset,
          amount: paise(100000),
        },
        {
          id: generateId(),
          entryId: generateId(),
          accountId: creditCardLiability,
          amount: paise(-50000),
        },
      ];

      const balances = calculateBalances(postings);
      const total = netBalance(balances);

      expect(balances.get(bankAsset)).toBe(100000);
      expect(balances.get(creditCardLiability)).toBe(-50000);
      expect(total).toBe(50000);
    });
  });
});
