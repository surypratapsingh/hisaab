import { type Paise, tryRupeeString } from '@/money/money';

/**
 * A bill reminder shared as text (an SMS, a WhatsApp message, an email) read into a draft
 * reminder: who is billing, how much, and by when. The user checks it in the Recurring form
 * before anything is saved, so every field may be missing; nothing is guessed to fill a gap.
 *
 * Written against the usual shapes of Indian bill texts (telecom, electricity, gas, broadband,
 * DTH, credit card statements); not yet tried on real samples from other phones (todo.md).
 */

export type BillDraft = {
  /** Who sent the bill, when the text names them. */
  biller: string | null;
  amount: Paise | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** The first 200 characters of the text, kept as the reminder's note. */
  note: string;
};

const BILL_WORDS =
  /\b(bill|due|payable|pay by|last date|outstanding|statement|premium|recharge (?:is )?due|minimum amount)\b/i;

const BILLERS: Array<[RegExp, string]> = [
  [/\bairtel\b/i, 'Airtel'],
  [/\bjio\b/i, 'Jio'],
  [/\b(vodafone idea|vi\b)/i, 'Vi'],
  [/\bbsnl\b/i, 'BSNL'],
  [/\bbescom\b/i, 'BESCOM'],
  [/\bbses\b/i, 'BSES'],
  [/\btata power\b/i, 'Tata Power'],
  [/\badani electricity\b/i, 'Adani Electricity'],
  [/\b(msedcl|mahavitaran)\b/i, 'MSEDCL'],
  [/\b(tangedco|tneb)\b/i, 'TANGEDCO'],
  [/\b(uppcl)\b/i, 'UPPCL'],
  [/\bmahanagar gas\b/i, 'Mahanagar Gas'],
  [/\b(indraprastha gas|igl)\b/i, 'Indraprastha Gas'],
  [/\bact fibernet\b/i, 'ACT Fibernet'],
  [/\bhathway\b/i, 'Hathway'],
  [/\btata play\b/i, 'Tata Play'],
  [/\blic\b/i, 'LIC'],
];

const CARD_BANKS: Array<[RegExp, string]> = [
  [/\bhdfc\b/i, 'HDFC'],
  [/\bicici\b/i, 'ICICI'],
  [/\b(sbi ?card|sbi)\b/i, 'SBI'],
  [/\baxis\b/i, 'Axis'],
  [/\bkotak\b/i, 'Kotak'],
  [/\bidfc\b/i, 'IDFC First'],
  [/\bau (small finance|bank)\b/i, 'AU'],
  [/\bonecard\b/i, 'OneCard'],
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

const realDate = (year: number, month: number, day: number): string | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
};

const fullYear = (text: string | undefined, month: number, day: number, today: string): number => {
  if (text) return text.length === 2 ? 2000 + Number(text) : Number(text);
  // No year: the next such date, allowing a month in the past for a late reminder.
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${pad(month)}-${pad(day)}`;
  const monthAgo = new Date(`${today}T00:00:00Z`);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 31);
  return candidate < monthAgo.toISOString().slice(0, 10) ? year + 1 : year;
};

type Found = { index: number; value: string };

const DATE_PATTERNS: Array<[RegExp, (m: RegExpExecArray, today: string) => string | null]> = [
  // 2026-10-15
  [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => realDate(Number(m[1]), Number(m[2]), Number(m[3]))],
  // 15-10-2026, 15/10/26, 15.10.2026 (day first, as Indian billers write it)
  [
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g,
    (m, today) => realDate(fullYear(m[3], Number(m[2]), Number(m[1]), today), Number(m[2]), Number(m[1])),
  ],
  // 15 Oct 2026, 15-Oct-26, 15th October
  [
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s,-]*(\d{4}|\d{2})\b)?/gi,
    (m, today) => {
      const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
      return realDate(fullYear(m[3], month, Number(m[1]), today), month, Number(m[1]));
    },
  ],
  // Oct 15, 2026
  [
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi,
    (m, today) => {
      const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
      return realDate(fullYear(m[3], month, Number(m[2]), today), month, Number(m[2]));
    },
  ],
];

const datesIn = (text: string, today: string): Found[] => {
  const found: Found[] = [];
  for (const [pattern, read] of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      const value = read(m, today);
      if (value && !found.some((f) => Math.abs(f.index - m!.index) < 3)) found.push({ index: m.index, value });
    }
  }
  return found.sort((a, b) => a.index - b.index);
};

const AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;

const before = (text: string, index: number, span: number) => text.slice(Math.max(0, index - span), index).toLowerCase();

const amountScore = (label: string): number => {
  if (/(min(imum)?\.?\s*(amount\s*)?(due|payable)|mad\b)/.test(label)) return -10;
  if (/(paid|received|credited|cashback|discount|late (payment )?(fee|charge)|limit|available|saved|off\b)/.test(label)) return -10;
  if (/(total (amount )?(due|payable|outstanding)|amount (due|payable)|bill (amount|of|for)|outstanding|payable|due)/.test(label)) return 3;
  return 0;
};

const amountIn = (text: string): Paise | null => {
  let best: { amount: Paise; score: number } | null = null;
  AMOUNT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT.exec(text))) {
    const amount = tryRupeeString(m[1].replace(/,/g, ''));
    if (amount === null || amount <= 0) continue;
    // Only the words since the last amount or sentence belong to this amount.
    const label = before(text, m.index, 40).split(/(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?|[;|!?]|\.\s/).pop() ?? '';
    const score = amountScore(label);
    if (score < 0) continue;
    if (!best || score > best.score) best = { amount, score };
  }
  return best?.amount ?? null;
};

const dueDateIn = (text: string, today: string): string | null => {
  const dates = datesIn(text, today).filter((d) => !/(bill|statement|generated|invoice)\s*(date|on|dated)?\s*:?\s*$/.test(before(text, d.index, 25)));
  const labelled = dates.find((d) => /(due|pay(able)?|last date|before|by|on or before)[^.\n]{0,15}$/.test(before(text, d.index, 25)));
  if (labelled) return labelled.value;
  return dates.length === 1 && /\bdue\b/i.test(text) ? dates[0].value : null;
};

const billerIn = (text: string): string | null => {
  if (/credit card/i.test(text)) {
    const bank = CARD_BANKS.find(([pattern]) => pattern.test(text));
    return bank ? `${bank[1]} credit card` : 'Credit card';
  }
  const known = BILLERS.find(([pattern]) => pattern.test(text));
  if (known) return known[1];
  const named = /\byour ([A-Z][\w&.-]*(?: [A-Z][\w&.-]*){0,2}) (?:bill|postpaid|broadband|electricity)/.exec(text);
  return named ? named[1] : null;
};

/** A draft reminder from a shared bill text, or null when the text is not about a bill to pay. */
export const readBillText = (raw: string, today: string): BillDraft | null => {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || !BILL_WORDS.test(text)) return null;
  const amount = amountIn(text);
  const dueDate = dueDateIn(text, today);
  if (amount === null && dueDate === null) return null;
  return { biller: billerIn(text), amount, dueDate, note: text.slice(0, 200) };
};
