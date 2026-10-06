import { Database } from '@/db/client';
import { now, toUTC } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import type { Id } from '@/lib/ulid';
import { Paise, abs, paise } from '@/money/money';
import { settleEntry } from './views';

/**
 * A payment the bank reported and an entry the user typed by hand (in Hisaab
 * or in Paisa) with the same amount a few days apart: maybe one payment counted
 * twice, maybe two. Only the user can tell, so nothing is merged until they say.
 */
export type MaybeTwice = {
  amount: Paise;
  bank: Side;
  typed: Side;
};

type Side = { id: Id; description: string; date: string; account: string };

/** Further apart than this, a typed entry is not offered as the bank's twin. */
const WINDOW_DAYS = 3;

/** `separate:<bank entry>:<typed entry>`: the user said these are two payments. */
const SEPARATE_PREFIX = 'separate:';

type Leg = { entry: string; amount: number; day: string; description: string; account: string };

/** Whole days since 1970 for a YYYY-MM-DD date: cheap to step through, with no Date made per step. */
const dayNumber = (day: string): number =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

/** Each entry's leg on one of the user's own accounts (not an investment holding), transfers left out. */
const legs = (db: Database, sources: string, extra = ''): Leg[] =>
  db
    .query<Leg>(
      `SELECT e.id AS entry, p.amount AS amount, substr(e.occurred_at, 1, 10) AS day,
              e.description AS description, a.name AS account
       FROM journal_entries e
       JOIN raw_records r ON r.id = e.raw_id AND r.source IN (${sources})
       JOIN postings p ON p.entry_id = e.id
       JOIN accounts a ON a.id = p.account_id AND a.kind = 'asset' AND a.is_system = 0
         AND COALESCE(a.subkind, '') <> 'investment'
       WHERE e.kind <> 'transfer' ${extra}`
    )
    .getOrNull() ?? [];

/** Pairs to ask about, newest first; each entry is in at most one pair, with its nearest match. */
export const maybeTwice = (db: Database): MaybeTwice[] => {
  const bank = legs(db, `'notification', 'statement_csv', 'statement_pdf'`);
  // A typed entry a statement row or a bank message already claimed is the bank's own record now.
  const typed = legs(
    db,
    `'manual'`,
    `AND NOT EXISTS (SELECT 1 FROM statement_rows s WHERE s.entry_id = e.id)
     AND e.id NOT IN (SELECT value FROM settings WHERE key LIKE 'claim:%')`
  );
  const separate = new Set(
    (db.query<{ key: string }>(`SELECT key FROM settings WHERE key LIKE ?`, [`${SEPARATE_PREFIX}%`]).getOrNull() ?? []).map(
      (r) => r.key
    )
  );

  // Looked up by amount and day, so each typed entry checks only the days in the window.
  const byDay = new Map<string, Leg[]>();
  for (const leg of bank) {
    const key = `${leg.amount}|${dayNumber(leg.day)}`;
    const same = byDay.get(key);
    if (same) same.push(leg);
    else byDay.set(key, [leg]);
  }

  const candidates: Array<{ bank: Leg; typed: Leg; gap: number }> = [];
  for (const t of typed) {
    const day = dayNumber(t.day);
    for (let shift = -WINDOW_DAYS; shift <= WINDOW_DAYS; shift++) {
      for (const b of byDay.get(`${t.amount}|${day + shift}`) ?? []) {
        if (!separate.has(`${SEPARATE_PREFIX}${b.entry}:${t.entry}`)) {
          candidates.push({ bank: b, typed: t, gap: Math.abs(shift) });
        }
      }
    }
  }

  const used = new Set<string>();
  const pairs: MaybeTwice[] = [];
  for (const c of candidates.sort((x, y) => x.gap - y.gap)) {
    if (used.has(c.bank.entry) || used.has(c.typed.entry)) continue;
    used.add(c.bank.entry);
    used.add(c.typed.entry);
    const side = (l: Leg): Side => ({ id: l.entry as Id, description: l.description, date: l.day, account: l.account });
    pairs.push({ amount: abs(paise(c.bank.amount)), bank: side(c.bank), typed: side(c.typed) });
  }
  return pairs.sort((x, y) => y.bank.date.localeCompare(x.bank.date));
};

/**
 * "Same payment": the bank's entry stays (its amount, date and account are the
 * bank's), takes the user's description, category and note, and the typed one
 * is deleted. An item purchase linked to the typed entry moves with it.
 */
export const sameAsBank = (db: Database, pair: MaybeTwice): Result<void, { message: string }> => {
  const done = db.transaction(() => {
    const typed = db.getEntry(pair.typed.id).getOrNull();
    const bank = db.getEntry(pair.bank.id).getOrNull();
    if (!typed || !bank) return err({ code: 'NOT_FOUND', message: 'One of these entries is no longer here' });

    const updated = db.updateEntry(bank.id, {
      description: typed.description,
      merchantId: typed.merchantId,
      categoryId: typed.categoryId ?? bank.categoryId,
      notes: typed.notes ?? bank.notes,
      reviewedAt: toUTC(now()),
      confidence: 1,
    });
    if (updated.isErr()) return updated;
    if (typed.categoryId) {
      const settled = settleEntry(db, bank.id, typed.categoryId);
      if (settled.isErr()) return err({ code: 'SETTLE_FAILED', message: settled.error.message });
    }
    const moved = db.run(`UPDATE purchases SET entry_id = ? WHERE entry_id = ?`, [bank.id, typed.id]);
    if (moved.isErr()) return moved;
    // Refuses anything that was not typed by hand.
    return db.deleteEntry(typed.id);
  }, 'SAME_PAYMENT_FAILED');
  return done.isOk() ? ok(undefined) : err({ message: done.error.message });
};

/** "Two payments": both stay, and this pair is not asked about again. */
export const twoPayments = (db: Database, pair: MaybeTwice): Result<void, { message: string }> => {
  const saved = db.setSetting(`${SEPARATE_PREFIX}${pair.bank.id}:${pair.typed.id}`, 'yes');
  return saved.isOk() ? ok(undefined) : err({ message: saved.error.message });
};
