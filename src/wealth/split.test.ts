import { describe, it, expect } from 'vitest';
import { paise, sum } from '@/money/money';
import type { Id } from '@/lib/ulid';
import type { WealthPart, WealthView } from './repo';
import { wealthSplit } from './split';

const part = (kind: WealthPart['kind'], rupees: number, unknown?: boolean): WealthPart => ({
  accountId: `acc_${kind}_${rupees}` as Id,
  name: kind,
  kind,
  value: paise(rupees * 100),
  holdings: [],
  unknown,
});

const viewOf = (parts: WealthPart[]): WealthView => ({
  total: sum(parts.filter((p) => !p.unknown).map((p) => p.value)),
  parts,
});

describe('wealth split under the total', () => {
  it('groups banks with cash, and keeps investments apart', () => {
    const split = wealthSplit(viewOf([part('bank', 1000), part('cash', 200), part('investment', 5000), part('other', 30)]));
    expect(split).toEqual({ bankAndCash: paise(120000), investments: paise(500000), other: paise(3000) });
  });

  it('leaves out a bank balance nobody has told us, like the total does', () => {
    const wealth = viewOf([part('bank', 1000), part('bank', 777, true)]);
    const split = wealthSplit(wealth);
    expect(split.bankAndCash).toBe(paise(100000));
    expect(sum([split.bankAndCash, split.investments, split.other])).toBe(wealth.total);
  });

  it('is zero everywhere when nothing is tracked', () => {
    expect(wealthSplit(viewOf([]))).toEqual({ bankAndCash: paise(0), investments: paise(0), other: paise(0) });
  });
});
