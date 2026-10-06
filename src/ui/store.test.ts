import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { useLedger, database, storedTheme } from './store';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { entryDetail } from '@/repo/views';
import { format, paise } from '@/money/money';
import { isoDate, previousMonth, shiftDate } from '@/lib/date';
import { listProducts } from '@/inventory/repo';
import type { Id } from '@/lib/ulid';
import { parseUpi } from '@/upi/link';
import type { PaySession } from '@/upi/session';
import { onMoment, resetMoments, type Moment } from './motion/moments';
import { getPrefs } from './motion/prefsState';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)),
    'utf8'
  );

const store = () => useLedger.getState();

const random = (length: number) => new Uint8Array(randomBytes(length));

describe('ledger store', () => {
  beforeEach(() => {
    store().open(new NodeSqliteDriver());
  });

  it('opens an empty ledger ready but with nothing in it', () => {
    expect(store().ready).toBe(true);
    expect(store().accounts).toHaveLength(0);
    expect(format(store().summary.spent)).toBe('Rs 0.00');
  });

  it('refuses to import before an account exists', () => {
    store().importText({ text: fixture('hdfc_sample.csv'), sourceRef: 'x.csv' });

    expect(store().error).toContain('Add an account');
    expect(store().recent).toHaveLength(0);
  });

  it('adds an account and shows it', () => {
    store().addAccount('HDFC Savings', '1234');

    expect(store().accounts).toHaveLength(1);
    expect(store().accounts[0].name).toBe('HDFC Savings');
    expect(store().accounts[0].last4).toBe('1234');
  });

  it('imports a statement and refreshes every view at once', () => {
    store().addAccount('HDFC Savings', '1234');
    store().importText({
      text: fixture('hdfc_sample.csv'),
      sourceRef: 'hdfc_sample.csv',
    });

    const state = store();

    expect(state.error).toBeUndefined();
    expect(state.lastImport!.rowsParsed).toBe(12);
    expect(state.recent.length).toBeGreaterThan(0);
    expect(state.timeline.length).toBeGreaterThan(0);
    expect(format(state.accounts[0].balance)).toBe('Rs 5,73,699.50');
    expect(state.busy).toBe(false);
  });

  /** A one-page PDF statement as the phone's extractor reports it, for the account ending `last4`. */
  const pdfStatement = (last4: string) =>
    JSON.stringify({
      format: 'pdf-layout',
      version: 1,
      pages: 1,
      lines: [
        { p: 1, y: 154, w: [[180, 211, 'Account'], [213, 243, 'Number'], [245, 248, ':'], [275, 344, `5678XXXXXXX${last4}`]] },
        { p: 1, y: 314, w: [[64, 81, 'Date'], [150, 190, 'Particulars'], [338, 382, 'Withdrawal'], [426, 454, 'Deposit'], [513, 542, 'Balance']] },
        { p: 1, y: 335, w: [[50, 92, '01-08-2026'], [105, 160, 'SALARY'], [443, 475, '5,000.00'], [528, 560, '5,000.00']] },
        { p: 1, y: 357, w: [[50, 92, '02-08-2026'], [105, 160, 'NETFLIX'], [370, 395, '649.00'], [528, 560, '4,351.00']] },
      ],
    });

  it('puts a PDF statement into the account it names, not the first bank account', () => {
    store().addAccount('SBI', '7702');
    store().addAccount('Union Bank', '5501');
    store().importText({ text: pdfStatement('5501'), sourceRef: 'statement.pdf', source: 'statement_pdf' });

    expect(store().error).toBeUndefined();
    expect(store().lastImport!.rowsParsed).toBe(2);
    const id = (name: string) => store().accounts.find((a) => a.name === name)!.id as Id;
    expect(format(database().getBalance(id('Union Bank')).getOrNull()!)).toBe('Rs 4,351.00');
    expect(format(database().getBalance(id('SBI')).getOrNull()!)).toBe('Rs 0.00');
  });

  it('puts a CSV statement into the account the user chose, not the first bank account', () => {
    store().addAccount('SBI', '7702');
    store().addAccount('HDFC Savings', '1234');
    const id = (name: string) => store().accounts.find((a) => a.name === name)!.id as Id;

    store().importText({ text: fixture('hdfc_sample.csv'), sourceRef: 'hdfc_sample.csv', accountId: id('HDFC Savings') });

    expect(store().error).toBeUndefined();
    expect(store().lastImport!.rowsParsed).toBeGreaterThan(0);
    expect(format(database().getBalance(id('SBI')).getOrNull()!)).toBe('Rs 0.00');
    expect(format(database().getBalance(id('HDFC Savings')).getOrNull()!)).not.toBe('Rs 0.00');
  });

  it('marks which accounts a statement can go into, leaving out investments and cash', () => {
    store().addAccount('SBI', '7702');
    store().addAccount('HDFC Savings', '1234');
    const bankId = store().accounts[0].id as Id;
    store().recordManual({ kind: 'investment', amount: paise(1000000), accountId: bankId, description: 'SIP', occurredAt: isoDate(new Date()) });
    store().recordManual({ kind: 'expense', amount: paise(10000), accountId: bankId, description: 'Tea', occurredAt: isoDate(new Date()), categoryId: 'cat_food' as Id });
    const flags = Object.fromEntries(store().accounts.map((a) => [a.name, a.takesStatements]));
    expect(flags).toMatchObject({ SBI: true, 'HDFC Savings': true, Investments: false });
    expect(store().accounts.filter((a) => a.takesStatements).map((a) => a.name).sort()).toEqual(['HDFC Savings', 'SBI']);
  });

  it('refuses a PDF statement for an account the ledger does not have, and writes nothing', () => {
    store().addAccount('SBI', '7702');
    store().importText({ text: pdfStatement('5501'), sourceRef: 'statement.pdf', source: 'statement_pdf' });

    expect(store().error).toContain('account ending 5501');
    expect(store().recent).toHaveLength(0);
    expect(database().getRawRecords().getOrNull()).toHaveLength(0);
  });

  it('surfaces the failing line when a statement will not reconcile', () => {
    store().addAccount('HDFC Savings', '1234');
    store().importText({
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-01-05,2026-01-05,,50000.00,500000.00,SALARY',
        '2026-01-06,2026-01-06,2500.00,,499000.00,AMAZON PURCHASE',
      ].join('\n'),
      sourceRef: 'broken.csv',
    });

    expect(store().error).toContain('line 3');
    expect(store().busy).toBe(false);
  });

  it('clears an error when asked', () => {
    store().importText({ text: 'nonsense', sourceRef: 'x.csv' });
    expect(store().error).toBeDefined();

    store().clearError();
    expect(store().error).toBeUndefined();
  });

  it('applies a correction and reflects it immediately', () => {
    store().addAccount('Bank', '1234');
    store().importText({
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-01-05,2026-01-05,1500.00,,498500.00,QRSTUV WXYZ 99182',
      ].join('\n'),
      sourceRef: 'test.csv',
    });

    const before = store().reviewCards;
    expect(before).toHaveLength(1);

    store().correct({
      entryId: before[0].id as Id,
      categoryId: 'cat_food' as Id,
      applyToAll: true,
    });

    expect(store().reviewCards).toHaveLength(0);
    expect(store().recent[0].category).toBe('Food & Dining');
  });

  it('saves a note on an entry, and clears it when the note is emptied', () => {
    store().addAccount('Bank', '1234');
    store().importText({
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-01-05,2026-01-05,1500.00,,498500.00,QRSTUV WXYZ 99182',
      ].join('\n'),
      sourceRef: 'test.csv',
    });
    const id = store().recent[0].id as Id;

    expect(store().setEntryNotes(id, '  Dinner with Asha  ')).toBeUndefined();
    expect(entryDetail(database(), id)!.notes).toBe('Dinner with Asha');

    expect(store().setEntryNotes(id, '   ')).toBeUndefined();
    expect(entryDetail(database(), id)!.notes).toBeUndefined();
  });

  it('reads an entry detail with its merchant match count', () => {
    store().addAccount('Bank', '1234');
    store().importText({
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-01-05,2026-01-05,2500.00,,497500.00,NETFLIX SUBSCRIPTION',
        '2026-02-05,2026-02-05,2500.00,,495000.00,NETFLIX SUBSCRIPTION',
      ].join('\n'),
      sourceRef: 'test.csv',
    });

    const id = store().recent[0].id as Id;
    const detail = entryDetail(database(), id)!;

    expect(detail.merchant).toBe('Netflix');
    expect(detail.matchCount).toBe(2);
    expect(detail.account).toBe('Bank');
    expect(detail.narration).toBe('NETFLIX SUBSCRIPTION');
    expect(format(detail.amount)).toBe('-Rs 2,500.00');
  });

  it('returns nothing for an entry that is not there', () => {
    store().addAccount('Bank', '1234');
    expect(entryDetail(database(), 'missing' as Id)).toBeNull();
  });

  it('adds a purchase of a new item and shows it on the items view', () => {
    store().addAccount('Bank', '1234');

    const failed = store().addPurchase({
      newProduct: { name: 'Paneer', unit: 'g', proteinMg: 18000, isStaple: true },
      quantity: 200,
      amount: paise(9000),
      purchasedAt: isoDate(new Date()),
    });

    expect(failed).toBeUndefined();
    const [row] = store().inventory.rows;
    expect(row.product.name).toBe('Paneer');
    expect(format(store().inventory.totals.spent)).toBe('Rs 90.00');
    expect(format(store().inventory.totals.staples)).toBe('Rs 90.00');
  });

  it('records the money alongside a purchase paid just now, in one step', () => {
    store().addAccount('Bank', '1234');
    const bankId = store().accounts[0].id as Id;

    const failed = store().addPurchase({
      newProduct: { name: 'Chicken', unit: 'piece', isStaple: false },
      quantity: 1,
      amount: paise(18000),
      purchasedAt: isoDate(new Date()),
      accountId: bankId,
    });

    expect(failed).toBeUndefined();
    expect(format(store().summary.spent)).toBe('Rs 180.00');
    expect(format(store().accounts[0].balance)).toBe('-Rs 180.00');
    expect(store().inventory.rows[0].product.name).toBe('Chicken');
  });

  it('files a new item under the category its name has always been filed under', () => {
    store().addAccount('Bank', '1234');
    const bankId = store().accounts[0].id as Id;
    const day = isoDate(new Date());
    for (const amount of [17000, 18000, 19000]) {
      store().recordManual({ kind: 'expense', amount: paise(amount), accountId: bankId, description: 'Chicken', occurredAt: day, categoryId: 'cat_food' as Id });
    }

    store().addPurchase({
      newProduct: { name: 'chicken', unit: 'piece', isStaple: false },
      quantity: 1,
      amount: paise(18000),
      purchasedAt: day,
      accountId: bankId,
    });

    const detail = entryDetail(database(), store().recent[0].id as Id)!;
    expect(detail.category).toBe('Food & Dining');
    expect(store().inventory.rows[0].product.categoryId).toBe('cat_food');
  });

  it('keeps each brand of an item as its own product, and names the expense after the brand', () => {
    store().addAccount('Bank', '1234');
    const bankId = store().accounts[0].id as Id;
    const day = isoDate(new Date());

    for (const [brand, price] of [['Anand', 6000], ['Param', 6500]] as const) {
      expect(
        store().addPurchase({
          newProduct: { name: 'Paneer', brand, unit: 'g' },
          quantity: 200,
          amount: paise(price),
          purchasedAt: day,
          accountId: bankId,
        })
      ).toBeUndefined();
    }

    const names = store().inventory.rows.map((row) => row.product.brand).sort();
    expect(names).toEqual(['Anand', 'Param']);
    expect(store().recent.map((r) => r.merchant).sort()).toEqual(['Paneer · Anand', 'Paneer · Param']);

    // The same brand again is the same product: it adds a purchase, not a duplicate.
    const anand = store().inventory.rows.find((row) => row.product.brand === 'Anand')!.product;
    expect(store().addPurchase({ productId: anand.id, quantity: 200, amount: paise(6200), purchasedAt: day, accountId: bankId })).toBeUndefined();
    expect(store().inventory.rows).toHaveLength(2);
    expect(store().inventory.rows.find((row) => row.product.brand === 'Anand')!.purchaseCount).toBe(2);
  });

  it('edits an item: adds a brand to one that had none, and refuses a clash with another brand', () => {
    store().addAccount('Bank', '1234');
    const day = isoDate(new Date());
    store().addPurchase({ newProduct: { name: 'Paneer', unit: 'g' }, quantity: 200, amount: paise(6000), purchasedAt: day });
    store().addPurchase({ newProduct: { name: 'Paneer', brand: 'Param', unit: 'g' }, quantity: 200, amount: paise(6500), purchasedAt: day });
    const plain = store().inventory.rows.find((row) => !row.product.brand)!.product;

    expect(store().editProduct(plain.id, { brand: 'Param' })).toContain('already tracked');
    expect(store().editProduct(plain.id, { brand: ' Anand ' })).toBeUndefined();
    expect(store().inventory.rows.map((row) => row.product.brand).sort()).toEqual(['Anand', 'Param']);
    // Its history came with it.
    expect(store().inventory.rows.find((row) => row.product.brand === 'Anand')!.purchaseCount).toBe(1);
  });

  it('gives an existing item a photo when one is added with a purchase', () => {
    store().addAccount('Bank', '1234');
    const day = isoDate(new Date());
    store().addPurchase({ newProduct: { name: 'Peanut butter', unit: 'g' }, quantity: 500, amount: paise(30000), purchasedAt: day });
    const id = store().inventory.rows[0].product.id;
    expect(store().inventory.rows[0].product.photo).toBeUndefined();

    store().addPurchase({ productId: id, photo: 'file:///private/photos/pb.jpg', quantity: 500, amount: paise(32000), purchasedAt: day });
    expect(store().inventory.rows[0].product.photo).toBe('file:///private/photos/pb.jpg');
  });

  it('tracks a purchase without touching money when no account is given', () => {
    store().addAccount('Bank', '1234');

    store().addPurchase({
      newProduct: { name: 'Bread', unit: 'piece', isStaple: true },
      quantity: 1,
      amount: paise(6500),
      purchasedAt: isoDate(new Date()),
    });

    expect(format(store().summary.spent)).toBe('Rs 0.00');
    expect(format(store().inventory.totals.spent)).toBe('Rs 65.00');
  });

  it('leaves no empty product behind when the purchase is refused', () => {
    store().addAccount('Bank', '1234');

    const failed = store().addPurchase({
      newProduct: { name: 'Ghost item', unit: 'piece' },
      quantity: 0,
      amount: paise(100),
      purchasedAt: isoDate(new Date()),
    });

    expect(failed).toBeDefined();
    expect(listProducts(database())).toHaveLength(0);
  });

  it('logs use and a stock count, and updates what is left', () => {
    store().addAccount('Bank', '1234');
    const today = isoDate(new Date());

    store().addPurchase({
      newProduct: { name: 'Buttermilk', unit: 'ml' },
      quantity: 3000,
      amount: paise(9000),
      purchasedAt: today,
    });
    const productId = store().inventory.rows[0].product.id;

    expect(store().logUse({ productId, quantity: 500, kind: 'used', date: today })).toBeUndefined();
    expect(store().countLeft({ productId, remaining: 1000, date: today })).toBeUndefined();

    const row = store().inventory.rows[0];
    expect(row.used).toBe(2000);
    expect(row.onHand).toBe(1000);
  });

  it('returns a message for a form to show, rather than throwing', () => {
    store().addAccount('Bank', '1234');
    store().addPurchase({
      newProduct: { name: 'Bread', unit: 'piece' },
      quantity: 2,
      amount: paise(9000),
      purchasedAt: isoDate(new Date()),
    });
    const productId = store().inventory.rows[0].product.id;

    const message = store().logUse({ productId, quantity: 0, kind: 'used', date: isoDate(new Date()) });
    expect(message).toBe('Enter how much');
  });

  it('records a salary and an investment by hand', () => {
    store().addAccount('Bank', '1234');
    const bankId = store().accounts[0].id as Id;
    const today = isoDate(new Date());

    expect(
      store().recordManual({
        kind: 'income',
        amount: paise(7500000),
        accountId: bankId,
        description: 'Salary',
        occurredAt: today,
      })
    ).toBeUndefined();
    store().recordManual({
      kind: 'investment',
      amount: paise(1000000),
      accountId: bankId,
      description: 'SIP',
      occurredAt: today,
    });

    expect(format(store().summary.received)).toBe('Rs 75,000.00');
    expect(format(store().summary.spent)).toBe('Rs 0.00');
    expect(store().accounts.map((a) => a.name)).toContain('Investments');
  });

  it('remembers the theme choice, and goes back to following the phone', () => {
    expect(store().theme).toBe('system');

    store().setTheme('dark');
    store().refresh();
    expect(store().theme).toBe('dark');

    store().setTheme('system');
    store().refresh();
    expect(store().theme).toBe('system');
  });

  it('reads the saved theme from a file before it is opened, and "system" from a new one', () => {
    expect(storedTheme(new NodeSqliteDriver())).toBe('system');

    const driver = new NodeSqliteDriver();
    store().open(driver);
    store().setTheme('dark');
    expect(storedTheme(driver)).toBe('dark');
  });

  it('leaves an account whose balance was never stated out of net worth, like Accounts and Home do', () => {
    store().addAccount('Bank', '1234');
    const bankId = store().accounts[0].id as Id;
    store().recordManual({ kind: 'expense', amount: paise(50000), accountId: bankId, description: 'Groceries', occurredAt: isoDate(new Date()) });

    expect(store().accounts[0].balanceKnown).toBe(false);
    expect(format(store().netWorth.net)).toBe('Rs 0.00');
  });

  it('keeps last month separate from this month, for the Home comparison', () => {
    store().addAccount('Bank', '1234');
    const bankId = store().accounts[0].id as Id;
    const today = isoDate(new Date());
    // The 1st of last month: always within "the same days of last month", whatever today is.
    const now = new Date();
    const lastMonthDay = isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    store().recordManual({
      kind: 'expense',
      amount: paise(200000),
      accountId: bankId,
      description: 'Old rent',
      occurredAt: lastMonthDay,
    });
    store().recordManual({
      kind: 'expense',
      amount: paise(50000),
      accountId: bankId,
      description: 'Groceries',
      occurredAt: today,
    });

    expect(format(store().summary.spent)).toBe('Rs 500.00');
    expect(format(store().lastMonth.spent)).toBe('Rs 2,000.00');
  });

  it('lays this month out day by day for the Home calendar, without last month in it', () => {
    store().addAccount('Bank', '1234');
    const bankId = store().accounts[0].id as Id;
    const now = new Date();

    store().recordManual({ kind: 'expense', amount: paise(50000), accountId: bankId, description: 'Groceries', occurredAt: isoDate(now) });
    store().recordManual({ kind: 'expense', amount: paise(200000), accountId: bankId, description: 'Old rent', occurredAt: isoDate(previousMonth(now)) });

    const days = store().spendByDay;
    expect(days).toHaveLength(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
    expect(days[now.getDate() - 1]).toBe(paise(50000));
    expect(days.reduce((total, d) => total + d, 0)).toBe(50000);
  });

  it('asks for payday until it can work out safe to spend', () => {
    store().addAccount('Bank', '1234');
    expect(store().safeToSpend.status).toBe('needs_payday');

    expect(store().setPayday(1)).toBeUndefined();
    expect(store().safeToSpend.status).toBe('ready');
  });

  it('refuses a payday that does not exist, with a message', () => {
    store().addAccount('Bank', '1234');
    expect(store().setPayday(40)).toBe('Choose a day between 1 and 31');
  });

  it('lowers safe to spend by the minimum balance', () => {
    store().addAccount('Bank', '1234');
    store().setPayday(1);
    const before = store().safeToSpend;

    store().setCashFloor(paise(500000));
    const after = store().safeToSpend;

    if (before.status !== 'ready' || after.status !== 'ready') throw new Error('expected figures');
    expect(before.result.amount - after.result.amount).toBe(500000);
  });

  it('bumps the version on every change so direct readers refresh', () => {
    const before = store().version;
    store().addAccount('Bank', '1234');
    expect(store().version).toBeGreaterThan(before);
  });

  it('backs up encrypted, wipes, and restores to the same figures', async () => {
    store().addAccount('HDFC Savings', '1234');
    store().importText({ text: fixture('hdfc_sample.csv'), sourceRef: 'hdfc_sample.csv' });
    store().setPayday(1);
    const before = { accounts: store().accounts, recent: store().recent };

    const backup = await store().backUp('a long passphrase', random);
    if ('error' in backup) throw new Error(backup.error);
    expect(backup.file).not.toContain('HDFC');

    // Restoring over live data is refused rather than merged.
    expect(await store().restore(backup.file, 'a long passphrase')).toContain('empty ledger');

    expect(store().deleteEverything('delete all')).toContain('DELETE ALL');
    expect(store().deleteEverything('DELETE ALL')).toBeUndefined();
    expect(store().accounts).toHaveLength(0);
    expect(store().recent).toHaveLength(0);

    expect(await store().restore(backup.file, 'the wrong passphrase')).toContain('Wrong passphrase');
    expect(await store().restore(backup.file, 'a long passphrase')).toBeUndefined();

    expect(store().accounts).toEqual(before.accounts);
    expect(store().recent).toEqual(before.recent);
    expect(store().safeToSpend.status).toBe('ready');
    expect(database().verifyLedger().isOk()).toBe(true);
  }, 20_000);

  it('refuses a backup passphrase that is too short', async () => {
    const result = await store().backUp('short', random);
    expect('error' in result && result.error).toContain('at least 12');
  });

  it('remembers the day of the last backup, and keeps quiet about one for a week after "Later"', () => {
    expect(store().lastBackup).toBeUndefined();

    store().snoozeBackup();
    expect(store().backupSnoozedUntil).toBe(shiftDate(isoDate(new Date()), 7));

    store().markBackedUp();
    expect(store().lastBackup).toBe(isoDate(new Date()));
    expect(store().backupSnoozedUntil).toBeUndefined();

    // Read back from the database, not just held in memory.
    store().refresh();
    expect(store().lastBackup).toBe(isoDate(new Date()));
  });

  it('does not carry the old backup date into a restored ledger', async () => {
    store().addAccount('HDFC Savings', '1234');
    store().markBackedUp();
    const backup = await store().backUp('a long passphrase', random);
    if ('error' in backup) throw new Error(backup.error);

    expect(store().deleteEverything('DELETE ALL')).toBeUndefined();
    expect(await store().restore(backup.file, 'a long passphrase')).toBeUndefined();
    expect(store().accounts).toHaveLength(1);
    expect(store().lastBackup).toBeUndefined();
  }, 20_000);

  it('shows what a repeated purchase cost over time once the price has moved', () => {
    store().addAccount('Cash', '');
    const cash = store().accounts.find((a) => a.name === 'Cash')!.id as Id;
    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return isoDate(d);
    };
    const buy = (rupees: number, offset: number) =>
      store().recordManual({ kind: 'expense', amount: paise(rupees * 100), accountId: cash, description: 'Chicken', occurredAt: day(offset) });

    expect(store().priceStories).toEqual([]);
    for (let i = 0; i < 8; i++) buy(170, 60 + i * 3);
    for (let i = 0; i < 3; i++) buy(180, 20 - i * 3);

    expect(store().priceStories.map((p) => [p.name, p.prices.map((x) => x.amount / 100)])).toEqual([['Chicken', [170, 180]]]);
  });

  describe('a payment handed to a UPI app', () => {
    const request = parseUpi('upi://pay?pa=abcshop@okhdfcbank&pn=ABC%20Restaurant&am=450.00').getOrNull()!;
    const bankMessage = (secondsLater: number, ref: string) => ({
      app: 'com.google.android.apps.messaging',
      text: `Rs.450.00 debited from a/c **1234 on 25-09-26 to VPA abcshop@okhdfcbank (UPI Ref No ${ref}).`,
      postedAt: new Date(Date.now() + secondsLater * 1000).toISOString(),
    });
    const spentRows = () =>
      store()
        .timeline.flatMap((day) => day.entries)
        .filter((row) => format(row.amount) === '-Rs 450.00');

    it('waits, and only the bank\'s message settles it: named for the payee and filed as chosen', () => {
      store().addAccount('HDFC Savings', '1234');
      const started = store().startPayment(request, paise(45000), 'cat_food' as Id) as PaySession;
      expect(store().payments.map((p) => [p.name, p.amount])).toEqual([['ABC Restaurant', 45000]]);
      expect(spentRows()).toHaveLength(0);

      // What the UPI app said is only a note.
      store().notePaymentResult(started.id, 'success');
      expect(store().payments[0].appSaid).toBe('success');
      expect(spentRows()).toHaveLength(0);

      const counts = store().ingestCaptured([bankMessage(5, '526812345678')]);
      expect(counts.recorded).toBe(1);
      expect(store().payments).toEqual([]);
      expect(spentRows()).toHaveLength(1);
      expect(store().recent.some((r) => r.merchant === 'ABC Restaurant' && r.category === 'Food & Dining')).toBe(true);
    });

    it('can be cancelled, and then nothing is left waiting', () => {
      store().addAccount('HDFC Savings', '1234');
      const started = store().startPayment(request, paise(45000)) as PaySession;
      expect(store().cancelPayment(started.id)).toBeUndefined();
      expect(store().payments).toEqual([]);
      expect(store().cancelPayment(started.id)).toMatch(/already settled/);
    });

    it('can be confirmed by the payer, and is counted once when the bank\'s message follows', () => {
      store().addAccount('HDFC Savings', '1234');
      const bankId = store().accounts[0].id as Id;
      const started = store().startPayment(request, paise(45000), 'cat_food' as Id) as PaySession;

      expect(store().confirmPaid(started.id, bankId)).toBeUndefined();
      expect(store().payments).toEqual([]);
      expect(spentRows()).toHaveLength(1);

      store().ingestCaptured([bankMessage(60, '526812345678')]);
      expect(spentRows()).toHaveLength(1);
    });

    it('refuses an amount that is not above zero', () => {
      store().addAccount('HDFC Savings', '1234');
      expect(store().startPayment(request, paise(0))).toMatch(/above zero/);
      expect(store().payments).toEqual([]);
    });
  });

  it('keeps asking about bank messages for an account that has not been added, until it is', () => {
    store().addAccount('HDFC Savings', '1234');
    const counts = store().ingestCaptured([
      {
        app: 'com.google.android.apps.messaging',
        text: 'A/c *0100 Debited for Rs. 5002.00 on 07-04-2025 09:32:04 by Mob Bk Avl Bal Rs:0.00 -Union Bank of India',
        postedAt: '2025-04-07T09:32:04+05:30',
      },
    ]);
    expect(counts.waiting).toBe(1);
    expect(store().waitingAccounts.map((w) => [w.digits, w.messages])).toEqual([['0100', 1]]);
    expect(format(store().waitingAccounts[0].moneyOut)).toBe('Rs 5,002.00');

    // Still there on the next read: it is not a one-time notice.
    store().refresh();
    expect(store().waitingAccounts).toHaveLength(1);

    store().addAccount('Union', '0100');
    expect(store().waitingAccounts).toHaveLength(0);
    // The waiting payment is now in the ledger.
    expect(store().timeline.flatMap((day) => day.entries).some((row) => format(row.amount) === '-Rs 5,002.00')).toBe(true);
  });

  it('asks where ATM cash went until it is spent or kept', () => {
    store().addAccount('HDFC Savings', '1234');
    const counts = store().ingestCaptured([
      {
        app: 'com.google.android.apps.messaging',
        text: 'Rs.5000 withdrawn at ATM S1AB1234 from A/c XX1234 on 25SEP26.',
        postedAt: new Date().toISOString(),
      },
    ]);
    expect(counts).toEqual({ recorded: 1, cashWithdrawals: 1, waiting: 0 });
    expect(format(store().cash.unexplained)).toBe('Rs 5,000.00');
    expect(format(store().summary.spent)).toBe('Rs 0.00');

    // "Where did it go?" — Rs 1,200 on food, paid in cash.
    const failed = store().recordManual({
      kind: 'expense',
      amount: paise(120000),
      accountId: store().cash.accountId!,
      description: 'Vegetables and milk',
      occurredAt: isoDate(new Date()),
      categoryId: 'cat_groceries' as Id,
    });
    expect(failed).toBeUndefined();
    expect(format(store().cash.unexplained)).toBe('Rs 3,800.00');
    expect(format(store().summary.spent)).toBe('Rs 1,200.00');

    // "I still have it" stops the question, until the wallet gets lighter.
    expect(store().keepCash()).toBeUndefined();
    expect(format(store().cash.unexplained)).toBe('Rs 0.00');
  });

  it('records alerts that were waiting once their account is added', () => {
    store().addAccount('HDFC Savings', '1234');
    const counts = store().ingestCaptured([
      {
        app: 'com.google.android.apps.messaging',
        text: 'ICICI Bank Acct XX789 debited for Rs 2,000.00 on 25-Sep-26; RAMESH KUMAR credited. UPI:526833334444.',
        postedAt: new Date().toISOString(),
      },
    ]);
    expect(counts.waiting).toBe(1);

    store().addAccount('ICICI', '6789');
    expect(format(store().summary.spent)).toBe('Rs 2,000.00');
  });

  it('records waiting alerts once an account\'s digits are corrected', () => {
    store().addAccount('SBI Savings', '1234');
    const counts = store().ingestCaptured([
      {
        app: 'sms',
        text: 'Your A/C XXXXX7702 Debited INR 500.00 on 26/09/26 -Transferred to Mr RAHUL SHARMA. Ref No 626911112222 -SBI',
        postedAt: new Date().toISOString(),
      },
    ]);
    expect(counts.waiting).toBe(1);

    const id = store().accounts[0].id as Id;
    expect(store().editAccount(id, 'SBI Savings', '82')).toBe('The last four digits are four numbers');
    expect(store().editAccount(id, 'SBI Savings', '7702')).toBeUndefined();

    expect(store().accounts[0].last4).toBe('7702');
    expect(format(store().summary.spent)).toBe('Rs 500.00');
  });

  it('takes a starting balance when an account is added', () => {
    store().addAccount('SBI Savings', '7702', paise(4250050));
    expect(format(store().accounts[0].balance)).toBe('Rs 42,500.50');
  });

  it('tracks net worth as accounts move', () => {
    store().addAccount('Bank', '1234');
    store().importText({
      text: fixture('hdfc_sample.csv'),
      sourceRef: 'hdfc_sample.csv',
    });

    expect(format(store().netWorth.net)).toBe('Rs 5,73,699.50');
  });
});

describe('money moments from the store', () => {
  let heard: Moment[];
  let stop: () => void;

  /** A ledger with an account, and the moments cursor moved a moment back so what follows counts as new. */
  const setup = () => {
    resetMoments();
    stop = onMoment((moment) => heard.push(moment));
    store().open(new NodeSqliteDriver());
    store().addAccount('Bank', '1234');
    database().setSetting('moments_cursor', new Date(Date.now() - 5000).toISOString());
    heard = [];
  };

  beforeEach(() => {
    heard = [];
    setup();
  });
  afterEach(() => stop());

  const bank = (): Id => store().accounts[0].id as Id;
  const types = () => heard.map((m) => m.type);

  it('says nothing on opening: the first look only sets the starting line', () => {
    resetMoments();
    heard = [];
    stop();
    stop = onMoment((moment) => heard.push(moment));
    store().open(new NodeSqliteDriver());
    expect(heard).toEqual([]);
    expect(database().getSetting('moments_cursor').getOrNull()).not.toBeNull();
  });

  it('answers an expense typed in, with its category and size', () => {
    store().recordManual({ kind: 'expense', amount: paise(129900), accountId: bank(), description: 'Amazon', occurredAt: isoDate(new Date()), categoryId: 'cat_shopping' as Id });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ type: 'EXPENSE_RECORDED', amount: 129900, label: 'Shopping' });
  });

  it('answers a salary, once, and not the same money again', () => {
    const day = isoDate(new Date());
    store().recordManual({ kind: 'income', amount: paise(6800000), accountId: bank(), description: 'Salary', occurredAt: day });
    expect(types()).toEqual(['SALARY_RECEIVED']);
    store().recordManual({ kind: 'income', amount: paise(6800000), accountId: bank(), description: 'Salary again', occurredAt: day });
    expect(types()).toEqual(['SALARY_RECEIVED']);
  });

  it('answers a small credit as income, not salary', () => {
    store().recordManual({ kind: 'income', amount: paise(45000), accountId: bank(), description: 'Refund', occurredAt: isoDate(new Date()) });
    expect(types()).toEqual(['INCOME_RECEIVED']);
  });

  it('answers an investment', () => {
    store().recordManual({ kind: 'investment', amount: paise(500000), accountId: bank(), description: 'SIP', occurredAt: isoDate(new Date()) });
    expect(types()).toEqual(['INVESTED']);
  });

  it('does not answer a statement import', () => {
    store().importText({ text: fixture('hdfc_sample.csv'), sourceRef: 'hdfc_sample.csv' });
    expect(heard).toEqual([]);
  });

  it('answers a goal at its quarter, half and finish once each, and other savings quietly', () => {
    store().addGoal({ name: 'Mac Mini', targetAmount: paise(2000000) });
    const id = store().goals[0].id as Id;
    store().addToGoal(id, paise(500000));
    store().addToGoal(id, paise(500000));
    store().addToGoal(id, paise(100000));
    store().addToGoal(id, paise(1000000));
    store().addToGoal(id, paise(100000));
    expect(types()).toEqual(['GOAL_25', 'GOAL_50', 'SAVING_ADDED', 'GOAL_COMPLETE', 'SAVING_ADDED']);
    expect(heard[0]).toMatchObject({ label: 'Mac Mini', ref: id });
  });

  it('does not celebrate a goal line a second time after money is taken out and put back', () => {
    store().addGoal({ name: 'Trip', targetAmount: paise(1000000) });
    const id = store().goals[0].id as Id;
    store().addToGoal(id, paise(600000));
    store().addToGoal(id, paise(-400000));
    store().addToGoal(id, paise(400000));
    expect(types()).toEqual(['GOAL_50', 'SAVING_ADDED']);
  });

  it('says nothing for money taken out of a goal', () => {
    store().addGoal({ name: 'Trip', targetAmount: paise(1000000) });
    const id = store().goals[0].id as Id;
    store().addToGoal(id, paise(300000));
    heard = [];
    store().addToGoal(id, paise(-100000));
    expect(heard).toEqual([]);
  });

  it('answers a category given to a transaction that was waiting for one, not one that already had it', () => {
    store().importText({
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-01-05,2026-01-05,1500.00,,498500.00,QRSTUV WXYZ 99182',
      ].join('\n'),
      sourceRef: 'test.csv',
    });
    heard = [];
    const card = store().reviewCards[0];
    store().correct({ entryId: card.id as Id, categoryId: 'cat_food' as Id, applyToAll: true });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ type: 'TRANSACTION_REVIEWED', label: 'Food & Dining' });

    heard = [];
    store().correct({ entryId: card.id as Id, categoryId: 'cat_shopping' as Id });
    expect(heard).toEqual([]);
  });

  it('answers net worth passing a line once, and not the first look at what was already there', () => {
    const day = isoDate(new Date());
    // Only an account whose balance is known counts towards net worth.
    store().addAccount('Main', '9999', paise(100));
    const main = store().accounts.find((a) => a.name === 'Main')!.id as Id;
    heard = [];
    store().recordManual({ kind: 'income', amount: paise(15000000), accountId: main, description: 'Bonus', occurredAt: day, categoryId: 'cat_savings' as Id });
    expect(types()).toEqual(['INCOME_RECEIVED', 'NET_WORTH_MILESTONE']);
    expect(heard[1].amount).toBe(10_000_000);
    heard = [];
    store().recordManual({ kind: 'income', amount: paise(1000000), accountId: main, description: 'More', occurredAt: day, categoryId: 'cat_savings' as Id });
    expect(types()).toEqual(['INCOME_RECEIVED']);
  });

  it('answers a backup only once it has really been saved', () => {
    expect(types()).toEqual([]);
    store().markBackedUp();
    expect(types()).toEqual(['BACKUP_COMPLETED']);
  });

  it('notices a budget kept last month once, when its screen opens', () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 12);
    store().addBudget('cat_food' as Id, paise(400000));
    const budgetId = store().budgets[0].id;
    database().run(`UPDATE budgets SET created_at = ? WHERE id = ?`, [new Date(last.getFullYear(), last.getMonth(), 1).toISOString(), budgetId]);
    store().recordManual({ kind: 'expense', amount: paise(150000), accountId: bank(), description: 'Groceries', occurredAt: isoDate(last), categoryId: 'cat_food' as Id });
    heard = [];
    store().noticeKeptBudgets();
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ type: 'BUDGET_COMPLETED', label: 'Food & Dining', ref: budgetId });
    store().noticeKeptBudgets();
    expect(heard).toHaveLength(1);
  });

  it('keeps the motion choices, and reads them back after a fresh open', () => {
    store().setMotion('none');
    store().setSound(false);
    store().setHaptics(false);
    expect(getPrefs()).toEqual({ motion: 'none', sound: false, haptics: false });
    store().refresh();
    expect(getPrefs()).toEqual({ motion: 'none', sound: false, haptics: false });
    store().setMotion('full');
    store().setSound(true);
    store().setHaptics(true);
    expect(getPrefs()).toEqual({ motion: 'full', sound: true, haptics: true });
  });
});
