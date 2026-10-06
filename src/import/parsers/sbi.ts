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

const SBI_CSV_HEADER = /^(Tran Date|Transaction Date|Value Date)/i;
const SBI_PDF_HEADER = /State Bank of India|SBI/i;
const SBI_TABLE_HEADER = /Tran Date|Transaction Date|Value Date/i;

const parseRows = (text: string): Result<ParsedRow[], ParseError> => {
  const lines = sourcedLines(text);

  if (lines.length < 2) {
    return err({
      code: 'INVALID_FORMAT',
      message: 'Statement has fewer than 2 lines',
    });
  }

  const headerIdx = findHeaderIndex(lines, SBI_TABLE_HEADER);
  const sourced: SourcedRow[] = [];

  for (const { text: line, line: lineNumber } of lines.slice(headerIdx + 1)) {
    const parts = splitCsvLine(line);
    if (parts.length < 6) continue;

    const [tranDate, narration, refNo, withdrawal, deposit, balance] = parts;

    const debit = parseAmount(withdrawal);
    const credit = parseAmount(deposit);
    if (debit === undefined && credit === undefined) continue;

    sourced.push({
      line: lineNumber,
      row: {
        date: isoFromDMY(tranDate, '-'),
        narration,
        refNo: refNo || undefined,
        debit,
        credit,
        balance: parseAmount(balance),
      },
    });
  }

  const nonEmpty = requireRows(sourced);
  if (nonEmpty.isErr()) return err(nonEmpty.error);

  return walkBalance(sourced);
};

export const SBICSVParser: StatementParser = {
  id: 'sbi_savings_csv_v1',
  name: 'SBI CSV',
  bank: 'SBI',
  format: 'csv',
  detect: (text) => SBI_CSV_HEADER.test(text.trim()),
  parse: parseRows,
};

export const SBIPDFParser: StatementParser = {
  id: 'sbi_savings_pdf_v1',
  name: 'SBI PDF',
  bank: 'SBI',
  format: 'pdf',
  detect: (text) => SBI_PDF_HEADER.test(headRegion(text)),
  parse: parseRows,
};
