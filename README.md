# FIELD CAFÉ POS — Vercel + Turso deployment package

This package serves the current standalone POS HTML at `/` and runs the Admin account and import API on Vercel Functions, backed by Turso (libSQL). The POS screen itself still stores sales, queue, stock and customers on its device. Publishing this package **does not turn checkout into a shared online POS**. Account management in the HTML is also device-local; the API Admin is provisioned separately. Do not rely on the API database as an automatic backup of live sales.

## Before deployment

1. Create/link a verified Vercel project and a Turso database through the Vercel Marketplace. Associate the resource with that project. The integration exposes `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as server environment variables. Never add these secrets to the HTML or Git.
2. Configure `PUBLIC_ORIGIN` to the exact HTTPS origin of the deployment, such as `https://field-pos.example.com`, in Vercel project settings. Preview domains need a matching setting too, or writes are rejected.
3. From the `vercel-turso` directory, install dependencies (`npm install`), run `npm test`, and use Vercel's project link/deploy workflow. The root directory of the Vercel project must be **this** directory.
4. Run `npm run bootstrap -- admin` from a secure terminal with the Turso environment variables to initialize schema and create the first API Admin. It prompts for a password. On a noninteractive runner, provide `FIELD_ADMIN_PASSWORD` as an ephemeral secret for that one command and remove it immediately.
5. Check `GET /api/health` and the protected API after deployment. Keep a backup of the device's JSON export and test database restore.

## Controlled historical data migration

Export JSON from the offline POS Admin settings. Obtain an API session with `POST /api/auth/login` and use its `csrf` response in `X-CSRF-Token` for subsequent writes (same HTTPS origin). Submit the JSON as `state` to `POST /api/import/preview`. Compare `counts` with the device. Check `GET /api/state` for its `revision`, then call `POST /api/import/commit` with `{ "state": <export>, "expectedRevision": 0 }`. Replacing an already imported state requires the current revision and `"replace": true`. Every import preserves the prior version in `field_state_versions`. Server accounts are never imported from the browser. The JSON includes customer and sales information; handle it as private data.

## What remains for a production online POS

The backend needs server-authoritative sales, payments, queue, stock, expenses, close day and loyalty operations with atomic transactions and idempotency keys. Then the HTML needs to use server login and those APIs, reconcile the existing offline data once, and handle offline conflict/retry. Until that work and a browser/device test pass, use the current HTML on one device and its JSON backups. Publicly hosting the current HTML alone provides no shared transactions.

The former `server/` package in this workspace targeted PostgreSQL. This is a separate Turso package; never run the PostgreSQL migration against Turso.
