import { Database } from '@/db/client';
import type { Id } from '@/lib/ulid';
import type { CapturedAlert } from './alerts';
import { sortMessage, type MessageKind } from './sort';

export type MessageRow = {
  id: Id;
  /** When the phone received it, ISO 8601 with time. */
  at: string;
  /** "VM-HDFCBK", a phone number, or the app that posted it. */
  from: string;
  text: string;
  kind: MessageKind;
  reason: string;
};

export type MessagesView = {
  rows: MessageRow[];
  counts: Record<MessageKind, number>;
};

const KINDS: MessageKind[] = ['transaction', 'mandate', 'otp', 'offer', 'scam', 'reminder', 'info'];

/** Friendly names for the apps notifications come from. */
const APPS: Record<string, string> = {
  'com.google.android.apps.messaging': 'Messages',
  'com.samsung.android.messaging': 'Messages',
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'com.phonepe.app': 'PhonePe',
  'net.one97.paytm': 'Paytm',
  'in.org.npci.upiapp': 'BHIM',
  sms: 'SMS',
};

/**
 * Every captured message, newest first, with what the app made of it and
 * why. Sorting is re-run on read, so a better sorter relabels old messages.
 */
export const messagesView = (db: Database, limit = 300): MessagesView => {
  const raw =
    db
      .query<{ id: string; payload: string }>(
        `SELECT id, payload FROM raw_records WHERE source = 'notification'
         ORDER BY ingested_at DESC LIMIT ?`,
        [limit]
      )
      .getOrNull() ?? [];

  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<MessageKind, number>;
  const rows: MessageRow[] = [];
  for (const record of raw) {
    let alert: (CapturedAlert & { sender?: string }) | null = null;
    try {
      alert = JSON.parse(record.payload);
    } catch {
      continue;
    }
    if (!alert) continue;
    const sorted = sortMessage(alert);
    counts[sorted.kind]++;
    rows.push({
      id: record.id as Id,
      at: alert.postedAt,
      from: alert.sender ?? alert.title ?? APPS[alert.app] ?? alert.app,
      text: alert.text,
      kind: sorted.kind,
      reason: sorted.reason,
    });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return { rows, counts };
};
