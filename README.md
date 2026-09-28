# FIELD CAFÉ POS — online branch

The production domain currently serves the device-local POS. This branch adds a server login and a guarded whole-state synchronization prototype backed by Turso. Do not promote it until first Admin setup, data migration, and cross-device browser checks pass.

## Configuration

- Production Vercel environment: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PUBLIC_ORIGIN=https://field-pos.vercel.app`, and a random secret `FIELD_SETUP_TOKEN` of at least 32 characters.
- The Turso schema must be initialized with `npm run bootstrap -- schema` or the previously initialized database. Keep these server secrets out of Git and HTML.
- Preview must use a separate Turso database and its exact preview origin. Otherwise its `/api/health` responds `origin_not_configured` and the page blocks operation.

## First use

1. Open the production URL on the device that has the authoritative historical POS data. Export a local JSON backup first.
2. Create the first server Admin with the Vercel setup token. The server rejects a second setup after an active Admin exists. Log in with the new credentials.
3. Compare local bill/queue/expense counts. Import that device's data only after saving its backup. An empty new device waits for migration or requires explicit confirmation to start fresh.
4. Open another device and log in with the server Admin. It reads the Turso state and polls for changes when idle.

Every edit writes a complete snapshot with an expected revision. The UI blocks further input while awaiting acknowledgement and stops on failed connectivity or revision conflicts. On conflict, export the local backup, compare bills, and only then adopt the server copy. Do not use two devices for simultaneous checkout until server-authoritative atomic sales and idempotency are implemented. The local IndexedDB/LocalStorage copies are recovery copies, not the shared source of truth.

## Verification

Run `npm test` and check the page, `/api/health`, `/api/setup/status`, login, first import, second-device read, sale, refresh, and conflict handling before promotion. An unauthenticated `/api/state` must return 401. Preserve the earlier production deployment for rollback.
