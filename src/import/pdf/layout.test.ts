import { describe, it, expect } from 'vitest';
import {
  parseLayout,
  leadingDate,
  statementLast4,
  PdfLayoutParser,
  LAYOUT_FORMAT,
  type PdfLayout,
  type PdfLine,
  type PdfWord,
} from './layout';
import { detectParser } from '../parsers';
import { format } from '@/money/money';

/**
 * Builds a line the way the extractor reports it: each cell's text at an x
 * position. Numbers are right-aligned to the given edge, as banks print them.
 */
type Cell = [x: number, text: string] | [x: number, text: string, 'right'];
const CHAR = 5;
const line = (p: number, y: number, cells: Cell[]): PdfLine => ({
  p,
  y,
  w: cells.flatMap((cell): PdfWord[] => {
    const [at, text, align] = cell;
    const words = text.split(' ');
    let x = align === 'right' ? at - text.length * CHAR : at;
    return words.map((word) => {
      const w: PdfWord = [x, x + word.length * CHAR, word];
      x += (word.length + 1) * CHAR;
      return w;
    });
  }),
});

const layout = (lines: PdfLine[]): PdfLayout => ({
  format: LAYOUT_FORMAT,
  version: 1,
  pages: Math.max(...lines.map((l) => l.p)),
  lines,
});

// HDFC's PDF: Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
const HDFC_HEADER = (p: number, y: number) =>
  line(p, y, [
    [30, 'Date'],
    [80, 'Narration'],
    [260, 'Chq./Ref.No.'],
    [340, 'Value Dt'],
    [400, 'Withdrawal Amt.'],
    [490, 'Deposit Amt.'],
    [560, 'Closing Balance'],
  ]);
const hdfcRow = (
  p: number,
  y: number,
  date: string,
  narration: string,
  out: string | null,
  inn: string | null,
  balance: string
) =>
  line(p, y, [
    [30, date],
    [80, narration],
    [260, '0000412345678901'],
    [340, date],
    ...(out ? ([[475, out, 'right']] as Cell[]) : []),
    ...(inn ? ([[555, inn, 'right']] as Cell[]) : []),
    [635, balance, 'right'],
  ]);

const HDFC = layout([
  line(1, 20, [[30, 'HDFC BANK LIMITED']]),
  line(1, 34, [[30, 'Statement of account']]),
  line(1, 48, [[30, 'Account No : 50100012341234']]),
  HDFC_HEADER(1, 100),
  hdfcRow(1, 120, '01/09/26', 'SALARY ACME CORP', null, '75,000.00', '5,75,000.00'),
  hdfcRow(1, 140, '02/09/26', 'UPI-SWIGGY LIMITED-SWIGGY', '450.00', null, '5,74,550.00'),
  line(1, 152, [[80, '@YBL-YESB0YBLUPI-123']]),
  hdfcRow(1, 172, '05/09/26', 'ACH D- BSE LTD ICCL-MF', '5,000.00', null, '5,69,550.00'),
  line(1, 780, [[30, 'Page 1 of 2']]),
  HDFC_HEADER(2, 100),
  hdfcRow(2, 120, '10/09/26', 'NETFLIX SUBSCRIPTION', '649.00', null, '5,68,901.00'),
  line(2, 200, [[30, 'STATEMENT SUMMARY']]),
  line(2, 214, [
    [30, 'Opening Balance'],
    [150, 'Debits'],
    [250, 'Credits'],
    [350, 'Closing Bal'],
  ]),
  line(2, 228, [
    [30, '5,00,000.00'],
    [150, '6,099.00'],
    [250, '75,000.00'],
    [350, '5,68,901.00'],
  ]),
]);

// Union Bank's PDF: SI | Date | Particulars | Chq Num | Withdrawal | Deposit | Balance. A serial
// number comes first, "Particulars" is centred over a column that starts well left of it, the
// narration wraps, and the figures sit on the wrapped line, not the dated one.
const UNION_HEADER = (p: number, y: number) =>
  line(p, y, [
    [29, 'SI'],
    [64, 'Date'],
    [150, 'Particulars'],
    [263, 'Chq Num'],
    [338, 'Withdrawal'],
    [426, 'Deposit'],
    [513, 'Balance'],
  ]);
const unionRow = (
  p: number,
  y: number,
  serial: string,
  date: string,
  first: string,
  second: string,
  out: string | null,
  inn: string | null,
  balance: string
) => [
  line(p, y, [[36, serial], [50, date], [105, first]]),
  line(p, y + 5.5, [
    [105, second],
    ...(out ? ([[395, out, 'right']] as Cell[]) : []),
    ...(inn ? ([[475, inn, 'right']] as Cell[]) : []),
    [560, balance, 'right'],
    [562, 'Cr'],
  ]),
];

const UNION = layout([
  line(1, 95, [[242, 'DETAILS OF STATEMENT']]),
  line(1, 134, [[25, 'Name & Address :'], [180, 'Customer ID :'], [275, '123456789']]),
  line(1, 154, [[25, 'A N OTHER'], [180, 'Account Number :'], [275, '5678XXXXXXX5501'], [365, 'IFSC :'], [410, 'UBIN0000001']]),
  UNION_HEADER(1, 314),
  ...unionRow(1, 335, '1', '01-08-2026', 'UPIAR/111111111111/DR/', 'YouTube/utib/youtube1.bd@ax', '149.00', null, '851.00'),
  ...unionRow(1, 357, '2', '02-08-2026', 'UPIAB/222222222222/CR/KUMA', 'R /SBIN/ 9876543210@ap', null, '5,000.00', '5,851.00'),
  // At the foot of a page the figures share the dated line, and the narration ends on the next page.
  line(1, 796, [[36, '3'], [50, '03-08-2026'], [105, 'UPIAR/333333333333/DR/Mohan'], [395, '300.00', 'right'], [560, '5,551.00', 'right'], [562, 'Cr']]),
  line(1, 816, [[529, '1 of 2']]),
  UNION_HEADER(2, 94),
  line(2, 114, [[105, '/YESB/paytmqr1abcde@']]),
  ...unionRow(2, 135, '4', '10-08-2026', 'NACH/ECS/1234567890/APOLLO', 'TYRES LIMITED/HDFC12345', '1.00', null, '5,550.00'),
  line(2, 156, [[266, 'Total Debits :'], [395, '450.00', 'right'], [408, 'Opening Balance :'], [560, '1,000.00', 'right'], [562, 'Cr']]),
  line(2, 176, [[263, 'Total Credits :'], [395, '5,000.00', 'right'], [413, 'Closing Balance :'], [560, '5,550.00', 'right'], [562, 'Cr']]),
  line(2, 214, [[34, 'SI'], [183, 'Account Number'], [485, 'Account Balance (Rs.)']]),
  line(2, 234, [[46, '1'], [60, 'CARCC'], [160, 'R123XXXXXXXX9999'], [560, '0.00', 'right'], [562, 'Cr']]),
  line(2, 816, [[529, '2 of 2']]),
]);

describe('reading dates the way Indian statements print them', () => {
  it.each([
    [['05/01/26'], '2026-01-05', 1],
    [['05/01/2026'], '2026-01-05', 1],
    [['5-1-2026'], '2026-01-05', 1],
    [['05.01.2026'], '2026-01-05', 1],
    [['05-Jan-2026'], '2026-01-05', 1],
    [['05-JAN-26'], '2026-01-05', 1],
    [['05', 'Jan', '2026'], '2026-01-05', 3],
    [['5', 'Sept', '2026'], '2026-09-05', 3],
  ])('%j is %s', (words, iso, used) => {
    expect(leadingDate(words)).toEqual({ iso, used });
  });

  it.each([[['Page']], [['13/13/2026']], [['0000412345678901']], [['1,234.00']]])(
    'is not fooled by %j',
    (words) => expect(leadingDate(words)).toBeNull()
  );
});

describe('PDF statement layout', () => {
  it('reads an HDFC statement: every row, both directions, across pages', () => {
    const rows = parseLayout(HDFC).getOrNull()!;

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ date: '2026-09-01', narration: 'SALARY ACME CORP' });
    expect(format(rows[0].credit!)).toBe('Rs 75,000.00');
    expect(rows[0].debit).toBeUndefined();

    expect(format(rows[1].debit!)).toBe('Rs 450.00');
    expect(format(rows[3].balance!)).toBe('Rs 5,68,901.00');
    expect(rows[3].date).toBe('2026-09-10');
  });

  it('joins a wrapped narration, and leaves the reference and value date out', () => {
    const rows = parseLayout(HDFC).getOrNull()!;
    expect(rows[1].narration).toBe('UPI-SWIGGY LIMITED-SWIGGY @YBL-YESB0YBLUPI-123');
    expect(rows[1].narration).not.toContain('0000412345678901');
  });

  it('keeps the masthead, page footers and summary out of the rows', () => {
    const narrations = parseLayout(HDFC).getOrNull()!.map((r) => r.narration).join(' ');
    expect(narrations).not.toMatch(/Page|SUMMARY|Account No/);
  });

  it('refuses a statement whose balances do not add up', () => {
    const broken = layout([
      HDFC_HEADER(1, 100),
      hdfcRow(1, 120, '01/09/26', 'SALARY', null, '75,000.00', '5,75,000.00'),
      hdfcRow(1, 140, '02/09/26', 'SWIGGY', '450.00', null, '5,74,000.00'),
    ]);
    const result = parseLayout(broken);
    expect(result.isErr() && result.error.code).toBe('BALANCE_CHECK_FAILED');
  });

  it('recovers when amounts sit closer to the wrong header, using the balance', () => {
    // Withdrawal header pushed right, so its amounts line up nearer Deposit.
    const skewed = layout([
      line(1, 100, [
        [30, 'Date'],
        [80, 'Narration'],
        [380, 'Withdrawal'],
        [470, 'Deposit'],
        [560, 'Balance'],
      ]),
      line(1, 110, [[30, '01/09/26'], [80, 'OPENING BALANCE'], [635, '1,000.00', 'right']]),
      line(1, 120, [[30, '02/09/26'], [80, 'SWIGGY'], [520, '200.00', 'right'], [635, '800.00', 'right']]),
      line(1, 140, [[30, '03/09/26'], [80, 'REFUND'], [520, '50.00', 'right'], [635, '850.00', 'right']]),
    ]);

    const rows = parseLayout(skewed).getOrNull()!;
    expect(rows).toHaveLength(2);
    expect(format(rows[0].debit!)).toBe('Rs 200.00');
    expect(format(rows[1].credit!)).toBe('Rs 50.00');
  });

  it('reads a single Amount column with Dr/Cr markers, as SBI and ICICI print', () => {
    const sbi = layout([
      line(1, 20, [[30, 'State Bank of India']]),
      line(1, 100, [
        [30, 'Txn Date'],
        [120, 'Description'],
        [380, 'Amount'],
        [500, 'Balance'],
      ]),
      line(1, 120, [[30, '1 Sep 2026'], [120, 'ATM WDL'], [420, '2,000.00', 'right'], [430, 'Dr'], [540, '48,000.00', 'right'], [545, 'Cr']]),
      line(1, 140, [[30, '2 Sep 2026'], [120, 'INTEREST'], [420, '120.00', 'right'], [430, 'Cr'], [540, '48,120.00', 'right'], [545, 'Cr']]),
    ]);

    const rows = parseLayout(sbi).getOrNull()!;
    expect(rows.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(format(rows[0].debit!)).toBe('Rs 2,000.00');
    expect(format(rows[1].credit!)).toBe('Rs 120.00');
  });

  it('refuses to guess the first row when nothing says which way it went', () => {
    const bare = layout([
      line(1, 100, [[30, 'Date'], [120, 'Description'], [380, 'Amount'], [500, 'Balance']]),
      line(1, 120, [[30, '01/09/26'], [120, 'SOMETHING'], [420, '2,000.00', 'right'], [540, '48,000.00', 'right']]),
    ]);
    const result = parseLayout(bare);
    expect(result.isErr() && result.error.message).toContain('went in or out');
  });

  it('reads a Union Bank statement: serial numbers, figures on the wrapped line, a row split by a page', () => {
    const rows = parseLayout(UNION).getOrNull()!;

    expect(rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-10']);
    expect(rows[0].narration).toBe('UPIAR/111111111111/DR/ YouTube/utib/youtube1.bd@ax');
    expect(format(rows[0].debit!)).toBe('Rs 149.00');
    expect(format(rows[1].credit!)).toBe('Rs 5,000.00');
    expect(rows[2].narration).toBe('UPIAR/333333333333/DR/Mohan /YESB/paytmqr1abcde@');
    expect(format(rows[2].debit!)).toBe('Rs 300.00');
    expect(rows[3].narration).toBe('NACH/ECS/1234567890/APOLLO TYRES LIMITED/HDFC12345');
    expect(format(rows[3].balance!)).toBe('Rs 5,550.00');
  });

  it('keeps serial numbers, page footers, totals and the linked-accounts table out of a Union statement', () => {
    const rows = parseLayout(UNION).getOrNull()!;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.narration).join(' ')).not.toMatch(/of 2|Total|CARCC|^1 /);
  });

  it('reads whose account a statement is from its masthead, not from tables further down', () => {
    expect(statementLast4(UNION)).toBe('5501');
    expect(statementLast4(HDFC)).toBe('1234');
    const none = layout([UNION_HEADER(1, 100), line(1, 120, [[25, 'Account Number :'], [275, '5678XXXXXXX9999']])]);
    expect(statementLast4(none)).toBeUndefined();
  });

  it('says so when there is no transaction table at all', () => {
    const result = parseLayout(layout([line(1, 20, [[30, 'Dear customer, thank you']])]));
    expect(result.isErr() && result.error.code).toBe('INVALID_FORMAT');
  });

  it('is found by the parser registry ahead of the bank-name parsers', () => {
    const text = JSON.stringify(HDFC);
    expect(detectParser(text)?.id).toBe(PdfLayoutParser.id);
    expect(PdfLayoutParser.parse(text).getOrNull()).toHaveLength(4);
  });
});

describe('a PDF statement through the whole import', () => {
  it('lands in the ledger, keeps the layout as raw input, and replays', async () => {
    const { Database } = await import('@/db/client');
    const { NodeSqliteDriver } = await import('@/db/drivers/node');
    const { importStatement, replayRawRecord } = await import('@/repo/import');
    const { accountsWithBalances, monthSummary } = await import('@/repo/views');

    const db = new Database(new NodeSqliteDriver());
    db.initialize();
    const account = db
      .createAccount({ name: 'HDFC Savings', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!;

    const text = JSON.stringify(HDFC);
    const result = importStatement(db, {
      text,
      sourceRef: 'Acct_Statement_Sep.pdf',
      source: 'statement_pdf',
      account,
    }).getOrNull()!;
    expect(result.rowsParsed).toBe(4);

    const [raw] = db.getRawRecords().getOrNull()!;
    expect(raw.payload).toBe(text);
    expect(raw.parser).toBe('pdf_layout_v1');

    // The statement's own closing balance is the account's balance.
    expect(format(accountsWithBalances(db)[0].balance)).toBe('Rs 5,68,901.00');
    // The SIP went to Investments, so September's spending is Swiggy and Netflix.
    expect(format(monthSummary(db, new Date(2026, 8, 15)).spent)).toBe('Rs 1,099.00');

    const replayed = replayRawRecord(db, raw.id, account).getOrNull()!;
    expect(replayed.rowsParsed).toBe(0);
    expect(replayed.duplicatesSkipped).toBe(4);
    db.close();
  });
});
