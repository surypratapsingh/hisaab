import { describe, expect, it } from 'vitest';
import { paise } from '@/money/money';
import { readBillText } from './billText';

// Texts in the usual shapes Indian billers send; names and numbers made up.
const TODAY = '2026-09-27';

describe('reading a shared bill text', () => {
  it('reads a telecom postpaid bill', () => {
    const draft = readBillText(
      'Dear Customer, your Airtel bill of Rs 499.00 for 98XXXXXX12 is due on 15-10-2026. Pay now at airtel.in/pay',
      TODAY
    );
    expect(draft).toMatchObject({ biller: 'Airtel', amount: paise(49900), dueDate: '2026-10-15' });
  });

  it('reads an electricity bill with a bill date and a due date', () => {
    const draft = readBillText(
      'BESCOM: Bill dated 02/09/2026 for A/c 1234567 is Rs.1,234.50. Due date 20/09/26. Pay before due date to avoid disconnection.',
      TODAY
    );
    expect(draft).toMatchObject({ biller: 'BESCOM', amount: paise(123450), dueDate: '2026-09-20' });
  });

  it('takes the total and not the minimum due on a credit card statement', () => {
    const draft = readBillText(
      'HDFC Bank Credit Card XX1234 statement: Minimum Amount Due Rs 620.00, Total Amount Due Rs 12,345.67. Payment due by 05-Oct-26.',
      TODAY
    );
    expect(draft).toMatchObject({ biller: 'HDFC credit card', amount: paise(1234567), dueDate: '2026-10-05' });
    // "is" and "dues" hold an s: the words before each amount must still be read whole.
    expect(
      readBillText('SBI Card: minimum amount due is Rs 1,250.00 and total dues are Rs 25,000.00. Pay by 15-Oct-26.', TODAY)
        ?.amount
    ).toBe(paise(2500000));
  });

  it('reads a month name without a year as the next such date', () => {
    const draft = readBillText('Your Tata Play recharge is due on 3rd Oct. Amount payable Rs 350', TODAY);
    expect(draft).toMatchObject({ biller: 'Tata Play', amount: paise(35000), dueDate: '2026-10-03' });
    expect(readBillText('LIC premium of Rs 5,000 due on Jan 10', TODAY)?.dueDate).toBe('2027-01-10');
  });

  it('keeps what it found when a part is missing, and guesses nothing', () => {
    const draft = readBillText('Your electricity bill is due on 12.10.2026.', TODAY);
    expect(draft).toMatchObject({ biller: null, amount: null, dueDate: '2026-10-12' });
  });

  it('leaves out cashback, discounts and amounts already paid', () => {
    const draft = readBillText('Get Rs 50 cashback! Your ACT Fibernet bill amount Rs 1,178 is payable by 18/10/2026.', TODAY);
    expect(draft).toMatchObject({ biller: 'ACT Fibernet', amount: paise(117800) });
  });

  it('refuses a text that is not a bill to pay', () => {
    expect(readBillText('Rs 500 credited to your a/c XX1234 on 12-09-26.', TODAY)).toBeNull();
    expect(readBillText('Hi, are we meeting tomorrow?', TODAY)).toBeNull();
    expect(readBillText('', TODAY)).toBeNull();
  });

  it('never reads an impossible date', () => {
    expect(readBillText('Your bill of Rs 200 is due on 31/02/2027', TODAY)?.dueDate).toBeNull();
  });
});
