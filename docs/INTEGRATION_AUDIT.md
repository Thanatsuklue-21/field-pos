# FIELD POS v8 — Repository Integration Audit

## Current repository stack
- Node.js >=20, ESM
- Vercel Functions
- Turso/libSQL via `@libsql/client`
- Frontend is primarily a large standalone `public/index.html` plus `public/online.js` and `public/fast-ui.js`
- Tests use the built-in Node test runner

## Existing backend strengths to preserve
- HttpOnly + Secure + SameSite=Strict session cookie
- CSRF token required for write methods
- Exact origin validation for writes
- scrypt password hashing
- account lockout behavior
- audit log table
- snapshot revision conflict protection
- historical `field_state_versions`

## Architectural gap confirmed by README/code
The online backend is not yet server-authoritative for sales, payments, queue, stock, expenses, close day, or loyalty. The frontend still owns those live mutations locally and synchronizes snapshots.

## Phase 1 safe integration boundary
The new domain modules are dependency-free and do not change schema or live behavior yet. This makes them safe to add before wiring them into API/UI paths.

## Source-of-truth inconsistencies found
1. `public/index.html` in `main` is currently FIELD POS v7.4, while a newer v7.5 checkout build exists only outside the repo staging workflow.
2. Existing `test/menu-release.test.mjs` still asserts FIELD Orange `35g + 135g water`, which conflicts with the later approved FIELD formula `25g + 145g water` discussed in the project. Do not silently change this during Core Refactor; resolve it as an explicit menu-master migration/update.
3. Existing README explicitly warns that current server state is snapshot-based, not a shared transaction-safe POS. v8 must preserve this warning until transaction APIs are complete.

## Security notes for future transaction APIs
- Require authenticated session and CSRF for all writes.
- Add per-request idempotency keys for sale, payment, add-on, void, and stock receive.
- Enforce authorization by action, not only by page/view permission.
- Never trust client-computed totals or cost snapshots; recompute/validate server-side once the server becomes authoritative.
- Store payment provider secrets only in Vercel environment variables.
- Do not expose raw Turso errors to clients.

## Recommended next code integration order
1. Add domain modules + unit tests.
2. Add additive schema migration for stock transactions and operation idempotency.
3. Add transaction-safe API endpoints for stock receive / sale / void.
4. Wire queue state transition endpoints.
5. Adapt frontend incrementally behind a feature flag.
6. Run regression matrix on Android/tablet before enabling server-authoritative mode.
