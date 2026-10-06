import { Database, type Account } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { toUTC, now, isoDate } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { type Paise, paise, subtract, tryRupeeString } from '@/money/money';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';
import { setBalanceNow } from './manual';
import { recategorise } from './views';

/**
 * A user may have kept months of spending in Paisa, another expense app. Its
 * backup is one JSON file; this brings every transaction in with their own
 * names, notes and categories, without counting a payment twice once bank
 * messages and statements for the same days arrive.
 *
 * Each Paisa account becomes a hand-kept account (institution "Paisa") whose
 * balance is set to zero on import: Paisa never knew what those wallets
 * held, so they add nothing to wealth, while every entry still counts as
 * spending. When a bank alert or statement row later reports the same
 * payment, the entry's Paisa side moves onto that bank account (see
 * `claimLogged`), so it is counted once, with Paisa's description.
 */

export const PAISA_INSTITUTION = 'Paisa';
const PARSER_ID = 'paisa_v1';
const REF_PREFIX = 'paisa:';

type PaisaTransaction = {
  uuid: string;
  name?: string | null;
  amount: number;
  createdAt: string;
  /** 0 expense, 1 income, 2 transfer. */
  type: number;
  description?: string | null;
  account?: string | null;
  category?: string | null;
  fromAccount?: string | null;
  toAccount?: string | null;
};

type PaisaAccount = { uuid: string; name?: string | null; bankName?: string | null };
type PaisaCategory = { uuid: string; name?: string | null; type?: number };

type PaisaBackup = {
  backupVersion?: number;
  transactions: PaisaTransaction[];
  accounts: PaisaAccount[];
  categories: PaisaCategory[];
  [other: string]: unknown;
};

export type PaisaImport = {
  /** New entries written. */
  created: number;
  /** Paisa entries that were already in the ledger as a bank payment. */
  matched: number;
  /** Already imported from this or an earlier copy of the backup. */
  skipped: number;
  /** Transactions that could not be read, with the reason. */
  failed: Array<{ uuid: string; reason: string }>;
  accounts: string[];
  from?: string;
  to?: string;
  /** What Paisa had that Hisaab keeps only as raw input for now. */
  keptAside: { goals: number; budgets: number; recurring: number };
};

export type PaisaError = { code: 'NOT_PAISA' | 'DATABASE'; message: string };

/** Paisa's category names, as a user typed them, to Hisaab categories. */
const CATEGORY_BY_NAME: Record<string, Id> = {
  food: 'cat_food' as Id,
  groceries: 'cat_groceries' as Id,
  transport: 'cat_transport' as Id,
  utilities: 'cat_utilities' as Id,
  entertainment: 'cat_entertainment' as Id,
  shopping: 'cat_shopping' as Id,
  health: 'cat_healthcare' as Id,
  education: 'cat_education' as Id,
  investment: 'cat_investment' as Id,
  bills: 'cat_bills' as Id,
  'family relationship': 'cat_family' as Id,
  family: 'cat_family' as Id,
  society: 'cat_society' as Id,
  kheti: 'cat_kheti' as Id,
  waste: 'cat_waste' as Id,
  savings: 'cat_savings' as Id,
  salary: 'cat_salary' as Id,
  subscriptions: 'cat_subscriptions' as Id,
};

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

const parse = (text: string): PaisaBackup | null => {
  try {
    const value = JSON.parse(text) as Partial<PaisaBackup>;
    return value &&
      Array.isArray(value.transactions) &&
      Array.isArray(value.accounts) &&
      Array.isArray(value.categories)
      ? (value as PaisaBackup)
      : null;
  } catch {
    return null;
  }
};

/** A Paisa backup file, as opposed to a statement or a CAS. */
export const isPaisaBackup = (text: string): boolean =>
  text.trimStart().startsWith('{') && text.includes('"transactions"') && parse(text) !== null;

/**
 * Amounts are JSON numbers in rupees. Read from their decimal text, never
 * by multiplying a float.
 */
const amountOf = (value: unknown): Paise | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const text = String(value);
  return /e/i.test(text) ? null : tryRupeeString(text);
};

/** "Cash" kept by Ravi becomes "Cash · Ravi"; "Asha expenses" by Asha stays as is. */
const accountName = (account: PaisaAccount): string => {
  const label = clean(account.bankName);
  const owner = clean(account.name);
  if (!label) return owner || 'Paisa';
  if (!owner || label.toLowerCase().includes(owner.toLowerCase())) return label;
  return `${label} · ${owner}`;
};

const TRANSFERS = 'cat_transfers' as Id;

const paisaAccount = (db: Database, name: string): Result<Account, PaisaError> => {
  const existing = (db.getAllAccounts().getOrNull() ?? []).find(
    (a) => !a.isSystem && a.institution === PAISA_INSTITUTION && a.name === name
  );
  if (existing) return ok(existing);
  const created = db.createAccount({
    name,
    kind: 'asset',
    // Hand-kept, like cash: no bank alert ever names it.
    subkind: 'cash',
    institution: PAISA_INSTITUTION,
    isSystem: false,
  });
  return created.isOk() ? ok(created.value) : err({ code: 'DATABASE', message: created.error.message });
};

/** A bank-side entry for the same payment, recorded before the backup came in. */
const bankCopy = (
  db: Database,
  amount: Paise,
  date: string,
  taken: Set<string>
): Id | null => {
  const rows =
    db
      .query<{ id: string }>(
        `SELECT e.id FROM journal_entries e
         JOIN postings p ON p.entry_id = e.id AND p.amount = ?
         JOIN accounts a ON a.id = p.account_id
           AND a.is_system = 0 AND a.kind = 'asset'
           AND (a.institution IS NULL OR a.institution <> ?)
           AND (a.subkind IS NULL OR a.subkind NOT IN ('investment', 'cash'))
         JOIN raw_records r ON r.id = e.raw_id
           AND r.source IN ('notification', 'statement_csv', 'statement_pdf')
         WHERE ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?)) <= 1
           AND (e.notes IS NULL OR e.notes NOT LIKE 'Paisa:%')
         ORDER BY ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?))`,
        [amount, PAISA_INSTITUTION, date, date]
      )
      .getOrNull() ?? [];
  return (rows.find((r) => !taken.has(r.id))?.id ?? null) as Id | null;
};

export const importPaisa = (
  db: Database,
  text: string,
  sourceRef: string
): Result<PaisaImport, PaisaError> => {
  const backup = parse(text);
  if (!backup) return err({ code: 'NOT_PAISA', message: 'This is not a Paisa backup file' });

  const known = new Set(
    (
      db
        .query<{ source_ref: string }>(
          `SELECT source_ref FROM raw_records WHERE source = 'manual' AND source_ref LIKE ?`,
          [`${REF_PREFIX}%`]
        )
        .getOrNull() ?? []
    ).map((r) => r.source_ref)
  );

  const result = db.transaction<PaisaImport>(() => {
    // Everything but the transactions (accounts, categories, goals, budgets,
    // recurring items) is kept whole; each transaction is its own record below.
    const { transactions, ...rest } = backup;
    const kept = db.saveRawRecord({
      source: 'manual',
      sourceRef: `paisa-backup:${sourceRef}`,
      payload: JSON.stringify(rest),
      parser: PARSER_ID,
      parsedAt: toUTC(now()),
    });
    if (kept.isErr()) return err(kept.error);

    const accountsByUuid = new Map(backup.accounts.map((a) => [a.uuid, a]));
    const categoriesByUuid = new Map(backup.categories.map((c) => [c.uuid, c]));
    const ledgerAccounts = new Map<string, Account>();
    const taken = new Set<string>();

    const summary: PaisaImport = {
      created: 0,
      matched: 0,
      skipped: 0,
      failed: [],
      accounts: [],
      keptAside: {
        goals: Array.isArray(backup.goals) ? backup.goals.length : 0,
        budgets: Array.isArray(backup.budgets) ? backup.budgets.length : 0,
        recurring: Array.isArray(backup.recurrings) ? backup.recurrings.length : 0,
      },
    };

    const sorted = [...transactions].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const tx of sorted) {
      const ref = `${REF_PREFIX}${tx.uuid}`;
      if (known.has(ref)) {
        summary.skipped++;
        continue;
      }

      const paisaAcc = tx.account ? accountsByUuid.get(tx.account) : undefined;
      const category = tx.category ? categoriesByUuid.get(tx.category) : undefined;

      // The raw record goes in first, whatever happens to the parse.
      const raw = db.saveRawRecord({
        source: 'manual',
        sourceRef: ref,
        payload: JSON.stringify({
          transaction: tx,
          account: paisaAcc ? { name: paisaAcc.name, bankName: paisaAcc.bankName } : null,
          category: category?.name ?? null,
        }),
        parser: PARSER_ID,
      });
      if (raw.isErr()) return err(raw.error);
      known.add(ref);

      const fail = (reason: string) => {
        summary.failed.push({ uuid: tx.uuid, reason });
        db.run(`UPDATE raw_records SET parse_error = ? WHERE id = ?`, [reason, raw.value.id]);
      };

      const amount = amountOf(tx.amount);
      const date = /^\d{4}-\d{2}-\d{2}/.test(String(tx.createdAt)) ? String(tx.createdAt).slice(0, 10) : null;
      if (!amount) { fail('Amount is not a positive number'); continue; }
      if (!date) { fail('No date'); continue; }
      if (tx.type !== 0 && tx.type !== 1 && tx.type !== 2) { fail('Unknown transaction type'); continue; }

      const ledgerAccount = (from: PaisaAccount): Result<Account, PaisaError> => {
        const label = accountName(from);
        const cached = ledgerAccounts.get(label);
        if (cached) return ok(cached);
        const found = paisaAccount(db, label);
        if (found.isOk()) ledgerAccounts.set(label, found.value);
        return found;
      };

      // Money moved between two of his own Paisa wallets: neither spending nor income, and
      // never matched to a bank message (a bank payment of the same amount is a real expense).
      if (tx.type === 2) {
        const fromAcc = tx.fromAccount ? accountsByUuid.get(tx.fromAccount) : undefined;
        const toAcc = tx.toAccount ? accountsByUuid.get(tx.toAccount) : undefined;
        if (!fromAcc || !toAcc) { fail('A transfer account is not in the backup'); continue; }
        const from = ledgerAccount(fromAcc);
        if (from.isErr()) return err(from.error);
        const to = ledgerAccount(toAcc);
        if (to.isErr()) return err(to.error);
        if (from.value.id === to.value.id) { fail('A transfer to the same account'); continue; }

        const note = clean(tx.description);
        const written = db.createJournalEntry(
          {
            occurredAt: date,
            description: clean(tx.name) || `Transfer to ${to.value.name}`,
            rawId: raw.value.id,
            categoryId: TRANSFERS,
            kind: 'transfer',
            confidence: 1,
            reviewedAt: toUTC(now()),
            notes: note || undefined,
          },
          [
            { accountId: from.value.id, amount: subtract(paise(0), amount) },
            { accountId: to.value.id, amount },
          ]
        );
        if (written.isErr()) return err(written.error);
        db.run(`UPDATE raw_records SET parsed_at = ? WHERE id = ?`, [toUTC(now()), raw.value.id]);
        summary.from = summary.from && summary.from < date ? summary.from : date;
        summary.to = summary.to && summary.to > date ? summary.to : date;
        summary.created++;
        continue;
      }

      if (!paisaAcc) { fail('Its account is not in the backup'); continue; }

      const income = tx.type === 1;
      const signed = income ? amount : subtract(paise(0), amount);
      const categoryId = CATEGORY_BY_NAME[clean(category?.name).toLowerCase()];
      const name = clean(tx.name) || clean(category?.name) || (income ? 'Income' : 'Expense');
      const note = clean(tx.description);
      summary.from = summary.from && summary.from < date ? summary.from : date;
      summary.to = summary.to && summary.to > date ? summary.to : date;

      // Already recorded from a bank message or statement: add what Paisa knew.
      const copy = bankCopy(db, signed, date, taken);
      if (copy) {
        taken.add(copy);
        // Paisa's "Investment" was mostly money given within the family; filing
        // a bank debit under Investment would move it into the Investments
        // account, so that one category is left for the user to confirm.
        if (categoryId && categoryId !== 'cat_investment') {
          recategorise(db, { entryId: copy, categoryId, applyToAll: false });
        }
        db.updateEntry(copy, { notes: `Paisa: ${name}${note ? ` (${note})` : ''}` });
        db.run(`UPDATE raw_records SET parsed_at = ?, parse_error = ? WHERE id = ?`, [
          toUTC(now()),
          `Already recorded as ${copy}`,
          raw.value.id,
        ]);
        summary.matched++;
        continue;
      }

      const found = ledgerAccount(paisaAcc);
      if (found.isErr()) return err(found.error);
      const account = found.value;

      const written = db.createJournalEntry(
        {
          occurredAt: date,
          description: name,
          rawId: raw.value.id,
          categoryId,
          kind: income ? 'income' : 'expense',
          confidence: 1,
          reviewedAt: toUTC(now()),
          notes: note || undefined,
        },
        [
          { accountId: account.id, amount: signed },
          {
            accountId: income ? SYSTEM_ACCOUNT_IDS.UNKNOWN_INCOME : SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE,
            amount: subtract(paise(0), signed),
          },
        ]
      );
      if (written.isErr()) return err(written.error);
      db.run(`UPDATE raw_records SET parsed_at = ? WHERE id = ?`, [toUTC(now()), raw.value.id]);
      summary.created++;
    }

    // Paisa never knew what these wallets held: they add nothing to wealth.
    const today = isoDate(new Date());
    for (const account of ledgerAccounts.values()) {
      const set = setBalanceNow(db, account.id, paise(0), today);
      if (set.isErr()) return err({ code: 'DATABASE', message: set.error.message });
    }
    summary.accounts = [...ledgerAccounts.keys()];
    return ok(summary);
  }, 'PAISA_IMPORT_FAILED');

  return result.isOk() ? ok(result.value) : err({ code: 'DATABASE', message: result.error.message });
};

/**
 * A bank alert or statement row for a payment the user had already written in
 * Paisa: move that entry's Paisa side onto the bank account, so the payment
 * is counted once and keeps its description and category. Returns the entry
 * claimed, or null when nothing in Paisa matches.
 */
export const claimLogged = (
  db: Database,
  accountId: Id,
  amount: Paise,
  date: string,
  /** The alert doing the claiming, remembered so reading it again adds nothing. */
  byRaw?: Id
): Id | null => {
  const day = date.slice(0, 10);
  const [row] =
    db
      .query<{ posting: string; entry: string }>(
        `SELECT p.id AS posting, e.id AS entry FROM postings p
         JOIN journal_entries e ON e.id = p.entry_id AND e.kind <> 'transfer'
         JOIN accounts a ON a.id = p.account_id AND a.institution = ?
         WHERE p.amount = ? AND ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?)) <= 1
         ORDER BY ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?))
         LIMIT 1`,
        [PAISA_INSTITUTION, amount, day, day]
      )
      .getOrNull() ?? [];
  if (!row) return null;
  if (db.moveLeg(row.posting as Id, accountId).isErr()) return null;
  if (byRaw) db.setSetting(`${CLAIM_PREFIX}${byRaw}`, row.entry);
  return row.entry as Id;
};

/** `claim:<alert raw id>` → the Paisa entry that alert was matched to. */
export const CLAIM_PREFIX = 'claim:';

/**
 * Puts every Paisa entry back on its own Paisa account and forgets which
 * alerts claimed them. Used before re-reading every message from scratch.
 */
export const unclaimAll = (db: Database): void => {
  const rows =
    db
      .query<{ entry: string; posting: string; payload: string }>(
        `SELECT e.id AS entry, p.id AS posting, r.payload FROM journal_entries e
         JOIN raw_records r ON r.id = e.raw_id AND r.source = 'manual' AND r.source_ref LIKE ?
         JOIN postings p ON p.entry_id = e.id
         JOIN accounts a ON a.id = p.account_id AND a.is_system = 0
           AND (a.institution IS NULL OR a.institution <> ?)`,
        [`${REF_PREFIX}%`, PAISA_INSTITUTION]
      )
      .getOrNull() ?? [];
  const accounts = (db.getAllAccounts().getOrNull() ?? []).filter((a) => a.institution === PAISA_INSTITUTION);
  for (const row of rows) {
    let home: Account | undefined;
    try {
      const saved = JSON.parse(row.payload) as { account?: PaisaAccount | null };
      home = saved.account ? accounts.find((a) => a.name === accountName(saved.account!)) : undefined;
    } catch {
      home = undefined;
    }
    if (home) db.moveLeg(row.posting as Id, home.id);
  }
  db.run(`DELETE FROM settings WHERE key LIKE ?`, [`${CLAIM_PREFIX}%`]);
};
