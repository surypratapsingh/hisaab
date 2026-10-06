import type { InsightKind } from '@/analysis/insights';

/** What kind of finding a card is, in a few words, and the glyph that goes with it. */
export const INSIGHT_LOOK: Record<InsightKind, { eyebrow: string; icon: string }> = {
  category_drift: { eyebrow: 'Spending change', icon: '📈' },
  unusual_amount: { eyebrow: 'Unusual amount', icon: '🔍' },
  subscription_creep: { eyebrow: 'Subscription change', icon: '🔁' },
  duplicate_charge: { eyebrow: 'Possible repeat charge', icon: '⚠️' },
  price_move: { eyebrow: 'Price change', icon: '🏷️' },
  bill_due: { eyebrow: 'Coming up', icon: '🗓️' },
  savings_rate: { eyebrow: 'Savings', icon: '🐷' },
};
