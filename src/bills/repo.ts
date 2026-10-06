import { Database } from '@/db/client';
import type { Id } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';
import { isoDate, shiftDate } from '@/lib/date';
import { Paise, paise, subtract, sum } from '@/money/money';
import { recordTransaction } from '@/repo/manual';
import { createProduct, findProductByName, recordPurchase } from '@/inventory/repo';
import type { Bill, BillItem } from './bill';

export type BillMatch = { entryId: Id; description: string; date: string; amount: Paise; account: string };

/**
 * Payments the bill could belong to: money out of one of the user's
 * accounts, for the bill's total, within three days of its date.
 */
export const billMatches = (db: Database, bill: Bill, today = new Date()): BillMatch[] => {
  if (bill.total === undefined) return [];
  const around = bill.date ?? isoDate(today);
  const rows =
    db
      .query<{ id: string; description: string; occurred_at: string; name: string }>(
        `SELECT e.id, e.description, e.occurred_at, a.name
         FROM journal_entries e
         JOIN postings p ON p.entry_id = e.id AND p.amount = ?
         JOIN accounts a ON a.id = p.account_id AND a.is_system = 0 AND a.kind = 'asset'
         WHERE substr(e.occurred_at, 1, 10) BETWEEN ? AND ?
         ORDER BY ABS(julianday(substr(e.occurred_at, 1, 10)) - julianday(?))
         LIMIT 5`,
        [subtract(paise(0), bill.total), shiftDate(around, -3), shiftDate(around, 3), around]
      )
      .getOrNull() ?? [];
  return rows.map((r) => ({
    entryId: r.id as Id,
    description: r.description,
    date: r.occurred_at.slice(0, 10),
    amount: bill.total!,
    account: r.name,
  }));
};

export type SaveBillInput = {
  bill: Bill;
  /** What was read, kept as the raw record. */
  text: string;
  sourceRef: string;
  /** The payment this bill explains, if one is already in the ledger. */
  entryId?: Id;
  /** Or record the bill as a new expense from this account (cash, say). */
  recordFrom?: Id;
  /** The lines the user kept, to track as items. */
  items: BillItem[];
};

export type BillError = { code: 'INVALID' | 'DATABASE' | 'TOO_MUCH' | 'SAVED'; message: string };

/**
 * A bill into the ledger. The text is kept first, as with every source. The
 * bill either explains a payment already recorded or becomes a new expense;
 * the ticked lines become item purchases linked to that payment, so the
 * Items screen can say what the money bought.
 */
export const saveBill = (
  db: Database,
  input: SaveBillInput
): Result<{ entryId?: Id; purchases: number }, BillError> => {
  // The same file read again gives the same text. A bill with no date or number on it
  // read again from a new photo is refused too; real bills carry one.
  const before = db
    .query<{ id: string }>(
      `SELECT id FROM raw_records WHERE source = 'receipt' AND payload = ? AND parsed_at IS NOT NULL LIMIT 1`,
      [input.text]
    )
    .getOrNull();
  if (before?.length) {
    return err({ code: 'SAVED', message: 'This bill is saved already. Saving it again would count its items twice.' });
  }

  const raw = db.saveRawRecord({
    source: 'receipt',
    sourceRef: input.sourceRef,
    payload: input.text,
    parser: 'bill_v1',
  });
  if (raw.isErr()) return err({ code: 'DATABASE', message: raw.error.message });

  const date = input.bill.date ?? isoDate(new Date());
  const itemsTotal = sum(input.items.map((i) => i.amount));
  if (input.bill.total !== undefined && itemsTotal > input.bill.total) {
    return err({ code: 'TOO_MUCH', message: 'The items add up to more than the bill' });
  }

  return db.transaction(() => {
    let entryId = input.entryId;
    if (!entryId && input.recordFrom) {
      const total = input.bill.total ?? itemsTotal;
      if (total <= 0) return err({ code: 'INVALID', message: 'The bill has no total to record' });
      const recorded = recordTransaction(db, {
        kind: 'expense',
        amount: total,
        accountId: input.recordFrom,
        description: input.bill.merchant ?? 'Bill',
        occurredAt: date,
        categoryId: 'cat_groceries' as Id,
      });
      if (recorded.isErr()) return err({ code: 'INVALID', message: recorded.error.message });
      entryId = recorded.value.id;
    }

    let purchases = 0;
    for (const item of input.items) {
      const product =
        findProductByName(db, item.name) ??
        createProduct(db, { name: item.name, unit: 'piece' }).getOrNull();
      if (!product) return err({ code: 'DATABASE', message: `Could not add ${item.name}` });

      const bought = recordPurchase(db, {
        productId: product.id,
        quantity: item.quantity ?? 1,
        amount: item.amount,
        purchasedAt: date,
        entryId,
        store: input.bill.merchant,
      });
      if (bought.isErr()) return err({ code: 'INVALID', message: `${item.name}: ${bought.error.message}` });
      purchases++;
    }

    db.run(`UPDATE raw_records SET parsed_at = ? WHERE id = ?`, [new Date().toISOString(), raw.value.id]);
    return ok({ entryId, purchases });
  }, 'SAVE_BILL_FAILED') as Result<{ entryId?: Id; purchases: number }, BillError>;
};
