# FIELD project handoff

## Goal

Continue development of FIELD POS from the latest main, harden shared behavior,
and provide a tested change set that the FIELD project can review and continue.
This delivery is a bounded reliability pass, not completion of every future FIELD feature.

## Current status

- Repository: https://github.com/Thanatsuklue-21/field-pos
- Base: main `fe0688e7c43913ded21db5dab62ee8fc1fd14184`.
- Branch: `refactor/v8-core`; pull request: https://github.com/Thanatsuklue-21/field-pos/pull/255
- Changes are prepared for review. No merge or production deployment performed.
- Production share URL and authenticated live acceptance were not available.

## Completed

- Preserve Fetch Headers objects and tuple-array headers, including CSRF values.
- Isolate caller-cancelable reads; ordinary simultaneous reads still coalesce.
- Keep the eight-second default GET timeout active through JSON body reading.
- Preserve caller cancellation without reporting offline or returning stale cache.
- Handle failed IndexedDB cache fallback without hiding the original network error.
- Reject failed or aborted IndexedDB writes instead of treating them as success.
  POS already awaits outbox persistence before completing an offline cash sale.
  A failed write now keeps checkout from reaching that success path and shows a
  Thai error explaining that the sale was not confirmed.
- Close database connections after successful and failed writes. Outbox patch/delete
  fail explicitly if storage cannot be opened. Keep database version and stores unchanged.
- Clarify historical v8 architecture notes and record module-specific follow-up work.

## Validation

- `npm test`: 424 tests passed; zero failures, cancellations or skips.
- `npm run build`: passed compilation, TypeScript and route generation.
- `git diff --check`: passed before commit.
- Five API-client behavioral tests cover header forms, cancellation isolation,
  cached-bootstrap cancellation, stalled bodies and failed cache storage.
- Five IndexedDB behavioral tests cover successful outbox lifecycle, aborted
  put/patch/delete preserving prior records, and synchronous quota failure.
- IndexedDB tests use the development-only `fake-indexeddb` dependency. They do
  not replace acceptance on Android/tablet browsers and real storage limits.
- GitHub CI runs on each PR update; inspect the latest head's result before merge.

## Next steps

1. Review PR #255 and confirm its latest CI result. To continue locally:

   ```sh
   git clone https://github.com/Thanatsuklue-21/field-pos.git
   cd field-pos
   git fetch origin
   git switch --track origin/refactor/v8-core
   npm ci
   npm test
   npm run build
   ```

2. Obtain the actual Vercel preview/share URL and a test owner/staff account through
   the project's existing credential workflow. Use an isolated test database for
   writes and restore experiments; do not bootstrap another admin on an existing database.
3. Verify offline cash on Android/tablet: warm the menu while online, disconnect,
   complete a cash sale, reload and confirm the queued bill survives, reconnect,
   sync and verify one server sale with the same request key. Simulate storage
   failure and verify the cart remains and no success receipt is displayed.
4. Verify ambiguous online checkout and payment recovery retain their request keys.
   Verify queue FIFO, grouped preparation, add-ons, refunds and close-day guards.
5. Continue the remaining module acceptance using the table below. Record exact
   browser/device, commit, expected result and observed result for each test.
6. Measure mobile load/interaction performance on the actual URL before proposing
   further optimizations. Then review deployment through the repository's existing
   release gate and validate the deployed commit. Do not equate PR CI with release.

| Modules | Next acceptance evidence |
| --- | --- |
| POS, orders, queue | Cash/PromptPay, split, hold bill, FIFO, add-ons, refund and recovery |
| Products, recipes, stock, costs | Approved live masters, units, purchase/reversal and ledger reconciliation |
| Expenses, close, settlements | Cash movements, business dates, closed-day restrictions and settlement totals |
| Dashboard, reports, control | Totals align with underlying sales/refunds/expenses and approval state |
| Customers | Loyalty earn/redeem/refund reconciles with transaction history |
| Users, audit, settings | Owner/staff permissions, expired sessions and audit evidence |
| Backup | Export and restore into an isolated database; compare all included ledgers |
| Payments, LINE, hardware | Provider sandbox/live verification, signed callbacks and device acceptance |

## Risks/blockers

- No actual Production share URL was supplied in the chat; authenticated end-to-end
  validation and measured mobile performance remain outstanding.
- No live database/provider credentials or hardware were used in this delivery.
- IndexedDB reads/open-blocked handling and session-cache races are follow-up review
  areas; this change fixes write acknowledgement, not every browser storage edge case.
- Build emits an existing Next.js `preferredRegion` deprecation warning.
- Preserve sales history, additive migrations, FIFO and server idempotency semantics.
  Do not clear browser storage while unsynced offline bills remain.

## Files/context

- `lib/api-client.ts`, `test/api-client.test.mjs`: shared network changes and tests.
- `lib/offline-db.ts`, `test/offline-db.test.mjs`: durable write acknowledgement and tests.
- `app/pos/page.tsx`: user-facing offline write failure message.
- `package.json`, `package-lock.json`: development test dependency.
- `README.md`, `docs/INTEGRATION_AUDIT.md`: current operating behavior.
- `docs/ARCHITECTURE_V8.md`: historical phase-one plan, now explicitly marked.
- `docs/DEVELOPMENT_REVIEW.md`: development priorities across all current sections.
