import { create } from 'zustand';
import { Database, type Account, type RawSource } from '@/db/client';
import type { SqliteDriver } from '@/db/driver';
import type { Id } from '@/lib/ulid';
import { ok, err } from '@/lib/result';
import { paise, type Paise } from '@/money/money';
import { snapshot, recategorise, type LedgerSnapshot } from '@/repo/views';
import { dropNamesFoundInsideWords, importStatement } from '@/repo/import';
import { recordTransaction, setBalanceNow, type ManualTransaction } from '@/repo/manual';
import { isoDate, shiftDate } from '@/lib/date';
import {
  newMoney,
  largestSalary,
  momentsCursor,
  advanceMomentsCursor,
  salaryAnswered,
  rememberSalary,
  goalLineSeen,
  markGoalLine,
  netWorthLineSeen,
  markNetWorthLine,
  keptSeen,
  markKeptSeen,
} from '@/repo/moments';
import { classifyNew } from './motion/classify';
import { emitMoment } from './motion/moments';
import { applyStored } from './motion/prefsState';
import { goalMilestone, netWorthLine } from './motion/milestones';
import type { ImportResult } from '@/import/types';
import { readLayout, statementLast4 } from '@/import/pdf/layout';
import {
  inventoryMonth,
  createProduct,
  recordPurchase,
  logConsumption,
  countStock,
  updateProduct,
  deletePurchase,
  deleteConsumption,
  type InventoryMonth,
  type NewProduct,
} from '@/inventory/repo';
import { productLabel } from '@/inventory/model';
import {
  readAnalysis,
  setPayday,
  setCashFloor,
  type SafeToSpendView,
  type SubscriptionsView,
  type InsightsView,
} from '@/repo/analysisViews';
import { sealBackup, openBackup, deleteAllData } from '@/security/backup';
import type { RandomSource } from '@/security/encryption';
import { ingestAlert, retryUnmatched, resortMessages, waitingAccounts, type WaitingAccount } from '@/capture/ingest';
import { priceStories, type PriceStory } from '@/repo/priceStories';
import { maybeTwice, sameAsBank, twoPayments, type MaybeTwice } from '@/repo/doubles';
import {
  waitingPayments,
  startPayment,
  notePaymentResult,
  cancelPayment,
  confirmPaid,
  type PaySession,
} from '@/upi/session';
import type { UpiRequest } from '@/upi/link';
import type { CapturedAlert } from '@/capture/alerts';
import { cashView, acknowledgeCash, type CashView } from '@/capture/cash';
import { saveBill, type SaveBillInput } from '@/bills/repo';
import {
  pendingMandates,
  confirmMandate,
  dismissMandate,
  type TrackedMandate,
} from '@/capture/mandates';
import { importCas, isCas, wealthView, type WealthView, type CasImportResult } from '@/wealth/repo';
import { importPaisa, isPaisaBackup, type PaisaImport } from '@/repo/paisa';
import { usualFor } from '@/repo/usual';
import { SNOOZE_DAYS } from '@/security/backupStatus';
import {
  listGoals,
  createGoal,
  contributeToGoal,
  editGoal,
  deleteGoal,
  type Goal,
  type NewGoal,
} from '@/repo/goals';
import {
  listRecurring,
  createRecurring,
  markRecurringPaid,
  deleteRecurring,
  type RecurringItem,
  type NewRecurring,
} from '@/repo/recurring';
import {
  budgetsView,
  budgetsKeptLastMonth,
  createBudget,
  editBudget,
  deleteBudget,
  setRollover,
  type BudgetProgress,
} from '@/repo/budgets';

const EMPTY_SUBSCRIPTIONS: SubscriptionsView = {
  asOf: '',
  active: [],
  dormant: [],
  totalAnnual: paise(0),
  totalMonthly: paise(0),
  sharedCategories: [],
};

const EMPTY_INSIGHTS: InsightsView = { insights: [], monthsOfHistory: 0, evidence: {} };

const EMPTY_INVENTORY: InventoryMonth = {
  from: '',
  to: '',
  rows: [],
  totals: {
    spent: paise(0),
    staples: paise(0),
    proteinMg: 0,
    proteinSpend: paise(0),
    itemsBought: 0,
  },
  insights: [],
};

const EMPTY: LedgerSnapshot = {
  summary: { spent: paise(0), received: paise(0), net: paise(0) },
  lastMonth: { spent: paise(0), received: paise(0), net: paise(0) },
  spendByDay: [],
  spendingScore: null,
  topCategories: [],
  recent: [],
  timeline: [],
  accounts: [],
  reviewCards: [],
  netWorth: { assets: paise(0), liabilities: paise(0), net: paise(0) },
  suspenseRatio: 0,
};

/** An error message to show beside the form, or undefined when it worked. */
export type Outcome = string | undefined;

export type NewPurchaseInput = {
  /** An existing product, or the details to create one (brand and photo included). */
  productId?: Id;
  newProduct?: NewProduct;
  /** A photo to give an existing product; ignored for a new one, whose photo is in newProduct. */
  photo?: string;
  quantity: number;
  amount: Paise;
  purchasedAt: string;
  store?: string;
  /** Itemising a payment already on the ledger — no new money entry is made. */
  entryId?: Id;
  /**
   * Paid just now, not yet on any statement: an expense is recorded from this
   * account alongside the item, in one step. Ignored when entryId is set.
   */
  accountId?: Id;
};

export type ThemeChoice = 'light' | 'dark' | 'system';

/** How much the app moves: a choice, or null to follow the phone's own setting. */
export type MotionChoice = 'full' | 'reduced' | 'none';

export type LedgerState = LedgerSnapshot & {
  ready: boolean;
  busy: boolean;
  lastImport?: ImportResult;
  error?: string;
  inventory: InventoryMonth;
  safeToSpend: SafeToSpendView;
  subscriptions: SubscriptionsView;
  insights: InsightsView;
  /** Withdrawn cash, and how much of it the app should ask about. */
  cash: CashView;
  /** Everything owned, account by account, each with its as-of date. */
  wealth: WealthView;
  /** What the last CAS import brought in, for the confirmation line. */
  lastCas?: CasImportResult;
  /** The last Paisa backup brought in. */
  lastPaisa?: PaisaImport;
  /** Savings targets the user tracks by hand. */
  goals: Goal[];
  /** Reminders for bills that repeat too rarely for Subscriptions to detect. */
  recurring: RecurringItem[];
  /** A monthly limit per category, against what it actually spent. */
  budgets: BudgetProgress[];
  /** Bumped on every change, so screens reading the database directly re-read. */
  version: number;

  open: (driver: SqliteDriver) => void;
  refresh: () => void;
  /** Undefined when the account was added, else the reason it was not. */
  /** Adds a bank account, with its balance right now if the user knows it. */
  addAccount: (name: string, last4: string, balance?: Paise) => Outcome;
  /** Renames an account or corrects its last four digits. */
  editAccount: (id: Id, name: string, last4: string, balance?: Paise) => Outcome;
  /** Leaves an account out of every total, or counts it again; its entries stay listed. */
  setAccountExcluded: (id: Id, excluded: boolean) => Outcome;
  /** Removes an account that was never used — refused if it has any history. */
  deleteAccount: (id: Id) => Outcome;
  /** Undoes a mistyped manual entry — refused for anything from a bank source. */
  removeEntry: (id: Id) => Outcome;
  importText: (input: {
    text: string;
    sourceRef: string;
    source?: RawSource;
    accountId?: Id;
  }) => void;
  correct: (input: {
    entryId: Id;
    categoryId: Id;
    applyToAll?: boolean;
  }) => void;
  /** Saves the note on an entry; an empty note clears it. */
  setEntryNotes: (entryId: Id, notes: string) => Outcome;
  recordManual: (input: ManualTransaction) => Outcome;
  addPurchase: (input: NewPurchaseInput) => Outcome;
  logUse: (input: {
    productId: Id;
    quantity: number;
    kind: 'used' | 'wasted';
    date: string;
  }) => Outcome;
  countLeft: (input: { productId: Id; remaining: number; date: string }) => Outcome;
  setStaple: (productId: Id, isStaple: boolean) => void;
  /** Rename an item, give it a brand or a photo; an empty brand or photo clears it. */
  editProduct: (productId: Id, patch: { name?: string; brand?: string; photo?: string }) => Outcome;
  removePurchase: (purchaseId: Id) => void;
  removeConsumption: (consumptionId: Id) => void;
  /** The day of the month salary arrives, or null to go back to detecting it. */
  setPayday: (day: number | null) => Outcome;
  setCashFloor: (amount: Paise) => Outcome;
  /** An encrypted backup file's contents, ready to be saved wherever the user picks. */
  backUp: (
    passphrase: string,
    random: RandomSource
  ) => Promise<{ file: string; entries: number } | { error: string }>;
  /** Restores into a fresh ledger; the passphrase is ignored for a plain backup. */
  restore: (file: string, passphrase: string) => Promise<Outcome>;
  deleteEverything: (confirmation: string) => Outcome;
  /** Records alerts caught by the notification listener. */
  ingestCaptured: (alerts: CapturedAlert[]) => { recorded: number; cashWithdrawals: number; waiting: number };
  /** "I still have it": stop asking about the cash in hand. */
  keepCash: () => Outcome;
  /** Files a bill: itemises a payment, or records it as a new expense. */
  saveBill: (input: SaveBillInput) => Outcome;
  /** Autopays waiting for a yes. */
  mandates: TrackedMandate[];
  /** Bank messages about accounts that have not been added, so their money is not counted yet. */
  waitingAccounts: WaitingAccount[];
  /** Things bought again and again whose price has moved, from what was typed in. */
  priceStories: PriceStory[];
  /** Payments handed to a UPI app that nothing has settled yet: waiting for the bank's message. */
  payments: PaySession[];
  /** Remembers a payment just before a UPI app opens for it: the session, or what is wrong with it. */
  startPayment: (request: UpiRequest, amount: Paise, categoryId?: Id) => PaySession | string;
  /** What the UPI app said on the way back. A note only: it settles nothing. */
  notePaymentResult: (id: string, appSaid: 'success' | 'failure' | 'pending') => void;
  /** "No, it did not go through." */
  cancelPayment: (id: string) => Outcome;
  /** "Yes, it went through" with no bank message yet: recorded on that account as the payer's word. */
  confirmPaid: (id: string, accountId: Id) => Outcome;
  /** Amounts shown as dots, for when someone is looking over a shoulder. */
  hideAmounts: boolean;
  /** Light, dark, or whatever the phone is set to. */
  theme: ThemeChoice;
  /** The day (YYYY-MM-DD) the ledger was last saved to a backup file, if ever. */
  lastBackup?: string;
  /** Home stops asking about a backup until this day (YYYY-MM-DD). */
  backupSnoozedUntil?: string;
  /** Call once a backup file has really been saved. */
  markBackedUp: () => void;
  /** "Later" on Home's backup reminder. */
  snoozeBackup: () => void;
  setTheme: (theme: ThemeChoice) => void;
  /** How much the app moves. Sound and haptics have their own switches. */
  setMotion: (motion: MotionChoice) => void;
  setSound: (on: boolean) => void;
  setHaptics: (on: boolean) => void;
  toggleHideAmounts: () => void;
  confirmMandate: (key: string, details?: { name?: string; purpose?: string }) => Outcome;
  dismissMandate: (key: string) => Outcome;
  /** A bank payment and a typed entry of the same amount a few days apart, waiting for the user to say. */
  maybeTwice: MaybeTwice[];
  /** "Same payment": the bank entry stays in the user's words; the typed one goes. */
  sameAsBank: (pair: MaybeTwice) => Outcome;
  /** "Two payments": both stay, never asked about again. */
  twoPayments: (pair: MaybeTwice) => Outcome;
  /** A savings goal the user sets and updates by hand. */
  addGoal: (input: NewGoal) => Outcome;
  addToGoal: (id: Id, amount: Paise) => Outcome;
  editGoal: (id: Id, patch: { name?: string; targetAmount?: Paise; targetDate?: string | null }) => Outcome;
  removeGoal: (id: Id) => void;
  /** A reminder for a bill too infrequent for Subscriptions to detect on its own. */
  addRecurring: (input: NewRecurring) => Outcome;
  markRecurringPaid: (id: Id) => Outcome;
  removeRecurring: (id: Id) => void;
  /** A monthly limit for one category. */
  addBudget: (categoryId: Id, amount: Paise) => Outcome;
  editBudget: (id: Id, amount: Paise) => Outcome;
  removeBudget: (id: Id) => void;
  setBudgetRollover: (id: Id, on: boolean) => Outcome;
  /** Call when the budgets screen opens: a budget kept last month is noticed once. */
  noticeKeptBudgets: () => void;
  clearError: () => void;
};

const themeFrom = (saved: string | null): ThemeChoice =>
  saved === 'light' || saved === 'dark' ? saved : 'system';

/**
 * The look saved under Appearance, read from a ledger file before it is opened, so the
 * app can put it on while the loading screen is up. A file with no settings yet: 'system'.
 */
export const storedTheme = (driver: SqliteDriver): ThemeChoice =>
  themeFrom(new Database(driver).getSetting('theme').getOrNull() ?? null);

let db: Database | null = null;

/** The open database, for screens that need to read outside the snapshot. */
export const database = (): Database => {
  if (!db) throw new Error('Database not opened; call open() first');
  return db;
};

const ownAccountsOf = (instance: Database, exclude: Id) =>
  (instance.getAllAccounts().getOrNull() ?? [])
    .filter((a) => !a.isSystem && a.id !== exclude && a.last4)
    .map((a) => ({ last4: a.last4!, id: a.id }));

/**
 * Looks for money that has just appeared in the ledger (a payment caught from a
 * bank message, a hand-typed entry, a salary) and tells the motion layer, once.
 * The first look only sets the starting line, so history is never celebrated.
 */
const noticeNewMoney = (instance: Database): void => {
  const since = momentsCursor(instance);
  const found = newMoney(instance, since, 5000);
  if (found.length === 0) return;
  advanceMomentsCursor(instance, found[found.length - 1].createdAt);

  const moments = classifyNew(found, {
    largestSalary: largestSalary(instance, since),
    salaryAnswered: (amount) => salaryAnswered(instance, amount),
  });
  for (const moment of moments) {
    if (moment.type === 'SALARY_RECEIVED' && moment.amount !== undefined) rememberSalary(instance, moment.amount);
    emitMoment(moment);
  }
};

/** A net-worth line crossed upward since the last one celebrated. */
const noticeNetWorth = (instance: Database, total: number, quiet: boolean): void => {
  const line = netWorthLine(total);
  const seen = netWorthLineSeen(instance, line);
  if (seen === undefined || line <= seen) return;
  markNetWorthLine(instance, line);
  // An import (a statement, a holdings file, a restore) moves the total by bringing in history, which is not news.
  if (quiet) return;
  emitMoment({ type: 'NET_WORTH_MILESTONE', key: `NET_WORTH_MILESTONE:${line}`, at: Date.now(), amount: line });
};

export const useLedger = create<LedgerState>((set, get) => {
  /** Re-reads everything the screens show, after any change. */
  const reread = (instance: Database, quiet = false) => {
    // Answered before the screens re-draw, so a figure that is about to change knows why.
    applyStored({
      motion: instance.getSetting('motion').getOrNull(),
      sound: instance.getSetting('sound').getOrNull(),
      haptics: instance.getSetting('haptics').getOrNull(),
    });
    noticeNewMoney(instance);
    const wealth = wealthView(instance);
    noticeNetWorth(instance, wealth.total, quiet);
    return read(instance, wealth);
  };

  const read = (instance: Database, wealth: ReturnType<typeof wealthView>) => ({
    ...snapshot(instance),
    inventory: inventoryMonth(instance, new Date()),
    ...readAnalysis(instance),
    cash: cashView(instance),
    wealth,
    mandates: pendingMandates(instance),
    waitingAccounts: waitingAccounts(instance),
    maybeTwice: maybeTwice(instance),
    priceStories: priceStories(instance),
    payments: waitingPayments(instance),
    hideAmounts: instance.getSetting('hide_amounts').getOrNull() === 'yes',
    theme: themeFrom(instance.getSetting('theme').getOrNull()),
    lastBackup: instance.getSetting('last_backup').getOrNull() ?? undefined,
    backupSnoozedUntil: instance.getSetting('backup_snoozed_until').getOrNull() ?? undefined,
    goals: listGoals(instance),
    recurring: listRecurring(instance),
    budgets: budgetsView(instance),
    version: get().version + 1,
  });

  return {
    ...EMPTY,
    inventory: EMPTY_INVENTORY,
    safeToSpend: { status: 'needs_payday', cashFloor: paise(0) },
    subscriptions: EMPTY_SUBSCRIPTIONS,
    insights: EMPTY_INSIGHTS,
    cash: { balance: paise(0), unexplained: paise(0) },
    wealth: { total: paise(0), parts: [] },
    mandates: [],
    waitingAccounts: [],
    maybeTwice: [],
    priceStories: [],
    payments: [],
    hideAmounts: false,
    theme: 'system' as ThemeChoice,
    goals: [],
    recurring: [],
    budgets: [],
    version: 0,
    ready: false,
    busy: false,

    open: (driver) => {
      const instance = new Database(driver);
      const started = instance.initialize();

      if (started.isErr()) {
        set({ error: started.error.message, ready: false });
        return;
      }

      // Messages kept by an older sorter are sorted again, once.
      resortMessages(instance);
      // Payee names the old matcher found inside words (CRED in CREDITED) come off.
      dropNamesFoundInsideWords(instance);
      db = instance;
      set({ ...reread(instance), ready: true });
    },

    refresh: () => {
      if (!db) return;
      set(reread(db));
    },

    addAccount: (name, last4, balance) => {
      if (!db) return 'The ledger is not open';

      const created = db.createAccount({
        name,
        kind: 'asset',
        subkind: 'bank',
        last4,
        isSystem: false,
      });

      if (created.isErr()) {
        set({ error: created.error.message });
        return created.error.message;
      }

      if (balance !== undefined) setBalanceNow(db, created.value.id, balance, isoDate(new Date()));
      // Alerts that named this account before it existed can land now.
      retryUnmatched(db);
      get().refresh();
      return undefined;
    },

    editAccount: (id, name, last4, balance) => {
      if (!db) return 'The ledger is not open';
      if (!name.trim()) return 'Give the account a name';
      if (last4 && !/^\d{4}$/.test(last4)) return 'The last four digits are four numbers';
      const updated = db.updateAccount(id, { name: name.trim(), last4: last4 || undefined });
      if (updated.isErr()) return updated.error.message;
      if (balance !== undefined) {
        const set = setBalanceNow(db, id, balance, isoDate(new Date()));
        if (set.isErr()) return set.error.message;
      }
      // Alerts that named these digits can land now.
      retryUnmatched(db);
      set(reread(db));
      return undefined;
    },

    setAccountExcluded: (id, excluded) => {
      if (!db) return 'The ledger is not open';
      const changed = db.setAccountExcluded(id, excluded);
      if (changed.isErr()) return changed.error.message;
      set(reread(db));
      return undefined;
    },

    deleteAccount: (id) => {
      if (!db) return 'The ledger is not open';
      const deleted = db.deleteAccount(id);
      if (deleted.isErr()) return deleted.error.message;
      set(reread(db));
      return undefined;
    },

    removeEntry: (id) => {
      if (!db) return 'The ledger is not open';
      const deleted = db.deleteEntry(id);
      if (deleted.isErr()) return deleted.error.message;
      set(reread(db));
      return undefined;
    },

    importText: ({ text, sourceRef, source = 'statement_csv', accountId }) => {
      if (!db) return;

      // A Paisa backup brings its own accounts.
      if (isPaisaBackup(text)) {
        set({ busy: true, error: undefined });
        const paisa = importPaisa(db, text, sourceRef);
        if (paisa.isErr()) {
          set({ busy: false, error: paisa.error.message });
          return;
        }
        set({ busy: false, lastPaisa: paisa.value, ...reread(db, true) });
        return;
      }

      // A CAS is holdings, not transactions, and needs no bank account.
      if (isCas(text)) {
        const cas = importCas(db, text, sourceRef);
        if (cas.isErr()) {
          set({ error: cas.error.message });
          return;
        }
        set({ lastCas: cas.value, ...reread(db, true) });
        return;
      }

      const accounts = db.getAllAccounts().getOrNull() ?? [];

      // A PDF statement prints whose it is: it goes into the account with those last four
      // digits, or nowhere, never into whichever bank account happens to come first.
      const layout = accountId ? null : readLayout(text);
      const last4 = layout ? statementLast4(layout) : undefined;
      const named = last4 ? accounts.filter((a) => !a.isSystem && a.last4 === last4) : [];
      if (last4 && named.length !== 1) {
        set({
          error:
            named.length === 0
              ? `This statement is for the account ending ${last4}. Add that account under Accounts, or give an account those last 4 digits, then import it again.`
              : `More than one account ends in ${last4}. Change the last 4 digits on the one this statement is not for, then import it again.`,
        });
        return;
      }

      const account: Account | undefined = accountId
        ? accounts.find((a) => a.id === accountId)
        : named[0] ??
          accounts.find((a) => !a.isSystem && a.subkind === 'bank') ??
          accounts.find((a) => !a.isSystem && a.kind === 'asset' && a.subkind !== 'investment' && a.subkind !== 'cash');

      if (!account) {
        set({ error: 'Add an account before importing a statement' });
        return;
      }

      set({ busy: true, error: undefined });

      const result = importStatement(db, {
        text,
        sourceRef,
        source,
        account,
        ownAccounts: ownAccountsOf(db, account.id),
      });

      if (result.isErr()) {
        const where =
          result.error.rowNumber !== undefined
            ? ` (line ${result.error.rowNumber})`
            : '';
        set({ busy: false, error: `${result.error.message}${where}` });
        return;
      }

      set({ busy: false, lastImport: result.value, ...reread(db, true) });
    },

    correct: ({ entryId, categoryId, applyToAll }) => {
      if (!db) return;

      // Was this one waiting for an answer? (The same test the review queue uses.)
      const before = db.getEntry(entryId).getOrNull();
      const wasUncertain =
        !!before && !before.reviewedAt && (!before.categoryId || before.categoryId === 'cat_unknown' || before.confidence < 0.7);

      const result = recategorise(db, { entryId, categoryId, applyToAll });

      if (result.isErr()) {
        set({ error: result.error.message });
        return;
      }

      set(reread(db));
      if (wasUncertain) {
        const name = (db.getCategories().getOrNull() ?? []).find((c) => c.id === categoryId)?.name;
        emitMoment({ type: 'TRANSACTION_REVIEWED', key: `TRANSACTION_REVIEWED:${entryId}:${Date.now()}`, at: Date.now(), label: name });
      }
    },

    setEntryNotes: (entryId, notes) => {
      if (!db) return 'The ledger is not open';
      const trimmed = notes.trim();
      const result = db.updateEntry(entryId, { notes: trimmed === '' ? undefined : trimmed });
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    recordManual: (input) => {
      if (!db) return 'The ledger is not open';

      const result = recordTransaction(db, input);
      if (result.isErr()) return result.error.message;

      set(reread(db));
      return undefined;
    },

    startPayment: (request, amount, categoryId) => {
      if (!db) return 'The ledger is not open';
      const started = startPayment(db, request, amount, categoryId);
      if (started.isErr()) return started.error;
      set(reread(db));
      return started.value;
    },

    notePaymentResult: (id, appSaid) => {
      if (!db) return;
      notePaymentResult(db, id, appSaid);
      set(reread(db));
    },

    cancelPayment: (id) => {
      if (!db) return 'The ledger is not open';
      const result = cancelPayment(db, id);
      if (result.isErr()) return result.error;
      set(reread(db));
      return undefined;
    },

    confirmPaid: (id, accountId) => {
      if (!db) return 'The ledger is not open';
      const result = confirmPaid(db, id, accountId);
      if (result.isErr()) return result.error;
      set(reread(db));
      return undefined;
    },

    addPurchase: (input) => {
      if (!db) return 'The ledger is not open';
      const instance = db;

      // A new product, the money it cost and its first purchase land together
      // or not at all, so a rejected purchase never leaves an empty product
      // or an unlinked expense behind.
      const result = instance.transaction(() => {
        let productId = input.productId;
        let productName = input.newProduct?.name;
        let categoryId: Id | undefined;

        if (!productId) {
          if (!input.newProduct) return err({ code: 'INVALID_INPUT', message: 'Choose an item' });
          // A new item is filed the way it has always been filed, if it has
          // been typed in before; otherwise the product default applies.
          const created = createProduct(instance, {
            ...input.newProduct,
            categoryId: input.newProduct.categoryId ?? usualFor(instance, input.newProduct.name)?.categoryId,
          });
          if (created.isErr()) return err(created.error);
          productId = created.value.id;
          productName = productLabel(created.value);
          categoryId = created.value.categoryId;
        } else {
          const [row] = instance.query<{ name: string; brand: string | null; category_id: string | null }>(
            `SELECT name, brand, category_id FROM products WHERE id = ?`,
            [productId]
          ).getOrNull() ?? [];
          productName = row ? productLabel({ name: row.name, brand: row.brand ?? undefined }) : productName;
          categoryId = (row?.category_id ?? undefined) as Id | undefined;

          if (input.photo) {
            const photographed = updateProduct(instance, productId, { photo: input.photo });
            if (photographed.isErr()) return err(photographed.error);
          }
        }

        // Paid just now and not itemising something already on the ledger:
        // record the expense alongside the item, from the account it left.
        let entryId = input.entryId;
        if (!entryId && input.accountId) {
          const recorded = recordTransaction(instance, {
            kind: 'expense',
            amount: input.amount,
            accountId: input.accountId,
            description: productName ?? 'Purchase',
            occurredAt: input.purchasedAt,
            categoryId,
          });
          if (recorded.isErr()) return err({ code: 'INVALID_INPUT', message: recorded.error.message });
          entryId = recorded.value.id;
        }

        const bought = recordPurchase(instance, {
          productId,
          quantity: input.quantity,
          amount: input.amount,
          purchasedAt: input.purchasedAt,
          store: input.store,
          entryId,
        });

        return bought.isOk() ? ok(bought.value) : err(bought.error);
      });

      if (result.isErr()) return result.error.message;

      set(reread(instance));
      return undefined;
    },

    logUse: ({ productId, quantity, kind, date }) => {
      if (!db) return 'The ledger is not open';

      const result = logConsumption(db, { productId, quantity, kind, consumedAt: date });
      if (result.isErr()) return result.error.message;

      set(reread(db));
      return undefined;
    },

    countLeft: ({ productId, remaining, date }) => {
      if (!db) return 'The ledger is not open';

      const result = countStock(db, { productId, remaining, countedAt: date });
      if (result.isErr()) return result.error.message;

      set(reread(db));
      return undefined;
    },

    editProduct: (productId, patch) => {
      if (!db) return 'The ledger is not open';
      const result = updateProduct(db, productId, patch);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    setStaple: (productId, isStaple) => {
      if (!db) return;
      const result = updateProduct(db, productId, { isStaple });
      if (result.isErr()) {
        set({ error: result.error.message });
        return;
      }
      set(reread(db));
    },

    removePurchase: (purchaseId) => {
      if (!db) return;
      deletePurchase(db, purchaseId);
      set(reread(db));
    },

    removeConsumption: (consumptionId) => {
      if (!db) return;
      deleteConsumption(db, consumptionId);
      set(reread(db));
    },

    setPayday: (day) => {
      if (!db) return 'The ledger is not open';
      const result = setPayday(db, day);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    setCashFloor: (amount) => {
      if (!db) return 'The ledger is not open';
      const result = setCashFloor(db, amount);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    backUp: async (passphrase, random) => {
      if (!db) return { error: 'The ledger is not open' };
      const sealed = await sealBackup(db, passphrase, random);
      if (sealed.isErr()) return { error: sealed.error.message };
      return { file: sealed.value.file, entries: sealed.value.metadata.entries };
    },

    restore: async (file, passphrase) => {
      if (!db) return 'The ledger is not open';
      const instance = db;
      const restored = await openBackup(instance, file, passphrase);
      if (restored.isErr()) return restored.error.message;
      // The file carries the settings of the day it was made, including when the one
      // before it was saved; that says nothing about this phone.
      instance.setSetting('last_backup', null);
      instance.setSetting('backup_snoozed_until', null);
      advanceMomentsCursor(instance, new Date().toISOString());
      set(reread(instance, true));
      return undefined;
    },

    deleteEverything: (confirmation) => {
      if (!db) return 'The ledger is not open';
      const wiped = deleteAllData(db, confirmation);
      if (wiped.isErr()) return wiped.error.message;
      // The wipe takes the system accounts with it; put the empty ledger back.
      const seeded = db.initialize();
      if (seeded.isErr()) return seeded.error.message;
      set({ ...reread(db), lastImport: undefined, lastCas: undefined, lastPaisa: undefined, error: undefined });
      return undefined;
    },

    ingestCaptured: (alerts) => {
      const counts = { recorded: 0, cashWithdrawals: 0, waiting: 0 };
      if (!db || alerts.length === 0) return counts;
      for (const alert of alerts) {
        const outcome = ingestAlert(db, alert);
        if (outcome.isErr()) continue;
        if (outcome.value.status === 'recorded') {
          counts.recorded++;
          if (outcome.value.cashWithdrawal) counts.cashWithdrawals++;
        }
        if (outcome.value.status === 'unknown_account') counts.waiting++;
      }
      set(reread(db));
      return counts;
    },

    markBackedUp: () => {
      const day = isoDate(new Date());
      db?.setSetting('last_backup', day);
      db?.setSetting('backup_snoozed_until', null);
      set({ lastBackup: day, backupSnoozedUntil: undefined });
      emitMoment({ type: 'BACKUP_COMPLETED', key: `BACKUP_COMPLETED:${Date.now()}`, at: Date.now() });
    },

    snoozeBackup: () => {
      const until = shiftDate(isoDate(new Date()), SNOOZE_DAYS);
      db?.setSetting('backup_snoozed_until', until);
      set({ backupSnoozedUntil: until });
    },

    setTheme: (theme) => {
      db?.setSetting('theme', theme === 'system' ? null : theme);
      set({ theme });
    },

    setMotion: (motion) => {
      db?.setSetting('motion', motion);
      applyStored({
        motion,
        sound: db?.getSetting('sound').getOrNull() ?? null,
        haptics: db?.getSetting('haptics').getOrNull() ?? null,
      });
    },

    setSound: (on) => {
      db?.setSetting('sound', on ? null : 'off');
      applyStored({
        motion: db?.getSetting('motion').getOrNull() ?? null,
        sound: on ? null : 'off',
        haptics: db?.getSetting('haptics').getOrNull() ?? null,
      });
    },

    setHaptics: (on) => {
      db?.setSetting('haptics', on ? null : 'off');
      applyStored({
        motion: db?.getSetting('motion').getOrNull() ?? null,
        sound: db?.getSetting('sound').getOrNull() ?? null,
        haptics: on ? null : 'off',
      });
    },

    toggleHideAmounts: () => {
      const next = !get().hideAmounts;
      db?.setSetting('hide_amounts', next ? 'yes' : null);
      set({ hideAmounts: next });
    },

    confirmMandate: (key, details) => {
      if (!db) return 'The ledger is not open';
      const done = confirmMandate(db, key, details);
      if (done.isErr()) return done.error.message;
      set(reread(db));
      return undefined;
    },

    dismissMandate: (key) => {
      if (!db) return 'The ledger is not open';
      const done = dismissMandate(db, key);
      if (done.isErr()) return done.error.message;
      set(reread(db));
      return undefined;
    },

    sameAsBank: (pair) => {
      if (!db) return 'The ledger is not open';
      const done = sameAsBank(db, pair);
      if (done.isErr()) return done.error.message;
      set(reread(db));
      return undefined;
    },

    twoPayments: (pair) => {
      if (!db) return 'The ledger is not open';
      const done = twoPayments(db, pair);
      if (done.isErr()) return done.error.message;
      set(reread(db));
      return undefined;
    },

    saveBill: (input) => {
      if (!db) return 'The ledger is not open';
      const saved = saveBill(db, input);
      if (saved.isErr()) return saved.error.message;
      set(reread(db));
      return undefined;
    },

    keepCash: () => {
      if (!db) return 'The ledger is not open';
      const saved = acknowledgeCash(db);
      if (saved.isErr()) return saved.error.message;
      set(reread(db));
      return undefined;
    },

    addGoal: (input) => {
      if (!db) return 'The ledger is not open';
      const result = createGoal(db, input);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    addToGoal: (id, amount) => {
      if (!db) return 'The ledger is not open';
      const result = contributeToGoal(db, id, amount);
      if (result.isErr()) return result.error.message;
      set(reread(db));

      // Money added: a quiet convergence, or the goal line it reached, once each.
      const goal = result.value;
      if (amount > 0) {
        const before = paise(Math.max(0, goal.savedAmount - amount));
        const line = goalMilestone(before, goal.savedAmount, goal.targetAmount);
        const at = Date.now();
        const details = { at, label: goal.name, ref: goal.id, amount: goal.savedAmount, from: before, to: goal.savedAmount };
        const level = line === 'GOAL_COMPLETE' ? 100 : line === 'GOAL_75' ? 75 : line === 'GOAL_50' ? 50 : 25;
        if (line && level > goalLineSeen(db, goal.id)) {
          markGoalLine(db, goal.id, level);
          emitMoment({ type: line, key: `${line}:${goal.id}:${at}`, ...details });
        } else {
          emitMoment({ type: 'SAVING_ADDED', key: `SAVING_ADDED:${goal.id}:${at}`, ...details, amount });
        }
      }
      return undefined;
    },

    editGoal: (id, patch) => {
      if (!db) return 'The ledger is not open';
      const result = editGoal(db, id, patch);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    removeGoal: (id) => {
      if (!db) return;
      deleteGoal(db, id);
      set(reread(db));
    },

    addRecurring: (input) => {
      if (!db) return 'The ledger is not open';
      const result = createRecurring(db, input);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    markRecurringPaid: (id) => {
      if (!db) return 'The ledger is not open';
      const result = markRecurringPaid(db, id);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    removeRecurring: (id) => {
      if (!db) return;
      deleteRecurring(db, id);
      set(reread(db));
    },

    addBudget: (categoryId, amount) => {
      if (!db) return 'The ledger is not open';
      const result = createBudget(db, categoryId, amount);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    editBudget: (id, amount) => {
      if (!db) return 'The ledger is not open';
      const result = editBudget(db, id, amount);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    removeBudget: (id) => {
      if (!db) return;
      deleteBudget(db, id);
      set(reread(db));
    },

    noticeKeptBudgets: () => {
      if (!db) return;
      const kept = budgetsKeptLastMonth(db).filter((b) => !keptSeen(db!, b.id, b.month));
      if (kept.length === 0) return;
      for (const b of kept) markKeptSeen(db, b.id, b.month);
      // One moment however many were kept; the first one carries the celebration.
      const [first] = kept;
      emitMoment({ type: 'BUDGET_COMPLETED', key: `BUDGET_COMPLETED:${first.id}:${first.month}`, at: Date.now(), label: first.name, ref: first.id });
    },

    setBudgetRollover: (id, on) => {
      if (!db) return 'The ledger is not open';
      const result = setRollover(db, id, on);
      if (result.isErr()) return result.error.message;
      set(reread(db));
      return undefined;
    },

    clearError: () => set({ error: undefined }),
  };
});
