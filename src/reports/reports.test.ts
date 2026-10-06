import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { reportView, largestSpends, spendingCategoryNames } from '@/repo/reports';
import { paise } from '@/money/money';
import { rupees } from '@/lib/rupees';
import type { Goal } from '@/repo/goals';
import type { Id } from '@/lib/ulid';
import { cashFlow, cashFlowLines, goalLine, goalProgress, monthSummary, type DocSection } from './doc';
import { escapeHtml, reportHtml } from './html';

const TODAY = new Date(2026, 8, 20, 12); // 20 Sep 2026
const money = (p: Parameters<typeof rupees>[0]) => rupees(p);

const table = (sections: DocSection[], title: string) => {
  const found = sections.find((s) => s.kind === 'table' && s.title === title);
  if (!found || found.kind !== 'table') throw new Error(`no table ${title}`);
  return found;
};

describe('report documents', () => {
  let db: Database;
  let bank: Id;
  let cash: Id;

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
    bank = db.createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false }).getOrNull()!.id;
    cash = db.createAccount({ name: 'Cash', kind: 'asset', subkind: 'cash', isSystem: false }).getOrNull()!.id;

    recordTransaction(db, { kind: 'income', amount: paise(5000000), accountId: bank, description: 'Salary', occurredAt: '2026-09-01' });
    spend(120000, '2026-09-03', 'Rent share', 'cat_bills');
    spend(30000, '2026-09-03', 'Lunch', 'cat_food');
    recordTransaction(db, { kind: 'income', amount: paise(4000000), accountId: bank, description: 'Salary', occurredAt: '2026-08-01' });
    spend(4500000, '2026-08-12', 'Laptop', 'cat_shopping');
    spend(100000, '2026-07-12', 'Groceries', 'cat_groceries');
    // Moved, not spent: must stay out of every total and of the largest payments.
    recordTransaction(db, { kind: 'transfer', amount: paise(9000000), accountId: bank, toAccountId: cash, description: 'Cash out', occurredAt: '2026-09-05' });
  });

  afterEach(() => db.close());

  it('lists every spending category in the month summary, the quiet ones at ₹0', () => {
    const doc = monthSummary(reportView(db, '2026-09', TODAY), spendingCategoryNames(db), money);
    expect(doc.subtitle).toBe('September 2026 · 3 transactions');
    const categories = table(doc.sections, 'Spending by category');
    expect(categories.rows[0]).toEqual(['Bills', '1', '₹1,200', '80%']);
    expect(categories.rows[1]).toEqual(['Food & Dining', '1', '₹300', '20%']);
    expect(categories.rows).toContainEqual(['Groceries', '0', '₹0', '0%']);
    expect(categories.rows.map((r) => r[0])).not.toContain('Transfers');
    expect(categories.rows.map((r) => r[0])).not.toContain('Salary');
    const summary = doc.sections[0];
    expect(summary.kind === 'figures' && summary.figures[1].note).toBe('97% less than August (₹45,000)');
  });

  it('puts six months side by side, says what they show, and leaves transfers out', () => {
    const view = reportView(db, '2026-09', TODAY);
    const doc = cashFlow(view, largestSpends(db, view.flow[0].key, view.month.key), money);
    expect(doc.subtitle).toBe('Apr 2026 to Sep 2026');
    expect(table(doc.sections, 'Month by month').rows).toHaveLength(6);
    expect(table(doc.sections, 'Month by month').rows[4]).toEqual(['Aug 2026', '₹40,000', '₹45,000', '-₹5,000']);
    expect(table(doc.sections, 'Largest payments').rows.map((r) => r[1])).toEqual(['Laptop', 'Rent share', 'Groceries', 'Lunch']);

    expect(cashFlowLines(view, money)).toEqual([
      'Over these six months ₹90,000 came in and ₹47,500 went out: ₹42,500 more came in than went out.',
      'Spending was highest in Aug 2026 (₹45,000) and lowest in Jul 2026 (₹1,000).',
      'In 2 of these 3 months with money moving, more went out than came in.',
    ]);
  });

  it('works out what each goal still needs from its own target and date', () => {
    const goal = (savedAmount: number, targetAmount: number, targetDate?: string): Goal => ({
      id: 'g' as Id,
      name: 'Bike',
      savedAmount: paise(savedAmount),
      targetAmount: paise(targetAmount),
      targetDate,
      createdAt: '2026-01-01',
    });
    expect(goalLine(goal(5000000, 5000000), '2026-09-20', money)).toBe('Bike: target reached.');
    expect(goalLine(goal(1000000, 5000000), '2026-09-20', money)).toBe('Bike: ₹40,000 to go, with no date set.');
    expect(goalLine(goal(1000000, 5000000, '2027-03-01'), '2026-09-20', money)).toBe(
      'Bike: ₹40,000 to go by 1 Mar 2027, about ₹6,667 a month for 6 months.'
    );
    expect(goalLine(goal(1000000, 5000000, '2026-01-01'), '2026-09-20', money)).toBe(
      'Bike: ₹40,000 to go; the date set, 1 Jan 2026, has passed.'
    );
    const doc = goalProgress([goal(1000000, 5000000, '2027-03-01')], '2026-09-20', money);
    expect(table(doc.sections, 'Goals').rows[0]).toEqual(['Bike', '₹10,000', '₹50,000', '20%', '1 Mar 2027']);
    expect(goalProgress([], '2026-09-20', money).sections[2]).toMatchObject({ lines: ['Nothing to work out without a goal.'] });
  });

  it('builds with whatever formatter it is given, so the screen can hide every amount', () => {
    const hidden = () => '₹ • • •';
    const doc = monthSummary(reportView(db, '2026-09', TODAY), [], hidden);
    expect(JSON.stringify(doc)).not.toMatch(/₹\d/);
  });

  it('writes a page with no scripts, and a payee name cannot add one', () => {
    spend(70000, '2026-09-12', '<script>alert(1)</script>', 'cat_food');
    const view = reportView(db, '2026-09', TODAY);
    const html = reportHtml(cashFlow(view, largestSpends(db, view.flow[0].key, view.month.key), money), '20 Sep 2026');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain("default-src 'none'");
    expect(escapeHtml(`"a" & 'b'`)).toBe('&quot;a&quot; &amp; &#39;b&#39;');
  });
});
