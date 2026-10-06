import { describe, it, expect } from 'vitest';
import { parseUpi, upiLink, upiAnswer, categoryForMerchantCode } from './link';
import { paise } from '@/money/money';

const read = (text: string) => parseUpi(text);
const refused = (text: string): string => {
  const result = read(text);
  expect(result.isErr()).toBe(true);
  return result.isErr() ? result.error : '';
};

describe('parseUpi', () => {
  it('reads a bill\'s code with the amount printed on it', () => {
    const result = read(
      'upi://pay?pa=abcshop@okhdfcbank&pn=ABC%20Restaurant&am=450.00&cu=INR&tn=Bill%2012&tr=INV123&mc=5812'
    );
    expect(result.getOrNull()).toEqual({
      vpa: 'abcshop@okhdfcbank',
      name: 'ABC Restaurant',
      amount: paise(45000),
      reference: 'INV123',
      note: 'Bill 12',
      merchantCode: '5812',
    });
  });

  it('reads a shop\'s standing code, which has no amount', () => {
    const request = read('upi://pay?pa=milkman@ybl&pn=Ram%20Dairy&cu=INR').getOrNull();
    expect(request?.vpa).toBe('milkman@ybl');
    expect(request?.amount).toBeUndefined();
  });

  it('treats an amount of nothing or zero as no amount', () => {
    expect(read('upi://pay?pa=a1@ybl&pn=X&am=').getOrNull()?.amount).toBeUndefined();
    expect(read('upi://pay?pa=a1@ybl&pn=X&am=0').getOrNull()?.amount).toBeUndefined();
    expect(read('upi://pay?pa=a1@ybl&pn=X&am=0.00').getOrNull()?.amount).toBeUndefined();
  });

  it('reads whole and one-decimal amounts exactly', () => {
    expect(read('upi://pay?pa=a1@ybl&am=25').getOrNull()?.amount).toBe(2500);
    expect(read('upi://pay?pa=a1@ybl&am=25.5').getOrNull()?.amount).toBe(2550);
    expect(read('upi://pay?pa=a1@ybl&am=0.05').getOrNull()?.amount).toBe(5);
  });

  it('accepts a capitalised scheme and address, and lower-cases the address', () => {
    expect(read('UPI://PAY?PA=Shop.Name@OkAxis&PN=Shop').getOrNull()?.vpa).toBe('shop.name@okaxis');
  });

  it('refuses anything that is not a payment', () => {
    expect(refused('upi://collect?pa=a1@ybl&am=500')).toMatch(/not a payment/);
    expect(refused('upi://mandate?pa=a1@ybl&am=500')).toMatch(/not a payment/);
    expect(refused('https://example.com/pay?pa=a1@ybl')).toMatch(/not a UPI payment code/);
    expect(refused('hello')).toMatch(/not a UPI payment code/);
    expect(refused('')).toMatch(/not a UPI payment code/);
    expect(refused(`upi://pay?pa=a1@ybl&tn=${'x'.repeat(2100)}`)).toMatch(/not a UPI payment code/);
  });

  it('refuses a field that appears twice, since two apps could read it two ways', () => {
    expect(refused('upi://pay?pa=good@ybl&pa=evil@ybl&am=10')).toMatch(/repeats/);
    expect(refused('upi://pay?pa=good@ybl&am=10&am=9999')).toMatch(/repeats/);
  });

  it('refuses a missing or malformed address', () => {
    expect(refused('upi://pay?pn=Shop&am=10')).toMatch(/no valid UPI address/);
    expect(refused('upi://pay?pa=nohandle&am=10')).toMatch(/no valid UPI address/);
    expect(refused('upi://pay?pa=a%20b@ybl&am=10')).toMatch(/no valid UPI address/);
    expect(refused('upi://pay?pa=@ybl&am=10')).toMatch(/no valid UPI address/);
    expect(refused('upi://pay?pa=a1@&am=10')).toMatch(/no valid UPI address/);
    expect(refused('upi://pay?pa=a1@ybl@evil&am=10')).toMatch(/no valid UPI address/);
  });

  it('refuses amounts that are not plain rupees and paise, or that look wrong', () => {
    expect(refused('upi://pay?pa=a1@ybl&am=1e3')).toMatch(/cannot be read/);
    expect(refused('upi://pay?pa=a1@ybl&am=-5')).toMatch(/cannot be read/);
    expect(refused('upi://pay?pa=a1@ybl&am=12.345')).toMatch(/cannot be read/);
    expect(refused('upi://pay?pa=a1@ybl&am=1,000')).toMatch(/cannot be read/);
    expect(refused('upi://pay?pa=a1@ybl&am=99999999999')).toMatch(/cannot be read/);
    expect(refused('upi://pay?pa=a1@ybl&am=999999999')).toMatch(/looks wrong/);
    expect(read('upi://pay?pa=a1@ybl&am=500000.00').isOk()).toBe(true);
    expect(refused('upi://pay?pa=a1@ybl&am=500000.01')).toMatch(/looks wrong/);
  });

  it('refuses another currency', () => {
    expect(refused('upi://pay?pa=a1@ybl&am=10&cu=USD')).toMatch(/rupees/);
    expect(read('upi://pay?pa=a1@ybl&am=10&cu=inr').isOk()).toBe(true);
  });

  it('refuses text that does not decode', () => {
    expect(refused('upi://pay?pa=a1@ybl&pn=%E0%A4%A')).toMatch(/damaged/);
  });

  it('makes names and notes safe to show: one line, no control or direction-flipping characters', () => {
    const request = read(
      `upi://pay?pa=a1@ybl&pn=${encodeURIComponent('Shop\n‮evil‬   Name')}&tn=${encodeURIComponent('a\tb')}`
    ).getOrNull();
    expect(request?.name).toBe('Shop evil Name');
    expect(request?.note).toBe('a b');
  });

  it('caps the length of names, notes and references', () => {
    const request = read(
      `upi://pay?pa=a1@ybl&pn=${'n'.repeat(300)}&tn=${'t'.repeat(300)}&tr=${'r'.repeat(300)}`
    ).getOrNull();
    expect(request?.name).toHaveLength(99);
    expect(request?.note).toHaveLength(80);
    expect(request?.reference).toHaveLength(35);
  });

  it('keeps a merchant code only when it is four digits', () => {
    expect(read('upi://pay?pa=a1@ybl&mc=5812').getOrNull()?.merchantCode).toBe('5812');
    expect(read('upi://pay?pa=a1@ybl&mc=58').getOrNull()?.merchantCode).toBeUndefined();
    expect(read('upi://pay?pa=a1@ybl&mc=abcd').getOrNull()?.merchantCode).toBeUndefined();
  });
});

describe('upiLink', () => {
  const request = parseUpi('upi://pay?pa=abcshop@okhdfcbank&pn=ABC%20Restaurant&tn=Bill%2012&tr=INV123&mc=5812').getOrNull()!;

  it('builds the link from what was read, with the amount the payer confirmed', () => {
    expect(upiLink(request, paise(45000))).toBe(
      'upi://pay?pa=abcshop%40okhdfcbank&pn=ABC%20Restaurant&am=450.00&cu=INR&tn=Bill%2012&tr=INV123&mc=5812'
    );
  });

  it('writes paise without going through a float', () => {
    expect(upiLink(request, paise(5))).toContain('am=0.05');
    expect(upiLink(request, paise(100))).toContain('am=1.00');
    expect(upiLink(request, paise(1999999))).toContain('am=19999.99');
  });

  it('reads back as the same request with the confirmed amount', () => {
    const again = parseUpi(upiLink(request, paise(45000))).getOrNull();
    expect(again).toEqual({ ...request, amount: paise(45000) });
  });

  it('cannot be made to carry another payee by a name that looks like a field', () => {
    const tricky = parseUpi(
      `upi://pay?pa=good@ybl&pn=${encodeURIComponent('Shop&pa=evil@ybl&am=1')}`
    ).getOrNull()!;
    const link = upiLink(tricky, paise(1000));
    expect(link.match(/[?&]pa=/g)).toHaveLength(1);
    const again = parseUpi(link).getOrNull();
    expect(again?.vpa).toBe('good@ybl');
    expect(again?.amount).toBe(1000);
    expect(again?.name).toBe('Shop&pa=evil@ybl&am=1');
  });
});

describe('upiAnswer', () => {
  it('reads the status a UPI app reports as it closes', () => {
    expect(upiAnswer('txnId=AXI123&responseCode=00&Status=SUCCESS&txnRef=T1')).toBe('success');
    expect(upiAnswer('txnId=AXI123&responseCode=ZM&Status=FAILURE')).toBe('failure');
    expect(upiAnswer('Status=FAILED')).toBe('failure');
    expect(upiAnswer('txnId=AXI123&Status=SUBMITTED')).toBe('pending');
    expect(upiAnswer('status=success')).toBe('success');
  });

  it('says nothing when the app said nothing, or something else', () => {
    expect(upiAnswer('')).toBeUndefined();
    expect(upiAnswer('txnId=AXI123&responseCode=00')).toBeUndefined();
    expect(upiAnswer('Status=SOMETHINGELSE')).toBeUndefined();
    expect(upiAnswer('notStatus=SUCCESS')).toBeUndefined();
  });
});

describe('categoryForMerchantCode', () => {
  it('names a category only for kinds of shop that are beyond doubt', () => {
    expect(categoryForMerchantCode('5812')).toBe('cat_food');
    expect(categoryForMerchantCode('5411')).toBe('cat_groceries');
    expect(categoryForMerchantCode('5541')).toBe('cat_transport');
    expect(categoryForMerchantCode('5999')).toBeUndefined();
    expect(categoryForMerchantCode(undefined)).toBeUndefined();
  });
});
