import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { createGoal, contributeToGoal, editGoal, deleteGoal, listGoals } from './goals';
import { format, paise } from '@/money/money';

describe('goals', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
  });

  afterEach(() => db.close());

  it('starts a goal at zero saved', () => {
    const goal = createGoal(db, { name: 'Emergency fund', targetAmount: paise(50000000) }).getOrNull()!;
    expect(format(goal.savedAmount)).toBe('Rs 0.00');
    expect(goal.targetDate).toBeUndefined();
  });

  it('refuses a target of zero or less', () => {
    const result = createGoal(db, { name: 'Bad goal', targetAmount: paise(0) });
    expect(result.isErr()).toBe(true);
  });

  it('adds to what has been saved, without touching the target', () => {
    const goal = createGoal(db, { name: 'Education', targetAmount: paise(70000000), targetDate: '2027-04-01' }).getOrNull()!;
    contributeToGoal(db, goal.id, paise(1000000));
    const after = contributeToGoal(db, goal.id, paise(500000)).getOrNull()!;

    expect(format(after.savedAmount)).toBe('Rs 15,000.00');
    expect(format(after.targetAmount)).toBe('Rs 7,00,000.00');
  });

  it('never lets saved go below zero', () => {
    const goal = createGoal(db, { name: 'Trip', targetAmount: paise(100000) }).getOrNull()!;
    const after = contributeToGoal(db, goal.id, paise(-500)).getOrNull()!;
    expect(format(after.savedAmount)).toBe('Rs 0.00');
  });

  it('edits the target amount and date', () => {
    const goal = createGoal(db, { name: 'Car', targetAmount: paise(100000) }).getOrNull()!;
    const edited = editGoal(db, goal.id, { targetAmount: paise(200000), targetDate: '2028-01-01' }).getOrNull()!;
    expect(format(edited.targetAmount)).toBe('Rs 2,000.00');
    expect(edited.targetDate).toBe('2028-01-01');
  });

  it('archives a goal instead of deleting its history', () => {
    const goal = createGoal(db, { name: 'Gone', targetAmount: paise(100000) }).getOrNull()!;
    deleteGoal(db, goal.id);
    expect(listGoals(db)).toHaveLength(0);
    const [row] = db.query<{ archived_at: string | null }>(`SELECT archived_at FROM goals WHERE id = ?`, [goal.id]).getOrNull()!;
    expect(row.archived_at).not.toBeNull();
  });

  it('lists goals soonest deadline first, undated goals last', () => {
    createGoal(db, { name: 'No date', targetAmount: paise(100000) });
    createGoal(db, { name: 'Later', targetAmount: paise(100000), targetDate: '2027-06-01' });
    createGoal(db, { name: 'Sooner', targetAmount: paise(100000), targetDate: '2026-12-01' });

    expect(listGoals(db).map((g) => g.name)).toEqual(['Sooner', 'Later', 'No date']);
  });
});
