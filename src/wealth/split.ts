import { Paise, sum } from '@/money/money';
import type { WealthView, WealthPart } from './repo';

export type WealthSplit = {
  /** Known bank balances plus cash in hand. */
  bankAndCash: Paise;
  investments: Paise;
  /** Anything else the user tracks; zero when there is nothing. */
  other: Paise;
};

/**
 * The total wealth, cut into the three groups Home shows under it. A bank
 * account whose balance was never told is left out, exactly as `total` leaves
 * it out, so the three always add up to the figure above them.
 */
export const wealthSplit = (wealth: WealthView): WealthSplit => {
  const counted = wealth.parts.filter((p) => !p.unknown && !p.excluded);
  const of = (...kinds: Array<WealthPart['kind']>): Paise =>
    sum(counted.filter((p) => kinds.includes(p.kind)).map((p) => p.value));
  return { bankAndCash: of('bank', 'cash'), investments: of('investment'), other: of('other') };
};
