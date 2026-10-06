import { format, type Paise } from '@/money/money';

/**
 * "₹5,72,649" from the ledger's "Rs 5,72,649.00". Paise are shown when there
 * are any (never rounded away), or always with { paise: true }.
 */
export const rupees = (amount: Paise, options: { paise?: boolean } = {}): string => {
  const text = format(amount).replace('Rs ', '₹');
  return options.paise ? text : text.replace(/\.00$/, '');
};
