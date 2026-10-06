import { StatementParser, ParsedRow, ParseError } from '../types';
import { Result, err } from '@/lib/result';
import {
  parseAmount,
  splitCsvLine,
  sourcedLines,
  findHeaderIndex,
  walkBalance,
  requireRows,
  remainderAfterField,
  headRegion,
  SourcedRow,
} from './shared';

const HDFC_CSV_HEADER = /^Booking Date,Value Date,Debit Amount,Credit Amount/i;
const HDFC_PDF_HEADER = /HDFC\s*Bank|HDFC0/i;
const HDFC_TABLE_HEADER = /Booking Date|Transaction Date/i;

const NARRATION_COLUMN = 5;

const parseRows = (text: string): Result<ParsedRow[], ParseError> => {
  const lines = sourcedLines(text);

  if (lines.length < 2) {
    return err({
      code: 'INVALID_FORMAT',
      message: 'Statement has fewer than 2 lines',
    });
  }

  const headerIdx = findHeaderIndex(lines, HDFC_TABLE_HEADER);
  const sourced: SourcedRow[] = [];

  for (const { text: line, line: lineNumber } of lines.slice(headerIdx + 1)) {
    const parts = splitCsvLine(line);
    if (parts.length <= NARRATION_COLUMN) continue;

    const debit = parseAmount(parts[2]);
    const credit = parseAmount(parts[3]);
    if (debit === undefined && credit === undefined) continue;

    sourced.push({
      line: lineNumber,
      row: {
        date: parts[0],
        valueDate: parts[1] || undefined,
        // An unquoted narration may itself contain commas, so take the rest of
        // the line verbatim rather than rejoining trimmed fields.
        narration:
          parts.length > NARRATION_COLUMN + 1
            ? remainderAfterField(line, NARRATION_COLUMN)
            : parts[NARRATION_COLUMN],
        debit,
        credit,
        balance: parseAmount(parts[4]),
      },
    });
  }

  const nonEmpty = requireRows(sourced);
  if (nonEmpty.isErr()) return err(nonEmpty.error);

  return walkBalance(sourced);
};

export const HDFCCSVParser: StatementParser = {
  id: 'hdfc_savings_csv_v1',
  name: 'HDFC CSV',
  bank: 'HDFC',
  format: 'csv',
  detect: (text) => HDFC_CSV_HEADER.test(text.trim()),
  parse: parseRows,
};

export const HDFCPDFParser: StatementParser = {
  id: 'hdfc_savings_pdf_v1',
  name: 'HDFC PDF',
  bank: 'HDFC',
  format: 'pdf',
  detect: (text) => HDFC_PDF_HEADER.test(headRegion(text)),
  parse: parseRows,
};
