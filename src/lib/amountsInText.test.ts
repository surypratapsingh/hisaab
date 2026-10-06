import { describe, it, expect } from 'vitest';
import { format } from '@/money/money';
import { amountsInText, maskAmountsInMessage } from './amountsInText';

const shown = (amount: Parameters<typeof format>[0]) => format(amount).replace('Rs ', '₹').replace(/\.00$/, '');

describe('amountsInText', () => {
  it('rewrites every amount in a sentence', () => {
    expect(
      amountsInText('Chicken now costs Rs 180.00, up 6% on Rs 170.00, since 3 Sep.', shown)
    ).toBe('Chicken now costs ₹180, up 6% on ₹170, since 3 Sep.');
  });

  it('reads Indian digit grouping and keeps paise', () => {
    expect(amountsInText('You spent Rs 5,72,649.50 and Rs 1,234.00.', shown)).toBe(
      'You spent ₹5,72,649.50 and ₹1,234.'
    );
  });

  it('hides amounts when asked to', () => {
    expect(amountsInText('Rent took Rs 12,000.00 on 1 Sep.', () => '₹ • • • • •')).toBe(
      'Rent took ₹ • • • • • on 1 Sep.'
    );
  });

  it('masks any amount in a raw message, however it is written', () => {
    const masked = (text: string) => maskAmountsInMessage(text, '#');
    expect(masked('Rs.6,000 off, just Rs.666/month, or ₹500.00 now, INR 1,200')).toBe('# off, just #/month, or # now, #');
    expect(masked('Ref 526812345678, 100 Mbps, 12+ apps')).toBe('Ref 526812345678, 100 Mbps, 12+ apps');
  });

  it('leaves other numbers alone', () => {
    expect(amountsInText('Up 6% since 3 Sep, 4 purchases.', shown)).toBe('Up 6% since 3 Sep, 4 purchases.');
  });
});
