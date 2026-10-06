import type { AccountItem } from './screens/AccountsScreen';

/**
 * The accounts a CSV statement could belong to. A CSV carries no account number, so with
 * more than one the user has to say which; with one there is nothing to ask.
 */
export const statementTargets = (accounts: AccountItem[]): AccountItem[] =>
  accounts.filter((a) => a.takesStatements);

export const needsAccountChoice = (accounts: AccountItem[]): boolean => statementTargets(accounts).length > 1;
