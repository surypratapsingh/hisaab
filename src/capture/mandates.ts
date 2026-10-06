import { Database } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';
import { paise, type Paise } from '@/money/money';
import { normalise } from '@/intel/normalise';
import type { Frequency, Mandate } from './sort';

/**
 * Autopay mandates the user has been told about. Kept in settings, one key
 * per mandate, so they are backed up and wiped with everything else.
 */
const PREFIX = 'mandate:';
const SUBSCRIPTIONS = 'cat_subscriptions' as Id;

export type MandateStatus = 'pending' | 'confirmed' | 'dismissed' | 'revoked';

export type TrackedMandate = {
  key: string;
  payee: string;
  /** The name the user gave it, if they changed it. */
  name?: string;
  purpose?: string;
  amount?: Paise;
  upTo: boolean;
  frequency?: Frequency;
  seenAt: string;
  status: MandateStatus;
};

type Stored = Omit<TrackedMandate, 'key' | 'amount'> & { amount?: number };

const read = (key: string, value: string): TrackedMandate | null => {
  try {
    const stored = JSON.parse(value) as Stored;
    return { ...stored, key, amount: stored.amount === undefined ? undefined : paise(stored.amount) };
  } catch {
    return null;
  }
};

const write = (db: Database, mandate: TrackedMandate) => {
  const { key, ...rest } = mandate;
  return db.setSetting(key, JSON.stringify(rest));
};

export const allMandates = (db: Database): TrackedMandate[] =>
  (
    db
      .query<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key LIKE ?`, [`${PREFIX}%`])
      .getOrNull() ?? []
  )
    .flatMap((row) => read(row.key, row.value) ?? [])
    .sort((a, b) => b.seenAt.localeCompare(a.seenAt));

export const pendingMandates = (db: Database): TrackedMandate[] =>
  allMandates(db).filter((m) => m.status === 'pending');

/**
 * A mandate message, remembered for the user to confirm. The bank and the
 * app that set it up often both announce it, so the same payee and amount is
 * only asked about once.
 */
export const noteMandate = (db: Database, rawId: Id, mandate: Mandate, seenAt: string): boolean => {
  const samePayee = (m: TrackedMandate) => m.payee.toLowerCase() === mandate.payee.toLowerCase();

  // Cancelled: close any card for that payee, and never ask about it.
  if (mandate.revoked) {
    for (const m of allMandates(db).filter(samePayee)) {
      if (m.status !== 'revoked') write(db, { ...m, status: 'revoked' });
    }
    if (!allMandates(db).some(samePayee)) {
      write(db, {
        key: `${PREFIX}${rawId}`,
        payee: mandate.payee,
        amount: mandate.amount,
        upTo: mandate.upTo,
        frequency: mandate.frequency,
        seenAt,
        status: 'revoked',
      });
    }
    return false;
  }

  const known = allMandates(db).some(
    (m) => m.payee.toLowerCase() === mandate.payee.toLowerCase() && m.amount === mandate.amount
  );
  if (known) return false;
  write(db, {
    key: `${PREFIX}${rawId}`,
    payee: mandate.payee,
    amount: mandate.amount,
    upTo: mandate.upTo,
    frequency: mandate.frequency,
    seenAt,
    status: 'pending',
  });
  return true;
};

/**
 * "Yes, track it": the payee becomes a known subscription merchant, so its
 * debits are filed under Subscriptions from now on.
 */
export const confirmMandate = (
  db: Database,
  key: string,
  details: { name?: string; purpose?: string } = {}
): Result<void, { message: string }> => {
  const mandate = allMandates(db).find((m) => m.key === key);
  if (!mandate) return err({ message: 'That autopay is no longer here' });

  const name = details.name?.trim() || mandate.payee;
  const merchant = db.upsertMerchant(name, SUBSCRIPTIONS);
  if (merchant.isErr()) return err({ message: merchant.error.message });
  db.applyCategoryToMerchant(merchant.value.id, SUBSCRIPTIONS);
  if (mandate.payee !== 'Unknown payee') {
    db.recordPattern({
      merchantId: merchant.value.id,
      pattern: normalise(mandate.payee),
      kind: 'substring',
      source: 'user',
    });
  }

  const saved = write(db, { ...mandate, name, purpose: details.purpose?.trim() || undefined, status: 'confirmed' });
  return saved.isOk() ? ok(undefined) : err({ message: saved.error.message });
};

export const dismissMandate = (db: Database, key: string): Result<void, { message: string }> => {
  const mandate = allMandates(db).find((m) => m.key === key);
  if (!mandate) return err({ message: 'That autopay is no longer here' });
  const saved = write(db, { ...mandate, status: 'dismissed' });
  return saved.isOk() ? ok(undefined) : err({ message: saved.error.message });
};

/**
 * A card read again by a better sorter: its payee, amount and frequency are
 * corrected, and a cancellation closes it; what the user said is kept.
 */
export const refreshMandate = (db: Database, key: string, mandate: Mandate): void => {
  const existing = allMandates(db).find((m) => m.key === key);
  if (!existing) return;
  write(db, {
    ...existing,
    payee: mandate.payee,
    amount: mandate.amount,
    upTo: mandate.upTo,
    frequency: mandate.frequency,
    status: mandate.revoked ? 'revoked' : existing.status,
  });
};
