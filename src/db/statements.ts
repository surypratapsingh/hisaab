/**
 * Splits a SQL blob on statement boundaries, keeping `BEGIN ... END` trigger
 * bodies intact — their inner semicolons do not end the statement.
 *
 * op-sqlite executes one statement per call, so the schema has to be split
 * before it reaches the device. This lives apart from the driver so the logic
 * stays testable without loading the native module.
 */
export const splitStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let inTriggerBody = false;

  for (const rawLine of sql.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;

    current += line + '\n';

    if (!inTriggerBody && /\bBEGIN\b/i.test(line) && /CREATE\s+TRIGGER/i.test(current)) {
      inTriggerBody = true;
      continue;
    }

    if (inTriggerBody) {
      if (/^END\s*;/i.test(line)) {
        inTriggerBody = false;
        statements.push(current.trim());
        current = '';
      }
      continue;
    }

    if (line.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) statements.push(current.trim());

  return statements;
};
