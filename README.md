# Noshville Foods POS V1

Target site: `pos.noshville.co.za`

## Included
- Secure Supabase email/password login
- Manager / Salesperson roles
- Sale screen with search, categories, cart and payment type
- Products & pricing
- Suppliers
- Purchases with automatic stock increase
- Automatic stock deduction from sale items
- Reorder monitor
- Expenses
- Cash-up / close day
- Daily sales and gross-profit reports
- Responsive layout for desktop/tablet

## Supabase project
Project: Noshville POS
URL: https://gknaqtvkqjwqwkovmajg.supabase.co

The frontend uses the Supabase **publishable key**, which is intended for browser use. Row Level Security remains the main protection.

## One-time first manager setup
1. In Supabase > Noshville POS > SQL Editor, run `setup_first_manager.sql`.
2. Open the POS and create your first account.
3. Sign in.
4. If needed, run this in the browser console:
   `sb.rpc('bootstrap_first_manager')`
   OR temporarily expose/use the bootstrap action after signing in.
5. Refresh the POS. The account will become Manager.
6. The function refuses to create another first manager after one active manager exists.

## GitHub Pages
Upload these files to the root of the `noshville-pos` repository:
- index.html
- styles.css
- app.js

Then:
1. Repository > Settings > Pages
2. Source: Deploy from branch
3. Branch: `main` / root
4. Save

The temporary GitHub Pages URL will be similar to:
`https://ericchibasa-a11y.github.io/noshville-pos/`

## Custom domain later
After the POS is tested:
- GitHub Pages custom domain: `pos.noshville.co.za`
- GoDaddy DNS: create CNAME `pos` -> `ericchibasa-a11y.github.io`

Do not change DNS until the GitHub Pages version is working.

## Important V1 note
Sales are currently written in two steps: sale header, then sale items. The existing database trigger deducts stock when sale items are inserted.
For higher resilience in V2, move sale completion into one database RPC transaction.

## V1.1 fixes
- Cash tendered now shows live customer change before completing a sale.
- Cash-up variance stays blank until actual cash is entered.
- Sale search field width fixed.
- Purchase cost logic changed to weighted-average inventory cost.
- Run `fix_weighted_average_cost.sql` once in the Noshville Supabase SQL Editor.

## V1.2 low-stock visibility
- SALE screen shows a **LOW STOCK** badge when stock is at or below the reorder level.
- SALE screen shows **OUT OF STOCK** at zero stock and blocks adding that product to the cart.
- Reorder Monitor displays **YES** as a clear red warning.
- No changes were made to the tested sales, weighted-average costing, cash-up, expense, or profit logic.

## V1.3 Stock Count / Adjustment
- Manager-only Stock Count screen.
- Compare system quantity with a physical count.
- Positive differences are recorded as `adjustment_in`.
- Negative differences are recorded as `adjustment_out`.
- Recent stock adjustments remain visible as an audit trail.
- Tested V1.2 sales, weighted-average costing, cash-up, expense, profit and low-stock logic are unchanged.

## V1.4 Users & Salespersons
- Adds manager-only USERS / STAFF tab.
- Managers can create staff authentication accounts with name, email, temporary password and role.
- Managers can switch Salesperson/Manager role and activate/deactivate staff.
- Public self-registration button is removed.
- Inactive accounts are blocked from the POS.
- Requires the `manage-staff` Supabase Edge Function and V1.4 security SQL patch supplied with this package.
- V1.3 sales, stock, purchases, weighted-average costing, stock count, expenses, cash-up and reports are preserved.


## Assets and fund movements (11 October 2026)

Managers can record equipment in Assets. Till, bank and owner-funded purchases create one matching payment in the same transaction. Register-only adds an existing asset without a new cash movement. Assets are listed at purchase cost; depreciation, disposals and a formal balance sheet are not implemented.

Cash / Bank Movements captures owner contributions, drawings, till/bank transfers and payments for stock already received. These do not enter operating profit. Stock payments must be recorded separately from receipt of stock; do not duplicate them in Expenses. Bank movement totals are not reconciled bank balances or card settlement totals.

Cash-up uses opening float + cash sales - cash operating expenses + till funds in - till funds out. Database validation recomputes new cash-ups and refuses new till movements for an already closed day. Correct a movement with a reversal dated to an open day, keeping the original. Historic cash-ups and existing expenses are preserved; no automatic reclassification is performed. Asset payment reversal flags its register entry as payment reversed and removes it from the active acquisition totals.

Manager-only finance tables have RLS and append-only records. Active staff receive only aggregate totals needed for cash-up. The totals RPC uses a guarded security-definer function solely to aggregate otherwise manager-only expenses and funding movements.

Deployment requires the finance migration before the updated scripts. Business dates for cash-up are calculated in Africa/Johannesburg.

## Accounting and bank reconciliation (11 October 2026)

The manager's **Accounting & Financial Reports** and **Bank Reconciliation** follow Feasterville's accounting foundation: chart of accounts, balanced journal ledger, trial balance, source reconciliation, month closure/reopening with reasons, draft profit or loss, known financial position, changes in recorded equity, monthly comparison and printable reports. Assets also support depreciation and net book value. Posted depreciation cannot exceed cost; acquisition payment reversal is blocked once depreciation is posted.

Use **Synchronise POS & View Reports** for new or corrected sources. Source signatures make repeat syncs idempotent. Corrections reverse and replace the former journal; original journals remain readable. Source corrections affecting a closed accounting month require reopening it. All finance writes use one private, guarded manager dispatcher; tables are read-only to authenticated clients with manager RLS. Salesperson sales continue to use the existing operational flow.

Retail sale `line_cost` drives cost of sales. Stock receipts debit inventory / credit suppliers, including captured transport cost. Actual stock payments clear suppliers, never cost of sales. Opening stock, cash, outstanding suppliers, historic settled purchases, debts and capital must be reviewed and entered through opening journals; none is invented from today's quantities. Existing expenses remain operating expenses, with classification warnings in the audit review. Card receipts use settlement clearing; post net bank proceeds and bank fees against gross clearing through the balanced journal form. Manual journals do not change till cash-up; use the existing till expense/funding forms for cash movements.

Bank reconciliation currently covers one Noshville business bank account, consistent with its generic bank funding source. Opening date cannot be later than the first recorded bank transaction. Statement imports have a preview, strict money/date validation and file-hash duplicate protection; imports do not post revenue or expenses. Manually match equal amounts/directions to actual ledger bank lines. The screen displays raw and adjusted differences, unmatched items and statement balance continuity warnings; a zero adjusted difference alone is not a completed reconciliation.

Tax/VAT status is not copied from Feasterville. Tax is only included if posted by the accountant. Statutory cash-flow classification remains pending; the draft shows cash/bank movement schedules. Financial statements are provisional until openings, costs and bank records are complete, as in Feasterville. Multi-bank allocation and asset disposal journals require further work.

Validation: `node tests/finance-calculations.cjs`, `node tests/accounting-calculations.cjs`, JS syntax checks, DOM rendering tests, database rollback integration tests (balanced postings, repeated sync, idempotent retries, depreciation limits, duplicate imports/matches, closure and manager-only access).
