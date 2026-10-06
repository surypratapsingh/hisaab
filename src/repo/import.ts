import { Database, Account, RawSource, type EntryKind } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise, subtract } from '@/money/money';
import { detectParser } from '@/import/parsers';
import type { ImportResult, ParsedRow } from '@/import/types';
import { normalise } from '@/intel/normalise';
import { resolveMerchant, SEED_SUBSTRINGS, type LearnedPattern } from '@/intel/merchant';
import { categorise } from '@/intel/categorise';
import { detectTransfer } from '@/intel/transfer';
import { scoreTransaction } from '@/intel/score';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';
import { detectInvestment } from '@/intel/investment';
import { investmentAccount } from '@/repo/manual';
import { claimLogged } from '@/repo/paisa';
import { CHANNEL_NAME } from '@/repo/analysisViews';
import { settleEntry } from '@/repo/views';
import type { ImportedStatement } from '@/ui/screens/AccountsScreen';

const INVESTMENT_CATEGORY = 'cat_investment' as Id;

export type ImportError = {
  code: 'NO_PARSER' | 'PARSE_FAILED' | 'WRITE_FAILED';
  message: string;
  rowNumber?: number;
};

/** A statement row's identity: which account, when, how much, and as written. */
const statementRef = (accountId: Id, row: ParsedRow, signedAmount: Paise): string =>
  [accountId, row.date.slice(0, 10), signedAmount, row.narration].join('|');

/** The account a statement row was imported into, read back from its identity. */
const accountOfStatementRef = (ref: string): Id => ref.slice(0, ref.indexOf('|')) as Id;

/**
 * The latest statement imports, newest first: which file, into which account, the dates its
 * rows cover and how many entries it brought in or matched. A statement imported again adds
 * no rows, so it is not listed twice.
 */
export const statementImports = (db: Database, limit = 5): ImportedStatement[] => {
  const rows =
    db
      .query<{ id: string; file: string | null; at: string; ref: string; entries: number; first: string; last: string }>(
        `SELECT r.id AS id, r.source_ref AS file, r.parsed_at AS at, MIN(s.ref) AS ref,
                COUNT(*) AS entries, MIN(e.occurred_at) AS first, MAX(e.occurred_at) AS last
         FROM raw_records r
         JOIN statement_rows s ON s.raw_id = r.id
         JOIN journal_entries e ON e.id = s.entry_id
         WHERE r.source IN ('statement_pdf', 'statement_csv') AND r.parsed_at IS NOT NULL
         GROUP BY r.id
         ORDER BY r.parsed_at DESC
         LIMIT ?`,
        [limit]
      )
      .getOrNull() ?? [];
  const accounts = new Map((db.getAllAccounts().getOrNull() ?? []).map((a) => [a.id as string, a]));
  return rows.map((row) => {
    const account = accounts.get(accountOfStatementRef(row.ref));
    return {
      rawId: row.id,
      fileName: row.file ?? 'Statement',
      account: account
        ? [account.name, account.last4 ? `•••• ${account.last4}` : ''].filter(Boolean).join(' ')
        : undefined,
      from: row.first.slice(0, 10),
      to: row.last.slice(0, 10),
      entries: row.entries,
      importedAt: row.at,
    };
  });
};

const rowHash = (row: ParsedRow): string => {
  const str = [row.date, row.narration, row.debit ?? 0, row.credit ?? 0].join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

export const learnedPatterns = (db: Database): LearnedPattern[] => {
  const patterns = db.getPatterns();
  const merchants = db.getAllMerchants();
  if (patterns.isErr() || merchants.isErr()) return [];

  const byId = new Map(merchants.value.map((m) => [m.id, m.canonical]));

  return patterns.value.flatMap((p) => {
    const canonical = byId.get(p.merchantId);
    return canonical
      ? [{ merchantId: p.merchantId, canonical, pattern: p.pattern, kind: p.kind }]
      : [];
  });
};

/**
 * Statement text to journal entries.
 *
 * The raw text is stored before anything is parsed from it, so a parser bug is
 * fixed by replaying stored text rather than asking the user to find the file
 * again.
 */
export const importStatement = (
  db: Database,
  input: {
    text: string;
    sourceRef: string;
    source: RawSource;
    account: Account;
    ownAccounts?: Array<{ last4: string; id: string }>;
  }
): Result<ImportResult, ImportError> => {
  const parser = detectParser(input.text);

  const raw = db.saveRawRecord({
    source: input.source,
    sourceRef: input.sourceRef,
    payload: input.text,
    parser: parser?.id,
  });

  if (raw.isErr()) {
    return err({ code: 'WRITE_FAILED', message: raw.error.message });
  }

  if (!parser) {
    db.run(`UPDATE raw_records SET parse_error = ? WHERE id = ?`, [
      'No parser recognised this statement',
      raw.value.id,
    ]);
    return err({
      code: 'NO_PARSER',
      message: 'No parser recognised this statement',
    });
  }

  const parsed = parser.parse(input.text);

  if (parsed.isErr()) {
    db.run(`UPDATE raw_records SET parse_error = ? WHERE id = ?`, [
      parsed.error.message,
      raw.value.id,
    ]);
    return err({
      code: 'PARSE_FAILED',
      message: parsed.error.message,
      rowNumber: parsed.error.rowNumber,
    });
  }

  return ok(
    postRows(db, parsed.value, input.account, raw.value.id, input.ownAccounts ?? [])
  );
};

const postRows = (
  db: Database,
  rows: ParsedRow[],
  account: Account,
  rawId: Id,
  ownAccounts: Array<{ last4: string; id: string }>
): ImportResult => {
  const learned = learnedPatterns(db);
  const seen = new Set<string>();

  let created = 0;
  let duplicates = 0;
  let needingReview = 0;
  let failed = 0;

  for (const row of rows) {
    const hash = rowHash(row);
    if (seen.has(hash)) {
      duplicates++;
      continue;
    }
    seen.add(hash);

    const isDebit = row.debit !== undefined;
    const amount: Paise = row.debit ?? row.credit ?? paise(0);
    const sourceDelta = isDebit ? subtract(paise(0), amount) : amount;
    const counterDelta = subtract(paise(0), sourceDelta);

    // Re-importing the same statement must add nothing, so a row already in
    // the ledger is skipped before any work is done on it.
    const ref = statementRef(account.id, row, sourceDelta);
    const known = db.findStatementRow(ref);
    if (known.isOk() && known.value !== null) {
      duplicates++;
      continue;
    }

    // Entries imported before rows were recorded by identity are still found
    // by their narration, and get their identity backfilled on the way.
    const legacy = db.findDuplicateEntry(account.id, row.date, row.narration, sourceDelta);
    if (legacy.isOk() && legacy.value !== null) {
      db.recordStatementRow(ref, legacy.value, rawId);
      duplicates++;
      continue;
    }

    // The user may already have typed this one in by hand. Keep their entry —
    // it carries their own description and category — and claim it for this
    // row, so it can neither absorb a second row nor be duplicated when the
    // same statement is imported again.
    const manual = db.findManualMatch(account.id, sourceDelta, row.date);
    if (manual.isOk() && manual.value !== null) {
      db.recordStatementRow(ref, manual.value, rawId);
      nameFromStatement(db, manual.value, row.narration, isDebit, ownAccounts, learned);
      duplicates++;
      continue;
    }

    // Written down in Paisa already: that entry moves onto this account.
    const logged = claimLogged(db, account.id, sourceDelta, row.date);
    if (logged) {
      db.recordStatementRow(ref, logged, rawId);
      duplicates++;
      continue;
    }

    const classified = classify(db, row.narration, isDebit, ownAccounts, learned);
    if (!classified) {
      failed++;
      continue;
    }

    const written = db.createJournalEntry(
      {
        occurredAt: row.date,
        description: row.narration,
        rawId,
        merchantId: classified.merchantId,
        categoryId: classified.categoryId,
        kind: classified.kind,
        confidence: classified.confidence,
      },
      [
        { accountId: account.id, amount: sourceDelta },
        { accountId: classified.counterAccount, amount: counterDelta },
      ]
    );

    if (written.isErr()) {
      failed++;
      continue;
    }

    db.recordStatementRow(ref, written.value.id, rawId);
    created++;
    if (classified.needsReview) needingReview++;
  }

  // The balance walk has already proved the rows are in order, so the last
  // one carrying a balance is the bank's closing figure for this statement.
  const closing = [...rows].reverse().find((row) => row.balance !== undefined);
  if (closing?.balance !== undefined) {
    db.recordBalanceAnchor(account.id, closing.date, closing.balance, rawId);
  }

  db.run(`UPDATE raw_records SET parsed_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    rawId,
  ]);

  const dates = rows.map((row) => row.date.slice(0, 10)).sort();
  return {
    rowsParsed: created,
    rowsWithError: failed,
    duplicatesSkipped: duplicates,
    rowsNeedingReview: needingReview,
    errors: [],
    rawId,
    accountId: account.id,
    from: dates[0],
    to: dates[dates.length - 1],
    closingBalance: closing?.balance,
  };
};

/**
 * A bank message that never said who ("Mob Bk", "Money sent") takes the payee
 * from the statement row that claims it, and its category when it has none.
 * Anything typed by hand, or a message that did name someone, keeps its words.
 */
const nameFromStatement = (
  db: Database,
  entryId: Id,
  narration: string,
  isDebit: boolean,
  ownAccounts: Array<{ last4: string; id: string }>,
  learned: LearnedPattern[]
): void => {
  const entry = db.getEntry(entryId).getOrNull();
  if (!entry?.rawId || !CHANNEL_NAME.test(entry.description.trim())) return;
  if (db.getRawRecord(entry.rawId).getOrNull()?.source !== 'notification') return;

  const classified = classify(db, narration, isDebit, ownAccounts, learned);
  const categoryId =
    !entry.categoryId && classified?.kind !== 'transfer' ? classified?.categoryId : undefined;
  db.updateEntry(entryId, {
    description: narration,
    merchantId: classified?.merchantId ?? entry.merchantId,
    ...(categoryId && { categoryId }),
  });
  if (categoryId) settleEntry(db, entryId, categoryId);
};

export type Classification = {
  merchantId?: Id;
  categoryId?: Id;
  kind: EntryKind;
  counterAccount: Id;
  confidence: number;
  /** The other side went to Suspense: the user should say what this was. */
  needsReview: boolean;
};

/**
 * What one transaction is and where its other side belongs: merchant,
 * category, transfer, investment, or Suspense when nothing is sure. Shared
 * by statement import and notification capture, so both learn from the
 * same corrections. Returns null only if an account could not be created.
 */
export const classify = (
  db: Database,
  narration: string,
  isDebit: boolean,
  ownAccounts: Array<{ last4: string; id: string }>,
  learned: LearnedPattern[]
): Classification | null => {
  const normalised = normalise(narration);
  const merchant = resolveMerchant(normalised, learned);
  const transfer = detectTransfer(normalised, ownAccounts);

  let merchantId: Id | undefined = merchant.merchantId;
  if (!merchantId && merchant.merchantName) {
    const saved = db.upsertMerchant(merchant.merchantName);
    if (saved.isOk()) merchantId = saved.value.id;
  }

  if (merchant.matchedPattern) {
    db.bumpPatternHits(
      merchant.matchedPattern.pattern,
      merchant.matchedPattern.kind
    );
  }

  // A category the user already set on this merchant outranks any guess
  // from the narration. Without this the correction loop only half closes:
  // the payee would be recognised but filed as Unknown all over again.
  const learnedCategory = merchantId
    ? db.getMerchant(merchantId).getOrNull()?.categoryId
    : undefined;

  // A SIP debit is money moving into something the user owns, not spending.
  // The wording decides, or a merchant the user has filed under Investment.
  const invested =
    !transfer.isTransfer &&
    isDebit &&
    (learnedCategory === INVESTMENT_CATEGORY ||
      detectInvestment(narration, isDebit).isInvestment);

  // Fees & Charges is money the bank takes: "INTEREST" on money coming in is earnings.
  const guessed = categorise(merchant.merchantName, normalised);
  const category = invested
    ? { categoryId: INVESTMENT_CATEGORY, confidence: 0.9 }
    : learnedCategory
      ? { categoryId: learnedCategory, confidence: 0.9 }
      : !isDebit && guessed.categoryId === 'cat_fees'
        ? { categoryId: undefined, confidence: 0 }
        : guessed;

  const score = scoreTransaction(
    transfer.isTransfer,
    merchant.merchantName !== undefined,
    merchant.confidence,
    category.confidence
  );

  // A confident classification lands in the matching system account; a
  // narration nobody claimed lands in Suspense, where the user can see it.
  let counterAccount = counterpartyFor(
    transfer.isTransfer,
    isDebit,
    score.shouldReview
  );
  if (invested) {
    const target = investmentAccount(db);
    if (target.isErr()) return null;
    counterAccount = target.value.id;
  }

  return {
    merchantId,
    categoryId: category.confidence > 0 ? category.categoryId : undefined,
    kind: transfer.isTransfer
      ? 'transfer'
      : invested
        ? 'investment'
        : isDebit
          ? 'expense'
          : 'income',
    counterAccount,
    confidence: invested ? Math.max(score.overall, 0.9) : score.overall,
    needsReview: score.shouldReview && !invested && !transfer.isTransfer,
  };
};

const counterpartyFor = (
  isTransfer: boolean,
  isDebit: boolean,
  needsReview: boolean
): Id => {
  if (isTransfer) return SYSTEM_ACCOUNT_IDS.CASH;
  if (needsReview) return SYSTEM_ACCOUNT_IDS.SUSPENSE;
  return isDebit
    ? SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE
    : SYSTEM_ACCOUNT_IDS.UNKNOWN_INCOME;
};

/**
 * Re-runs the current parser over text already stored, for when a parser bug
 * is fixed. The user never re-uploads anything.
 */
export const replayRawRecord = (
  db: Database,
  rawId: Id,
  account: Account
): Result<ImportResult, ImportError> => {
  const rows = db.getRawRecord(rawId);
  if (rows.isErr()) {
    return err({ code: 'WRITE_FAILED', message: rows.error.message });
  }
  if (!rows.value) {
    return err({ code: 'PARSE_FAILED', message: `No raw record ${rawId}` });
  }

  const parser = detectParser(rows.value.payload);
  if (!parser) {
    return err({ code: 'NO_PARSER', message: 'No parser recognised this text' });
  }

  const parsed = parser.parse(rows.value.payload);
  if (parsed.isErr()) {
    return err({ code: 'PARSE_FAILED', message: parsed.error.message });
  }

  return ok(postRows(db, parsed.value, account, rawId, []));
};

/**
 * Shipped payee names used to match inside words: CRED in CREDITED, OLA in COLA.
 * An entry named only that way loses the name, unless something the user taught
 * still gives it. Cheap enough to run at every open, so a restored older backup
 * is put right too. Returns how many entries lost a name.
 */
export const dropNamesFoundInsideWords = (db: Database): number => {
  const shipped = Object.entries(SEED_SUBSTRINGS);
  const rows =
    db
      .query<{ id: string; description: string; canonical: string }>(
        `SELECT e.id, e.description, m.canonical FROM journal_entries e
         JOIN merchants m ON m.id = e.merchant_id
         WHERE m.canonical IN (${shipped.map(() => '?').join(', ')})`,
        shipped.map(([, name]) => name)
      )
      .getOrNull() ?? [];
  const learned = learnedPatterns(db);
  let dropped = 0;
  for (const row of rows) {
    const text = normalise(row.description);
    const oldRuleMatched = shipped.some(([key, name]) => name === row.canonical && text.includes(key));
    if (!oldRuleMatched || resolveMerchant(text, learned).merchantName === row.canonical) continue;
    if (db.updateEntry(row.id as Id, { merchantId: undefined }).isOk()) dropped++;
  }
  return dropped;
};
