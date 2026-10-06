import { describe, it, expect } from 'vitest';
import { normalise, extractVPA, extractMerchantName } from './normalise';
import { resolveMerchant } from './merchant';
import { detectTransfer } from './transfer';
import { categorise } from './categorise';
import { detectRecurring } from './recurring';
import { scoreTransaction } from './score';
import { paise } from '@/money/money';

describe('normalise', () => {
  it('should normalize UPI prefixes', () => {
    expect(normalise('UPI/AMAZON@UPI/PURCHASE')).toContain('AMAZON@UPI');
  });

  it('should collapse whitespace', () => {
    expect(normalise('TEST    VALUE')).toBe('TEST VALUE');
  });

  it('should uppercase', () => {
    expect(normalise('test')).toBe('TEST');
  });

  it('should extract VPA from narration', () => {
    const vpa = extractVPA('PAYMENT TO amazon@upi');
    expect(vpa).toBe('amazon@upi');
  });

  it('should extract merchant name', () => {
    const name = extractMerchantName('AMAZON PURCHASE BOOK');
    expect(name).toContain('AMAZON');
  });
});

describe('merchant resolution', () => {
  it('should resolve Amazon by VPA', () => {
    const result = resolveMerchant('PAYMENT amazon@upi/PURCHASE');
    expect(result.merchantName).toBe('Amazon');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('should resolve Netflix by substring', () => {
    const result = resolveMerchant('NETFLIX SUBSCRIPTION CHARGE');
    expect(result.merchantName).toBe('Netflix');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('finds a name only at the start of a word, and CRED only as a whole word', () => {
    expect(resolveMerchant('UPI/BHOLA KIRANA STORE').merchantName).toBeUndefined();
    expect(resolveMerchant('OLA CABS RIDE').merchantName).toBe('Ola Cabs');
    expect(resolveMerchant('SALARY CREDIT FROM EMPLOYER').merchantName).toBeUndefined();
    expect(resolveMerchant('UPI/CRED.CLUB@AXISB/BILL').merchantName).toBe('CRED');
  });

  it('should return unknown for unmatched merchant', () => {
    const result = resolveMerchant('RANDOM MERCHANT XXYZ');
    expect(result.method).toBe('unknown');
    expect(result.confidence).toBe(0);
  });
});

describe('transfer detection', () => {
  it('should detect transfer by keyword', () => {
    const result = detectTransfer('TRANSFER TO OWN ACCOUNT', []);
    expect(result.isTransfer).toBe(true);
  });

  it('should detect transfer by account number', () => {
    const result = detectTransfer('TRANSFER ACCT 1234', [
      { last4: '1234', id: 'acc_1' },
    ]);
    expect(result.isTransfer).toBe(true);
    expect(result.confidence).toBe(1);
  });

  it('should not detect regular purchase as transfer', () => {
    const result = detectTransfer('AMAZON PURCHASE', []);
    expect(result.isTransfer).toBe(false);
  });

  it('should not call a salary credit a transfer', () => {
    // The word "transfer" alone is not evidence the money went to the user's
    // own account. Treating this as a transfer erases it from their income.
    expect(detectTransfer('SALARY TRANSFER FROM EMPLOYER', []).isTransfer).toBe(
      false
    );
  });

  it('should not treat payment rails as transfers on their own', () => {
    // NEFT, IMPS and RTGS say how money moved, not to whom.
    expect(detectTransfer('NEFT/HDFC/RAHUL SHARMA', []).isTransfer).toBe(false);
    expect(detectTransfer('IMPS/P2A/9876543210/LANDLORD', []).isTransfer).toBe(
      false
    );
  });

  it('should not match a four-digit run that is not the account number', () => {
    const result = detectTransfer('POS PURCHASE REF 5678 GROCERY', [
      { last4: '1234', id: 'acc_1' },
    ]);
    expect(result.isTransfer).toBe(false);
  });
});

describe('categorisation', () => {
  it('should categorise Amazon as shopping', () => {
    const result = categorise('Amazon', '');
    expect(result.categoryId).toBe('cat_shopping');
  });

  it('should categorise Netflix as entertainment', () => {
    const result = categorise('Netflix', '');
    expect(result.categoryId).toBe('cat_entertainment');
  });

  it('should categorise Swiggy as food', () => {
    const result = categorise('Swiggy', '');
    expect(result.categoryId).toBe('cat_food');
  });

  it('should return unknown for no match', () => {
    const result = categorise('RandomMerchant', '');
    expect(result.categoryId).toBe('cat_unknown');
  });
});

describe('recurring detection', () => {
  it('should detect monthly subscription', () => {
    const entries = [
      { date: '2026-01-01', merchantName: 'Netflix', amount: paise(99900) },
      { date: '2026-02-01', merchantName: 'Netflix', amount: paise(99900) },
      { date: '2026-03-01', merchantName: 'Netflix', amount: paise(99900) },
    ];

    const patterns = detectRecurring(entries, 2);
    expect(patterns.length).toBeGreaterThan(0);
    const netflix = patterns.find((p) => p.merchantName === 'Netflix');
    expect(netflix?.isRecurring).toBe(true);
    expect(netflix?.interval).toBe('monthly');
  });

  it('should not detect single transaction as recurring', () => {
    const entries = [
      { date: '2026-01-01', merchantName: 'Amazon', amount: paise(50000) },
    ];

    const patterns = detectRecurring(entries, 3);
    expect(patterns.length).toBe(0);
  });
});

describe('scoring', () => {
  it('should score high confidence transaction', () => {
    const score = scoreTransaction(
      false, // not transfer
      true, // merchant resolved
      0.95, // high merchant confidence
      0.9 // high category confidence
    );

    expect(score.overall).toBeGreaterThan(0.7);
    expect(score.shouldReview).toBe(false);
  });

  it('should score low confidence transaction', () => {
    const score = scoreTransaction(
      false, // not transfer
      false, // merchant not resolved
      0, // no merchant
      0.1 // low category confidence
    );

    expect(score.overall).toBeLessThan(0.7);
    expect(score.shouldReview).toBe(true);
  });
});

describe('category keywords match whole words', () => {
  it('does not file a phone recharge as a bank fee', () => {
    expect(categorise(undefined, 'MOBILE RECHARGE').categoryId).not.toBe('cat_fees');
  });

  it('does not see a fee inside coffee', () => {
    expect(categorise(undefined, 'BLUE TOKAI COFFEE').categoryId).not.toBe('cat_fees');
  });

  it('still matches a keyword at the start of a longer word', () => {
    expect(categorise(undefined, 'LOCAL GROCERY SHOP').categoryId).toBe('cat_groceries');
    expect(categorise(undefined, 'ANNUAL CHARGES').categoryId).toBe('cat_fees');
  });
});
