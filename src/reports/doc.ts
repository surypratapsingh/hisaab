import { paise, subtract, sum, type Paise } from '@/money/money';
import type { ReportView, Spend } from '@/repo/reports';
import type { Goal } from '@/repo/goals';
import { MONTH_NAMES, dateWithYear, monthYear, shortDate } from '@/lib/date';

/**
 * A report as a document: one shell (title, subtitle, sections, footnote) that the app draws
 * on screen and `reportHtml` writes to a file. Every figure is already text, made with the
 * `money` formatter it was built with, so the screen can hide amounts and the file cannot.
 * Reports describe what happened; none says what to do with the money.
 */
export type ReportKind = 'month-summary' | 'cash-flow' | 'goal-progress';

export type Figure = { label: string; value: string; note?: string; tone?: 'in' | 'out' };

export type DocSection =
  | { kind: 'figures'; title: string; figures: Figure[] }
  | { kind: 'table'; title: string; columns: string[]; numeric: boolean[]; rows: string[][]; empty: string }
  | { kind: 'callout'; title: string; lines: string[] };

export type ReportDoc = {
  kind: ReportKind;
  title: string;
  subtitle: string;
  sections: DocSection[];
  footnote: string;
  /** A name for the saved file, without the extension. */
  fileName: string;
};

export type Money = (amount: Paise) => string;

/** The reports the Reports screen offers, in order. */
export const REPORTS: Array<{ kind: ReportKind; title: string; description: string }> = [
  { kind: 'month-summary', title: 'Month Summary', description: 'Money in and out, key figures, every category' },
  { kind: 'cash-flow', title: 'Cash Flow Analysis', description: 'Six months side by side, in plain words' },
  { kind: 'goal-progress', title: 'Goal Progress', description: 'What each goal has, and what it still needs' },
];

const FOOTNOTE =
  'Totals count money in and out of your own accounts. Transfers between them and investments never count as spending or income. Figures come from what Hisaab has recorded; anything it has not seen is not in them.';

const percent = (n: number | undefined): string => (n === undefined ? '—' : `${n}%`);

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "12% more than August (₹40,000)" or undefined when there is nothing to compare. */
const againstBefore = (change: number | undefined, beforeLabel: string, before: Paise, money: Money): string | undefined => {
  if (change === undefined) return undefined;
  if (change === 0) return `the same as ${beforeLabel} (${money(before)})`;
  return `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than ${beforeLabel} (${money(before)})`;
};

/** "August" for the month before 2026-09. */
const previousMonthName = (key: string): string => MONTH_NAMES[(Number(key.slice(5, 7)) + 10) % 12];

/**
 * One month: the summary, the key figures and every spending category, those with nothing
 * spent included, so a category that went quiet shows as ₹0 rather than vanishing.
 */
export const monthSummary = (view: ReportView, categoryNames: string[], money: Money): ReportDoc => {
  const before = previousMonthName(view.month.key);
  const spentChange = againstBefore(view.expenseChange, before, view.previous.expense, money);
  const receivedChange = againstBefore(view.incomeChange, before, view.previous.income, money);

  const spent = new Map(view.categories.map((c) => [c.name, c]));
  const quiet = categoryNames.filter((name) => !spent.has(name)).sort((a, b) => a.localeCompare(b));
  const rows = [
    ...view.categories.map((c) => [c.name, String(c.count), money(c.amount), `${c.percentage}%`]),
    ...quiet.map((name) => [name, '0', money(paise(0)), '0%']),
  ];

  return {
    kind: 'month-summary',
    title: 'Month Summary',
    subtitle: `${view.month.label} · ${plural(view.transactions, 'transaction')}`,
    sections: [
      {
        kind: 'figures',
        title: 'Summary',
        figures: [
          { label: 'Money in', value: money(view.income), tone: 'in', note: receivedChange },
          { label: 'Money out', value: money(view.expense), tone: 'out', note: spentChange },
          { label: 'Net', value: money(view.net), tone: view.net < 0 ? 'out' : 'in' },
          { label: 'Savings rate', value: percent(view.savingsRate), note: 'of money in, kept' },
        ],
      },
      {
        kind: 'figures',
        title: 'Key figures',
        figures: [
          { label: 'Average a day', value: money(view.avgDaily), note: 'spent per day' },
          { label: 'Average payment', value: money(view.avgTransaction), note: 'per expense' },
          {
            label: 'Busiest day',
            value: view.peakDay ? shortDate(view.peakDay.date) : '—',
            note: view.peakDay ? `${money(view.peakDay.amount)} spent` : undefined,
          },
          {
            label: 'Largest expense',
            value: view.largest ? money(view.largest.amount) : '—',
            note: view.largest ? `${view.largest.name} · ${shortDate(view.largest.date)}` : undefined,
          },
        ],
      },
      {
        kind: 'table',
        title: 'Spending by category',
        columns: ['Category', 'Payments', 'Amount', 'Share'],
        numeric: [false, true, true, true],
        rows,
        empty: 'No categories yet.',
      },
    ],
    footnote: FOOTNOTE,
    fileName: `hisaab-month-summary-${view.month.key}`,
  };
};

/** Plain sentences about six months of money in and out. Each states a fact from the table above it. */
export const cashFlowLines = (view: ReportView, money: Money): string[] => {
  const months = view.flow.filter((m) => m.income > 0 || m.expense > 0);
  if (months.length === 0) return ['Nothing came in or went out in these six months.'];

  const received = sum(view.flow.map((m) => m.income));
  const spent = sum(view.flow.map((m) => m.expense));
  const net = subtract(received, spent);
  const lines = [
    net >= 0
      ? `Over these six months ${money(received)} came in and ${money(spent)} went out: ${money(net)} more came in than went out.`
      : `Over these six months ${money(received)} came in and ${money(spent)} went out: ${money(paise(-net))} more went out than came in.`,
  ];

  const spending = months.filter((m) => m.expense > 0);
  if (spending.length > 1) {
    const high = spending.reduce((a, b) => (b.expense > a.expense ? b : a));
    const low = spending.reduce((a, b) => (b.expense < a.expense ? b : a));
    lines.push(
      `Spending was highest in ${monthYear(high.key)} (${money(high.expense)}) and lowest in ${monthYear(low.key)} (${money(low.expense)}).`
    );
  }

  const short = months.filter((m) => m.net < 0).length;
  lines.push(
    short === 0
      ? `In every month with money moving, more came in than went out.`
      : `In ${short} of these ${plural(months.length, 'month')} with money moving, more went out than came in.`
  );
  return lines;
};

/** Six months side by side, a few plain sentences about them, and the largest payments. */
export const cashFlow = (view: ReportView, largest: Spend[], money: Money): ReportDoc => {
  const first = view.flow[0];
  const last = view.flow[view.flow.length - 1];
  const received = sum(view.flow.map((m) => m.income));
  const spent = sum(view.flow.map((m) => m.expense));
  const net = subtract(received, spent);
  const period = `${monthYear(first.key)} to ${monthYear(last.key)}`;

  return {
    kind: 'cash-flow',
    title: 'Cash Flow Analysis',
    subtitle: period,
    sections: [
      {
        kind: 'figures',
        title: 'Summary',
        figures: [
          { label: 'Money in', value: money(received), tone: 'in' },
          { label: 'Money out', value: money(spent), tone: 'out' },
          { label: 'Net', value: money(net), tone: net < 0 ? 'out' : 'in' },
          { label: 'Average month out', value: money(paise(Math.round(spent / view.flow.length))), note: 'over six months' },
        ],
      },
      {
        kind: 'table',
        title: 'Month by month',
        columns: ['Month', 'Money in', 'Money out', 'Net'],
        numeric: [false, true, true, true],
        rows: view.flow.map((m) => [monthYear(m.key), money(m.income), money(m.expense), money(m.net)]),
        empty: 'No months yet.',
      },
      { kind: 'callout', title: 'In plain words', lines: cashFlowLines(view, money) },
      {
        kind: 'table',
        title: 'Largest payments',
        // The amount before the category: on a narrow screen the last column is the one off the edge.
        columns: ['Date', 'Paid to', 'Amount', 'Category'],
        numeric: [false, false, true, false],
        rows: largest.map((s) => [dateWithYear(s.date), s.name, money(s.amount), s.category]),
        empty: 'No payments in these months.',
      },
    ],
    footnote: FOOTNOTE,
    fileName: `hisaab-cash-flow-${first.key}-to-${last.key}`,
  };
};

/** Whole months from one ISO date to another, at least one when the second is later. */
const monthsUntil = (from: string, to: string): number => {
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  return Math.max(1, months);
};

/**
 * What a goal still needs, worked out from the target and date the user set. A sum, not a
 * suggestion: it says what reaching the target by that date takes, never that it should.
 */
export const goalLine = (goal: Goal, today: string, money: Money): string => {
  const left = subtract(goal.targetAmount, goal.savedAmount);
  if (left <= 0) return `${goal.name}: target reached.`;
  if (!goal.targetDate) return `${goal.name}: ${money(left)} to go, with no date set.`;
  if (goal.targetDate < today) return `${goal.name}: ${money(left)} to go; the date set, ${dateWithYear(goal.targetDate)}, has passed.`;
  const months = monthsUntil(today, goal.targetDate);
  // Rounded up to a whole rupee, so the months add up to at least what is left.
  const each = paise(Math.ceil(left / months / 100) * 100);
  return `${goal.name}: ${money(left)} to go by ${dateWithYear(goal.targetDate)}, about ${money(each)} a month for ${plural(months, 'month')}.`;
};

export const goalProgress = (goals: Goal[], today: string, money: Money): ReportDoc => {
  const saved = sum(goals.map((g) => g.savedAmount));
  const target = sum(goals.map((g) => g.targetAmount));
  const share = (part: Paise, whole: Paise) => (whole > 0 ? `${Math.min(100, Math.round((part / whole) * 100))}%` : '—');

  return {
    kind: 'goal-progress',
    title: 'Goal Progress',
    subtitle: `${plural(goals.length, 'goal')} · ${dateWithYear(today)}`,
    sections: [
      {
        kind: 'figures',
        title: 'Summary',
        figures: [
          { label: 'Goals', value: String(goals.length) },
          { label: 'Put aside', value: money(saved), tone: 'in' },
          { label: 'Targets', value: money(target) },
          { label: 'Of the targets', value: share(saved, target), note: 'put aside so far' },
        ],
      },
      {
        kind: 'table',
        title: 'Goals',
        columns: ['Goal', 'Put aside', 'Target', 'Progress', 'By'],
        numeric: [false, true, true, true, false],
        rows: goals.map((g) => [
          g.name,
          money(g.savedAmount),
          money(g.targetAmount),
          share(g.savedAmount, g.targetAmount),
          g.targetDate ? dateWithYear(g.targetDate) : '—',
        ]),
        empty: 'No goals yet. Add one under More › Goals.',
      },
      {
        kind: 'callout',
        title: 'What each goal still needs',
        lines: goals.length > 0 ? goals.map((g) => goalLine(g, today, money)) : ['Nothing to work out without a goal.'],
      },
    ],
    footnote:
      'Amounts put aside are what was recorded against each goal in Hisaab. Monthly figures are worked out from the target and the date set; they are sums, not advice.',
    fileName: `hisaab-goal-progress-${today}`,
  };
};
