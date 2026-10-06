import { describe, it, expect } from 'vitest';
import {
  parseQuantity,
  formatQuantity,
  unitPrice,
  formatUnitPrice,
  proteinIn,
  formatProtein,
  costPerGramProtein,
  onHand,
  productMonth,
  priceHistory,
  priceTrend,
  itemInsights,
  inventoryTotals,
  inputUnitsFor,
  productLabel,
  tidyBrand,
  quantityInput,
  wasPrice,
  type Product,
  type Purchase,
  type Consumption,
  type PriceTrend,
} from './model';
import { paise, format } from '@/money/money';
import type { Id } from '@/lib/ulid';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p_paneer' as Id,
  name: 'Paneer',
  unit: 'g',
  proteinMg: 18000,
  isStaple: true,
  createdAt: '2026-01-01',
  ...overrides,
});

let seq = 0;
const bought = (
  productId: string,
  date: string,
  quantity: number,
  amount: number
): Purchase => ({
  id: `buy_${++seq}` as Id,
  productId: productId as Id,
  quantity,
  amount: paise(amount),
  purchasedAt: date,
  createdAt: date,
});

const consumed = (
  productId: string,
  date: string,
  quantity: number,
  kind: Consumption['kind'] = 'used'
): Consumption => ({
  id: `use_${++seq}` as Id,
  productId: productId as Id,
  quantity,
  kind,
  consumedAt: date,
  createdAt: date,
});

const SEPT = { from: '2026-09-01', to: '2026-09-30T23:59:59.999' };
const AUG = { from: '2026-08-01', to: '2026-08-31T23:59:59.999' };

describe('quantities', () => {
  it('reads kilos and litres as whole grams and millilitres', () => {
    expect(parseQuantity('1.5', 'kg')).toBe(1500);
    expect(parseQuantity('0.5', 'L')).toBe(500);
    expect(parseQuantity('200', 'g')).toBe(200);
  });

  it('refuses half a piece', () => {
    expect(parseQuantity('2', 'pcs')).toBe(2);
    expect(parseQuantity('1.5', 'pcs')).toBeNull();
  });

  it('refuses zero, negatives and nonsense', () => {
    expect(parseQuantity('0', 'g')).toBeNull();
    expect(parseQuantity('-2', 'pcs')).toBeNull();
    expect(parseQuantity('abc', 'kg')).toBeNull();
    expect(parseQuantity('0.0001', 'kg')).toBeNull();
  });

  it('offers the input units that make sense for each product', () => {
    expect(inputUnitsFor('piece')).toEqual(['pcs']);
    expect(inputUnitsFor('g')).toEqual(['g', 'kg']);
    expect(inputUnitsFor('ml')).toEqual(['ml', 'L']);
  });

  it('formats quantities the way a person would say them', () => {
    expect(formatQuantity(1, 'piece')).toBe('1 pc');
    expect(formatQuantity(6, 'piece')).toBe('6 pcs');
    expect(formatQuantity(200, 'g')).toBe('200 g');
    expect(formatQuantity(1500, 'g')).toBe('1.5 kg');
    expect(formatQuantity(1000, 'ml')).toBe('1 L');
    expect(formatQuantity(2250, 'ml')).toBe('2.25 L');
  });
});

describe('prices', () => {
  it('quotes grams per kilo, as shops do', () => {
    // 200 g of paneer for Rs 90 is Rs 450 a kilo.
    const price = unitPrice(paise(9000), 200, 'g');
    expect(price).toBe(45000);
    expect(formatUnitPrice(price, 'g')).toBe('Rs 450.00 / kg');
  });

  it('quotes pieces per piece and millilitres per litre', () => {
    expect(formatUnitPrice(unitPrice(paise(9000), 2, 'piece'), 'piece')).toBe(
      'Rs 45.00 / pc'
    );
    expect(formatUnitPrice(unitPrice(paise(1500), 500, 'ml'), 'ml')).toBe(
      'Rs 30.00 / L'
    );
  });

  it('rounds to whole paise', () => {
    // Rs 100 for 3 pieces is 3333.33 paise each.
    expect(unitPrice(paise(10000), 3, 'piece')).toBe(3333);
  });
});

describe('protein', () => {
  it('reads protein per 100 g for weighed products', () => {
    // 18 g per 100 g, so 200 g of paneer holds 36 g.
    expect(proteinIn(product(), 200)).toBe(36000);
    expect(formatProtein(36000)).toBe('36 g');
  });

  it('reads protein per piece for counted products', () => {
    const eggs = product({ unit: 'piece', proteinMg: 6000 });
    expect(proteinIn(eggs, 12)).toBe(72000);
  });

  it('counts nothing for a product with no protein recorded', () => {
    expect(proteinIn(product({ proteinMg: undefined }), 500)).toBe(0);
  });

  it('puts powder and paneer on the same scale', () => {
    // 1 kg whey at Rs 2,400 with 78 g per 100 g: Rs 3.08 per gram of protein.
    const whey = costPerGramProtein(paise(240000), 780000);
    // 200 g paneer at Rs 90 with 18 g per 100 g: Rs 2.50 per gram.
    const paneer = costPerGramProtein(paise(9000), 36000);

    expect(format(whey!)).toBe('Rs 3.08');
    expect(format(paneer!)).toBe('Rs 2.50');
  });

  it('has no cost per gram when there is no protein', () => {
    expect(costPerGramProtein(paise(9000), 0)).toBeUndefined();
  });
});

describe('stock on hand', () => {
  it('is what came in less what went out', () => {
    expect(
      onHand(
        [bought('p', '2026-09-01', 10, 100)],
        [consumed('p', '2026-09-02', 3), consumed('p', '2026-09-03', 1, 'wasted')]
      )
    ).toBe(6);
  });

  it('goes up when a stock count finds more than was tracked', () => {
    expect(
      onHand(
        [bought('p', '2026-09-01', 2, 100)],
        [consumed('p', '2026-09-02', -3, 'adjust')]
      )
    ).toBe(5);
  });
});

describe('a product over a month', () => {
  const paneer = product();

  const purchases = [
    bought('p_paneer', '2026-08-28', 200, 8000),
    bought('p_paneer', '2026-09-03', 200, 9000),
    bought('p_paneer', '2026-09-17', 400, 18000),
  ];
  const consumption = [
    consumed('p_paneer', '2026-08-30', 200),
    consumed('p_paneer', '2026-09-10', 150),
    consumed('p_paneer', '2026-09-20', 50, 'wasted'),
  ];

  const sept = productMonth(paneer, purchases, consumption, SEPT.from, SEPT.to);

  it('counts only this month for what was bought and spent', () => {
    expect(sept.bought).toBe(600);
    expect(format(sept.spent)).toBe('Rs 270.00');
    expect(sept.purchaseCount).toBe(2);
  });

  it('separates what was eaten from what was thrown away', () => {
    expect(sept.used).toBe(150);
    expect(sept.wasted).toBe(50);
  });

  it('carries stock across months', () => {
    // 800 bought in total, 400 gone.
    expect(sept.onHand).toBe(400);
  });

  it('averages the price paid this month', () => {
    expect(formatUnitPrice(sept.unitPrice!, 'g')).toBe('Rs 450.00 / kg');
  });

  it('counts protein from what was actually used', () => {
    expect(sept.proteinMg).toBe(27000);
    expect(sept.proteinEstimated).toBe(false);
  });

  it('falls back to what was bought, and says so, when nothing was logged', () => {
    const month = productMonth(paneer, purchases, [], SEPT.from, SEPT.to);
    expect(month.proteinMg).toBe(108000);
    expect(month.proteinEstimated).toBe(true);
  });

  it('never reports negative stock', () => {
    const month = productMonth(
      paneer,
      [],
      [consumed('p_paneer', '2026-09-02', 100)],
      SEPT.from,
      SEPT.to
    );
    expect(month.onHand).toBe(0);
  });

  it('includes a purchase on the last day of the month', () => {
    const month = productMonth(
      paneer,
      [bought('p_paneer', '2026-09-30', 200, 9000)],
      [],
      SEPT.from,
      SEPT.to
    );
    expect(month.bought).toBe(200);
  });
});

describe('price history and trend', () => {
  const paneer = product();

  it('lists purchases newest first with their unit price', () => {
    const history = priceHistory(paneer, [
      bought('p_paneer', '2026-09-03', 200, 9000),
      bought('p_paneer', '2026-09-17', 200, 10000),
    ]);

    expect(history[0].date).toBe('2026-09-17');
    expect(formatUnitPrice(history[0].unitPrice, 'g')).toBe('Rs 500.00 / kg');
  });

  it('needs two purchases before it can say anything', () => {
    expect(priceTrend(paneer, [bought('p_paneer', '2026-09-03', 200, 9000)])).toBeNull();
  });

  it('compares the latest price with the average before it', () => {
    const trend = priceTrend(paneer, [
      bought('p_paneer', '2026-07-01', 200, 8000),
      bought('p_paneer', '2026-08-01', 200, 8000),
      bought('p_paneer', '2026-09-01', 200, 9600),
    ])!;

    expect(formatUnitPrice(trend.previous, 'g')).toBe('Rs 400.00 / kg');
    expect(formatUnitPrice(trend.latest, 'g')).toBe('Rs 480.00 / kg');
    expect(trend.changePercent).toBe(20);
  });

  it('weights earlier prices by how much was bought', () => {
    const trend = priceTrend(paneer, [
      // One big cheap buy and one small dear one average to Rs 420 / kg.
      bought('p_paneer', '2026-07-01', 1000, 40000),
      bought('p_paneer', '2026-08-01', 250, 12500),
      bought('p_paneer', '2026-09-01', 200, 8400),
    ])!;

    expect(formatUnitPrice(trend.previous, 'g')).toBe('Rs 420.00 / kg');
    expect(trend.changePercent).toBe(0);
  });
});

describe('what to look at first', () => {
  const bread = product({ id: 'p_bread' as Id, name: 'Bread', unit: 'piece', proteinMg: undefined });

  const monthOf = (purchases: Purchase[], consumption: Consumption[], range = SEPT) =>
    productMonth(bread, purchases, consumption, range.from, range.to);

  it('flags a product where a fifth or more got thrown away', () => {
    const month = monthOf(
      [bought('p_bread', '2026-09-01', 10, 45000)],
      [consumed('p_bread', '2026-09-08', 3, 'wasted')]
    );

    const [insight] = itemInsights([month], [], new Map());
    expect(insight.kind).toBe('waste');
    expect(insight.sentence).toBe(
      'You threw away 30% of the Bread you bought this month, 3 pcs of 10 pcs.'
    );
  });

  it('stays quiet about a little waste', () => {
    const month = monthOf(
      [bought('p_bread', '2026-09-01', 10, 45000)],
      [consumed('p_bread', '2026-09-08', 1, 'wasted')]
    );
    expect(itemInsights([month], [], new Map())).toHaveLength(0);
  });

  it('flags a price rise of ten percent or more', () => {
    const month = monthOf([bought('p_bread', '2026-09-01', 1, 5000)], []);
    const trends = new Map<Id, PriceTrend>([
      ['p_bread' as Id, { latest: paise(5000), previous: paise(4500), changePercent: 11 }],
    ]);

    const [insight] = itemInsights([month], [], trends);
    expect(insight.kind).toBe('price_rise');
    expect(insight.sentence).toBe(
      'Bread costs Rs 50.00 / pc now, up 11% from Rs 45.00 / pc.'
    );
  });

  it('flags spending that jumped against last month', () => {
    const now = monthOf([bought('p_bread', '2026-09-01', 10, 50000)], []);
    const before = monthOf([bought('p_bread', '2026-08-01', 5, 25000)], [], AUG);

    const insight = itemInsights([now], [before], new Map()).find(
      (i) => i.kind === 'spend_jump'
    )!;
    expect(insight.sentence).toBe(
      'You spent 2.0x more on Bread than last month, Rs 500.00 against Rs 250.00.'
    );
  });

  it('flags restocking while plenty was still at home', () => {
    const month = monthOf(
      [bought('p_bread', '2026-09-01', 6, 27000), bought('p_bread', '2026-09-10', 6, 27000)],
      [consumed('p_bread', '2026-09-15', 4)]
    );

    const insight = itemInsights([month], [], new Map()).find(
      (i) => i.kind === 'overbuying'
    )!;
    expect(insight.sentence).toBe(
      'You bought 12 pcs of Bread across 2 trips but used 4 pcs; 8 pcs is still on hand.'
    );
  });

  it('does not call one bulk buy overbuying', () => {
    const whey = product({ id: 'p_whey' as Id, name: 'Whey', unit: 'g' });
    const month = productMonth(
      whey,
      [bought('p_whey', '2026-09-01', 1000, 240000)],
      [consumed('p_whey', '2026-09-05', 90)],
      SEPT.from,
      SEPT.to
    );

    expect(itemInsights([month], [], new Map())).toHaveLength(0);
  });

  it('never tells the user what to do', () => {
    const month = monthOf(
      [bought('p_bread', '2026-09-01', 12, 54000)],
      [consumed('p_bread', '2026-09-08', 4, 'wasted'), consumed('p_bread', '2026-09-15', 2)]
    );

    for (const insight of itemInsights([month], [], new Map())) {
      expect(insight.sentence).not.toMatch(/\b(should|must|stop|avoid|consider|try)\b/i);
    }
  });
});

describe('month totals', () => {
  it('adds up spend, staples and protein across products', () => {
    const paneer = product();
    const chips = product({
      id: 'p_chips' as Id,
      name: 'Chips',
      unit: 'piece',
      proteinMg: undefined,
      isStaple: false,
    });

    const purchases = [
      bought('p_paneer', '2026-09-03', 200, 9000),
      bought('p_chips', '2026-09-04', 2, 4000),
    ];

    const totals = inventoryTotals([
      productMonth(paneer, purchases, [], SEPT.from, SEPT.to),
      productMonth(chips, purchases, [], SEPT.from, SEPT.to),
    ]);

    expect(format(totals.spent)).toBe('Rs 130.00');
    expect(format(totals.staples)).toBe('Rs 90.00');
    expect(format(totals.proteinSpend)).toBe('Rs 90.00');
    expect(formatProtein(totals.proteinMg)).toBe('36 g');
    expect(format(totals.costPerGramProtein!)).toBe('Rs 2.50');
    expect(totals.itemsBought).toBe(2);
  });
});

describe('brands and putting a quantity back in the form', () => {
  it('labels a product with its brand, when it has one', () => {
    expect(productLabel({ name: 'Paneer', brand: 'Anand' })).toBe('Paneer · Anand');
    expect(productLabel({ name: 'Paneer' })).toBe('Paneer');
  });

  it('tidies a brand: no stray spaces, and blank means none', () => {
    expect(tidyBrand('  Anand   Dairy ')).toBe('Anand Dairy');
    expect(tidyBrand('   ')).toBeUndefined();
    expect(tidyBrand(undefined)).toBeUndefined();
  });

  it('turns a stored quantity back into what to type: 250 g, 1 kg, 1.5 L, 2 pcs', () => {
    expect(quantityInput(250, 'g')).toEqual({ text: '250', inputUnit: 'g' });
    expect(quantityInput(1000, 'g')).toEqual({ text: '1', inputUnit: 'kg' });
    expect(quantityInput(1500, 'g')).toEqual({ text: '1.5', inputUnit: 'kg' });
    expect(quantityInput(1250, 'g')).toEqual({ text: '1.25', inputUnit: 'kg' });
    expect(quantityInput(1005, 'g')).toEqual({ text: '1.005', inputUnit: 'kg' });
    expect(quantityInput(500, 'ml')).toEqual({ text: '500', inputUnit: 'ml' });
    expect(quantityInput(1500, 'ml')).toEqual({ text: '1.5', inputUnit: 'L' });
    expect(quantityInput(2, 'piece')).toEqual({ text: '2', inputUnit: 'pcs' });
  });

  it('reads back what it wrote, for every quantity', () => {
    for (const [quantity, unit] of [[250, 'g'], [1000, 'g'], [1750, 'g'], [30, 'piece'], [2500, 'ml']] as const) {
      const { text, inputUnit } = quantityInput(quantity, unit);
      expect(parseQuantity(text, inputUnit)).toBe(quantity);
    }
  });

  it('says what the price was before: the plain amount for the same quantity, else per kilo', () => {
    const same = { amount: paise(18000), quantity: 250, was: { amount: paise(17000), quantity: 250, date: '2026-08-19' } };
    expect(wasPrice('g', same)).toEqual({ amount: paise(17000) });

    const other = { amount: paise(66000), quantity: 1000, was: { amount: paise(30000), quantity: 500, date: '2026-08-01' } };
    expect(wasPrice('g', other)).toEqual({ amount: paise(60000), per: 'kg' });

    expect(wasPrice('g', { amount: paise(18000), quantity: 250 })).toBeUndefined();
  });
});
