import { createRequire } from 'node:module';
import type { SqliteDriver, SqlRow, SqlValue } from '../driver';

type Statement = {
  run(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

// Vite's builtin list predates node:sqlite and rewrites the specifier to a
// bare "sqlite" it then cannot resolve. Requiring it at runtime keeps the
// module out of the bundler's graph entirely.
const nodeRequire = createRequire(import.meta.url);

const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

/**
 * Test-side driver. Node 22+ ships SQLite in core, so the suite exercises the
 * same SQL the device runs without a native build step.
 */
export class NodeSqliteDriver implements SqliteDriver {
  private db: SqliteDatabase;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: SqlValue[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  all<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  close(): void {
    this.db.close();
  }
}
