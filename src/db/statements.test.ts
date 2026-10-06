import { describe, it, expect } from 'vitest';
import { splitStatements } from './statements';
import { SCHEMA_SQL } from './schema';
import { NodeSqliteDriver } from './drivers/node';

describe('splitStatements', () => {
  it('splits plain statements on the semicolon', () => {
    const parts = splitStatements('SELECT 1;\nSELECT 2;');
    expect(parts).toHaveLength(2);
  });

  it('drops comments and blank lines', () => {
    const parts = splitStatements('-- a comment\n\nSELECT 1;');
    expect(parts).toEqual(['SELECT 1;']);
  });

  it('keeps a trigger body together despite its inner semicolons', () => {
    const sql = `
CREATE TABLE t (a INTEGER);

CREATE TRIGGER guard
BEFORE INSERT ON t
FOR EACH ROW
WHEN NEW.a < 0
BEGIN
  SELECT RAISE(ABORT, 'no negatives');
END;

CREATE INDEX idx ON t(a);
`;

    const parts = splitStatements(sql);

    expect(parts).toHaveLength(3);
    expect(parts[1]).toContain('RAISE(ABORT');
    expect(parts[1].trimEnd().endsWith('END;')).toBe(true);
    expect(parts[2]).toContain('CREATE INDEX');
  });

  it('splits the real schema into individually runnable statements', () => {
    const parts = splitStatements(SCHEMA_SQL);
    expect(parts.length).toBeGreaterThan(10);

    // Every trigger must have survived as one piece.
    const triggers = parts.filter((p) => /CREATE TRIGGER/i.test(p));
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) {
      expect(trigger.trimEnd().endsWith('END;')).toBe(true);
    }
  });

  it('produces statements SQLite accepts one at a time', () => {
    // op-sqlite runs one statement per call, so this is the shape the device
    // path actually executes.
    const driver = new NodeSqliteDriver();

    for (const statement of splitStatements(SCHEMA_SQL)) {
      expect(() => driver.exec(statement)).not.toThrow();
    }

    const tables = driver.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    );
    const names = tables.map((t) => t.name);

    expect(names).toContain('accounts');
    expect(names).toContain('journal_entries');
    expect(names).toContain('postings');
    expect(names).toContain('raw_records');
    expect(names).toContain('merchants');
    expect(names).toContain('merchant_patterns');
    expect(names).toContain('categories');

    driver.close();
  });
});
