import { Database } from '@/db/client';
import { Paise, paise, subtract, sum, toPlainRupees, tryRupeeString } from '@/money/money';
import type { TimelineEntry } from '@/ui/screens/TimelineScreen';
import { dayLabel } from './views';

export type SearchResult = {
  days: TimelineEntry[];
  /** Money in and out across everything that matched, by the same rule as the Reports totals. */
  income: Paise;
  expense: Paise;
  net: Paise;
  /**
   * Money that left the user's own accounts as a transfer or an investment: still theirs, so
   * not in `expense`. With `expense` it makes up a bank statement's total debits.
   */
  moved: Paise;
  /** How many entries matched. */
  count: number;
  /** True when more matched than are listed. */
  truncated: boolean;
};

const NONE: SearchResult = {
  days: [],
  income: paise(0),
  expense: paise(0),
  net: paise(0),
  moved: paise(0),
  count: 0,
  truncated: false,
};

/**
 * Search the whole ledger, not just the newest page of it: the words are looked
 * for in the narration, the payee's name and the category, and a plain number
 * also finds an entry for exactly that many rupees. Newest first, grouped by day
 * like Activity, with the money in and out of everything that matched.
 */
const SOURCE = `FROM journal_entries e
    LEFT JOIN merchants m ON m.id = e.merchant_id
    LEFT JOIN categories c ON c.id = e.category_id`;

/** The WHERE clause a search uses, or null for an empty search. */
const matchWhere = (text: string): { where: string; params: Array<string | number> } | null => {
  const needle = text.trim();
  if (!needle) return null;

  const like = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
  const rupees = /^\d+(\.\d{1,2})?$/.test(needle) ? tryRupeeString(needle) : null;

  const matches = [
    `e.description LIKE ? ESCAPE '\\'`,
    `m.canonical LIKE ? ESCAPE '\\'`,
    `c.name LIKE ? ESCAPE '\\'`,
  ];
  const params: Array<string | number> = [like, like, like];
  if (rupees !== null) {
    matches.push(
      `EXISTS (SELECT 1 FROM postings x JOIN accounts xa ON xa.id = x.account_id
               WHERE x.entry_id = e.id AND xa.is_system = 0 AND ABS(x.amount) = ?)`
    );
    params.push(rupees);
  }
  return { where: `(${matches.join(' OR ')})`, params };
};

export const searchEntries = (db: Database, text: string, limit = 300): SearchResult => {
  const match = matchWhere(text);
  return match ? listMatching(db, match.where, match.params, limit) : NONE;
};

/**
 * Every entry one statement import brought in or matched to what was already there, the
 * same way Activity lists them, with the money in and out across them.
 */
export const importedEntries = (db: Database, rawId: string, limit = 1000): SearchResult =>
  listMatching(db, `e.id IN (SELECT entry_id FROM statement_rows WHERE raw_id = ?)`, [rawId], limit);

const listMatching = (
  db: Database,
  where: string,
  params: Array<string | number>,
  limit: number
): SearchResult => {
  const source = SOURCE;

  const rows =
    db
      .query<{
        id: string;
        at: string;
        description: string;
        merchant: string | null;
        category: string | null;
        net: number | null;
        smallest: number | null;
        legs: number;
        kind: string;
      }>(
        `SELECT e.id AS id, e.occurred_at AS at, e.description AS description, m.canonical AS merchant,
                c.name AS category, e.kind AS kind, SUM(p.amount) AS net, MIN(p.amount) AS smallest, COUNT(p.entry_id) AS legs
         ${source}
         LEFT JOIN postings p ON p.entry_id = e.id AND p.account_id IN (SELECT id FROM accounts WHERE is_system = 0)
         WHERE ${where}
         GROUP BY e.id
         ORDER BY e.occurred_at DESC, e.created_at DESC
         LIMIT ?`,
        [...params, limit + 1]
      )
      .getOrNull() ?? [];
  if (rows.length === 0) return NONE;

  const truncated = rows.length > limit;
  const byDay = new Map<string, TimelineEntry>();
  for (const row of rows.slice(0, limit)) {
    // The same rule as Activity: money moved between two of the user's own accounts
    // nets to nothing, so show the leg that left.
    const net = row.net ?? 0;
    const shown = paise(net === 0 && row.legs > 1 && (row.smallest ?? 0) < 0 ? (row.smallest as number) : net);

    const key = row.at.slice(0, 10);
    const day = byDay.get(key) ?? { date: dayLabel(row.at), dayTotal: paise(0), entries: [] };
    day.dayTotal = sum([day.dayTotal, shown]);
    day.entries.push({
      id: row.id,
      merchant: row.merchant ?? row.description,
      category: row.category ?? 'Unknown',
      amount: shown,
      kind: row.kind,
    });
    byDay.set(key, day);
  }

  const [flow] =
    db
      .query<{ income: number | null; expense: number | null; moved: number | null }>(
        `SELECT SUM(CASE WHEN e.kind NOT IN ('transfer', 'investment') AND p.amount > 0 THEN p.amount ELSE 0 END) AS income,
                SUM(CASE WHEN e.kind NOT IN ('transfer', 'investment') AND p.amount < 0 THEN -p.amount ELSE 0 END) AS expense,
                SUM(CASE WHEN e.kind IN ('transfer', 'investment') AND p.amount < 0 THEN -p.amount ELSE 0 END) AS moved
         ${source}
         JOIN postings p ON p.entry_id = e.id JOIN accounts a ON a.id = p.account_id
         WHERE ${where} AND a.kind = 'asset' AND a.is_system = 0 AND a.excluded = 0`,
        params
      )
      .getOrNull() ?? [];
  const income = paise(flow?.income ?? 0);
  const expense = paise(flow?.expense ?? 0);
  const moved = paise(flow?.moved ?? 0);

  const count = truncated
    ? (db.query<{ n: number }>(`SELECT COUNT(*) AS n ${source} WHERE ${where}`, params).getOrNull()?.[0]?.n ?? rows.length)
    : rows.length;

  return { days: [...byDay.values()], income, expense, net: subtract(income, expense), moved, count, truncated };
};

const CSV_HEADER = ['Date', 'Description', 'Payee', 'Category', 'Type', 'Account', 'Amount', 'Notes'];

/** One CSV cell: quoted when needed, and text a spreadsheet would run as a formula is defused. */
const cell = (value: string, text = true): string => {
  const safe = text && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const UNIT = String.fromCharCode(31);
const RECORD = String.fromCharCode(30);

/**
 * Every entry, or every entry a search matches, as CSV, oldest first: one row per entry with
 * the user's own account(s) it touched ("From → To" for a transfer) and the amount by the same
 * rule as Activity (money out is negative).
 */
export const entriesCsv = (db: Database, text = ''): string => {
  const match = matchWhere(text);
  const rows =
    db
      .query<{
        at: string;
        description: string;
        merchant: string | null;
        category: string | null;
        kind: string;
        notes: string | null;
        legs: string | null;
      }>(
        `SELECT e.occurred_at AS at, e.description AS description, m.canonical AS merchant, c.name AS category,
                e.kind AS kind, e.notes AS notes,
                (SELECT GROUP_CONCAT(a.name || char(31) || p.amount, char(30))
                   FROM postings p JOIN accounts a ON a.id = p.account_id
                  WHERE p.entry_id = e.id AND a.is_system = 0) AS legs
         ${SOURCE}
         ${match ? `WHERE ${match.where}` : ''}
         ORDER BY e.occurred_at, e.created_at`,
        match?.params ?? []
      )
      .getOrNull() ?? [];

  const lines = [CSV_HEADER.join(',')];
  for (const row of rows) {
    const legs = (row.legs ?? '')
      .split(RECORD)
      .filter(Boolean)
      .map((leg) => {
        const [name, amount] = leg.split(UNIT);
        return { name, amount: Number(amount) };
      });
    const net = legs.reduce((total, leg) => total + leg.amount, 0);
    const out = legs.find((leg) => leg.amount < 0);
    const into = legs.find((leg) => leg.amount > 0);
    // Between two of the user's own accounts: show the leg that left, as Activity does.
    const between = net === 0 && out !== undefined && into !== undefined;
    const account = between ? `${out.name} → ${into.name}` : legs.map((leg) => leg.name).join(' + ');
    lines.push(
      [
        cell(row.at.slice(0, 10), false),
        cell(row.description),
        cell(row.merchant ?? ''),
        cell(row.category ?? ''),
        cell(row.kind),
        cell(account),
        cell(toPlainRupees(paise(between ? out.amount : net)), false),
        cell(row.notes ?? ''),
      ].join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
};
