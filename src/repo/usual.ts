import { Database } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Paise, paise } from '@/money/money';
import { priceRuns, NOT_A_PRICE } from '@/analysis/priceSteps';

export type UsualPurchase = {
  name: string;
  /** How many times it has been typed in before. */
  count: number;
  /**
   * What it cost the last time. Prices drift with inflation: it is still the same thing.
   * A different amount may just as well be a different quantity (these were typed as an
   * amount alone), so `was` below is only given when the amounts behave like a price.
   */
  latest: Paise;
  /**
   * The price before the current one and the last day it was paid, when the amounts behave
   * like a price (`priceRuns`): 150 for months, then 170, now 180. A different amount that
   * comes and goes is a different quantity, so it says nothing.
   */
  was?: { amount: Paise; until: string };
  low: Paise;
  high: Paise;
  /** The category it has most often been filed under. */
  categoryId?: Id;
  lastDate: string;
};

type Row = { amount: number; cat: string | null; d: string };

/**
 * What the user usually buys, read from what was typed in before: names that
 * start like the text so far, most often bought first, each with what it cost
 * the last time (prices move with inflation, so the last one wins). Only
 * hand-typed expenses count — a bank narration is not a thing someone means to
 * type again — and it is only ever offered as a suggestion to accept or ignore,
 * never filled in silently.
 */
export const usualPurchases = (db: Database, needle: string, limit = 4): UsualPurchase[] => {
  const text = needle.trim();
  if (text.length < 2) return [];

  const names =
    db
      .query<{ name: string; n: number }>(
        `SELECT MIN(e.description) AS name, COUNT(*) AS n
         FROM journal_entries e JOIN raw_records r ON r.id = e.raw_id AND r.source = 'manual'
         WHERE e.kind = 'expense' AND e.description LIKE ? ESCAPE '\\'
         GROUP BY lower(e.description) ORDER BY n DESC, name LIMIT ?`,
        [`${text.replace(/[\\%_]/g, '\\$&')}%`, limit]
      )
      .getOrNull() ?? [];

  return names.flatMap(({ name }) => {
    const rows =
      db
        .query<Row>(
          `SELECT -p.amount AS amount, e.category_id AS cat, substr(e.occurred_at, 1, 10) AS d
           FROM journal_entries e
           JOIN raw_records r ON r.id = e.raw_id AND r.source = 'manual'
           JOIN postings p ON p.entry_id = e.id JOIN accounts a ON a.id = p.account_id
           WHERE e.kind = 'expense' AND lower(e.description) = lower(?)
             AND a.kind = 'asset' AND a.is_system = 0 AND p.amount < 0
           ORDER BY e.occurred_at, e.created_at`,
          [name]
        )
        .getOrNull() ?? [];
    if (rows.length === 0) return [];

    const amounts = rows.map((r) => r.amount).sort((a, b) => a - b);
    const latest = rows[rows.length - 1].amount;
    const votes = new Map<string, number>();
    for (const r of rows) if (r.cat) votes.set(r.cat, (votes.get(r.cat) ?? 0) + 1);
    const category = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const runs = priceRuns(rows.map((r, i) => ({ id: String(i), date: r.d, amount: paise(r.amount) })));
    const before =
      runs && !NOT_A_PRICE.has(category ?? '') && runs[runs.length - 1].amount === latest
        ? runs[runs.length - 2]
        : undefined;

    return [
      {
        name,
        count: rows.length,
        latest: paise(latest),
        was: before ? { amount: before.amount, until: before.to } : undefined,
        low: paise(amounts[0]),
        high: paise(amounts[amounts.length - 1]),
        categoryId: category as Id | undefined,
        lastDate: rows.reduce((latest, r) => (r.d > latest ? r.d : latest), ''),
      },
    ];
  });
};

/** The one thing typed so far names exactly: its history, if any. */
export const usualFor = (db: Database, name: string): UsualPurchase | undefined =>
  usualPurchases(db, name, 8).find((u) => u.name.toLowerCase() === name.trim().toLowerCase());
