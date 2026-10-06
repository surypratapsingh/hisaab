import { Id } from '@/lib/ulid';

export type CategorisationResult = {
  categoryId: Id;
  confidence: number;
  method: 'rule' | 'heuristic' | 'unknown';
};

const CATEGORY_RULES: Record<string, { categoryId: Id; keywords: string[] }> = {
  // Checked first: a grocery app is where bread and paneer come from, not a
  // restaurant, and these are the payments worth breaking into items.
  'cat_groceries': {
    categoryId: 'cat_groceries' as Id,
    keywords: [
      'BLINKIT',
      'INSTAMART',
      'ZEPTO',
      'BIGBASKET',
      'DMART',
      'JIOMART',
      'GROCER',
      'KIRANA',
      'SUPERMARKET',
    ],
  },
  'cat_food': {
    categoryId: 'cat_food' as Id,
    keywords: [
      'RESTAURANT',
      'CAFE',
      'STARBUCKS',
      'SWIGGY',
      'ZOMATO',
      'DOMINOS',
      'PIZZAHUT',
      'MCDONALDS',
      'UBER EATS',
      'FOOD',
    ],
  },
  'cat_transport': {
    categoryId: 'cat_transport' as Id,
    keywords: [
      'UBER',
      'OLA',
      'TAXI',
      'METRO',
      'RAILWAY',
      'FLIGHT',
      'PETROL',
      'FUEL',
      'PARKING',
    ],
  },
  'cat_utilities': {
    categoryId: 'cat_utilities' as Id,
    keywords: [
      'ELECTRICITY',
      'POWER',
      'WATER',
      'GAS',
      'INTERNET',
      'BROADBAND',
      'BILL',
      'UTILITY',
    ],
  },
  'cat_entertainment': {
    categoryId: 'cat_entertainment' as Id,
    keywords: [
      'NETFLIX',
      'HOTSTAR',
      'SPOTIFY',
      'YOUTUBE',
      'MOVIE',
      'CINEMA',
      'THEATER',
      'GAME',
      'GAMING',
      'MOVIE TICKET',
    ],
  },
  'cat_shopping': {
    categoryId: 'cat_shopping' as Id,
    keywords: [
      'AMAZON',
      'FLIPKART',
      'CLOTHING',
      'APPAREL',
      'SHOPPING',
      'STORE',
      'MALL',
      'RETAIL',
    ],
  },
  'cat_healthcare': {
    categoryId: 'cat_healthcare' as Id,
    keywords: [
      'HOSPITAL',
      'CLINIC',
      'PHARMACY',
      'DOCTOR',
      'MEDICINE',
      'HEALTH',
      'MEDICAL',
    ],
  },
  'cat_education': {
    categoryId: 'cat_education' as Id,
    keywords: [
      'SCHOOL',
      'COLLEGE',
      'UNIVERSITY',
      'COURSE',
      'TUITION',
      'COACHING',
      'EDUCATION',
    ],
  },
  'cat_subscriptions': {
    categoryId: 'cat_subscriptions' as Id,
    keywords: ['SUBSCRIPTION', 'RENEWAL', 'MEMBERSHIP', 'RECURRING'],
  },
  'cat_fees': {
    categoryId: 'cat_fees' as Id,
    keywords: ['CHARGE', 'FEE', 'COMMISSION', 'INTEREST'],
  },
};

// Compiled once: building a pattern per keyword per transaction made a
// 5,000-row statement import measurably slower.
const WORD_START = new Map<string, RegExp>(
  Object.values(CATEGORY_RULES).flatMap((rule) =>
    rule.keywords.map((k): [string, RegExp] => [k, new RegExp(`(^|[^A-Z0-9])${k}`)])
  )
);

const startsWord = (text: string, keyword: string): boolean =>
  (WORD_START.get(keyword) ?? new RegExp(`(^|[^A-Z0-9])${keyword}`)).test(text);

export const categorise = (
  merchantName: string | undefined,
  narration: string
): CategorisationResult => {
  const text = (merchantName || narration).toUpperCase();

  // Rule-based categorisation. A keyword must start a word: "CHARGE" inside
  // "MOBILE RECHARGE" filed a phone top-up as a bank fee, and "FEE" would
  // match "COFFEE". A prefix still matches, so "GROCER" finds "GROCERY".
  for (const [, rule] of Object.entries(CATEGORY_RULES)) {
    for (const keyword of rule.keywords) {
      if (startsWord(text, keyword)) {
        return {
          categoryId: rule.categoryId,
          confidence: 0.9,
          method: 'rule',
        };
      }
    }
  }

  // Heuristic: multi-character words
  const words = text.split(/\s+/).filter((w) => w.length > 3);
  if (words.length > 0) {
    const firstWord = words[0];
    for (const [, rule] of Object.entries(CATEGORY_RULES)) {
      for (const keyword of rule.keywords) {
        if (keyword.includes(firstWord)) {
          return {
            categoryId: rule.categoryId,
            confidence: 0.6,
            method: 'heuristic',
          };
        }
      }
    }
  }

  // Unknown
  return {
    categoryId: 'cat_unknown' as Id,
    confidence: 0,
    method: 'unknown',
  };
};
