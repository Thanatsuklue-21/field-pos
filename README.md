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

## Approved menu release 2026-09-28.30

The active approved set is Pure Matcha Iced, Matcha Latte, FIELD Matcha Signature (100% / 50% / 0%), FIELD Coconut Matcha, and FIELD Orange. Honey Matcha is cut, Strawberry Matcha is on hold, and the previous Coconut recipe is archived. Actual COGS includes ingredients, packaging, and provisional ice 210g; `estimated_variable_cost` is stored separately and excluded from Actual COGS. Historical sales and orders are never recalculated by the menu migration.

## Verification

Run `npm test` and check the page, `/api/health`, `/api/setup/status`, login, first import, second-device read, sale, refresh, and conflict handling before promotion. An unauthenticated `/api/state` must return 401. Preserve the earlier production deployment for rollback.
