import { MONTH_NUMBER } from '@/lib/date';
import { parseDecimal } from '@/lib/decimal';
import { Paise, paise, sum } from '@/money/money';

/**
 * A bill, as far as its text can say: the shop, the date, the total, and the
 * lines that were bought. Read from a photo (via on-device text recognition)
 * or from a PDF invoice. Everything here is a suggestion the user confirms.
 */
export type BillItem = {
  name: string;
  /** What this line cost in total. */
  amount: Paise;
  /** Count bought, when the bill prints one ("2 x 45.00", "Qty 2"). */
  quantity?: number;
};

export type Bill = {
  merchant?: string;
  date?: string;
  total?: Paise;
  items: BillItem[];
  /** Items add up to the total: a sign the reading is right. */
  itemsMatchTotal: boolean;
};

/** A recognised line with its box, as the phone's text recognition reports it. */
export type TextBox = { text: string; box: [number, number, number, number] };

/**
 * Text recognition returns fragments: an item's name and its price, printed
 * on one row of the bill, can come back as separate lines. Fragments whose
 * vertical middles sit within half a line of each other are one row, read
 * left to right.
 */
export const rowsFromBoxes = (boxes: TextBox[]): string[] => {
  const sorted = [...boxes].sort((a, b) => a.box[1] - b.box[1]);
  const rows: TextBox[][] = [];
  for (const box of sorted) {
    const middle = (box.box[1] + box.box[3]) / 2;
    const height = Math.max(box.box[3] - box.box[1], 1);
    const row = rows.find((r) => {
      const first = r[0].box;
      return Math.abs((first[1] + first[3]) / 2 - middle) < height / 2;
    });
    if (row) row.push(box);
    else rows.push([box]);
  }
  return rows.map((row) =>
    row
      .sort((a, b) => a.box[0] - b.box[0])
      .map((b) => b.text)
      .join(' ')
  );
};

const AMOUNT = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,3})|\d+\.\d{1,3})\s*$/i;

const money = (raw: string): Paise | undefined => {
  const value = parseDecimal(raw.replace(/,/g, ''), 2);
  return value === null || value <= 0 ? undefined : paise(value);
};

/** The amount a line ends with, if it ends with one. */
const trailingAmount = (line: string): Paise | undefined => {
  const match = line.trim().match(AMOUNT);
  return match ? money(match[1]) : undefined;
};

const STRONG_TOTAL = /\b(grand\s*total|net\s*(amount|payable|total)|amount\s*payable|total\s*payable|to\s*pay|bill\s*amount|invoice\s*(total|value))\b/i;
const TOTAL = /\btotal\b/i;
const NOT_AN_ITEM = /\b(sub\s*-?\s*total|total|tax|gst|cgst|sgst|igst|cess|vat|discount|savings?|round(ed)?\s*off|change|cash|card|upi|paid|tender|balance|due|delivery|shipping|packing|convenience|tip|mrp\s*total|items?\s*:|amount\s*in\s*words|invoice|gstin|fssai|phone|tel|platform\s*fee|handling\s*charge|gt\s*charges|packaging|private|limited|pvt|ltd|inc|corp|company)\b/i;
const HEADER_NOISE = /\b(tax\s*invoice|invoice|receipt|bill\s*of\s*supply|gstin|fssai|phone|tel|mob|www\.|@|address|order\s*(id|no)|date|time|cashier|table|original\s*for\s*recipient|bill\s*(from|to)|ship\s*(from|to)|sr\.?\s*no|upc|hsn\s*code|item\s*description|taxable\s*(value|amount)|gross\s*amount|particulars|sold\s*by|service\s*provider)\b/i;

const findDate = (lines: string[]): string | undefined => {
  for (const line of lines) {
    const iso = line.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const numeric = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
    if (numeric && Number(numeric[2]) >= 1 && Number(numeric[2]) <= 12) {
      const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
      return `${year}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
    }
    const named = line.match(/\b(\d{1,2})[\s-]*([A-Za-z]{3})[A-Za-z]*[\s,-]*(20\d{2})\b/);
    if (named && MONTH_NUMBER[named[2].toLowerCase()]) {
      return `${named[3]}-${MONTH_NUMBER[named[2].toLowerCase()]}-${named[1].padStart(2, '0')}`;
    }
  }
  return undefined;
};

/** The shop's name: the first real line of words at the top of the bill. */
const findMerchant = (lines: string[]): string | undefined => {
  const MERCHANT_LABELS = /^(sold\s*by|service\s*provider|bill\s*from|ship\s*from):\s*/i;
  const candidates = lines.slice(0, 6).map((l) => {
    const trimmed = l.trim();
    // If the line starts with a known merchant label, extract the text after it
    const labelMatch = trimmed.match(MERCHANT_LABELS);
    const text = labelMatch ? trimmed.slice(labelMatch[0].length) : trimmed;
    return text.length <= 40 ? text : undefined;
  }).filter(Boolean) as string[];

  return candidates.find((l) => /[A-Za-z]{3,}/.test(l) && !HEADER_NOISE.test(l) && !trailingAmount(l));
};

const findTotal = (lines: string[]): Paise | undefined => {
  const strong = lines.filter((l) => STRONG_TOTAL.test(l)).map(trailingAmount).filter(Boolean) as Paise[];
  if (strong.length > 0) return strong[strong.length - 1];
  const totals = lines
    .filter((l) => TOTAL.test(l) && !/sub\s*-?\s*total/i.test(l))
    .map(trailingAmount)
    .filter(Boolean) as Paise[];
  return totals.length > 0 ? totals.reduce((a, b) => (b > a ? b : a)) : undefined;
};

const quantityOf = (line: string): number | undefined => {
  const times = line.match(/\b(\d{1,3})\s*[xX×@*]\s*(?:₹|rs\.?)?\s*\d/);
  if (times) return Number(times[1]);
  const qty = line.match(/\bqty\.?\s*:?\s*(\d{1,3})\b/i);
  if (qty) return Number(qty[1]);
  // Qty, Rate and Amount columns with no "x": a count only when count times rate is the amount.
  const columns = line.match(/\s(\d{1,3})\s+(\d[\d,]*\.\d{1,2})\s+(\d[\d,]*\.\d{1,2})\s*$/);
  if (columns) {
    const [count, rate, amount] = [Number(columns[1]), money(columns[2]), money(columns[3])];
    if (rate !== undefined && amount !== undefined && count * rate === amount) return count;
  }
  return undefined;
};

/**
 * The item's name: the line without its figures, units kept ("Paneer 200g").
 * A bare number left at the end is a quantity column only when the line has
 * columns (a rate and an amount); otherwise it belongs to the name ("Airdopes 141").
 */
const nameOf = (line: string): string => {
  const columns = (line.match(/\d\.\d{2}\b/g) ?? []).length >= 2;
  const name = line
    .replace(AMOUNT, '')
    .replace(/\b\d{1,3}\s*[xX×@*]\s*(?:₹|rs\.?)?\s*[\d,.]+/g, '')
    .replace(/\bqty\.?\s*:?\s*\d+/gi, '')
    .replace(/(?:₹|rs\.?)?\s*\d[\d,]*\.\d{1,2}\s*$/i, '')
    .replace(/^\s*\d{1,3}[.)]?\s+(?=[A-Za-z])/, '');
  return (columns ? name.replace(/\s+\d+(\.\d+)?\s*$/, '') : name).replace(/\s+/g, ' ').trim();
};

/**
 * Extract items from a segment, merging wrapped descriptions with their numeric rows.
 */
const extractItemsFromSegment = (segment: string[]): BillItem[] => {
  const items: BillItem[] = [];
  const pendingDescription: string[] = [];

  // Regex to detect HSN/GST annotation lines (skip without buffering)
  const isGstAnnotation = /^\s*hsn\b|^\s*gstin\b|^\d+(\.\d+)?%\s*(igst|cgst|sgst)\b/i;

  // Check if a line is numeric-only (after removing Rs/rs tokens)
  const isNumericOnly = (line: string): boolean => {
    const withoutRs = line.replace(/\b[Rr]s\.?\b/gi, '');
    return /^\s*[\d\s,.\-%₹/-]+$/.test(withoutRs) && /\d/.test(withoutRs);
  };

  for (const line of segment) {
    // Case (a): numeric-only line with pending description → merge them
    if (isNumericOnly(line) && pendingDescription.length > 0) {
      const amount = trailingAmount(line);
      if (amount) {
        const description = pendingDescription.join(' ');
        const name = nameOf(description);
        if (!/[A-Za-z]{2,}/.test(name) || NOT_AN_ITEM.test(description)) {
          pendingDescription.length = 0;
        } else {
          items.push({
            name,
            amount,
            quantity: quantityOf(description) ?? quantityOf(line),
          });
          pendingDescription.length = 0;
        }
      } else {
        pendingDescription.length = 0;
      }
      continue;
    }

    // Skip numeric-only lines without a pending description (they're not items)
    if (isNumericOnly(line)) {
      continue;
    }

    // Case (b): existing single-line logic (line with its own amount)
    const amount = trailingAmount(line);
    if (amount && !NOT_AN_ITEM.test(line)) {
      const name = nameOf(line);
      if (/[A-Za-z]{2,}/.test(name)) {
        items.push({ name, amount, quantity: quantityOf(line) });
        pendingDescription.length = 0;
        continue;
      }
    }

    // Case (d): HSN/GST annotation or blank noise → skip without touching buffer
    if (isGstAnnotation.test(line) || !/[A-Za-z]{2,}/.test(line)) {
      continue;
    }

    // Case (c): looks like a description line → buffer it
    if (!/[A-Za-z]{2,}/.test(line) || HEADER_NOISE.test(line) || NOT_AN_ITEM.test(line)) {
      // This shouldn't get here due to case (d), but just in case
      continue;
    }

    pendingDescription.push(line);
  }

  return items;
};

export const parseBill = (lines: string[]): Bill => {
  // Text recognition can split an amount at its point: "1118. 00" is 1118.00.
  const clean = lines
    .map((l) => l.replace(/\s+/g, ' ').replace(/(\d)\s?\.\s?(\d{2})\b/g, '$1.$2').trim())
    .filter(Boolean);

  // Segmentation: split on "Invoice Number" boundaries and exclude "Bill of Supply" zones
  const invoicePattern = /^invoice\s*(no\.?|number)\s*:/i;
  const billOfSupplyPattern = /^bill\s*of\s*supply\s*(number|details)\s*:?/i;

  const segments: string[][] = [];
  let currentSegment: string[] = [];
  let inBillOfSupply = false;

  for (const line of clean) {
    if (invoicePattern.test(line)) {
      // Start a new segment
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = [line];
      inBillOfSupply = false;
    } else if (billOfSupplyPattern.test(line)) {
      // Mark that we're in a Bill of Supply zone (exclude these from total and items)
      inBillOfSupply = true;
    } else if (inBillOfSupply && invoicePattern.test(line)) {
      // Next invoice starts, exit Bill of Supply zone
      inBillOfSupply = false;
      segments.push(currentSegment);
      currentSegment = [line];
    } else if (!inBillOfSupply) {
      // Add to current segment, skip if in Bill of Supply
      currentSegment.push(line);
    }
  }

  // Add the last segment
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // If no segmentation happened, treat the whole thing as one segment
  if (segments.length === 0) {
    segments.push(clean);
  }

  // Extract items from all segments and sum totals
  const items: BillItem[] = [];
  let total: Paise | undefined;

  for (const segment of segments) {
    // Extract items using the multi-line merge logic
    items.push(...extractItemsFromSegment(segment));

    // Find and sum totals from each segment
    const segmentTotal = findTotal(segment);
    if (segmentTotal !== undefined) {
      total = total === undefined ? segmentTotal : (total + segmentTotal) as Paise;
    }
  }

  const itemsTotal = sum(items.map((i) => i.amount));
  return {
    merchant: findMerchant(clean),
    date: findDate(clean),
    total,
    items,
    itemsMatchTotal: total !== undefined && items.length > 0 && itemsTotal === total,
  };
};
