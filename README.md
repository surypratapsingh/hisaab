# Hisaab

Personal finance app for India with a double-entry ledger foundation. Called Money OS in the code, its identifiers and these docs (the working title); see decisions.md, 2026-10-06.

## Architecture

### Phase 1.1 — Ledger and Money Primitives ✅

The foundation. Everything else builds on top of this.

#### Core Modules

##### `src/money/`

Single source of truth for all money arithmetic. Nothing else writes `+` on an amount.

```typescript
type Paise = number & { readonly __brand: 'Paise' };
```

The branded type means TypeScript rejects a raw number passed as an amount. This catches the entire class of bug that destroys finance apps.

**Key functions:**
- `paise(n)` — constructor, rejects non-integers
- `fromRupeeString("1,234.56")` → `123456`
- `fromRupees(1234.56)` → `123456` (rounded)
- `format(paise(123456))` → `"Rs 1,234.56"`
- `add`, `subtract`, `multiply`, `divide`, `abs`, `sum`
- `isZero`, `isPositive`, `isNegative`

##### `src/ledger/`

Double-entry accounting with mandatory Suspense account.

**Files:**
- `posting.ts` — Build and validate postings
  - `createPostings()` — Enforces balanced entries (sum = 0)
  - `validateBalance()` — Verifies two or more postings per entry
  
- `accounts.ts` — Account kinds and directions
  - `ACCOUNT_KINDS` — asset, liability, income, expense, equity
  - `isDebitAccount()`, `isCreditAccount()` — Direction rules
  - `SYSTEM_ACCOUNT_IDS` — Suspense, Opening Balance, Cash, Unknown Income, Unknown Expense
  
- `balance.ts` — Calculate account balances
  - `calculateBalance()` — Sum of postings for one account
  - `calculateBalances()` — Map of all accounts to their balances
  - `netBalance()` — Total across all accounts

##### `src/lib/`

Utilities used everywhere.

- `money.ts` — The money type
- `result.ts` — `Result<T, E>` type. Every function that can fail returns Result. Exceptions are for programmer error only.
- `date.ts` — Store UTC ISO-8601, display in Asia/Kolkata
- `ulid.ts` — Sortable IDs with no coordination needed

##### `src/db/`

Schema and database client.

**Schema:**
- `accounts` — User's asset, liability, income and expense accounts
- `journal_entries` — Transactions with merchant, category, confidence score
- `postings` — Double-entry: two or more per entry, balance to zero
- `raw_records` — Original untouched input (statement text, notification payload)
- `merchants` — Normalized merchant names
- `merchant_patterns` — VPA handles, substring matches, regex patterns
- `categories` — Spending categories (user-editable)

**Invariants:**
1. Every `journal_entry` has two or more `postings`
2. Postings for an entry sum to exactly zero
3. Every `raw_record` is written before parsing (never discarded)
4. Parser bugs are fixed by re-running on stored raw text

## Testing

```bash
npm test
```

957 tests across 63 files (2026-10-03). See [BUILD_STATUS.md](BUILD_STATUS.md) for the
per-area breakdown and the measured performance budgets. `npm run typecheck` must
also be clean.

**Golden tests:**
- Expense transaction (bank debit, category credit)
- Transfer between accounts (from-account debit, to-account credit)
- Split payment (one debit, two credits)
- Committed bank fixtures, parsed and reconciled end to end into the ledger

## Complete Phases

### ✅ Phase 1.2 — Statement Import

**Parsers:** HDFC, SBI, ICICI (CSV); PDF statements through a layout parser (Union Bank checked against a real statement, 2026-10-03); Paisa backups; CAMS/KFintech CAS
- Auto-detect bank and format by header fingerprint
- Parse rows into date, narration, debit, credit, balance
- **Balance walk validation** — verifies each row's running balance
- **Duplicate detection** — matches on date + amount + narration hash
- **Raw records storage** — full statement text preserved before parsing
- Parser versioning (hdfc_savings_v1, v2, etc.) allows bug fixes via replay

**Files:** `src/import/`
- `types.ts` — ParsedRow interface, import types
- `parsers/` — Bank-specific parsers with detection
- `pipeline.ts` — Convert parsed rows to journal entries
- Test fixtures in `test/fixtures/hdfc_sample.csv`

**Performance:** 5,000 rows in <8 seconds

### ✅ Phase 1.3 — Transaction Intelligence

Seven-stage pure-function pipeline, each stage is deterministic and testable:

1. **Normalise** — Strip bank boilerplate (UPI/, NEFT/, POS), collapse whitespace, uppercase
2. **Resolve Merchant** — Three passes: VPA match → substring match → fuzzy (trigrams)
3. **Detect Transfer** — Account number patterns + transfer keywords
4. **Categorise** — Rule-based (merchant keywords) → heuristic (first word)
5. **Detect Recurring** — 3+ transactions, same merchant, amount within 5%, interval patterns
6. **Score** — Weighted product: merchant confidence × category confidence × transfer
7. **Review Queue** — Confidence < 0.7 surfaces for user correction

**Seed data:**
- VPA handles (amazon@upi → Amazon, etc.)
- Substring patterns (NETFLIX → Netflix)
- 12 default categories with icons

**Files:** `src/intel/`
- `normalise.ts` — Text cleaning, VPA extraction
- `merchant.ts` — Three-stage resolution with trigram fuzzy matching
- `transfer.ts` — Account matching and transfer keywords
- `categorise.ts` — Rule-based categorization
- `recurring.ts` — Pattern detection (daily/weekly/monthly/yearly)
- `score.ts` — Confidence calculation

**Guarantee:** User corrections on one merchant retroactively update all past entries for that merchant. Dictionary improves with every correction.

### ✅ Phase 1.4 — App Shell

*Updated 2026-10-03; the first version had five screens and no tab bar.*

Tab bar: **Home | Activity | + | Reports | More**, plus stacked screens.

1. **Home** — total wealth (Bank & cash / Investments), Scan and pay, Safe to spend, this month vs last, what changed, needs attention, recent, spending score, day-by-day calendar, where it went
2. **Activity** — every entry by day, whole-ledger search with totals, CSV export
3. **Reports** — month by month, quick insights, category flow, Financial reports (Month Summary, Cash Flow Analysis, Goal Progress) saved as a web page
4. **More** — Accounts (import statements, leave an account out of totals), Wealth, Settings, Budgets, Goals, Recurring, Subscriptions, Insights, Items, Messages
5. **Transaction Detail**, **Review Queue**, **Add transaction / purchase**, **Bill**, **Imported** (what one statement brought in)

**Onboarding** — Four steps:
1. Privacy pitch ("data stays on phone")
2. Add first account (name + last4)
3. Import statement (optional)
4. Done

**Files:** `src/ui/`
- `App.tsx` — Navigation, mock data, wiring
- `screens/` — Five screen components + onboarding
- All components use NativeWind (Tailwind classes)
- Type-safe props for each screen

**Guarantee:** Cold user to Home with real data in <3 minutes if statement imported

### ✅ Phase 1.5 — Hardening

1. **App Lock** — Biometric + PIN fallback (expo-local-authentication)
2. **Encrypted Backup** — Export as JSON/CSV/encrypted-db, passphrase-derived key
3. **Data Deletion** — One control, confirm twice with "DELETE ALL" phrase, irreversible
4. **Migration Harness** — Database schema versioning, rollback support
5. **Crash Safety** — Imports run in transaction, mid-crash leaves no half-state
6. **Backup Validation** — Checksums, format validation before import

**Files:** `src/security/`
- `applock.ts` — Biometric setup and verification
- `backup.ts` — Export, import, encryption, deletion
- `src/db/migrations.ts` — Schema versioning

**Play Store Listing:**
- "No signup required"
- "Data stays on your device"
- "No ads, no data sale"
- "Works offline"
- Data safety: declare no financial data collected (must remain true)

## Phase 2 and after

*Updated 2026-10-03.* 2.2 Subscriptions and bills, 2.3 Safe-to-Spend and 2.4 Insights
are done; 2.1 the notification listener is built and still being checked on real alerts.
3.1 CAS import and 3.2 net worth are done. [plan.md](plan.md) has the checklist and
[progress.md](progress.md) what happened last.

## Decision Log

These are locked. Do not reopen them.

| Decision | Choice | Why |
|----------|--------|-----|
| Platform | Android only, Phase 3 for iOS | iOS cannot read SMS or notifications |
| Framework | React Native + Expo bare workflow, TypeScript | One language everywhere |
| Local database | SQLite via op-sqlite, encrypted with SQLCipher | Fast, synchronous, encryption built in |
| Money type | INTEGER paise, always | No floats = no precision bugs |
| Ledger model | Double-entry + mandatory Suspense | Single-entry cannot detect what it is missing |
| IDs | ULID | Sortable, no coordination, offline-first |
| Dates | Store UTC ISO-8601, display Asia/Kolkata | Timezone-safe |
| State | Zustand + React Query over repository layer | Predictable, composable |
| Styling | NativeWind | Tailwind for React Native |
| Testing | Vitest for logic, Maestro for flows | Fast, good DX |
| CI | GitHub Actions: typecheck, lint, test, build APK | Fast feedback |
| Error tracking | Sentry with scrubber (no amounts, merchants, account numbers) | Safe compliance |
| Analytics | PostHog, events only | Never send financial data |

*Status 2026-10-03:* CI, Maestro, Sentry and PostHog are not set up. Release builds hold no
INTERNET permission at all (`plugins/withHardening.js`), so nothing is sent anywhere.

## Run

On Windows, PowerShell blocks `npm.ps1` under the default execution policy. Use
Command Prompt, or call `npm.cmd` from PowerShell.

**Install:**
```bash
npm install
```

**Test:**
```bash
npm test
```

**Type check:**
```bash
npm run typecheck
```

There is no `start` script yet: the React Native app is scaffolded with Expo as
step one of the next phase. See [BUILD_STATUS.md](BUILD_STATUS.md).

## Guarantees

1. No float anywhere. Paise integers or compilation fails.
2. Every journal entry must balance. Enforced in code, DB trigger, and dev-time verification.
3. Raw input is never discarded. Parser bugs are fixed by replay.
4. No financial data leaves the device (Phase 4 changes this with consent).
5. Transfers are never counted as spending.

## Architecture Patterns

### Result Type

Every function that can fail returns `Result<T, E>`:

```typescript
const createPostings = (...): Result<PostingWithId[], PostingValidationError> => {
  if (inputs.length < 2) {
    return err({ code: 'INSUFFICIENT_POSTINGS', message: '...' });
  }
  return ok([...]);
};

const postings = createPostings([...]);
if (postings.isErr()) {
  console.error(postings.error.message);
}
```

No try/catch for expected failures. Exceptions are for programmer errors.

### Branded Types

TypeScript prevents category ID being passed where account ID is expected:

```typescript
type Paise = number & { readonly __brand: 'Paise' };
type Id = string & { readonly __brand: 'Id' };

add(paise(100), 50); // TypeScript error ✅
```

### Double-Entry Invariants

The ledger enforces balance at three layers:

1. **Function level** — `createPostings()` returns error if sum ≠ 0
2. **Database level** — Trigger rejects INSERT if postings don't balance
3. **Runtime verification** — `verifyLedger()` walks all entries on app start (dev only)

```
User spends Rs 500 on groceries

Bank account:    -Rs 500 (debit)
Groceries:       +Rs 500 (credit)
────────────────────────────
Sum:              Rs 0 ✅
```

If the pipeline cannot determine where money went, it posts to Suspense:

```
Statement shows money leaving bank, merchant is unknown

Bank account:     -Rs 500 (debit)
Suspense:         +Rs 500 (credit)
```

Suspense is never hidden from the user. It's the quality score: lower is better.

## Performance Targets

| Operation | Budget | Device |
|-----------|--------|--------|
| Create entry with 2 postings | < 5 ms | Mid-range Android |
| Calculate balance (10k entries) | < 100 ms | Mid-range Android |
| Verify ledger (10k entries) | < 200 ms | Mid-range Android |
| Sum 5,000 amounts | < 10 ms | Mid-range Android |

## File Structure

```
money-os/
├── src/
│   ├── money/
│   │   ├── money.ts           ← the ONLY place paise math happens
│   │   ├── money.test.ts
│   │   └── index.ts
│   ├── ledger/
│   │   ├── posting.ts
│   │   ├── posting.test.ts
│   │   ├── accounts.ts
│   │   ├── balance.ts
│   │   ├── balance.test.ts
│   │   └── index.ts
│   ├── lib/
│   │   ├── result.ts
│   │   ├── date.ts
│   │   ├── ulid.ts
│   │   └── index.ts
│   ├── db/              ← schema, client, SQLCipher move (atRest.ts)
│   ├── import/          ← CSV parsers, PDF layout parser, pipeline
│   ├── intel/           ← normalise, merchant, transfer, category
│   ├── repo/            ← read models and services over the database
│   ├── analysis/        ← Safe to spend, subscriptions, insights, spending score
│   ├── reports/         ← Financial reports: one document model, HTML out
│   ├── capture/         ← bank alerts and SMS into the ledger
│   ├── wealth/          ← CAS holdings, wealth view
│   ├── inventory/       ← items bought, used, left
│   ├── bills/ upi/ security/
│   └── ui/              ← screens, store, motion
├── modules/             ← native: pdf-text, alert-capture, intake, feel
├── plugins/             ← Expo config plugins (shortcuts, share target, hardening, signing)
├── test/
│   └── fixtures/        ← sample HDFC, ICICI, SBI statements (made up)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Notes

- Everything is TypeScript. No `.js` files.
- `strict: true` in tsconfig. No `any`, no `@ts-ignore` without a comment.
- All tests pass. No skipped tests in version control.
- Git commits are small and atomic. Each commit compiles and passes tests.

---
# Token Efficiency

- Read only files relevant to the current task.
- Search before reading large files.
- Never scan node_modules, dist, build, .git, or generated files.
- Do not reread unchanged files.
- Do not dump entire files in responses.
- Make the smallest safe code change.
- Run targeted tests before full test suites.
- Keep responses concise.
- Use /clear when starting an unrelated task.
- Prefer /compact around 400K-500K context when the same task continues.


**Built:** 18 Sept 2026  
**Author:** Surya  
**License:** MIT (see LICENSE)  
**Phase:** 1.1 (Foundation)
