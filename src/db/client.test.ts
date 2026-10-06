import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from './client';
import { NodeSqliteDriver } from './drivers/node';
import { paise, format } from '@/money/money';
import { generateId, Id } from '@/lib/ulid';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';

const entryInput = {
  occurredAt: '2026-01-01',
  description: 'Test',
  kind: 'expense' as const,
  confidence: 1,
};

describe('a phone that already had products without brand or photo', () => {
  it('gains the columns, keeps its products, and then allows two brands of one product', () => {
    const driver = new NodeSqliteDriver();
    // The products table exactly as version 5 shipped it, with a product already in it.
    driver.exec(`
      CREATE TABLE products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        unit TEXT NOT NULL CHECK (unit IN ('piece', 'g', 'ml')),
        category_id TEXT, protein_mg INTEGER, is_staple INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_product_name ON products(name COLLATE NOCASE);
      INSERT INTO products (id, name, unit, created_at) VALUES ('p1', 'Chicken', 'g', '2026-09-26');
    `);

    const db = new Database(driver);
    expect(db.initialize().isOk()).toBe(true);
    expect(db.initialize().isOk()).toBe(true); // and again: safe to repeat

    const rows = db.query<{ name: string; brand: string | null; photo: string | null }>('SELECT name, brand, photo FROM products').getOrNull()!;
    expect(rows).toEqual([{ name: 'Chicken', brand: null, photo: null }]);

    const write = (id: string, brand: string | null) =>
      db.run("INSERT INTO products (id, name, brand, unit, created_at) VALUES (?, 'Paneer', ?, 'g', '2026-09-27')", [id, brand]);
    expect(write('p2', 'Anand').isOk()).toBe(true);
    expect(write('p3', 'Param').isOk()).toBe(true);
    expect(write('p4', 'anand').isErr()).toBe(true); // same name and brand
    db.close();
  });
});

describe('Database ledger invariants', () => {
  let db: Database;
  let bank: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db
      .createAccount({
        name: 'HDFC Savings',
        kind: 'asset',
        subkind: 'bank',
        last4: '1234',
        isSystem: false,
      })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('seeds the system accounts and categories on first run', () => {
    const accounts = db.getAllAccounts().getOrNull()!;
    const ids = accounts.map((a) => a.id);

    expect(ids).toContain(SYSTEM_ACCOUNT_IDS.SUSPENSE);
    expect(ids).toContain(SYSTEM_ACCOUNT_IDS.OPENING_BALANCE);
    expect(accounts.filter((a) => a.isSystem)).toHaveLength(5);
  });

  it('is idempotent across repeated initialisation', () => {
    db.initialize();
    db.initialize();

    expect(db.getAllAccounts().getOrNull()!.filter((a) => a.isSystem)).toHaveLength(5);
  });

  it('round-trips an account through SQL', () => {
    const account = db.getAccount(bank).getOrNull()!;

    expect(account.name).toBe('HDFC Savings');
    expect(account.subkind).toBe('bank');
    expect(account.last4).toBe('1234');
    expect(account.isSystem).toBe(false);
    expect(account.institution).toBeUndefined();
  });

  it('accepts a balanced two-legged entry', () => {
    const result = db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-50000) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(50000) },
    ]);

    expect(result.isOk()).toBe(true);
    expect(db.getPostings(result.getOrNull()!.id).getOrNull()).toHaveLength(2);
  });

  it('accepts a balanced three-legged entry', () => {
    const result = db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-75000) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(50000) },
      { accountId: SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE, amount: paise(25000) },
    ]);

    expect(result.isOk()).toBe(true);
  });

  it('rejects an unbalanced entry', () => {
    const result = db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-50000) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(49900) },
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('UNBALANCED_ENTRY');
    }
  });

  it('rejects a single-legged entry', () => {
    const result = db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(0) },
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INSUFFICIENT_POSTINGS');
    }
  });

  it('leaves nothing behind when a write fails mid-transaction', () => {
    const before = db.getPostings(bank).getOrNull()!.length;

    // A posting against an account that does not exist trips the foreign key
    // after the entry row is already inserted.
    const result = db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-50000) },
      { accountId: generateId(), amount: paise(50000) },
    ]);

    expect(result.isErr()).toBe(true);
    expect(db.verifyLedger().getOrNull()).toBe(true);
    expect(db.getPostings(bank).getOrNull()!.length).toBe(before);
  });

  it('computes an account balance from its postings', () => {
    db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(500000) },
      { accountId: SYSTEM_ACCOUNT_IDS.OPENING_BALANCE, amount: paise(-500000) },
    ]);
    db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-45075) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(45075) },
    ]);

    expect(format(db.getBalance(bank).getOrNull()!)).toBe('Rs 4,549.25');
  });

  it('verifies a clean ledger', () => {
    db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-50000) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(50000) },
    ]);

    expect(db.verifyLedger().getOrNull()).toBe(true);
  });

  it('blocks an update that would unbalance an entry', () => {
    const entry = db
      .createJournalEntry(entryInput, [
        { accountId: bank, amount: paise(-50000) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(50000) },
      ])
      .getOrNull()!;

    const result = db.run(
      `UPDATE postings SET amount = amount + 1 WHERE entry_id = ? AND amount < 0`,
      [entry.id]
    );

    expect(result.isErr()).toBe(true);
    expect(db.verifyLedger().getOrNull()).toBe(true);
  });

  it('catches an extra leg no row trigger can see', () => {
    const entry = db
      .createJournalEntry(entryInput, [
        { accountId: bank, amount: paise(-50000) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(50000) },
      ])
      .getOrNull()!;

    // An INSERT cannot be judged row by row — the entry only becomes
    // unbalanced once the statement completes. This is the gap verifyLedger
    // exists to close.
    db.run(
      `INSERT INTO postings (id, entry_id, account_id, amount) VALUES (?, ?, ?, 1)`,
      [generateId(), entry.id, bank]
    );

    const result = db.verifyLedger();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('UNBALANCED_ENTRY');
    }
  });
});

describe('Database triggers', () => {
  let db: Database;
  let bank: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db
      .createAccount({ name: 'Bank', kind: 'asset', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('refuses a fractional posting amount', () => {
    const entry = db
      .createJournalEntry(entryInput, [
        { accountId: bank, amount: paise(-100) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
      ])
      .getOrNull()!;

    const result = db.run(
      `INSERT INTO postings (id, entry_id, account_id, amount) VALUES (?, ?, ?, 10.5)`,
      [generateId(), entry.id, bank]
    );

    expect(result.isErr()).toBe(true);
  });

  it('refuses deleting a single posting out of an entry', () => {
    const entry = db
      .createJournalEntry(entryInput, [
        { accountId: bank, amount: paise(-100) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
      ])
      .getOrNull()!;

    const result = db.run(`DELETE FROM postings WHERE entry_id = ? AND amount < 0`, [
      entry.id,
    ]);

    expect(result.isErr()).toBe(true);
    expect(db.getPostings(entry.id).getOrNull()).toHaveLength(2);
  });

  it('cascades postings when the whole entry is deleted', () => {
    const entry = db
      .createJournalEntry(entryInput, [
        { accountId: bank, amount: paise(-100) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
      ])
      .getOrNull()!;

    expect(db.run(`DELETE FROM journal_entries WHERE id = ?`, [entry.id]).isOk()).toBe(
      true
    );
    expect(db.getPostings(entry.id).getOrNull()).toHaveLength(0);
  });
});

describe('Database reporting', () => {
  let db: Database;
  let bank: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db
      .createAccount({ name: 'Bank', kind: 'asset', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('stores raw statement text before anything is parsed from it', () => {
    const record = db
      .saveRawRecord({
        source: 'statement_csv',
        sourceRef: 'hdfc_sample.csv',
        payload: 'Booking Date,Value Date\n2026-01-01,2026-01-01',
        parser: 'hdfc_savings_csv_v1',
      })
      .getOrNull()!;

    expect(record.payload).toContain('Booking Date');
    expect(record.ingestedAt).toBeTruthy();
  });

  it('surfaces only low-confidence unreviewed entries in the review queue', () => {
    db.createJournalEntry({ ...entryInput, confidence: 0.95 }, [
      { accountId: bank, amount: paise(-100) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
    ]);
    db.createJournalEntry({ ...entryInput, confidence: 0.1 }, [
      { accountId: bank, amount: paise(-200) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(200) },
    ]);

    const queue = db.getReviewQueue().getOrNull()!;
    expect(queue).toHaveLength(1);
    expect(queue[0].confidence).toBe(0.1);
  });

  it('reports the suspense ratio as the share of flow it cannot explain', () => {
    // One categorised expense, one that fell through to Suspense.
    db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-9000) },
      { accountId: SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE, amount: paise(9000) },
    ]);
    db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-1000) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(1000) },
    ]);

    expect(db.suspenseRatio(SYSTEM_ACCOUNT_IDS.SUSPENSE).getOrNull()).toBeCloseTo(
      0.1
    );
  });

  it('reports a zero ratio on an empty ledger', () => {
    expect(db.suspenseRatio(SYSTEM_ACCOUNT_IDS.SUSPENSE).getOrNull()).toBe(0);
  });

  it('returns null for an unknown account', () => {
    expect(db.getAccount(generateId()).getOrNull()).toBeNull();
  });
});

describe('deleteAccount', () => {
  let db: Database;
  let bank: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db
      .createAccount({ name: 'Spare', kind: 'asset', subkind: 'bank', last4: '9999', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('deletes an account that was never used', () => {
    expect(db.deleteAccount(bank).isOk()).toBe(true);
    expect(db.getAccount(bank).getOrNull()).toBeNull();
  });

  it('refuses to delete an account that has transactions', () => {
    db.createJournalEntry(entryInput, [
      { accountId: bank, amount: paise(-100) },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
    ]);

    const result = db.deleteAccount(bank);
    expect(result.isErr() && result.error.code).toBe('HAS_TRANSACTIONS');
    expect(db.getAccount(bank).getOrNull()).not.toBeNull();
  });

  it('refuses to delete a system account', () => {
    const result = db.deleteAccount(SYSTEM_ACCOUNT_IDS.SUSPENSE);
    expect(result.isErr() && result.error.code).toBe('SYSTEM_ACCOUNT');
  });
});

describe('deleteEntry', () => {
  let db: Database;
  let bank: Id;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db
      .createAccount({ name: 'Bank', kind: 'asset', subkind: 'bank', last4: '1111', isSystem: false })
      .getOrNull()!.id;
  });

  afterEach(() => db.close());

  it('deletes a manually entered mistake', () => {
    const raw = db.saveRawRecord({ source: 'manual', payload: '{}' }).getOrNull()!;
    const entry = db
      .createJournalEntry({ ...entryInput, rawId: raw.id }, [
        { accountId: bank, amount: paise(-100) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
      ])
      .getOrNull()!;

    expect(db.deleteEntry(entry.id).isOk()).toBe(true);
    expect(db.getEntry(entry.id).getOrNull()).toBeNull();
    expect(db.getPostings(entry.id).getOrNull()).toHaveLength(0);
  });

  it('refuses to delete an entry that came from a bank source', () => {
    const raw = db.saveRawRecord({ source: 'notification', payload: '{}' }).getOrNull()!;
    const entry = db
      .createJournalEntry({ ...entryInput, rawId: raw.id }, [
        { accountId: bank, amount: paise(-100) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
      ])
      .getOrNull()!;

    const result = db.deleteEntry(entry.id);
    expect(result.isErr() && result.error.code).toBe('NOT_MANUAL');
    expect(db.getEntry(entry.id).getOrNull()).not.toBeNull();
  });
});

describe('Database performance', () => {
  it('walks 10,000 entries in under 200ms', () => {
    const db = new Database(new NodeSqliteDriver());
    db.initialize();
    const bank = db
      .createAccount({ name: 'Bank', kind: 'asset', isSystem: false })
      .getOrNull()!.id;

    for (let i = 0; i < 10_000; i++) {
      db.createJournalEntry(entryInput, [
        { accountId: bank, amount: paise(-100) },
        { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: paise(100) },
      ]);
    }

    const start = performance.now();
    const result = db.verifyLedger();
    const elapsed = performance.now() - start;

    expect(result.getOrNull()).toBe(true);
    expect(elapsed).toBeLessThan(200);

    db.close();
    // Only verifyLedger is timed; writing the 10,000 entries first can take longer than the default 5s.
  }, 30_000);
});
