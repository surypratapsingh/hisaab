import { Database, type Account } from '@/db/client';
import { generateId, type Id } from '@/lib/ulid';
import { Result, ok, err } from '@/lib/result';
import { Paise, paise, sum, subtract } from '@/money/money';
import { investmentAccount } from '@/repo/manual';
import { readLayout, layoutText } from '@/import/pdf/layout';
import { parseCas, detectCas, type CasHolding, type ParsedCas } from './cas';

export const DEMAT_ACCOUNT_NAME = 'Stocks & bonds';

export type CasImportError = {
  code: 'NOT_A_CAS' | 'UNREADABLE' | 'ALREADY_IMPORTED' | 'DATABASE';
  message: string;
};

export type CasImportResult = {
  kind: ParsedCas['kind'];
  source: string;
  asOf: string;
  holdings: number;
  total: Paise;
};

/** Plain text from whatever was picked: a PDF layout, or text as it is. */
const textOf = (payload: string): string => {
  const layout = readLayout(payload);
  return layout ? layoutText(layout) : payload;
};

/** Whether a picked or shared document is a CAS rather than a bank statement. */
export const isCas = (payload: string): boolean => detectCas(textOf(payload)) !== null;

/**
 * Mutual funds belong in the Investments account that SIP debits already
 * flow into, so a later SIP adds on top of the CAS value until the next CAS.
 * Demat holdings get an account of their own.
 */
const accountFor = (db: Database, kind: ParsedCas['kind']): Result<Account, CasImportError> => {
  if (kind === 'mutual_fund') {
    const account = investmentAccount(db);
    return account.isOk() ? ok(account.value) : err({ code: 'DATABASE', message: account.error.message });
  }
  const existing = (db.getAllAccounts().getOrNull() ?? []).find(
    (a) => !a.isSystem && a.subkind === 'investment' && a.name === DEMAT_ACCOUNT_NAME
  );
  if (existing) return ok(existing);
  const created = db.createAccount({
    name: DEMAT_ACCOUNT_NAME,
    kind: 'asset',
    subkind: 'investment',
    isSystem: false,
  });
  return created.isOk() ? ok(created.value) : err({ code: 'DATABASE', message: created.error.message });
};

/**
 * A CAS into holdings. The document is kept as a raw record first, the
 * holdings are written together, and the account's balance is set to the
 * CAS total as of its date, which is what makes total wealth real.
 */
export const importCas = (
  db: Database,
  payload: string,
  sourceRef: string
): Result<CasImportResult, CasImportError> => {
  const raw = db.saveRawRecord({
    source: 'statement_pdf',
    sourceRef,
    payload,
    parser: 'cas_v1',
  });
  if (raw.isErr()) return err({ code: 'DATABASE', message: raw.error.message });

  const fail = (error: CasImportError): Result<never, CasImportError> => {
    db.run(`UPDATE raw_records SET parse_error = ? WHERE id = ?`, [error.message, raw.value.id]);
    return err(error);
  };

  const text = textOf(payload);
  if (!detectCas(text)) {
    return fail({ code: 'NOT_A_CAS', message: 'This does not look like a CAS statement' });
  }
  const cas = parseCas(text);
  if (!cas) {
    return fail({
      code: 'UNREADABLE',
      message: 'This CAS could not be read. It may be a summary-only CAS; ask for the detailed one.',
    });
  }

  const account = accountFor(db, cas.kind);
  if (account.isErr()) return fail(account.error);

  const [seen] =
    db
      .query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM holdings WHERE account_id = ? AND as_of = ? AND source = ?`,
        [account.value.id, cas.asOf, cas.source]
      )
      .getOrNull() ?? [];
  if ((seen?.total ?? 0) > 0) {
    return fail({
      code: 'ALREADY_IMPORTED',
      message: `The ${cas.source} for ${cas.asOf} is already in`,
    });
  }

  const total = sum(cas.holdings.map((h) => h.value));
  const written = db.transaction(() => {
    for (const holding of cas.holdings) {
      const inserted = db.run(
        `INSERT INTO holdings (id, raw_id, account_id, as_of, source, kind, name, isin, folio,
                               units_milli, nav_x10000, value, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId(),
          raw.value.id,
          account.value.id,
          cas.asOf,
          cas.source,
          holding.kind,
          holding.name,
          holding.isin ?? null,
          holding.folio ?? null,
          holding.unitsMilli ?? null,
          holding.navX10000 ?? null,
          holding.value,
          holding.cost ?? null,
        ]
      );
      if (inserted.isErr()) return err(inserted.error);
    }
    // An older CAS keeps its holdings as history but never replaces a newer balance.
    const anchored = db.recordBalanceAnchor(account.value.id, cas.asOf, total, raw.value.id);
    if (anchored.isErr()) return err(anchored.error);
    return ok(undefined);
  }, 'CAS_IMPORT_FAILED');
  if (written.isErr()) return fail({ code: 'DATABASE', message: written.error.message });

  db.run(`UPDATE raw_records SET parsed_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    raw.value.id,
  ]);
  return ok({ kind: cas.kind, source: cas.source, asOf: cas.asOf, holdings: cas.holdings.length, total });
};

export type HoldingRow = CasHolding & { id: Id; gain?: Paise };

export type WealthPart = {
  accountId: Id;
  name: string;
  kind: 'bank' | 'cash' | 'investment' | 'other';
  value: Paise;
  /** The date the value is as of: a statement, a CAS, or blank for "from your records". */
  asOf?: string;
  source?: string;
  holdings: HoldingRow[];
  /**
   * A bank account whose balance was never told (no statement, alert
   * balance or typed figure): its value is only the movements seen, so it is
   * left out of the total until the user says what it holds.
   */
  unknown?: boolean;
  /** The user left this account out of totals: shown, never added in. */
  excluded?: boolean;
};

export type WealthView = {
  total: Paise;
  parts: WealthPart[];
};

type HoldingDbRow = {
  id: string;
  as_of: string;
  source: string;
  kind: CasHolding['kind'];
  name: string;
  isin: string | null;
  folio: string | null;
  units_milli: number | null;
  nav_x10000: number | null;
  value: number;
  cost: number | null;
};

/** The holdings from an account's latest CAS, largest first. */
const latestHoldings = (db: Database, accountId: Id): { asOf?: string; source?: string; rows: HoldingRow[] } => {
  const rows =
    db
      .query<HoldingDbRow>(
        `SELECT * FROM holdings
         WHERE account_id = ? AND as_of = (SELECT MAX(as_of) FROM holdings WHERE account_id = ?)
         ORDER BY value DESC`,
        [accountId, accountId]
      )
      .getOrNull() ?? [];
  return {
    asOf: rows[0]?.as_of,
    source: rows[0]?.source,
    rows: rows.map((r) => ({
      id: r.id as Id,
      kind: r.kind,
      name: r.name,
      isin: r.isin ?? undefined,
      folio: r.folio ?? undefined,
      unitsMilli: r.units_milli ?? undefined,
      navX10000: r.nav_x10000 ?? undefined,
      value: paise(r.value),
      cost: r.cost === null ? undefined : paise(r.cost),
      gain: r.cost === null ? undefined : subtract(paise(r.value), paise(r.cost)),
    })),
  };
};

/** A bank account whose balance was never told: its figure is only the movements seen so far. */
export const balanceUnknown = (db: Database, account: Account): boolean =>
  account.subkind === 'bank' && Boolean(account.last4) && db.getBalanceAnchor(account.id).getOrNull() == null;

/**
 * Everything the user owns, account by account, each with the date its value
 * comes from. Bank balances are as of the latest statement plus what came
 * after; investments are as of the latest CAS plus SIPs since.
 */
export const wealthView = (db: Database): WealthView => {
  const accounts = (db.getAllAccounts().getOrNull() ?? []).filter(
    (a) => !a.isSystem && a.kind === 'asset'
  );

  const parts: WealthPart[] = accounts.map((account) => {
    const value = db.reportedBalance(account.id).getOrNull() ?? paise(0);
    const anchor = db.getBalanceAnchor(account.id).getOrNull();
    const kind: WealthPart['kind'] =
      account.subkind === 'investment'
        ? 'investment'
        : account.subkind === 'cash'
          ? 'cash'
          : account.subkind === 'bank'
            ? 'bank'
            : 'other';
    const held = kind === 'investment' ? latestHoldings(db, account.id) : { rows: [] };
    return {
      accountId: account.id,
      name: account.name,
      kind,
      value,
      asOf: anchor?.asOf,
      source: 'source' in held ? held.source : undefined,
      holdings: held.rows,
      unknown: balanceUnknown(db, account) ? true : undefined,
      excluded: account.excluded ? true : undefined,
    };
  });

  const order: Record<WealthPart['kind'], number> = { investment: 0, bank: 1, cash: 2, other: 3 };
  parts.sort((a, b) => order[a.kind] - order[b.kind] || (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

  return { total: sum(parts.filter((p) => !p.unknown && !p.excluded).map((p) => p.value)), parts };
};
