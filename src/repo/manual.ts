import { Database, type Account, type JournalEntry } from '@/db/client';
import { INVESTMENT_ACCOUNT_NAME } from '@/db/schema';
import type { Id } from '@/lib/ulid';
import { toUTC, now, shiftDate } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { Paise, subtract, paise } from '@/money/money';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';

export type ManualKind = 'expense' | 'income' | 'investment' | 'transfer';

export type ManualTransaction = {
  kind: ManualKind;
  /** Always positive; the kind decides the direction. */
  amount: Paise;
  /** The user's account the money left or arrived in. */
  accountId: Id;
  /** For a transfer: the account of the user's that the money moved to. */
  toAccountId?: Id;
  description: string;
  occurredAt: string;
  categoryId?: Id;
};

export type ManualError = {
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DATABASE';
  message: string;
};

const DEFAULT_CATEGORY: Record<ManualKind, Id | undefined> = {
  income: 'cat_salary' as Id,
  investment: 'cat_investment' as Id,
  transfer: 'cat_transfers' as Id,
  expense: undefined,
};

const invalid = (message: string): Result<never, ManualError> =>
  err({ code: 'INVALID_INPUT', message });

/**
 * Where invested money lands. An ordinary asset account the user owns, so it
 * counts towards net worth and shows on the accounts screen, created the
 * first time anything is invested.
 */
export const investmentAccount = (db: Database): Result<Account, ManualError> => {
  const accounts = db.getAllAccounts();
  if (accounts.isErr()) return err({ code: 'DATABASE', message: accounts.error.message });

  const existing = accounts.value.find(
    (a) => !a.isSystem && a.subkind === 'investment' && a.name === INVESTMENT_ACCOUNT_NAME
  );
  if (existing) return ok(existing);

  const created = db.createAccount({
    name: INVESTMENT_ACCOUNT_NAME,
    kind: 'asset',
    subkind: 'investment',
    isSystem: false,
  });

  return created.isOk()
    ? ok(created.value)
    : err({ code: 'DATABASE', message: created.error.message });
};

/**
 * Money the statement does not carry, or has not carried yet: a salary, an
 * investment, a one-off expense. Written as a proper balanced entry, with the
 * input kept as a raw record first like any other source.
 *
 * Investing is recorded as money moving between two of the user's own
 * accounts, not as spending: the rupees still belong to them.
 */
export const recordTransaction = (
  db: Database,
  input: ManualTransaction
): Result<JournalEntry, ManualError> => {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return invalid('Enter an amount above zero');
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.occurredAt)) return invalid('Enter a date');

  const account = db.getAccount(input.accountId).getOrNull();
  if (!account || account.isSystem || account.kind !== 'asset') {
    return err({ code: 'NOT_FOUND', message: 'Choose one of your accounts' });
  }

  if (input.kind === 'transfer') return recordTransfer(db, input, account);

  const description = input.description.trim();
  if (!description) return invalid('Say what this was');

  let counterparty: Id;
  if (input.kind === 'investment') {
    const target = investmentAccount(db);
    if (target.isErr()) return err(target.error);
    if (target.value.id === account.id) {
      return invalid('Choose the account the money came out of');
    }
    counterparty = target.value.id;
  } else {
    counterparty =
      input.kind === 'income'
        ? SYSTEM_ACCOUNT_IDS.UNKNOWN_INCOME
        : SYSTEM_ACCOUNT_IDS.UNKNOWN_EXPENSE;
  }

  const raw = db.saveRawRecord({
    source: 'manual',
    sourceRef: 'manual entry',
    payload: JSON.stringify({ ...input, description }),
  });
  if (raw.isErr()) return err({ code: 'DATABASE', message: raw.error.message });

  const onAccount = input.kind === 'income' ? input.amount : subtract(paise(0), input.amount);

  const entry = db.createJournalEntry(
    {
      occurredAt: input.occurredAt.slice(0, 10),
      description,
      rawId: raw.value.id,
      categoryId: input.categoryId ?? DEFAULT_CATEGORY[input.kind],
      kind: input.kind,
      confidence: 1,
      reviewedAt: toUTC(now()),
    },
    [
      { accountId: account.id, amount: onAccount },
      { accountId: counterparty, amount: subtract(paise(0), onAccount) },
    ]
  );

  return entry.isOk()
    ? ok(entry.value)
    : err({ code: 'DATABASE', message: entry.error.message });
};

/**
 * Money moved between two of the user's own accounts: an ATM run paid back
 * into a wallet, a top-up from one bank to another. Both legs are theirs, so
 * it is never spending or income and net worth does not change.
 */
const recordTransfer = (
  db: Database,
  input: ManualTransaction,
  from: Account
): Result<JournalEntry, ManualError> => {
  const to = input.toAccountId ? db.getAccount(input.toAccountId).getOrNull() : null;
  if (!to || to.isSystem || to.kind !== 'asset') {
    return err({ code: 'NOT_FOUND', message: 'Choose the account it went to' });
  }
  if (to.id === from.id) return invalid('Choose two different accounts');

  const description = input.description.trim() || `Transfer to ${to.name}`;

  const raw = db.saveRawRecord({
    source: 'manual',
    sourceRef: 'manual entry',
    payload: JSON.stringify({ ...input, description }),
  });
  if (raw.isErr()) return err({ code: 'DATABASE', message: raw.error.message });

  const entry = db.createJournalEntry(
    {
      occurredAt: input.occurredAt.slice(0, 10),
      description,
      rawId: raw.value.id,
      categoryId: DEFAULT_CATEGORY.transfer,
      kind: 'transfer',
      confidence: 1,
      reviewedAt: toUTC(now()),
    },
    [
      { accountId: from.id, amount: subtract(paise(0), input.amount) },
      { accountId: to.id, amount: input.amount },
    ]
  );

  return entry.isOk()
    ? ok(entry.value)
    : err({ code: 'DATABASE', message: entry.error.message });
};

export const CASH_ACCOUNT_NAME = 'Cash';

/**
 * Cash in hand. An ATM withdrawal moves money here rather than counting as
 * spending, because the spending happens later, rupee by rupee; the app asks
 * where it went and each answer is an expense from this account.
 */
export const cashAccount = (db: Database): Result<Account, ManualError> => {
  const accounts = db.getAllAccounts();
  if (accounts.isErr()) return err({ code: 'DATABASE', message: accounts.error.message });

  const existing = accounts.value.find(
    (a) => !a.isSystem && a.subkind === 'cash' && a.name === CASH_ACCOUNT_NAME
  );
  if (existing) return ok(existing);

  const created = db.createAccount({
    name: CASH_ACCOUNT_NAME,
    kind: 'asset',
    subkind: 'cash',
    isSystem: false,
  });
  return created.isOk()
    ? ok(created.value)
    : err({ code: 'DATABASE', message: created.error.message });
};

/**
 * "This account holds this much right now": from a balance the user typed,
 * or the "Avl Bal" a bank alert printed. Stored as the balance at the end of
 * the day before, less what already happened today, so the reported balance
 * is exactly this figure now and later payments today still count.
 */
export const setBalanceNow = (
  db: Database,
  accountId: Id,
  balance: Paise,
  date: string,
  rawId?: Id
): Result<void, ManualError> => {
  const day = date.slice(0, 10);
  const [row] =
    db
      .query<{ total: number | null }>(
        `SELECT SUM(p.amount) AS total FROM postings p
         JOIN journal_entries e ON e.id = p.entry_id
         WHERE p.account_id = ? AND substr(e.occurred_at, 1, 10) = ?`,
        [accountId, day]
      )
      .getOrNull() ?? [];
  const anchored = db.recordBalanceAnchor(
    accountId,
    shiftDate(day, -1),
    subtract(balance, paise(row?.total ?? 0)),
    rawId
  );
  return anchored.isOk() ? ok(undefined) : err({ code: 'DATABASE', message: anchored.error.message });
};
