/**
 * Parses a decimal string into an integer scaled by 10^decimals, exactly.
 *
 * "1,234.56" at 2 decimals is 123456. No floating point is involved, so a
 * value like "0.1" cannot drift the way 0.1 * 100 does. Extra fraction digits
 * round half away from zero. Returns null for anything that is not a plain
 * decimal number.
 */
export const parseDecimal = (raw: string, decimals: number): number | null => {
  const cleaned = raw.trim().replace(/,/g, '');
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return null;

  const kept = fraction.slice(0, decimals).padEnd(decimals, '0');
  const next = fraction.charAt(decimals);

  let value = Number(whole || '0') * 10 ** decimals + Number(kept || '0');
  if (next !== '' && Number(next) >= 5) value += 1;

  if (!Number.isSafeInteger(value)) return null;

  return sign === '-' && value !== 0 ? -value : value;
};
