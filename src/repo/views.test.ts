import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { recordTransaction } from '@/repo/manual';
import { dayLabel, monthSummary } from './views';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';

describe('monthSummary', () => {
  let db: Database;
  let bank: Id;

  const spend = (rupees: number, date: string) =>
    recordTransaction(db, { kind: 'expense', amount: paise(rupees * 100), accountId: bank, description: 'x', occurredAt: date });

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db.createAccount({ name: 'Bank', kind: 'asset', last4: '1234', isSystem: false }).getOrNull()!.id;
    spend(100, '2026-08-05');
    spend(900, '2026-08-20');
    spend(50, '2026-08-31');
  });

  afterEach(() => db.close());

  const august = new Date(2026, 7, 15);

  it('covers the whole month by default', () => {
    expect(format(monthSummary(db, august).spent)).toBe('Rs 1,050.00');
  });

  it('can stop at a day of the month, so this month so far meets the same days of last month', () => {
    expect(format(monthSummary(db, august, 10).spent)).toBe('Rs 100.00');
    expect(format(monthSummary(db, august, 5).spent)).toBe('Rs 100.00'); // the day itself counts
    expect(format(monthSummary(db, august, 4).spent)).toBe('Rs 0.00');
  });

  it('clamps a day past the end of a shorter month', () => {
    // 31 Aug is a real day, but a 30-day month asked for the 31st just means all of it.
    expect(format(monthSummary(db, august, 31).spent)).toBe('Rs 1,050.00');
    const september = new Date(2026, 8, 15);
    spend(70, '2026-09-30');
    expect(format(monthSummary(db, september, 31).spent)).toBe('Rs 70.00');
  });
});

describe('dayLabel', () => {
  it('names a day the way the rest of the app does', () => {
    const today = new Date(2026, 9, 5, 9, 0);
    expect(dayLabel('2026-10-05', today)).toBe('Today');
    expect(dayLabel('2026-10-02', today)).toBe('2 Oct 2026');
    expect(dayLabel('2025-12-31', today)).toBe('31 Dec 2025');
  });
});
