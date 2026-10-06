import { describe, it, expect } from 'vitest';
import { HDFCCSVParser, HDFCPDFParser } from './hdfc';
import { SBICSVParser, SBIPDFParser } from './sbi';
import { ICICICSVParser, ICICIPDFParser } from './icici';
import { detectParser } from './index';

const HDFC_HEADER =
  'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description';
const SBI_HEADER = 'Tran Date,Description,Ref No,Withdrawal,Deposit,Balance';
const ICICI_HEADER = 'Date,Narration,Ref No,Debit,Credit,Balance';

describe('HDFC CSV Parser', () => {
  it('should detect HDFC CSV format', () => {
    expect(HDFCCSVParser.detect(HDFC_HEADER)).toBe(true);
  });

  it('should reject other formats', () => {
    expect(HDFCCSVParser.detect(SBI_HEADER)).toBe(false);
    expect(HDFCCSVParser.detect(ICICI_HEADER)).toBe(false);
  });

  it('should parse valid HDFC CSV', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,50000.00,500000.00,SALARY TRANSFER
2026-01-06,2026-01-06,2500.00,,497500.00,AMAZON PURCHASE`;

    const result = HDFCCSVParser.parse(csv);

    expect(result.isOk()).toBe(true);
    const rows = result.getOrNull();
    expect(rows).toHaveLength(2);
    expect(rows![0].credit).toBe(5000000);
    expect(rows![1].debit).toBe(250000);
  });

  it('should seed the balance walk from the first row, not zero', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,50000.00,500000.00,SALARY
2026-01-06,2026-01-06,2500.00,,497500.00,PURCHASE`;

    // Opening balance is 5,00,000 — the walk must not assume the account
    // started empty.
    expect(HDFCCSVParser.parse(csv).isOk()).toBe(true);
  });

  it('should reject a broken balance walk naming the file line', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,50000.00,500000.00,SALARY
2026-01-06,2026-01-06,2500.00,,499000.00,PURCHASE`;

    const result = HDFCCSVParser.parse(csv);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('BALANCE_CHECK_FAILED');
      // Line 1 is the header, so the bad row is line 3 of the file.
      expect(result.error.rowNumber).toBe(3);
    }
  });

  it('should report the true file line even when rows are skipped', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,50000.00,500000.00,SALARY
2026-01-05,2026-01-05,,,500000.00,ZERO VALUE ROW
2026-01-06,2026-01-06,2500.00,,499000.00,PURCHASE`;

    const result = HDFCCSVParser.parse(csv);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.rowNumber).toBe(4);
    }
  });

  it('should keep an unquoted narration containing a comma intact', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,50000.00,500000.00,SALARY, MONTHLY CREDIT`;

    const rows = HDFCCSVParser.parse(csv).getOrNull();
    expect(rows![0].narration).toBe('SALARY, MONTHLY CREDIT');
  });

  it('should keep a quoted narration containing a comma intact', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,50000.00,500000.00,"SALARY, MONTHLY CREDIT"`;

    const rows = HDFCCSVParser.parse(csv).getOrNull();
    expect(rows![0].narration).toBe('SALARY, MONTHLY CREDIT');
  });

  it('should reject empty input', () => {
    expect(HDFCCSVParser.parse('').isErr()).toBe(true);
  });

  it('should detect HDFC PDF text', () => {
    expect(HDFCPDFParser.detect('HDFC Bank Statement of Account')).toBe(true);
    expect(HDFCPDFParser.detect('State Bank of India')).toBe(false);
  });
});

describe('SBI CSV Parser', () => {
  it('should detect SBI CSV format', () => {
    expect(SBICSVParser.detect(SBI_HEADER)).toBe(true);
    expect(SBICSVParser.detect(HDFC_HEADER)).toBe(false);
  });

  it('should parse valid SBI CSV using the correct columns', () => {
    const csv = `${SBI_HEADER}
01-01-2026,SALARY TRANSFER,,0.00,50000.00,500000.00
02-01-2026,AMAZON PURCHASE,,2500.00,0.00,497500.00`;

    const result = SBICSVParser.parse(csv);

    expect(result.isOk()).toBe(true);
    const rows = result.getOrNull();
    expect(rows).toHaveLength(2);
    expect(rows![0].narration).toBe('SALARY TRANSFER');
    expect(rows![0].credit).toBe(5000000);
    expect(rows![1].narration).toBe('AMAZON PURCHASE');
    expect(rows![1].debit).toBe(250000);
  });

  it('should convert DD-MM-YYYY to ISO', () => {
    const csv = `${SBI_HEADER}
01-01-2026,TEST,,0.00,1000.00,1000.00`;

    const rows = SBICSVParser.parse(csv).getOrNull();
    expect(rows![0].date).toBe('2026-01-01');
  });

  it('should detect SBI PDF text', () => {
    expect(SBIPDFParser.detect('State Bank of India Account Statement')).toBe(
      true
    );
  });
});

describe('ICICI CSV Parser', () => {
  it('should detect ICICI CSV format', () => {
    expect(ICICICSVParser.detect(ICICI_HEADER)).toBe(true);
    expect(ICICICSVParser.detect(SBI_HEADER)).toBe(false);
  });

  it('should parse valid ICICI CSV', () => {
    const csv = `${ICICI_HEADER}
01/01/2026,SALARY TRANSFER,,0.00,50000.00,500000.00
02/01/2026,SHOPPING,,2500.00,0.00,497500.00`;

    const result = ICICICSVParser.parse(csv);

    expect(result.isOk()).toBe(true);
    expect(result.getOrNull()).toHaveLength(2);
  });

  it('should convert DD/MM/YYYY to ISO', () => {
    const csv = `${ICICI_HEADER}
15/03/2026,TEST,,0.00,1000.00,1000.00`;

    const rows = ICICICSVParser.parse(csv).getOrNull();
    expect(rows![0].date).toBe('2026-03-15');
  });

  it('should skip trailing total rows', () => {
    const csv = `${ICICI_HEADER}
01/01/2026,SALARY,,0.00,50000.00,500000.00
Total,,,0.00,50000.00,500000.00`;

    expect(ICICICSVParser.parse(csv).getOrNull()).toHaveLength(1);
  });

  it('should detect ICICI PDF text', () => {
    expect(ICICIPDFParser.detect('ICICI Bank Ltd statement')).toBe(true);
  });
});

describe('parser detection routing', () => {
  it('should route each header to its own bank', () => {
    expect(detectParser(HDFC_HEADER)?.bank).toBe('HDFC');
    expect(detectParser(SBI_HEADER)?.bank).toBe('SBI');
    expect(detectParser(ICICI_HEADER)?.bank).toBe('ICICI');
  });

  it('should return null for an unknown statement', () => {
    expect(detectParser('Some unrelated document')).toBeNull();
  });
});

describe('full fixture parse', () => {
  it('should parse 12 rows and reconcile every balance', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,50000.00,500000.00,SALARY TRANSFER
2026-01-06,2026-01-06,2500.00,,497500.00,AMAZON BOOK
2026-01-08,2026-01-08,450.50,,497049.50,BLINKIT GROCERIES
2026-01-10,2026-01-10,1200.00,,495849.50,UBER FARE
2026-01-12,2026-01-12,,25000.00,520849.50,TRANSFER FROM SAVINGS
2026-01-15,2026-01-15,5000.00,,515849.50,NETFLIX SUBSCRIPTION
2026-01-18,2026-01-18,750.00,,515099.50,STARBUCKS COFFEE
2026-01-20,2026-01-20,3400.00,,511699.50,RESTAURANT DINNER
2026-01-22,2026-01-22,2000.00,,509699.50,MOBILE RECHARGE
2026-01-25,2026-01-25,,75000.00,584699.50,SALARY TRANSFER
2026-01-28,2026-01-28,10000.00,,574699.50,AMAZON ELECTRONICS
2026-02-01,2026-02-01,1000.00,,573699.50,POWER BILL`;

    const result = HDFCCSVParser.parse(csv);

    expect(result.isOk()).toBe(true);
    const rows = result.getOrNull()!;
    expect(rows).toHaveLength(12);
    expect(rows[0].date).toBe('2026-01-05');
    expect(rows[0].credit).toBe(5000000);
    expect(rows[0].balance).toBe(50000000);
    expect(rows[rows.length - 1].balance).toBe(57369950);
  });
});

describe('error handling', () => {
  it('should reject a row with missing columns', () => {
    const csv = `${HDFC_HEADER}
2026-01-05`;

    expect(HDFCCSVParser.parse(csv).isErr()).toBe(true);
  });

  it('should skip non-numeric amounts rather than crashing', () => {
    const csv = `${HDFC_HEADER}
2026-01-05,2026-01-05,,INVALID,500000.00,TEST`;

    const result = HDFCCSVParser.parse(csv);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('PARSE_FAILED');
    }
  });
});
