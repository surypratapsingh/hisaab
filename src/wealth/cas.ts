import { MONTH_NUMBER } from '@/lib/date';
import { parseDecimal } from '@/lib/decimal';
import { Paise, paise } from '@/money/money';

/**
 * A Consolidated Account Statement: every mutual fund folio (from CAMS and
 * KFintech) or every demat holding (from NSDL or CDSL), valued on one date.
 * The user asks for it free and it arrives as a password-protected PDF; the
 * phone reads it and nothing leaves the device.
 */
export type CasKind = 'mutual_fund' | 'demat';

export type CasHolding = {
  kind: 'mutual_fund' | 'equity' | 'bond' | 'other';
  name: string;
  isin?: string;
  folio?: string;
  /** Thousandths of a unit: fund units carry three decimals. */
  unitsMilli?: number;
  /** NAV or price in ten-thousandths of a rupee: NAVs carry four decimals. */
  navX10000?: number;
  value: Paise;
  cost?: Paise;
};

export type ParsedCas = {
  kind: CasKind;
  /** Which depository or registrar, for the "as of" line on screen. */
  source: string;
  asOf: string;
  holdings: CasHolding[];
};

/** "25-Sep-2026", "25-09-2026", "25/09/2026" to "2026-09-25". */
const isoOf = (raw: string): string | undefined => {
  const named = raw.match(/(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})/);
  if (named && MONTH_NUMBER[named[2].toLowerCase()]) {
    return `${named[3]}-${MONTH_NUMBER[named[2].toLowerCase()]}-${named[1].padStart(2, '0')}`;
  }
  const numeric = raw.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  return undefined;
};

const scaled = (raw: string | undefined, decimals: number): number | undefined => {
  if (!raw) return undefined;
  const value = parseDecimal(raw.replace(/,/g, ''), decimals);
  return value === null ? undefined : value;
};

const money = (raw: string | undefined): Paise | undefined => {
  const value = scaled(raw, 2);
  return value === undefined ? undefined : paise(value);
};

const NUMBER = String.raw`[\d,]+(?:\.\d+)?`;
// "IN", nine characters, then a check digit: INE… shares, INF… funds, IN00… government bonds.
const ISIN = /\b(IN[A-Z0-9]{9}\d)\b/;
/** A statement date, so a lazy match cannot stop halfway through one. */
const DATE = String.raw`\d{1,2}[-/ ][A-Za-z0-9]{2,9}[-/ ]\d{4}`;

/**
 * Tells a CAS apart from a bank statement or anything else. The mutual fund
 * CAS always prints a closing unit balance per scheme; the depositories print
 * their own name and ISIN-coded holdings.
 */
export const detectCas = (text: string): CasKind | null => {
  if (/Closing Unit Balance/i.test(text) && /\bISIN\b/i.test(text)) return 'mutual_fund';
  if (/\b(NSDL|CDSL|Central Depository|National Securities Depository)\b/i.test(text) && ISIN.test(text)) {
    return 'demat';
  }
  return null;
};

/**
 * A mutual fund CAS lists, per scheme: a folio line, the scheme name ending
 * in "ISIN: INF…", its transactions, and a closing block giving units, NAV,
 * cost and market value on the statement date. Each scheme is read from its
 * ISIN to the next one, so a line wrap in the middle does not matter.
 */
const parseMutualFunds = (text: string): Omit<ParsedCas, 'kind'> | null => {
  const flat = text.replace(/[ \t]+/g, ' ');
  const isinPattern = /ISIN\s*:?\s*(IN[A-Z0-9]{9}\d)/g;
  const starts = [...flat.matchAll(isinPattern)];
  if (starts.length === 0) return null;

  const holdings: CasHolding[] = [];
  let asOf: string | undefined;

  starts.forEach((match, index) => {
    const at = match.index ?? 0;
    const end = starts[index + 1]?.index ?? flat.length;
    const block = flat.slice(at, end);
    const before = flat.slice(0, at);

    // The scheme name is the text on the ISIN's own line, before it, less
    // the scheme code the registrar prefixes ("B92Z-", "128TSDGG-").
    const lineStart = before.lastIndexOf('\n') + 1;
    const name = before
      .slice(lineStart)
      .replace(/^\s*[A-Z0-9]{2,12}\s*-\s*/, '')
      .replace(/[\s-]+$/, '')
      .trim();

    const folio = [...before.matchAll(/Folio No\s*:?\s*([0-9A-Z]+(?:\s*\/\s*[0-9A-Z]+)?)/gi)]
      .pop()?.[1]
      ?.replace(/\s+/g, ' ');

    const units = block.match(new RegExp(String.raw`Closing Unit Balance\s*:?\s*(${NUMBER})`, 'i'));
    const nav = block.match(new RegExp(String.raw`NAV on (${DATE})\s*:?\s*(?:INR|Rs\.?|₹)?\s*(${NUMBER})`, 'i'));
    const value = block.match(new RegExp(String.raw`Market Value on (${DATE})\s*:?\s*(?:INR|Rs\.?|₹)?\s*(${NUMBER})`, 'i'));
    const cost = block.match(new RegExp(String.raw`Total Cost Value\s*:?\s*(${NUMBER})`, 'i'));

    const marketValue = money(value?.[2]);
    if (marketValue === undefined || marketValue <= 0) return; // redeemed, or unreadable

    asOf ??= isoOf(value?.[1] ?? nav?.[1] ?? '');
    holdings.push({
      kind: 'mutual_fund',
      name: name || match[1],
      isin: match[1],
      folio,
      unitsMilli: scaled(units?.[1], 3),
      navX10000: scaled(nav?.[2], 4),
      value: marketValue,
      cost: money(cost?.[1]),
    });
  });

  if (holdings.length === 0) return null;
  asOf ??= isoOf(text.match(/Statement Period.*?To\s+([\w-/ ]+)/i)?.[1] ?? '');
  if (!asOf) return null;

  const registrars = [
    /\bCAMS\b/.test(text) && 'CAMS',
    /\bKFIN/i.test(text) && 'KFintech',
  ].filter(Boolean);
  return {
    source: registrars.length ? `${registrars.join(' + ')} CAS` : 'Mutual fund CAS',
    asOf,
    holdings,
  };
};

/**
 * A depository CAS lists holdings one per line: ISIN, security name, then
 * figures ending in the value. The quantity comes first and the price just
 * before the value. Layouts differ between NSDL and CDSL, so only lines that
 * carry an ISIN and at least two figures are read.
 */
const parseDemat = (text: string): Omit<ParsedCas, 'kind'> | null => {
  const holdings: CasHolding[] = [];
  for (const line of text.split('\n')) {
    const isin = line.match(ISIN)?.[1];
    if (!isin) continue;

    // The figures are the run of numbers at the end of the line; anything
    // before them is the name, which may itself hold a number ("SGB 2023").
    const tokens = line.slice(line.indexOf(isin) + isin.length).trim().split(/\s+/);
    let split = tokens.length;
    while (split > 0 && /^\d[\d,]*(\.\d+)?$/.test(tokens[split - 1])) split--;
    const figures = tokens.slice(split);
    if (figures.length < 2) continue;

    const name = tokens.slice(0, split).join(' ').replace(/[#*]+/g, '').trim();
    const value = money(figures[figures.length - 1]);
    if (!name || value === undefined || value <= 0) continue;

    holdings.push({
      kind: isin.startsWith('INF') ? 'mutual_fund' : /BOND|DEBENTURE|NCD|SGB|GOLD BOND/i.test(name) ? 'bond' : 'equity',
      name,
      isin,
      unitsMilli: scaled(figures[0], 3),
      navX10000: figures.length >= 3 ? scaled(figures[figures.length - 2], 4) : undefined,
      value,
    });
  }
  if (holdings.length === 0) return null;

  const asOf =
    isoOf(text.match(/as on\s+([\w-/ ]{8,12})/i)?.[1] ?? '') ??
    isoOf(text.match(/(?:period|statement).*?to\s+([\w-/ ]{8,12})/i)?.[1] ?? '');
  if (!asOf) return null;

  return {
    source: /\bCDSL\b|Central Depository/i.test(text) ? 'CDSL CAS' : 'NSDL CAS',
    asOf,
    holdings,
  };
};

/** Reads a CAS from its text, one PDF line per text line. Null if it is not one. */
export const parseCas = (text: string): ParsedCas | null => {
  const kind = detectCas(text);
  if (!kind) return null;
  const parsed = kind === 'mutual_fund' ? parseMutualFunds(text) : parseDemat(text);
  return parsed ? { kind, ...parsed } : null;
};
