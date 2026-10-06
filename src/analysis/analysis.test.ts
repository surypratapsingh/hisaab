import { describe, it, expect } from 'vitest';
import {
  safeToSpend,
  isOverCommitted,
  dailyDiscretionaryFrom,
  totalCommitted,
  type SafeToSpendInput,
} from './safeToSpend';
import {
  summarise,
  summariseAll,
  totalAnnualised,
  monthlyEquivalent,
  overlapping,
  renewalsWithin,
  increaseAmount,
  type Subscription,
} from './subscriptions';
import { generateInsights, type InsightEntry } from './insights';
import { paise, sum, format } from '@/money/money';

const baseInput: SafeToSpendInput = {
  today: '2026-09-01',
  nextIncomeDate: '2026-10-01',
  liquidBalance: paise(5000000), // 50,000.00
  bills: [],
  cardDues: [],
  scheduledInvestments: [],
  cashFloor: paise(0),
  dailyDiscretionary: paise(0),
};

describe('safe to spend', () => {
  it('always itemises to exactly the headline figure', () => {
    const result = safeToSpend({
      ...baseInput,
      bills: [{ label: 'Electricity', amount: paise(234050), dueDate: '2026-09-15' }],
      cardDues: [{ label: 'HDFC card', amount: paise(1845000), dueDate: '2026-09-20' }],
      scheduledInvestments: [
        { label: 'SIP', amount: paise(1000000), dueDate: '2026-09-05' },
      ],
      cashFloor: paise(500000),
      dailyDiscretionary: paise(30000),
    });

    expect(sum(result.lines.map((l) => l.amount))).toBe(result.amount);
  });

  it('starts from the liquid balance when nothing is committed', () => {
    const result = safeToSpend(baseInput);

    expect(result.amount).toBe(5000000);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].kind).toBe('liquid');
  });

  it('subtracts a bill due inside the window', () => {
    const result = safeToSpend({
      ...baseInput,
      bills: [{ label: 'Electricity', amount: paise(234050), dueDate: '2026-09-15' }],
    });

    expect(result.amount).toBe(5000000 - 234050);
    expect(result.lines.some((l) => l.kind === 'bill')).toBe(true);
  });

  it('ignores a bill falling after the window closes', () => {
    const result = safeToSpend({
      ...baseInput,
      bills: [{ label: 'Insurance', amount: paise(900000), dueDate: '2026-11-02' }],
    });

    expect(result.amount).toBe(5000000);
    expect(result.lines.some((l) => l.kind === 'bill')).toBe(false);
  });

  it('forecasts usual spending across the days in the window', () => {
    const result = safeToSpend({ ...baseInput, dailyDiscretionary: paise(30000) });

    expect(result.daysInWindow).toBe(30);
    expect(result.amount).toBe(5000000 - 30000 * 30);
  });

  it('holds back the minimum balance', () => {
    const result = safeToSpend({ ...baseInput, cashFloor: paise(500000) });

    expect(result.amount).toBe(4500000);
    expect(result.lines.some((l) => l.kind === 'floor')).toBe(true);
  });

  it('goes negative when the window is overcommitted', () => {
    const result = safeToSpend({
      ...baseInput,
      liquidBalance: paise(100000),
      cardDues: [{ label: 'Card', amount: paise(1845000), dueDate: '2026-09-20' }],
    });

    expect(isOverCommitted(result)).toBe(true);
    expect(format(result.amount)).toBe('-Rs 17,450.00');
  });

  it('reports what was held back in total', () => {
    const result = safeToSpend({
      ...baseInput,
      bills: [{ label: 'Power', amount: paise(200000), dueDate: '2026-09-10' }],
      cashFloor: paise(300000),
    });

    expect(totalCommitted(result)).toBe(500000);
  });

  it('averages history into a daily discretionary figure', () => {
    const daily = dailyDiscretionaryFrom(
      [paise(-30000), paise(-60000), paise(-30000)],
      30
    );

    expect(daily).toBe(4000);
  });

  it('treats a zero-day window as having no forecast', () => {
    const result = safeToSpend({
      ...baseInput,
      nextIncomeDate: '2026-09-01',
      dailyDiscretionary: paise(30000),
    });

    expect(result.daysInWindow).toBe(0);
    expect(result.lines.some((l) => l.kind === 'forecast')).toBe(false);
  });
});

describe('subscriptions', () => {
  const netflix: Subscription = {
    merchantName: 'Netflix',
    categoryId: 'cat_entertainment',
    charges: [
      { date: '2026-06-08', amount: paise(-64900) },
      { date: '2026-07-08', amount: paise(-64900) },
      { date: '2026-08-08', amount: paise(-64900) },
    ],
  };

  it('reads a monthly cadence and annualises it', () => {
    const summary = summarise(netflix, '2026-08-20');

    expect(summary.cadence).toBe('monthly');
    expect(summary.latestAmount).toBe(64900);
    expect(format(summary.annualisedCost)).toBe('Rs 7,788.00');
  });

  it('spreads a yearly cost over twelve months', () => {
    expect(format(monthlyEquivalent(summarise(netflix, '2026-08-20').annualisedCost))).toBe('Rs 649.00');
    expect(monthlyEquivalent(paise(0))).toBe(0);
  });

  it('projects the next renewal', () => {
    const summary = summarise(netflix, '2026-08-20');
    expect(summary.nextExpected).toBe('2026-09-08');
  });

  it('renews a charge from the 31st on the last day of a shorter month', () => {
    const gym: Subscription = {
      merchantName: 'Gym',
      charges: [
        { date: '2026-11-30', amount: paise(-150000) },
        { date: '2026-12-31', amount: paise(-150000) },
        { date: '2027-01-31', amount: paise(-150000) },
      ],
    };
    expect(summarise(gym, '2027-02-01').nextExpected).toBe('2027-02-28');
  });

  it('flags a price increase against the previous charge', () => {
    const summary = summarise(
      {
        ...netflix,
        charges: [...netflix.charges, { date: '2026-09-08', amount: paise(-79900) }],
      },
      '2026-09-20'
    );

    expect(summary.priceIncrease).toEqual({ from: 64900, to: 79900 });
    expect(increaseAmount(summary)).toBe(15000);
  });

  it('does not flag an increase when the price held', () => {
    expect(summarise(netflix, '2026-08-20').priceIncrease).toBeUndefined();
  });

  it('marks a subscription dormant after 90 days', () => {
    const summary = summarise(netflix, '2026-12-01');
    expect(summary.dormantSinceDays).toBeGreaterThanOrEqual(90);
  });

  it('ranks subscriptions by what they cost over a year', () => {
    const summaries = summariseAll(
      [
        netflix,
        {
          merchantName: 'Amazon Prime',
          categoryId: 'cat_entertainment',
          charges: [
            { date: '2026-01-01', amount: paise(-149900) },
            { date: '2025-01-01', amount: paise(-149900) },
          ],
        },
      ],
      '2026-08-20'
    );

    expect(summaries[0].merchantName).toBe('Netflix');
  });

  it('leaves dormant subscriptions out of the annual total', () => {
    const summaries = summariseAll([netflix], '2026-12-01');
    expect(totalAnnualised(summaries)).toBe(0);
  });

  it('spots two live services in the same category', () => {
    const overlaps = overlapping(
      [
        netflix,
        {
          merchantName: 'Disney+ Hotstar',
          categoryId: 'cat_entertainment',
          charges: [
            { date: '2026-06-10', amount: paise(-29900) },
            { date: '2026-07-10', amount: paise(-29900) },
            { date: '2026-08-10', amount: paise(-29900) },
          ],
        },
      ],
      '2026-08-20'
    );

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].merchants).toHaveLength(2);
  });

  it('lists renewals landing inside the next fortnight', () => {
    const summaries = summariseAll([netflix], '2026-08-20');
    const soon = renewalsWithin(summaries, '2026-08-20', 30);

    expect(soon).toHaveLength(1);
  });
});

describe('insights', () => {
  const entry = (
    id: string,
    date: string,
    merchant: string,
    categoryId: string,
    amount: number
  ): InsightEntry => ({ id, date, merchant, categoryId, amount: paise(amount) });

  describe('price moves', () => {
    const named = (id: string, date: string, merchant: string, amount: number, categoryId = 'cat_food'): InsightEntry => ({
      ...entry(id, date, merchant, categoryId, amount),
      named: true,
    });
    const bought = (merchant: string, rupees: number, start: string, count: number, categoryId?: string) =>
      Array.from({ length: count }, (_, i) => {
        const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 3 * 86_400_000).toISOString().slice(0, 10);
        return named(`${merchant}-${rupees}-${i}`, day, merchant, -rupees * 100, categoryId);
      });

    const input = (entries: InsightEntry[]) => ({ today: '2026-09-27', monthsOfHistory: 12, entries });

    it('reports something that now costs more than it did, with the purchases either side', () => {
      const insights = generateInsights(
        input([
          ...bought('Chicken', 150, '2025-10-01', 12),
          ...bought('Chicken', 170, '2026-01-01', 20),
          ...bought('Chicken', 180, '2026-09-03', 4),
        ])
      );
      const move = insights.find((i) => i.kind === 'price_move')!;
      expect(move.sentence).toBe(
        'Chicken now costs Rs 180.00, up 6% on Rs 170.00, since 3 Sep. It was Rs 150.00 in Oct 2025.'
      );
      expect(move.evidence).toHaveLength(5); // two at the old price, three at the new
    });

    it('says down when it got cheaper', () => {
      const move = generateInsights(
        input([...bought('Bread', 65, '2026-01-01', 10), ...bought('Bread', 60, '2026-09-01', 4)])
      ).find((i) => i.kind === 'price_move')!;
      expect(move.sentence).toContain('down 8% on Rs 65.00');
    });

    it('stays quiet about a change that is old news, or something no longer bought', () => {
      const old = generateInsights(
        input([...bought('Chicken', 170, '2025-10-01', 10), ...bought('Chicken', 180, '2026-03-01', 10)])
      );
      expect(old.some((i) => i.kind === 'price_move')).toBe(false);

      const gone = generateInsights(
        input([...bought('Chicken', 170, '2026-03-01', 6), ...bought('Chicken', 180, '2026-06-01', 6)])
      );
      expect(gone.some((i) => i.kind === 'price_move')).toBe(false);
    });

    it('needs the name to mean something, and ignores family and savings', () => {
      const unnamed = bought('Mob Bk', 200, '2026-01-01', 10)
        .concat(bought('Mob Bk', 300, '2026-09-01', 4))
        .map((e) => ({ ...e, named: false }));
      expect(generateInsights(input(unnamed)).some((i) => i.kind === 'price_move')).toBe(false);

      const family = [
        ...bought('Atul', 10000, '2026-01-01', 10, 'cat_family'),
        ...bought('Atul', 40000, '2026-09-01', 4, 'cat_family'),
      ];
      expect(generateInsights(input(family)).some((i) => i.kind === 'price_move')).toBe(false);
    });

    it('does not read a quantity as a price: petrol bought for 200 one week and 300 the next', () => {
      const petrol = [
        ...bought('Petrol', 200, '2026-05-01', 4),
        ...bought('Petrol', 300, '2026-06-01', 4),
        ...bought('Petrol', 200, '2026-08-01', 4),
        ...bought('Petrol', 300, '2026-09-01', 4),
      ];
      expect(generateInsights(input(petrol)).some((i) => i.kind === 'price_move')).toBe(false);
    });

    it('can look back further than the other insights do', () => {
      const entries = [...bought('Chicken', 150, '2025-10-01', 12), ...bought('Chicken', 180, '2026-09-03', 4)];
      const move = generateInsights({
        today: '2026-09-27',
        monthsOfHistory: 12,
        entries: entries.slice(-4),
        priceEntries: entries,
      }).find((i) => i.kind === 'price_move');
      expect(move?.sentence).toContain('up 20% on Rs 150.00');
    });
  });

  it('stays silent below three months of history', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 2,
      entries: [entry('1', '2026-09-01', 'Swiggy', 'cat_food', -500000)],
      income: paise(10000000),
    });

    expect(insights).toHaveLength(0);
  });

  it('reports a category that jumped against last month', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        entry('1', '2026-08-05', 'Swiggy', 'cat_food', -100000),
        entry('2', '2026-09-05', 'Swiggy', 'cat_food', -230000),
      ],
    });

    const drift = insights.find((i) => i.kind === 'category_drift');
    expect(drift).toBeDefined();
    expect(drift!.sentence).toContain('2.3x');
    expect(drift!.evidence).toContain('2');
  });

  it('reports an unusual charge at a known merchant', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        entry('1', '2026-06-01', 'Blinkit', 'cat_food', -45000),
        entry('2', '2026-07-01', 'Blinkit', 'cat_food', -50000),
        entry('3', '2026-08-01', 'Blinkit', 'cat_food', -40000),
        entry('4', '2026-09-01', 'Blinkit', 'cat_food', -300000),
      ],
    });

    const unusual = insights.find((i) => i.kind === 'unusual_amount');
    expect(unusual).toBeDefined();
    expect(unusual!.evidence).toEqual(['4']);
  });

  it('catches the same charge landing twice', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        entry('1', '2026-09-01', 'Amazon', 'cat_shopping', -250000),
        entry('2', '2026-09-02', 'Amazon', 'cat_shopping', -250000),
      ],
    });

    const duplicate = insights.find((i) => i.kind === 'duplicate_charge');
    expect(duplicate).toBeDefined();
    expect(duplicate!.evidence).toEqual(['1', '2']);
  });

  it('does not call two hand-logged purchases a duplicate charge: nobody billed them', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        { ...entry('1', '2026-09-01', 'Chicken', 'cat_food', -17000), logged: true },
        { ...entry('2', '2026-09-02', 'Chicken', 'cat_food', -17000), logged: true },
      ],
    });

    expect(insights.some((i) => i.kind === 'duplicate_charge')).toBe(false);
  });

  it('pairs each charge once and lists duplicates in the order the charges came', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        entry('1', '2026-08-20', 'Amazon', 'cat_shopping', -250000),
        entry('2', '2026-09-01', 'Swiggy', 'cat_food', -45000),
        entry('3', '2026-09-02', 'Swiggy', 'cat_food', -45000),
        entry('4', '2026-09-03', 'Swiggy', 'cat_food', -45000),
        entry('5', '2026-09-10', 'Amazon', 'cat_shopping', -250000),
        entry('6', '2026-09-11', 'Amazon', 'cat_shopping', -250000),
      ],
    });

    const duplicates = insights.filter((i) => i.kind === 'duplicate_charge').map((i) => i.evidence);
    expect(duplicates).toEqual([['2', '3'], ['5', '6']]);
  });

  it('does not call a repeat a duplicate when it is weeks apart', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        entry('1', '2026-09-01', 'Amazon', 'cat_shopping', -250000),
        entry('2', '2026-09-20', 'Amazon', 'cat_shopping', -250000),
      ],
    });

    expect(insights.some((i) => i.kind === 'duplicate_charge')).toBe(false);
  });

  it('reports subscription creep month over month', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        entry('1', '2026-08-08', 'Netflix', 'cat_subscriptions', -64900),
        entry('2', '2026-09-08', 'Netflix', 'cat_subscriptions', -79900),
      ],
    });

    const creep = insights.find((i) => i.kind === 'subscription_creep');
    expect(creep).toBeDefined();
    expect(creep!.sentence).toContain('Rs 150.00');
  });

  it('states what a bill leaves behind', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [],
      upcomingBill: {
        label: 'Electricity',
        amount: paise(234050),
        dueDate: '2026-09-25',
      },
      projectedBalance: paise(5000000),
    });

    const bill = insights.find((i) => i.kind === 'bill_due');
    expect(bill!.sentence).toBe('Electricity takes Rs 2,340.50 on 25 Sep, leaving Rs 47,659.50.');
  });

  it('states the share of income kept', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [entry('1', '2026-09-01', 'Rent', 'cat_utilities', -3000000)],
      income: paise(10000000),
    });

    const rate = insights.find((i) => i.kind === 'savings_rate');
    expect(rate!.sentence).toContain('70%');
  });

  it('never recommends, ranks or names an investment product', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 12,
      entries: [
        entry('1', '2026-08-05', 'Swiggy', 'cat_food', -100000),
        entry('2', '2026-09-05', 'Swiggy', 'cat_food', -300000),
        entry('3', '2026-09-06', 'Groww', 'cat_investment', -500000),
      ],
      income: paise(10000000),
    });

    // Spending commentary is unregulated; tailored product guidance is not.
    const banned =
      /\b(invest|consider|recommend|should|index fund|mutual fund|portfolio|stock|SIP into)\b/i;

    for (const insight of insights) {
      expect(insight.sentence).not.toMatch(banned);
    }
  });

  it('carries evidence for every claim it makes', () => {
    const insights = generateInsights({
      today: '2026-09-20',
      monthsOfHistory: 6,
      entries: [
        entry('1', '2026-08-05', 'Swiggy', 'cat_food', -100000),
        entry('2', '2026-09-05', 'Swiggy', 'cat_food', -300000),
      ],
    });

    const needsEvidence = insights.filter(
      (i) => i.kind !== 'bill_due' && i.kind !== 'savings_rate'
    );

    expect(needsEvidence.length).toBeGreaterThan(0);
    for (const insight of needsEvidence) {
      expect(insight.evidence.length).toBeGreaterThan(0);
    }
  });
});
