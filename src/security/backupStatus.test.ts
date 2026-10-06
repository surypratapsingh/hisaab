import { describe, it, expect } from 'vitest';
import { shiftDate, isoDate } from '@/lib/date';
import { backupStatus, NUDGE_AFTER_DAYS } from './backupStatus';

const today = new Date(2026, 8, 27, 15); // 27 Sep 2026

describe('backupStatus', () => {
  it('asks when there is data and it has never been backed up', () => {
    expect(backupStatus(undefined, undefined, true, today)).toEqual({
      label: 'No backup yet',
      sentence: 'Nothing has been backed up yet.',
      due: true,
    });
  });

  it('does not ask about an empty ledger', () => {
    expect(backupStatus(undefined, undefined, false, today).due).toBe(false);
  });

  it('names how long ago in plain words', () => {
    expect(backupStatus('2026-09-27', undefined, true, today).label).toBe('Today');
    expect(backupStatus('2026-09-26', undefined, true, today).label).toBe('Yesterday');
    expect(backupStatus('2026-09-18', undefined, true, today).label).toBe('9 days ago');
    expect(backupStatus('2026-09-18', undefined, true, today).sentence).toBe('Last backup: 9 days ago.');
  });

  it('stays quiet until a fortnight has passed', () => {
    expect(backupStatus('2026-09-14', undefined, true, today).due).toBe(false); // 13 days
    expect(backupStatus('2026-09-13', undefined, true, today).due).toBe(true); // 14 days
    expect(NUDGE_AFTER_DAYS).toBe(14);
  });

  it('counts calendar days across a month and a year end', () => {
    expect(backupStatus('2026-08-31', undefined, true, today).label).toBe('27 days ago');
    expect(backupStatus('2025-12-31', undefined, true, new Date(2026, 0, 2)).label).toBe('2 days ago');
  });

  it('keeps quiet after "Later" until the day it names, then asks again', () => {
    expect(backupStatus(undefined, '2026-10-04', true, today).due).toBe(false);
    expect(backupStatus(undefined, '2026-09-28', true, today).due).toBe(false);
    expect(backupStatus(undefined, '2026-09-27', true, today).due).toBe(true);
  });

  it('adds days across month ends', () => {
    expect(shiftDate('2026-09-27', 7)).toBe('2026-10-04');
    expect(shiftDate('2026-12-30', 3)).toBe('2027-01-02');
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
