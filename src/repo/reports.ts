import { Database } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { MONTH_NAMES } from '@/lib/date';
import { Paise, paise, percentChange, subtract } from '@/money/money';

export type ReportMonth = { key: string; label: string };

export type ReportCategory = {
  name: string;
  amount: Paise;
  count: number;
  /** Share of the month's spending, whole percent. */
  percentage: number;
};

/** Which way the day-by-day bars and the category breakdown read. */
export type ReportSide = 'expense' | 'income';

export type ReportFlow = {
  key: string;
  /** Three-letter month, "Sep". */
  label: string;
  income: Paise;
  expense: Paise;
  net: Paise;
};

export type ReportView = {
  side: ReportSide;
  month: ReportMonth;
  /** Months that have anything in them, newest first, always including this one. */
  months: ReportMonth[];
  income: Paise;
  expense: Paise;
  net: Paise;
  /** What the month before had, for "was ₹X" and the change. */
  previous: { income: Paise; expense: Paise };
  /** Whole-percent change on the month before; undefined when it had nothing to compare. */
  incomeChange?: number;
  expenseChange?: number;
  transactions: number;
  /** (income − spending) as a share of income; undefined with no income. Can be negative. */
  savingsRate?: number;
  avgDaily: Paise;
  avgTransaction: Paise;
  peakDay?: { date: string; amount: Paise };
  largest?: { id: Id; name: string; amount: Paise; date: string; category: string };
  /** What came in or went out on each day of the month (per `side`), 1-based. */
  daily: Array<{ day: number; amount: Paise }>;
  /** Per `side`, each with its share of that side's total. */
  categories: ReportCategory[];
  /** Income and spending for the six months ending with this one, oldest first, empty months included. */
  flow: ReportFlow[];
};

export const monthKeyOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const labelOf = (key: string): string =>
  `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const daysIn = (key: string): number => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();

const previousKey = (key: string): string => {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

const shiftKey = (key: string, months: number): string => {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

// The same rule the Home totals use: money moving in or out of the user's own
// accounts (not one they left out of totals), never a transfer between them or an investment.
const OWN_MONEY = `a.kind = 'asset' AND a.is_system = 0 AND a.excluded = 0 AND e.kind NOT IN ('transfer', 'investment')`;

const totals = (db: Database, key: string, sign: '<' | '>'): { total: Paise; count: number } => {
  const [row] =
    db
      .query<{ total: number | null; n: number }>(
        `SELECT SUM(ABS(p.amount)) AS total, COUNT(*) AS n
         FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
         WHERE ${OWN_MONEY} AND p.amount ${sign} 0 AND substr(e.occurred_at, 1, 7) = ?`,
        [key]
      )
      .getOrNull() ?? [];
  return { total: paise(row?.total ?? 0), count: row?.n ?? 0 };
};

/** Each day of a month that had money going out ('<') or coming in ('>'), and how much. */
const dayTotals = (db: Database, key: string, sign: '<' | '>'): Array<{ d: string; total: number }> =>
  db
    .query<{ d: string; total: number }>(
      `SELECT substr(e.occurred_at, 1, 10) AS d, SUM(ABS(p.amount)) AS total
       FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
       WHERE ${OWN_MONEY} AND p.amount ${sign} 0 AND substr(e.occurred_at, 1, 7) = ?
       GROUP BY d`,
      [key]
    )
    .getOrNull() ?? [];

/** What went out on every day of a month, the 1st first — the same rule as the totals. */
export const spendByDay = (db: Database, key: string): Paise[] => {
  const byDay = new Map(dayTotals(db, key, '<').map((r) => [Number(r.d.slice(8, 10)), r.total]));
  return Array.from({ length: daysIn(key) }, (_, i) => paise(byDay.get(i + 1) ?? 0));
};

/**
 * One month, read the way Paisa's Reports page reads it. Descriptive only: it
 * says what happened, never what to do with the money.
 */
export const reportView = (
  db: Database,
  requested?: string,
  today = new Date(),
  side: ReportSide = 'expense'
): ReportView => {
  const thisMonth = monthKeyOf(today);
  const towards = side === 'expense' ? { sign: '<', amount: '-p.amount' } : { sign: '>', amount: 'p.amount' };

  const seen = (
    db
      .query<{ m: string }>(
        `SELECT DISTINCT substr(e.occurred_at, 1, 7) AS m FROM journal_entries e ORDER BY m DESC LIMIT 24`
      )
      .getOrNull() ?? []
  ).map((r) => r.m);
  const keys = Array.from(new Set([thisMonth, ...seen])).sort().reverse().slice(0, 24);
  const key = requested && keys.includes(requested) ? requested : thisMonth;

  const spent = totals(db, key, '<');
  const received = totals(db, key, '>');
  const before = previousKey(key);
  const spentBefore = totals(db, before, '<').total;
  const receivedBefore = totals(db, before, '>').total;

  const days = daysIn(key);
  const elapsed = key === thisMonth ? today.getDate() : days;

  const spendingDays = dayTotals(db, key, '<');
  const dailyRows = side === 'expense' ? spendingDays : dayTotals(db, key, '>');
  const byDay = new Map(dailyRows.map((r) => [Number(r.d.slice(8, 10)), r.total]));
  const daily = Array.from({ length: days }, (_, i) => ({ day: i + 1, amount: paise(byDay.get(i + 1) ?? 0) }));
  // The quick insights are about spending whichever side the bars show.
  const peak = spendingDays.reduce<{ d: string; total: number } | undefined>(
    (best, r) => (!best || r.total > best.total ? r : best),
    undefined
  );

  const [big] =
    db
      .query<{ id: string; name: string; amount: number; d: string; category: string | null }>(
        `SELECT e.id, COALESCE(m.canonical, e.description) AS name, -p.amount AS amount,
                substr(e.occurred_at, 1, 10) AS d, c.name AS category
         FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
         LEFT JOIN merchants m ON m.id = e.merchant_id LEFT JOIN categories c ON c.id = e.category_id
         WHERE ${OWN_MONEY} AND p.amount < 0 AND substr(e.occurred_at, 1, 7) = ?
         ORDER BY p.amount ASC LIMIT 1`,
        [key]
      )
      .getOrNull() ?? [];

  const categoryRows =
    db
      .query<{ name: string | null; total: number; n: number }>(
        `SELECT c.name AS name, SUM(${towards.amount}) AS total, COUNT(*) AS n
         FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
         LEFT JOIN categories c ON c.id = e.category_id
         WHERE ${OWN_MONEY} AND p.amount ${towards.sign} 0 AND substr(e.occurred_at, 1, 7) = ?
         GROUP BY e.category_id ORDER BY total DESC`,
        [key]
      )
      .getOrNull() ?? [];
  const sideTotal = side === 'expense' ? spent.total : received.total;

  // Income and spending for the six months ending with this one.
  const firstMonth = shiftKey(key, -5);
  const flowRows = new Map(
    (
      db
        .query<{ m: string; spent: number; received: number }>(
          `SELECT substr(e.occurred_at, 1, 7) AS m,
                  SUM(CASE WHEN p.amount < 0 THEN -p.amount ELSE 0 END) AS spent,
                  SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END) AS received
           FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
           WHERE ${OWN_MONEY} AND substr(e.occurred_at, 1, 7) BETWEEN ? AND ?
           GROUP BY m`,
          [firstMonth, key]
        )
        .getOrNull() ?? []
    ).map((r) => [r.m, r])
  );
  const flow: ReportFlow[] = Array.from({ length: 6 }, (_, i) => {
    const k = shiftKey(firstMonth, i);
    const row = flowRows.get(k);
    const income = paise(row?.received ?? 0);
    const expense = paise(row?.spent ?? 0);
    return { key: k, label: MONTH_NAMES[Number(k.slice(5, 7)) - 1].slice(0, 3), income, expense, net: subtract(income, expense) };
  });

  return {
    side,
    month: { key, label: labelOf(key) },
    months: keys.map((k) => ({ key: k, label: labelOf(k) })),
    income: received.total,
    expense: spent.total,
    net: subtract(received.total, spent.total),
    previous: { income: receivedBefore, expense: spentBefore },
    incomeChange: percentChange(received.total, receivedBefore),
    expenseChange: percentChange(spent.total, spentBefore),
    transactions: spent.count + received.count,
    savingsRate:
      received.total > 0 ? Math.round(((received.total - spent.total) / received.total) * 100) : undefined,
    avgDaily: paise(Math.round(spent.total / Math.max(1, elapsed))),
    avgTransaction: paise(spent.count > 0 ? Math.round(spent.total / spent.count) : 0),
    peakDay: peak ? { date: peak.d, amount: paise(peak.total) } : undefined,
    largest: big
      ? { id: big.id as Id, name: big.name, amount: paise(big.amount), date: big.d, category: big.category ?? 'Unknown' }
      : undefined,
    daily,
    categories: categoryRows.map((r) => ({
      name: r.name ?? 'Unknown',
      amount: paise(r.total),
      count: r.n,
      percentage: sideTotal > 0 ? Math.round((r.total / sideTotal) * 100) : 0,
    })),
    flow,
  };
};

export type CategoryFlow = {
  month: ReportMonth;
  /** Everything that came in this month. */
  received: Paise;
  /** The biggest income category of the month, when anything came in. */
  source?: { name: string; amount: Paise };
  /** Which of the user's accounts the category's money left, largest first. */
  accounts: Array<{ name: string; amount: Paise }>;
  category: {
    name: string;
    amount: Paise;
    count: number;
    /** Whole percent of the month's spending. */
    shareOfSpending: number;
    /** Whole percent of what came in; undefined when nothing did. */
    shareOfReceived?: number;
  };
  /** Where inside the category it went: the biggest payees, then the rest together. */
  merchants: Array<{ name: string; amount: Paise; count: number }>;
  others: Paise;
};

const FLOW_MERCHANTS = 4;

/**
 * Where one category's money went in a month: what came in, the account it left,
 * the category, and the payees inside it. Read from the same rule as the report
 * (own money only, never a transfer or an investment), so the pieces add up.
 */
export const categoryFlow = (db: Database, key: string, categoryName: string): CategoryFlow | null => {
  const month = { key, label: labelOf(key) };
  const received = totals(db, key, '>').total;
  const spent = totals(db, key, '<').total;

  const rows = (sql: string, params: unknown[]) => db.query<{ name: string | null; total: number; n: number }>(sql, params as never).getOrNull() ?? [];
  const inMonthOfCategory = `${OWN_MONEY} AND p.amount < 0 AND substr(e.occurred_at, 1, 7) = ? AND COALESCE(c.name, 'Unknown') = ?`;
  const from = `FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
         LEFT JOIN merchants m ON m.id = e.merchant_id LEFT JOIN categories c ON c.id = e.category_id`;

  const payees = rows(
    `SELECT COALESCE(m.canonical, e.description) AS name, SUM(-p.amount) AS total, COUNT(*) AS n
     ${from} WHERE ${inMonthOfCategory} GROUP BY COALESCE(m.canonical, e.description) ORDER BY total DESC`,
    [key, categoryName]
  );
  if (payees.length === 0) return null;

  const accounts = rows(
    `SELECT a.name AS name, SUM(-p.amount) AS total, COUNT(*) AS n ${from} WHERE ${inMonthOfCategory} GROUP BY a.id ORDER BY total DESC`,
    [key, categoryName]
  );
  const [source] = rows(
    `SELECT c.name AS name, SUM(p.amount) AS total, COUNT(*) AS n ${from}
     WHERE ${OWN_MONEY} AND p.amount > 0 AND substr(e.occurred_at, 1, 7) = ? GROUP BY e.category_id ORDER BY total DESC LIMIT 1`,
    [key]
  );

  const amount = payees.reduce((sum, r) => sum + r.total, 0);
  const count = payees.reduce((sum, r) => sum + r.n, 0);
  const shown = payees.slice(0, FLOW_MERCHANTS);

  return {
    month,
    received,
    source: source && received > 0 ? { name: source.name ?? 'Income', amount: paise(source.total) } : undefined,
    accounts: accounts.map((r) => ({ name: r.name ?? 'Account', amount: paise(r.total) })),
    category: {
      name: categoryName,
      amount: paise(amount),
      count,
      shareOfSpending: spent > 0 ? Math.round((amount / spent) * 100) : 0,
      shareOfReceived: received > 0 ? Math.round((amount / received) * 100) : undefined,
    },
    merchants: shown.map((r) => ({ name: r.name ?? 'Unnamed', amount: paise(r.total), count: r.n })),
    others: paise(payees.slice(FLOW_MERCHANTS).reduce((sum, r) => sum + r.total, 0)),
  };
};

export type Spend = { id: Id; name: string; amount: Paise; date: string; category: string };

/** The biggest payments out of the user's own money from one month to another (both included), largest first. */
export const largestSpends = (db: Database, fromKey: string, toKey: string, limit = 5): Spend[] =>
  (
    db
      .query<{ id: string; name: string; amount: number; d: string; category: string | null }>(
        `SELECT e.id, COALESCE(m.canonical, e.description) AS name, -p.amount AS amount,
                substr(e.occurred_at, 1, 10) AS d, c.name AS category
         FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
         LEFT JOIN merchants m ON m.id = e.merchant_id LEFT JOIN categories c ON c.id = e.category_id
         WHERE ${OWN_MONEY} AND p.amount < 0 AND substr(e.occurred_at, 1, 7) BETWEEN ? AND ?
         ORDER BY p.amount ASC, e.occurred_at DESC LIMIT ?`,
        [fromKey, toKey, limit]
      )
      .getOrNull() ?? []
  ).map((r) => ({ id: r.id as Id, name: r.name, amount: paise(r.amount), date: r.d, category: r.category ?? 'Unknown' }));

/** Categories money is spent under, by name: everything except income, transfers, investments and Unknown. */
export const spendingCategoryNames = (db: Database): string[] =>
  (
    db
      .query<{ name: string }>(
        `SELECT name FROM categories
         WHERE id NOT IN ('cat_salary', 'cat_transfers', 'cat_investment', 'cat_unknown')
         ORDER BY name`
      )
      .getOrNull() ?? []
  ).map((r) => r.name);

/**
 * What went out over the days just before a month began (up to `days` of them, fewer when
 * the records start later), by the same rule as every other total. The basis for the
 * Home spending score's daily average.
 */
export const spentBefore = (db: Database, key: string, days = 90): { total: Paise; days: number } => {
  const start = `${key}-01`;
  const from = shiftIso(start, -days);
  const [first] =
    db.query<{ d: string | null }>(`SELECT MIN(substr(occurred_at, 1, 10)) AS d FROM journal_entries`).getOrNull() ?? [];
  if (!first?.d || first.d >= start) return { total: paise(0), days: 0 };
  const since = first.d > from ? first.d : from;

  const [row] =
    db
      .query<{ total: number | null }>(
        `SELECT SUM(-p.amount) AS total
         FROM postings p JOIN journal_entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id
         WHERE ${OWN_MONEY} AND p.amount < 0 AND substr(e.occurred_at, 1, 10) >= ? AND substr(e.occurred_at, 1, 10) < ?`,
        [since, start]
      )
      .getOrNull() ?? [];
  return { total: paise(row?.total ?? 0), days: daysFrom(since, start) };
};

/** An ISO date moved by whole days, worked in UTC so no time zone can move it twice. */
const shiftIso = (iso: string, by: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};

/** Whole days from one ISO date up to (not including) another. */
const daysFrom = (from: string, to: string): number => {
  const at = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
};
