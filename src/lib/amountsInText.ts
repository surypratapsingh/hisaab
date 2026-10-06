import { paise, type Paise } from '@/money/money';

const RUPEES = /Rs\s(\d{1,3}(?:,\d{2,3})*|\d+)\.(\d{2})\b/g;

/**
 * A sentence built by the ledger says "Rs 1,234.50". Rewrites each amount in it with `show`,
 * so the sentence reads like the rest of the app (₹1,234.50) and follows the eye that hides
 * amounts from people nearby.
 */
export const amountsInText = (text: string, show: (amount: Paise) => string): string =>
  text.replace(RUPEES, (_match, whole: string, fraction: string) =>
    show(paise(Number(whole.replace(/,/g, '')) * 100 + Number(fraction)))
  );

const ANY_AMOUNT = /(?:₹|Rs\.?|INR)\s?\d[\d,]*(?:\.\d+)?/gi;

/**
 * Raw message text (a bank alert, an advert) can say "Rs.6,000" or "₹500.00" in any shape. When
 * amounts are hidden, every amount written that way is replaced, so a message list does not give
 * away what the rest of the app is hiding.
 */
export const maskAmountsInMessage = (text: string, mask: string): string => text.replace(ANY_AMOUNT, mask);
