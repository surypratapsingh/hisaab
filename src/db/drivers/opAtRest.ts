import { ANDROID_DATABASE_PATH, isSQLCipher } from '@op-engineering/op-sqlite';
import { getRandomBytes } from 'expo-crypto';
import { File } from 'expo-file-system';
import { openAtRest, type AtRestDeps, type AtRestOpened } from '../atRest';
import type { SqliteDriver } from '../driver';
import { OpSqliteDriver } from './op';

type SecureStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

const folder = ANDROID_DATABASE_PATH.endsWith('/') ? ANDROID_DATABASE_PATH : `${ANDROID_DATABASE_PATH}/`;
const file = (name: string) => new File(`file://${folder}${name}`);
const quoted = (text: string) => `'${text.replace(/'/g, "''")}'`;

// SQLCipher's own copy: every table, index and trigger, written encrypted with `key`.
// The user_version is not part of it, so it is carried over by hand.
const exportEncrypted = (plain: SqliteDriver, target: string, key: string) => {
  const version = Number(plain.all<{ user_version: number }>('PRAGMA user_version')[0]?.user_version ?? 0);
  plain.run('PRAGMA foreign_keys = OFF');
  plain.run(`ATTACH DATABASE ${quoted(`${folder}${target}`)} AS enc KEY ${quoted(key)}`);
  try {
    plain.all("SELECT sqlcipher_export('enc')");
    plain.run(`PRAGMA enc.user_version = ${version}`);
  } finally {
    plain.run('DETACH DATABASE enc');
  }
};

/** Opens the ledger file on the phone, encrypted with a key kept in the Android Keystore. */
export const openLedgerFile = async (onMoving?: () => void): Promise<AtRestOpened> => {
  const cipherAvailable = isSQLCipher();
  // Loaded only on a build that has it: an older development build loading new code has neither.
  const store: SecureStore | null = cipherAvailable ? require('expo-secure-store') : null;

  const deps: AtRestDeps = {
    cipherAvailable,
    exists: (name) => file(name).exists,
    remove: (name) => {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const f = file(name + suffix);
        if (f.exists) f.delete();
      }
    },
    open: (name, key) => new OpSqliteDriver({ name, ...(key !== undefined && { encryptionKey: key }) }),
    exportEncrypted,
    getItem: (item) => store!.getItemAsync(item),
    setItem: (item, value) => store!.setItemAsync(item, value),
    onMoving: async () => {
      onMoving?.();
      // The copy blocks the JS thread; give the screen a moment to show why first.
      await new Promise((resolve) => setTimeout(resolve, 80));
    },
    newKey: () => Array.from(getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
  return openAtRest(deps);
};
