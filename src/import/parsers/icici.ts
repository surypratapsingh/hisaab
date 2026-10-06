import { StatementParser, ParsedRow, ParseError } from '../types';
import { Result, err } from '@/lib/result';
import {
  parseAmount,
  splitCsvLine,
  sourcedLines,
  findHeaderIndex,
  walkBalance,
  requireRows,
  isoFromDMY,
  headRegion,
  SourcedRow,
} from './shared';

const ICICI_CSV_HEADER = /^(Date,Narration|Transaction Date,Description)/i;
const ICICI_PDF_HEADER = /ICICI Bank|iMobile/i;
const ICICI_TABLE_HEADER = /^(Date,|Transaction Date,)/i;

const parseRows = (text: string): Result<ParsedRow[], ParseError> => {
  const lines = sourcedLines(text);

  if (lines.length < 2) {
    return err({
      code: 'INVALID_FORMAT',
      message: 'Statement has fewer than 2 lines',
    });
  }

  const headerIdx = findHeaderIndex(lines, ICICI_TABLE_HEADER);
  const sourced: SourcedRow[] = [];

  for (const { text: line, line: lineNumber } of lines.slice(headerIdx + 1)) {
    if (/^Total/i.test(line)) continue;

    const parts = splitCsvLine(line);
    if (parts.length < 6) continue;

    const [date, narration, refNo, debitStr, creditStr, balanceStr] = parts;

    const debit = parseAmount(debitStr);
    const credit = parseAmount(creditStr);
    if (debit === undefined && credit === undefined) continue;

    sourced.push({
      line: lineNumber,
      row: {
        date: isoFromDMY(date, '/'),
        narration,
        refNo: refNo || undefined,
        debit,
        credit,
        balance: parseAmount(balanceStr),
      },
    });
  }

  const nonEmpty = requireRows(sourced);
  if (nonEmpty.isErr()) return err(nonEmpty.error);

  return walkBalance(sourced);
};

export const ICICICSVParser: StatementParser = {
  id: 'icici_savings_csv_v1',
  name: 'ICICI CSV',
  bank: 'ICICI',
  format: 'csv',
  detect: (text) => ICICI_CSV_HEADER.test(text.trim()),
  parse: parseRows,
};

export const ICICIPDFParser: StatementParser = {
  id: 'icici_savings_pdf_v1',
  name: 'ICICI PDF',
  bank: 'ICICI',
  format: 'pdf',
  detect: (text) => ICICI_PDF_HEADER.test(headRegion(text)),
  parse: parseRows,
};
