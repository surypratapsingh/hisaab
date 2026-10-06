import { Paise, abs, divide, sum } from '@/money/money';
import { daysBetween } from '@/lib/date';

export type RecurringPattern = {
  merchantName: string;
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'unknown';
  daysInterval: number;
  averageAmount: Paise;
  occurrences: number;
  isRecurring: boolean;
};

export const detectRecurring = (
  entries: Array<{
    date: string;
    merchantName: string;
    amount: Paise;
  }>,
  minOccurrences: number = 3
): RecurringPattern[] => {
  // Group by merchant
  const byMerchant = new Map<
    string,
    Array<{ date: string; amount: Paise }>
  >();

  for (const entry of entries) {
    if (!byMerchant.has(entry.merchantName)) {
      byMerchant.set(entry.merchantName, []);
    }
    byMerchant.get(entry.merchantName)!.push({
      date: entry.date,
      amount: entry.amount,
    });
  }

  const patterns: RecurringPattern[] = [];

  for (const [merchant, transactions] of byMerchant) {
    if (transactions.length < minOccurrences) {
      continue;
    }

    // Sort by date
    transactions.sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    // Calculate intervals
    const intervals: number[] = [];
    for (let i = 1; i < transactions.length; i++) {
      const daysDiff = daysBetween(
        new Date(transactions[i - 1].date),
        new Date(transactions[i].date)
      );
      intervals.push(Math.abs(daysDiff));
    }

    // Average interval
    const avgInterval = Math.round(
      intervals.reduce((a, b) => a + b, 0) / intervals.length
    );

    // Check if amounts are similar (within 5%)
    const amounts = transactions.map((t) => abs(t.amount));
    const avgAmount = divide(sum(amounts), amounts.length);

    let similarCount = 0;
    for (const amount of amounts) {
      const percentDiff = Math.abs(amount - avgAmount) / avgAmount;
      if (percentDiff < 0.05) {
        // Within 5%
        similarCount++;
      }
    }

    const isRecurring =
      transactions.length >= minOccurrences && similarCount >= minOccurrences;

    if (isRecurring) {
      patterns.push({
        merchantName: merchant,
        interval: getIntervalName(avgInterval),
        daysInterval: avgInterval,
        averageAmount: avgAmount,
        occurrences: transactions.length,
        isRecurring: true,
      });
    }
  }

  return patterns;
};

function getIntervalName(
  days: number
): 'daily' | 'weekly' | 'monthly' | 'yearly' | 'unknown' {
  if (Math.abs(days - 1) <= 1) return 'daily';
  if (Math.abs(days - 7) <= 2) return 'weekly';
  if (Math.abs(days - 30) <= 4) return 'monthly';
  if (Math.abs(days - 90) <= 7) return 'monthly'; // Quarterly as monthly
  if (Math.abs(days - 365) <= 14) return 'yearly';
  return 'unknown';
}
