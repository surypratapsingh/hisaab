import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '@/db/client';
import { NodeSqliteDriver } from '@/db/drivers/node';
import { ingestAlert } from './ingest';
import { messagesView } from './messages';
import type { CapturedAlert } from './alerts';

// Made-up messages only.
const SMS = 'com.google.android.apps.messaging';
const msg = (text: string, postedAt: string, extra: Partial<CapturedAlert> = {}): CapturedAlert => ({
  app: SMS,
  text,
  postedAt,
  ...extra,
});

describe('the Messages view', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(new NodeSqliteDriver());
    db.initialize();
    db.createAccount({ name: 'HDFC Savings', kind: 'asset', subkind: 'bank', last4: '1234', isSystem: false });
  });
  afterEach(() => db.close());

  it('is empty before anything is captured', () => {
    expect(messagesView(db)).toEqual({
      rows: [],
      counts: { transaction: 0, mandate: 0, otp: 0, offer: 0, scam: 0, reminder: 0, info: 0 },
    });
  });

  it('lists messages newest first by when the phone got them, whatever order they were stored in', () => {
    ingestAlert(db, msg('Rs.200.00 debited from a/c **1234 on 26-09-26 to VPA b@icici (UPI Ref No 526800000002).', '2026-09-26T10:00:00+05:30'));
    ingestAlert(db, msg('Rs.100.00 debited from a/c **1234 on 25-09-26 to VPA a@icici (UPI Ref No 526800000001).', '2026-09-25T10:00:00+05:30'));

    const { rows } = messagesView(db);
    expect(rows.map((r) => r.at)).toEqual(['2026-09-26T10:00:00+05:30', '2026-09-25T10:00:00+05:30']);
  });

  it('counts each kind and the counts add up to the rows', () => {
    ingestAlert(db, msg('Rs.100.00 debited from a/c **1234 on 25-09-26 to VPA a@icici (UPI Ref No 526800000001).', '2026-09-25T10:00:00+05:30'));
    ingestAlert(db, msg('123456 is your OTP for a transaction of Rs 4,999. Do not share.', '2026-09-25T11:00:00+05:30'));

    const { rows, counts } = messagesView(db);
    expect(counts.transaction).toBe(1);
    expect(counts.otp).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(rows.find((r) => r.text.includes('OTP'))!.kind).toBe('otp');
  });

  it('names the sender: SMS sender id, else title, else a friendly app name, else the package', () => {
    const t = '2026-09-25T10:00:00+05:30';
    ingestAlert(db, msg('Your statement is ready.', '2026-09-25T10:00:01+05:30', { sender: 'VM-HDFCBK' }));
    ingestAlert(db, msg('Your statement is ready.', '2026-09-25T10:00:02+05:30', { title: 'Rahul' }));
    ingestAlert(db, msg('Your statement is ready.', '2026-09-25T10:00:03+05:30', { app: 'com.phonepe.app' }));
    ingestAlert(db, msg('Your statement is ready.', t, { app: 'com.example.unknown' }));

    const from = messagesView(db).rows.map((r) => r.from);
    expect(from).toEqual(['PhonePe', 'Rahul', 'VM-HDFCBK', 'com.example.unknown']);
  });

  it('keeps only the most recent `limit` messages', () => {
    for (let i = 1; i <= 5; i++) {
      ingestAlert(db, msg(`Your statement ${i} is ready.`, `2026-09-2${i}T10:00:00+05:30`));
    }
    expect(messagesView(db, 2).rows).toHaveLength(2);
  });

  it('skips a stored record whose payload is not JSON instead of failing the screen', () => {
    ingestAlert(db, msg('Your statement is ready.', '2026-09-25T10:00:00+05:30'));
    db.run(`UPDATE raw_records SET payload = 'not json' WHERE source = 'notification'`);
    expect(messagesView(db).rows).toEqual([]);
  });
});
