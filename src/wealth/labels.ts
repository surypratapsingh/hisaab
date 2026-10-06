import { shortDate } from '@/lib/date';
import type { WealthPart } from './repo';

/**
 * Where a figure comes from and how fresh it is, in a line: "CAMS · as of 25 Sep"
 * for a fund, "Statement balance as of 27 Sep, plus what came after" for a bank.
 * A balance nobody has told us says so instead of showing a stale number as if known.
 */
export const asOfLine = (part: WealthPart): string => {
  if (part.excluded) return 'Not counted in totals';
  if (part.unknown) return 'Balance not known yet';
  if (part.kind === 'investment' && part.source && part.asOf) {
    return `${part.source} · as of ${shortDate(part.asOf)}`;
  }
  if (part.asOf) return `Statement balance as of ${shortDate(part.asOf)}, plus what came after`;
  if (part.kind === 'cash') return 'Cash taken out and not yet spent';
  return 'From what you have recorded';
};
