import { Database, type Account } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';
import { isoDate } from '@/lib/date';
import { Paise, add, paise, subtract } from '@/money/money';
import { classify, learnedPatterns } from '@/repo/import';
import { cashAccount, setBalanceNow } from '@/repo/manual';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';
import { parseAlert, type CapturedAlert, type ParsedAlert } from './alerts';
import { sortMessage, type MessageKind } from './sort';
import { noteMandate, refreshMandate } from './mandates';
import { claimLogged, unclaimAll, CLAIM_PREFIX } from '@/repo/paisa';
import { paymentFor, settleByBank, absorbByBank, payeeLabel } from '@/upi/session';

export type IngestOutcome =
  /** A new entry is in the ledger. */
  | { status: 'recorded'; entryId: Id; cashWithdrawal: boolean; needsReview: boolean }
  /** The same payment was already there: another app's alert, or the statement. */
  | { status: 'duplicate'; entryId: Id }
  /** Kept as raw input, but not a completed payment (an OTP, an offer, a scam…). */
  | { status: 'ignored'; kind: MessageKind }
  /** An autopay was set up; the user is asked to confirm it. */
  | { status: 'mandate'; isNew: boolean }
  /** A payment, but on no account the user has added. Kept for when they do. */
  | { status: 'unknown_account'; digits?: string };

export type IngestError = { code: 'DATABASE'; message: string };

/** Two alerts for one payment arrive within minutes of each other. */
const SAME_PAYMENT_MS = 15 * 60 * 1000;

const PARSER_ID = 'alert_v1';
const SUBSCRIPTIONS = 'cat_subscriptions' as Id;

/** The user's own everyday accounts: not Cash or Investments, which no bank alert names. */
const spendingAccounts = (db: Database): Account[] =>
  (db.getAllAccounts().getOrNull() ?? []).filter(
    (a) => !a.isSystem && a.kind === 'asset' && a.subkind !== 'cash' && a.subkind !== 'investment'
  );

/**
 * Which account an alert is about. Banks print three or four trailing digits
 * ("XX789", "**1234"), so either may be the end of the other. With no digits
 * at all (a Google Pay notification), a single account is the only safe guess.
 */
const accountFor = (accounts: Account[], digits?: string, sender?: string): Account | undefined => {
  if (digits) {
    const matches = accounts.filter(
      (a) => a.last4 && (a.last4.endsWith(digits) || digits.endsWith(a.last4))
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (accounts.length === 1) return accounts[0];
  // Union Bank's autopay debits name no account, but come from "UNIONB": the
  // one account called Union is the only one they can be about.
  const bank = sender ? BANK_BY_SENDER.find(([code]) => code.test(sender))?.[1] : undefined;
  const named = bank ? accounts.filter((a) => bank.test(`${a.name} ${a.institution ?? ''}`)) : [];
  return named.length === 1 ? named[0] : undefined;
};

const BANK_BY_SENDER: Array<[RegExp, RegExp]> = [
  [/UNIONB/i, /\bunion\b/i],
  [/SBI(?!MF)/i, /\bsbi\b|state bank/i],
  [/HDFCBK/i, /\bhdfc\b/i],
  [/ICICI/i, /\bicici\b/i],
  [/AXIS/i, /\baxis\b/i],
  [/KOTAK/i, /\bkotak\b/i],
  [/PNB/i, /\bpnb\b|punjab national/i],
  [/CANBNK/i, /\bcanara\b/i],
  [/IDFC/i, /\bidfc\b/i],
  [/INDUS/i, /\bindusind\b/i],
  [/YESB/i, /\byes\b/i],
  [/BOBTXN|BOBSMS/i, /\bbob\b|baroda/i],
  [/PAYTMB/i, /\bpaytm\b/i],
];

const readAlert = (payload: string | null): CapturedAlert | null => {
  try {
    return payload ? (JSON.parse(payload) as CapturedAlert) : null;
  } catch {
    return null;
  }
};

/**
 * The same payment already in the ledger. A statement row always counts; an
 * earlier alert counts when it carries the same reference, or, with no
 * reference to compare, when it arrived within a few minutes.
 */
const alreadyRecorded = (
  db: Database,
  account: Account,
  alert: CapturedAlert,
  parsed: ParsedAlert,
  signed: ReturnType<typeof paise>,
  date: string
): Id | null => {
  const near = db.entriesNear(account.id, signed, date).getOrNull() ?? [];
  for (const candidate of near) {
    if (candidate.source === 'statement_csv' || candidate.source === 'statement_pdf') {
      return candidate.entryId;
    }
    if (candidate.source !== 'notification') continue;

    const earlier = readAlert(candidate.payload);
    if (!earlier) continue;
    const earlierRef = parseAlert(earlier)?.reference;
    if (parsed.reference && earlierRef) {
      if (parsed.reference === earlierRef) return candidate.entryId;
      continue;
    }
    const apart = Math.abs(Date.parse(alert.postedAt) - Date.parse(earlier.postedAt));
    if (apart <= SAME_PAYMENT_MS) return candidate.entryId;
  }
  return null;
};

/**
 * One captured alert into the ledger. The alert is stored as a raw record
 * before anything is read from it, so a better parser can replay it later.
 *
 * Cash taken from an ATM is moved to the user's Cash account instead of being
 * called spending: the spending happens later, and the app asks about it.
 */
export const ingestAlert = (
  db: Database,
  alert: CapturedAlert,
  /** Re-reading an alert already kept, after the sorter improved. */
  replayOf?: Id
): Result<IngestOutcome, IngestError> => {
  let rawId: Id;
  if (replayOf) {
    rawId = replayOf;
    // Already in the ledger from an earlier reading, as its own entry or as
    // the Paisa entry it was matched to: reading it again adds nothing.
    const [own] = db.query<{ id: string }>(`SELECT id FROM journal_entries WHERE raw_id = ? LIMIT 1`, [rawId]).getOrNull() ?? [];
    const claimed = db.getSetting(`${CLAIM_PREFIX}${rawId}`).getOrNull();
    const entryId = own?.id ?? (claimed && db.getEntry(claimed as Id).getOrNull() ? claimed : null);
    if (entryId) {
      db.run(`UPDATE raw_records SET parse_error = NULL, parsed_at = ? WHERE id = ?`, [new Date().toISOString(), rawId]);
      return ok({ status: 'duplicate', entryId: entryId as Id });
    }
    // The old label no longer applies; this reading writes its own.
    db.run(`UPDATE raw_records SET parse_error = NULL WHERE id = ?`, [rawId]);
  } else {
    const raw = db.saveRawRecord({
      source: 'notification',
      sourceRef: alert.app,
      payload: JSON.stringify(alert),
      parser: PARSER_ID,
    });
    if (raw.isErr()) return err({ code: 'DATABASE', message: raw.error.message });
    rawId = raw.value.id;
  }

  const note = (column: 'parse_error' | 'parsed_at', value: string) =>
    db.run(`UPDATE raw_records SET ${column} = ? WHERE id = ?`, [value, rawId]);

  // Sorted first: only real payments reach the ledger. The rest keep their
  // label on the raw record, for the Messages screen.
  const sorted = sortMessage(alert);
  if (sorted.kind === 'mandate' && sorted.mandate) {
    note('parse_error', 'Sorted: mandate');
    const asked = noteMandate(db, rawId, sorted.mandate, alert.postedAt);
    return ok({ status: 'mandate', isNew: asked });
  }
  const parsed = sorted.alert;
  if (sorted.kind !== 'transaction' || !parsed) {
    note('parse_error', `Sorted: ${sorted.kind}`);
    return ok({ status: 'ignored', kind: sorted.kind });
  }

  const accounts = spendingAccounts(db);
  const account = accountFor(accounts, parsed.accountDigits, alert.sender);
  if (!account) {
    note(
      'parse_error',
      parsed.accountDigits
        ? `No account ending ${parsed.accountDigits}`
        : 'No account named and more than one to choose from'
    );
    return ok({ status: 'unknown_account', digits: parsed.accountDigits });
  }

  const isDebit = parsed.direction === 'debit';
  const signed = isDebit ? subtract(paise(0), parsed.amount) : parsed.amount;
  const date = isoDate(new Date(alert.postedAt));
  // "Avl Bal Rs …" in the alert is the account's real balance right after it.
  const trackBalance = () => {
    if (parsed.balance !== undefined) setBalanceNow(db, account.id, parsed.balance, date, rawId);
  };

  const existing = alreadyRecorded(db, account, alert, parsed, signed, date);
  if (existing) {
    note('parsed_at', new Date().toISOString());
    return ok({ status: 'duplicate', entryId: existing });
  }

  // A payment Hisaab handed to a UPI app: this message is the bank's word that it went through.
  // One the payer already said went through is the entry that message belongs to, not a new one.
  const found = isDebit && !parsed.cashWithdrawal
    ? paymentFor(db, { amount: parsed.amount, postedAt: alert.postedAt, counterparty: parsed.counterparty })
    : null;
  if (found?.state === 'confirmed') {
    const entryId = absorbByBank(db, found, account.id);
    if (entryId) {
      trackBalance();
      note('parsed_at', new Date().toISOString());
      return ok({ status: 'duplicate', entryId });
    }
  }
  const paid = found?.state === 'waiting' ? found : null;

  // Written down in Paisa already: that entry moves onto this account.
  if (!parsed.cashWithdrawal) {
    const claimed = claimLogged(db, account.id, signed, date, rawId);
    if (claimed) {
      trackBalance();
      note('parsed_at', new Date().toISOString());
      return ok({ status: 'duplicate', entryId: claimed });
    }
  }

  // The payee the payer scanned and saw beats what a bank message happens to print; with no name
  // at all, say what happened rather than show its text.
  const description = paid ? payeeLabel(paid) : (parsed.counterparty ?? (isDebit ? 'Money sent' : 'Money received'));

  if (parsed.cashWithdrawal) {
    const cash = cashAccount(db);
    if (cash.isErr()) return err({ code: 'DATABASE', message: cash.error.message });

    const written = db.createJournalEntry(
      {
        occurredAt: date,
        description: 'Cash withdrawal',
        rawId,
        categoryId: 'cat_transfers' as Id,
        kind: 'transfer',
        confidence: 1,
      },
      [
        { accountId: account.id, amount: signed },
        { accountId: cash.value.id, amount: parsed.amount },
      ]
    );
    if (written.isErr()) return err({ code: 'DATABASE', message: written.error.message });
    trackBalance();
    note('parsed_at', new Date().toISOString());
    return ok({ status: 'recorded', entryId: written.value.id, cashWithdrawal: true, needsReview: false });
  }

  const others = accounts
    .filter((a) => a.id !== account.id && a.last4)
    .map((a) => ({ last4: a.last4!, id: a.id }));
  const classified = classify(db, description, isDebit, others, learnedPatterns(db));
  if (!classified) return err({ code: 'DATABASE', message: 'Could not classify the payment' });

  // A category the payer picked as they paid is known, not guessed.
  const chosen = paid?.categoryId && classified.kind === 'expense' ? (paid.categoryId as Id) : undefined;
  const known = parsed.autopay || chosen !== undefined;

  const written = db.createJournalEntry(
    {
      occurredAt: date,
      description,
      rawId,
      merchantId: classified.merchantId,
      categoryId:
        chosen ??
        (parsed.autopay && !classified.merchantId && classified.kind === 'expense'
          ? (classified.categoryId ?? SUBSCRIPTIONS)
          : classified.categoryId),
      kind: classified.kind,
      confidence: chosen ? 1 : parsed.autopay ? Math.max(classified.confidence, 0.9) : classified.confidence,
    },
    [
      { accountId: account.id, amount: signed },
      {
        // An autopay payment, or one the payer categorised, is known spending, not something to explain.
        accountId:
          known && classified.counterAccount === SYSTEM_ACCOUNT_IDS.SUSPENSE
            ? SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE
            : classified.counterAccount,
        amount: subtract(paise(0), signed),
      },
    ]
  );
  if (written.isErr()) return err({ code: 'DATABASE', message: written.error.message });

  if (paid) settleByBank(db, paid, written.value.id);
  trackBalance();
  note('parsed_at', new Date().toISOString());
  return ok({
    status: 'recorded',
    entryId: written.value.id,
    cashWithdrawal: false,
    needsReview: classified.needsReview && !known,
  });
};

export type WaitingAccount = {
  /** The last digits the bank messages name, e.g. "0100". */
  digits: string;
  messages: number;
  /** What those messages say went out of, and came into, that account. */
  moneyOut: Paise;
  moneyIn: Paise;
};

/**
 * Bank messages about accounts that have not been added yet, grouped by the account digits
 * they name, biggest first. Until the account exists none of that money is counted, so this is
 * what Home asks about.
 */
export const waitingAccounts = (db: Database): WaitingAccount[] => {
  const rows =
    db
      .query<{ payload: string; parse_error: string }>(
        `SELECT payload, parse_error FROM raw_records
         WHERE source = 'notification' AND parse_error LIKE 'No account ending %'`
      )
      .getOrNull() ?? [];

  const groups = new Map<string, WaitingAccount>();
  for (const row of rows) {
    const digits = row.parse_error.replace('No account ending ', '').trim();
    const alert = readAlert(row.payload);
    const parsed = alert && parseAlert(alert);
    if (!digits || !parsed) continue;

    const group = groups.get(digits) ?? { digits, messages: 0, moneyOut: paise(0), moneyIn: paise(0) };
    group.messages++;
    if (parsed.direction === 'debit') group.moneyOut = add(group.moneyOut, parsed.amount);
    else group.moneyIn = add(group.moneyIn, parsed.amount);
    groups.set(digits, group);
  }

  return [...groups.values()].sort((a, b) => b.messages - a.messages || a.digits.localeCompare(b.digits));
};

/**
 * Re-reads alerts that were waiting for an account, after the user adds one.
 * The originals stay as they are; each retry is a fresh raw record.
 */
export const retryUnmatched = (db: Database): number => {
  const pending = db
    .query<{ id: string; payload: string }>(
      `SELECT id, payload FROM raw_records
       WHERE source = 'notification' AND parse_error LIKE 'No account%'`
    )
    .getOrNull() ?? [];

  const accounts = spendingAccounts(db);
  let recorded = 0;
  for (const row of pending) {
    const alert = readAlert(row.payload);
    const parsed = alert && parseAlert(alert);
    // Only retry once an account matches, so a still-unmatched alert is not
    // copied into a new raw record on every attempt.
    if (!alert || !parsed || !accountFor(accounts, parsed.accountDigits, alert.sender)) continue;
    // Read again in place: the raw record stays the one record of it.
    const outcome = ingestAlert(db, alert, row.id as Id);
    if (outcome.isOk() && outcome.value.status === 'recorded') recorded++;
  }
  return recorded;
};

/** Bump when the sorter changes, so messages already kept are sorted again. */
export const SORTER_VERSION = 7;
/** Below this, every message is read again from scratch (see rebuildFromMessages). */
const REBUILD_BELOW = 6;
const SETTING_SORTER = 'sorter_version';

/**
 * Re-sorts every kept message that was not a payment, when the sorter has
 * improved since. A message that now reads as a payment is recorded; a
 * mandate card that was really a payment disappears.
 */
export const resortMessages = (db: Database): number => {
  const stored = Number(db.getSetting(SETTING_SORTER).getOrNull() ?? 0);
  if (stored >= SORTER_VERSION) return 0;
  // Version 5 recorded some alerts twice; the only clean fix is a full re-read.
  if (stored > 0 && stored < REBUILD_BELOW) {
    const rebuilt = rebuildFromMessages(db);
    db.setSetting(SETTING_SORTER, String(SORTER_VERSION));
    return rebuilt;
  }

  const rows =
    db
      .query<{ id: string; payload: string }>(
        `SELECT id, payload FROM raw_records
         WHERE source = 'notification' AND (parse_error LIKE 'Sorted:%' OR parse_error LIKE 'No account%')
         ORDER BY ingested_at`
      )
      .getOrNull() ?? [];

  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const alert = readAlert(row.payload);
      if (!alert) continue;
      // Still a mandate: correct its card, keeping whatever the user said.
      const sorted = sortMessage(alert);
      if (sorted.kind === 'mandate' && sorted.mandate) {
        refreshMandate(db, `mandate:${row.id}`, sorted.mandate);
        continue;
      }
      // Not one after all (a payment by an autopay, say): drop its card.
      db.setSetting(`mandate:${row.id}`, null);
      const outcome = ingestAlert(db, alert, row.id as Id);
      if (outcome.isOk() && outcome.value.status === 'recorded') changed++;
    }
    return ok(undefined);
  }, 'RESORT_FAILED');

  db.setSetting(SETTING_SORTER, String(SORTER_VERSION));
  return changed;
};

/**
 * Everything the ledger learned from messages, learned again: entries made
 * from alerts are removed (their raw records stay), Paisa entries go back to
 * their Paisa accounts, balances taken from alerts are forgotten, and every
 * message is read again in the order it arrived. Hand-typed entries,
 * statements and what the user said about autopays are untouched.
 */
export const rebuildFromMessages = (db: Database): number => {
  let recorded = 0;
  db.transaction(() => {
    db.run(
      `DELETE FROM journal_entries WHERE raw_id IN (SELECT id FROM raw_records WHERE source = 'notification')`
    );
    unclaimAll(db);
    db.run(
      `DELETE FROM balance_anchors WHERE raw_id IN (SELECT id FROM raw_records WHERE source = 'notification')`
    );

    const rows = (
      db
        .query<{ id: string; payload: string; parse_error: string | null }>(
          `SELECT id, payload, parse_error FROM raw_records WHERE source = 'notification'`
        )
        .getOrNull() ?? []
    )
      // Copies made by the old retry are read; their originals are not.
      .filter((row) => row.parse_error !== 'Retried once an account existed')
      .flatMap((row) => {
        const alert = readAlert(row.payload);
        return alert ? [{ id: row.id as Id, alert }] : [];
      })
      .sort((a, b) => a.alert.postedAt.localeCompare(b.alert.postedAt));

    for (const row of rows) {
      db.run(`UPDATE raw_records SET parse_error = NULL, parsed_at = NULL WHERE id = ?`, [row.id]);
      const outcome = ingestAlert(db, row.alert, row.id);
      if (outcome.isOk() && outcome.value.status === 'recorded') recorded++;
    }
    return ok(undefined);
  }, 'REBUILD_FAILED');
  return recorded;
};
