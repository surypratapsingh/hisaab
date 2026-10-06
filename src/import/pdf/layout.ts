import { MONTH_NUMBER } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise, subtract } from '@/money/money';
import type { ParsedRow, ParseError, StatementParser } from '../types';
import { parseAmount, walkBalance, requireRows, type SourcedRow } from '../parsers/shared';

/**
 * Text pulled out of a PDF, with where every word sat on the page.
 *
 * A PDF has no columns, only words at coordinates, so a flat text dump cannot
 * say whether "450.00" was a withdrawal or a deposit. Keeping each word's
 * horizontal extent lets the parser put it under the column header it lines
 * up with. The native extractor writes this; the parser reads it; and it is
 * what raw_records keeps, so a parser fix is a replay of the stored layout.
 */
export type PdfWord = [x: number, endX: number, text: string];
export type PdfLine = { p: number; y: number; w: PdfWord[] };
export type PdfLayout = {
  format: typeof LAYOUT_FORMAT;
  version: 1;
  pages: number;
  lines: PdfLine[];
};

export const LAYOUT_FORMAT = 'pdf-layout';

type Column = 'debit' | 'credit' | 'balance' | 'amount';

type Header = {
  columns: Array<{ column: Column; endX: number }>;
  /**
   * Where narration words sit: between the header words either side of the narration
   * header, since a bank may centre "Particulars" over a column that starts well left of it.
   */
  narration?: { from: number; to: number };
};

const HEADER_WORDS: Array<[RegExp, Column]> = [
  [/^(withdrawals?|debits?|dr\.?)$/i, 'debit'],
  [/^(deposits?|credits?|cr\.?)$/i, 'credit'],
  [/^balance\.?$/i, 'balance'],
  [/^amount\.?$/i, 'amount'],
];
const NARRATION_WORD = /^(narration|description|particulars|details|remarks)$/i;

const AMOUNT = /^-?[\d,]*\d\.\d{2}$/;

const fullYear = (year: string): string => (year.length === 2 ? `20${year}` : year);

/**
 * A statement date at the start of a line, in any of the forms Indian banks
 * print: 05/01/26, 05-01-2026, 05.01.2026, 05-Jan-2026, or "05 Jan 2026"
 * spread over three words. Returns the ISO date and how many words it used.
 */
export const leadingDate = (words: string[]): { iso: string; used: number } | null => {
  const first = words[0] ?? '';

  const numeric = first.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (numeric) {
    const [, d, m, y] = numeric;
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return { iso: `${fullYear(y)}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, used: 1 };
  }

  const named = first.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2}|\d{4})$/);
  if (named && MONTH_NUMBER[named[2].toLowerCase()]) {
    const [, d, mon, y] = named;
    return { iso: `${fullYear(y)}-${MONTH_NUMBER[mon.toLowerCase()]}-${d.padStart(2, '0')}`, used: 1 };
  }

  const month = MONTH_NUMBER[(words[1] ?? '').slice(0, 3).toLowerCase()];
  if (/^\d{1,2}$/.test(first) && month && /^(\d{2}|\d{4}),?$/.test(words[2] ?? '')) {
    const year = fullYear(words[2].replace(',', ''));
    return { iso: `${year}-${month}-${first.padStart(2, '0')}`, used: 3 };
  }

  return null;
};

/** A row's date, after the serial number some banks print first (Union Bank: "12 05-08-2026"). */
const rowDate = (words: string[]): { iso: string; used: number } | null => {
  const date = leadingDate(words);
  if (date || !/^\d{1,4}$/.test(words[0] ?? '')) return date;
  const after = leadingDate(words.slice(1));
  return after && { iso: after.iso, used: after.used + 1 };
};

/** A table header: a Balance column plus at least one amount column. */
const readHeader = (line: PdfLine): Header | null => {
  const columns: Header['columns'] = [];
  for (const [, endX, text] of line.w) {
    const match = HEADER_WORDS.find(([pattern]) => pattern.test(text));
    if (match && !columns.some((c) => c.column === match[1])) {
      columns.push({ column: match[1], endX });
    }
  }

  const hasBalance = columns.some((c) => c.column === 'balance');
  const hasAmount = columns.some((c) => c.column !== 'balance');
  if (!hasBalance || !hasAmount) return null;

  const words = [...line.w].sort((a, b) => a[0] - b[0]);
  const at = words.findIndex(([, , text]) => NARRATION_WORD.test(text));
  const narration =
    at === -1
      ? undefined
      : {
          from: words[at - 1]?.[1] ?? Number.NEGATIVE_INFINITY,
          to: words[at + 1]?.[0] ?? Number.POSITIVE_INFINITY,
        };

  return { columns, narration };
};

/** The header column whose right edge is nearest the word's: amounts are right-aligned. */
const columnOf = (header: Header, endX: number): Column =>
  header.columns.reduce((best, c) =>
    Math.abs(c.endX - endX) < Math.abs(best.endX - endX) ? c : best
  ).column;

/** Continuation lines this far below a row still belong to its narration. */
const WRAP_GAP = 24;

type Pending = {
  line: number;
  page: number;
  y: number;
  date: string;
  narration: string[];
  debit?: Paise;
  credit?: Paise;
  /** An amount under a single Amount column, direction still unknown. */
  unsigned?: Paise;
  /** A "Dr" or "Cr" marker printed beside an unsigned amount. */
  marker?: 'dr' | 'cr';
  balance?: Paise;
};

const withSign = (value: Paise | undefined, negative: boolean): Paise | undefined =>
  value === undefined ? undefined : negative ? subtract(paise(0), value) : value;

/**
 * Settles rows printed with one Amount column: the running balance says which
 * way the money went. Only the first row has no balance before it, so it needs
 * a Dr/Cr marker, or the statement is refused rather than guessed.
 */
const settleDirections = (
  rows: Pending[],
  opening: Paise | undefined
): Result<Pending[], ParseError> => {
  let previous = opening;
  for (const row of rows) {
    if (row.unsigned !== undefined) {
      if (previous !== undefined && row.balance !== undefined) {
        const moved = subtract(row.balance, previous);
        if (moved === row.unsigned) row.credit = row.unsigned;
        else if (moved === subtract(paise(0), row.unsigned)) row.debit = row.unsigned;
      }
      if (row.debit === undefined && row.credit === undefined && row.marker) {
        if (row.marker === 'dr') row.debit = row.unsigned;
        else row.credit = row.unsigned;
      }
      if (row.debit === undefined && row.credit === undefined) {
        return err({
          code: 'PARSE_FAILED',
          message: `Could not tell whether the amount on page ${row.page} went in or out`,
          rowNumber: row.line,
        });
      }
    }
    if (row.balance !== undefined) previous = row.balance;
  }
  return ok(rows);
};

const inNarration = (table: Header, x: number): boolean =>
  table.narration ? x >= table.narration.from - 2 && x < table.narration.to - 2 : true;

const hasMoney = (row: Pending): boolean =>
  row.debit !== undefined || row.credit !== undefined || row.unsigned !== undefined;

/** Puts each word of a row's line where it belongs: figures under their column, text into the narration. */
const readWords = (row: Pending, words: PdfWord[], table: Header): void => {
  words.forEach(([x, endX, text], i, rest) => {
    if (AMOUNT.test(text)) {
      const value = parseAmount(text.replace(/^-/, ''));
      const next = (rest[i + 1]?.[2] ?? '').toLowerCase();
      const overdrawn = text.startsWith('-') || next === 'dr';
      const column = columnOf(table, endX);
      if (column === 'balance') row.balance = withSign(value, overdrawn);
      else if (value === undefined) return;
      else if (column === 'debit') row.debit = value;
      else if (column === 'credit') row.credit = value;
      else {
        row.unsigned = value;
        if (next === 'dr' || next === 'cr') row.marker = next;
      }
      return;
    }
    if (/^(dr|cr)$/i.test(text)) return;
    if (leadingDate([text])) return; // a value-date column
    if (inNarration(table, x)) row.narration.push(text);
  });
};

export const parseLayout = (layout: PdfLayout): Result<ParsedRow[], ParseError> => {
  let header: Header | null = null;
  const rows: Pending[] = [];
  let current: Pending | null = null as Pending | null;
  /** The row lines last went into. A page footer ends `current`, but not this. */
  let last: Pending | null = null as Pending | null;
  /**
   * Where the header repeated on a new page sits, until the page starts a row of its own:
   * lines just below it may finish the row the page break split (Union Bank does this).
   */
  let pageTop: number | null = null;
  let opening: Paise | undefined;

  /**
   * Keeps a row once it has money on it (called only for a row not kept yet). Returns
   * the row the lines below may still add to, if any.
   */
  const place = (row: Pending): Pending | null => {
    if (hasMoney(row)) {
      rows.push(row);
      return row;
    }
    // Some banks (Union Bank) print a row's figures on the line below its date.
    if (row.balance === undefined) return row;
    // Only a balance: a heading such as "Opening balance", worth keeping to settle the first row.
    if (rows.length === 0) opening = row.balance;
    return null;
  };

  for (const [index, line] of layout.lines.entries()) {
    const words = [...line.w].sort((a, b) => a[0] - b[0]);
    const texts = words.map(([, , text]) => text);

    const found = readHeader({ ...line, w: words });
    if (found) {
      header = found;
      const split = last !== null && last.page === line.p - 1;
      current = split ? last : null;
      pageTop = split ? line.y : null;
      continue;
    }
    // Nothing is read until a table header has been seen, which keeps the
    // masthead's address and summary figures out of the rows.
    if (!header) continue;
    const table: Header = header;

    const date = rowDate(texts);
    if (date) {
      pageTop = null;
      const row: Pending = {
        line: index + 1,
        page: line.p,
        y: line.y,
        date: date.iso,
        narration: [],
      };
      readWords(row, words.slice(date.used), table);
      current = place(row);
      last = current;
      continue;
    }

    // A line just below its row (or at the top of the next page, when the row was
    // split by a page break): the row's figures if it has none yet, else a wrapped
    // narration, with no figures and inside the narration column.
    const open = current;
    const below =
      open !== null &&
      (line.p === open.page
        ? line.y - open.y <= WRAP_GAP
        : pageTop !== null && line.p === open.page + 1 && line.y - pageTop <= WRAP_GAP);
    if (open && below) {
      const figures = !hasMoney(open);
      if (
        figures ||
        (!texts.some((t) => AMOUNT.test(t)) && words.every(([x]) => inNarration(table, x)))
      ) {
        if (figures) readWords(open, words, table);
        else open.narration.push(...texts);
        open.page = line.p;
        open.y = line.y;
        pageTop = null;
        current = figures ? place(open) : open;
        last = current;
        continue;
      }
    }
    current = null;
    pageTop = null;
  }

  if (!header) {
    return err({
      code: 'INVALID_FORMAT',
      message: 'Could not find the transaction table in this PDF',
    });
  }

  const byColumn = finish(rows, opening);
  if (byColumn.isOk()) return byColumn;

  // Columns can be misread when a header is laid out oddly. The running
  // balance knows the truth, so read every amount's direction from it, with
  // the column reading kept only as the tie-breaker for the first row.
  const byBalance = finish(
    rows.map((row) => ({
      ...row,
      unsigned: row.unsigned ?? row.debit ?? row.credit,
      marker:
        row.marker ??
        (row.debit !== undefined ? 'dr' : row.credit !== undefined ? 'cr' : undefined),
      debit: undefined,
      credit: undefined,
    })),
    opening
  );
  return byBalance.isOk() ? byBalance : byColumn;
};

const finish = (
  rows: Pending[],
  opening: Paise | undefined
): Result<ParsedRow[], ParseError> => {
  const settled = settleDirections(rows, opening);
  if (settled.isErr()) return err(settled.error);

  const sourced: SourcedRow[] = settled.value.map((row) => ({
    line: row.line,
    row: {
      date: row.date,
      narration: row.narration.join(' ').trim() || 'No description',
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
    },
  }));

  const nonEmpty = requireRows(sourced);
  if (nonEmpty.isErr()) return err(nonEmpty.error);

  // A printed opening balance lets the walk check the first row too.
  if (opening === undefined) return walkBalance(sourced);
  const seed: SourcedRow = { line: 0, row: { date: '', narration: '', balance: opening } };
  const walked = walkBalance([seed, ...sourced]);
  return walked.isOk() ? ok(walked.value.slice(1)) : walked;
};

export const readLayout = (text: string): PdfLayout | null => {
  if (!text.startsWith(`{"format":"${LAYOUT_FORMAT}"`)) return null;
  try {
    const parsed = JSON.parse(text) as PdfLayout;
    return Array.isArray(parsed.lines) ? parsed : null;
  } catch {
    return null;
  }
};

const ACCOUNT_LABEL = /^(account|a\/c)$/i;
const NUMBER_LABEL = /^(number|no)\.?:?$/i;
/** A printed account number, often masked: 50100012341234, 1234XXXXXXX5678, XXXXXX5678. */
const ACCOUNT_NUMBER = /^[\dXx*]{2,}\d{4}$/;

/**
 * The last four digits of the account a statement is for, from the masthead ("Account
 * Number : 1234XXXXXXX5678"), so the import lands in that account. Only lines above the
 * transaction table are read: tables further down list other, linked accounts.
 */
export const statementLast4 = (layout: PdfLayout): string | undefined => {
  for (const line of layout.lines) {
    if (readHeader(line)) return undefined;
    const words = [...line.w].sort((a, b) => a[0] - b[0]).map(([, , text]) => text);
    for (let i = 0; i + 1 < words.length; i++) {
      if (!ACCOUNT_LABEL.test(words[i]) || !NUMBER_LABEL.test(words[i + 1])) continue;
      const value = words.slice(i + 2).find((word) => word !== ':');
      if (value && ACCOUNT_NUMBER.test(value)) return value.slice(-4);
    }
  }
  return undefined;
};

/**
 * Any bank's PDF statement, read by column position rather than by a
 * per-bank template. The balance walk still checks every row, so a column
 * read wrongly refuses the import instead of posting wrong amounts.
 */
export const PdfLayoutParser: StatementParser = {
  id: 'pdf_layout_v1',
  name: 'PDF statement',
  bank: 'Any',
  format: 'pdf',
  detect: (text) => readLayout(text) !== null,
  parse: (text) => {
    const layout = readLayout(text);
    return layout
      ? parseLayout(layout)
      : err({ code: 'INVALID_FORMAT', message: 'Not a PDF layout' });
  },
};

/** The layout as plain text: one line per PDF line, words in reading order. */
export const layoutText = (layout: PdfLayout): string =>
  layout.lines
    .map((line) =>
      [...line.w]
        .sort((a, b) => a[0] - b[0])
        .map(([, , text]) => text)
        .join(' ')
    )
    .join('\n');
