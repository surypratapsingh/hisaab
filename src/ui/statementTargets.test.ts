import { describe, it, expect } from 'vitest';
import { needsAccountChoice, statementTargets } from './statementTargets';
import { paise } from '@/money/money';
import type { AccountItem } from './screens/AccountsScreen';

const account = (name: string, takesStatements: boolean | undefined): AccountItem => ({
  id: name,
  name,
  balance: paise(0),
  takesStatements,
});

describe('which accounts a CSV statement could belong to', () => {
  it('asks only when more than one account takes statements', () => {
    expect(needsAccountChoice([])).toBe(false);
    expect(needsAccountChoice([account('SBI', true)])).toBe(false);
    expect(needsAccountChoice([account('SBI', true), account('HDFC', true)])).toBe(true);
  });

  it('leaves out investments, cash, and accounts with no flag', () => {
    const accounts = [account('SBI', true), account('Zerodha', false), account('Wallet', undefined), account('HDFC', true)];
    expect(statementTargets(accounts).map((a) => a.name)).toEqual(['SBI', 'HDFC']);
    expect(needsAccountChoice([account('SBI', true), account('Zerodha', false)])).toBe(false);
  });
});
