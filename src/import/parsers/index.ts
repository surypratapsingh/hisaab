import { StatementParser } from '../types';
import { HDFCCSVParser, HDFCPDFParser } from './hdfc';
import { SBICSVParser, SBIPDFParser } from './sbi';
import { ICICICSVParser, ICICIPDFParser } from './icici';
import { PdfLayoutParser } from '../pdf/layout';

// CSV parsers first: they match an exact header line, so they are unambiguous.
// PDF parsers match a bank name in the masthead, which is fuzzier, so they only
// get a say once no CSV header has claimed the file.
// The PDF layout parser matches an exact JSON marker the extractor writes, so
// it goes before the bank-name parsers, whose masthead check would otherwise
// match the bank name inside that JSON.
export const PARSERS: StatementParser[] = [
  HDFCCSVParser,
  SBICSVParser,
  ICICICSVParser,
  PdfLayoutParser,
  HDFCPDFParser,
  SBIPDFParser,
  ICICIPDFParser,
];

export const detectParser = (text: string): StatementParser | null =>
  PARSERS.find((parser) => parser.detect(text)) ?? null;

export * from './hdfc';
export * from './sbi';
export * from './icici';
