import type { Database } from '@/db/client';
import { generateId, type Id } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';
import { isoDate } from '@/lib/date';
import { paise, type Paise } from '@/money/money';
import { recordTransaction } from '@/repo/manual';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';
import { MAX_UPI_AMOUNT, categoryForMerchantCode, type UpiRequest } from './link';

/**
 * A payment Hisaab handed to a UPI app, remembered until something reliable says how it ended.
 *
 * Hisaab does not move money. It scans, shows the payee, and opens the UPI app; what happens
 * after that is the UPI app's and the bank's. So a session is never assumed to have succeeded:
 * it is "waiting" until the bank's own message for that amount arrives (`bank message`), or the
 * payer says it went through (`you said so`). What the UPI app reported on the way back is kept
 * as a note, because another app's answer is not proof.
 *
 * Sessions live in the settings table, one key each, so no table is added for them.
 */
export type PaySession = {
  id: Id;
  /** ISO time the payer tapped Pay. */
  startedAt: string;
  vpa: string;
  name?: string;
  /** Paise. */
  amount: number;
  reference?: string;
  note?: string;
  categoryId?: string;
  /** What the UPI app said as Hisaab got control back. Its word only, not proof. */
  appSaid?: 'success' | 'failure' | 'pending';
  state: 'waiting' | 'confirmed' | 'cancelled';
  /** How a confirmed payment was established. */
  evidence?: 'bank message' | 'you said so';
  /** The ledger entry the payment became. */
  entryId?: string;
};

const PREFIX = 'pay:';

/** A waiting payment is shown on Home for this long; after that it is still kept, not forgotten. */
const SHOWN_DAYS = 7;

/** The bank's message is expected within this long after the payer taps Pay (and a little before, for clocks). */
const MATCH_BEFORE_MS = 2 * 60_000;
const MATCH_AFTER_MS = 90 * 60_000;

/**
 * True once the bank's message can no longer match this payment: it is still waiting, but the
 * window for an automatic match has closed, so only the payer's word can settle it now.
 */
export const matchWindowClosed = (session: Pick<PaySession, 'startedAt'>, now: Date = new Date()): boolean =>
  now.getTime() - Date.parse(session.startedAt) > MATCH_AFTER_MS;

const isSession = (value: unknown): value is PaySession => {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.startedAt === 'string' &&
    !Number.isNaN(Date.parse(s.startedAt)) &&
    typeof s.vpa === 'string' &&
    typeof s.amount === 'number' &&
    Number.isInteger(s.amount) &&
    s.amount > 0 &&
    (s.state === 'waiting' || s.state === 'confirmed' || s.state === 'cancelled')
  );
};

const parse = (text: string): PaySession | null => {
  try {
    const value: unknown = JSON.parse(text);
    return isSession(value) ? value : null;
  } catch {
    return null;
  }
};

const read = (db: Database, id: string): PaySession | null => {
  const text = db.getSetting(`${PREFIX}${id}`).getOrNull();
  return text ? parse(text) : null;
};

const write = (db: Database, session: PaySession): Result<PaySession, string> => {
  const saved = db.setSetting(`${PREFIX}${session.id}`, JSON.stringify(session));
  return saved.isOk() ? ok(session) : err(saved.error.message);
};

/** Every session, newest first. */
const all = (db: Database): PaySession[] =>
  (db.query<{ value: string }>(`SELECT value FROM settings WHERE key LIKE ?`, [`${PREFIX}%`]).getOrNull() ?? [])
    .flatMap((row) => parse(row.value) ?? [])
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

/** What to call the payee: the name it registered, else its UPI address. */
export const payeeLabel = (session: Pick<PaySession, 'name' | 'vpa'>): string => session.name ?? session.vpa;

/** Starts a session as the payer taps Pay: remembered before the UPI app opens. */
export const startPayment = (
  db: Database,
  request: UpiRequest,
  amount: Paise,
  categoryId?: Id,
  at: Date = new Date()
): Result<PaySession, string> => {
  if (!Number.isInteger(amount) || amount <= 0) return err('Enter an amount above zero.');
  if (amount > MAX_UPI_AMOUNT) return err('That amount looks wrong.');
  const session: PaySession = {
    id: generateId(),
    startedAt: at.toISOString(),
    vpa: request.vpa,
    amount,
    state: 'waiting',
  };
  if (request.name) session.name = request.name;
  if (request.reference) session.reference = request.reference;
  if (request.note) session.note = request.note;
  if (categoryId) session.categoryId = categoryId;
  return write(db, session);
};

/** Records what the UPI app said on the way back. Kept as a note; it changes nothing else. */
export const notePaymentResult = (db: Database, id: string, appSaid: NonNullable<PaySession['appSaid']>): void => {
  const session = read(db, id);
  if (session && session.state === 'waiting') write(db, { ...session, appSaid });
};

/** Payments handed to a UPI app that nothing has settled yet, newest first. */
export const waitingPayments = (db: Database, today: Date = new Date()): PaySession[] => {
  const since = today.getTime() - SHOWN_DAYS * 24 * 60 * 60_000;
  return all(db).filter((s) => s.state === 'waiting' && Date.parse(s.startedAt) >= since);
};

/** "No, it did not go through." */
export const cancelPayment = (db: Database, id: string): Result<void, string> => {
  const session = read(db, id);
  if (!session) return err('That payment is no longer there.');
  if (session.state !== 'waiting') return err('That payment is already settled.');
  const saved = write(db, { ...session, state: 'cancelled' });
  return saved.isOk() ? ok(undefined) : err(saved.error);
};

/**
 * "Yes, it went through", said by the payer with no bank message yet: recorded as an expense on
 * the account they name, marked as their word. If the bank's message arrives later it is matched
 * to this entry (`paymentFor`) rather than counted again.
 */
export const confirmPaid = (db: Database, id: string, accountId: Id): Result<Id, string> => {
  const session = read(db, id);
  if (!session) return err('That payment is no longer there.');
  if (session.state !== 'waiting') return err('That payment is already settled.');

  const entry = recordTransaction(db, {
    kind: 'expense',
    amount: paise(session.amount),
    accountId,
    description: payeeLabel(session),
    occurredAt: isoDate(new Date(session.startedAt)),
    categoryId: session.categoryId as Id | undefined,
  });
  if (entry.isErr()) return err(entry.error.message);

  const saved = write(db, { ...session, state: 'confirmed', evidence: 'you said so', entryId: entry.value.id });
  return saved.isOk() ? ok(entry.value.id) : err(saved.error);
};

/**
 * The payment a bank message is about, if Hisaab handed one to a UPI app: the same amount, no
 * earlier than the moment of paying and within 90 minutes of it. When the message names the payee's
 * UPI address, it has to be the one that was scanned. A payment the payer already said went through
 * (and has no bank message yet) is matched too, so it is not counted twice.
 */
export const paymentFor = (
  db: Database,
  message: { amount: Paise; postedAt: string; counterparty?: string }
): PaySession | null => {
  const at = Date.parse(message.postedAt);
  if (Number.isNaN(at)) return null;
  const named = message.counterparty?.includes('@') ? message.counterparty.trim().toLowerCase() : undefined;

  const fits = all(db).filter((s) => {
    const open = s.state === 'waiting' || (s.state === 'confirmed' && s.evidence === 'you said so' && s.entryId);
    if (!open || s.amount !== message.amount) return false;
    const gap = at - Date.parse(s.startedAt);
    if (gap < -MATCH_BEFORE_MS || gap > MATCH_AFTER_MS) return false;
    return named === undefined || named === s.vpa;
  });
  fits.sort((a, b) => Math.abs(at - Date.parse(a.startedAt)) - Math.abs(at - Date.parse(b.startedAt)));
  return fits[0] ?? null;
};

/** The bank's message settled a waiting payment, which became this entry. */
export const settleByBank = (db: Database, session: PaySession, entryId: Id): void => {
  write(db, { ...session, state: 'confirmed', evidence: 'bank message', entryId });
};

/**
 * The bank's message arrived for a payment the payer had already said went through: the entry stays,
 * the bank's message becomes its evidence, and the money is taken from the account the bank named.
 */
export const absorbByBank = (db: Database, session: PaySession, accountId: Id): Id | null => {
  if (!session.entryId) return null;
  const [leg] =
    db
      .query<{ id: string; account_id: string }>(
        `SELECT id, account_id FROM postings WHERE entry_id = ? AND account_id NOT IN (?, ?)`,
        [session.entryId, SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE, SYSTEM_ACCOUNT_IDS.SUSPENSE]
      )
      .getOrNull() ?? [];
  if (leg && leg.account_id !== accountId && db.moveLeg(leg.id as Id, accountId).isErr()) return null;
  write(db, { ...session, evidence: 'bank message' });
  return session.entryId as Id;
};

/**
 * The category to offer for a payee: the one used the last time this UPI address was paid, else the
 * one its merchant category points at, else none.
 */
export const suggestedCategory = (db: Database, request: UpiRequest): Id | undefined =>
  (all(db).find((s) => s.vpa === request.vpa && s.categoryId && s.state !== 'cancelled')?.categoryId as Id | undefined) ??
  categoryForMerchantCode(request.merchantCode);
