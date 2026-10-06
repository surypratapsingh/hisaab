import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { importStatement } from '@/repo/import';
import { monthSummary } from '@/repo/views';
import { paise, format } from '@/money/money';
import type { Id } from '@/lib/ulid';
import {
  createProduct,
  updateProduct,
  listProducts,
  findProduct,
  findProductByName,
  lastPurchaseOf,
  recordPurchase,
  deletePurchase,
  logConsumption,
  countStock,
  onHandOf,
  itemisationOf,
  inventoryMonth,
  productDetail,
} from './repo';
import { formatQuantity, formatUnitPrice, formatProtein, productLabel } from './model';

const HDFC_HEADER =
  'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description';

let db: Database;
let bank: Account;

beforeEach(() => {
  db = new Database(new NodeSqliteDriver());
  db.initialize();
  bank = db
    .createAccount({ name: 'HDFC Savings', kind: 'asset', last4: '1234', isSystem: false })
    .getOrNull()!;
});

afterEach(() => db.close());

const newProduct = (name: string, unit: 'piece' | 'g' | 'ml', extra = {}) =>
  createProduct(db, { name, unit, ...extra }).getOrNull()!;

describe('brands, photos and prices that move', () => {
  it('keeps Paneer from two brands as two products, each with its own history', () => {
    const anand = newProduct('Paneer', 'g', { brand: 'Anand' });
    const param = newProduct('Paneer', 'g', { brand: '  Param ' });
    const plain = newProduct('Paneer', 'g');

    expect(new Set([anand.id, param.id, plain.id]).size).toBe(3);
    expect(param.brand).toBe('Param'); // tidied
    expect(productLabel(anand)).toBe('Paneer · Anand');
    expect(productLabel(plain)).toBe('Paneer');
    expect(findProduct(db, 'paneer', 'anand')!.id).toBe(anand.id);
    expect(findProduct(db, 'Paneer')!.id).toBe(plain.id);
    expect(listProducts(db).map(productLabel)).toEqual(['Paneer', 'Paneer · Anand', 'Paneer · Param']);
  });

  it('refuses the same name and brand twice, whatever the case, and a blank brand counts as none', () => {
    newProduct('Paneer', 'g', { brand: 'Anand' });
    for (const brand of ['ANAND', ' anand ']) {
      const again = createProduct(db, { name: 'paneer', brand, unit: 'g' });
      expect(again.isErr() && again.error.code).toBe('DUPLICATE_PRODUCT');
    }
    newProduct('Bread', 'piece');
    expect(createProduct(db, { name: 'Bread', brand: '   ', unit: 'piece' }).isErr()).toBe(true);
  });

  it('finds a product by name alone: the plain one first, else the first brand added', () => {
    const anand = newProduct('Paneer', 'g', { brand: 'Anand' });
    newProduct('Paneer', 'g', { brand: 'Param' });
    expect(findProductByName(db, 'Paneer')!.id).toBe(anand.id);

    const plain = newProduct('Paneer', 'g');
    expect(findProductByName(db, 'Paneer')!.id).toBe(plain.id);
  });

  it('stores a photo, changes it, and clears brand and photo with an empty string', () => {
    const butter = newProduct('Peanut butter', 'g', { brand: 'MyFitness', photo: 'file:///private/photos/a.jpg' });
    expect(getPhoto(butter.id)).toBe('file:///private/photos/a.jpg');

    updateProduct(db, butter.id, { photo: 'file:///private/photos/b.jpg' });
    expect(getPhoto(butter.id)).toBe('file:///private/photos/b.jpg');

    const cleared = updateProduct(db, butter.id, { brand: '', photo: '' }).getOrNull()!;
    expect(cleared.brand).toBeUndefined();
    expect(cleared.photo).toBeUndefined();
  });

  it('keeps the brand and photo when an edit does not mention them', () => {
    const butter = newProduct('Peanut butter', 'g', { brand: 'MyFitness', photo: 'file:///private/photos/a.jpg' });
    const renamed = updateProduct(db, butter.id, { name: 'Crunchy peanut butter', brand: undefined, photo: undefined }).getOrNull()!;
    expect(renamed.name).toBe('Crunchy peanut butter');
    expect(renamed.brand).toBe('MyFitness');
    expect(getPhoto(butter.id)).toBe('file:///private/photos/a.jpg');
  });

  it('will not rename or re-brand one product into another that already exists', () => {
    newProduct('Paneer', 'g', { brand: 'Anand' });
    const param = newProduct('Paneer', 'g', { brand: 'Param' });
    const clash = updateProduct(db, param.id, { brand: 'anand' });
    expect(clash.isErr() && clash.error.code).toBe('DUPLICATE_PRODUCT');
  });

  it('takes the last price as the price, and remembers what it was before', () => {
    const chicken = newProduct('Chicken', 'g');
    for (const day of ['05', '12', '19']) {
      recordPurchase(db, { productId: chicken.id, quantity: 250, amount: paise(17000), purchasedAt: `2026-08-${day}` });
    }
    let last = lastPurchaseOf(db, chicken.id)!;
    expect(format(last.amount)).toBe('Rs 170.00');
    expect(last.was).toBeUndefined();

    recordPurchase(db, { productId: chicken.id, quantity: 250, amount: paise(18000), purchasedAt: '2026-09-26' });
    last = lastPurchaseOf(db, chicken.id)!;
    expect(format(last.amount)).toBe('Rs 180.00');
    expect(last.quantity).toBe(250);
    expect(last.count).toBe(4);
    expect(last.date).toBe('2026-09-26');
    expect(format(last.was!.amount)).toBe('Rs 170.00');
    expect(last.was!.date).toBe('2026-08-19');
  });

  it('does not call a different quantity at the same rate a price change', () => {
    const butter = newProduct('Peanut butter', 'g');
    recordPurchase(db, { productId: butter.id, quantity: 500, amount: paise(30000), purchasedAt: '2026-08-01' });
    recordPurchase(db, { productId: butter.id, quantity: 1000, amount: paise(60000), purchasedAt: '2026-09-01' });
    expect(lastPurchaseOf(db, butter.id)!.was).toBeUndefined(); // 300 for 500 g is 600 for 1 kg

    recordPurchase(db, { productId: butter.id, quantity: 1000, amount: paise(66000), purchasedAt: '2026-10-01' });
    const last = lastPurchaseOf(db, butter.id)!;
    expect(format(last.amount)).toBe('Rs 660.00');
    expect(format(last.was!.amount)).toBe('Rs 600.00');
  });

  it('has nothing to say about a product that was never bought', () => {
    expect(lastPurchaseOf(db, newProduct('Ghee', 'g').id)).toBeNull();
  });
});

const getPhoto = (id: Id): string | undefined =>
  db.query<{ photo: string | null }>('SELECT photo FROM products WHERE id = ?', [id]).getOrNull()![0].photo ?? undefined;

describe('products', () => {
  it('creates a product filed under groceries by default', () => {
    const paneer = newProduct('Paneer', 'g', { proteinMg: 18000, isStaple: true });

    expect(paneer.categoryId).toBe('cat_groceries');
    expect(paneer.isStaple).toBe(true);
    expect(findProductByName(db, 'paneer')!.id).toBe(paneer.id);
  });

  it('refuses a second product with the same name, whatever the case', () => {
    newProduct('Bread', 'piece');
    const again = createProduct(db, { name: '  bread ', unit: 'piece' });

    expect(again.isErr()).toBe(true);
    if (again.isErr()) expect(again.error.code).toBe('DUPLICATE_PRODUCT');
  });

  it('refuses a blank name', () => {
    expect(createProduct(db, { name: '   ', unit: 'g' }).isErr()).toBe(true);
  });

  it('updates a product and guards against renaming into a clash', () => {
    const bread = newProduct('Bread', 'piece');
    newProduct('Buttermilk', 'ml');

    expect(updateProduct(db, bread.id, { isStaple: true }).getOrNull()!.isStaple).toBe(true);
    expect(updateProduct(db, bread.id, { name: 'buttermilk' }).isErr()).toBe(true);
  });
});

describe('purchases', () => {
  it('records what was bought and what it cost', () => {
    const paneer = newProduct('Paneer', 'g');
    const purchase = recordPurchase(db, {
      productId: paneer.id,
      quantity: 200,
      amount: paise(9000),
      purchasedAt: '2026-09-03',
      store: 'Blinkit',
    });

    expect(purchase.isOk()).toBe(true);
    expect(onHandOf(db, paneer.id)).toBe(200);
  });

  it('refuses nothing, fractions and nonsense dates', () => {
    const paneer = newProduct('Paneer', 'g');
    const base = { productId: paneer.id, amount: paise(9000), purchasedAt: '2026-09-03' };

    expect(recordPurchase(db, { ...base, quantity: 0 }).isErr()).toBe(true);
    expect(recordPurchase(db, { ...base, quantity: 1.5 }).isErr()).toBe(true);
    expect(recordPurchase(db, { ...base, quantity: 200, purchasedAt: 'yesterday' }).isErr()).toBe(
      true
    );
    expect(
      recordPurchase(db, { ...base, quantity: 200, productId: 'nope' as Id }).isErr()
    ).toBe(true);
  });

  it('is refused by the database itself if a fraction slips past the code', () => {
    const paneer = newProduct('Paneer', 'g');
    const raw = db.run(
      `INSERT INTO purchases (id, product_id, quantity, amount, purchased_at, created_at)
       VALUES ('x', ?, 1.5, 100, '2026-09-01', '2026-09-01')`,
      [paneer.id]
    );
    expect(raw.isErr()).toBe(true);
  });

  it('never touches the money ledger', () => {
    const paneer = newProduct('Paneer', 'g');
    recordPurchase(db, {
      productId: paneer.id,
      quantity: 200,
      amount: paise(9000),
      purchasedAt: '2026-09-03',
    });

    // The payment arrives from the bank statement; a second copy here would
    // count the same Rs 90 twice.
    expect(db.getEntries().getOrNull()).toHaveLength(0);
    expect(format(monthSummary(db, new Date(2026, 8, 15)).spent)).toBe('Rs 0.00');
  });

  it('can be deleted when entered by mistake', () => {
    const paneer = newProduct('Paneer', 'g');
    const purchase = recordPurchase(db, {
      productId: paneer.id,
      quantity: 200,
      amount: paise(9000),
      purchasedAt: '2026-09-03',
    }).getOrNull()!;

    deletePurchase(db, purchase.id);
    expect(onHandOf(db, paneer.id)).toBe(0);
  });
});

describe('itemising a bank payment', () => {
  const importBlinkit = () => {
    importStatement(db, {
      text: [
        HDFC_HEADER,
        '2026-09-03,2026-09-03,450.00,,49550.00,UPI/BLINKIT/ORDER 8812',
      ].join('\n'),
      sourceRef: 'sept.csv',
      source: 'statement_csv',
      account: bank,
    });
    return db.getEntries().getOrNull()![0];
  };

  it('breaks a Blinkit payment into what it bought', () => {
    const entry = importBlinkit();
    const paneer = newProduct('Paneer', 'g');
    const bread = newProduct('Bread', 'piece');

    recordPurchase(db, {
      productId: paneer.id,
      quantity: 200,
      amount: paise(9000),
      purchasedAt: '2026-09-03',
      entryId: entry.id,
    });
    recordPurchase(db, {
      productId: bread.id,
      quantity: 1,
      amount: paise(4500),
      purchasedAt: '2026-09-03',
      entryId: entry.id,
    });

    const itemised = itemisationOf(db, entry.id)!;

    expect(format(itemised.total)).toBe('Rs 450.00');
    expect(format(itemised.itemised)).toBe('Rs 135.00');
    expect(format(itemised.remaining)).toBe('Rs 315.00');
    expect(itemised.lines.map((l) => l.product.name).sort()).toEqual(['Bread', 'Paneer']);
  });

  it('refuses items adding up to more than was paid', () => {
    const entry = importBlinkit();
    const paneer = newProduct('Paneer', 'g');

    recordPurchase(db, {
      productId: paneer.id,
      quantity: 800,
      amount: paise(40000),
      purchasedAt: '2026-09-03',
      entryId: entry.id,
    });

    const tooMuch = recordPurchase(db, {
      productId: paneer.id,
      quantity: 200,
      amount: paise(9000),
      purchasedAt: '2026-09-03',
      entryId: entry.id,
    });

    expect(tooMuch.isErr()).toBe(true);
    if (tooMuch.isErr()) {
      expect(tooMuch.error.code).toBe('EXCEEDS_TRANSACTION');
      expect(tooMuch.error.message).toContain('Rs 50.00');
    }
  });

  it('leaves the spending total exactly where the bank put it', () => {
    const entry = importBlinkit();
    const paneer = newProduct('Paneer', 'g');

    recordPurchase(db, {
      productId: paneer.id,
      quantity: 200,
      amount: paise(9000),
      purchasedAt: '2026-09-03',
      entryId: entry.id,
    });

    expect(format(monthSummary(db, new Date(2026, 8, 15)).spent)).toBe('Rs 450.00');
  });

  it('files grocery apps under Groceries', () => {
    expect(importBlinkit().categoryId).toBe('cat_groceries');
  });
});

describe('consumption and stock', () => {
  it('tracks what was used and what is left', () => {
    const bread = newProduct('Bread', 'piece');
    recordPurchase(db, {
      productId: bread.id,
      quantity: 10,
      amount: paise(45000),
      purchasedAt: '2026-09-01',
    });

    logConsumption(db, { productId: bread.id, quantity: 6, kind: 'used', consumedAt: '2026-09-07' });
    logConsumption(db, { productId: bread.id, quantity: 1, kind: 'wasted', consumedAt: '2026-09-08' });

    expect(onHandOf(db, bread.id)).toBe(3);
  });

  it('refuses logging nothing', () => {
    const bread = newProduct('Bread', 'piece');
    expect(
      logConsumption(db, { productId: bread.id, quantity: 0, kind: 'used', consumedAt: '2026-09-07' }).isErr()
    ).toBe(true);
  });

  it('turns a stock count into usage when less is left than tracked', () => {
    const buttermilk = newProduct('Buttermilk', 'ml');
    recordPurchase(db, {
      productId: buttermilk.id,
      quantity: 3000,
      amount: paise(9000),
      purchasedAt: '2026-09-01',
    });

    const counted = countStock(db, {
      productId: buttermilk.id,
      remaining: 500,
      countedAt: '2026-09-07',
    }).getOrNull()!;

    expect(counted.recorded).toBe('used');
    expect(formatQuantity(counted.quantity, 'ml')).toBe('2.5 L');
    expect(onHandOf(db, buttermilk.id)).toBe(500);
  });

  it('corrects upward when more is left than was ever recorded', () => {
    const rice = newProduct('Rice', 'g');

    // Stock bought before tracking started.
    const counted = countStock(db, {
      productId: rice.id,
      remaining: 2000,
      countedAt: '2026-09-01',
    }).getOrNull()!;

    expect(counted.recorded).toBe('adjust');
    expect(onHandOf(db, rice.id)).toBe(2000);
  });

  it('records nothing when the count matches', () => {
    const bread = newProduct('Bread', 'piece');
    recordPurchase(db, { productId: bread.id, quantity: 4, amount: paise(18000), purchasedAt: '2026-09-01' });

    expect(countStock(db, { productId: bread.id, remaining: 4, countedAt: '2026-09-02' }).getOrNull()!.recorded).toBeNull();
  });
});

describe('the month, item by item', () => {
  const setUp = () => {
    const paneer = newProduct('Paneer', 'g', { proteinMg: 18000, isStaple: true });
    const bread = newProduct('Bread', 'piece', { isStaple: true });
    const whey = newProduct('Whey protein', 'g', { proteinMg: 78000 });

    recordPurchase(db, { productId: paneer.id, quantity: 400, amount: paise(18000), purchasedAt: '2026-09-03' });
    recordPurchase(db, { productId: bread.id, quantity: 10, amount: paise(45000), purchasedAt: '2026-09-01' });
    recordPurchase(db, { productId: whey.id, quantity: 1000, amount: paise(240000), purchasedAt: '2026-09-02' });

    // Last month's bread, to compare against.
    recordPurchase(db, { productId: bread.id, quantity: 5, amount: paise(22500), purchasedAt: '2026-08-10' });
    logConsumption(db, { productId: bread.id, quantity: 5, kind: 'used', consumedAt: '2026-08-20' });

    // Three scoops of whey logged, 30 g each.
    for (const day of ['2026-09-05', '2026-09-06', '2026-09-07']) {
      logConsumption(db, { productId: whey.id, quantity: 30, kind: 'used', consumedAt: day });
    }
    logConsumption(db, { productId: bread.id, quantity: 3, kind: 'wasted', consumedAt: '2026-09-09' });

    return { paneer, bread, whey };
  };

  it('ranks what the money went on, dearest first', () => {
    setUp();
    const month = inventoryMonth(db, new Date(2026, 8, 15));

    expect(month.rows.map((r) => r.product.name)).toEqual(['Whey protein', 'Bread', 'Paneer']);
  });

  it('totals spend, the regular buys, and protein', () => {
    setUp();
    const { totals } = inventoryMonth(db, new Date(2026, 8, 15));

    expect(format(totals.spent)).toBe('Rs 3,030.00');
    expect(format(totals.staples)).toBe('Rs 630.00');
    expect(format(totals.proteinSpend)).toBe('Rs 2,580.00');
  });

  it('counts protein from logged scoops, and from purchases where nothing was logged', () => {
    const { whey, paneer } = setUp();
    const { rows } = inventoryMonth(db, new Date(2026, 8, 15));

    const wheyRow = rows.find((r) => r.product.id === whey.id)!;
    const paneerRow = rows.find((r) => r.product.id === paneer.id)!;

    // 90 g of powder at 78 g per 100 g.
    expect(formatProtein(wheyRow.proteinMg)).toBe('70.2 g');
    expect(wheyRow.proteinEstimated).toBe(false);

    expect(formatProtein(paneerRow.proteinMg)).toBe('72 g');
    expect(paneerRow.proteinEstimated).toBe(true);
  });

  it('points at the bread that got thrown away and the jump in spend on it', () => {
    setUp();
    const { insights } = inventoryMonth(db, new Date(2026, 8, 15));

    expect(insights.map((i) => i.kind).sort()).toEqual(['spend_jump', 'waste']);
    expect(insights.find((i) => i.kind === 'waste')!.sentence).toContain('30%');
  });

  it('keeps a product with stock on hand in view even in a quiet month', () => {
    const { bread } = setUp();
    const october = inventoryMonth(db, new Date(2026, 9, 15));

    // Nothing bought in October, but bread is still in the kitchen.
    expect(october.rows.find((r) => r.product.id === bread.id)!.onHand).toBe(7);
  });

  it('shows one product in detail, newest activity first', () => {
    const { bread } = setUp();
    const detail = productDetail(db, bread.id, new Date(2026, 8, 15))!;

    expect(detail.activity[0].kind).toBe('wasted');
    expect(detail.history).toHaveLength(2);
    expect(formatUnitPrice(detail.history[0].unitPrice, 'piece')).toBe('Rs 45.00 / pc');
    expect(detail.month.onHand).toBe(7);
  });
});
