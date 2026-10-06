import { describe, it, expect } from 'vitest';
import { parseAlert, type CapturedAlert } from './alerts';
import { format } from '@/money/money';

const sms = (text: string, app = 'com.google.android.apps.messaging'): CapturedAlert => ({
  app,
  text,
  postedAt: '2026-09-25T10:00:00+05:30',
});

describe('reading bank and UPI alerts', () => {
  it('reads an HDFC UPI debit', () => {
    const found = parseAlert(
      sms('Rs.450.00 debited from a/c **1234 on 25-09-26 to VPA swiggy@icici (UPI Ref No 526812345678). Not you? Call 18002586161')
    )!;
    expect(format(found.amount)).toBe('Rs 450.00');
    expect(found.direction).toBe('debit');
    expect(found.accountDigits).toBe('1234');
    expect(found.counterparty).toBe('swiggy@icici');
    expect(found.reference).toBe('526812345678');
    expect(found.cashWithdrawal).toBe(false);
  });

  it('reads an HDFC "Sent" alert', () => {
    const found = parseAlert(
      sms('Sent Rs.1,250.00 From HDFC Bank A/C *1234 To ZEPTO MARKETPLACE On 25/09/26 Ref 526899999999 Not You? Call 18002586161')
    )!;
    expect(format(found.amount)).toBe('Rs 1,250.00');
    expect(found.direction).toBe('debit');
    expect(found.accountDigits).toBe('1234');
    expect(found.counterparty).toBe('ZEPTO MARKETPLACE');
  });

  it('reads an SBI UPI debit', () => {
    const found = parseAlert(
      sms('Dear UPI user A/C X5678 debited by 299.0 on date 25Sep26 trf to NETFLIX Refno 526811112222. If not u? call 1800111109. -SBI')
    )!;
    // SBI leaves out the currency sign on UPI debits.
    expect(format(found.amount)).toBe('Rs 299.00');
    expect(found.direction).toBe('debit');
    expect(found.accountDigits).toBe('5678');
    expect(found.counterparty).toBe('NETFLIX');
    expect(found.reference).toBe('526811112222');
  });

  it('reads an ICICI debit where the payee is "credited" later in the text', () => {
    const found = parseAlert(
      sms('ICICI Bank Acct XX789 debited for Rs 2,000.00 on 25-Sep-26; RAMESH KUMAR credited. UPI:526833334444. Call 18002662 for dispute.')
    )!;
    expect(found.direction).toBe('debit');
    expect(found.accountDigits).toBe('789');
    expect(found.counterparty).toBe('RAMESH KUMAR');
  });

  it('reads a salary credit with the available balance', () => {
    const found = parseAlert(
      sms('Rs 75,000.00 credited to a/c XX1234 on 01-10-26 by NEFT ACME CORP PVT LTD. Avl Bal Rs 5,48,901.00')
    )!;
    expect(found.direction).toBe('credit');
    expect(format(found.amount)).toBe('Rs 75,000.00');
    expect(format(found.balance!)).toBe('Rs 5,48,901.00');
    expect(found.counterparty).toBe('NEFT ACME CORP PVT LTD');
  });

  it('flags an ATM withdrawal so the app can ask where the cash went', () => {
    const found = parseAlert(
      sms('Rs.5000 withdrawn at ATM S1AB1234 from A/c XX1234 on 25SEP26. Avl bal Rs.4,95,000.00')
    )!;
    expect(found.direction).toBe('debit');
    expect(found.cashWithdrawal).toBe(true);
    expect(format(found.amount)).toBe('Rs 5,000.00');
  });

  it('reads a card purchase', () => {
    const found = parseAlert(
      sms('Rs.3,499.00 spent on HDFC Bank Card x9876 at AMAZON on 2026-09-25:18:22:10. Avl Lmt: Rs.96,501.00')
    )!;
    expect(found.direction).toBe('debit');
    expect(found.accountDigits).toBe('9876');
    expect(found.counterparty).toBe('AMAZON');
  });

  it('reads Google Pay and PhonePe app notifications', () => {
    const gpay = parseAlert({ ...sms('₹450 paid to Swiggy', 'com.google.android.apps.nbu.paisa.user') })!;
    expect(format(gpay.amount)).toBe('Rs 450.00');
    expect(gpay.direction).toBe('debit');
    expect(gpay.counterparty).toBe('Swiggy');

    const phonepe = parseAlert({
      ...sms('Received ₹1,000 from Rahul Sharma', 'com.phonepe.app'),
    })!;
    expect(phonepe.direction).toBe('credit');
    expect(phonepe.counterparty).toBe('Rahul Sharma');
  });

  it.each([
    ['an OTP', '123456 is your OTP for a transaction of Rs 4,999 at AMAZON. Do not share.'],
    ['an offer', 'You are eligible for a pre-approved loan of Rs 5,00,000. Apply now!'],
    ['a reminder', 'Your credit card bill of Rs 12,340 is due on 05-10-26.'],
    ['a future mandate debit', 'Rs 5,000 will be debited on 05-10-26 towards SIP mandate.'],
    ['a failed payment', 'Your payment of Rs 450 to SWIGGY has failed. Amount will be refunded if debited.'],
    ['a collect request', 'RAHUL has requested money Rs 500 on Google Pay.'],
    ['no amount at all', 'Your account statement for September is ready.'],
  ])('ignores %s', (_, text) => {
    expect(parseAlert(sms(text))).toBeNull();
  });
});
