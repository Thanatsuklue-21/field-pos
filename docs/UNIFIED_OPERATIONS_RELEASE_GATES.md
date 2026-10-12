# FIELD Unified Operations — Release Gates v1 (2026-10-12)

## Source of truth
The active Next.js application and server-backed libSQL state are authoritative. Legacy `public/index.html` and `online*.js` are migration fixtures, not parallel POS applications. Never import historical localStorage totals as current sales without audited reconciliation. Keep the existing one-shop / 1–3 operator scope.

## Non-negotiable cross-module invariants
1. **Money:** a charge is never treated as paid from QR display, browser redirect, timeout, or client assertion. Only verified provider status can finalize a digital payment. Unknown network outcomes remain pending until reconciled.
2. **Idempotency:** every mutating checkout, payment finalize, refund, stock reversal, queue handoff, and restore operation has a durable request identity. Same key + same payload returns the original result; same key + different payload is rejected.
3. **Atomicity:** a committed sale, its line items, payment allocation, inventory movements, cost snapshot, loyalty movement and production queue must agree. No partial commits.
4. **Inventory:** server is authoritative; precheck is UX only. Variant-specific ingredient requirements and quantities are checked again inside the write transaction. Negative inventory exceptions must be explicit and auditable.
5. **Queue:** finish oldest order before advancing; grouping bases applies only to identical base work within the same queue. Display preparation quantities per menu, never as a misleading pooled grams total.
6. **Accounting:** refunds reverse the exact original transaction and its inventory/loyalty consequences once; never delete the source ledger entry. Close-day rejects unresolved payment and unfinished queue; post-close mutations require an explicit audited correction workflow.
7. **Offline:** cached catalog and queued cash writes are provisional. Preserve original request keys through sync and network ambiguity. No offline PromptPay, split settlement or loyalty mutation. A previously fulfilled offline order must not re-enter the live queue after sync.
8. **Backup:** exports include the durable request ledger, payments, sales, recipes, costs, stock movements and audit trail; restore is owner-only, revision-checked, tested against a disposable database, and never silently overwrites live data.
9. **Access:** deny by default; enforce authorization on the server, validate origin/CSRF, avoid secrets in logs, and log sensitive actions with actor, timestamp and correlation ID.
10. **Performance:** local cart taps must not await remote requests. Measure p95 interaction-to-next-paint and server checkout latency on a real Android device; avoid claiming a performance SLA without measured samples.

## Recipe version gate
Cold 16-oz recipes target **180 g liquid excluding powder** and full-cup ice. Existing approved formulas must not be silently overwritten. Record a new candidate revision and tasting outcome before activating it; prices, historical COGS and sales must retain their original recipe version. Use integer grams, preferably multiples of five or ten. The latest matcha candidates must be checked for liquid totals and sweetness variants before activation.

## Minimal release evidence
- `npm ci --no-audit --no-fund`, `npm test`, `npm run build` all pass on the exact commit.
- Simulate simultaneous last-serving checkouts; only one succeeds and the other returns a stock conflict without a sale.
- Replay successful checkout, refund and handoff requests with the same key; no duplicate effects.
- Simulate provider webhook replay, out-of-order status, expired QR and network timeout; no unpaid production ticket.
- Simulate offline cash sale, app restart, sync replay and server-side stock change; no duplicate sale or hidden deficit.
- Verify FIFO across two queues sharing matcha bases, including per-menu preparation quantities.
- Verify close-day rejection with pending payments, then cash drawer reconciliation after resolution.
- Restore a full backup to a disposable database; compare counts, monetary totals and ledger integrity.
- Smoke-test installed Android PWA: reload, offline banner, screen layout, print/receipt, queue bell and cash change.
- Verify production deployment commit SHA matches tested SHA and /api/health is healthy; never infer payment-provider readiness from CI alone.

## Architecture decision
Prefer a modular monolith (Next.js + libSQL/Turso + one authoritative transaction boundary) over microservices, Kafka, or an additional Google Sheets database. Integrations (Beam, LINE, printer) are adapters around the same domain model. Add observability and normalized reporting incrementally, not a second ledger.

## Metrics for owner
Track paid sales, refunds, net sales, theoretical COGS by recipe revision, purchase cash outflow, stock variance, waste, gross margin, average ticket, queue time, reconciliation variance and unresolved payment count. Distinguish gross margin from cash profit; do not label purchases as ingredient COGS until consumed.

## International references
- OWASP ASVS 5.0: authorization, secure coding, logging and safe concurrency.
- MDN PWA offline/background operation: offline queueing requires explicit replay/reconciliation semantics.
- PostgreSQL transaction isolation principles: concurrent writes must be serialized or retried safely (apply equivalent libSQL guarantees rather than assuming PostgreSQL features).
