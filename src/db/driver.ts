export type SqlValue = string | number | null;

export type SqlRow = Record<string, SqlValue>;

/**
 * The narrow slice of SQLite the ledger needs.
 *
 * Two adapters implement it: `node:sqlite` under test, and op-sqlite on the
 * device. Everything above this line is plain SQL, so the queries the tests
 * exercise are the queries that run in the app.
 */
export interface SqliteDriver {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): void;
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): T[];
  close(): void;
}

export const one = <T extends SqlRow>(rows: T[]): T | null => rows[0] ?? null;
