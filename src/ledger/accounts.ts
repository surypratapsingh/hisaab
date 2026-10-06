import { Id } from '@/lib/ulid';

export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export type AccountSubkind =
  | 'bank'
  | 'credit_card'
  | 'cash'
  | 'wallet'
  | 'loan'
  | 'investment';

export const ACCOUNT_KINDS = {
  ASSET: 'asset' as const,
  LIABILITY: 'liability' as const,
  INCOME: 'income' as const,
  EXPENSE: 'expense' as const,
  EQUITY: 'equity' as const,
};

export const isDebitAccount = (kind: AccountKind): boolean => {
  return kind === 'asset' || kind === 'expense';
};

export const isCreditAccount = (kind: AccountKind): boolean => {
  return kind === 'liability' || kind === 'income' || kind === 'equity';
};

export const getDefaultDirection = (
  kind: AccountKind
): 'debit' | 'credit' => {
  return isDebitAccount(kind) ? 'debit' : 'credit';
};

export const SYSTEM_ACCOUNT_IDS = {
  SUSPENSE: 'acc_suspense' as Id,
  OPENING_BALANCE: 'acc_opening_balance' as Id,
  CASH: 'acc_cash' as Id,
  UNKNOWN_INCOME: 'acc_unknown_income' as Id,
  UNKNOWN_EXPENSE: 'acc_unknown_expense' as Id,
};
