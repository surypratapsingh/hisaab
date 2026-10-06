import { Paise } from '@/money/money';
import { Result } from '@/lib/result';

export interface ParsedRow {
  date: string;
  valueDate?: string;
  narration: string;
  refNo?: string;
  debit?: Paise;
  credit?: Paise;
  balance?: Paise;
}

export type ParseError = {
  code: 'INVALID_FORMAT' | 'DECRYPT_FAILED' | 'PARSE_FAILED' | 'BALANCE_CHECK_FAILED';
  message: string;
  rowNumber?: number;
};

export interface StatementParser {
  id: string;
  name: string;
  bank: string;
  format: 'pdf' | 'csv';
  detect(text: string): boolean;
  parse(text: string): Result<ParsedRow[], ParseError>;
}

export type ImportResult = {
  rowsParsed: number;
  rowsWithError: number;
  duplicatesSkipped: number;
  rowsNeedingReview: number;
  errors: ParseError[];
  /** Set by a ledger import: what came in, so the app can say so and show it. */
  rawId?: string;
  accountId?: string;
  /** The statement's first and last dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** The bank's balance after the last row. */
  closingBalance?: Paise;
};
