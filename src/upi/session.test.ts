import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type Account } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { ingestAlert } from '@/capture/ingest';
import type { CapturedAlert } from '@/capture/alerts';
import { monthSummary } from '@/repo/views';
import { format, paise } from '@/money/money';
import type { Id } from '@/lib/ulid';
import { parseUpi, type UpiRequest } from './link';
import {
  startPayment,
  notePaymentResult,
  waitingPayments,
  cancelPayment,
  confirmPaid,
  paymentFor,
  suggestedCategory,
  matchWindowClosed,
} from './session';

const SMS = 'com.google.android.apps.messaging';
const START = new Date('2026-09-25T10:00:00+05:30');
const SEPTEMBER = new Date(2026, 8, 15);

const at = (time: string) => `2026-09-25T${time}+05:30`;

/** A bank message for a UPI debit of Rs 450, naming the payee's UPI address when given one. */
const bank = (payee?: string, postedAt = at('10:00:40'), amount = '450.00', ref = '526812345678'): CapturedAlert => ({
  app: SMS,
  text: `Rs.${amount} debited from a/c **1234 on 25-09-26${payee ? ` to VPA ${payee}` : ''} (UPI Ref No ${ref}).`,
  postedAt,
});

const shop: UpiRequest = parseUpi('upi://pay?pa=abcshop@okhdfcbank&pn=ABC%20Restaurant&mc=5812').getOrNull()!;

describe('payments handed to a UPI app', () => {
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

  const entry = (id: string) =>
    db
      .query<{ description: string; category_id: string | null; kind: string }>(
        `SELECT description, category_id, kind FROM journal_entries WHERE id = ?`,
        [id]
      )
      .getOrNull()![0];
  const entryCount = () =>
    db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries`).getOrNull()![0].n;
  const legOn = (entryId: string, accountId: string) =>
    db
      .query<{ amount: number }>(`SELECT amount FROM postings WHERE entry_id = ? AND account_id = ?`, [entryId, accountId])
      .getOrNull()![0]?.amount;
  const start = (amount = paise(45000), category?: Id, when = START) => startPayment(db, shop, amount, category, when).getOrNull()!;

  describe('starting one', () => {
    it('remembers the payee and amount, waiting for evidence', () => {
      const session = start(paise(45000), 'cat_food' as Id);
      expect(session).toMatchObject({
        vpa: 'abcshop@okhdfcbank',
        name: 'ABC Restaurant',
        amount: 45000,
        categoryId: 'cat_food',
        state: 'waiting',
      });
      expect(waitingPayments(db, START)).toEqual([session]);
    });

    it('refuses an amount that is not a positive whole number of paise, or looks wrong', () => {
      expect(startPayment(db, shop, paise(0)).isErr()).toBe(true);
      expect(startPayment(db, shop, 12.5 as never).isErr()).toBe(true);
      expect(startPayment(db, shop, paise(500_000_01)).isErr()).toBe(true);
      expect(waitingPayments(db, START)).toEqual([]);
    });

    it('adds nothing to the ledger', () => {
      start();
      expect(entryCount()).toBe(0);
      expect(spent()).toBe('Rs 0.00');
    });
  });

  const spent = () => format(monthSummary(db, SEPTEMBER).spent);

  describe('what the UPI app says on the way back', () => {
    it('is kept as a note and never settles anything', () => {
      const session = start();
      notePaymentResult(db, session.id, 'success');
      const [after] = waitingPayments(db, START);
      expect(after.appSaid).toBe('success');
      expect(after.state).toBe('waiting');
      expect(entryCount()).toBe(0);
    });
  });

  describe('when the bank\'s message arrives', () => {
    it('settles the payment: the entry is named for the payee and filed as the payer chose', () => {
      const session = start(paise(45000), 'cat_food' as Id);
      const outcome = ingestAlert(db, bank('abcshop@okhdfcbank')).getOrNull()!;

      expect(outcome.status).toBe('recorded');
      const id = (outcome as { entryId: Id }).entryId;
      expect(entry(id)).toEqual({ description: 'ABC Restaurant', category_id: 'cat_food', kind: 'expense' });
      expect(legOn(id, hdfc.id)).toBe(-45000);
      expect(spent()).toBe('Rs 450.00');
      expect(waitingPayments(db, START)).toEqual([]);

      const settled = db.getSetting(`pay:${session.id}`).getOrNull()!;
      expect(JSON.parse(settled)).toMatchObject({ state: 'confirmed', evidence: 'bank message', entryId: id });
    });

    it('does not put an entry the payer categorised into the review queue', () => {
      start(paise(45000), 'cat_food' as Id);
      const outcome = ingestAlert(db, bank('abcshop@okhdfcbank')).getOrNull()!;
      expect(outcome).toMatchObject({ status: 'recorded', needsReview: false });
    });

    it('settles when the message names no payee, by amount and time alone', () => {
      start(paise(45000), 'cat_food' as Id);
      const outcome = ingestAlert(db, bank()).getOrNull()!;
      expect(entry((outcome as { entryId: Id }).entryId).description).toBe('ABC Restaurant');
    });

    it('still names the payee when no category was chosen, and leaves the category to the sorter', () => {
      start();
      const outcome = ingestAlert(db, bank('abcshop@okhdfcbank')).getOrNull()!;
      expect(entry((outcome as { entryId: Id }).entryId).description).toBe('ABC Restaurant');
    });

    it('is not settled by a different amount', () => {
      const session = start();
      ingestAlert(db, bank('abcshop@okhdfcbank', at('10:00:40'), '451.00'));
      expect(waitingPayments(db, START).map((s) => s.id)).toEqual([session.id]);
    });

    it('is not settled by a message naming a different UPI address', () => {
      const session = start();
      const outcome = ingestAlert(db, bank('someoneelse@ybl')).getOrNull()!;
      expect(entry((outcome as { entryId: Id }).entryId).description).toBe('someoneelse@ybl');
      expect(waitingPayments(db, START).map((s) => s.id)).toEqual([session.id]);
    });

    it('is not settled by a message from long before or long after paying', () => {
      const session = start();
      ingestAlert(db, bank(undefined, at('09:50:00'), '450.00', '526800000011'));
      ingestAlert(db, bank(undefined, at('11:31:00'), '450.00', '526800000012'));
      expect(waitingPayments(db, START).map((s) => s.id)).toEqual([session.id]);
      expect(entryCount()).toBe(2);
    });

    it('is settled by a message 89 minutes later, the outside of the window', () => {
      start();
      ingestAlert(db, bank(undefined, at('11:29:00')));
      expect(waitingPayments(db, START)).toEqual([]);
    });

    it('is not settled by money coming in', () => {
      const session = start();
      ingestAlert(db, {
        app: SMS,
        text: 'Rs.450.00 credited to a/c **1234 on 25-09-26 from abcshop@okhdfcbank (UPI Ref No 526812345679).',
        postedAt: at('10:00:40'),
      });
      expect(waitingPayments(db, START).map((s) => s.id)).toEqual([session.id]);
    });

    it('settles the closest of two waiting payments of the same amount, then the other', () => {
      const first = start(paise(45000), undefined, new Date('2026-09-25T10:00:00+05:30'));
      start(paise(45000), undefined, new Date('2026-09-25T10:20:00+05:30'));
      ingestAlert(db, bank(undefined, at('10:21:00')));
      expect(waitingPayments(db, START).map((s) => s.id)).toEqual([first.id]);
      ingestAlert(db, bank(undefined, at('10:22:00'), '450.00', '526800000001'));
      expect(waitingPayments(db, START)).toEqual([]);
    });

    it('counts the payment once when a second alert for it follows', () => {
      start(paise(45000), 'cat_food' as Id);
      ingestAlert(db, bank('abcshop@okhdfcbank'));
      const again = ingestAlert(db, { ...bank('abcshop@okhdfcbank', at('10:00:50')), app: 'com.snapwork.hdfc' }).getOrNull()!;
      expect(again.status).toBe('duplicate');
      expect(entryCount()).toBe(1);
      expect(spent()).toBe('Rs 450.00');
    });
  });

  describe('when the bank never writes', () => {
    it('says the automatic match is over after 90 minutes, and not before', () => {
      const session = { startedAt: START.toISOString() };
      expect(matchWindowClosed(session, new Date(START.getTime() + 89 * 60_000))).toBe(false);
      expect(matchWindowClosed(session, new Date(START.getTime() + 91 * 60_000))).toBe(true);
    });
  });

  describe('cancelling one', () => {
    it('is no longer waiting and cannot be settled by a later message', () => {
      const session = start();
      expect(cancelPayment(db, session.id).isOk()).toBe(true);
      expect(waitingPayments(db, START)).toEqual([]);
      ingestAlert(db, bank('abcshop@okhdfcbank'));
      const [entryRow] = db.query<{ description: string }>(`SELECT description FROM journal_entries`).getOrNull()!;
      expect(entryRow.description).toBe('abcshop@okhdfcbank');
      expect(cancelPayment(db, session.id).isErr()).toBe(true);
    });
  });

  describe('the payer saying it went through', () => {
    it('records the expense on the account they name, marked as their word', () => {
      const session = start(paise(45000), 'cat_food' as Id);
      const id = confirmPaid(db, session.id, hdfc.id).getOrNull()!;

      expect(entry(id)).toEqual({ description: 'ABC Restaurant', category_id: 'cat_food', kind: 'expense' });
      expect(legOn(id, hdfc.id)).toBe(-45000);
      expect(spent()).toBe('Rs 450.00');
      expect(waitingPayments(db, START)).toEqual([]);
      expect(JSON.parse(db.getSetting(`pay:${session.id}`).getOrNull()!)).toMatchObject({
        state: 'confirmed',
        evidence: 'you said so',
        entryId: id,
      });
    });

    it('cannot be said twice', () => {
      const session = start();
      expect(confirmPaid(db, session.id, hdfc.id).isOk()).toBe(true);
      expect(confirmPaid(db, session.id, hdfc.id).isErr()).toBe(true);
      expect(entryCount()).toBe(1);
    });

    it('is not counted again when the bank\'s message arrives: that message settles the entry', () => {
      const session = start(paise(45000), 'cat_food' as Id);
      const id = confirmPaid(db, session.id, hdfc.id).getOrNull()!;
      const outcome = ingestAlert(db, bank('abcshop@okhdfcbank', at('10:05:00'))).getOrNull()!;

      expect(outcome).toEqual({ status: 'duplicate', entryId: id });
      expect(entryCount()).toBe(1);
      expect(spent()).toBe('Rs 450.00');
      expect(JSON.parse(db.getSetting(`pay:${session.id}`).getOrNull()!)).toMatchObject({
        state: 'confirmed',
        evidence: 'bank message',
        entryId: id,
      });
    });

    it('moves onto the account the bank names when the payer had picked another', () => {
      const union = db
        .createAccount({ name: 'Union', kind: 'asset', subkind: 'bank', last4: '5678', isSystem: false })
        .getOrNull()!;
      const session = start();
      const id = confirmPaid(db, session.id, union.id).getOrNull()!;
      ingestAlert(db, bank('abcshop@okhdfcbank', at('10:05:00')));

      expect(legOn(id, hdfc.id)).toBe(-45000);
      expect(legOn(id, union.id)).toBeUndefined();
      expect(entryCount()).toBe(1);
    });

    it('is matched once: a second identical bank message a few minutes on is a new payment', () => {
      const session = start();
      confirmPaid(db, session.id, hdfc.id);
      ingestAlert(db, bank(undefined, at('10:05:00')));
      const second = ingestAlert(db, bank(undefined, at('10:40:00'), '450.00', '526800000002')).getOrNull()!;
      expect(second.status).toBe('recorded');
      expect(entryCount()).toBe(2);
    });
  });

  describe('listing', () => {
    it('shows waiting payments from the last week, newest first, and keeps older ones stored', () => {
      const old = start(paise(45000), undefined, new Date('2026-09-10T10:00:00+05:30'));
      const recent = start(paise(9900), undefined, new Date('2026-09-24T10:00:00+05:30'));
      const newest = start(paise(2500), undefined, new Date('2026-09-25T09:00:00+05:30'));
      expect(waitingPayments(db, START).map((s) => s.id)).toEqual([newest.id, recent.id]);
      expect(db.getSetting(`pay:${old.id}`).getOrNull()).not.toBeNull();
    });

    it('ignores a stored value that is not a payment', () => {
      db.setSetting('pay:junk', 'not json');
      db.setSetting('pay:wrong', JSON.stringify({ id: 'x', amount: -5 }));
      start();
      expect(waitingPayments(db, START)).toHaveLength(1);
      expect(paymentFor(db, { amount: paise(45000), postedAt: at('10:00:30') })).not.toBeNull();
    });
  });

  describe('suggesting a category', () => {
    it('offers the one used last time this address was paid', () => {
      start(paise(45000), 'cat_groceries' as Id, new Date('2026-09-20T10:00:00+05:30'));
      start(paise(45000), 'cat_food' as Id, new Date('2026-09-22T10:00:00+05:30'));
      expect(suggestedCategory(db, shop)).toBe('cat_food');
    });

    it('does not offer one from a cancelled payment', () => {
      const session = start(paise(45000), 'cat_groceries' as Id);
      cancelPayment(db, session.id);
      expect(suggestedCategory(db, { ...shop, merchantCode: undefined })).toBeUndefined();
    });

    it('falls back to what the payee\'s merchant code points at, else nothing', () => {
      expect(suggestedCategory(db, shop)).toBe('cat_food');
      expect(suggestedCategory(db, { vpa: 'other@ybl' })).toBeUndefined();
    });
  });
});
