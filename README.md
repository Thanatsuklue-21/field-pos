# FIELD CAFÉ POS — production

Single-shop POS backed by Turso, with device-local IndexedDB/LocalStorage recovery copies and Vercel deployment from `main`.

## Configuration

- Production Vercel environment: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PUBLIC_ORIGIN=https://field-pos.vercel.app`, and a random, one-time `FIELD_SETUP_TOKEN` of at least 12 characters. Prefer a password manager generated value; after the first Admin is created, setup is disabled.
- The Turso schema must be initialized with `npm run bootstrap -- schema` or the previously initialized database. Keep these server secrets out of Git and HTML.
- Preview must use a separate Turso database and its exact preview origin. Otherwise its `/api/health` responds `origin_not_configured` and the page blocks operation.

## First use

1. Open the production URL on the device that has the authoritative historical POS data. Export a local JSON backup first.
2. Create the first server Admin with the Vercel setup token. The server rejects a second setup after an active Admin exists. Log in with the new credentials.
3. Compare local bill/queue/expense counts. Import that device's data only after saving its backup. An empty new device waits for migration or requires explicit confirmation to start fresh.
4. Open another device and log in with the server Admin. It reads the Turso state and polls for changes when idle.

Every edit is saved locally immediately, then a versioned snapshot is sent to Turso in the background. Ordinary network delays no longer block the POS; a status badge reports pending sync and retries automatically. Authentication failures and revision conflicts still stop remote writes so two devices cannot silently overwrite each other. The local IndexedDB/LocalStorage copies are recovery copies, not the shared source of truth.

## Approved menu and cost-center release 2026-09-28.31

The active approved set is Pure Matcha Iced, Matcha Latte, FIELD Matcha Signature (100% / 50% / 0%), FIELD Coconut Matcha, and FIELD Orange. Honey Matcha is cut, Strawberry Matcha is on hold, and the previous Coconut recipe is archived. Actual COGS includes ingredients, packaging, and provisional ice 210g; `estimated_variable_cost` is stored separately and excluded from Actual COGS. Historical sales and orders are never recalculated by the menu migration.

Stock quantity and cost management are separate. The Cost Center accepts only owner-entered purchase amounts, package quantities, supplier/receipt references, purchase dates, and owner confirmation. It keeps an append-only price history while the latest confirmed record supplies the unit cost used for new calculations. The app does not fetch product prices from the web.

The menu workspace is split into Recipe, Cost, Sale Price, and Profit tabs. Accounting definitions are:

- Actual COGS = recipe ingredients + packaging + ice.
- Full cost per cup = Actual COGS + other variable cost + monthly fixed cost allocation + hidden cost.
- Gross profit = sale price - Actual COGS.
- Contribution profit = sale price - Actual COGS - other variable cost.
- Estimated net profit = sale price - full cost per cup.
- Suggested price is the higher of the target-COGS price and target-net-margin price, rounded up to the next 5 baht. Prices are never changed automatically.

## Verification

Run `npm test` and check the page, `/api/health`, `/api/setup/status`, login, first import, second-device read, sale, refresh, and conflict handling before promotion. An unauthenticated `/api/state` must return 401. Preserve the earlier production deployment for rollback.
