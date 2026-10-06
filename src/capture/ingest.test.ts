import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { ingestAlert, retryUnmatched, resortMessages, waitingAccounts } from './ingest';
import { parseAlert, type CapturedAlert } from './alerts';
import { pendingMandates, confirmMandate } from './mandates';
import { importStatement } from '@/repo/import';
import { monthSummary, accountsWithBalances } from '@/repo/views';
import { format } from '@/money/money';
import type { Id } from '@/lib/ulid';

const SMS = 'com.google.android.apps.messaging';
const HDFC_APP = 'com.snapwork.hdfc';

const alert = (text: string, postedAt = '2026-09-25T10:00:00+05:30', app = SMS): CapturedAlert => ({
  app,
  text,
  postedAt,
});

const SWIGGY =
  'Rs.450.00 debited from a/c **1234 on 25-09-26 to VPA swiggy@icici (UPI Ref No 526812345678).';

describe('capturing alerts into the ledger', () => {
  let db: Database;
  let hdfc: Account;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    hdfc = db
      .createAccount({ name: 'HDFC Savings', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false })
      .getOrNull()!;
  });

  afterEach(() => db.close());

  const spentIn = (date: Date) => format(monthSummary(db, date).spent);
  const SEPTEMBER = new Date(2026, 8, 15);

  it('records a UPI payment as spending on the right account', () => {
    const outcome = ingestAlert(db, alert(SWIGGY)).getOrNull()!;

    expect(outcome.status).toBe('recorded');
    expect(spentIn(SEPTEMBER)).toBe('Rs 450.00');

    const [raw] = db.getRawRecords().getOrNull()!;
    expect(raw.source).toBe('notification');
    expect(JSON.parse(raw.payload).text).toBe(SWIGGY);
  });

  it('counts a payment once when the SMS and the bank app both report it', () => {
    ingestAlert(db, alert(SWIGGY));
    const second = ingestAlert(
      db,
      alert(
        'Rs 450.00 sent to swiggy@icici from A/c XX1234. UPI Ref 526812345678',
        '2026-09-25T10:00:20+05:30',
        HDFC_APP
      )
    ).getOrNull()!;

    expect(second.status).toBe('duplicate');
    expect(spentIn(SEPTEMBER)).toBe('Rs 450.00');
  });

  it('keeps two genuine payments of the same amount', () => {
    ingestAlert(db, alert(SWIGGY));
    ingestAlert(
      db,
      alert(SWIGGY.replace('526812345678', '526899990000'), '2026-09-25T20:30:00+05:30')
    );
    expect(spentIn(SEPTEMBER)).toBe('Rs 900.00');
  });

  it('moves ATM cash to a Cash account instead of calling it spending', () => {
    const outcome = ingestAlert(
      db,
      alert('Rs.5000 withdrawn at ATM S1AB1234 from A/c XX1234 on 25SEP26. Avl bal Rs.4,95,000.00')
    ).getOrNull()!;

    expect(outcome).toMatchObject({ status: 'recorded', cashWithdrawal: true });
    expect(spentIn(SEPTEMBER)).toBe('Rs 0.00');
    const cash = accountsWithBalances(db).find((a) => a.name === 'Cash')!;
    expect(format(cash.balance)).toBe('Rs 5,000.00');
    expect(db.verifyLedger().isOk()).toBe(true);
  });

  it('records a salary credit as income', () => {
    ingestAlert(
      db,
      alert('Rs 75,000.00 credited to a/c XX1234 on 25-09-26 by NEFT ACME CORP PVT LTD. Avl Bal Rs 5,48,901.00')
    );
    expect(format(monthSummary(db, SEPTEMBER).received)).toBe('Rs 75,000.00');
  });

  it('keeps the raw alert but records nothing for an OTP', () => {
    const outcome = ingestAlert(db, alert('123456 is your OTP for Rs 4,999 at AMAZON.')).getOrNull()!;
    expect(outcome.status).toBe('ignored');
    expect(db.getRawRecords().getOrNull()).toHaveLength(1);
    expect(spentIn(SEPTEMBER)).toBe('Rs 0.00');
  });

  it('waits for an account it does not know, then records it once added', () => {
    const icici = 'ICICI Bank Acct XX789 debited for Rs 2,000.00 on 25-Sep-26; RAMESH KUMAR credited. UPI:526833334444.';
    const outcome = ingestAlert(db, alert(icici)).getOrNull()!;
    expect(outcome).toEqual({ status: 'unknown_account', digits: '789' });
    expect(waitingAccounts(db)).toHaveLength(1);

    // Retrying before the account exists copies nothing.
    expect(retryUnmatched(db)).toBe(0);
    expect(db.getRawRecords().getOrNull()).toHaveLength(1);

    db.createAccount({ name: 'ICICI', kind: 'asset', subkind: 'bank', last4: '6789', isSystem: false });
    expect(retryUnmatched(db)).toBe(1);
    expect(spentIn(SEPTEMBER)).toBe('Rs 2,000.00');
    expect(waitingAccounts(db)).toHaveLength(0);
  });

  it('lists the accounts whose messages are waiting, with what they say moved', () => {
    const union = (last4: string, verb: string, amount: string, day: string) =>
      alert(`A/c *${last4} ${verb} for Rs. ${amount} on ${day} 09:32:04 by Mob Bk Avl Bal Rs:0.00 -Union Bank of India`);
    ingestAlert(db, union('0100', 'Debited', '5002.00', '07-04-2025'));
    ingestAlert(db, union('0100', 'Credited', '5000.00', '28-03-2025'));
    ingestAlert(db, union('1229', 'Debited', '10149.00', '15-02-2025'));

    const waiting = waitingAccounts(db);
    expect(waiting.map((w) => [w.digits, w.messages])).toEqual([['0100', 2], ['1229', 1]]);
    expect(format(waiting[0].moneyOut)).toBe('Rs 5,002.00');
    expect(format(waiting[0].moneyIn)).toBe('Rs 5,000.00');

    // Adding the account clears it from the list.
    db.createAccount({ name: 'Old Union', kind: 'asset', subkind: 'bank', last4: '0100', isSystem: false });
    retryUnmatched(db);
    expect(waitingAccounts(db).map((w) => w.digits)).toEqual(['1229']);
  });

  it('puts an app notification with no account on the only account there is', () => {
    const outcome = ingestAlert(
      db,
      alert('₹450 paid to Swiggy', '2026-09-25T10:00:00+05:30', 'com.google.android.apps.nbu.paisa.user')
    ).getOrNull()!;
    expect(outcome.status).toBe('recorded');
  });

  it('is absorbed by the month-end statement instead of counted twice', () => {
    ingestAlert(db, alert('Rs.2,500.00 debited from a/c **1234 on 06-01-26 to VPA amazon@apl (UPI Ref No 526800001111).', '2026-01-06T12:00:00+05:30'));

    importStatement(db, {
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-01-05,2026-01-05,,50000.00,500000.00,SALARY',
        '2026-01-06,2026-01-06,2500.00,,497500.00,UPI-AMAZON PAY-amazon@apl',
      ].join('\n'),
      sourceRef: 'jan.csv',
      source: 'statement_csv',
      account: hdfc,
    });

    expect(format(monthSummary(db, new Date(2026, 0, 15)).spent)).toBe('Rs 2,500.00');
  });

  it('takes the payee from the statement when the message only said "Mob Bk"', () => {
    const recorded = (text: string) =>
      (ingestAlert(db, alert(text, '2026-01-06T12:00:00+05:30')).getOrNull() as { entryId: Id }).entryId;
    const unnamed = recorded('A/c *1234 Debited for Rs. 750.00 on 06-01-2026 09:32:04 by Mob Bk Avl Bal Rs:0.00 -Union Bank of India');
    const named = recorded('Rs.2,500.00 debited from a/c **1234 on 06-01-26 to VPA amazon@apl (UPI Ref No 526800001111).');
    const amazon = db.getEntry(named).getOrNull()!.description;

    importStatement(db, {
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-01-06,2026-01-06,750.00,,499250.00,UPI-SWIGGY LIMITED-swiggy@icici',
        '2026-01-06,2026-01-06,2500.00,,496750.00,UPI-AMAZON PAY-amazon@apl',
      ].join('\n'),
      sourceRef: 'jan.csv',
      source: 'statement_csv',
      account: hdfc,
    });

    expect(db.getEntry(unnamed).getOrNull()).toMatchObject({ description: 'UPI-SWIGGY LIMITED-swiggy@icici', categoryId: 'cat_food', kind: 'expense' });
    expect(db.getEntry(named).getOrNull()!.description).toBe(amazon);
    expect(format(monthSummary(db, new Date(2026, 0, 15)).spent)).toBe('Rs 3,250.00');
  });

  it('ignores a later alert for a payment the statement already has', () => {
    importStatement(db, {
      text: [
        'Booking Date,Value Date,Debit Amount,Credit Amount,Closing Balance,Narration/Description',
        '2026-09-25,2026-09-25,450.00,,499550.00,UPI-SWIGGY-swiggy@icici',
      ].join('\n'),
      sourceRef: 'sep.csv',
      source: 'statement_csv',
      account: hdfc,
    });
    const outcome = ingestAlert(db, alert(SWIGGY)).getOrNull()!;
    expect(outcome.status).toBe('duplicate');
    expect(spentIn(SEPTEMBER)).toBe('Rs 450.00');
  });

  it('asks about an autopay once, and files its debits under Subscriptions once confirmed', () => {
    const created = 'Your UPI AutoPay mandate for Netflix of Rs 649.00 has been successfully created. Frequency: Monthly.';
    expect(ingestAlert(db, alert(created)).getOrNull()).toEqual({ status: 'mandate', isNew: true });
    // The app that set it up announces it too.
    expect(ingestAlert(db, alert(created, '2026-09-25T10:01:00+05:30', HDFC_APP)).getOrNull()).toEqual({
      status: 'mandate',
      isNew: false,
    });

    const [pending] = pendingMandates(db);
    expect(pending).toMatchObject({ payee: 'Netflix', frequency: 'monthly' });
    expect(confirmMandate(db, pending.key, { purpose: 'Family plan' }).isOk()).toBe(true);
    expect(pendingMandates(db)).toHaveLength(0);

    ingestAlert(db, alert('Rs 649.00 debited from a/c **1234 to NETFLIX via UPI Mandate. UPI Ref 626955550000', '2026-10-05T09:00:00+05:30'));
    const [debit] = db.getEntries({ search: 'NETFLIX' }).getOrNull()!;
    expect(debit.categoryId).toBe('cat_subscriptions');
  });

  it('keeps a scam out of the ledger and says so on its raw record', () => {
    const outcome = ingestAlert(
      db,
      alert('Dear customer your SBI account will be blocked. Update KYC now http://sbi-kyc.co/x Rs 1 fee')
    ).getOrNull()!;
    expect(outcome).toEqual({ status: 'ignored', kind: 'scam' });
    expect(db.getRawRecords().getOrNull()![0].parseError).toBe('Sorted: scam');
  });

  it('re-sorts messages the old sorter got wrong: an autopay payment stops being a card', () => {
    const text = 'Dear Customer, Your account has  been successfully debited with Rs.398.99 on 28/06/2026 towards Adobe Syst UPI AutoPay-Union Bank of India';
    // As the first sorter left it: a raw record labelled a mandate, and a card.
    const raw = db.saveRawRecord({
      source: 'notification',
      sourceRef: 'sms',
      payload: JSON.stringify(alert(text, '2026-09-20T10:00:00+05:30', 'sms')),
      parser: 'alert_v1',
    }).getOrNull()!;
    db.run(`UPDATE raw_records SET parse_error = 'Sorted: mandate' WHERE id = ?`, [raw.id]);
    db.setSetting(`mandate:${raw.id}`, JSON.stringify({ payee: 'Rs.398.99', upTo: false, seenAt: 'x', status: 'pending' }));

    expect(resortMessages(db)).toBe(1);
    expect(pendingMandates(db)).toHaveLength(0);
    const [entry] = db.getEntries({ search: 'Adobe' }).getOrNull()!;
    expect(entry.categoryId).toBe('cat_subscriptions');
    expect(format(monthSummary(db, SEPTEMBER).spent)).toBe('Rs 398.99');

    // Only once per sorter version.
    expect(resortMessages(db)).toBe(0);
  });

  it('keeps the account balance to the rupee from "Avl Bal" in alerts', () => {
    ingestAlert(db, alert('Rs 75,000.00 credited to a/c XX1234 on 25-09-26 by NEFT ACME. Avl Bal Rs 1,20,000.00', '2026-09-25T09:00:00+05:30'));
    const balance = () => format(accountsWithBalances(db).find((a) => a.name === 'HDFC Savings')!.balance);
    expect(balance()).toBe('Rs 1,20,000.00');

    // A later payment that day, with no balance printed, still counts.
    ingestAlert(db, alert(SWIGGY, '2026-09-25T13:00:00+05:30'));
    expect(balance()).toBe('Rs 1,19,550.00');

    // The next alert with a balance sets it again.
    ingestAlert(db, alert('Rs.5000 withdrawn at ATM S1AB1234 from A/c XX1234 on 26SEP26. Avl bal Rs.1,14,550.00', '2026-09-26T10:00:00+05:30'));
    expect(balance()).toBe('Rs 1,14,550.00');
  });

  it('never takes a card\'s available limit for a balance', () => {
    const card = parseAlert(alert('Rs.3,499.00 spent on HDFC Bank Card x9876 at AMAZON on 2026-09-25. Avl Lmt: Rs.96,501.00'))!;
    expect(card.balance).toBeUndefined();
  });
});

describe('an alert that names no account', () => {
  it('goes to the one account of the bank that sent it', () => {
    const db = new Database(new NodeSqliteDriver());
    db.initialize();
    const union = db.createAccount({ name: 'Union Bank', kind: 'asset', subkind: 'bank', last4: '5501', isSystem: false }).getOrNull()!;
    db.createAccount({ name: 'SBI', kind: 'asset', subkind: 'bank', last4: '7702', isSystem: false });

    const outcome = ingestAlert(db, {
      app: 'sms',
      sender: 'BG-UNIONB-S',
      text: 'Dear Customer, Your account has  been successfully debited with Rs.199.00 on 12/06/2026 towards Amazon Ind UPI AutoPay-Union Bank of India',
      postedAt: '2026-06-12T08:00:00+05:30',
    }).getOrNull()!;

    expect(outcome.status).toBe('recorded');
    expect(format(accountsWithBalances(db).find((a) => a.id === union.id)!.balance)).toBe('-Rs 199.00');
    db.close();
  });
});
