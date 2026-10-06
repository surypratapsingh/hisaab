export const ACTIVITY_FILTERS = ['All', 'Income', 'Expense', 'Transfers'] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

type Row = { amount: number; kind?: string };

/** Money moved between the user's own accounts, or into an investment: neither earned nor spent. */
export const isMovement = (row: Row): boolean => row.kind === 'transfer' || row.kind === 'investment';

/**
 * Which of Activity's four views a row belongs in. Income and Expense never
 * include a transfer or an investment, the same rule Reports and Home use, so
 * moving money between your own accounts is not counted as spending.
 */
export const fitsFilter = (row: Row, filter: ActivityFilter): boolean => {
  if (filter === 'All') return true;
  if (filter === 'Transfers') return isMovement(row);
  if (isMovement(row)) return false;
  return filter === 'Income' ? row.amount > 0 : row.amount < 0;
};
