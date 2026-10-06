import { Paise, paise, add, sum } from '@/money/money';
import { Id } from '@/lib/ulid';
import { Posting } from '@/db/client';

export type AccountBalance = {
  accountId: Id;
  balance: Paise;
};

export const calculateBalance = (postings: Posting[]): Paise =>
  sum(postings.map((p) => p.amount));

export const calculateBalances = (postings: Posting[]): Map<Id, Paise> => {
  const balances = new Map<Id, Paise>();

  for (const posting of postings) {
    const current = balances.get(posting.accountId) ?? paise(0);
    balances.set(posting.accountId, add(current, posting.amount));
  }

  return balances;
};

export const netBalance = (balances: Map<Id, Paise>): Paise =>
  sum([...balances.values()]);
