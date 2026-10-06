import {
  SCHEMA_SQL,
  SCHEMA_VERSION,
  SYSTEM_ACCOUNTS,
  DEFAULT_CATEGORIES,
} from './schema';
import type { SqliteDriver, SqlValue, SqlRow } from './driver';
import { Paise, paise, sum } from '@/money/money';
import { generateId, Id } from '@/lib/ulid';
import { toUTC, now } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';

export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity';
export type AccountSubkind =
  | 'bank'
  | 'credit_card'
  | 'cash'
  | 'wallet'
  | 'loan'
  | 'investment';

export type Account = {
  id: Id;
  name: string;
  kind: AccountKind;
  subkind?: AccountSubkind;
  last4?: string;
  institution?: string;
  isSystem: boolean;
  archivedAt?: string;
  createdAt: string;
  /** Listed, but left out of wealth, Safe to spend, spending, income and reports. */
  excluded: boolean;
};

export type Posting = {
  id: Id;
  entryId: Id;
  accountId: Id;
  amount: Paise;
};

export type EntryKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'refund'
  | 'fee'
  | 'investment';

export type JournalEntry = {
  id: Id;
  occurredAt: string;
  postedAt?: string;
  description: string;
  rawId?: Id;
  merchantId?: Id;
  categoryId?: Id;
  kind: EntryKind;
  confidence: number;
  reviewedAt?: string;
  notes?: string;
  createdAt: string;
};

export type RawSource =
  | 'statement_pdf'
  | 'statement_csv'
  | 'notification'
  | 'manual'
  | 'voice'
  | 'receipt';

export type RawRecord = {
  id: Id;
  source: RawSource;
  sourceRef?: string;
  payload: string;
  parser?: string;
  parsedAt?: string;
  parseError?: string;
  ingestedAt: string;
};

export type Merchant = {
  id: Id;
  canonical: string;
  categoryId?: Id;
  createdAt: string;
};

export type PatternKind = 'vpa' | 'substring' | 'regex';
export type PatternSource = 'seed' | 'user' | 'llm';

export type MerchantPattern = {
  id: Id;
  merchantId: Id;
  pattern: string;
  kind: PatternKind;
  source: PatternSource;
  hits: number;
};

export type Category = {
  id: Id;
  name: string;
  parentId?: Id;
  icon?: string;
  sort?: number;
};

export type EntryFilter = {
  from?: string;
  to?: string;
  categoryId?: Id;
  merchantId?: Id;
  accountId?: Id;
  search?: string;
  limit?: number;
  offset?: number;
};

export type DatabaseError = {
  code: string;
  message: string;
};

type AccountRow = {
  id: string;
  name: string;
  kind: string;
  subkind: string | null;
  last4: string | null;
  institution: string | null;
  is_system: number;
  archived_at: string | null;
  created_at: string;
  excluded: number | null;
};

type EntryRow = {
  id: string;
  occurred_at: string;
  posted_at: string | null;
  description: string;
  raw_id: string | null;
  merchant_id: string | null;
  category_id: string | null;
  kind: string;
  confidence: number;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
};

type PostingRow = {
  id: string;
  entry_id: string;
  account_id: string;
  amount: number;
};

type MerchantRow = {
  id: string;
  canonical: string;
  category_id: string | null;
  created_at: string;
};

type PatternRow = {
  id: string;
  merchant_id: string;
  pattern: string;
  kind: string;
  source: string;
  hits: number;
};

type CategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  sort: number | null;
};

const optional = (value: string | null): string | undefined => value ?? undefined;

const toAccount = (row: AccountRow): Account => ({
  id: row.id as Id,
  name: row.name,
  kind: row.kind as AccountKind,
  subkind: (row.subkind ?? undefined) as AccountSubkind | undefined,
  last4: optional(row.last4),
  institution: optional(row.institution),
  isSystem: row.is_system === 1,
  archivedAt: optional(row.archived_at),
  createdAt: row.created_at,
  excluded: row.excluded === 1,
});

const toEntry = (row: EntryRow): JournalEntry => ({
  id: row.id as Id,
  occurredAt: row.occurred_at,
  postedAt: optional(row.posted_at),
  description: row.description,
  rawId: optional(row.raw_id) as Id | undefined,
  merchantId: optional(row.merchant_id) as Id | undefined,
  categoryId: optional(row.category_id) as Id | undefined,
  kind: row.kind as EntryKind,
  confidence: row.confidence,
  reviewedAt: optional(row.reviewed_at),
  notes: optional(row.notes),
  createdAt: row.created_at,
});

const toPosting = (row: PostingRow): Posting => ({
  id: row.id as Id,
  entryId: row.entry_id as Id,
  accountId: row.account_id as Id,
  amount: paise(row.amount),
});

const toMerchant = (row: MerchantRow): Merchant => ({
  id: row.id as Id,
  canonical: row.canonical,
  categoryId: optional(row.category_id) as Id | undefined,
  createdAt: row.created_at,
});

const toPattern = (row: PatternRow): MerchantPattern => ({
  id: row.id as Id,
  merchantId: row.merchant_id as Id,
  pattern: row.pattern,
  kind: row.kind as PatternKind,
  source: row.source as PatternSource,
  hits: row.hits,
});

const toCategory = (row: CategoryRow): Category => ({
  id: row.id as Id,
  name: row.name,
  parentId: optional(row.parent_id) as Id | undefined,
  icon: optional(row.icon),
  sort: row.sort ?? undefined,
});

const failure = (code: string, e: unknown): Result<never, DatabaseError> =>
  err({ code, message: e instanceof Error ? e.message : String(e) });

export class Database {
  constructor(private driver: SqliteDriver) {}

  initialize(): Result<void, DatabaseError> {
    try {
      this.driver.exec(SCHEMA_SQL);
      this.upgradeProducts();
      this.upgradeBudgets();
      this.upgradeAccounts();

      for (const account of SYSTEM_ACCOUNTS) {
        this.driver.run(
          `INSERT OR IGNORE INTO accounts (id, name, kind, is_system, created_at)
           VALUES (?, ?, ?, 1, ?)`,
          [account.id, account.name, account.kind, toUTC(now())]
        );
      }

      DEFAULT_CATEGORIES.forEach((category, index) => {
        this.driver.run(
          `INSERT OR IGNORE INTO categories (id, name, icon, sort) VALUES (?, ?, ?, ?)`,
          [category.id, category.name, category.icon, index]
        );
      });

      this.driver.run(
        `INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)`,
        [SCHEMA_VERSION, toUTC(now())]
      );

      return ok(undefined);
    } catch (e) {
      return failure('INIT_FAILED', e);
    }
  }

  /**
   * Brand and photo were added to products after phones already had the table, and
   * CREATE TABLE IF NOT EXISTS cannot add a column to one that exists. Safe to run
   * every time: it only adds what is missing.
   */
  /** Leaving an account out of totals came after phones already had the table (schema version 8). */
  private upgradeAccounts(): void {
    const have = new Set(
      this.driver.all<{ name: string }>('PRAGMA table_info(accounts)').map((column) => column.name)
    );
    if (!have.has('excluded')) this.driver.exec('ALTER TABLE accounts ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0');
  }

  /** Rollover came to budgets after phones already had the table (schema version 7). */
  private upgradeBudgets(): void {
    const have = new Set(
      this.driver.all<{ name: string }>('PRAGMA table_info(budgets)').map((column) => column.name)
    );
    if (!have.has('rollover_from')) this.driver.exec('ALTER TABLE budgets ADD COLUMN rollover_from TEXT');
  }

  private upgradeProducts(): void {
    const have = new Set(
      this.driver.all<{ name: string }>('PRAGMA table_info(products)').map((column) => column.name)
    );
    if (!have.has('brand')) this.driver.exec('ALTER TABLE products ADD COLUMN brand TEXT');
    if (!have.has('photo')) this.driver.exec('ALTER TABLE products ADD COLUMN photo TEXT');

    // Paneer from Anand and Paneer from Param are different things with different prices.
    this.driver.exec('DROP INDEX IF EXISTS idx_product_name');
    this.driver.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_product_identity ON products(name COLLATE NOCASE, COALESCE(brand, '') COLLATE NOCASE)"
    );
  }

  createAccount(
    input: Omit<Account, 'id' | 'createdAt' | 'excluded'> & { excluded?: boolean }
  ): Result<Account, DatabaseError> {
    try {
      const account: Account = {
        ...input,
        excluded: input.excluded ?? false,
        id: generateId(),
        createdAt: toUTC(now()),
      };

      this.driver.run(
        `INSERT INTO accounts (id, name, kind, subkind, last4, institution, is_system, created_at, excluded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id,
          account.name,
          account.kind,
          account.subkind ?? null,
          account.last4 ?? null,
          account.institution ?? null,
          account.isSystem ? 1 : 0,
          account.createdAt,
          account.excluded ? 1 : 0,
        ]
      );

      return ok(account);
    } catch (e) {
      return failure('CREATE_ACCOUNT_FAILED', e);
    }
  }

  /**
   * Leaves one of the user's accounts out of every total, or counts it again. Its entries
   * and balance are kept as they are; only what adds them up changes.
   */
  setAccountExcluded(id: Id, excluded: boolean): Result<void, DatabaseError> {
    try {
      this.driver.run(`UPDATE accounts SET excluded = ? WHERE id = ? AND is_system = 0`, [excluded ? 1 : 0, id]);
      return ok(undefined);
    } catch (e) {
      return failure('UPDATE_ACCOUNT_FAILED', e);
    }
  }

  /** Renames an account or corrects its last digits. */
  updateAccount(id: Id, patch: { name: string; last4?: string }): Result<void, DatabaseError> {
    try {
      this.driver.run(`UPDATE accounts SET name = ?, last4 = ? WHERE id = ? AND is_system = 0`, [
        patch.name,
        patch.last4 ?? null,
        id,
      ]);
      return ok(undefined);
    } catch (e) {
      return failure('UPDATE_ACCOUNT_FAILED', e);
    }
  }

  /**
   * Removes an account the user never used, or added by mistake. Refused for
   * a system account, and for one that already holds transactions — deleting
   * those would delete history, which the app never does; the user corrects
   * or merges it instead.
   */
  deleteAccount(id: Id): Result<void, DatabaseError> {
    try {
      const account = this.driver.all<AccountRow>(`SELECT * FROM accounts WHERE id = ?`, [id])[0];
      if (!account) return ok(undefined);
      if (account.is_system === 1) {
        return err({ code: 'SYSTEM_ACCOUNT', message: 'This account is built into the app and cannot be deleted' });
      }

      const [postings] = this.driver.all<{ n: number }>(
        `SELECT COUNT(*) AS n FROM postings WHERE account_id = ?`,
        [id]
      );
      if ((postings?.n ?? 0) > 0) {
        return err({
          code: 'HAS_TRANSACTIONS',
          message: 'This account has transactions on it, so it cannot be deleted',
        });
      }

      this.driver.run(`DELETE FROM accounts WHERE id = ?`, [id]);
      return ok(undefined);
    } catch (e) {
      return failure('DELETE_ACCOUNT_FAILED', e);
    }
  }

  getAccount(id: Id): Result<Account | null, DatabaseError> {
    try {
      const rows = this.driver.all<AccountRow>(
        `SELECT * FROM accounts WHERE id = ?`,
        [id]
      );
      return ok(rows[0] ? toAccount(rows[0]) : null);
    } catch (e) {
      return failure('GET_ACCOUNT_FAILED', e);
    }
  }

  getAllAccounts(): Result<Account[], DatabaseError> {
    try {
      const rows = this.driver.all<AccountRow>(
        `SELECT * FROM accounts WHERE archived_at IS NULL ORDER BY is_system, name`
      );
      return ok(rows.map(toAccount));
    } catch (e) {
      return failure('GET_ACCOUNTS_FAILED', e);
    }
  }

  saveRawRecord(
    input: Omit<RawRecord, 'id' | 'ingestedAt'>
  ): Result<RawRecord, DatabaseError> {
    try {
      const record: RawRecord = {
        ...input,
        id: generateId(),
        ingestedAt: toUTC(now()),
      };

      this.driver.run(
        `INSERT INTO raw_records (id, source, source_ref, payload, parser, parsed_at, parse_error, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.source,
          record.sourceRef ?? null,
          record.payload,
          record.parser ?? null,
          record.parsedAt ?? null,
          record.parseError ?? null,
          record.ingestedAt,
        ]
      );

      return ok(record);
    } catch (e) {
      return failure('SAVE_RAW_FAILED', e);
    }
  }

  /**
   * Writes an entry and its legs atomically. A row-level trigger cannot see a
   * whole entry, so the balance check runs here inside the transaction: if the
   * legs do not net to zero the write rolls back and nothing is stored.
   */
  createJournalEntry(
    input: Omit<JournalEntry, 'id' | 'createdAt'>,
    postings: Omit<Posting, 'id' | 'entryId'>[]
  ): Result<JournalEntry, DatabaseError> {
    if (postings.length < 2) {
      return err({
        code: 'INSUFFICIENT_POSTINGS',
        message: 'Journal entry must have at least 2 postings',
      });
    }

    const total = sum(postings.map((p) => p.amount));
    if (total !== paise(0)) {
      return err({
        code: 'UNBALANCED_ENTRY',
        message: `Postings do not balance. Total: ${total}`,
      });
    }

    const entry: JournalEntry = {
      ...input,
      id: generateId(),
      createdAt: toUTC(now()),
    };

    return this.transaction(() => {
      this.driver.run(
        `INSERT INTO journal_entries
           (id, occurred_at, posted_at, description, raw_id, merchant_id, category_id,
            kind, confidence, reviewed_at, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.occurredAt,
          entry.postedAt ?? null,
          entry.description,
          entry.rawId ?? null,
          entry.merchantId ?? null,
          entry.categoryId ?? null,
          entry.kind,
          entry.confidence,
          entry.reviewedAt ?? null,
          entry.notes ?? null,
          entry.createdAt,
        ]
      );

      for (const posting of postings) {
        this.driver.run(
          `INSERT INTO postings (id, entry_id, account_id, amount) VALUES (?, ?, ?, ?)`,
          [generateId(), entry.id, posting.accountId, posting.amount]
        );
      }

      const [check] = this.driver.all<{ total: number | null }>(
        `SELECT SUM(amount) AS total FROM postings WHERE entry_id = ?`,
        [entry.id]
      );

      if ((check?.total ?? 0) !== 0) {
        return err({
          code: 'UNBALANCED_ENTRY',
          message: 'Stored postings did not net to zero',
        });
      }

      return ok(entry);
    }, 'CREATE_ENTRY_FAILED');
  }

  /**
   * Undoes a mistyped manual entry. Refused for anything that came from a
   * bank source — a statement or notification is real history and is never
   * deleted, only recategorised; only something the user typed by hand can be
   * typed wrong and taken back. A linked item purchase survives, unlinked
   * from any payment, via the schema's own ON DELETE SET NULL.
   */
  deleteEntry(id: Id): Result<void, DatabaseError> {
    try {
      const [row] = this.driver.all<{ raw_id: string | null; source: string | null }>(
        `SELECT e.raw_id, r.source FROM journal_entries e
         LEFT JOIN raw_records r ON r.id = e.raw_id
         WHERE e.id = ?`,
        [id]
      );
      if (!row) return ok(undefined);
      if (row.source !== 'manual') {
        return err({ code: 'NOT_MANUAL', message: 'Only a hand-typed entry can be deleted' });
      }

      this.driver.run(`DELETE FROM journal_entries WHERE id = ?`, [id]);
      return ok(undefined);
    } catch (e) {
      return failure('DELETE_ENTRY_FAILED', e);
    }
  }

  getEntry(id: Id): Result<JournalEntry | null, DatabaseError> {
    try {
      const rows = this.driver.all<EntryRow>(
        `SELECT * FROM journal_entries WHERE id = ?`,
        [id]
      );
      return ok(rows[0] ? toEntry(rows[0]) : null);
    } catch (e) {
      return failure('GET_ENTRY_FAILED', e);
    }
  }

  getPostings(entryId: Id): Result<Posting[], DatabaseError> {
    try {
      const rows = this.driver.all<PostingRow>(
        `SELECT * FROM postings WHERE entry_id = ?`,
        [entryId]
      );
      return ok(rows.map(toPosting));
    } catch (e) {
      return failure('GET_POSTINGS_FAILED', e);
    }
  }

  getBalance(accountId: Id): Result<Paise, DatabaseError> {
    try {
      const [row] = this.driver.all<{ total: number | null }>(
        `SELECT SUM(amount) AS total FROM postings WHERE account_id = ?`,
        [accountId]
      );
      return ok(paise(row?.total ?? 0));
    } catch (e) {
      return failure('GET_BALANCE_FAILED', e);
    }
  }

  getReviewQueue(
    threshold = 0.7,
    limit = 100
  ): Result<JournalEntry[], DatabaseError> {
    try {
      const rows = this.driver.all<EntryRow>(
        `SELECT * FROM journal_entries
         WHERE confidence < ? AND reviewed_at IS NULL
         ORDER BY occurred_at DESC
         LIMIT ?`,
        [threshold, limit]
      );
      return ok(rows.map(toEntry));
    } catch (e) {
      return failure('GET_REVIEW_QUEUE_FAILED', e);
    }
  }

  verifyLedger(): Result<boolean, DatabaseError> {
    try {
      const unbalanced = this.driver.all<{ entry_id: string; total: number }>(
        `SELECT entry_id, SUM(amount) AS total
         FROM postings
         GROUP BY entry_id
         HAVING SUM(amount) <> 0`
      );

      if (unbalanced.length > 0) {
        return err({
          code: 'UNBALANCED_ENTRY',
          message: `${unbalanced.length} unbalanced entries, first: ${unbalanced[0].entry_id}`,
        });
      }

      const thin = this.driver.all<{ entry_id: string; legs: number }>(
        `SELECT entry_id, COUNT(*) AS legs
         FROM postings
         GROUP BY entry_id
         HAVING COUNT(*) < 2`
      );

      if (thin.length > 0) {
        return err({
          code: 'INSUFFICIENT_POSTINGS',
          message: `Entry ${thin[0].entry_id} has ${thin[0].legs} posting(s)`,
        });
      }

      return ok(true);
    } catch (e) {
      return failure('VERIFY_FAILED', e);
    }
  }

  /** The share of incoming flow the ledger could not explain. */
  suspenseRatio(suspenseAccountId: Id): Result<number, DatabaseError> {
    try {
      const [flow] = this.driver.all<{ total: number | null }>(
        `SELECT SUM(amount) AS total FROM postings WHERE amount > 0`
      );
      const [suspense] = this.driver.all<{ total: number | null }>(
        `SELECT SUM(amount) AS total FROM postings
         WHERE account_id = ? AND amount > 0`,
        [suspenseAccountId]
      );

      const totalFlow = flow?.total ?? 0;
      if (totalFlow === 0) return ok(0);

      return ok((suspense?.total ?? 0) / totalFlow);
    } catch (e) {
      return failure('SUSPENSE_RATIO_FAILED', e);
    }
  }

  getRawRecord(id: Id): Result<RawRecord | null, DatabaseError> {
    try {
      const rows = this.driver.all<{
        id: string;
        source: string;
        source_ref: string | null;
        payload: string;
        parser: string | null;
        parsed_at: string | null;
        parse_error: string | null;
        ingested_at: string;
      }>(`SELECT * FROM raw_records WHERE id = ?`, [id]);

      const row = rows[0];
      if (!row) return ok(null);

      return ok({
        id: row.id as Id,
        source: row.source as RawSource,
        sourceRef: optional(row.source_ref),
        payload: row.payload,
        parser: optional(row.parser),
        parsedAt: optional(row.parsed_at),
        parseError: optional(row.parse_error),
        ingestedAt: row.ingested_at,
      });
    } catch (e) {
      return failure('GET_RAW_RECORD_FAILED', e);
    }
  }

  /**
   * Finds an entry already recorded for this row, so importing the same
   * statement twice adds nothing the second time. Matched on the date, the
   * narration and the exact amount against the same account, which is what
   * distinguishes a re-import from two genuine identical purchases on
   * different days.
   */
  findDuplicateEntry(
    accountId: Id,
    occurredAt: string,
    description: string,
    amount: Paise
  ): Result<Id | null, DatabaseError> {
    try {
      const rows = this.driver.all<{ id: string }>(
        `SELECT e.id
         FROM journal_entries e
         JOIN postings p ON p.entry_id = e.id AND p.account_id = ?
         WHERE e.occurred_at = ? AND e.description = ? AND p.amount = ?
         LIMIT 1`,
        [accountId, occurredAt, description, amount]
      );
      return ok((rows[0]?.id ?? null) as Id | null);
    } catch (e) {
      return failure('FIND_DUPLICATE_FAILED', e);
    }
  }

  /**
   * A hand-entered transaction that a statement row is really the same as:
   * same account, same signed amount, within a few days. Typing in a salary
   * and later importing the statement that carries it must not count it
   * twice. Only entries still backed by a manual raw record qualify, so one
   * manual entry can absorb at most one statement row.
   */
  findManualMatch(
    accountId: Id,
    amount: Paise,
    date: string,
    windowDays = 3
  ): Result<Id | null, DatabaseError> {
    try {
      const day = date.slice(0, 10);
      const rows = this.driver.all<{ id: string }>(
        `SELECT e.id
         FROM journal_entries e
         JOIN postings p ON p.entry_id = e.id AND p.account_id = ? AND p.amount = ?
         JOIN raw_records r ON r.id = e.raw_id AND r.source IN ('manual', 'notification')
         WHERE ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?)) <= ?
           AND NOT EXISTS (SELECT 1 FROM statement_rows s WHERE s.entry_id = e.id)
         ORDER BY ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?))
         LIMIT 1`,
        [accountId, amount, day, windowDays, day]
      );
      return ok((rows[0]?.id ?? null) as Id | null);
    } catch (e) {
      return failure('FIND_MANUAL_MATCH_FAILED', e);
    }
  }

  /**
   * Entries that moved the same amount on the same account around a date,
   * with where they came from. Used to spot one payment reported twice (the
   * SMS app and the bank's own app both post it) or already on a statement.
   */
  entriesNear(
    accountId: Id,
    amount: Paise,
    date: string,
    windowDays = 1
  ): Result<Array<{ entryId: Id; source: RawSource | null; payload: string | null }>, DatabaseError> {
    try {
      const rows = this.driver.all<{ id: string; source: string | null; payload: string | null }>(
        `SELECT e.id, r.source, r.payload
         FROM journal_entries e
         JOIN postings p ON p.entry_id = e.id AND p.account_id = ? AND p.amount = ?
         LEFT JOIN raw_records r ON r.id = e.raw_id
         WHERE ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?)) <= ?`,
        [accountId, amount, date.slice(0, 10), windowDays]
      );
      return ok(
        rows.map((r) => ({
          entryId: r.id as Id,
          source: r.source as RawSource | null,
          payload: r.payload,
        }))
      );
    } catch (e) {
      return failure('ENTRIES_NEAR_FAILED', e);
    }
  }

  /** The entry a statement row was already recorded as, if any. */
  findStatementRow(ref: string): Result<Id | null, DatabaseError> {
    try {
      const rows = this.driver.all<{ entry_id: string }>(
        `SELECT entry_id FROM statement_rows WHERE ref = ?`,
        [ref]
      );
      return ok((rows[0]?.entry_id ?? null) as Id | null);
    } catch (e) {
      return failure('FIND_STATEMENT_ROW_FAILED', e);
    }
  }

  recordStatementRow(ref: string, entryId: Id, rawId?: Id): Result<void, DatabaseError> {
    try {
      this.driver.run(
        `INSERT OR IGNORE INTO statement_rows (ref, entry_id, raw_id) VALUES (?, ?, ?)`,
        [ref, entryId, rawId ?? null]
      );
      return ok(undefined);
    } catch (e) {
      return failure('RECORD_STATEMENT_ROW_FAILED', e);
    }
  }

  getRawRecords(limit = 100): Result<RawRecord[], DatabaseError> {
    try {
      const rows = this.driver.all<{ id: string }>(
        `SELECT id FROM raw_records ORDER BY ingested_at DESC LIMIT ?`,
        [limit]
      );

      const records: RawRecord[] = [];
      for (const row of rows) {
        const found = this.getRawRecord(row.id as Id);
        if (found.isOk() && found.value) records.push(found.value);
      }

      return ok(records);
    } catch (e) {
      return failure('GET_RAW_RECORDS_FAILED', e);
    }
  }

  /**
   * Attaches every entry carrying this narration to a merchant.
   *
   * When the user names a payee the app could not recognise, the other entries
   * with the same narration are the same payee. Linking only the one they
   * happened to tap would leave its siblings orphaned and the backfill would
   * silently miss them.
   */
  linkEntriesByDescription(
    description: string,
    merchantId: Id
  ): Result<number, DatabaseError> {
    try {
      const [row] = this.driver.all<{ total: number }>(
        `SELECT COUNT(*) AS total FROM journal_entries
         WHERE description = ? AND merchant_id IS NULL`,
        [description]
      );

      this.driver.run(
        `UPDATE journal_entries SET merchant_id = ?
         WHERE description = ? AND merchant_id IS NULL`,
        [merchantId, description]
      );

      return ok(row?.total ?? 0);
    } catch (e) {
      return failure('LINK_ENTRIES_FAILED', e);
    }
  }

  getCategories(): Result<Category[], DatabaseError> {
    try {
      const rows = this.driver.all<CategoryRow>(
        `SELECT * FROM categories ORDER BY sort, name`
      );
      return ok(rows.map(toCategory));
    } catch (e) {
      return failure('GET_CATEGORIES_FAILED', e);
    }
  }

  /** Creates the merchant if its canonical name is new, otherwise returns it. */
  upsertMerchant(
    canonical: string,
    categoryId?: Id
  ): Result<Merchant, DatabaseError> {
    try {
      const existing = this.driver.all<MerchantRow>(
        `SELECT * FROM merchants WHERE canonical = ?`,
        [canonical]
      );

      if (existing[0]) {
        const merchant = toMerchant(existing[0]);
        if (categoryId && merchant.categoryId !== categoryId) {
          this.driver.run(`UPDATE merchants SET category_id = ? WHERE id = ?`, [
            categoryId,
            merchant.id,
          ]);
          return ok({ ...merchant, categoryId });
        }
        return ok(merchant);
      }

      const merchant: Merchant = {
        id: generateId(),
        canonical,
        categoryId,
        createdAt: toUTC(now()),
      };

      this.driver.run(
        `INSERT INTO merchants (id, canonical, category_id, created_at) VALUES (?, ?, ?, ?)`,
        [merchant.id, merchant.canonical, merchant.categoryId ?? null, merchant.createdAt]
      );

      return ok(merchant);
    } catch (e) {
      return failure('UPSERT_MERCHANT_FAILED', e);
    }
  }

  getMerchant(id: Id): Result<Merchant | null, DatabaseError> {
    try {
      const rows = this.driver.all<MerchantRow>(
        `SELECT * FROM merchants WHERE id = ?`,
        [id]
      );
      return ok(rows[0] ? toMerchant(rows[0]) : null);
    } catch (e) {
      return failure('GET_MERCHANT_FAILED', e);
    }
  }

  getAllMerchants(): Result<Merchant[], DatabaseError> {
    try {
      const rows = this.driver.all<MerchantRow>(
        `SELECT * FROM merchants ORDER BY canonical`
      );
      return ok(rows.map(toMerchant));
    } catch (e) {
      return failure('GET_MERCHANTS_FAILED', e);
    }
  }

  /**
   * Remembers that a narration fragment means a merchant. Written whenever the
   * user corrects a guess, which is what makes the next one better.
   */
  recordPattern(input: {
    merchantId: Id;
    pattern: string;
    kind: PatternKind;
    source: PatternSource;
  }): Result<void, DatabaseError> {
    try {
      this.driver.run(
        `INSERT INTO merchant_patterns (id, merchant_id, pattern, kind, source, hits)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(pattern, kind) DO UPDATE SET merchant_id = excluded.merchant_id`,
        [generateId(), input.merchantId, input.pattern, input.kind, input.source]
      );
      return ok(undefined);
    } catch (e) {
      return failure('RECORD_PATTERN_FAILED', e);
    }
  }

  getPatterns(kind?: PatternKind): Result<MerchantPattern[], DatabaseError> {
    try {
      const rows = kind
        ? this.driver.all<PatternRow>(
            `SELECT * FROM merchant_patterns WHERE kind = ? ORDER BY LENGTH(pattern) DESC`,
            [kind]
          )
        : this.driver.all<PatternRow>(
            `SELECT * FROM merchant_patterns ORDER BY LENGTH(pattern) DESC`
          );
      return ok(rows.map(toPattern));
    } catch (e) {
      return failure('GET_PATTERNS_FAILED', e);
    }
  }

  bumpPatternHits(pattern: string, kind: PatternKind): Result<void, DatabaseError> {
    try {
      this.driver.run(
        `UPDATE merchant_patterns SET hits = hits + 1 WHERE pattern = ? AND kind = ?`,
        [pattern, kind]
      );
      return ok(undefined);
    } catch (e) {
      return failure('BUMP_PATTERN_FAILED', e);
    }
  }

  updateEntry(
    id: Id,
    patch: Partial<
      Pick<
        JournalEntry,
        'description' | 'categoryId' | 'merchantId' | 'kind' | 'notes' | 'reviewedAt' | 'confidence'
      >
    >
  ): Result<void, DatabaseError> {
    const columns: Record<string, SqlValue> = {};
    if (patch.description) columns.description = patch.description;
    if ('categoryId' in patch) columns.category_id = patch.categoryId ?? null;
    if ('merchantId' in patch) columns.merchant_id = patch.merchantId ?? null;
    if ('kind' in patch) columns.kind = patch.kind ?? null;
    if ('notes' in patch) columns.notes = patch.notes ?? null;
    if ('reviewedAt' in patch) columns.reviewed_at = patch.reviewedAt ?? null;
    if ('confidence' in patch) columns.confidence = patch.confidence ?? 0;

    const names = Object.keys(columns);
    if (names.length === 0) return ok(undefined);

    try {
      this.driver.run(
        `UPDATE journal_entries SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`,
        [...names.map((n) => columns[n]), id]
      );
      return ok(undefined);
    } catch (e) {
      return failure('UPDATE_ENTRY_FAILED', e);
    }
  }

  /**
   * Points one leg of an entry at a different account. The amount is left
   * alone, so the entry stays balanced; this is how a correction takes an
   * entry out of Suspense.
   */
  moveLeg(postingId: Id, accountId: Id): Result<void, DatabaseError> {
    try {
      this.driver.run(`UPDATE postings SET account_id = ? WHERE id = ?`, [
        accountId,
        postingId,
      ]);
      return ok(undefined);
    } catch (e) {
      return failure('MOVE_LEG_FAILED', e);
    }
  }

  markReviewed(id: Id): Result<void, DatabaseError> {
    return this.updateEntry(id, { reviewedAt: toUTC(now()), confidence: 1 });
  }

  countEntriesForMerchant(merchantId: Id): Result<number, DatabaseError> {
    try {
      const [row] = this.driver.all<{ total: number }>(
        `SELECT COUNT(*) AS total FROM journal_entries WHERE merchant_id = ?`,
        [merchantId]
      );
      return ok(row?.total ?? 0);
    } catch (e) {
      return failure('COUNT_ENTRIES_FAILED', e);
    }
  }

  /**
   * The highest-leverage correction in the app: one fix teaches the merchant
   * and backfills every entry already filed under it.
   */
  applyCategoryToMerchant(
    merchantId: Id,
    categoryId: Id
  ): Result<number, DatabaseError> {
    const counted = this.countEntriesForMerchant(merchantId);
    if (counted.isErr()) return err(counted.error);

    return this.transaction(() => {
      this.driver.run(`UPDATE merchants SET category_id = ? WHERE id = ?`, [
        categoryId,
        merchantId,
      ]);
      this.driver.run(
        `UPDATE journal_entries
         SET category_id = ?, confidence = 1, reviewed_at = ?
         WHERE merchant_id = ?`,
        [categoryId, toUTC(now()), merchantId]
      );
      return ok(counted.value);
    }, 'APPLY_CATEGORY_FAILED');
  }

  getEntries(filter: EntryFilter = {}): Result<JournalEntry[], DatabaseError> {
    const where: string[] = [];
    const params: SqlValue[] = [];

    if (filter.from) {
      where.push('occurred_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('occurred_at <= ?');
      params.push(filter.to);
    }
    if (filter.categoryId) {
      where.push('category_id = ?');
      params.push(filter.categoryId);
    }
    if (filter.merchantId) {
      where.push('merchant_id = ?');
      params.push(filter.merchantId);
    }
    if (filter.accountId) {
      where.push(
        'id IN (SELECT entry_id FROM postings WHERE account_id = ?)'
      );
      params.push(filter.accountId);
    }
    if (filter.search) {
      where.push('description LIKE ?');
      params.push(`%${filter.search}%`);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    try {
      const rows = this.driver.all<EntryRow>(
        `SELECT * FROM journal_entries ${clause}
         ORDER BY occurred_at DESC, created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.limit ?? 200, filter.offset ?? 0]
      );
      return ok(rows.map(toEntry));
    } catch (e) {
      return failure('GET_ENTRIES_FAILED', e);
    }
  }

  /**
   * Money out and money in across the user's own asset accounts.
   *
   * Transfers and investments are excluded: moving 50,000 to savings or into
   * a fund is not spending, and reporting it as such is the most visible way
   * a money app loses trust.
   */
  monthTotals(
    from: string,
    to: string
  ): Result<{ spent: Paise; received: Paise }, DatabaseError> {
    try {
      const [row] = this.driver.all<{
        spent: number | null;
        received: number | null;
      }>(
        `SELECT
           SUM(CASE WHEN p.amount < 0 THEN -p.amount ELSE 0 END) AS spent,
           SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END) AS received
         FROM postings p
         JOIN journal_entries e ON e.id = p.entry_id
         JOIN accounts a ON a.id = p.account_id
         WHERE a.kind = 'asset' AND a.is_system = 0 AND a.excluded = 0
           AND e.kind NOT IN ('transfer', 'investment')
           AND e.occurred_at >= ? AND e.occurred_at <= ?`,
        [from, to]
      );

      return ok({
        spent: paise(row?.spent ?? 0),
        received: paise(row?.received ?? 0),
      });
    } catch (e) {
      return failure('MONTH_TOTALS_FAILED', e);
    }
  }

  categoryTotals(
    from: string,
    to: string
  ): Result<Array<{ categoryId: Id | null; total: Paise }>, DatabaseError> {
    try {
      const rows = this.driver.all<{
        category_id: string | null;
        total: number;
      }>(
        `SELECT e.category_id, SUM(-p.amount) AS total
         FROM postings p
         JOIN journal_entries e ON e.id = p.entry_id
         JOIN accounts a ON a.id = p.account_id
         WHERE a.kind = 'asset' AND a.is_system = 0 AND a.excluded = 0
           AND p.amount < 0
           AND e.kind NOT IN ('transfer', 'investment')
           AND e.occurred_at >= ? AND e.occurred_at <= ?
         GROUP BY e.category_id
         ORDER BY total DESC`,
        [from, to]
      );

      return ok(
        rows.map((row) => ({
          categoryId: (row.category_id ?? null) as Id | null,
          total: paise(row.total),
        }))
      );
    } catch (e) {
      return failure('CATEGORY_TOTALS_FAILED', e);
    }
  }

  /** Everything owned less everything owed. A query, not a subsystem. */
  netWorth(): Result<
    { assets: Paise; liabilities: Paise; net: Paise },
    DatabaseError
  > {
    try {
      const rows = this.driver.all<{ kind: string; total: number | null }>(
        `SELECT a.kind, SUM(p.amount) AS total
         FROM postings p
         JOIN accounts a ON a.id = p.account_id
         WHERE a.kind IN ('asset', 'liability') AND a.archived_at IS NULL
         GROUP BY a.kind`
      );

      const of = (kind: string): Paise =>
        paise(rows.find((r) => r.kind === kind)?.total ?? 0);

      const assets = of('asset');
      const liabilities = of('liability');

      return ok({ assets, liabilities, net: sum([assets, liabilities]) });
    } catch (e) {
      return failure('NET_WORTH_FAILED', e);
    }
  }

  /**
   * Narrations no merchant claimed. One of the three numbers to watch weekly:
   * it should shrink as the pattern table learns.
   */
  unmatchedNarrations(limit = 50): Result<string[], DatabaseError> {
    try {
      const rows = this.driver.all<{ description: string }>(
        `SELECT description FROM journal_entries
         WHERE merchant_id IS NULL
         GROUP BY description
         ORDER BY COUNT(*) DESC
         LIMIT ?`,
        [limit]
      );
      return ok(rows.map((r) => r.description));
    } catch (e) {
      return failure('UNMATCHED_NARRATIONS_FAILED', e);
    }
  }

  getSetting(key: string): Result<string | null, DatabaseError> {
    try {
      const [row] = this.driver.all<{ value: string }>(
        `SELECT value FROM settings WHERE key = ?`,
        [key]
      );
      return ok(row?.value ?? null);
    } catch (e) {
      return failure('GET_SETTING_FAILED', e);
    }
  }

  /** Stores a setting, or forgets it when given null. */
  setSetting(key: string, value: string | null): Result<void, DatabaseError> {
    try {
      if (value === null) {
        this.driver.run(`DELETE FROM settings WHERE key = ?`, [key]);
      } else {
        this.driver.run(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, value]
        );
      }
      return ok(undefined);
    } catch (e) {
      return failure('SET_SETTING_FAILED', e);
    }
  }

  /**
   * Remembers a statement's closing balance. Only a newer statement replaces
   * the anchor, so importing last year's statement after this month's does not
   * wind the balance back.
   */
  recordBalanceAnchor(
    accountId: Id,
    asOf: string,
    balance: Paise,
    rawId?: Id
  ): Result<void, DatabaseError> {
    try {
      this.driver.run(
        `INSERT INTO balance_anchors (account_id, as_of, balance, raw_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           as_of = excluded.as_of,
           balance = excluded.balance,
           raw_id = excluded.raw_id
         WHERE excluded.as_of >= balance_anchors.as_of`,
        [accountId, asOf.slice(0, 10), balance, rawId ?? null]
      );
      return ok(undefined);
    } catch (e) {
      return failure('RECORD_ANCHOR_FAILED', e);
    }
  }

  getBalanceAnchor(
    accountId: Id
  ): Result<{ asOf: string; balance: Paise } | null, DatabaseError> {
    try {
      const [row] = this.driver.all<{ as_of: string; balance: number }>(
        `SELECT as_of, balance FROM balance_anchors WHERE account_id = ?`,
        [accountId]
      );
      return ok(row ? { asOf: row.as_of, balance: paise(row.balance) } : null);
    } catch (e) {
      return failure('GET_ANCHOR_FAILED', e);
    }
  }

  /**
   * What is actually in an account: the latest statement balance plus what
   * the ledger recorded after that day. With no statement, the ledger's own
   * sum is all there is.
   */
  reportedBalance(accountId: Id): Result<Paise, DatabaseError> {
    const anchor = this.getBalanceAnchor(accountId);
    if (anchor.isErr()) return err(anchor.error);
    if (!anchor.value) return this.getBalance(accountId);

    try {
      const [row] = this.driver.all<{ total: number | null }>(
        `SELECT SUM(p.amount) AS total
         FROM postings p
         JOIN journal_entries e ON e.id = p.entry_id
         WHERE p.account_id = ? AND substr(e.occurred_at, 1, 10) > ?`,
        [accountId, anchor.value.asOf]
      );
      return ok(sum([anchor.value.balance, paise(row?.total ?? 0)]));
    } catch (e) {
      return failure('REPORTED_BALANCE_FAILED', e);
    }
  }

  /** A read for modules that own their own SQL, such as inventory. */
  query<T extends SqlRow = SqlRow>(
    sql: string,
    params: SqlValue[] = []
  ): Result<T[], DatabaseError> {
    try {
      return ok(this.driver.all<T>(sql, params));
    } catch (e) {
      return failure('QUERY_FAILED', e);
    }
  }

  private savepointDepth = 0;

  /**
   * Runs several writes as one unit: all of them land, or none do.
   *
   * Built on savepoints rather than BEGIN, because SQLite cannot nest BEGIN —
   * and a purchase paid in cash writes a journal entry, which is itself
   * transactional, inside the purchase's own transaction. Work that returns an
   * error, or throws, is rolled back.
   */
  transaction<T>(
    work: () => Result<T, DatabaseError>,
    code = 'TRANSACTION_FAILED'
  ): Result<T, DatabaseError> {
    const name = `sp_${++this.savepointDepth}`;

    try {
      this.driver.exec(`SAVEPOINT ${name}`);
    } catch (e) {
      this.savepointDepth--;
      return failure(code, e);
    }

    let result: Result<T, DatabaseError>;
    try {
      result = work();
    } catch (e) {
      result = failure(code, e);
    }

    try {
      if (result.isErr()) this.driver.exec(`ROLLBACK TO ${name}`);
      this.driver.exec(`RELEASE ${name}`);
    } catch (e) {
      result = failure(code, e);
    } finally {
      this.savepointDepth--;
    }

    return result;
  }

  run(sql: string, params: SqlValue[] = []): Result<void, DatabaseError> {
    try {
      this.driver.run(sql, params);
      return ok(undefined);
    } catch (e) {
      return failure('RUN_FAILED', e);
    }
  }

  close(): void {
    this.driver.close();
  }
}
