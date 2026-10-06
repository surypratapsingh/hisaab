import { Paise, paise, add, subtract, abs } from '@/money/money';
import { Result, ok, err } from '@/lib/result';
import { parseDecimal } from '@/lib/decimal';
import { ParsedRow, ParseError } from '../types';

/** A parsed row together with the 1-based file line it came from. */
export type SourcedRow = {
  row: ParsedRow;
  line: number;
};

export type SourcedLine = {
  text: string;
  line: number;
};

export const parseAmount = (raw: string | undefined): Paise | undefined => {
  if (!raw) return undefined;
  const value = parseDecimal(raw.replace(/[^\d.,-]/g, ''), 2);
  if (value === null || value === 0) return undefined;
  return paise(value);
};

/**
 * Splits one CSV record, honouring RFC 4180 double quotes so a narration
 * containing a comma survives intact. Unquoted fields are trimmed; quoted
 * fields keep their contents verbatim.
 */
export const splitCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  let wasQuoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (char === ',') {
      fields.push(wasQuoted ? current : current.trim());
      current = '';
      wasQuoted = false;
    } else {
      current += char;
    }
  }

  fields.push(wasQuoted ? current : current.trim());
  return fields;
};

/**
 * Returns everything after the nth top-level comma, verbatim. Used for a
 * trailing narration column that may contain unquoted commas, where rejoining
 * split fields would lose the original spacing.
 */
export const remainderAfterField = (line: string, fieldIndex: number): string => {
  let commas = 0;
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      commas++;
      if (commas === fieldIndex) {
        return line.slice(i + 1).trim();
      }
    }
  }

  return '';
};

/**
 * The masthead of a statement, where the issuing bank names itself. Brand
 * detection must not read the transaction body: narrations routinely carry
 * other banks' VPA handles (`@okhdfcbank` on an ICICI statement) and would
 * otherwise route the file to the wrong parser.
 */
export const headRegion = (text: string, lines = 20): string =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, lines)
    .join('\n');

/** Keeps blank lines out while remembering each line's position in the file. */
export const sourcedLines = (text: string): SourcedLine[] =>
  text
    .split(/\r?\n/)
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter((entry) => entry.text.length > 0);

export const findHeaderIndex = (
  lines: SourcedLine[],
  pattern: RegExp
): number => {
  const index = lines.findIndex((entry) => pattern.test(entry.text));
  return index === -1 ? 0 : index;
};

/**
 * A statement never starts at zero: the opening balance is whatever the first
 * row reports. Seed from it, then every later row must reconcile exactly. A
 * break means the parser dropped or duplicated a row, so the import is refused
 * and the offending file line is named.
 */
export const walkBalance = (
  sourced: SourcedRow[]
): Result<ParsedRow[], ParseError> => {
  let running: Paise | undefined;

  for (const { row, line } of sourced) {
    if (row.balance === undefined) continue;

    if (running === undefined) {
      running = row.balance;
      continue;
    }

    let expected = running;
    if (row.credit !== undefined) expected = add(expected, row.credit);
    if (row.debit !== undefined) expected = subtract(expected, row.debit);

    if (abs(subtract(row.balance, expected)) !== paise(0)) {
      return err({
        code: 'BALANCE_CHECK_FAILED',
        message: `Balance mismatch on line ${line}. Expected ${expected}, got ${row.balance}`,
        rowNumber: line,
      });
    }

    running = row.balance;
  }

  return ok(sourced.map((entry) => entry.row));
};

export const requireRows = (
  sourced: SourcedRow[]
): Result<SourcedRow[], ParseError> =>
  sourced.length === 0
    ? err({ code: 'PARSE_FAILED', message: 'No valid rows found' })
    : ok(sourced);

export const isoFromDMY = (value: string, separator: '-' | '/'): string => {
  const escaped = separator === '-' ? '-' : '\\/';
  const match = value.match(
    new RegExp(`(\\d{2})${escaped}(\\d{2})${escaped}(\\d{4})`)
  );
  if (!match) return value;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
};
