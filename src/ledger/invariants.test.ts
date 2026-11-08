import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { ingestAlert, rebuildFromMessages } from '@/capture/ingest';
import { parseAlert, type CapturedAlert } from '@/capture/alerts';
import { fromRupeeString, paise, sum, toPlainRupees, format } from '@/money/money';

// Made-up alerts only; no real account numbers or payees.
const SMS = 'com.google.android.apps.messaging';
const alert = (text: string, postedAt: string): CapturedAlert => ({ app: SMS, text, postedAt });

const ALERTS: CapturedAlert[] = [
  alert('Rs.450.00 debited from a/c **1234 on 25-09-26 to VPA swiggy@icici (UPI Ref No 526812345678).', '2026-09-25T10:00:00+05:30'),
  alert('Rs 75,000.00 credited to a/c XX1234 on 01-10-26 by NEFT ACME CORP PVT LTD. Avl Bal Rs 5,48,901.00', '2026-10-01T09:00:00+05:30'),
  alert('Rs.5000 withdrawn at ATM S1AB1234 from A/c XX1234 on 25SEP26. Avl bal Rs.4,95,000.00', '2026-09-25T18:00:00+05:30'),
  alert('Rs.0.07 debited from a/c **1234 on 26-09-26 to VPA tiny@icici (UPI Ref No 526800000007).', '2026-09-26T08:00:00+05:30'),
  alert('123456 is your OTP for a transaction of Rs 4,999 at AMAZON.', '2026-09-26T09:00:00+05:30'),
];

describe('ledger invariants', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    db.createAccount({ name: 'HDFC Savings', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false });
  });
  afterEach(() => db.close());

  const unbalancedEntries = () =>
    db
      .query<{ id: string }>(`SELECT entry_id AS id FROM postings GROUP BY entry_id HAVING SUM(amount) <> 0`)
      .getOrNull()!;
  const totalOfPostings = () =>
    db.query<{ t: number | null }>(`SELECT SUM(amount) AS t FROM postings`).getOrNull()![0].t ?? 0;
  const entryCount = () =>
    db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries`).getOrNull()![0].n;
  const snapshot = () =>
    db
      .query<{ account_id: string; t: number }>(
        `SELECT account_id, SUM(amount) AS t FROM postings GROUP BY account_id ORDER BY account_id`
      )
      .getOrNull()!;

  it('every entry nets to zero after a mix of alerts, and so does the whole book', () => {
    for (const a of ALERTS) expect(ingestAlert(db, a).isOk()).toBe(true);

    expect(entryCount()).toBeGreaterThan(0);
    expect(unbalancedEntries()).toEqual([]);
    expect(totalOfPostings()).toBe(0);
  });

  it('keeps an odd paise amount exactly: Rs 0.07 is 7 paise, not 0 or 8', () => {
    ingestAlert(db, ALERTS[3]);
    const amounts = db
      .query<{ amount: number }>(`SELECT amount FROM postings ORDER BY amount`)
      .getOrNull()!
      .map((r) => r.amount);
    expect(amounts).toEqual([-7, 7]);
  });

  it('counts the very same alert once however many times it is delivered', () => {
    ingestAlert(db, ALERTS[0]);
    const before = entryCount();
    for (let i = 0; i < 3; i++) ingestAlert(db, ALERTS[0]);
    expect(entryCount()).toBe(before);
    expect(totalOfPostings()).toBe(0);
  });

  it('counts a re-delivered alert once even when it carries no reference', () => {
    const noRef = alert('Rs.120.00 debited from a/c **1234 on 25-09-26 to VPA chai@icici.', '2026-09-25T11:00:00+05:30');
    ingestAlert(db, noRef);
    const before = entryCount();
    ingestAlert(db, { ...noRef, postedAt: '2026-09-25T11:00:05+05:30' });
    expect(entryCount()).toBe(before);
  });

  it('rebuilding from messages is idempotent: same entries, same balances, every time', () => {
    for (const a of ALERTS) ingestAlert(db, a);
    const first = { n: entryCount(), balances: snapshot() };

    rebuildFromMessages(db);
    const second = { n: entryCount(), balances: snapshot() };
    rebuildFromMessages(db);

    expect({ n: entryCount(), balances: snapshot() }).toEqual(second);
    expect(second).toEqual(first);
    expect(unbalancedEntries()).toEqual([]);
  });
});

describe('paise precision', () => {
  it.each(['0.01', '0.07', '0.10', '1234.5', '99999999.99', '1,00,000'])(
    'reads "%s" from an alert and prints it back to the paise',
    (rupees) => {
      const found = parseAlert(alert(`Rs ${rupees} debited from a/c XX1234 on 25-09-26.`, '2026-09-25T10:00:00+05:30'))!;
      expect(found.amount).toBe(fromRupeeString(rupees.replace(/,/g, '')));
      expect(Number.isInteger(found.amount)).toBe(true);
      expect(fromRupeeString(toPlainRupees(found.amount))).toBe(found.amount);
    }
  );

  it('adds ten times Rs 0.10 to exactly Rs 1.00 (no float drift)', () => {
    expect(sum(Array(10).fill(fromRupeeString('0.10')))).toBe(paise(100));
    expect(format(sum(Array(3).fill(fromRupeeString('0.10'))))).toBe('Rs 0.30');
  });

  it('refuses a fractional paise amount rather than rounding it silently', () => {
    expect(() => paise(0.5)).toThrow();
  });
});
