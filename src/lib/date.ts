export const now = (): Date => new Date();

export const toUTC = (date: Date): string => {
  return date.toISOString();
};

/**
 * The calendar date as the user sees it, as YYYY-MM-DD.
 *
 * Not toISOString(): that converts to UTC first, and in India (UTC+5:30) local
 * midnight on the 1st is still the previous day in UTC, so month ranges built
 * that way silently pull in the last day of the month before.
 */
export const isoDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * First and last moment of the month containing `date`, as strings that
 * compare correctly against both plain dates and full timestamps.
 */
export const monthRange = (date: Date): { from: string; to: string } => ({
  from: isoDate(startOfMonth(date)),
  to: `${isoDate(endOfMonth(date))}T23:59:59.999`,
});

/**
 * Reads YYYY-MM-DD as that calendar day in local time. new Date('2026-09-15')
 * is UTC midnight instead, which lands on the 14th anywhere west of Greenwich.
 */
export const localDate = (iso: string): Date =>
  new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** A calendar date moved by whole days, as YYYY-MM-DD. */
export const shiftDate = (iso: string, days: number): string =>
  isoDate(addDays(localDate(iso), days));

/** Two-digit month from a lower-case three-letter name: 'sep' to '09'. */
export const MONTH_NUMBER: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "1 Oct" from 2026-10-01. Built by hand so it reads the same on every phone. */
export const shortDate = (iso: string): string =>
  `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]?.slice(0, 3)}`;

/** "Oct 2026" from 2026-10-01, likewise built by hand. */
export const monthYear = (iso: string): string =>
  `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]?.slice(0, 3)} ${iso.slice(0, 4)}`;

export const previousMonth = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth() - 1, 15);

export const startOfMonth = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

export const endOfMonth = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
};

export const addDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

export const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  // 31 January plus a month is the last day of February, not 3 March.
  if (d.getDate() !== date.getDate()) d.setDate(0);
  return d;
};

export const daysBetween = (start: Date, end: Date): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
};

/** "29 Sep 2026" from 2026-09-29 or a full timestamp, built by hand so it reads the same on every phone. */
export const dateWithYear = (iso: string): string => `${shortDate(iso)} ${iso.slice(0, 4)}`;

/** "1 Aug to 31 Aug 2026"; both years when they differ; one date when they are the same day. */
export const datePeriod = (from: string, to: string): string =>
  from.slice(0, 10) === to.slice(0, 10)
    ? dateWithYear(to)
    : from.slice(0, 4) === to.slice(0, 4)
      ? `${shortDate(from)} to ${dateWithYear(to)}`
      : `${dateWithYear(from)} to ${dateWithYear(to)}`;
