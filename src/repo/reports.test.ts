import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { monthSummary } from '@/repo/views';
import { reportView, spendByDay, categoryFlow } from './reports';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

const TODAY = new Date(2026, 8, 20, 12); // 20 Sep 2026

describe('reportView', () => {
  let db: Database;
  let bank: Id;

  const spend = (amount: number, date: string, description: string, categoryId?: string) =>
    recordTransaction(db, {
      kind: 'expense',
      amount: paise(amount),
      accountId: bank,
      description,
      occurredAt: date,
      categoryId: categoryId as Id | undefined,
    });

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db
      .createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!.id;

    recordTransaction(db, { kind: 'income', amount: paise(5000000), accountId: bank, description: 'Salary', occurredAt: '2026-09-01' });
    spend(120000, '2026-09-03', 'Rent share', 'cat_bills');
    spend(30000, '2026-09-03', 'Lunch', 'cat_food');
    spend(50000, '2026-09-10', 'Dinner', 'cat_food');
    // August, for the comparison.
    recordTransaction(db, { kind: 'income', amount: paise(4000000), accountId: bank, description: 'Salary', occurredAt: '2026-08-01' });
    spend(100000, '2026-08-12', 'Groceries', 'cat_groceries');
  });

  afterEach(() => db.close());

  it('agrees with the Home totals for the same month', () => {
    const report = reportView(db, '2026-09', TODAY);
    const home = monthSummary(db, new Date(2026, 8, 15));
    expect(report.expense).toBe(home.spent);
    expect(report.income).toBe(home.received);
    expect(format(report.expense)).toBe('Rs 2,000.00');
    expect(format(report.net)).toBe('Rs 48,000.00');
  });

  it('compares with the month before, and says nothing when there is nothing to compare', () => {
    const september = reportView(db, '2026-09', TODAY);
    expect(september.expenseChange).toBe(100);
    expect(september.incomeChange).toBe(25);
    expect(format(september.previous.expense)).toBe('Rs 1,000.00');

    const august = reportView(db, '2026-08', TODAY);
    expect(august.expenseChange).toBeUndefined();
  });

  it('works out the quick insights', () => {
    const r = reportView(db, '2026-09', TODAY);
    expect(r.savingsRate).toBe(96);
    expect(r.transactions).toBe(4);
    expect(format(r.avgDaily)).toBe('Rs 100.00'); // 2,000 over the 20 days so far
    expect(format(r.avgTransaction)).toBe('Rs 666.67'); // 2,000 over 3 payments
    expect(r.peakDay).toEqual({ date: '2026-09-03', amount: paise(150000) });
    expect(r.largest).toMatchObject({ name: 'Rent share', category: 'Bills', date: '2026-09-03' });
  });

  it('averages a finished month over all its days', () => {
    const august = reportView(db, '2026-08', TODAY);
    expect(format(august.avgDaily)).toBe('Rs 32.26'); // 1,000 over 31 days
  });

  it('lays out every day of the month and each category with its share', () => {
    const r = reportView(db, '2026-09', TODAY);
    expect(r.daily).toHaveLength(30);
    expect(r.daily[2]).toEqual({ day: 3, amount: paise(150000) });
    expect(r.daily[0].amount).toBe(paise(0));

    expect(r.categories.map((c) => [c.name, c.percentage, c.count])).toEqual([
      ['Bills', 60, 1],
      ['Food & Dining', 40, 2],
    ]);
  });

  it('never counts a transfer or an investment as spending', () => {
    recordTransaction(db, { kind: 'investment', amount: paise(900000), accountId: bank, description: 'SIP', occurredAt: '2026-09-05' });
    expect(format(reportView(db, '2026-09', TODAY).expense)).toBe('Rs 2,000.00');
  });

  it('offers this month even when empty, and falls back to it for an unknown month', () => {
    const empty = new Database(new NodeSqliteDriver());
    empty.initialize();
    const r = reportView(empty, '1999-01', TODAY);
    expect(r.month.key).toBe('2026-09');
    expect(r.months.map((m) => m.key)).toEqual(['2026-09']);
    expect(r.savingsRate).toBeUndefined();
    expect(r.largest).toBeUndefined();
    expect(format(r.avgDaily)).toBe('Rs 0.00');
    empty.close();
  });

  it('reads the bars and categories from the income side on request, leaving the spending insights alone', () => {
    recordTransaction(db, { kind: 'income', amount: paise(200000), accountId: bank, description: 'Interest', occurredAt: '2026-09-09', categoryId: 'cat_savings' as Id });
    const r = reportView(db, '2026-09', TODAY, 'income');
    expect(r.side).toBe('income');
    expect(r.daily[0].amount).toBe(paise(5000000));
    expect(r.daily[8].amount).toBe(paise(200000));
    expect(r.daily[2].amount).toBe(paise(0)); // the 3rd was only spending
    expect(r.categories.map((c) => [c.name, c.percentage])).toEqual([
      ['Salary', 96],
      ['Savings', 4],
    ]);
    // Peak day, average payment and the rest still describe spending.
    expect(r.peakDay).toEqual({ date: '2026-09-03', amount: paise(150000) });
    expect(format(r.expense)).toBe('Rs 2,000.00');
  });

  it('lays out six months of income and spending ending with the one shown, empty months included', () => {
    const { flow } = reportView(db, '2026-09', TODAY);
    expect(flow.map((f) => f.key)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(flow.map((f) => f.label)).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
    expect(format(flow[0].income)).toBe('Rs 0.00');
    expect(format(flow[4].income)).toBe('Rs 40,000.00');
    expect(format(flow[4].expense)).toBe('Rs 1,000.00');
    expect(format(flow[5].net)).toBe('Rs 48,000.00');
  });

  it('counts a spend in the flow the way the totals do — never a transfer or an investment', () => {
    recordTransaction(db, { kind: 'investment', amount: paise(900000), accountId: bank, description: 'SIP', occurredAt: '2026-09-05' });
    expect(format(reportView(db, '2026-09', TODAY).flow[5].expense)).toBe('Rs 2,000.00');
  });

  it('carries the flow across a year boundary', () => {
    recordTransaction(db, { kind: 'income', amount: paise(1000000), accountId: bank, description: 'Bonus', occurredAt: '2026-01-15' });
    const { flow } = reportView(db, '2026-01', TODAY);
    expect(flow.map((f) => f.key)).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
    expect(format(flow[5].income)).toBe('Rs 10,000.00');
  });

  it('gives what went out on each day of a month for the Home calendar', () => {
    const days = spendByDay(db, '2026-09');
    expect(days).toHaveLength(30);
    expect(days[0]).toBe(paise(0)); // the salary came in on the 1st; nothing went out
    expect(days[2]).toBe(paise(150000));
    expect(days[9]).toBe(paise(50000));
    expect(spendByDay(db, '2026-02')).toHaveLength(28);
  });

  it('lists months newest first', () => {
    expect(reportView(db, undefined, TODAY).months.map((m) => m.label)).toEqual(['September 2026', 'August 2026']);
  });
});

describe('categoryFlow', () => {
  let db: Database;
  let bank: Id;
  let wallet: Id;

  const spend = (amount: number, date: string, description: string, categoryId: string, accountId = bank) =>
    recordTransaction(db, { kind: 'expense', amount: paise(amount), accountId, description, occurredAt: date, categoryId: categoryId as Id });

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db.createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false }).getOrNull()!.id;
    wallet = db.createAccount({ name: 'Wallet', kind: 'asset', subkind: 'bank', last4: '5678', isSystem: false }).getOrNull()!.id;
    recordTransaction(db, { kind: 'income', amount: paise(6800000), accountId: bank, description: 'Salary', occurredAt: '2026-09-01' });
    spend(210000, '2026-09-03', 'Zomato', 'cat_food');
    spend(190000, '2026-09-05', 'Blinkit', 'cat_food');
    spend(20000, '2026-09-06', 'Zomato', 'cat_food', wallet);
    spend(120000, '2026-09-08', 'Cafe', 'cat_food');
    spend(50000, '2026-09-09', 'Bakery', 'cat_food');
    spend(40000, '2026-09-10', 'Tea stall', 'cat_food');
    spend(300000, '2026-09-11', 'Rent share', 'cat_bills');
    spend(99900, '2026-08-11', 'Zomato', 'cat_food');
  });

  afterEach(() => db.close());

  it('follows the money from what came in, through the account, to the payees', () => {
    const flow = categoryFlow(db, '2026-09', 'Food & Dining')!;
    expect(format(flow.received)).toBe('Rs 68,000.00');
    expect(flow.source).toEqual({ name: 'Salary', amount: paise(6800000) });
    expect(format(flow.category.amount)).toBe('Rs 6,300.00');
    expect(flow.category.count).toBe(6);
    expect(flow.category.shareOfSpending).toBe(68); // 6,300 of 9,300
    expect(flow.category.shareOfReceived).toBe(9);
    expect(flow.accounts.map((a) => [a.name, a.amount])).toEqual([
      ['Bank', paise(610000)],
      ['Wallet', paise(20000)],
    ]);
  });

  it('names the biggest payees and puts the rest together, so the pieces add up to the category', () => {
    const flow = categoryFlow(db, '2026-09', 'Food & Dining')!;
    expect(flow.merchants.map((m) => [m.name, m.amount, m.count])).toEqual([
      ['Zomato', paise(230000), 2],
      ['Blinkit', paise(190000), 1],
      ['Cafe', paise(120000), 1],
      ['Bakery', paise(50000), 1],
    ]);
    expect(flow.others).toBe(paise(40000));
    const total = flow.merchants.reduce((sum, m) => sum + m.amount, 0) + flow.others;
    expect(total).toBe(flow.category.amount);
  });

  it('agrees with the report for the same category', () => {
    const report = reportView(db, '2026-09', new Date(2026, 8, 20), 'expense');
    const food = report.categories.find((c) => c.name === 'Food & Dining')!;
    expect(categoryFlow(db, '2026-09', 'Food & Dining')!.category.amount).toBe(food.amount);
  });

  it('has nothing to say about a category with no spending that month', () => {
    expect(categoryFlow(db, '2026-09', 'Healthcare')).toBeNull();
    expect(categoryFlow(db, '2026-07', 'Food & Dining')).toBeNull();
  });

  it('does not invent a source when nothing came in', () => {
    const flow = categoryFlow(db, '2026-08', 'Food & Dining')!;
    expect(flow.received).toBe(paise(0));
    expect(flow.source).toBeUndefined();
    expect(flow.category.shareOfReceived).toBeUndefined();
  });
});
