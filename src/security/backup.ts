import { Database } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Paise, format } from '@/money/money';
import { Result, ok, err } from '@/lib/result';
import { inventoryRows } from '@/inventory/repo';
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  type EncryptionError,
  type RandomSource,
} from './encryption';

export type ExportFormat = 'json' | 'csv';

/** Version 2 added products, purchases and consumption; version 3 statement balances and settings; version 4 CAS holdings; version 5 budgets, goals and recurring reminders; version 6 product brands; version 7 budget rollover; version 8 accounts left out of totals. */
export const BACKUP_VERSION = 8;

/** Every version this build can restore. Older backups simply lack newer sections. */
const READABLE_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export type BackupMetadata = {
  version: number;
  exportedAt: string;
  format: ExportFormat;
  accounts: number;
  entries: number;
  postings: number;
  checksum: string;
};

export type Backup = {
  data: string;
  metadata: BackupMetadata;
};

export type BackupError = {
  code:
    | 'EXPORT_FAILED'
    | 'INVALID_BACKUP'
    | 'VERSION_MISMATCH'
    | 'IMPORT_FAILED'
    | 'NOT_CONFIRMED';
  message: string;
};

type BackupPayload = {
  version: number;
  exportedAt: string;
  accounts: unknown[];
  categories: unknown[];
  merchants: unknown[];
  patterns: unknown[];
  entries: unknown[];
  postings: unknown[];
  products?: unknown[];
  purchases?: unknown[];
  consumption?: unknown[];
  statementRows?: unknown[];
  balanceAnchors?: unknown[];
  holdings?: unknown[];
  settings?: unknown[];
  budgets?: unknown[];
  goals?: unknown[];
  recurringItems?: unknown[];
};

/**
 * A stable, non-cryptographic fingerprint of the payload. Enough to notice a
 * file that was truncated or edited in transit; not a security control.
 */
export const checksum = (data: string): string => {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = (hash << 5) - hash + data.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const collect = (db: Database): Result<BackupPayload, BackupError> => {
  const accounts = db.getAllAccounts();
  const categories = db.getCategories();
  const merchants = db.getAllMerchants();
  const patterns = db.getPatterns();
  const entries = db.getEntries({ limit: 1_000_000 });

  if (
    accounts.isErr() ||
    categories.isErr() ||
    merchants.isErr() ||
    patterns.isErr() ||
    entries.isErr()
  ) {
    return err({ code: 'EXPORT_FAILED', message: 'Could not read the ledger' });
  }

  const postings = entries.value.flatMap(
    (entry) => db.getPostings(entry.id).getOrNull() ?? []
  );

  const inventory = inventoryRows(db);
  const statementRows = db.query<{ ref: string; entry_id: string }>(
    `SELECT ref, entry_id FROM statement_rows`
  );
  const anchors = db.query<{ account_id: string; as_of: string; balance: number }>(
    `SELECT account_id, as_of, balance FROM balance_anchors`
  );
  const holdings = db.query(`SELECT * FROM holdings`);
  const settings = db.query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const budgets = db.query(`SELECT * FROM budgets`);
  const goals = db.query(`SELECT * FROM goals`);
  const recurringItems = db.query(`SELECT * FROM recurring_items`);
  if (
    statementRows.isErr() ||
    anchors.isErr() ||
    settings.isErr() ||
    holdings.isErr() ||
    budgets.isErr() ||
    goals.isErr() ||
    recurringItems.isErr()
  ) {
    return err({ code: 'EXPORT_FAILED', message: 'Could not read the ledger' });
  }

  return ok({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: accounts.value,
    categories: categories.value,
    merchants: merchants.value,
    patterns: patterns.value,
    entries: entries.value,
    postings,
    // Photos stay on the phone that took them: a path means nothing elsewhere, and a backup
    // file must never be able to point the app at a file or address of its choosing.
    products: inventory.products.map(({ photo: _photo, ...product }) => product),
    purchases: inventory.purchases,
    consumption: inventory.consumption,
    statementRows: statementRows.value.map((row) => ({
      ref: row.ref,
      entryId: row.entry_id,
    })),
    balanceAnchors: anchors.value.map((row) => ({
      accountId: row.account_id,
      asOf: row.as_of,
      balance: row.balance,
    })),
    settings: settings.value,
    holdings: holdings.value,
    budgets: budgets.value,
    goals: goals.value,
    recurringItems: recurringItems.value,
  });
};

const csvEscape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const toCsv = (db: Database, payload: BackupPayload): string => {
  const merchants = new Map(
    (payload.merchants as Array<{ id: Id; canonical: string }>).map((m) => [
      m.id,
      m.canonical,
    ])
  );
  const categories = new Map(
    (payload.categories as Array<{ id: Id; name: string }>).map((c) => [
      c.id,
      c.name,
    ])
  );
  const accounts = new Map(
    (payload.accounts as Array<{ id: Id; name: string; isSystem: boolean }>).map(
      (a) => [a.id, a]
    )
  );

  const rows = [
    'Date,Narration,Merchant,Category,Amount,Account',
    ...(
      payload.entries as Array<{
        id: Id;
        occurredAt: string;
        description: string;
        merchantId?: Id;
        categoryId?: Id;
      }>
    ).map((entry) => {
      const postings = db.getPostings(entry.id).getOrNull() ?? [];
      const own = postings.find((p) => accounts.get(p.accountId)?.isSystem === false);

      return [
        entry.occurredAt,
        csvEscape(entry.description),
        csvEscape(
          entry.merchantId ? (merchants.get(entry.merchantId) ?? '') : ''
        ),
        csvEscape(
          entry.categoryId ? (categories.get(entry.categoryId) ?? '') : ''
        ),
        own ? format(own.amount as Paise) : '',
        csvEscape(own ? (accounts.get(own.accountId)?.name ?? '') : ''),
      ].join(',');
    }),
  ];

  return rows.join('\n');
};

export const exportLedger = (
  db: Database,
  format: ExportFormat = 'json'
): Result<Backup, BackupError> => {
  const collected = collect(db);
  if (collected.isErr()) return err(collected.error);

  const payload = collected.value;
  const data = format === 'csv' ? toCsv(db, payload) : JSON.stringify(payload);

  return ok({
    data,
    metadata: {
      version: BACKUP_VERSION,
      exportedAt: payload.exportedAt,
      format,
      accounts: payload.accounts.length,
      entries: payload.entries.length,
      postings: payload.postings.length,
      checksum: checksum(data),
    },
  });
};

const parseBackup = (data: string): Result<BackupPayload, BackupError> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return err({ code: 'INVALID_BACKUP', message: 'Not valid JSON' });
  }

  const payload = parsed as Partial<BackupPayload>;
  const required: Array<keyof BackupPayload> = [
    'accounts',
    'categories',
    'merchants',
    'patterns',
    'entries',
    'postings',
  ];

  for (const key of required) {
    if (!Array.isArray(payload[key])) {
      return err({
        code: 'INVALID_BACKUP',
        message: `Backup is missing "${key}"`,
      });
    }
  }

  if (!READABLE_VERSIONS.includes(payload.version as number)) {
    return err({
      code: 'VERSION_MISMATCH',
      message: `Backup is version ${payload.version}, this build reads versions ${READABLE_VERSIONS.join(' and ')}`,
    });
  }

  return ok(payload as BackupPayload);
};

/**
 * Restores a JSON backup into an empty ledger.
 *
 * Rows are written directly rather than through createJournalEntry, because a
 * restore must reproduce exactly what was exported — including its ids — not
 * mint new ones. verifyLedger is run afterwards, and the restore is rejected
 * if what came back does not balance.
 */
export const importBackup = (
  db: Database,
  data: string
): Result<{ entries: number }, BackupError> => {
  const parsed = parseBackup(data);
  if (parsed.isErr()) return err(parsed.error);

  const payload = parsed.value;

  // A failed row aborts the whole restore rather than silently going missing.
  const write = (sql: string, params: Array<string | number | null>): void => {
    const written = db.run(sql, params);
    if (written.isErr()) throw new Error(written.error.message);
  };

  // All or nothing: a restore that fails halfway leaves the database as it was.
  const restored = db.transaction(() => {
    for (const account of payload.accounts as Array<Record<string, string | boolean | undefined>>) {
      write(
        `INSERT OR REPLACE INTO accounts (id, name, kind, subkind, last4, institution, is_system, archived_at, created_at, excluded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account.id as string,
          account.name as string,
          account.kind as string,
          (account.subkind as string) ?? null,
          (account.last4 as string) ?? null,
          (account.institution as string) ?? null,
          account.isSystem ? 1 : 0,
          (account.archivedAt as string) ?? null,
          account.createdAt as string,
          // Missing from backups before version 8: counted, as every account was then.
          account.excluded ? 1 : 0,
        ]
      );
    }

    for (const merchant of payload.merchants as Array<Record<string, string | undefined>>) {
      write(
        `INSERT OR REPLACE INTO merchants (id, canonical, category_id, created_at) VALUES (?, ?, ?, ?)`,
        [
          merchant.id as string,
          merchant.canonical as string,
          merchant.categoryId ?? null,
          merchant.createdAt as string,
        ]
      );
    }

    for (const pattern of payload.patterns as Array<Record<string, string | number>>) {
      write(
        `INSERT OR REPLACE INTO merchant_patterns (id, merchant_id, pattern, kind, source, hits)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          pattern.id as string,
          pattern.merchantId as string,
          pattern.pattern as string,
          pattern.kind as string,
          pattern.source as string,
          pattern.hits as number,
        ]
      );
    }

    for (const entry of payload.entries as Array<Record<string, string | number | undefined>>) {
      write(
        `INSERT OR REPLACE INTO journal_entries
           (id, occurred_at, posted_at, description, raw_id, merchant_id, category_id,
            kind, confidence, reviewed_at, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id as string,
          entry.occurredAt as string,
          (entry.postedAt as string) ?? null,
          entry.description as string,
          null,
          (entry.merchantId as string) ?? null,
          (entry.categoryId as string) ?? null,
          entry.kind as string,
          entry.confidence as number,
          (entry.reviewedAt as string) ?? null,
          (entry.notes as string) ?? null,
          entry.createdAt as string,
        ]
      );
    }

    for (const posting of payload.postings as Array<Record<string, string | number>>) {
      write(
        `INSERT OR REPLACE INTO postings (id, entry_id, account_id, amount) VALUES (?, ?, ?, ?)`,
        [
          posting.id as string,
          posting.entryId as string,
          posting.accountId as string,
          posting.amount as number,
        ]
      );
    }

    type Row = Record<string, string | number | boolean | undefined>;

    for (const product of (payload.products ?? []) as Row[]) {
      write(
        `INSERT OR REPLACE INTO products (id, name, brand, unit, category_id, protein_mg, is_staple, archived_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product.id as string,
          product.name as string,
          (product.brand as string) ?? null,
          product.unit as string,
          (product.categoryId as string) ?? null,
          (product.proteinMg as number) ?? null,
          product.isStaple ? 1 : 0,
          (product.archivedAt as string) ?? null,
          product.createdAt as string,
        ]
      );
    }

    for (const purchase of (payload.purchases ?? []) as Row[]) {
      write(
        `INSERT OR REPLACE INTO purchases (id, product_id, quantity, amount, purchased_at, entry_id, store, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          purchase.id as string,
          purchase.productId as string,
          purchase.quantity as number,
          purchase.amount as number,
          purchase.purchasedAt as string,
          (purchase.entryId as string) ?? null,
          (purchase.store as string) ?? null,
          purchase.createdAt as string,
        ]
      );
    }

    // Raw statement text is not part of a backup, so the link back to it is
    // dropped; the row identity itself is what stops a re-import duplicating.
    for (const row of (payload.statementRows ?? []) as Row[]) {
      write(`INSERT OR REPLACE INTO statement_rows (ref, entry_id, raw_id) VALUES (?, ?, NULL)`, [
        row.ref as string,
        row.entryId as string,
      ]);
    }

    for (const row of (payload.balanceAnchors ?? []) as Row[]) {
      write(
        `INSERT OR REPLACE INTO balance_anchors (account_id, as_of, balance, raw_id) VALUES (?, ?, ?, NULL)`,
        [row.accountId as string, row.asOf as string, row.balance as number]
      );
    }

    for (const row of (payload.holdings ?? []) as Row[]) {
      write(
        `INSERT OR REPLACE INTO holdings (id, raw_id, account_id, as_of, source, kind, name, isin, folio,
                                          units_milli, nav_x10000, value, cost)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id as string,
          row.account_id as string,
          row.as_of as string,
          row.source as string,
          row.kind as string,
          row.name as string,
          (row.isin as string | null) ?? null,
          (row.folio as string | null) ?? null,
          (row.units_milli as number | null) ?? null,
          (row.nav_x10000 as number | null) ?? null,
          row.value as number,
          (row.cost as number | null) ?? null,
        ]
      );
    }

    for (const row of (payload.settings ?? []) as Row[]) {
      write(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
        row.key as string,
        row.value as string,
      ]);
    }

    for (const row of (payload.budgets ?? []) as Row[]) {
      write(`INSERT OR REPLACE INTO budgets (id, category_id, amount, created_at, rollover_from) VALUES (?, ?, ?, ?, ?)`, [
        row.id as string,
        (row.categoryId as string) ?? (row.category_id as string),
        row.amount as number,
        (row.createdAt as string) ?? (row.created_at as string),
        ((row.rolloverFrom ?? row.rollover_from) as string | null | undefined) ?? null,
      ]);
    }

    for (const row of (payload.goals ?? []) as Row[]) {
      write(
        `INSERT OR REPLACE INTO goals (id, name, target_amount, saved_amount, target_date, archived_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id as string,
          row.name as string,
          (row.targetAmount as number) ?? (row.target_amount as number),
          (row.savedAmount as number) ?? (row.saved_amount as number) ?? 0,
          (row.targetDate as string) ?? (row.target_date as string) ?? null,
          (row.archivedAt as string) ?? (row.archived_at as string) ?? null,
          row.createdAt as string,
        ]
      );
    }

    for (const row of (payload.recurringItems ?? []) as Row[]) {
      write(
        `INSERT OR REPLACE INTO recurring_items (id, name, amount, cadence, next_due, note, archived_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id as string,
          row.name as string,
          row.amount as number,
          row.cadence as string,
          (row.nextDue as string) ?? (row.next_due as string),
          (row.note as string) ?? null,
          (row.archivedAt as string) ?? (row.archived_at as string) ?? null,
          row.createdAt as string,
        ]
      );
    }

    for (const row of (payload.consumption ?? []) as Row[]) {
      write(
        `INSERT OR REPLACE INTO consumption (id, product_id, quantity, kind, consumed_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id as string,
          row.productId as string,
          row.quantity as number,
          row.kind as string,
          row.consumedAt as string,
          (row.note as string) ?? null,
          row.createdAt as string,
        ]
      );
    }

    const verified = db.verifyLedger();
    if (verified.isErr()) {
      return err({
        code: 'UNBALANCED',
        message: `Restored ledger does not balance: ${verified.error.message}`,
      });
    }

    return ok(payload.entries.length);
  }, 'IMPORT_FAILED');

  if (restored.isErr()) {
    return err({ code: 'IMPORT_FAILED', message: restored.error.message });
  }

  return ok({ entries: restored.value });
};

export const DELETE_CONFIRMATION = 'DELETE ALL';

/**
 * Wipes the ledger. Irreversible, and deliberately requires the exact phrase:
 * the control exists so a user can genuinely leave, which means it has to
 * really delete, and therefore has to be hard to hit by accident.
 */
export const deleteAllData = (
  db: Database,
  confirmation: string
): Result<void, BackupError> => {
  if (confirmation !== DELETE_CONFIRMATION) {
    return err({
      code: 'NOT_CONFIRMED',
      message: `Type "${DELETE_CONFIRMATION}" to confirm`,
    });
  }

  // Postings are removed via the entry cascade; the guard trigger only fires
  // while the parent entry still exists.
  // Children before parents, so no foreign key is left pointing at nothing.
  const tables = [
    'budgets',
    'goals',
    'recurring_items',
    'holdings',
    'consumption',
    'purchases',
    'products',
    'statement_rows',
    'balance_anchors',
    'settings',
    'journal_entries',
    'merchant_patterns',
    'merchants',
    'raw_records',
    'accounts',
  ];

  for (const table of tables) {
    const cleared = db.run(`DELETE FROM ${table}`, []);
    if (cleared.isErr()) {
      return err({ code: 'IMPORT_FAILED', message: cleared.error.message });
    }
  }

  return ok(undefined);
};

/**
 * The backup a user actually keeps: the JSON export, encrypted with their
 * passphrase. Plain exports stay available for reading in a spreadsheet, but
 * this is the one the app offers for safekeeping.
 */
export const sealBackup = async (
  db: Database,
  passphrase: string,
  random: RandomSource
): Promise<Result<{ file: string; metadata: BackupMetadata }, BackupError | EncryptionError>> => {
  const exported = exportLedger(db, 'json');
  if (exported.isErr()) return err(exported.error);

  const sealed = await encryptBackup(exported.value.data, passphrase, random);
  if (sealed.isErr()) return err(sealed.error);

  return ok({ file: sealed.value, metadata: exported.value.metadata });
};

/**
 * Restores an encrypted backup, or a plain JSON one. Only into a ledger with
 * no entries: merging two ledgers would count every statement both hold twice.
 */
export const openBackup = async (
  db: Database,
  file: string,
  passphrase: string
): Promise<Result<{ entries: number }, BackupError | EncryptionError>> => {
  // Fresh means nothing the user made: no entries, accounts or items. An
  // account added during setup would otherwise sit beside its restored twin.
  const [held] = db.query<{ total: number }>(
    `SELECT (SELECT COUNT(*) FROM journal_entries)
          + (SELECT COUNT(*) FROM accounts WHERE is_system = 0)
          + (SELECT COUNT(*) FROM products) AS total`
  ).getOrNull() ?? [{ total: 1 }];
  if (held.total > 0) {
    return err({
      code: 'IMPORT_FAILED',
      message: 'Restore only works on an empty ledger. Delete all data first, then restore.',
    });
  }

  let data = file;
  if (isEncryptedBackup(file)) {
    const opened = await decryptBackup(file, passphrase);
    if (opened.isErr()) return err(opened.error);
    data = opened.value;
  }

  return importBackup(db, data);
};
