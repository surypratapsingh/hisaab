import { parseDecimal } from '@/lib/decimal';
import { shownFileName } from '@/lib/fileName';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

/**
 * What a UPI payment code (the QR on a shop's counter, or a payment link) asks for, as far as its
 * text can say. Nothing here is verified: the code is whatever whoever printed it put there, so
 * the screen shows the payee for the payer to check, and the UPI app has the final say.
 */
export type UpiRequest = {
  /** The payee's UPI address, e.g. "abcshop@okbank", lower-cased. */
  vpa: string;
  /** The name the payee registered; shown, never trusted. */
  name?: string;
  /** Fixed on a bill's code; absent on a shop's standing code, where the payer types it. */
  amount?: Paise;
  /** The shop's own reference (an order or invoice number). */
  reference?: string;
  note?: string;
  /** The four-digit merchant category the payee registered, a hint at what kind of shop. */
  merchantCode?: string;
};

/** More than this is a mistyped or tampered code, not a payment anyone scans at a counter. */
export const MAX_UPI_AMOUNT = paise(500_000_00);

const MAX_LENGTH = 2000;
const VPA = /^[a-z0-9][a-z0-9._-]{0,255}@[a-z][a-z0-9.-]{1,63}$/;
const PLAIN_AMOUNT = /^\d{1,9}(?:\.\d{1,2})?$/;

const fail = (message: string): Result<never, string> => err(message);

/**
 * Reads the text of a scanned code. Only `upi://pay` is a payment: a collect request (which asks
 * the payer's app to send money on someone else's say-so), a mandate, or any other text is refused
 * in plain words. A field that appears twice is refused too, because two apps could read it two ways.
 */
export const parseUpi = (text: string): Result<UpiRequest, string> => {
  const raw = text.trim();
  if (raw.length === 0 || raw.length > MAX_LENGTH) return fail('This is not a UPI payment code.');

  const start = /^upi:\/\/([a-z]+)\??/i.exec(raw);
  if (!start) return fail('This is not a UPI payment code.');
  if (start[1].toLowerCase() !== 'pay') {
    return fail('This UPI code is not a payment, so Hisaab will not open it.');
  }

  const fields = new Map<string, string>();
  const query = raw.slice(start[0].length);
  for (const part of query.split('&')) {
    if (part === '') continue;
    const at = part.indexOf('=');
    const key = (at < 0 ? part : part.slice(0, at)).toLowerCase();
    let value: string;
    try {
      value = at < 0 ? '' : decodeURIComponent(part.slice(at + 1));
    } catch {
      return fail('This payment code is damaged.');
    }
    if (fields.has(key)) return fail('This payment code repeats a field, so it is not safe to read.');
    fields.set(key, value);
  }

  const vpa = (fields.get('pa') ?? '').trim().toLowerCase();
  if (!VPA.test(vpa)) return fail('This payment code has no valid UPI address.');

  const currency = fields.get('cu');
  if (currency !== undefined && currency !== '' && currency.toUpperCase() !== 'INR') {
    return fail('This payment code is not in rupees.');
  }

  const request: UpiRequest = { vpa };

  const name = shownFileName(fields.get('pn') ?? '', 99);
  if (name) request.name = name;

  // A standing code has no amount; some print 0 or nothing. Both mean "the payer types it".
  const amountText = (fields.get('am') ?? '').trim();
  if (amountText !== '') {
    if (!PLAIN_AMOUNT.test(amountText)) return fail('This payment code has an amount that cannot be read.');
    const value = parseDecimal(amountText, 2);
    if (value === null) return fail('This payment code has an amount that cannot be read.');
    if (value > MAX_UPI_AMOUNT) return fail('This payment code asks for an amount that looks wrong.');
    if (value > 0) request.amount = paise(value);
  }

  const reference = shownFileName(fields.get('tr') ?? '', 35);
  if (reference) request.reference = reference;

  const note = shownFileName(fields.get('tn') ?? '', 80);
  if (note) request.note = note;

  const code = (fields.get('mc') ?? '').trim();
  if (/^\d{4}$/.test(code)) request.merchantCode = code;

  return ok(request);
};

/**
 * What a UPI app said as it closed, read from its "txnId=…&responseCode=…&Status=SUCCESS" text.
 * Another app's word, useful as a note and nothing more: it can be wrong, late or missing.
 */
export const upiAnswer = (text: string): 'success' | 'failure' | 'pending' | undefined => {
  const status = /(?:^|&)status=([^&]*)/i.exec(text.trim())?.[1]?.toLowerCase();
  if (status === 'success') return 'success';
  if (status === 'failure' || status === 'failed') return 'failure';
  if (status === 'submitted' || status === 'pending') return 'pending';
  return undefined;
};

/** "450.00" for 45000 paise, without going through a float. */
const rupeesText = (amount: Paise): string =>
  `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;

/**
 * The link handed to the UPI app, built again from what was read rather than passed through, so
 * the app receives only the fields Hisaab understood, each encoded, with the amount the payer
 * confirmed on screen.
 */
export const upiLink = (request: UpiRequest, amount: Paise): string => {
  const fields: [string, string][] = [['pa', request.vpa]];
  if (request.name) fields.push(['pn', request.name]);
  fields.push(['am', rupeesText(amount)], ['cu', 'INR']);
  if (request.note) fields.push(['tn', request.note]);
  if (request.reference) fields.push(['tr', request.reference]);
  if (request.merchantCode) fields.push(['mc', request.merchantCode]);
  return `upi://pay?${fields.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
};

/**
 * A first guess at the category from the merchant category the payee registered (ISO 18245). Only
 * kinds of shop whose category is beyond doubt; everything else is left for the payer to pick.
 */
const MERCHANT_CATEGORY: Record<string, string> = {
  '5411': 'cat_groceries', // grocery stores, supermarkets
  '5422': 'cat_groceries', // freezer and meat lockers
  '5441': 'cat_groceries', // candy, confectionery
  '5451': 'cat_groceries', // dairy products
  '5462': 'cat_groceries', // bakeries
  '5499': 'cat_groceries', // miscellaneous food stores
  '5812': 'cat_food', // restaurants
  '5813': 'cat_food', // bars
  '5814': 'cat_food', // fast food
  '5541': 'cat_transport', // petrol stations
  '5542': 'cat_transport',
  '4111': 'cat_transport', // local transport
  '4121': 'cat_transport', // taxis
  '5912': 'cat_healthcare', // pharmacies
  '8011': 'cat_healthcare',
  '8062': 'cat_healthcare',
  '4900': 'cat_utilities', // electricity, gas, water
  '4814': 'cat_utilities', // phone and telecom
  '7832': 'cat_entertainment', // cinemas
};

export const categoryForMerchantCode = (code: string | undefined): Id | undefined =>
  code ? (MERCHANT_CATEGORY[code] as Id | undefined) : undefined;
