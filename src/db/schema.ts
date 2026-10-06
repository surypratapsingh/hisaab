/** Version 8: accounts can be left out of totals (`excluded`). */
export const SCHEMA_VERSION = 8;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
  subkind      TEXT CHECK (subkind IN ('bank', 'credit_card', 'cash', 'wallet', 'loan', 'investment')),
  last4        TEXT,
  institution  TEXT,
  is_system    INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  -- 1: the account is listed, but its money is left out of every total.
  excluded     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES categories(id),
  icon       TEXT,
  sort       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_category_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS raw_records (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('statement_pdf', 'statement_csv', 'notification', 'manual', 'voice', 'receipt')),
  source_ref  TEXT,
  payload     TEXT NOT NULL,
  parser      TEXT,
  parsed_at   TEXT,
  parse_error TEXT,
  ingested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_ingested ON raw_records(ingested_at);

CREATE TABLE IF NOT EXISTS merchants (
  id            TEXT PRIMARY KEY,
  canonical     TEXT NOT NULL,
  category_id   TEXT REFERENCES categories(id),
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchant_canonical ON merchants(canonical);

CREATE TABLE IF NOT EXISTS merchant_patterns (
  id          TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  pattern     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('vpa', 'substring', 'regex')),
  source      TEXT NOT NULL CHECK (source IN ('seed', 'user', 'llm')),
  hits        INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pattern ON merchant_patterns(pattern, kind);
CREATE INDEX IF NOT EXISTS idx_pattern_merchant ON merchant_patterns(merchant_id);

CREATE TABLE IF NOT EXISTS journal_entries (
  id            TEXT PRIMARY KEY,
  occurred_at   TEXT NOT NULL,
  posted_at     TEXT,
  description   TEXT NOT NULL,
  raw_id        TEXT REFERENCES raw_records(id),
  merchant_id   TEXT REFERENCES merchants(id),
  category_id   TEXT REFERENCES categories(id),
  kind          TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee', 'investment')),
  confidence    REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  reviewed_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_occurred ON journal_entries(occurred_at);
CREATE INDEX IF NOT EXISTS idx_entries_merchant ON journal_entries(merchant_id);
CREATE INDEX IF NOT EXISTS idx_entries_category ON journal_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_entries_confidence ON journal_entries(confidence);

CREATE TABLE IF NOT EXISTS postings (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  amount      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_postings_entry ON postings(entry_id);
CREATE INDEX IF NOT EXISTS idx_postings_account ON postings(account_id);

-- Money is always whole paise. A fractional amount means a float leaked in
-- somewhere upstream, and the database is the last place to catch it.
CREATE TRIGGER IF NOT EXISTS postings_amount_is_integer
BEFORE INSERT ON postings
FOR EACH ROW
WHEN NEW.amount <> CAST(NEW.amount AS INTEGER)
BEGIN
  SELECT RAISE(ABORT, 'Posting amount must be whole paise');
END;

-- SQLite triggers are row-level, so an INSERT trigger cannot see a complete
-- entry: after the first posting the sum is never zero. Balance on insert is
-- therefore enforced inside the writing transaction, which rolls back if the
-- legs do not net out. These triggers guard the other two ways an entry can
-- become unbalanced after the fact.
CREATE TRIGGER IF NOT EXISTS postings_no_unbalancing_update
AFTER UPDATE OF amount ON postings
FOR EACH ROW
WHEN (SELECT SUM(amount) FROM postings WHERE entry_id = NEW.entry_id) <> 0
BEGIN
  SELECT RAISE(ABORT, 'Update would leave the entry unbalanced');
END;

CREATE TRIGGER IF NOT EXISTS postings_no_unbalancing_delete
BEFORE DELETE ON postings
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM journal_entries WHERE id = OLD.entry_id)
BEGIN
  SELECT RAISE(ABORT, 'Delete the entry, not a single posting');
END;

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Version 2: what the money bought. A bank line says where money went; these
-- say what it was spent on, how much of it, and how much got used.

-- Quantities are whole base units (pieces, grams, millilitres) so they never
-- need a fraction. protein_mg is per 100 g or 100 ml, or per piece.
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  unit         TEXT NOT NULL CHECK (unit IN ('piece', 'g', 'ml')),
  category_id  TEXT REFERENCES categories(id),
  protein_mg   INTEGER CHECK (protein_mg IS NULL OR (protein_mg >= 0 AND protein_mg = CAST(protein_mg AS INTEGER))),
  is_staple    INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  brand        TEXT,
  photo        TEXT
);

-- One product per name and brand is created in Database.initialize(), after the
-- brand column is guaranteed to exist on phones that already had this table.

CREATE TABLE IF NOT EXISTS purchases (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  quantity      INTEGER NOT NULL CHECK (quantity > 0 AND quantity = CAST(quantity AS INTEGER)),
  amount        INTEGER NOT NULL CHECK (amount >= 0 AND amount = CAST(amount AS INTEGER)),
  purchased_at  TEXT NOT NULL,
  entry_id      TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  store         TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id, purchased_at);
CREATE INDEX IF NOT EXISTS idx_purchases_entry ON purchases(entry_id);

-- 'used' and 'wasted' are positive. 'adjust' records a stock count that
-- disagreed with what was tracked, and is negative when more was found.
CREATE TABLE IF NOT EXISTS consumption (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id),
  quantity     INTEGER NOT NULL CHECK (quantity = CAST(quantity AS INTEGER)),
  kind         TEXT NOT NULL CHECK (kind IN ('used', 'wasted', 'adjust')),
  consumed_at  TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  CHECK (kind = 'adjust' OR quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_consumption_product ON consumption(product_id, consumed_at);

-- Which statement row each entry came from. Re-importing a statement must add
-- nothing, and a hand-typed salary that a statement row was matched to has
-- the user's description, not the bank's narration — so duplicates are found
-- by this identity rather than by comparing descriptions.
CREATE TABLE IF NOT EXISTS statement_rows (
  ref       TEXT PRIMARY KEY,
  entry_id  TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  raw_id    TEXT REFERENCES raw_records(id)
);

CREATE INDEX IF NOT EXISTS idx_statement_rows_entry ON statement_rows(entry_id);

-- Version 3: the bank's word on a balance. The ledger only knows movements
-- since the first import, so on its own it cannot say how much is actually
-- in an account. A statement's closing balance can: the real balance is the
-- latest one plus whatever the ledger recorded after that date.
CREATE TABLE IF NOT EXISTS balance_anchors (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  as_of       TEXT NOT NULL,
  balance     INTEGER NOT NULL CHECK (balance = CAST(balance AS INTEGER)),
  raw_id      TEXT REFERENCES raw_records(id) ON DELETE SET NULL
);

-- The few things only the user can say: when they are paid, and the balance
-- they never want to drop below.
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Version 4: what the user owns outside their bank accounts, as a CAS
-- statement reported it on one date. Units are thousandths (fund units have
-- three decimals); NAV is in ten-thousandths of a rupee (four decimals); money
-- is paise. No floats, as everywhere else.
CREATE TABLE IF NOT EXISTS holdings (
  id           TEXT PRIMARY KEY,
  raw_id       TEXT REFERENCES raw_records(id) ON DELETE SET NULL,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of        TEXT NOT NULL,
  source       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('mutual_fund', 'equity', 'bond', 'other')),
  name         TEXT NOT NULL,
  isin         TEXT,
  folio        TEXT,
  units_milli  INTEGER CHECK (units_milli IS NULL OR units_milli = CAST(units_milli AS INTEGER)),
  nav_x10000   INTEGER CHECK (nav_x10000 IS NULL OR nav_x10000 = CAST(nav_x10000 AS INTEGER)),
  value        INTEGER NOT NULL CHECK (value = CAST(value AS INTEGER)),
  cost         INTEGER CHECK (cost IS NULL OR cost = CAST(cost AS INTEGER))
);

CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id, as_of);

-- Version 5: things the user sets for themselves rather than the ledger
-- deriving them — a monthly limit per category, a savings target, a reminder
-- for a bill that repeats too rarely for the subscription detector to catch.
CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  amount       INTEGER NOT NULL CHECK (amount > 0 AND amount = CAST(amount AS INTEGER)),
  created_at   TEXT NOT NULL,
  -- Version 7: the month (YYYY-MM) from which unspent money carries into the next
  -- month; NULL when it does not. Added to existing tables by Database.upgradeBudgets.
  rollover_from TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_category ON budgets(category_id);

-- saved_amount is a plain running total the user adds to by hand, not tied to
-- any account, so a goal never double-counts or misattributes real money.
CREATE TABLE IF NOT EXISTS goals (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  target_amount  INTEGER NOT NULL CHECK (target_amount > 0 AND target_amount = CAST(target_amount AS INTEGER)),
  saved_amount   INTEGER NOT NULL DEFAULT 0 CHECK (saved_amount >= 0 AND saved_amount = CAST(saved_amount AS INTEGER)),
  target_date    TEXT,
  archived_at    TEXT,
  created_at     TEXT NOT NULL
);

-- A manual reminder, separate from the auto-detected Subscriptions: LIC
-- premiums and similar charges that recur too slowly (yearly, half-yearly)
-- for three-charges-in-a-row detection to ever catch on its own.
CREATE TABLE IF NOT EXISTS recurring_items (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  amount       INTEGER NOT NULL CHECK (amount > 0 AND amount = CAST(amount AS INTEGER)),
  cadence      TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly')),
  next_due     TEXT NOT NULL,
  note         TEXT,
  archived_at  TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_items(next_due);
`;

export const SYSTEM_ACCOUNTS = [
  { id: 'acc_suspense', name: 'Suspense', kind: 'expense' as const },
  { id: 'acc_opening_balance', name: 'Opening Balance', kind: 'equity' as const },
  { id: 'acc_cash', name: 'Cash', kind: 'asset' as const },
  { id: 'acc_unknown_income', name: 'Unknown Income', kind: 'income' as const },
  { id: 'acc_unknown_expense', name: 'Unknown Expense', kind: 'expense' as const },
];

export const DEFAULT_CATEGORIES = [
  { id: 'cat_food', name: 'Food & Dining', icon: 'restaurant' },
  { id: 'cat_transport', name: 'Transport', icon: 'car' },
  { id: 'cat_utilities', name: 'Utilities', icon: 'bolt' },
  { id: 'cat_entertainment', name: 'Entertainment', icon: 'film' },
  { id: 'cat_shopping', name: 'Shopping', icon: 'bag' },
  { id: 'cat_healthcare', name: 'Healthcare', icon: 'health' },
  { id: 'cat_education', name: 'Education', icon: 'book' },
  { id: 'cat_investment', name: 'Investment', icon: 'chart' },
  { id: 'cat_subscriptions', name: 'Subscriptions', icon: 'repeat' },
  { id: 'cat_transfers', name: 'Transfers', icon: 'swap' },
  { id: 'cat_fees', name: 'Fees & Charges', icon: 'card' },
  { id: 'cat_unknown', name: 'Unknown', icon: 'question' },
  { id: 'cat_groceries', name: 'Groceries', icon: 'basket' },
  { id: 'cat_salary', name: 'Salary', icon: 'wallet' },
  // Categories a Paisa user brought along, 2026-09-26.
  { id: 'cat_bills', name: 'Bills', icon: 'document' },
  { id: 'cat_family', name: 'Family', icon: 'people' },
  { id: 'cat_society', name: 'Society', icon: 'building' },
  { id: 'cat_kheti', name: 'Kheti', icon: 'farm' },
  { id: 'cat_waste', name: 'Waste', icon: 'bin' },
  { id: 'cat_savings', name: 'Savings', icon: 'piggy' },
];

export const INVESTMENT_ACCOUNT_NAME = 'Investments';
