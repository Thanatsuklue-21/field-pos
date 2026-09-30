# FIELD POS v8 — Core Refactor Architecture

## Source-of-truth observations from the current repository
- Runtime: Node.js 20+, ESM.
- Backend: Vercel Function + `@libsql/client` / Turso.
- Current online backend stores authentication, a versioned state snapshot, and audit rows.
- Current live POS transactions are still primarily device-local.
- Existing tests use Node's built-in `node:test` and `node:assert/strict`.
- Existing security includes HttpOnly Secure SameSite=Strict session cookies, CSRF token validation, origin validation, and scrypt password hashing.

## Refactor rules
1. Preserve all historical sales/orders/expenses/customers/cost data.
2. Keep current public API behavior backward-compatible while domain logic is extracted.
3. No database destructive migration in Phase 1.
4. Queue remains FIFO.
5. Add-on items retain queue number and pager.
6. Every stock mutation becomes an append-only transaction before server-authoritative stock is enabled.
7. Void/refund reverses stock through new transactions, never by deleting history.
8. Cost at sale is immutable through a cost snapshot.
9. Local-first operation remains available while sync architecture is hardened.

## Phase 1 modules
- `lib/domain/queue.mjs`: queue states, legal transitions, add-on semantics, delay classification.
- `lib/domain/stock-ledger.mjs`: append-only stock transaction primitives and reversal behavior.
- `lib/domain/costing.mjs`: simplified FIELD costing policy and immutable cost snapshot.

These modules are intentionally dependency-free and can be adopted gradually by the current frontend/API without a large rewrite.

## Next integration steps
1. Add schema tables for stock transactions and transaction idempotency in an additive migration.
2. Wire sale/void endpoints to the stock ledger inside one database transaction.
3. Replace frontend stock decrement mutation with ledger-backed operations.
4. Move queue UI transitions to the queue domain state machine.
5. Add API idempotency keys for checkout/add-on operations.
6. Add end-to-end device regression tests before making server state authoritative.
