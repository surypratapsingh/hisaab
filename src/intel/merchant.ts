import { Id } from '@/lib/ulid';
import { extractVPA } from './normalise';

export type MerchantResolutionResult = {
  merchantId?: Id;
  merchantName?: string;
  confidence: number;
  method: 'learned' | 'vpa' | 'substring' | 'fuzzy' | 'unknown';
  /** The pattern that matched, so its hit count can be credited. */
  matchedPattern?: { pattern: string; kind: 'vpa' | 'substring' | 'regex' };
};

/** A pattern the user taught the app, read back from merchant_patterns. */
export type LearnedPattern = {
  merchantId: Id;
  canonical: string;
  pattern: string;
  kind: 'vpa' | 'substring' | 'regex';
};

export const SEED_MERCHANTS: Record<string, string> = {
  'amazon@upi': 'Amazon',
  'googleplay@upi': 'Google Play',
  'netflix@okaxis': 'Netflix',
  'flipkart@upi': 'Flipkart',
  'swiggy@upi': 'Swiggy',
  'zomato@upi': 'Zomato',
  'uber@upi': 'Uber',
  'paytm@paytm': 'Paytm',
  'phonepe@ybl': 'PhonePe',
  'googlepay@okhdfcbank': 'Google Pay',
  'blinkit@okhdfcbank': 'Blinkit',
  'instamart@okaxis': 'Instamart',
  'airbnb@airbnb': 'Airbnb',
  'spotify@spotify': 'Spotify',
  'youtube@google': 'YouTube',
  'edgeverve@icici': 'ICICI Bank',
  'hdfc@hdfc': 'HDFC Bank',
  'sbi@sbi': 'SBI',
  'axis@axis': 'Axis Bank',
};

export const SEED_SUBSTRINGS: Record<string, string> = {
  AMAZON: 'Amazon',
  FLIPKART: 'Flipkart',
  SWIGGY: 'Swiggy',
  ZOMATO: 'Zomato',
  UBER: 'Uber',
  OLA: 'Ola Cabs',
  NETFLIX: 'Netflix',
  HOTSTAR: 'Disney+ Hotstar',
  JIOCINEMA: 'JioCinema',
  PRIME: 'Amazon Prime',
  SPOTIFY: 'Spotify',
  YOUTUBE: 'YouTube',
  AIRBNB: 'Airbnb',
  BOOKMYSHOW: 'BookMyShow',
  CRED: 'CRED',
  PAYPAL: 'PayPal',
  'RUPAY': 'RuPay',
  STARBUCKS: 'Starbucks',
  MCDONALDS: 'McDonald\'s',
  DOMINOS: 'Domino\'s',
  PIZZAHUT: 'Pizza Hut',
  BLINKIT: 'Blinkit',
  INSTAMART: 'Instamart',
  ZEPTO: 'Zepto',
  BIGBASKET: 'BigBasket',
  DMART: 'DMart',
  DUNKINDONUTS: 'Dunkin\' Donuts',
};

// Longest first, compiled once. A name must start a word: OLA is inside COLA and BHOLA.
// CRED must end one too, as it starts CREDIT and CREDITED, which most bank texts hold.
const SEED_PATTERNS: Array<[string, RegExp]> = Object.keys(SEED_SUBSTRINGS)
  .sort((a, b) => b.length - a.length)
  .map((key) => [key, new RegExp(`(^|[^A-Z0-9])${key}${key === 'CRED' ? '(?![A-Z])' : ''}`)]);

/**
 * Patterns the user taught beat anything shipped in the seed file: a
 * correction they made once should never have to be made twice.
 */
const matchLearned = (
  narration: string,
  vpa: string | null,
  learned: LearnedPattern[]
): MerchantResolutionResult | null => {
  const byVpa = vpa
    ? learned.find((p) => p.kind === 'vpa' && p.pattern.toLowerCase() === vpa)
    : undefined;

  if (byVpa) {
    return {
      merchantId: byVpa.merchantId,
      merchantName: byVpa.canonical,
      confidence: 1,
      method: 'learned',
      matchedPattern: { pattern: byVpa.pattern, kind: 'vpa' },
    };
  }

  const substrings = learned
    .filter((p) => p.kind === 'substring')
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .find((p) => narration.includes(p.pattern.toUpperCase()));

  if (substrings) {
    return {
      merchantId: substrings.merchantId,
      merchantName: substrings.canonical,
      confidence: 1,
      method: 'learned',
      matchedPattern: { pattern: substrings.pattern, kind: 'substring' },
    };
  }

  for (const entry of learned.filter((p) => p.kind === 'regex')) {
    try {
      if (new RegExp(entry.pattern, 'i').test(narration)) {
        return {
          merchantId: entry.merchantId,
          merchantName: entry.canonical,
          confidence: 1,
          method: 'learned',
          matchedPattern: { pattern: entry.pattern, kind: 'regex' },
        };
      }
    } catch {
      // A malformed stored pattern must not break resolution for everything
      // else; it simply never matches.
    }
  }

  return null;
};

export const resolveMerchant = (
  normalizedNarration: string,
  learned: LearnedPattern[] = []
): MerchantResolutionResult => {
  // 1. Try VPA match
  const vpa = extractVPA(normalizedNarration);

  const taught = matchLearned(normalizedNarration, vpa, learned);
  if (taught) return taught;

  if (vpa) {
    const vpaLower = vpa.toLowerCase();
    if (SEED_MERCHANTS[vpaLower]) {
      return {
        merchantName: SEED_MERCHANTS[vpaLower],
        confidence: 1.0,
        method: 'vpa',
        matchedPattern: { pattern: vpaLower, kind: 'vpa' },
      };
    }
  }

  // 2. Try substring match (longest first)
  const substrings = SEED_PATTERNS.find(([, pattern]) => pattern.test(normalizedNarration))?.[0];

  if (substrings) {
    return {
      merchantName: SEED_SUBSTRINGS[substrings],
      confidence: 0.95,
      method: 'substring',
      matchedPattern: { pattern: substrings, kind: 'substring' },
    };
  }

  // 3. Fuzzy match (trigram similarity)
  const topMatch = fuzzyMatchMerchant(normalizedNarration);
  if (topMatch && topMatch.confidence > 0.85) {
    return {
      merchantName: topMatch.name,
      confidence: topMatch.confidence,
      method: 'fuzzy',
    };
  }

  // 4. Unknown
  return {
    confidence: 0,
    method: 'unknown',
  };
};

function fuzzyMatchMerchant(
  narration: string
): { name: string; confidence: number } | null {
  const allMerchants = Object.values(SEED_MERCHANTS).concat(
    Object.values(SEED_SUBSTRINGS)
  );
  const uniqueMerchants = [...new Set(allMerchants)];

  const trigrams = extractTrigrams(narration);

  let bestMatch: { name: string; score: number } | null = null;

  for (const merchant of uniqueMerchants) {
    const merchantTrigrams = extractTrigrams(merchant);
    const similarity = trigramSimilarity(trigrams, merchantTrigrams);

    if (!bestMatch || similarity > bestMatch.score) {
      bestMatch = { name: merchant, score: similarity };
    }
  }

  if (bestMatch && bestMatch.score > 0.7) {
    return { name: bestMatch.name, confidence: bestMatch.score };
  }

  return null;
}

function extractTrigrams(text: string): Set<string> {
  const trigrams = new Set<string>();
  const normalized = text.toLowerCase();

  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }

  return trigrams;
}

function trigramSimilarity(
  trigrams1: Set<string>,
  trigrams2: Set<string>
): number {
  if (trigrams1.size === 0 && trigrams2.size === 0) return 1;
  if (trigrams1.size === 0 || trigrams2.size === 0) return 0;

  let intersection = 0;
  for (const t of trigrams1) {
    if (trigrams2.has(t)) {
      intersection++;
    }
  }

  const union = trigrams1.size + trigrams2.size - intersection;
  return intersection / union;
}
