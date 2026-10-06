import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { importStatement } from './import';
import { recordTransaction } from './manual';
import { accountsWithBalances } from './views';
import {
  safeToSpendView,
  subscriptionsView,
  insightsView,
  ledgerLines,
  sharedLedgerScan,
  readAnalysis,
  paydayOf,
  setPayday,
  setCashFloor,
} from './analysisViews';
import { paise, format, sum } from '@/money/money';

const HEADER =
  'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description';

/** Rows as [date, signed paise, narration]; running balances are worked out here. */
const statement = (opening: number, rows: Array<[string, number, string]>): string => {
  let balance = opening;
  const rupees = (p: number) => (p / 100).toFixed(2);
  const lines = rows.map(([date, amount, narration]) => {
    balance += amount;
    const debit = amount < 0 ? rupees(-amount) : '';
    const credit = amount > 0 ? rupees(amount) : '';
    return `${date},${date},${debit},${credit},${rupees(balance)},${narration}`;
  });
  return [HEADER, ...lines].join('\n');
};

const THREE_MONTHS: Array<[string, number, string]> = [
  ['2026-06-25', -64900, 'NETFLIX SUBSCRIPTION'],
  ['2026-07-01', 7500000, 'NEFT/ACME CORP/SALARY JUL'],
  ['2026-07-10', -120000, 'UPI/BLINKIT/ORDER 1'],
  ['2026-07-25', -64900, 'NETFLIX SUBSCRIPTION'],
  ['2026-08-01', 7500000, 'NEFT/ACME CORP/SALARY AUG'],
  ['2026-08-12', -240000, 'UPI/BLINKIT/ORDER 2'],
  ['2026-08-25', -64900, 'NETFLIX SUBSCRIPTION'],
  ['2026-09-01', 7500000, 'NEFT/ACME CORP/SALARY SEP'],
  ['2026-09-05', -90000, 'UPI/BLINKIT/ORDER 3'],
];

const TODAY = new Date(2026, 8, 20);

let db: Database;
let bank: Account;

const load = (text: string) =>
  importStatement(db, { text, sourceRef: 'test.csv', source: 'statement_csv', account: bank });

beforeEach(() => {
  db = new Database(new NodeSqliteDriver());
  db.initialize();
  bank = db
    .createAccount({ name: 'HDFC Savings', kind: 'asset', last4: '1234', isSystem: false })
    .getOrNull()!;
});

afterEach(() => db.close());

describe('real balances', () => {
  it('uses the bank closing balance, not just the movements imported', () => {
    load(statement(5000000, THREE_MONTHS));

    // Opened with Rs 50,000 the ledger never saw; closed at Rs 2,68,553.
    expect(format(db.getBalance(bank.id).getOrNull()!)).toBe('Rs 2,18,553.00');
    expect(format(db.reportedBalance(bank.id).getOrNull()!)).toBe('Rs 2,68,553.00');
    expect(format(accountsWithBalances(db)[0].balance)).toBe('Rs 2,68,553.00');
  });

  it('adds what was recorded after the statement ends', () => {
    load(statement(5000000, THREE_MONTHS));
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(100000),
      accountId: bank.id,
      description: 'Rent share',
      occurredAt: '2026-09-10',
    });

    expect(format(db.reportedBalance(bank.id).getOrNull()!)).toBe('Rs 2,67,553.00');
  });

  it('keeps the newest statement balance when an older one is imported later', () => {
    load(statement(5000000, THREE_MONTHS));
    load(statement(1000000, [['2026-05-10', -50000, 'OLD PURCHASE']]));

    expect(db.getBalanceAnchor(bank.id).getOrNull()!.asOf).toBe('2026-09-05');
  });

  it('falls back to the ledger for an account with no statement', () => {
    recordTransaction(db, {
      kind: 'income',
      amount: paise(500000),
      accountId: bank.id,
      description: 'Gift',
      occurredAt: '2026-09-10',
    });

    expect(format(db.reportedBalance(bank.id).getOrNull()!)).toBe('Rs 5,000.00');
  });
});

describe('payday', () => {
  it('finds it from salary credits a month apart', () => {
    load(statement(5000000, THREE_MONTHS));
    expect(paydayOf(db, TODAY)).toEqual({ day: 1, source: 'pattern' });
  });

  it('asks when there is nothing to find it from', () => {
    load(statement(5000000, [['2026-09-05', -90000, 'UPI/BLINKIT/ORDER 3']]));

    const view = safeToSpendView(db, TODAY);
    expect(view.status).toBe('needs_payday');
  });

  it('lets the user say, and uses that over anything detected', () => {
    load(statement(5000000, THREE_MONTHS));
    expect(setPayday(db, 25).isOk()).toBe(true);

    expect(paydayOf(db, TODAY)).toEqual({ day: 25, source: 'set' });
  });

  it('goes back to detection when the setting is cleared', () => {
    load(statement(5000000, THREE_MONTHS));
    setPayday(db, 25);
    setPayday(db, null);

    expect(paydayOf(db, TODAY)!.source).toBe('pattern');
  });

  it('refuses a day that does not exist', () => {
    expect(setPayday(db, 0).isErr()).toBe(true);
    expect(setPayday(db, 32).isErr()).toBe(true);
  });
});

describe('safe to spend, from the ledger', () => {
  it('itemises to exactly the headline figure', () => {
    load(statement(5000000, THREE_MONTHS));
    const view = safeToSpendView(db, TODAY);
    if (view.status !== 'ready') throw new Error('expected a figure');

    expect(sum(view.result.lines.map((l) => l.amount))).toBe(view.result.amount);
  });

  it('runs until the next salary', () => {
    load(statement(5000000, THREE_MONTHS));
    const view = safeToSpendView(db, TODAY);
    if (view.status !== 'ready') throw new Error('expected a figure');

    expect(view.nextIncome).toBe('2026-10-01');
    expect(view.result.daysInWindow).toBe(11);
  });

  it('starts from the real balance and holds back the Netflix renewal', () => {
    load(statement(5000000, THREE_MONTHS));
    const view = safeToSpendView(db, TODAY);
    if (view.status !== 'ready') throw new Error('expected a figure');

    const liquid = view.result.lines.find((l) => l.kind === 'liquid')!;
    const bills = view.result.lines.filter((l) => l.kind === 'bill');

    expect(format(liquid.amount)).toBe('Rs 2,68,553.00');
    expect(bills).toHaveLength(1);
    expect(bills[0].label).toBe('Netflix, due 25 Sep');
    expect(format(bills[0].amount)).toBe('-Rs 649.00');
  });

  it('forecasts everyday spend without counting the subscription again', () => {
    load(statement(5000000, THREE_MONTHS));
    const view = safeToSpendView(db, TODAY);
    if (view.status !== 'ready') throw new Error('expected a figure');

    // Rs 4,500 of Blinkit over the 73 days from 25 June to 5 September; the
    // three Netflix charges are bills, not everyday spend.
    expect(view.basisDays).toBe(73);
    expect(format(view.dailyDiscretionary)).toBe('Rs 61.64');
    expect(format(view.result.amount)).toBe('Rs 2,67,225.96');
  });

  it('holds back the minimum balance once one is set', () => {
    load(statement(5000000, THREE_MONTHS));
    const before = safeToSpendView(db, TODAY);
    setCashFloor(db, paise(1000000));
    const after = safeToSpendView(db, TODAY);
    if (before.status !== 'ready' || after.status !== 'ready') throw new Error('expected figures');

    expect(before.result.amount - after.result.amount).toBe(1000000);
    expect(after.result.lines.some((l) => l.kind === 'floor')).toBe(true);
  });

  it('leaves out a bank account whose balance was never told, as wealth does', () => {
    load(statement(5000000, THREE_MONTHS));
    const sbi = db.createAccount({ name: 'SBI', kind: 'asset', subkind: 'bank', last4: '7702', isSystem: false }).getOrNull()!;
    recordTransaction(db, { kind: 'expense', amount: paise(423898), accountId: sbi.id, description: 'Rent', occurredAt: '2023-07-27' });

    const view = safeToSpendView(db, TODAY);
    if (view.status !== 'ready') throw new Error('expected a figure');
    expect(format(view.result.lines.find((l) => l.kind === 'liquid')!.amount)).toBe('Rs 2,68,553.00');
    expect(view.leftOut).toEqual(['SBI']);
  });

  it('says which statement the balance comes from', () => {
    load(statement(5000000, THREE_MONTHS));
    const view = safeToSpendView(db, TODAY);
    if (view.status !== 'ready') throw new Error('expected a figure');

    expect(view.balanceAsOf).toBe('2026-09-05');
  });

  it('dates the balance by statements only, not by a hand-kept wallet', async () => {
    const { setBalanceNow } = await import('./manual');
    load(statement(5000000, THREE_MONTHS));
    const wallet = db.createAccount({ name: 'Asha expenses', kind: 'asset', subkind: 'cash', institution: 'Paisa', isSystem: false }).getOrNull()!;
    setBalanceNow(db, wallet.id, paise(0), '2026-08-20');

    const view = safeToSpendView(db, TODAY);
    if (view.status !== 'ready') throw new Error('expected a figure');
    expect(view.balanceAsOf).toBe('2026-09-05');
  });
});

describe('subscriptions, from the ledger', () => {
  it('finds Netflix and leaves the grocery orders out', () => {
    load(statement(5000000, THREE_MONTHS));
    const view = subscriptionsView(db, TODAY);

    expect(view.active.map((s) => s.merchantName)).toEqual(['Netflix']);
    expect(view.active[0].cadence).toBe('monthly');
    expect(format(view.totalAnnual)).toBe('Rs 7,788.00');
  });

  it('treats a subscription as dormant once the data moves past it', () => {
    load(
      statement(5000000, [
        ...THREE_MONTHS,
        ['2026-12-15', -90000, 'UPI/BLINKIT/ORDER 4'],
      ])
    );
    const view = subscriptionsView(db, new Date(2026, 11, 20));

    expect(view.active).toHaveLength(0);
    expect(view.dormant.map((s) => s.merchantName)).toEqual(['Netflix']);
  });
});

describe('insights, from the ledger', () => {
  it('stays silent with under three months of history', () => {
    load(statement(5000000, [['2026-09-05', -90000, 'UPI/BLINKIT/ORDER 3']]));
    const view = insightsView(db, TODAY);

    expect(view.monthsOfHistory).toBe(1);
    expect(view.insights).toHaveLength(0);
  });

  it('never shows a raw category id', () => {
    load(statement(5000000, THREE_MONTHS));
    const view = insightsView(db, TODAY);

    expect(view.monthsOfHistory).toBe(4);
    expect(view.insights.length).toBeGreaterThan(0);
    for (const insight of view.insights) {
      expect(insight.sentence).not.toMatch(/cat_/);
    }
  });

  it('does not call hand-logged purchases a duplicate charge, though a bank charge repeated is', () => {
    load(statement(5000000, THREE_MONTHS));
    for (const date of ['2026-09-10', '2026-09-11']) {
      recordTransaction(db, { kind: 'expense', amount: paise(17000), accountId: bank.id, description: 'Chicken', occurredAt: date });
    }
    const view = insightsView(db, TODAY);
    expect(view.insights.some((i) => i.kind === 'duplicate_charge')).toBe(false);
  });

  it('does not call two payments through the bank\'s own app a repeat charge: "Mob Bk" is not a payee', () => {
    load(
      statement(5000000, [
        ...THREE_MONTHS,
        ['2026-09-10', -1000, 'Mob Bk'],
        ['2026-09-11', -1000, 'Mob Bk'],
      ])
    );
    const view = insightsView(db, TODAY);
    expect(view.insights.some((i) => i.kind === 'duplicate_charge')).toBe(false);
  });

  it('notices that something bought again and again now costs more, from what was typed in', () => {
    load(statement(5000000, THREE_MONTHS));
    const buy = (rupees: number, date: string) =>
      recordTransaction(db, {
        kind: 'expense',
        amount: paise(rupees * 100),
        accountId: bank.id,
        description: 'Chicken',
        occurredAt: date,
        categoryId: 'cat_food' as never,
      });
    for (let i = 0; i < 12; i++) buy(150, `2025-11-${String(i + 1).padStart(2, '0')}`);
    for (let i = 0; i < 12; i++) buy(170, `2026-03-${String(i + 1).padStart(2, '0')}`);
    for (const day of ['03', '04', '11']) buy(180, `2026-09-${day}`);

    const view = insightsView(db, TODAY);
    const move = view.insights.find((i) => i.kind === 'price_move')!;
    expect(move.sentence).toBe(
      'Chicken now costs Rs 180.00, up 6% on Rs 170.00, since 3 Sep. It was Rs 150.00 in Nov 2025.'
    );
    // The purchases either side of the change, each one there to check.
    expect(move.evidence).toHaveLength(5);
    for (const id of move.evidence) expect(view.evidence[id].name).toBe('Chicken');
  });

  it('carries the entries behind each claim', () => {
    load(
      statement(5000000, [
        ...THREE_MONTHS,
        ['2026-09-10', -45000, 'UPI/SWIGGY/ORDER 7'],
        ['2026-09-11', -45000, 'UPI/SWIGGY/ORDER 8'],
      ])
    );
    const view = insightsView(db, TODAY);

    const duplicate = view.insights.find((i) => i.kind === 'duplicate_charge')!;
    expect(duplicate.evidence).toHaveLength(2);
    for (const id of duplicate.evidence) {
      expect(view.evidence[id].name).toBe('Swiggy');
      expect(format(view.evidence[id].amount)).toBe('-Rs 450.00');
    }
  });
});

describe('one scan shared by a read pass', () => {
  const read = () => ({
    safeToSpend: safeToSpendView(db, TODAY),
    subscriptions: subscriptionsView(db, TODAY),
    insights: insightsView(db, TODAY),
  });
  const joins = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([sql]) => String(sql).includes('GROUP BY e.id')).length;

  it('gives every view the same answer as reading each on its own', () => {
    load(statement(5000000, THREE_MONTHS));
    setPayday(db, 1);

    const alone = read();
    const together = readAnalysis(db, TODAY);

    expect(together).toEqual(alone);
    expect(together.safeToSpend.status).toBe('ready');
  });

  it('cuts a shorter window from the longer scan with the same rows in the same order', () => {
    load(statement(5000000, THREE_MONTHS));

    const [long, short] = sharedLedgerScan(() => [ledgerLines(db, '2026-01-01'), ledgerLines(db, '2026-08-01')]);

    expect(short).toEqual(ledgerLines(db, '2026-08-01'));
    expect(short.length).toBeLessThan(long.length);
  });

  it.each([1, null])('runs the join once for the three views, where it ran several times before (payday %s)', (day) => {
    load(statement(5000000, THREE_MONTHS));
    setPayday(db, day);
    const spy = vi.spyOn(db, 'query');

    read();
    const separately = joins(spy);
    spy.mockClear();
    readAnalysis(db, TODAY);

    expect(separately).toBeGreaterThan(3);
    expect(joins(spy)).toBe(1);
  });

  it('forgets the scan afterwards, so a new entry shows up on the next read', () => {
    load(statement(5000000, THREE_MONTHS));
    sharedLedgerScan(() => ledgerLines(db, '2026-01-01'));
    recordTransaction(db, { kind: 'expense', amount: paise(5000), accountId: bank.id, description: 'Tea', occurredAt: '2026-09-12' });

    expect(ledgerLines(db, '2026-09-12').some((l) => l.name === 'Tea')).toBe(true);
  });

  it('leaves the pass closed when a view throws', () => {
    load(statement(5000000, THREE_MONTHS));
    const scanThenThrow = () => {
      ledgerLines(db, '2026-01-01');
      throw new Error('boom');
    };
    expect(() => sharedLedgerScan(scanThenThrow)).toThrow('boom');
    recordTransaction(db, { kind: 'expense', amount: paise(5000), accountId: bank.id, description: 'Tea', occurredAt: '2026-09-12' });

    expect(ledgerLines(db, '2026-09-12').some((l) => l.name === 'Tea')).toBe(true);
  });
});
