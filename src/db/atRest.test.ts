import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from './client';
import { NodeSqliteDriver } from './drivers/node';
import type { SqliteDriver } from './driver';
import { DONE_ITEM, ENCRYPTED_NAME, KEY_ITEM, PLAIN_NAME, openAtRest, type AtRestDeps } from './atRest';

// Node's SQLite has no SQLCipher, so "encryption" here is a copy (VACUUM INTO) plus a record of
// which key a file was made with; opening with any other key fails, as SQLCipher would.
let dir: string;
let keys: Map<string, string>;
let items: Map<string, string>;
let open: SqliteDriver[];

const path = (name: string) => join(dir, name);

const deps = (overrides: Partial<AtRestDeps> = {}): AtRestDeps => ({
  cipherAvailable: true,
  exists: (name) => existsSync(path(name)),
  remove: (name) => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path(name) + suffix, { force: true });
  },
  open: (name, key) => {
    const made = keys.get(name);
    if (existsSync(path(name)) && made !== key) throw new Error('file is not a database');
    if (!existsSync(path(name)) && key) keys.set(name, key);
    const driver = new NodeSqliteDriver(path(name));
    open.push(driver);
    return driver;
  },
  exportEncrypted: (plain, target, key) => {
    plain.exec(`VACUUM INTO '${path(target).replace(/'/g, "''")}'`);
    keys.set(target, key);
  },
  getItem: async (item) => items.get(item) ?? null,
  setItem: async (item, value) => {
    items.set(item, value);
  },
  newKey: () => 'ab'.repeat(32),
  ...overrides,
});

const makePlainLedger = () => {
  const db = new Database(new NodeSqliteDriver(path(PLAIN_NAME)));
  db.initialize();
  db.createAccount({ name: 'SBI', kind: 'asset', isSystem: false });
  db.close();
};

const accountNames = (driver: SqliteDriver) =>
  driver.all<{ name: string }>('SELECT name FROM accounts ORDER BY name').map((row) => row.name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'money-at-rest-'));
  keys = new Map();
  items = new Map();
  open = [];
});

afterEach(() => {
  for (const driver of open) {
    try {
      driver.close();
    } catch {
      // already closed
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('opening the ledger encrypted at rest', () => {
  it('starts a new phone on an encrypted file with a kept key', async () => {
    const opened = await openAtRest(deps());

    expect(opened.encrypted).toBe(true);
    expect(opened.problem).toBeUndefined();
    expect(items.get(KEY_ITEM)).toMatch(/^[0-9a-f]{64}$/);
    expect(items.get(DONE_ITEM)).toBe('yes');
    expect(existsSync(path(ENCRYPTED_NAME))).toBe(true);
    expect(existsSync(path(PLAIN_NAME))).toBe(false);
  });

  it('moves an existing ledger into the encrypted file and deletes the old one only after', async () => {
    makePlainLedger();

    const opened = await openAtRest(deps());

    expect(opened.encrypted).toBe(true);
    expect(accountNames(opened.driver)).toContain('SBI');
    expect(existsSync(path(PLAIN_NAME))).toBe(false);
    expect(items.get(DONE_ITEM)).toBe('yes');
    // The ledger opens and passes its own checks on the moved file.
    const db = new Database(opened.driver);
    expect(db.initialize().isErr()).toBe(false);
    expect(db.verifyLedger().getOrNull()).toBe(true);
  });

  it('says it is moving only when there is a ledger to move', async () => {
    let told = 0;
    const counting = () => deps({ onMoving: async () => { told++; } });
    (await openAtRest(counting())).driver.close();
    expect(told).toBe(0); // a new phone has nothing to move

    rmSync(path(ENCRYPTED_NAME));
    items.clear();
    keys.clear();
    makePlainLedger();
    (await openAtRest(counting())).driver.close();
    expect(told).toBe(1);
    (await openAtRest(counting())).driver.close();
    expect(told).toBe(1);
  });

  it('opens the encrypted file on every later start', async () => {
    makePlainLedger();
    (await openAtRest(deps())).driver.close();

    const again = await openAtRest(deps());

    expect(again.encrypted).toBe(true);
    expect(accountNames(again.driver)).toContain('SBI');
  });

  it('starts the move again when the app stopped before it was recorded', async () => {
    makePlainLedger();
    writeFileSync(path(ENCRYPTED_NAME), 'half a copy');
    items.set(KEY_ITEM, 'cd'.repeat(32));
    keys.set(ENCRYPTED_NAME, 'cd'.repeat(32));

    const opened = await openAtRest(deps());

    expect(opened.encrypted).toBe(true);
    expect(accountNames(opened.driver)).toContain('SBI');
    expect(existsSync(path(PLAIN_NAME))).toBe(false);
  });

  it('finishes deleting the old file when the app stopped after the move was recorded', async () => {
    makePlainLedger();
    (await openAtRest(deps())).driver.close();
    makePlainLedger(); // the old file, as if its delete had not happened

    const opened = await openAtRest(deps());

    expect(opened.encrypted).toBe(true);
    expect(existsSync(path(PLAIN_NAME))).toBe(false);
  });

  it('keeps using the old file when the copy does not match', async () => {
    makePlainLedger();
    const lossy = deps({
      exportEncrypted: (plain, target, key) => {
        deps().exportEncrypted(plain, target, key);
        const copy = new NodeSqliteDriver(path(target));
        copy.run('DELETE FROM accounts WHERE name = ?', ['SBI']);
        copy.close();
      },
    });

    const opened = await openAtRest(lossy);

    expect(opened.encrypted).toBe(false);
    expect(opened.problem).toMatch(/accounts has \d+ rows, the copy \d+/);
    expect(accountNames(opened.driver)).toContain('SBI');
    expect(existsSync(path(ENCRYPTED_NAME))).toBe(false);
    expect(items.has(DONE_ITEM)).toBe(false);
  });

  it('keeps using the old file when the copy fails', async () => {
    makePlainLedger();

    const opened = await openAtRest(
      deps({
        exportEncrypted: () => {
          throw new Error('disk full');
        },
      })
    );

    expect(opened.encrypted).toBe(false);
    expect(opened.problem).toContain('disk full');
    expect(accountNames(opened.driver)).toContain('SBI');
    expect(items.has(DONE_ITEM)).toBe(false);
  });

  it('uses the old file on a build without SQLCipher, and refuses once the data is encrypted', async () => {
    makePlainLedger();
    const plainOnly = await openAtRest(deps({ cipherAvailable: false }));
    expect(plainOnly.encrypted).toBe(false);
    expect(accountNames(plainOnly.driver)).toContain('SBI');
    plainOnly.driver.close();

    (await openAtRest(deps())).driver.close();

    await expect(openAtRest(deps({ cipherAvailable: false }))).rejects.toThrow(/cannot open it/);
  });

  it('never replaces encrypted data when its key is gone', async () => {
    makePlainLedger();
    (await openAtRest(deps())).driver.close();
    items.delete(KEY_ITEM);

    await expect(openAtRest(deps())).rejects.toThrow(/key/);
    expect(existsSync(path(ENCRYPTED_NAME))).toBe(true);
  });

  it('changes nothing when the phone does not keep the key', async () => {
    makePlainLedger();

    await expect(openAtRest(deps({ setItem: async () => undefined }))).rejects.toThrow(/did not keep/);
    expect(existsSync(path(PLAIN_NAME))).toBe(true);
    expect(existsSync(path(ENCRYPTED_NAME))).toBe(false);
  });
});
