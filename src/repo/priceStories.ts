import { Database } from '@/db/client';
import { daysBetween, isoDate, localDate } from '@/lib/date';
import { Paise, paise } from '@/money/money';
import { priceRuns, NOT_A_PRICE } from '@/analysis/priceSteps';

export type PriceStory = {
  /** The name as it was last typed. */
  name: string;
  /** What it cost, oldest first; the last is the price now, `from` the first day it was paid. */
  prices: Array<{ amount: Paise; from: string }>;
  lastDate: string;
  /** From the first price to the latest, in whole percent (negative when it got cheaper). */
  changePercent: number;
};

type Row = { name: string; d: string; amount: number; cat: string | null; id: string };

/** Fewer purchases than this say too little to tell a price from a quantity. */
const MIN_PURCHASES = 6;

/** A price nobody has paid for this long is history, not what it costs now. */
const STILL_BOUGHT_DAYS = 120;

/**
 * Things the user buys again and again whose price has moved: "Chicken ₹150 → ₹170 → ₹180".
 * Read from what was typed in by hand (a bank narration says nothing about what a thing is),
 * and only where the amounts behave like a price (`priceRuns`). Most recently bought first.
 */
export const priceStories = (db: Database, today = new Date(), limit = 8): PriceStory[] => {
  const rows =
    db
      .query<Row>(
        `SELECT e.id AS id, e.description AS name, substr(e.occurred_at, 1, 10) AS d,
                -p.amount AS amount, e.category_id AS cat
         FROM journal_entries e
         JOIN raw_records r ON r.id = e.raw_id AND r.source = 'manual'
         JOIN postings p ON p.entry_id = e.id
         JOIN accounts a ON a.id = p.account_id
         WHERE e.kind = 'expense' AND a.kind = 'asset' AND a.is_system = 0 AND p.amount < 0
         ORDER BY e.occurred_at, e.created_at`
      )
      .getOrNull() ?? [];

  const byName = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }

  const now = isoDate(today);
  const stories: PriceStory[] = [];
  for (const list of byName.values()) {
    if (list.length < MIN_PURCHASES) continue;

    const votes = new Map<string, number>();
    for (const r of list) if (r.cat) votes.set(r.cat, (votes.get(r.cat) ?? 0) + 1);
    const category = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (category && NOT_A_PRICE.has(category)) continue;

    const runs = priceRuns(list.map((r) => ({ id: r.id, date: r.d, amount: paise(r.amount) })));
    if (!runs) continue;

    const current = runs[runs.length - 1];
    if (daysBetween(localDate(current.to), localDate(now)) > STILL_BOUGHT_DAYS) continue;

    const first = runs[0].amount;
    stories.push({
      name: list[list.length - 1].name,
      prices: runs.map((r) => ({ amount: r.amount, from: r.from })),
      lastDate: list[list.length - 1].d,
      changePercent: Math.round(((current.amount - first) / first) * 100),
    });
  }

  return stories.sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0)).slice(0, limit);
};
