import { Database } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise, subtract } from '@/money/money';
import { CASH_ACCOUNT_NAME } from '@/repo/manual';

/** How much cash the user last said they are still carrying. */
export const SETTING_CASH_HELD = 'cash_held_paise';

export type CashView = {
  accountId?: Id;
  /** Everything withdrawn and not yet recorded as spent. */
  balance: Paise;
  /** The part of it the app should ask about. */
  unexplained: Paise;
};

const cashAccountId = (db: Database): Id | undefined =>
  (db.getAllAccounts().getOrNull() ?? []).find(
    (a) => !a.isSystem && a.subkind === 'cash' && a.name === CASH_ACCOUNT_NAME
  )?.id;

/**
 * Cash the app should ask about: what came out of ATMs and has not been
 * recorded as spent, less what the user said is still in their wallet.
 * Spending past that amount means the wallet is lighter than they said, so
 * the held amount never counts for more than the balance.
 */
export const cashView = (db: Database): CashView => {
  const accountId = cashAccountId(db);
  if (!accountId) return { balance: paise(0), unexplained: paise(0) };

  const balance = db.reportedBalance(accountId).getOrNull() ?? paise(0);
  const saidHeld = Number(db.getSetting(SETTING_CASH_HELD).getOrNull() ?? 0);
  const held = paise(Math.min(Math.max(saidHeld, 0), Math.max(balance, 0)));
  return { accountId, balance, unexplained: subtract(balance, held) };
};

/** "I still have it": stop asking about the cash currently in hand. */
export const acknowledgeCash = (db: Database): Result<void, { message: string }> => {
  const { balance } = cashView(db);
  const saved = db.setSetting(SETTING_CASH_HELD, String(Math.max(balance, 0)));
  return saved.isOk() ? ok(undefined) : err({ message: saved.error.message });
};
