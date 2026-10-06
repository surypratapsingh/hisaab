import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { createRecurring, markRecurringPaid, deleteRecurring, listRecurring, nextOccurrence } from './recurring';
import { paise } from '@/money/money';

describe('nextOccurrence', () => {
  it('steps forward by each cadence', () => {
    expect(nextOccurrence('2026-09-26', 'weekly')).toBe('2026-10-03');
    expect(nextOccurrence('2026-09-26', 'monthly')).toBe('2026-10-26');
    expect(nextOccurrence('2026-09-26', 'quarterly')).toBe('2026-12-26');
    expect(nextOccurrence('2026-09-26', 'half-yearly')).toBe('2027-03-26');
    expect(nextOccurrence('2026-09-26', 'yearly')).toBe('2027-09-26');
  });
});

describe('recurring items', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
  });

  afterEach(() => db.close());

  it('records a reminder with its next due date', () => {
    const item = createRecurring(db, {
      name: 'LIC premium',
      amount: paise(340000),
      cadence: 'yearly',
      nextDue: '2027-01-15',
    }).getOrNull()!;

    expect(item.name).toBe('LIC premium');
    expect(item.nextDue).toBe('2027-01-15');
  });

  it('refuses an unrecognised cadence or a missing date', () => {
    const badCadence = createRecurring(db, {
      name: 'Bad',
      amount: paise(1000),
      // @ts-expect-error testing an invalid cadence on purpose
      cadence: 'daily',
      nextDue: '2027-01-01',
    });
    expect(badCadence.isErr()).toBe(true);

    const badDate = createRecurring(db, {
      name: 'Bad',
      amount: paise(1000),
      cadence: 'monthly',
      nextDue: 'soon',
    });
    expect(badDate.isErr()).toBe(true);
  });

  it('rolls the due date forward once marked paid', () => {
    const item = createRecurring(db, {
      name: 'Netflix + Audible',
      amount: paise(39800),
      cadence: 'monthly',
      nextDue: '2026-09-26',
    }).getOrNull()!;

    const paid = markRecurringPaid(db, item.id).getOrNull()!;
    expect(paid.nextDue).toBe('2026-10-26');
  });

  it('archives instead of deleting', () => {
    const item = createRecurring(db, {
      name: 'Gone',
      amount: paise(1000),
      cadence: 'monthly',
      nextDue: '2026-09-26',
    }).getOrNull()!;

    deleteRecurring(db, item.id);
    expect(listRecurring(db)).toHaveLength(0);
  });

  it('lists soonest due first', () => {
    createRecurring(db, { name: 'Later', amount: paise(1000), cadence: 'monthly', nextDue: '2026-12-01' });
    createRecurring(db, { name: 'Sooner', amount: paise(1000), cadence: 'monthly', nextDue: '2026-10-01' });

    expect(listRecurring(db).map((r) => r.name)).toEqual(['Sooner', 'Later']);
  });
});
