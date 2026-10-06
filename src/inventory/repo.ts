import { Database, type DatabaseError } from '@/db/client';
import type { SqlValue } from '@/db/driver';
import { generateId, type Id } from '@/lib/ulid';
import { toUTC, now, monthRange, previousMonth } from '@/lib/date';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise, sum, subtract, abs, format } from '@/money/money';
import {
  onHand,
  productMonth,
  priceHistory,
  priceTrend,
  productLabel,
  tidyBrand,
  itemInsights,
  inventoryTotals,
  type Product,
  type Purchase,
  type Consumption,
  type Unit,
  type ProductMonth,
  type PricePoint,
  type PriceTrend,
  type LastPurchase,
  type ItemInsight,
  type InventoryTotals,
} from './model';

export type InventoryError = {
  code:
    | 'INVALID_INPUT'
    | 'DUPLICATE_PRODUCT'
    | 'NOT_FOUND'
    | 'EXCEEDS_TRANSACTION'
    | 'DATABASE';
  message: string;
};

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  photo: string | null;
  unit: string;
  category_id: string | null;
  protein_mg: number | null;
  is_staple: number;
  archived_at: string | null;
  created_at: string;
};

type PurchaseRow = {
  id: string;
  product_id: string;
  quantity: number;
  amount: number;
  purchased_at: string;
  entry_id: string | null;
  store: string | null;
  created_at: string;
};

type ConsumptionRow = {
  id: string;
  product_id: string;
  quantity: number;
  kind: string;
  consumed_at: string;
  note: string | null;
  created_at: string;
};

const toProduct = (row: ProductRow): Product => ({
  id: row.id as Id,
  name: row.name,
  brand: row.brand ?? undefined,
  photo: row.photo ?? undefined,
  unit: row.unit as Unit,
  categoryId: (row.category_id ?? undefined) as Id | undefined,
  proteinMg: row.protein_mg ?? undefined,
  isStaple: row.is_staple === 1,
  archivedAt: row.archived_at ?? undefined,
  createdAt: row.created_at,
});

const toPurchase = (row: PurchaseRow): Purchase => ({
  id: row.id as Id,
  productId: row.product_id as Id,
  quantity: row.quantity,
  amount: paise(row.amount),
  purchasedAt: row.purchased_at,
  entryId: (row.entry_id ?? undefined) as Id | undefined,
  store: row.store ?? undefined,
  createdAt: row.created_at,
});

const toConsumption = (row: ConsumptionRow): Consumption => ({
  id: row.id as Id,
  productId: row.product_id as Id,
  quantity: row.quantity,
  kind: row.kind as Consumption['kind'],
  consumedAt: row.consumed_at,
  note: row.note ?? undefined,
  createdAt: row.created_at,
});

const invalid = (message: string): Result<never, InventoryError> =>
  err({ code: 'INVALID_INPUT', message });

const fromDb = (error: DatabaseError): InventoryError => ({
  code: 'DATABASE',
  message: error.message,
});

const isWholePositive = (n: number): boolean => Number.isInteger(n) && n > 0;

const DATE = /^\d{4}-\d{2}-\d{2}/;

// ---------------------------------------------------------------- products

export const getProduct = (db: Database, id: Id): Product | null => {
  const rows = db.query<ProductRow>(`SELECT * FROM products WHERE id = ?`, [id]);
  return rows.isOk() && rows.value[0] ? toProduct(rows.value[0]) : null;
};

/** The one product with exactly this name and brand (no brand means the plain one). */
export const findProduct = (db: Database, name: string, brand?: string): Product | null => {
  const rows = db.query<ProductRow>(
    `SELECT * FROM products WHERE name = ? COLLATE NOCASE AND COALESCE(brand, '') = ? COLLATE NOCASE`,
    [name.trim(), tidyBrand(brand) ?? '']
  );
  return rows.isOk() && rows.value[0] ? toProduct(rows.value[0]) : null;
};

/**
 * A product by name alone, for callers that only know the name (a bill line): the plain
 * one if there is one, otherwise the first brand added.
 */
export const findProductByName = (db: Database, name: string): Product | null => {
  const rows = db.query<ProductRow>(
    `SELECT * FROM products WHERE name = ? COLLATE NOCASE
     ORDER BY (brand IS NOT NULL), created_at LIMIT 1`,
    [name.trim()]
  );
  return rows.isOk() && rows.value[0] ? toProduct(rows.value[0]) : null;
};

export const listProducts = (
  db: Database,
  options: { includeArchived?: boolean } = {}
): Product[] => {
  const rows = db.query<ProductRow>(
    options.includeArchived
      ? `SELECT * FROM products ORDER BY name COLLATE NOCASE, brand COLLATE NOCASE`
      : `SELECT * FROM products WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE, brand COLLATE NOCASE`
  );
  return rows.isOk() ? rows.value.map(toProduct) : [];
};

export type NewProduct = {
  name: string;
  brand?: string;
  photo?: string;
  unit: Unit;
  categoryId?: Id;
  proteinMg?: number;
  isStaple?: boolean;
};

export const createProduct = (
  db: Database,
  input: NewProduct
): Result<Product, InventoryError> => {
  const name = input.name.trim();
  if (!name) return invalid('Give the product a name');

  if (input.proteinMg !== undefined && !(Number.isInteger(input.proteinMg) && input.proteinMg >= 0)) {
    return invalid('Protein must be a whole number of milligrams');
  }

  const brand = tidyBrand(input.brand);
  if (findProduct(db, name, brand)) {
    return err({ code: 'DUPLICATE_PRODUCT', message: `${productLabel({ name, brand })} is already tracked` });
  }

  const product: Product = {
    id: generateId(),
    name,
    brand,
    photo: input.photo?.trim() || undefined,
    unit: input.unit,
    categoryId: input.categoryId ?? ('cat_groceries' as Id),
    proteinMg: input.proteinMg,
    isStaple: input.isStaple ?? false,
    createdAt: toUTC(now()),
  };

  const written = db.run(
    `INSERT INTO products (id, name, brand, photo, unit, category_id, protein_mg, is_staple, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      product.id,
      product.name,
      product.brand ?? null,
      product.photo ?? null,
      product.unit,
      product.categoryId ?? null,
      product.proteinMg ?? null,
      product.isStaple ? 1 : 0,
      product.createdAt,
    ]
  );

  return written.isOk() ? ok(product) : err(fromDb(written.error));
};

export const updateProduct = (
  db: Database,
  id: Id,
  /** For brand and photo, leaving it out keeps it and an empty string clears it. */
  patch: Partial<Pick<Product, 'name' | 'brand' | 'photo' | 'isStaple' | 'proteinMg' | 'categoryId'>>
): Result<Product, InventoryError> => {
  const existing = getProduct(db, id);
  if (!existing) return err({ code: 'NOT_FOUND', message: 'No such product' });

  const next: Product = {
    ...existing,
    ...patch,
    name: (patch.name ?? existing.name).trim(),
    // Not given means keep what it has; an empty string means clear it.
    brand: patch.brand !== undefined ? tidyBrand(patch.brand) : existing.brand,
    photo: patch.photo !== undefined ? patch.photo.trim() || undefined : existing.photo,
  };
  if (!next.name) return invalid('Give the product a name');

  const clash = findProduct(db, next.name, next.brand);
  if (clash && clash.id !== id) {
    return err({ code: 'DUPLICATE_PRODUCT', message: `${productLabel(next)} is already tracked` });
  }

  const written = db.run(
    `UPDATE products SET name = ?, brand = ?, photo = ?, is_staple = ?, protein_mg = ?, category_id = ? WHERE id = ?`,
    [next.name, next.brand ?? null, next.photo ?? null, next.isStaple ? 1 : 0, next.proteinMg ?? null, next.categoryId ?? null, id]
  );

  return written.isOk() ? ok(next) : err(fromDb(written.error));
};

// --------------------------------------------------------------- purchases

const purchaseRows = (db: Database, where = '', params: SqlValue[] = []): Purchase[] => {
  const rows = db.query<PurchaseRow>(
    `SELECT * FROM purchases ${where} ORDER BY purchased_at, created_at`,
    params
  );
  return rows.isOk() ? rows.value.map(toPurchase) : [];
};

const consumptionRows = (
  db: Database,
  where = '',
  params: SqlValue[] = []
): Consumption[] => {
  const rows = db.query<ConsumptionRow>(
    `SELECT * FROM consumption ${where} ORDER BY consumed_at, created_at`,
    params
  );
  return rows.isOk() ? rows.value.map(toConsumption) : [];
};

export const purchasesFor = (db: Database, productId: Id): Purchase[] =>
  purchaseRows(db, 'WHERE product_id = ?', [productId]);

/**
 * What this product cost the last time, how much was bought, and how often — the hint
 * that fills the form, so "Chicken" recalls today's price instead of asking the user to
 * remember it. Prices move (chicken went from 170 to 180 and is still chicken), so the
 * latest purchase is the price; `was` is the last different one, to show what changed.
 */
export const lastPurchaseOf = (db: Database, productId: Id): LastPurchase | null => {
  const purchases = purchasesFor(db, productId);
  if (purchases.length === 0) return null;

  const latest = purchases[purchases.length - 1];
  // Same price per unit means a * q' == a' * q; integers all the way, so no rounding.
  const differs = (p: Purchase) => p.amount > 0 && p.amount * latest.quantity !== latest.amount * p.quantity;
  const before = [...purchases.slice(0, -1)].reverse().find(differs);

  return {
    amount: latest.amount,
    quantity: latest.quantity,
    count: purchases.length,
    date: latest.purchasedAt.slice(0, 10),
    was: before ? { amount: before.amount, quantity: before.quantity, date: before.purchasedAt.slice(0, 10) } : undefined,
  };
};

export const consumptionFor = (db: Database, productId: Id): Consumption[] =>
  consumptionRows(db, 'WHERE product_id = ?', [productId]);

/** How much a bank transaction moved on the user's own account, ignoring sign. */
const transactionAmount = (db: Database, entryId: Id): Paise | null => {
  const rows = db.query<{ amount: number }>(
    `SELECT p.amount FROM postings p
     JOIN accounts a ON a.id = p.account_id
     WHERE p.entry_id = ? AND a.is_system = 0`,
    [entryId]
  );
  if (rows.isErr() || rows.value.length === 0) return null;
  return abs(paise(rows.value[0].amount));
};

export type Itemisation = {
  entryId: Id;
  total: Paise;
  itemised: Paise;
  /** What the lines do not yet account for. */
  remaining: Paise;
  lines: Array<{ purchase: Purchase; product: Product }>;
};

/** A bank transaction broken into what it bought. */
export const itemisationOf = (db: Database, entryId: Id): Itemisation | null => {
  const total = transactionAmount(db, entryId);
  if (total === null) return null;

  const purchases = purchaseRows(db, 'WHERE entry_id = ?', [entryId]);
  const itemised = sum(purchases.map((p) => p.amount));

  return {
    entryId,
    total,
    itemised,
    remaining: subtract(total, itemised),
    lines: purchases.flatMap((purchase) => {
      const product = getProduct(db, purchase.productId);
      return product ? [{ purchase, product }] : [];
    }),
  };
};

export type NewPurchase = {
  productId: Id;
  /** Whole base units: pieces, grams or millilitres. */
  quantity: number;
  amount: Paise;
  purchasedAt: string;
  /** Link to the bank transaction this purchase is part of. */
  entryId?: Id;
  store?: string;
};

/**
 * Records that something was bought.
 *
 * This never writes to the money ledger. The payment already arrives from the
 * bank statement, so a second copy here would double-count it. Linking to
 * that transaction instead breaks it into items, and is refused when the
 * items would add up to more than was actually paid.
 */
export const recordPurchase = (
  db: Database,
  input: NewPurchase
): Result<Purchase, InventoryError> => {
  if (!isWholePositive(input.quantity)) return invalid('Enter how much you bought');
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    return invalid('Enter what you paid');
  }
  if (!DATE.test(input.purchasedAt)) return invalid('Enter the date you bought it');

  const product = getProduct(db, input.productId);
  if (!product) return err({ code: 'NOT_FOUND', message: 'No such product' });

  if (input.entryId) {
    const itemisation = itemisationOf(db, input.entryId);
    if (!itemisation) {
      return err({ code: 'NOT_FOUND', message: 'That transaction no longer exists' });
    }
    if (input.amount > itemisation.remaining) {
      return err({
        code: 'EXCEEDS_TRANSACTION',
        message: `Only ${format(itemisation.remaining)} of this transaction is left to itemise`,
      });
    }
  }

  const purchase: Purchase = {
    id: generateId(),
    productId: input.productId,
    quantity: input.quantity,
    amount: input.amount,
    purchasedAt: input.purchasedAt,
    entryId: input.entryId,
    store: input.store?.trim() || undefined,
    createdAt: toUTC(now()),
  };

  const written = db.run(
    `INSERT INTO purchases (id, product_id, quantity, amount, purchased_at, entry_id, store, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      purchase.id,
      purchase.productId,
      purchase.quantity,
      purchase.amount,
      purchase.purchasedAt,
      purchase.entryId ?? null,
      purchase.store ?? null,
      purchase.createdAt,
    ]
  );

  return written.isOk() ? ok(purchase) : err(fromDb(written.error));
};

export const deletePurchase = (db: Database, id: Id): Result<void, InventoryError> => {
  const written = db.run(`DELETE FROM purchases WHERE id = ?`, [id]);
  return written.isOk() ? ok(undefined) : err(fromDb(written.error));
};

// ------------------------------------------------------------- consumption

export const onHandOf = (db: Database, productId: Id): number =>
  onHand(purchasesFor(db, productId), consumptionFor(db, productId));

export type NewConsumption = {
  productId: Id;
  quantity: number;
  kind: 'used' | 'wasted';
  consumedAt: string;
  note?: string;
};

const insertConsumption = (
  db: Database,
  row: Omit<Consumption, 'id' | 'createdAt'>
): Result<Consumption, InventoryError> => {
  const consumption: Consumption = { ...row, id: generateId(), createdAt: toUTC(now()) };

  const written = db.run(
    `INSERT INTO consumption (id, product_id, quantity, kind, consumed_at, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      consumption.id,
      consumption.productId,
      consumption.quantity,
      consumption.kind,
      consumption.consumedAt,
      consumption.note ?? null,
      consumption.createdAt,
    ]
  );

  return written.isOk() ? ok(consumption) : err(fromDb(written.error));
};

/** Records something eaten, drunk, used up — or thrown away. */
export const logConsumption = (
  db: Database,
  input: NewConsumption
): Result<Consumption, InventoryError> => {
  if (!isWholePositive(input.quantity)) return invalid('Enter how much');
  if (!DATE.test(input.consumedAt)) return invalid('Enter a date');
  if (!getProduct(db, input.productId)) {
    return err({ code: 'NOT_FOUND', message: 'No such product' });
  }

  return insertConsumption(db, {
    productId: input.productId,
    quantity: input.quantity,
    kind: input.kind,
    consumedAt: input.consumedAt,
    note: input.note?.trim() || undefined,
  });
};

export type StockCount = {
  /** What the count changed: 'used' if less was left than tracked. */
  recorded: 'used' | 'adjust' | null;
  quantity: number;
  onHand: number;
};

/**
 * The low-effort way to track usage: say how much is left, and the difference
 * from what was tracked is recorded as used. Logging every glass of buttermilk
 * is not realistic; checking the fridge once a week is.
 */
export const countStock = (
  db: Database,
  input: { productId: Id; remaining: number; countedAt: string }
): Result<StockCount, InventoryError> => {
  if (!Number.isInteger(input.remaining) || input.remaining < 0) {
    return invalid('Enter how much is left');
  }
  if (!DATE.test(input.countedAt)) return invalid('Enter a date');
  if (!getProduct(db, input.productId)) {
    return err({ code: 'NOT_FOUND', message: 'No such product' });
  }

  const tracked = onHandOf(db, input.productId);
  const gone = tracked - input.remaining;

  if (gone === 0) return ok({ recorded: null, quantity: 0, onHand: input.remaining });

  const written = insertConsumption(db, {
    productId: input.productId,
    // Less left than tracked means it was used. More left means stock existed
    // that was never recorded, so the count corrects the books upward.
    quantity: gone,
    kind: gone > 0 ? 'used' : 'adjust',
    consumedAt: input.countedAt,
    note: 'Stock count',
  });

  if (written.isErr()) return err(written.error);

  return ok({
    recorded: gone > 0 ? 'used' : 'adjust',
    quantity: Math.abs(gone),
    onHand: input.remaining,
  });
};

export const deleteConsumption = (db: Database, id: Id): Result<void, InventoryError> => {
  const written = db.run(`DELETE FROM consumption WHERE id = ?`, [id]);
  return written.isOk() ? ok(undefined) : err(fromDb(written.error));
};

// ----------------------------------------------------------------- reports

export type InventoryMonth = {
  from: string;
  to: string;
  rows: ProductMonth[];
  totals: InventoryTotals;
  insights: ItemInsight[];
};

const activeIn = (month: ProductMonth): boolean =>
  month.bought > 0 || month.used > 0 || month.wasted > 0 || month.onHand > 0;

/** Every product for one month: what was bought, used, left, and spent. */
export const inventoryMonth = (db: Database, month: Date): InventoryMonth => {
  const products = listProducts(db);
  const purchases = purchaseRows(db);
  const consumption = consumptionRows(db);

  const current = monthRange(month);
  const before = monthRange(previousMonth(month));

  const rows = products
    .map((p) => productMonth(p, purchases, consumption, current.from, current.to))
    .filter(activeIn)
    .sort((a, b) => b.spent - a.spent || a.product.name.localeCompare(b.product.name));

  const previousRows = products.map((p) =>
    productMonth(p, purchases, consumption, before.from, before.to)
  );

  const trends = new Map<Id, PriceTrend>();
  for (const product of products) {
    const trend = priceTrend(
      product,
      purchases.filter((p) => p.purchasedAt.slice(0, 10) <= current.to.slice(0, 10))
    );
    if (trend) trends.set(product.id, trend);
  }

  return {
    from: current.from,
    to: current.to,
    rows,
    totals: inventoryTotals(rows),
    insights: itemInsights(rows, previousRows, trends),
  };
};

export type ActivityItem =
  | { kind: 'purchase'; id: Id; date: string; quantity: number; amount: Paise; store?: string }
  | { kind: Consumption['kind']; id: Id; date: string; quantity: number; note?: string };

export type ProductDetail = {
  product: Product;
  month: ProductMonth;
  trend: PriceTrend | null;
  history: PricePoint[];
  activity: ActivityItem[];
};

export const productDetail = (
  db: Database,
  productId: Id,
  month = new Date()
): ProductDetail | null => {
  const product = getProduct(db, productId);
  if (!product) return null;

  const purchases = purchasesFor(db, productId);
  const consumption = consumptionFor(db, productId);
  const range = monthRange(month);

  const activity: ActivityItem[] = [
    ...purchases.map((p) => ({
      kind: 'purchase' as const,
      id: p.id,
      date: p.purchasedAt.slice(0, 10),
      quantity: p.quantity,
      amount: p.amount,
      store: p.store,
    })),
    ...consumption.map((c) => ({
      kind: c.kind,
      id: c.id,
      date: c.consumedAt.slice(0, 10),
      quantity: c.quantity,
      note: c.note,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    product,
    month: productMonth(product, purchases, consumption, range.from, range.to),
    trend: priceTrend(product, purchases),
    history: priceHistory(product, purchases),
    activity,
  };
};

/** Every row the inventory holds, for backups. */
export const inventoryRows = (
  db: Database
): { products: Product[]; purchases: Purchase[]; consumption: Consumption[] } => ({
  products: listProducts(db, { includeArchived: true }),
  purchases: purchaseRows(db),
  consumption: consumptionRows(db),
});
