import { Paise, paise } from '@/money/money';
import { parseDecimal } from '@/lib/decimal';
import { parseAlert, alertText, type CapturedAlert, type ParsedAlert } from './alerts';

/**
 * What a message is, decided on the phone with no network: a real payment,
 * an autopay mandate to confirm, an OTP, an offer, a scam, a reminder, or
 * something else. Only transactions reach the ledger; mandates ask the user.
 */
export type MessageKind = 'transaction' | 'mandate' | 'otp' | 'offer' | 'scam' | 'reminder' | 'info';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly' | 'as presented';

export type Mandate = {
  /** Who will be paid: "Netflix", "BSE STAR MF". */
  payee: string;
  amount?: Paise;
  /** The mandate caps the amount ("up to Rs 10,000") rather than fixing it. */
  upTo: boolean;
  frequency?: Frequency;
  /** The bank says the autopay was cancelled, not set up. */
  revoked?: boolean;
};

export type SortedMessage = {
  kind: MessageKind;
  /** Why, in words, for the Messages screen. */
  reason: string;
  alert?: ParsedAlert;
  mandate?: Mandate;
};

const OTP = /\bOTP\b|one[\s-]time password|verification code|\bpasscode\b/i;

const LINK = /https?:\/\/|www\.|\b(bit\.ly|tinyurl|cutt\.ly|rb\.gy|t\.me|wa\.me)\b|\.apk\b/i;
const BAIT = /\b(kyc|pan\s*(card)?\s*(update|link)|account\s*(will\s*be\s*)?(blocked|suspended|deactivated|frozen)|verify\s*(your|now)|update\s*(now|immediately)|won|winner|lottery|prize|lucky\s*draw|reward\s*points?\s*(expir|redeem)|electricity\s*(will\s*be\s*)?(disconnect|cut)|refund\s*(is\s*)?pending|claim\s*(now|your))\b/i;
/**
 * What only a fraud says: a threat to your account, or a request to verify. A company's own
 * advert can say "claim now" or "you won a voucher" and still be an advert.
 */
const HARD_BAIT = /\b(kyc|pan\s*(card)?\s*(update|link)|account\s*(will\s*be\s*)?(blocked|suspended|deactivated|frozen)|verify\s*(your|now)|update\s*(now|immediately)|electricity\s*(will\s*be\s*)?(disconnect|cut)|refund\s*(is\s*)?pending)\b/i;
/** A registered promotional sender header ("AD-ARWINF-P"): by regulation, marketing. */
const PROMO_HEADER = /^[A-Z]{2}[A-Z0-9]{6}P$/i;
/** Words that mean a message is about an account, so a promotional header must not hide it. */
const ABOUT_ACCOUNT = /a\/c|account|\bx{2,}\d+|\*{1,}\d{3,}/i;
const BANKISH = /\b(bank|a\/c|account|card|upi|kyc|sbi|hdfc|icici|axis|kotak|paytm)\b/i;
/** A personal phone number as sender. Banks send from short codes such as "VM-HDFCBK". */
const PERSONAL_SENDER = /^\+?(91)?[6-9]\d{9}$/;

const MANDATE = /\b(e-?\s*mandate|mandate|auto\s*-?\s*pay|standing instruction|\bSI\b|recurring payment|nach)\b/i;
// Only these words mean an autopay was set up. "Successfully debited … UPI
// AutoPay" is a payment made by one, and must count as spending.
const MANDATE_SET = /\b(created|registered|set\s*up|setup|activated|approved|registration)\b/i;
const MANDATE_ENDED = /\b(revoked|cancell?ed|paused|deactivated|expired)\b/i;
const MONEY_MOVED = /\b(debited|credited|deducted|paid|sent)\b/i;

// Adverts, including the telecom kind that mention a price: "Recharge with
// Rs. 299 and get 30GB data".
const OFFER = /pre-?approved|eligible for|\boffer\b|cashback of up to|apply now|loan of|limited period|sale\b|% off|flat \d+% |free\b.*\b(delivery|trial)|upgrade your plan|recharge (now|with|for)\b|\b\d+\s*GB\b.*\bdata\b|\bOTTs?\b|\bunlimited (calls|data)\b|\bvalidity\b|\bshop now\b|\bbuy now\b|\bexclusive deal/i;
const REMINDER = /will be (debited|deducted|auto-?debited)|is due|due (on|by|date)|payment reminder|bill of .* generated|renews? on|scheduled (for|on)/i;

const AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;

const FREQUENCIES: Array<[RegExp, Frequency]> = [
  [/\bdaily\b/i, 'daily'],
  [/\bweekly\b/i, 'weekly'],
  [/\bmonthly\b|every month|per month|\bpm\b/i, 'monthly'],
  [/\bquarterly\b/i, 'quarterly'],
  [/half[- ]?yearly/i, 'half-yearly'],
  [/\byearly\b|annual(ly)?|every year/i, 'yearly'],
  [/as\s*(and\s*when\s*)?presented/i, 'as presented'],
];

const PAYEE = [
  /\btowards\s+(.+?)(?=\s+(?:from|for|on|with|via|UPI|of)\b|\s*-|[.,;]|$)/i,
  /\bfor\s+([A-Za-z][\w&.' ]*?)\s+of\s+(?:rs|inr|₹)/i,
  /\b(?:for|towards|to|in favou?r of|with)\s+(?!rs\b|inr\b|₹|your\b|a\/c\b|account\b|the amount\b|up to\b|max)([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/,
  /\b(?:for|towards|to|in favou?r of|with)\s+(?!rs\b|inr\b|₹|your\b|a\/c\b|account\b)([a-z][\w&.'-]+(?:\s+[a-z][\w&.'-]+){0,3})/i,
];

const readMandate = (text: string): Mandate => {
  const amountMatch = text.match(AMOUNT);
  const value = amountMatch ? parseDecimal(amountMatch[1].replace(/,/g, ''), 2) : null;

  let payee: string | undefined;
  for (const pattern of PAYEE) {
    const found = text.match(pattern)?.[1]?.trim();
    const isAmount = found !== undefined && /^(rs\.?|inr|₹)\s*[\d,]/i.test(found);
    if (found && !isAmount && !MANDATE.test(found) && !/^(debit|payment|amount|upi|aspresented)$/i.test(found)) {
      payee = found.replace(/\s+(of|for|with|on|has|is|was|via|using)$/i, '').trim();
      break;
    }
  }

  return {
    payee: payee ?? 'Unknown payee',
    amount: value !== null && value > 0 ? paise(value) : undefined,
    upTo: /\b(up\s*to|upto|max(imum)?|not exceeding|limit)\b/i.test(text),
    frequency: FREQUENCIES.find(([pattern]) => pattern.test(text))?.[1],
    revoked: MANDATE_ENDED.test(text) || undefined,
  };
};

/**
 * A fund house or registrar confirming a purchase. The money left through
 * the bank, whose own message records it; counting this too would double it.
 */
const FUND_CONFIRMATION = /\bfolio\b|\bNAV\b|\bunits?\b.*\ball?ott?ed\b|\bmutual fund\b|\bdemat\b/i;

/**
 * SMS headers of banks and payment banks ("JM-UNIONB-T", "VM-HDFCBK").
 * Anyone else who says "received Rs 3,600" is a shop's receipt: the bank's
 * own message is the payment.
 */
const BANK_SENDER = /UNIONB|SBI(?!MF)|HDFCBK|ICICI|AXIS|KOTAK|PNB|BOI|CANBNK|IDFC|INDUS|YESB|PAYTMB|FEDBNK|RBL|AUBANK|DBS|SCB|CITI|HSBC|BOBTXN|BOBSMS|UCO|IOB|CENTBK|IPB|AIRBNK|JIOPBK|BANK|BNK/i;
/** An SMS header, as opposed to an app's notification (which has no sender). */
const HEADER = /^[A-Z]{2}[A-Z0-9]{6}([A-Z])?$/i;

export const sortMessage = (message: CapturedAlert & { sender?: string }): SortedMessage => {
  const text = alertText(message);
  const sender = (message.sender ?? message.title ?? '').replace(/[\s-]/g, '');

  if (OTP.test(text)) return { kind: 'otp', reason: 'A one-time password' };

  const fromPerson = PERSONAL_SENDER.test(sender);
  // Airtel telling you about a discount is marketing, however pushy, so only a threat or a
  // request to verify makes a registered promotional sender's message a scam.
  const promo = PROMO_HEADER.test(sender) && !fromPerson;
  if ((LINK.test(text) && (promo ? HARD_BAIT : BAIT).test(text)) || (fromPerson && BANKISH.test(text) && (LINK.test(text) || BAIT.test(text)))) {
    return {
      kind: 'scam',
      reason: fromPerson
        ? 'Claims to be about your bank but comes from a personal number'
        : 'Pushes you to a link with a threat or a prize',
    };
  }

  if (MANDATE.test(text) && !REMINDER.test(text)) {
    if (MANDATE_ENDED.test(text) && !MONEY_MOVED.test(text)) {
      return { kind: 'mandate', reason: 'An autopay was cancelled', mandate: readMandate(text) };
    }
    if (MANDATE_SET.test(text) && !MONEY_MOVED.test(text)) {
      return { kind: 'mandate', reason: 'An autopay was set up', mandate: readMandate(text) };
    }
    // A payment taken by an autopay: spending, and a subscription.
    const paid = parseAlert(message);
    if (paid) {
      const payee = readMandate(text).payee;
      return {
        kind: 'transaction',
        reason: 'Paid by an autopay',
        alert: { ...paid, autopay: true, counterparty: payee !== 'Unknown payee' ? payee : paid.counterparty },
      };
    }
  }

  if (OFFER.test(text)) return { kind: 'offer', reason: 'An offer or advert' };
  if (promo && !ABOUT_ACCOUNT.test(text)) {
    return { kind: 'offer', reason: 'An advert from a registered promotional sender' };
  }
  if (REMINDER.test(text)) return { kind: 'reminder', reason: 'A payment that is due, not yet made' };

  const alert = parseAlert(message);
  if (alert) {
    if (!alert.accountDigits && FUND_CONFIRMATION.test(text)) {
      return { kind: 'info', reason: 'A fund house confirming an investment; the bank’s message is the payment' };
    }
    if (!alert.accountDigits && fromPerson) {
      return LINK.test(text)
        ? { kind: 'scam', reason: 'Money "credited" by a personal number, with a link' }
        : { kind: 'info', reason: 'From a personal number, not your bank' };
    }
    if (!alert.accountDigits && HEADER.test(sender) && !BANK_SENDER.test(sender)) {
      return { kind: 'info', reason: 'A receipt from a shop or service; the bank’s message is the payment' };
    }
    return { kind: 'transaction', reason: 'Money moved', alert };
  }

  return { kind: 'info', reason: 'No money moved' };
};
