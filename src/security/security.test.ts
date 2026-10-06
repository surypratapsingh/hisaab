import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  exportLedger,
  importBackup,
  deleteAllData,
  checksum,
  BACKUP_VERSION,
  DELETE_CONFIRMATION,
} from './backup';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { importStatement } from '@/repo/import';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import {
  createProduct,
  recordPurchase,
  logConsumption,
  inventoryMonth,
  listProducts,
  onHandOf,
} from '@/inventory/repo';

const fixture = readFileSync(
  fileURLToPath(new URL('../../test/fixtures/hdfc_sample.csv', import.meta.url)),
  'utf8'
);

const populated = (): { db: Database; account: Account } => {
  const db = new Database(new NodeSqliteDriver());
  db.initialize();

  const account = db
    .createAccount({
      name: 'HDFC Savings',
      kind: 'asset',
      subkind: 'bank',
      last4: '1234',
      isSystem: false,
    })
    .getOrNull()!;

  importStatement(db, {
    text: fixture,
    sourceRef: 'hdfc_sample.csv',
    source: 'statement_csv',
    account,
  });

  return { db, account };
};

describe('export', () => {
  let db: Database;
  let account: Account;

  beforeEach(() => {
    ({ db, account } = populated());
  });

  afterEach(() => db.close());

  it('exports the real ledger, not an empty shell', () => {
    const backup = exportLedger(db).getOrNull()!;

    expect(backup.metadata.entries).toBe(12);
    expect(backup.metadata.postings).toBe(24);
    expect(backup.metadata.accounts).toBeGreaterThan(0);
    expect(backup.data).toContain('SALARY TRANSFER FROM EMPLOYER');
  });

  it('stamps a version and a checksum that matches the payload', () => {
    const backup = exportLedger(db).getOrNull()!;

    expect(backup.metadata.version).toBe(BACKUP_VERSION);
    expect(backup.metadata.checksum).toBe(checksum(backup.data));
  });

  it('exports CSV a person can read', () => {
    const backup = exportLedger(db, 'csv').getOrNull()!;
    const lines = backup.data.split('\n');

    expect(lines[0]).toBe('Date,Narration,Merchant,Category,Amount,Account');
    expect(lines).toHaveLength(13);
    expect(lines[1]).toContain('HDFC Savings');
  });

  it('quotes a narration containing a comma', () => {
    db.createJournalEntry(
      {
        occurredAt: '2026-03-01',
        description: 'SALARY, MONTHLY CREDIT',
        kind: 'income',
        confidence: 1,
      },
      [
        { accountId: account.id, amount: 100000 as never },
        { accountId: 'acc_suspense' as Id, amount: -100000 as never },
      ]
    );

    const csv = exportLedger(db, 'csv').getOrNull()!.data;
    expect(csv).toContain('"SALARY, MONTHLY CREDIT"');
  });
});

describe('restore into a fresh install', () => {
  it('reproduces the ledger exactly', () => {
    const { db: source, account } = populated();
    const backup = exportLedger(source).getOrNull()!;
    const before = source.getBalance(account.id).getOrNull()!;
    source.close();

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();

    const restored = importBackup(fresh, backup.data);

    expect(restored.isOk()).toBe(true);
    expect(restored.getOrNull()!.entries).toBe(12);
    expect(fresh.getBalance(account.id).getOrNull()).toBe(before);
    expect(format(fresh.getBalance(account.id).getOrNull()!)).toBe(
      'Rs 1,23,699.50'
    );
    expect(fresh.verifyLedger().getOrNull()).toBe(true);

    fresh.close();
  });

  it('carries the learned patterns across', () => {
    const { db: source } = populated();
    const merchant = source.upsertMerchant('Blinkit', 'cat_food' as Id).getOrNull()!;
    source.recordPattern({
      merchantId: merchant.id,
      pattern: 'BLINKIT',
      kind: 'substring',
      source: 'user',
    });

    const backup = exportLedger(source).getOrNull()!;
    source.close();

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    importBackup(fresh, backup.data);

    const patterns = fresh.getPatterns().getOrNull()!;
    expect(patterns.some((p) => p.pattern === 'BLINKIT')).toBe(true);

    fresh.close();
  });

  it('refuses a backup that is not JSON', () => {
    const db = new Database(new NodeSqliteDriver());
    db.initialize();

    const result = importBackup(db, 'not json at all');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('INVALID_BACKUP');

    db.close();
  });

  it('names the section a malformed backup is missing', () => {
    const db = new Database(new NodeSqliteDriver());
    db.initialize();

    const result = importBackup(
      db,
      JSON.stringify({ version: BACKUP_VERSION, accounts: [] })
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('categories');

    db.close();
  });

  it('refuses a backup written by a different version', () => {
    const db = new Database(new NodeSqliteDriver());
    db.initialize();

    const result = importBackup(
      db,
      JSON.stringify({
        version: 99,
        accounts: [],
        categories: [],
        merchants: [],
        patterns: [],
        entries: [],
        postings: [],
      })
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('VERSION_MISMATCH');

    db.close();
  });
});

describe('item history survives a backup', () => {
  const withItems = () => {
    const { db, account } = populated();
    const paneer = createProduct(db, {
      name: 'Paneer',
      unit: 'g',
      proteinMg: 18000,
      isStaple: true,
    }).getOrNull()!;

    recordPurchase(db, {
      productId: paneer.id,
      quantity: 400,
      amount: paise(18000),
      purchasedAt: '2026-01-05',
    });
    logConsumption(db, {
      productId: paneer.id,
      quantity: 150,
      kind: 'used',
      consumedAt: '2026-01-10',
    });

    return { db, account, paneer };
  };

  it('restores products, purchases and what was used', () => {
    const { db, paneer } = withItems();
    const backup = exportLedger(db).getOrNull()!;
    db.close();

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    expect(importBackup(fresh, backup.data).isOk()).toBe(true);

    const month = inventoryMonth(fresh, new Date(2026, 0, 15));
    const row = month.rows.find((r) => r.product.id === paneer.id)!;

    expect(format(row.spent)).toBe('Rs 180.00');
    expect(row.used).toBe(150);
    expect(row.onHand).toBe(250);
    expect(row.product.isStaple).toBe(true);

    fresh.close();
  });

  it('brings back each brand as its own product, and leaves photos behind on purpose', () => {
    const { db } = populated();
    const anand = createProduct(db, { name: 'Paneer', brand: 'Anand', unit: 'g', photo: 'file:///data/app/product-photos/a.jpg' }).getOrNull()!;
    createProduct(db, { name: 'Paneer', brand: 'Param', unit: 'g' });
    recordPurchase(db, { productId: anand.id, quantity: 200, amount: paise(6000), purchasedAt: '2026-01-05' });

    const backup = exportLedger(db).getOrNull()!;
    db.close();
    // A photo is a path on this phone: it is neither written into the file nor read back from it.
    expect(backup.data).not.toContain('product-photos');

    const tampered = backup.data.replace('"name":"Paneer"', '"name":"Paneer","photo":"http://example.com/track.png"');
    expect(tampered).not.toBe(backup.data); // the tampering really happened
    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    expect(importBackup(fresh, tampered).isOk()).toBe(true);

    const products = listProducts(fresh);
    expect(products.map((product) => product.brand).sort()).toEqual(['Anand', 'Param']);
    expect(products.every((product) => product.photo === undefined)).toBe(true);
    fresh.close();
  });

  it('adds nothing when a statement is imported again after a restore', () => {
    const { db } = populated();
    const backup = exportLedger(db).getOrNull()!;
    db.close();

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    importBackup(fresh, backup.data);

    const account = fresh.getAllAccounts().getOrNull()!.find((a) => !a.isSystem)!;
    const again = importStatement(fresh, {
      text: fixture,
      sourceRef: 'hdfc_sample.csv',
      source: 'statement_csv',
      account,
    }).getOrNull()!;

    expect(again.rowsParsed).toBe(0);
    expect(again.duplicatesSkipped).toBe(12);

    fresh.close();
  });

  it('still reads a backup made before items existed', () => {
    const { db } = populated();
    const older = JSON.parse(exportLedger(db).getOrNull()!.data);
    db.close();

    for (const section of ['products', 'purchases', 'consumption', 'statementRows']) {
      delete older[section];
    }

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();

    const restored = importBackup(fresh, JSON.stringify({ ...older, version: 1 }));
    expect(restored.isOk()).toBe(true);
    expect(restored.getOrNull()!.entries).toBe(12);

    fresh.close();
  });

  it('leaves the database untouched when a restore fails halfway', () => {
    const { db } = populated();
    const payload = JSON.parse(exportLedger(db).getOrNull()!.data);
    db.close();

    // A posting that points at no entry trips a foreign key partway through.
    payload.postings.push({ id: 'bad', entryId: 'missing', accountId: 'acc_cash', amount: 100 });

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();

    expect(importBackup(fresh, JSON.stringify(payload)).isErr()).toBe(true);
    expect(fresh.getEntries().getOrNull()).toHaveLength(0);
    expect(fresh.getAllAccounts().getOrNull()!.filter((a) => !a.isSystem)).toHaveLength(0);

    fresh.close();
  });

  it('keeps the real balance and payday across a restore', () => {
    const { db, account } = populated();
    db.setSetting('payday_day', '1');
    const balance = db.reportedBalance(account.id).getOrNull()!;
    const backup = exportLedger(db).getOrNull()!;
    db.close();

    const fresh = new Database(new NodeSqliteDriver());
    fresh.initialize();
    importBackup(fresh, backup.data);

    expect(fresh.reportedBalance(account.id).getOrNull()).toBe(balance);
    expect(format(balance)).toBe('Rs 5,73,699.50');
    expect(fresh.getSetting('payday_day').getOrNull()).toBe('1');

    fresh.close();
  });

  it('is wiped by delete everything', () => {
    const { db, paneer } = withItems();

    deleteAllData(db, DELETE_CONFIRMATION);

    expect(listProducts(db, { includeArchived: true })).toHaveLength(0);
    expect(onHandOf(db, paneer.id)).toBe(0);

    db.close();
  });
});

describe('delete everything', () => {
  it('needs the exact phrase', () => {
    const { db } = populated();

    const wrong = deleteAllData(db, 'delete all');
    expect(wrong.isErr()).toBe(true);
    if (wrong.isErr()) expect(wrong.error.code).toBe('NOT_CONFIRMED');

    expect(db.getEntries().getOrNull()).toHaveLength(12);
    db.close();
  });

  it('actually deletes', () => {
    const { db } = populated();

    expect(deleteAllData(db, DELETE_CONFIRMATION).isOk()).toBe(true);

    expect(db.getEntries().getOrNull()).toHaveLength(0);
    expect(db.getAllAccounts().getOrNull()).toHaveLength(0);
    expect(db.getRawRecords().getOrNull()).toHaveLength(0);
    expect(db.getAllMerchants().getOrNull()).toHaveLength(0);

    db.close();
  });

  it('leaves no orphaned postings behind', () => {
    const { db } = populated();
    deleteAllData(db, DELETE_CONFIRMATION);

    // The entry cascade must have taken the postings with it.
    expect(db.verifyLedger().getOrNull()).toBe(true);
    expect(db.netWorth().getOrNull()!.net).toBe(0);

    db.close();
  });
});
