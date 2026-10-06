import { ParsedRow, ImportResult } from './types';
import { Result, ok, err } from '@/lib/result';
import { generateId } from '@/lib/ulid';
import { toUTC, now } from '@/lib/date';
import { Paise, paise, subtract } from '@/money/money';
import { createPostings, PostingWithId } from '@/ledger/posting';
import { SYSTEM_ACCOUNT_IDS } from '@/ledger/accounts';
import type { JournalEntry, Account } from '@/db/client';

export type PipelineError = {
  code: 'DUPLICATE' | 'NO_ACCOUNT' | 'PARSE_ERROR' | 'BALANCE_ERROR';
  message: string;
  rowIndex?: number;
};

export interface PipelineEntry {
  entry: JournalEntry;
  postings: PostingWithId[];
  isDuplicate?: boolean;
  duplicateOf?: string;
}

export const importStatementRows = async (
  rows: ParsedRow[],
  sourceAccount: Account
): Promise<Result<PipelineEntry[], PipelineError>> => {
  const entries: PipelineEntry[] = [];
  const seen = new Set<string>();
  const errors: PipelineError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowHash = generateRowHash(row);
    const timestamp = toUTC(now());

    if (seen.has(rowHash)) {
      entries.push({
        entry: {
          id: generateId(),
          occurredAt: row.date,
          description: row.narration,
          kind: 'expense',
          confidence: 0,
          createdAt: timestamp,
        },
        postings: [],
        isDuplicate: true,
        duplicateOf: rowHash,
      });
      continue;
    }

    seen.add(rowHash);

    const isDebit = row.debit !== undefined;
    const amount: Paise = row.debit ?? row.credit ?? paise(0);

    // Money leaving the account is a negative delta on it; money arriving is
    // positive. The counterparty always takes the mirror image so the entry
    // nets to zero.
    const sourceDelta = isDebit ? subtract(paise(0), amount) : amount;
    const counterDelta = subtract(paise(0), sourceDelta);

    const postingResult = createPostings([
      { accountId: sourceAccount.id, amount: sourceDelta },
      { accountId: SYSTEM_ACCOUNT_IDS.SUSPENSE, amount: counterDelta },
    ]);

    if (postingResult.isErr()) {
      errors.push({
        code: 'BALANCE_ERROR',
        message: postingResult.error.message,
        rowIndex: i,
      });
      continue;
    }

    entries.push({
      entry: {
        id: generateId(),
        occurredAt: row.date,
        postedAt: timestamp,
        description: row.narration || `Transaction on ${row.date}`,
        kind: isDebit ? 'expense' : 'income',
        confidence: 0.1,
        createdAt: timestamp,
      },
      postings: postingResult.value,
    });
  }

  if (entries.length === 0 && errors.length > 0) {
    return err(errors[0]);
  }

  return ok(entries);
};

const generateRowHash = (row: ParsedRow): string => {
  const str = [row.date, row.narration, row.debit ?? 0, row.credit ?? 0].join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

export const computeImportSummary = (entries: PipelineEntry[]): ImportResult => {
  const duplicates = entries.filter((e) => e.isDuplicate).length;

  return {
    rowsParsed: entries.length,
    rowsWithError: 0,
    duplicatesSkipped: duplicates,
    rowsNeedingReview: entries.length - duplicates,
    errors: [],
  };
};
