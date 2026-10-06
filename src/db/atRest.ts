import type { SqliteDriver } from './driver';

/**
 * Opening the ledger encrypted at rest (SQLCipher), and moving an existing
 * unencrypted database into an encrypted one once.
 *
 * The key is 32 random bytes kept in the Android Keystore (through
 * expo-secure-store), never in the database, a backup or the repo.
 *
 * The move never risks the only copy: the old file is deleted only after every
 * table in the encrypted copy has been counted against it and the move has been
 * recorded as done. If the app stops half way, the next start throws away the
 * half-made copy and starts again from the untouched old file. If the copy does
 * not match, the app keeps using the old file and says so.
 *
 * Everything that touches the phone comes in through `AtRestDeps`, so the order
 * of steps is tested under Node; the SQLCipher calls themselves only run on a
 * device (`src/db/drivers/opAtRest.ts`).
 */

export const PLAIN_NAME = 'money.db';
export const ENCRYPTED_NAME = 'money-enc.db';
export const KEY_ITEM = 'moneyos.dbkey';
export const DONE_ITEM = 'moneyos.dbencrypted';

export type AtRestDeps = {
  /** False when the installed build was made without SQLCipher (getItem and setItem are then never called). */
  cipherAvailable: boolean;
  exists(name: string): boolean;
  /** Deletes the database file and its -wal, -shm and -journal files. */
  remove(name: string): void;
  open(name: string, key?: string): SqliteDriver;
  /** Writes every table, index, trigger and the user_version of `plain` into a new encrypted file. */
  exportEncrypted(plain: SqliteDriver, target: string, key: string): void;
  getItem(item: string): Promise<string | null>;
  setItem(item: string, value: string): Promise<void>;
  /** 64 hex characters from a secure random source. */
  newKey(): string;
  /** Called once before the one-time copy starts, so the screen can say so; awaited, so it can draw first. */
  onMoving?(): Promise<void>;
};

export type AtRestOpened = {
  driver: SqliteDriver;
  encrypted: boolean;
  /** Set when the move to an encrypted file was tried and did not finish; the data is safe in the old file. */
  problem?: string;
};

type CountRow = { n: number };
type NameRow = { name: string };
type VersionRow = { user_version: number };

const tables = (db: SqliteDriver): string[] =>
  db
    .all<NameRow>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => row.name);

const schemaSize = (db: SqliteDriver): number =>
  db.all<CountRow>("SELECT count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")[0]?.n ?? 0;

const userVersion = (db: SqliteDriver): number => db.all<VersionRow>('PRAGMA user_version')[0]?.user_version ?? 0;

/** The first difference between the two databases, or null when every table holds the same number of rows. */
export const firstDifference = (plain: SqliteDriver, copy: SqliteDriver): string | null => {
  if (userVersion(plain) !== userVersion(copy)) return 'schema version differs';
  if (schemaSize(plain) !== schemaSize(copy)) return 'tables, indexes or triggers differ';
  const names = tables(plain);
  if (names.join('\n') !== tables(copy).join('\n')) return 'table names differ';
  for (const name of names) {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const a = plain.all<CountRow>(`SELECT count(*) AS n FROM ${quoted}`)[0]?.n;
    const b = copy.all<CountRow>(`SELECT count(*) AS n FROM ${quoted}`)[0]?.n;
    if (a !== b) return `${name} has ${a} rows, the copy ${b}`;
  }
  return null;
};

const hasTables = (db: SqliteDriver): boolean => tables(db).length > 0;

export const openAtRest = async (deps: AtRestDeps): Promise<AtRestOpened> => {
  if (!deps.cipherAvailable) {
    // A development build made before SQLCipher was switched on, still loading new code. It has
    // no key store either, so the files tell: the old file is whole until the move deletes it.
    if (deps.exists(ENCRYPTED_NAME) && !deps.exists(PLAIN_NAME)) {
      throw new Error('Your data is encrypted, and this build of Hisaab cannot open it. Install the latest build.');
    }
    return { driver: deps.open(PLAIN_NAME), encrypted: false };
  }

  const done = (await deps.getItem(DONE_ITEM)) === 'yes';
  let key = await deps.getItem(KEY_ITEM);

  if (done) {
    if (!key) throw new Error('The key to your encrypted data is missing from this phone. Restore from a backup.');
    if (!deps.exists(ENCRYPTED_NAME)) {
      throw new Error('Your encrypted data file is missing. Restore from a backup.');
    }
    const driver = deps.open(ENCRYPTED_NAME, key);
    tables(driver); // Fails here, not later, if the key does not open the file.
    // The old file is left over only if the app stopped between recording the move and deleting it.
    if (deps.exists(PLAIN_NAME)) deps.remove(PLAIN_NAME);
    return { driver, encrypted: true };
  }

  if (!key) {
    const made = deps.newKey();
    await deps.setItem(KEY_ITEM, made);
    key = await deps.getItem(KEY_ITEM);
    if (key !== made) throw new Error('This phone did not keep the database key. Nothing was changed.');
  }

  // A half-made copy from a move that stopped part way.
  if (deps.exists(ENCRYPTED_NAME)) deps.remove(ENCRYPTED_NAME);

  if (deps.exists(PLAIN_NAME)) {
    const plain = deps.open(PLAIN_NAME);
    if (hasTables(plain)) {
      let copy: SqliteDriver | undefined;
      let problem: string | null;
      try {
        await deps.onMoving?.();
        deps.exportEncrypted(plain, ENCRYPTED_NAME, key);
        copy = deps.open(ENCRYPTED_NAME, key);
        problem = firstDifference(plain, copy);
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
      }
      if (problem !== null) {
        copy?.close();
        if (deps.exists(ENCRYPTED_NAME)) deps.remove(ENCRYPTED_NAME);
        return {
          driver: plain,
          encrypted: false,
          problem: `Your data could not be moved to an encrypted file (${problem}). It is unchanged and still works.`,
        };
      }
      await deps.setItem(DONE_ITEM, 'yes');
      plain.close();
      deps.remove(PLAIN_NAME);
      return { driver: copy!, encrypted: true };
    }
    // An empty file (first start of a build that had not yet created tables).
    plain.close();
    deps.remove(PLAIN_NAME);
  }

  const driver = deps.open(ENCRYPTED_NAME, key);
  await deps.setItem(DONE_ITEM, 'yes');
  return { driver, encrypted: true };
};
