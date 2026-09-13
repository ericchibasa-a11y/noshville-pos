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
