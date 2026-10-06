import { Paise, paise, sum, format } from '@/money/money';
import { parseDecimal } from '@/lib/decimal';
import type { Id } from '@/lib/ulid';

/**
 * Every quantity is a whole number of base units — pieces, grams or
 * millilitres — so a kilo of paneer is 1000 and half a litre of buttermilk is
 * 500. Nothing here ever needs a fraction.
 */
export type Unit = 'piece' | 'g' | 'ml';

export type Product = {
  id: Id;
  name: string;
  /** Paneer from Anand and Paneer from Param are two products, each with its own prices. */
  brand?: string;
  /** Where a photo of it is kept on the phone (private to the app), if one was added. */
  photo?: string;
  unit: Unit;
  categoryId?: Id;
  /** Milligrams of protein per 100 g or 100 ml, or per piece. */
  proteinMg?: number;
  /** A regular buy — bread, milk — rather than a one-off. */
  isStaple: boolean;
  archivedAt?: string;
  createdAt: string;
};

export type Purchase = {
  id: Id;
  productId: Id;
  quantity: number;
  amount: Paise;
  purchasedAt: string;
  /** The bank transaction this purchase is one line of, when itemised. */
  entryId?: Id;
  store?: string;
  createdAt: string;
};

export type ConsumptionKind = 'used' | 'wasted' | 'adjust';

export type Consumption = {
  id: Id;
  productId: Id;
  /** Positive for used and wasted; an adjust is negative when more was found. */
  quantity: number;
  kind: ConsumptionKind;
  consumedAt: string;
  note?: string;
  createdAt: string;
};

/** "Paneer · Anand", or just "Paneer" when no brand was given. */
export const productLabel = (product: Pick<Product, 'name' | 'brand'>): string =>
  product.brand ? `${product.name} · ${product.brand}` : product.name;

/** A brand as typed, tidied: no stray spaces, and nothing at all if it was left blank. */
export const tidyBrand = (brand: string | undefined): string | undefined => {
  const tidy = (brand ?? '').trim().replace(/\s+/g, ' ');
  return tidy === '' ? undefined : tidy;
};

/** Prices read per piece, per kilo, per litre — the way shops quote them. */
const PRICE_BASIS: Record<Unit, number> = { piece: 1, g: 1000, ml: 1000 };

/** Nutrition labels quote protein per 100 g or 100 ml. */
const PROTEIN_BASIS: Record<Unit, number> = { piece: 1, g: 100, ml: 100 };

const PRICE_LABEL: Record<Unit, string> = { piece: 'pc', g: 'kg', ml: 'L' };

export type InputUnit = 'pcs' | 'g' | 'kg' | 'ml' | 'L';

const INPUT_FACTOR: Record<InputUnit, number> = {
  pcs: 1,
  g: 1,
  kg: 1000,
  ml: 1,
  L: 1000,
};

export const inputUnitsFor = (unit: Unit): InputUnit[] => {
  if (unit === 'piece') return ['pcs'];
  if (unit === 'g') return ['g', 'kg'];
  return ['ml', 'L'];
};

/**
 * Reads what the user typed — "1.5" kg, "250" g, "2" pcs — as base units.
 * Returns null for anything that is not a positive amount, and for a
 * fractional number of pieces.
 */
export const parseQuantity = (text: string, input: InputUnit): number | null => {
  const thousandths = parseDecimal(text, 3);
  if (thousandths === null || thousandths <= 0) return null;

  const scaled = thousandths * INPUT_FACTOR[input];

  if (input === 'pcs' && scaled % 1000 !== 0) return null;

  const base = Math.round(scaled / 1000);
  return base >= 1 ? base : null;
};

const trimmed = (value: number): string =>
  value.toFixed(2).replace(/\.?0+$/, '');

export const formatQuantity = (quantity: number, unit: Unit): string => {
  if (unit === 'piece') return `${quantity} ${quantity === 1 ? 'pc' : 'pcs'}`;

  const big = unit === 'g' ? 'kg' : 'L';
  if (Math.abs(quantity) >= 1000) return `${trimmed(quantity / 1000)} ${big}`;
  return `${quantity} ${unit}`;
};

/** What one piece, kilo or litre cost, in whole paise. */
export const unitPrice = (amount: Paise, quantity: number, unit: Unit): Paise =>
  paise(Math.round((amount * PRICE_BASIS[unit]) / quantity));

export const formatUnitPrice = (price: Paise, unit: Unit): string =>
  `${format(price)} / ${PRICE_LABEL[unit]}`;

/**
 * A quantity as the text and unit to put back in the "How much" box: 250 g stays
 * 250 g, 1000 g becomes 1 kg, 1500 g becomes 1.5 kg, 2 pieces stay 2.
 */
export const quantityInput = (quantity: number, unit: Unit): { text: string; inputUnit: InputUnit } => {
  if (unit === 'piece') return { text: String(quantity), inputUnit: 'pcs' };
  if (quantity < 1000) return { text: String(quantity), inputUnit: unit === 'g' ? 'g' : 'ml' };

  const whole = Math.floor(quantity / 1000);
  const rest = quantity % 1000;
  const fraction = rest === 0 ? '' : `.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
  return { text: `${whole}${fraction}`, inputUnit: unit === 'g' ? 'kg' : 'L' };
};

export type LastPurchase = {
  amount: Paise;
  quantity: number;
  /** How many times it has been bought. */
  count: number;
  date: string;
  /** The most recent earlier purchase at a different price, so a rise is visible. */
  was?: { amount: Paise; quantity: number; date: string };
};

/**
 * What the price used to be, in the way it is easiest to compare: the plain amount when
 * the same quantity was bought, otherwise the price per piece, kilo or litre.
 */
export const wasPrice = (
  unit: Unit,
  last: Pick<LastPurchase, 'amount' | 'quantity' | 'was'>
): { amount: Paise; per?: string } | undefined => {
  if (!last.was) return undefined;
  if (last.was.quantity === last.quantity) return { amount: last.was.amount };
  return { amount: unitPrice(last.was.amount, last.was.quantity, unit), per: PRICE_LABEL[unit] };
};

export const proteinIn = (product: Product, quantity: number): number =>
  product.proteinMg === undefined
    ? 0
    : Math.round((product.proteinMg * quantity) / PROTEIN_BASIS[product.unit]);

export const formatProtein = (milligrams: number): string =>
  `${trimmed(milligrams / 1000)} g`;

/** Paise per gram of protein — the only fair way to compare paneer with powder. */
export const costPerGramProtein = (
  amount: Paise,
  proteinMilligrams: number
): Paise | undefined =>
  proteinMilligrams > 0
    ? paise(Math.round((amount * 1000) / proteinMilligrams))
    : undefined;

const day = (timestamp: string): string => timestamp.slice(0, 10);

const within = (timestamp: string, from: string, to: string): boolean =>
  day(timestamp) >= day(from) && day(timestamp) <= day(to);

const upTo = (timestamp: string, to: string): boolean => day(timestamp) <= day(to);

/** Bought, less everything used, wasted or corrected by a stock count. */
export const onHand = (purchases: Purchase[], consumption: Consumption[]): number =>
  purchases.reduce((total, p) => total + p.quantity, 0) -
  consumption.reduce((total, c) => total + c.quantity, 0);

export type ProductMonth = {
  product: Product;
  bought: number;
  spent: Paise;
  used: number;
  wasted: number;
  /** As of the end of the month, never below zero. */
  onHand: number;
  purchaseCount: number;
  /** Average paid this month, per piece, kilo or litre. */
  unitPrice?: Paise;
  proteinMg: number;
  /**
   * True when nothing was logged as used, so protein is counted from what was
   * bought instead. Stated rather than hidden, because it is a guess.
   */
  proteinEstimated: boolean;
  costPerGramProtein?: Paise;
};

export const productMonth = (
  product: Product,
  purchases: Purchase[],
  consumption: Consumption[],
  from: string,
  to: string
): ProductMonth => {
  const mine = purchases.filter((p) => p.productId === product.id);
  const used = consumption.filter((c) => c.productId === product.id);

  const boughtRows = mine.filter((p) => within(p.purchasedAt, from, to));
  const usedRows = used.filter((c) => within(c.consumedAt, from, to));

  const bought = boughtRows.reduce((total, p) => total + p.quantity, 0);
  const spent = sum(boughtRows.map((p) => p.amount));
  const usedQty = usedRows
    .filter((c) => c.kind === 'used')
    .reduce((total, c) => total + c.quantity, 0);
  const wasted = usedRows
    .filter((c) => c.kind === 'wasted')
    .reduce((total, c) => total + c.quantity, 0);

  const stock = onHand(
    mine.filter((p) => upTo(p.purchasedAt, to)),
    used.filter((c) => upTo(c.consumedAt, to))
  );

  const proteinEstimated = usedQty === 0 && bought > 0;
  const proteinMg = proteinIn(product, proteinEstimated ? bought : usedQty);

  return {
    product,
    bought,
    spent,
    used: usedQty,
    wasted,
    onHand: Math.max(0, stock),
    purchaseCount: boughtRows.length,
    unitPrice: bought > 0 ? unitPrice(spent, bought, product.unit) : undefined,
    proteinMg,
    proteinEstimated,
    costPerGramProtein: costPerGramProtein(spent, proteinIn(product, bought)),
  };
};

export type PricePoint = {
  purchaseId: Id;
  date: string;
  quantity: number;
  amount: Paise;
  unitPrice: Paise;
  store?: string;
};

export const priceHistory = (product: Product, purchases: Purchase[]): PricePoint[] =>
  purchases
    .filter((p) => p.productId === product.id)
    .sort((a, b) => (a.purchasedAt < b.purchasedAt ? 1 : -1))
    .map((p) => ({
      purchaseId: p.id,
      date: day(p.purchasedAt),
      quantity: p.quantity,
      amount: p.amount,
      unitPrice: unitPrice(p.amount, p.quantity, product.unit),
      store: p.store,
    }));

export type PriceTrend = {
  latest: Paise;
  previous: Paise;
  /** Whole-number percentage; positive means it got dearer. */
  changePercent: number;
};

/**
 * The latest price against the quantity-weighted average of the purchases
 * before it, so one cheap multipack does not count as much as ten single buys.
 */
export const priceTrend = (product: Product, purchases: Purchase[]): PriceTrend | null => {
  const ordered = purchases
    .filter((p) => p.productId === product.id && p.amount > 0)
    .sort((a, b) => (a.purchasedAt < b.purchasedAt ? -1 : 1));

  if (ordered.length < 2) return null;

  const latest = ordered[ordered.length - 1];
  const earlier = ordered.slice(-6, -1);

  const earlierAmount = sum(earlier.map((p) => p.amount));
  const earlierQuantity = earlier.reduce((total, p) => total + p.quantity, 0);

  const previous = unitPrice(earlierAmount, earlierQuantity, product.unit);
  const current = unitPrice(latest.amount, latest.quantity, product.unit);

  if (previous === 0) return null;

  return {
    latest: current,
    previous,
    changePercent: Math.round(((current - previous) / previous) * 100),
  };
};

export type ItemInsightKind = 'waste' | 'price_rise' | 'spend_jump' | 'overbuying';

export type ItemInsight = {
  kind: ItemInsightKind;
  productId: Id;
  sentence: string;
};

const WASTE_SHARE = 0.2;
const PRICE_RISE_PERCENT = 10;
const SPEND_JUMP_RATIO = 1.5;
const OVERBUY_RATIO = 1.5;

/**
 * Where to look first when cutting back. Each one describes what happened to a
 * single product; none of them tells the user what to do about it.
 */
export const itemInsights = (
  current: ProductMonth[],
  previous: ProductMonth[],
  trends: Map<Id, PriceTrend>
): ItemInsight[] => {
  const insights: ItemInsight[] = [];
  const lastMonth = new Map(previous.map((m) => [m.product.id, m]));

  for (const month of current) {
    const { product } = month;
    const qty = (n: number) => formatQuantity(n, product.unit);

    if (month.wasted > 0 && (month.bought === 0 || month.wasted >= month.bought * WASTE_SHARE)) {
      insights.push({
        kind: 'waste',
        productId: product.id,
        sentence:
          month.bought > 0
            ? `You threw away ${Math.round((month.wasted / month.bought) * 100)}% of the ${productLabel(product)} you bought this month, ${qty(month.wasted)} of ${qty(month.bought)}.`
            : `You threw away ${qty(month.wasted)} of ${productLabel(product)} this month.`,
      });
    }

    const trend = trends.get(product.id);
    if (trend && trend.changePercent >= PRICE_RISE_PERCENT && month.purchaseCount > 0) {
      insights.push({
        kind: 'price_rise',
        productId: product.id,
        sentence: `${productLabel(product)} costs ${formatUnitPrice(trend.latest, product.unit)} now, up ${trend.changePercent}% from ${formatUnitPrice(trend.previous, product.unit)}.`,
      });
    }

    const before = lastMonth.get(product.id);
    if (before && before.spent > 0 && month.spent >= before.spent * SPEND_JUMP_RATIO) {
      insights.push({
        kind: 'spend_jump',
        productId: product.id,
        sentence: `You spent ${(month.spent / before.spent).toFixed(1)}x more on ${productLabel(product)} than last month, ${format(month.spent)} against ${format(before.spent)}.`,
      });
    }

    // Buying ahead is normal for bulk items — a kilo tub of protein lasts
    // weeks. What costs money is restocking while plenty is still at home, so
    // this needs repeat trips and at least a month's use left over.
    if (
      month.purchaseCount >= 2 &&
      month.used > 0 &&
      month.bought >= month.used * OVERBUY_RATIO &&
      month.onHand >= month.used
    ) {
      insights.push({
        kind: 'overbuying',
        productId: product.id,
        sentence: `You bought ${qty(month.bought)} of ${productLabel(product)} across ${month.purchaseCount} trips but used ${qty(month.used)}; ${qty(month.onHand)} is still on hand.`,
      });
    }
  }

  return insights;
};

export type InventoryTotals = {
  spent: Paise;
  /** What the regular buys cost this month — the closest thing to a fixed grocery bill. */
  staples: Paise;
  proteinMg: number;
  /** Spent on products that carry any protein. */
  proteinSpend: Paise;
  costPerGramProtein?: Paise;
  itemsBought: number;
};

export const inventoryTotals = (months: ProductMonth[]): InventoryTotals => {
  const withProtein = months.filter((m) => (m.product.proteinMg ?? 0) > 0);
  const proteinSpend = sum(withProtein.map((m) => m.spent));
  const proteinBought = withProtein.reduce(
    (total, m) => total + proteinIn(m.product, m.bought),
    0
  );

  return {
    spent: sum(months.map((m) => m.spent)),
    staples: sum(months.filter((m) => m.product.isStaple).map((m) => m.spent)),
    proteinMg: months.reduce((total, m) => total + m.proteinMg, 0),
    proteinSpend,
    costPerGramProtein: costPerGramProtein(proteinSpend, proteinBought),
    itemsBought: months.filter((m) => m.bought > 0).length,
  };
};
