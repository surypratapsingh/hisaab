import { Paise, abs, isPositive } from '@/money/money';
import { daysBetween } from '@/lib/date';

export type TransferDetectionResult = {
  isTransfer: boolean;
  counterpartyLastFour?: string;
  confidence: number;
};

/**
 * Phrases that name the user themselves as the counterparty. NEFT, IMPS and
 * RTGS are deliberately absent: they are payment rails, not destinations, and
 * most money sent over them goes to somebody else.
 */
const SELF_REFERENCE = [
  /\bTO\s+SELF\b/i,
  /\bFROM\s+SELF\b/i,
  /\bSELF\s+(TRANSFER|TXN|A\/C)\b/i,
  /\bOWN\s+(ACCOUNT|ACC|A\/C)\b/i,
];

/**
 * A transfer is money moving between two accounts the same person owns.
 *
 * Detection needs evidence of that, not merely the word "transfer": a salary
 * credited as "SALARY TRANSFER FROM EMPLOYER" is income, and counting it as a
 * transfer would erase it from what the user earned. So a match requires
 * either one of their own account numbers in the narration, or wording that
 * names them as both sides.
 */
export const detectTransfer = (
  narration: string,
  otherAccounts: Array<{ last4: string; id: string }>
): TransferDetectionResult => {
  for (const account of otherAccounts) {
    if (new RegExp(`\\b${account.last4}\\b`).test(narration)) {
      return {
        isTransfer: true,
        counterpartyLastFour: account.last4,
        confidence: 1,
      };
    }
  }

  if (SELF_REFERENCE.some((pattern) => pattern.test(narration))) {
    return { isTransfer: true, confidence: 0.8 };
  }

  return { isTransfer: false, confidence: 0 };
};

/**
 * The other half of the rule: the same amount leaving one owned account and
 * arriving in another within three days is one movement, not two.
 */
export const matchTransferPair = (
  debitEntry: { amount: Paise; date: string; narration: string },
  creditEntry: { amount: Paise; date: string; narration: string }
): boolean => {
  if (abs(debitEntry.amount) !== abs(creditEntry.amount)) return false;

  if (isPositive(debitEntry.amount) === isPositive(creditEntry.amount)) {
    return false;
  }

  const days = daysBetween(new Date(debitEntry.date), new Date(creditEntry.date));
  return Math.abs(days) <= 3;
};
