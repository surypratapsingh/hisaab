import { describe, it, expect } from 'vitest';
import { isRecurring, detectSubscriptions, renewalOnOrAfter, summarise } from './subscriptions';
import { detectPayday, nextPayday } from './payday';
import { generateInsights, type InsightEntry } from './insights';
import { paise } from '@/money/money';

const charge = (date: string, amount: number) => ({ date, amount: paise(amount) });

describe('what counts as a subscription', () => {
  it('recognises a steady monthly charge', () => {
    expect(
      isRecurring([
        charge('2026-06-08', -64900),
        charge('2026-07-08', -64900),
        charge('2026-08-08', -64900),
      ])
    ).toBe(true);
  });

  it('survives a single price rise', () => {
    expect(
      isRecurring([
        charge('2026-05-08', -64900),
        charge('2026-06-08', -64900),
        charge('2026-07-08', -64900),
        charge('2026-08-08', -79900),
      ])
    ).toBe(true);
  });

  it('does not call grocery runs a subscription just because they average weekly', () => {
    // Roughly weekly on average, but gaps and amounts all over the place.
    expect(
      isRecurring([
        charge('2026-08-01', -45000),
        charge('2026-08-03', -12000),
        charge('2026-08-12', -89000),
        charge('2026-08-16', -23000),
        charge('2026-08-29', -61000),
      ])
    ).toBe(false);
  });

  it('does not call same-amount buys at random times a subscription', () => {
    expect(
      isRecurring([
        charge('2026-08-01', -2000),
        charge('2026-08-04', -2000),
        charge('2026-08-19', -2000),
        charge('2026-08-21', -2000),
      ])
    ).toBe(false);
  });

  it('needs three charges before calling anything regular', () => {
    expect(isRecurring([charge('2026-07-08', -64900), charge('2026-08-08', -64900)])).toBe(false);
  });

  it('keeps only the groups that behave like subscriptions', () => {
    const found = detectSubscriptions([
      {
        name: 'Netflix',
        charges: [charge('2026-06-08', -64900), charge('2026-07-08', -64900), charge('2026-08-08', -64900)],
      },
      { name: 'Blinkit', charges: [charge('2026-08-01', -45000), charge('2026-08-12', -8900), charge('2026-08-13', -30000)] },
    ]);

    expect(found.map((s) => s.merchantName)).toEqual(['Netflix']);
  });

  it('steps a renewal forward past dates already gone', () => {
    const summary = summarise(
      {
        merchantName: 'Netflix',
        charges: [charge('2026-06-08', -64900), charge('2026-07-08', -64900), charge('2026-08-08', -64900)],
      },
      '2026-08-20'
    );

    // Projected for 8 September, but today is the 20th: next one is a month on.
    expect(renewalOnOrAfter(summary, '2026-09-20')).toBe('2026-10-08');
    expect(renewalOnOrAfter(summary, '2026-09-01')).toBe('2026-09-08');
  });
});

describe('payday', () => {
  it('takes the day from anything marked as salary', () => {
    const payday = detectPayday([
      { date: '2026-08-01', amount: paise(7500000), categoryId: 'cat_salary' },
    ]);
    expect(payday).toEqual({ day: 1, source: 'salary', lastPaid: '2026-08-01' });
  });

  it('finds the biggest credit that comes back a month later', () => {
    const payday = detectPayday([
      { date: '2026-07-31', amount: paise(7500000) },
      { date: '2026-08-12', amount: paise(120000) },
      { date: '2026-08-31', amount: paise(7500000) },
    ]);
    expect(payday).toEqual({ day: 31, source: 'pattern', lastPaid: '2026-08-31' });
  });

  it('does not mistake a one-off for a salary', () => {
    expect(
      detectPayday([
        { date: '2026-08-12', amount: paise(120000) },
        { date: '2026-08-20', amount: paise(9000000) },
      ])
    ).toBeNull();
  });

  it('has nothing to say with no credits', () => {
    expect(detectPayday([])).toBeNull();
  });

  it('points at this month when payday is still ahead', () => {
    expect(nextPayday(25, new Date(2026, 8, 10))).toBe('2026-09-25');
  });

  it('points at next month once payday has come', () => {
    expect(nextPayday(1, new Date(2026, 8, 10))).toBe('2026-10-01');
    // On payday itself the window runs to the next one.
    expect(nextPayday(10, new Date(2026, 8, 10))).toBe('2026-10-10');
  });

  it('lands a 31st payday on the last day of a short month', () => {
    expect(nextPayday(31, new Date(2026, 1, 5))).toBe('2026-02-28');
    expect(nextPayday(31, new Date(2026, 8, 20))).toBe('2026-09-30');
    // The 30th is payday in September, so on the day itself it is next month's.
    expect(nextPayday(31, new Date(2026, 8, 30))).toBe('2026-10-31');
  });

  it('rolls into the new year', () => {
    expect(nextPayday(1, new Date(2026, 11, 15))).toBe('2027-01-01');
  });
});

describe('insights read from real data', () => {
  const entry = (id: string, date: string, merchant: string, categoryId: string, amount: number): InsightEntry => ({
    id,
    date,
    merchant,
    categoryId,
    amount: paise(amount),
  });

  it('names a category instead of printing its id', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      categoryNames: { cat_food: 'Food & Dining' },
      entries: [
        entry('1', '2026-08-05', 'Swiggy', 'cat_food', -100000),
        entry('2', '2026-09-05', 'Swiggy', 'cat_food', -230000),
      ],
    });

    const drift = insights.find((i) => i.kind === 'category_drift')!;
    expect(drift.sentence).toContain('on Food & Dining this month');
    expect(drift.sentence).not.toContain('cat_food');
  });

  it('counts detected subscriptions even when filed under another category', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      subscriptionMerchants: ['Netflix'],
      entries: [
        entry('1', '2026-08-08', 'Netflix', 'cat_entertainment', -64900),
        entry('2', '2026-09-08', 'Netflix', 'cat_entertainment', -79900),
      ],
    });

    expect(insights.some((i) => i.kind === 'subscription_creep')).toBe(true);
  });

  it('sets one month of income against that month of spending only', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      income: paise(10000000),
      entries: [
        // Last month's rent must not count against this month's salary.
        entry('1', '2026-08-01', 'Rent', 'cat_utilities', -3000000),
        entry('2', '2026-09-01', 'Rent', 'cat_utilities', -3000000),
      ],
    });

    expect(insights.find((i) => i.kind === 'savings_rate')!.sentence).toContain('70%');
  });

  it('says so plainly when more went out than came in', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      income: paise(2000000),
      entries: [entry('1', '2026-09-01', 'Rent', 'cat_utilities', -3000000)],
    });

    const rate = insights.find((i) => i.kind === 'savings_rate')!;
    expect(rate.sentence).toBe(
      'You spent Rs 10,000.00 more than came in this month, Rs 30,000.00 against Rs 20,000.00.'
    );
    expect(rate.evidence).toEqual(['1']);
  });
});
