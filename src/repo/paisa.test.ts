import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { format, paise } from '@/money/money';
import { ingestAlert } from '@/capture/ingest';
import { importPaisa, isPaisaBackup, PAISA_INSTITUTION } from './paisa';
import { importStatement } from './import';
import { monthSummary } from './views';
import { wealthView } from '@/wealth/repo';

const CASH = '433a5c89-0000-0000-0000-000000000001';
const MINE = 'fceda15d-0000-0000-0000-000000000002';
const FOOD = '8e639c07-0000-0000-0000-000000000003';
const FAMILY = '108659ef-0000-0000-0000-000000000004';
const SAVINGS = '1c73104f-0000-0000-0000-000000000005';
const INVESTMENT = '12cdd0a6-0000-0000-0000-000000000006';

const tx = (
  uuid: string,
  amount: number,
  createdAt: string,
  extra: Record<string, unknown> = {}
) => ({
  id: 1,
  uuid,
  name: 'Jio mart',
  amount,
  createdAt,
  type: 0,
  description: 'Glucon d 1 kg',
  account: CASH,
  category: FOOD,
  tags: [],
  ...extra,
});

/** The shape of a real Paisa backup (backupVersion 3), cut down. */
const backup = (transactions = [
  tx('t1', 432, '2026-09-10T08:24:57.865'),
  tx('t2', 17500, '2026-09-12T19:00:00.000', { name: 'Kavita', description: 'Paid for supplies', category: FAMILY }),
  tx('t3', 12.5, '2026-09-14T09:00:00.000', { name: 'Curd', description: '' }),
  tx('t4', 5000, '2026-09-15T15:48:00.000', { type: 1, name: 'Mohit ', description: 'Gym monthly ', category: SAVINGS, account: MINE }),
  tx('t5', 3000, '2026-09-16T10:00:00.000', { name: 'Asha', description: 'Investment', category: INVESTMENT }),
]) =>
  JSON.stringify({
    backupVersion: 3,
    transactions,
    accounts: [
      { uuid: CASH, name: 'Ravi', bankName: 'Cash', amount: 0 },
      { uuid: MINE, name: 'Asha', bankName: 'Asha expenses ', amount: 0 },
    ],
    categories: [
      { uuid: FOOD, name: 'Food', type: 0 },
      { uuid: FAMILY, name: 'Family relationship ', type: 0 },
      { uuid: SAVINGS, name: 'Savings', type: 1 },
      { uuid: INVESTMENT, name: 'Investment', type: 0 },
    ],
    goals: [{ name: 'Emergency fund', amount: 100000 }],
    budgets: [{ name: 'Grocery ', amount: 4000 }],
    recurrings: [],
  });

const SEPTEMBER = new Date(2026, 8, 15);

describe('importing a Paisa backup', () => {
  let db: Database;
  let bank: Account;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    bank = db
      .createAccount({ name: 'Union Bank', kind: 'asset', subkind: 'bank', last4: '5501', isSystem: false })
      .getOrNull()!;
  });

  afterEach(() => db.close());

  const entries = () =>
    db
      .query<{ description: string; notes: string | null; category_id: string | null; kind: string }>(
        `SELECT description, notes, category_id, kind FROM journal_entries ORDER BY occurred_at`
      )
      .getOrNull()!;

  it('recognises a Paisa backup and nothing else', () => {
    expect(isPaisaBackup(backup())).toBe(true);
    expect(isPaisaBackup('Date,Narration,Amount\n')).toBe(false);
    expect(isPaisaBackup('{"transactions": 1}')).toBe(false);
    expect(importPaisa(db, '{}', 'x.json').isErr()).toBe(true);
  });

  it('brings in every transaction with its name, note and category', () => {
    const result = importPaisa(db, backup(), 'paisa.json').getOrNull()!;

    expect(result.created).toBe(5);
    expect(result.failed).toEqual([]);
    expect(result.from).toBe('2026-09-10');
    expect(result.to).toBe('2026-09-16');
    expect(result.keptAside).toEqual({ goals: 1, budgets: 1, recurring: 0 });

    const rows = entries();
    expect(rows[0]).toEqual({ description: 'Jio mart', notes: 'Glucon d 1 kg', category_id: 'cat_food', kind: 'expense' });
    expect(rows[1]).toMatchObject({ description: 'Kavita', category_id: 'cat_family' });
    expect(rows[3]).toMatchObject({ description: 'Mohit', notes: 'Gym monthly', category_id: 'cat_savings', kind: 'income' });
    // Paisa counted "Investment" as spending, and so does the import.
    expect(rows[4]).toMatchObject({ category_id: 'cat_investment', kind: 'expense' });
  });

  it('reads amounts as exact paise and counts them as spending', () => {
    importPaisa(db, backup(), 'paisa.json');
    const summary = monthSummary(db, SEPTEMBER);
    expect(format(summary.spent)).toBe('Rs 20,944.50');
    expect(format(summary.received)).toBe('Rs 5,000.00');
  });

  it('makes one hand-kept account per Paisa account, adding nothing to wealth', () => {
    const result = importPaisa(db, backup(), 'paisa.json').getOrNull()!;
    expect(result.accounts.sort()).toEqual(['Asha expenses', 'Cash · Ravi']);

    const paisaAccounts = db.getAllAccounts().getOrNull()!.filter((a) => a.institution === PAISA_INSTITUTION);
    expect(paisaAccounts).toHaveLength(2);
    for (const account of paisaAccounts) {
      expect(db.reportedBalance(account.id).getOrNull()).toBe(paise(0));
    }
    expect(wealthView(db).total).toBe(paise(0));
  });

  it('keeps every transaction as raw input, and the rest of the backup too', () => {
    importPaisa(db, backup(), 'paisa.json');
    const raws = db.getRawRecords().getOrNull()!;
    expect(raws.filter((r) => r.sourceRef?.startsWith('paisa:'))).toHaveLength(5);
    const rest = raws.find((r) => r.sourceRef === 'paisa-backup:paisa.json')!;
    expect(JSON.parse(rest.payload).goals[0].name).toBe('Emergency fund');
  });

  it('adds nothing when the same backup is imported again', () => {
    importPaisa(db, backup(), 'paisa.json');
    const again = importPaisa(db, backup(), 'paisa.json').getOrNull()!;
    expect(again).toMatchObject({ created: 0, skipped: 5 });
    expect(entries()).toHaveLength(5);
  });

  it('brings in a transfer between two Paisa wallets as a transfer, not spending', () => {
    const result = importPaisa(
      db,
      backup([
        tx('t9', 500, '2026-09-10T08:00:00.000', {
          type: 2, name: '', description: 'Cash for the week', account: null, category: null,
          fromAccount: MINE, toAccount: CASH,
        }),
      ]),
      'paisa.json'
    ).getOrNull()!;

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([]);
    expect(entries()[0]).toEqual({
      description: 'Transfer to Cash · Ravi', notes: 'Cash for the week', category_id: 'cat_transfers', kind: 'transfer',
    });
    const summary = monthSummary(db, SEPTEMBER);
    expect(format(summary.spent)).toBe('Rs 0.00');
    expect(format(summary.received)).toBe('Rs 0.00');
    expect(result.accounts.sort()).toEqual(['Asha expenses', 'Cash · Ravi']);
  });

  it('refuses a transfer whose wallets are missing or the same', () => {
    const result = importPaisa(
      db,
      backup([
        tx('t9', 500, '2026-09-10T08:00:00.000', { type: 2, fromAccount: CASH, toAccount: 'gone' }),
        tx('t10', 500, '2026-09-10T09:00:00.000', { type: 2, fromAccount: CASH, toAccount: CASH }),
      ]),
      'paisa.json'
    ).getOrNull()!;
    expect(result.created).toBe(0);
    expect(result.failed).toEqual([
      { uuid: 't9', reason: 'A transfer account is not in the backup' },
      { uuid: 't10', reason: 'A transfer to the same account' },
    ]);
  });

  it('never lets a bank payment of the same amount claim a Paisa transfer', () => {
    importPaisa(
      db,
      backup([tx('t9', 17500, '2026-09-12T08:00:00.000', { type: 2, fromAccount: MINE, toAccount: CASH })]),
      'paisa.json'
    );
    ingestAlert(db, {
      app: 'com.google.android.apps.messaging',
      text: 'Rs.17500.00 debited from a/c **5501 on 12-09-26 to VPA kavita@ybl (UPI Ref No 526812345678).',
      postedAt: '2026-09-12T19:02:00+05:30',
    });
    // The bank payment is its own expense; the transfer stays between the two wallets.
    expect(entries().map((e) => e.kind).sort()).toEqual(['expense', 'transfer']);
    expect(format(monthSummary(db, SEPTEMBER).spent)).toBe('Rs 17,500.00');
  });

  it('counts a payment once when the bank message arrives after the import', () => {
    importPaisa(db, backup(), 'paisa.json');
    const outcome = ingestAlert(db, {
      app: 'com.google.android.apps.messaging',
      text: 'Rs.17500.00 debited from a/c **5501 on 12-09-26 to VPA kavita@ybl (UPI Ref No 526812345678).',
      postedAt: '2026-09-12T19:02:00+05:30',
    }).getOrNull()!;

    expect(outcome.status).toBe('duplicate');
    expect(format(monthSummary(db, SEPTEMBER).spent)).toBe('Rs 20,944.50');
    // The payment now sits on the bank account, still called what the user called it.
    const [onBank] = db
      .query<{ description: string }>(
        `SELECT e.description FROM journal_entries e JOIN postings p ON p.entry_id = e.id WHERE p.account_id = ?`,
        [bank.id]
      )
      .getOrNull()!;
    expect(onBank.description).toBe('Kavita');
  });

  it('counts a payment once when the statement is imported after it', () => {
    importPaisa(db, backup(), 'paisa.json');
    const result = importStatement(db, {
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-09-12,2026-09-12,17500.00,,82500.00,UPI-KAVITA-kavita@ybl-526812345678',
      ].join('\n'),
      sourceRef: 'union.csv',
      source: 'statement_csv',
      account: bank,
      ownAccounts: [],
    }).getOrNull()!;

    expect(result.duplicatesSkipped).toBe(1);
    expect(format(monthSummary(db, SEPTEMBER).spent)).toBe('Rs 20,944.50');
  });

  it('adds Paisa\'s name and category to a payment already recorded from the bank', () => {
    ingestAlert(db, {
      app: 'com.google.android.apps.messaging',
      text: 'Rs.432.00 debited from a/c **5501 on 10-09-26 to VPA jiomart@axis (UPI Ref No 526812345000).',
      postedAt: '2026-09-10T08:25:00+05:30',
    });

    const result = importPaisa(db, backup(), 'paisa.json').getOrNull()!;
    expect(result).toMatchObject({ created: 4, matched: 1 });

    const bankEntry = entries().find((e) => e.notes?.startsWith('Paisa:'))!;
    expect(bankEntry.notes).toBe('Paisa: Jio mart (Glucon d 1 kg)');
    expect(bankEntry.category_id).toBe('cat_food');
    expect(format(monthSummary(db, SEPTEMBER).spent)).toBe('Rs 20,944.50');
  });
});

describe('reading messages again after a Paisa import', () => {
  const KAVITA = {
    app: 'sms',
    sender: 'JM-UNIONB-T',
    text: 'Union Bank of India A/c *5501 Debited Rs:17500.00 on 12-09-2026 19:02:00 by Mob Bk ref no 626500001111, Fvg: KAVITA Avl Bal Rs:82500.00. Not you?Call 18002082244',
    postedAt: '2026-09-12T19:02:00+05:30',
  };
  const GOPAL = {
    app: 'sms',
    sender: 'JM-UNIONB-T',
    text: 'Union Bank of India A/c *5501 Debited Rs:80.00 on 21-09-2026 18:49:15 by Mob Bk ref no 626400001111, Fvg: GOPAL Avl Bal Rs:654.32.',
    postedAt: '2026-09-21T18:49:15+05:30',
  };

  let db: Database;
  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    db.createAccount({ name: 'Union Bank', kind: 'asset', subkind: 'bank', last4: '5501', isSystem: false });
    importPaisa(db, backup(), 'paisa.json');
  });
  afterEach(() => db.close());

  const count = () => db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries`).getOrNull()![0].n;

  it('adds nothing when an alert that was matched to Paisa is read again', async () => {
    const { ingestAlert } = await import('@/capture/ingest');
    ingestAlert(db, KAVITA);
    const before = count();
    const [raw] = db.query<{ id: string }>(`SELECT id FROM raw_records WHERE source = 'notification'`).getOrNull()!;
    const again = ingestAlert(db, KAVITA, raw.id as never).getOrNull()!;
    expect(again.status).toBe('duplicate');
    expect(count()).toBe(before);
  });

  it('rebuilds the same ledger from the messages, however often', async () => {
    const { ingestAlert, rebuildFromMessages } = await import('@/capture/ingest');
    ingestAlert(db, KAVITA);
    ingestAlert(db, GOPAL);
    const spent = format(monthSummary(db, SEPTEMBER).spent);
    const entries = count();

    rebuildFromMessages(db);
    rebuildFromMessages(db);

    expect(count()).toBe(entries);
    expect(format(monthSummary(db, SEPTEMBER).spent)).toBe(spent);
    const union = db.getAllAccounts().getOrNull()!.find((a) => a.name === 'Union Bank')!;
    expect(format(db.reportedBalance(union.id).getOrNull()!)).toBe('Rs 654.32');
  });
});
