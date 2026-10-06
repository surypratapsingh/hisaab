import { open, type DB } from '@op-engineering/op-sqlite';
import type { SqliteDriver, SqlRow, SqlValue } from '../driver';
import { splitStatements } from '../statements';

export type OpSqliteOptions = {
  name?: string;
  location?: string;
  /** SQLCipher key. Without it the database file is stored in the clear. */
  encryptionKey?: string;
};

/**
 * Device-side driver. op-sqlite is a native module, so it only resolves inside
 * a development or release build — never in Expo Go, and never under vitest.
 * The Node driver covers the test side against the same SQL.
 */
export class OpSqliteDriver implements SqliteDriver {
  private db: DB;

  constructor(options: OpSqliteOptions = {}) {
    // The native side reads every key it is given as a string, so an absent
    // option must be left out entirely; `location: undefined` crashes open().
    this.db = open({
      name: options.name ?? 'money.db',
      ...(options.location !== undefined && { location: options.location }),
      ...(options.encryptionKey !== undefined && { encryptionKey: options.encryptionKey }),
    });
  }

  exec(sql: string): void {
    for (const statement of splitStatements(sql)) {
      this.db.executeSync(statement);
    }
  }

  run(sql: string, params: SqlValue[] = []): void {
    this.db.executeSync(sql, params);
  }

  all<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): T[] {
    return (this.db.executeSync(sql, params).rows ?? []) as T[];
  }

  close(): void {
    this.db.close();
  }
}
