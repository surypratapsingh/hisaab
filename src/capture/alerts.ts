import { Paise, paise } from '@/money/money';
import { parseDecimal } from '@/lib/decimal';

/**
 * A bank or UPI alert, as the notification listener caught it. Nothing here
 * ever leaves the phone; the text is kept as a raw record before parsing.
 */
export type CapturedAlert = {
  /** The app that posted it: an SMS app, a bank app, GPay, PhonePe… */
  app: string;
  title?: string;
  text: string;
  /** When the phone showed it, ISO 8601. */
  postedAt: string;
  /** Who sent an SMS ("VM-HDFCBK", or a phone number): helps spot scams. */
  sender?: string;
};

export type ParsedAlert = {
  amount: Paise;
  direction: 'debit' | 'credit';
  /** The account's last digits as the alert printed them (3 or 4). */
  accountDigits?: string;
  /** Who the money went to or came from, as written. */
  counterparty?: string;
  /** UPI/IMPS/NEFT reference, used to spot the same alert posted twice. */
  reference?: string;
  /** Available balance after the transaction, when the bank says it. */
  balance?: Paise;
  /** Cash taken out: the app should ask where it went. */
  cashWithdrawal: boolean;
  /** Taken by an autopay: a subscription, whatever the payee. */
  autopay?: boolean;
};

/** Messages that mention money without moving any. */
const NOT_A_TRANSACTION = [
  /\bOTP\b|one[\s-]time password|verification code/i,
  /pre-?approved|eligible for|offer|cashback of up to|apply now|loan of/i,
  /will be (debited|deducted)|is due|due (on|by|date)|payment reminder|bill of .* generated/i,
  /\b(failed|declined|unsuccessful|could not be processed)\b/i,
  /requested (money|rs|inr|₹)|collect request|has requested/i,
  /\bmandate\b.*\b(created|registered|set ?up)\b/i,
];

// Union Bank writes "Rs:80.00".
const AMOUNT = /(?:rs|inr|₹)\s*[.:]?\s*([\d,]+(?:\.\d{1,2})?)/i;
// SBI's UPI alerts leave the currency out: "A/C X5678 debited by 299.0".
const BARE_AMOUNT = /\b(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d{1,2})?)\b/i;

const DEBIT = /\b(debited|spent|paid|sent|withdrawn|withdrawal|purchase|transferred to|dr\.?)\b/i;
const CREDIT = /\b(credited|received|deposited|refund(ed)?|reversed|cr\.?)\b/i;

// SBI prints six digits ("Acc No. XXXXX987702"); the last four are the ones
// the user knows, so a longer run is cut to its last four.
const ACCOUNT = /\b(?:a\/c|acct|acc|account|ac|card)\b(?:\s*no\.?)?[\s:]*(?:ending\s*(?:with\s*)?)?[x*.]*\s*(\d{3,18})\b/i;

/** "Never share OTP/PIN/CVV" is a bank's safety footer, not an OTP. */
const SAFETY_FOOTER = /\b(?:never|do not|don'?t|pls do not|please do not)\s+share\s+(?:your\s+)?(?:otp|pin|cvv|password)(?:[\s/,]*(?:otp|pin|cvv|password|or|and|with anyone))*/gi;

/** An alert's words on one line, without the parts that mislead a reader. */
export const alertText = (alert: Pick<CapturedAlert, 'title' | 'text'>): string =>
  [alert.title, alert.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(SAFETY_FOOTER, ' ');

const digitsOf = (run: string | undefined): string | undefined =>
  run === undefined ? undefined : run.length > 4 ? run.slice(-4) : run;
// A balance, never a card's "Avl Lmt": available credit is not money held.
const BALANCE = /\b(?:avl|avbl|available|clr|closing)\.?\s*(?:bal|balance)\b[^\d]*?([\d,]+(?:\.\d{1,2})?)/i;
const REFERENCE = /\b(?:utr|ref(?:erence)?(?:\s*no)?|rrn|upi(?:\s*ref)?(?:\s*no)?|txn\s*id)[\s:.#-]*([A-Z0-9]{9,22})\b/i;
const CASH = /\batm\b|cash withdrawal|\bwdl\b|withdrawn\b/i;

const COUNTERPARTY: RegExp[] = [
  // Union Bank: "by Mob Bk ref no …, Fvg: GOPAL Avl Bal" (favouring).
  /\bfvg[:\s]+(.+?)(?=\s+(?:avl|avbl)\b|[.;,]|$)/i,
  /\bto vpa\s+([\w.@-]+)/i,
  /\b(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[\d,.]+\s+)?to\s+(.+?)(?=\s+(?:on|ref|via|using|from|upi|\()|[.;,]|$)/i,
  /\btrf to\s+(.+?)(?=\s+(?:on|ref|refno)|[.;,]|$)/i,
  /;\s*(.+?)\s+credited\b/i,
  /\b(?:[Aa]t|[Tt]o)\s+([A-Z][A-Z0-9 &'.-]{2,40}?)(?=\s+(?:on|On|ref|Ref|via|using|\()|[.;,]|$)/,
  /\bfrom\s+(?!(?:your\s+)?(?:a\/c|acct|account|ac)\b)(.+?)(?=\s+(?:on|ref|via|\()|[.;,]|$)/i,
  // "by Mob Bk" is Union Bank's name for its own app, not who paid.
  /\bby\s+(?!(?:your\s+)?(?:a\/c|acct|account)\b|mob\s*bk\b)(.+?)(?=\s+(?:on|ref|\()|[.;,]|$)/i,
];

const money = (raw: string): Paise | undefined => {
  const value = parseDecimal(raw.replace(/,/g, ''), 2);
  return value === null || value <= 0 ? undefined : paise(value);
};

/**
 * Reads the transaction out of an alert, or null for anything that is not a
 * completed movement of money. Direction is whichever word comes first:
 * ICICI's "Acct XX123 debited for Rs 450; SWIGGY credited" is a debit.
 */
export const parseAlert = (alert: CapturedAlert): ParsedAlert | null => {
  const text = alertText(alert);

  if (NOT_A_TRANSACTION.some((pattern) => pattern.test(text))) return null;

  const amountMatch = text.match(AMOUNT) ?? text.match(BARE_AMOUNT);
  const amount = amountMatch ? money(amountMatch[1]) : undefined;
  if (!amount) return null;

  const debitAt = text.search(DEBIT);
  const creditAt = text.search(CREDIT);
  if (debitAt === -1 && creditAt === -1) return null;
  const direction =
    creditAt === -1 || (debitAt !== -1 && debitAt < creditAt) ? 'debit' : 'credit';

  let counterparty: string | undefined;
  for (const pattern of COUNTERPARTY) {
    const found = text.match(pattern)?.[1]?.trim();
    if (found && !/^(your|a\/c|acct|account)\b/i.test(found)) {
      counterparty = found.replace(/\s+/g, ' ');
      break;
    }
  }

  const balanceMatch = text.match(BALANCE);

  return {
    amount,
    direction,
    accountDigits: digitsOf(text.match(ACCOUNT)?.[1]),
    counterparty,
    reference: text.match(REFERENCE)?.[1],
    balance: balanceMatch ? money(balanceMatch[1]) : undefined,
    cashWithdrawal: direction === 'debit' && CASH.test(text),
  };
};
