import { describe, it, expect } from 'vitest';
import { sortMessage } from './sort';
import { format } from '@/money/money';

const msg = (text: string, sender = 'VM-HDFCBK') => ({
  app: 'sms',
  sender,
  text,
  postedAt: '2026-09-26T10:00:00+05:30',
});

describe('sorting messages offline', () => {
  it('finds a real payment', () => {
    const sorted = sortMessage(msg('Rs.450.00 debited from a/c **1234 on 26-09-26 to VPA swiggy@icici (UPI Ref No 626900001111).'));
    expect(sorted.kind).toBe('transaction');
    expect(format(sorted.alert!.amount)).toBe('Rs 450.00');
  });

  it('reads a UPI AutoPay mandate: payee, amount, how often', () => {
    const sorted = sortMessage(
      msg('Your UPI AutoPay mandate for Netflix of Rs 649.00 has been successfully created. Frequency: Monthly. -HDFC Bank')
    );
    expect(sorted.kind).toBe('mandate');
    expect(sorted.mandate).toMatchObject({ payee: 'Netflix', upTo: false, frequency: 'monthly' });
    expect(format(sorted.mandate!.amount!)).toBe('Rs 649.00');
  });

  it('reads an e-mandate with a cap', () => {
    const sorted = sortMessage(
      msg('e-Mandate registered successfully towards BSE STAR MF for NACH debit up to Rs 10,000 as and when presented.', 'AD-ICICIB')
    );
    expect(sorted.kind).toBe('mandate');
    expect(sorted.mandate).toMatchObject({ payee: 'BSE STAR MF', upTo: true, frequency: 'as presented' });
  });

  it('knows an upcoming mandate debit is a reminder, not a payment', () => {
    expect(sortMessage(msg('Rs 649 will be debited on 05-10-26 towards Netflix mandate.')).kind).toBe('reminder');
  });

  it.each([
    ['a KYC link', 'Dear customer your SBI account will be blocked today. Update KYC now http://sbi-kyc.co/x', 'VM-SBIINB'],
    ['a prize', 'Congratulations! You won Rs 25,00,000 in KBC lucky draw. Claim now wa.me/919876543210', 'VK-KBCWIN'],
    ['a bank message from a phone number', 'HDFC Bank: your card is blocked, call this number to verify your account', '+919812345678'],
  ])('flags a scam: %s', (_, text, sender) => {
    expect(sortMessage(msg(text, sender)).kind).toBe('scam');
  });

  it.each([
    ['iPhone discount', 'iPhone discount is LIVE for Airtel users! Save up to Rs. 23,000 at Croma. Hurry, claim now: https://i.airtel.in/croma7 T&C apply.', 'AD-650025-P'],
    ['free premium', 'You got free Adobe Express Premium, worth INR 4000 from Airtel! Claim now-https://i.airtel.in/adobe_express4', 'AD-ARWINF-P'],
  ])('calls a registered promotional sender\'s pushy advert an offer, not a scam: %s', (_, text, sender) => {
    expect(sortMessage(msg(text, sender)).kind).toBe('offer');
  });

  it('still calls a threat from a registered promotional sender a scam', () => {
    const text = 'Dear customer your SBI account will be blocked today. Update KYC now http://sbi-kyc.co/x';
    expect(sortMessage(msg(text, 'VM-SBIINB-P')).kind).toBe('scam');
  });

  it('does not let a promotional header hide a real payment alert', () => {
    const text = 'Rs.450.00 debited from a/c **1234 to VPA swiggy@icici on 26-09-26.';
    expect(sortMessage(msg(text, 'AD-HDFCBK-P')).kind).toBe('transaction');
  });

  it('does not call the bank\'s own alert with a helpline link a scam', () => {
    const sorted = sortMessage(
      msg('Rs.450.00 debited from a/c **1234 to VPA swiggy@icici. Not you? Report at https://hdfc.bank.in/report')
    );
    expect(sorted.kind).toBe('transaction');
  });

  it.each([
    ['otp', '123456 is your OTP for a transaction of Rs 4,999 at AMAZON.'],
    ['offer', 'You are eligible for a pre-approved loan of Rs 5,00,000. Apply now!'],
    ['reminder', 'Your credit card bill of Rs 12,340 is due on 05-10-26.'],
    ['info', 'Your account statement for September is ready.'],
  ])('sorts %s messages', (kind, text) => {
    expect(sortMessage(msg(text)).kind).toBe(kind);
  });
});

describe('real bank autopay wording', () => {
  it('reads an SBI mandate with the payee after "towards"', () => {
    const sorted = sortMessage(
      msg('Your UPI-Mandate for Rs.399.00 is successfully created towards Discovery Communications India from A/c No: XXXXXX0000. -SBI', 'VM-SBIUPI')
    );
    expect(sorted.kind).toBe('mandate');
    expect(sorted.mandate!.payee).toBe('Discovery Communications India');
    expect(format(sorted.mandate!.amount!)).toBe('Rs 399.00');
  });

  it('reads a Union Bank mandate that is taken as and when presented', () => {
    const sorted = sortMessage(
      msg('Dear Customer,UPI AutoPay Mandate with ASPRESENTED is successfully created towards Amazon Ind from 12/05/2026 to 12/05/2031 for Rs.199.00-Union Bank of India', 'VM-UNIONB')
    );
    expect(sorted.mandate).toMatchObject({ payee: 'Amazon Ind', frequency: 'as presented' });
  });

  it('knows a payment taken by an autopay is spending, filed as a subscription', () => {
    const sorted = sortMessage(
      msg('Dear Customer, Your account has  been successfully debited with Rs.398.99 on 28/06/2026 towards Adobe Syst UPI AutoPay-Union Bank of India', 'VM-UNIONB')
    );
    expect(sorted.kind).toBe('transaction');
    expect(sorted.alert).toMatchObject({ autopay: true, counterparty: 'Adobe Syst', direction: 'debit' });
    expect(format(sorted.alert!.amount)).toBe('Rs 398.99');
  });

  it('knows a revoked mandate is a cancellation', () => {
    const sorted = sortMessage(
      msg('Dear Customer, UPI AutoPay Mandate is successfully Revoked towards JioHotstar for Rs.149.00-Union Bank of India', 'VM-UNIONB')
    );
    expect(sorted.kind).toBe('mandate');
    expect(sorted.mandate).toMatchObject({ payee: 'JioHotstar', revoked: true });
  });
});

describe('telecom adverts', () => {
  it('calls a recharge advert an offer, even with a price in it', () => {
    const sorted = sortMessage(
      msg('Your next watch is sorted! Watch new films with Prime, Sony LIV & 20 OTTs + 30GB data. Recharge with Rs. 299 now.', 'JioMart')
    );
    expect(sorted.kind).toBe('offer');
  });

  it('still records a real mobile recharge payment', () => {
    const sorted = sortMessage(
      msg('Rs.299.00 debited from a/c **1234 on 26-09-26 to VPA jio@sbi (UPI Ref No 626900002222).')
    );
    expect(sorted.kind).toBe('transaction');
  });
});

// Formats from a real inbox (names, numbers and references replaced), read on 2026-09-26.
describe('sorting real Union Bank, SBI and fund-house messages', () => {
  it('reads a Union Bank debit written "Rs:80.00", with the payee after "Fvg:"', () => {
    const sorted = sortMessage(
      msg(
        'Union Bank of India A/c *5501 Debited Rs:80.00 on 21-09-2026 18:49:15 by Mob Bk ref no 626400001111, Fvg:    GOPAL Avl Bal Rs:654.32. Not you?Call 18002082244/SMS BLOCK 5501 to 9223008486',
        'JM-UNIONB-T'
      )
    );
    expect(sorted.kind).toBe('transaction');
    expect(sorted.alert).toMatchObject({ direction: 'debit', accountDigits: '5501', counterparty: 'GOPAL' });
    expect(format(sorted.alert!.amount)).toBe('Rs 80.00');
    expect(format(sorted.alert!.balance!)).toBe('Rs 654.32');
  });

  it('does not take the "never share OTP" footer for an OTP', () => {
    const sorted = sortMessage(
      msg('A/c *5501 Credited for Rs:5000.00 on 17-07-2024 09:16:44 by Mob Bk ref no 419900001111 Avl Bal Rs:6000.00.Never Share OTP/PIN/CVV-Union Bank of India', 'JK-UNIONB-S')
    );
    expect(sorted.kind).toBe('transaction');
    expect(sorted.alert!.direction).toBe('credit');
    // A real OTP is still one.
    expect(sortMessage(msg('123456 is your OTP for login. Never share OTP with anyone.')).kind).toBe('otp');
  });

  it('takes the last four of SBI\'s six printed digits', () => {
    const sorted = sortMessage(
      msg('Dear Customer, DBT/Govt. payment of Rs. 2,000.00 credited to your Acc No. XXXXX987702 on 27/07/23 for SAMPLE Scheme-SBI', 'AD-CBSSBI-S')
    );
    expect(sorted.alert!.accountDigits).toBe('7702');
  });

  it('leaves fund-house purchase confirmations to the bank\'s own debit', () => {
    const sorted = sortMessage(
      msg('We confirm receipt of your request for Purchase of Rs.4000.00 in Folio-XXXXXXX1234 under Sample Mid Cap Fund - Direct Plan Growth on 03/09/2026', 'VM-KFINMF-S')
    );
    expect(sorted.kind).toBe('info');
  });

  it('still records a fund redemption credited to the bank account', () => {
    const sorted = sortMessage(
      msg('Your SB A/c *5501 Credited for Rs.102.41 on 06-05-2026 09:33:17 by NEFT/ AXIS MUTUAL FUND RED UTR: AXISCN0000000001 Avl Bal Rs.1,000.00', 'JM-UNIONB-S')
    );
    expect(sorted.kind).toBe('transaction');
  });

  it('treats a shop\'s "we received Rs" as a receipt, not a payment', () => {
    expect(sortMessage(msg('Dear ASHA, Thanks for placing order with Amul. We have received your order of amount INR 3600.0 and it will be processed soon. - AMUL', 'AX-AMULHO-S')).kind).toBe('info');
    expect(sortMessage(msg('You have successfully paid ₹208.73 for your order using your Edition Wallet. -ZOMATO', 'JD-ZOMATO-S')).kind).toBe('info');
  });

  it('flags a personal number "crediting" a bonus with a link', () => {
    const sorted = sortMessage(msg('Congratulations, Your account has been Credited Bonus with Rs.8850 Register now to use rp17.in/J33C8', '+919000012345'));
    expect(sorted.kind).not.toBe('transaction');
  });
});
