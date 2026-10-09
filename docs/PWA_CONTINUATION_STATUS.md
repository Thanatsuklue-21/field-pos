# PWA continuation audit — 2026-10-09

## Reconstructed state

- PR #112 is open, Draft, branch `feat/pwa-app-shell`.
- Verified starting head: `18a2f475f5498bdccd9c9134c7159dd2bc114f56` (`test: replay all 30 pre-open cash bills without duplication`). Local branch was fetched from GitHub before editing.
- GitHub Actions `verify` for that exact head passed (run `37730318481`).
- Vercel status reported success, but deployment `dpl_FRLFsic5xD5i7vzoKQNifCxz9cZj` is actually `CANCELED`, with description `Canceled by Ignored Build Step`. It is not an exact-head READY Preview.
- Existing local checkouts were `main` at `4399850` and `integrate/payment-line` at `fc1ae4f`. Neither contained the current PWA head. Untracked handoff notes, webhook replay script and logs in the latter were preserved.
- PWA work resumed in a clean `field-pos-pwa` worktree on the existing PR branch. No existing uncommitted PWA diff was found there.

## Remaining code gap addressed

Service-worker navigation had an unbounded network wait. A connection that remains online but never answers prevented the cached restricted POS shell from opening.

- With a cached safe shell, navigation now falls back after 3 seconds.
- Without a cached shell, navigation continues waiting for the network; a network failure fails closed.
- A late response refreshes only safe cached routes, with its lifetime retained by `waitUntil`.
- API requests, writes and cross-origin requests continue bypassing the service worker.
- Cache version is `field-pwa-v8`; readiness version is `8.0.0-pwa.7`. Existing explicit safe-update and authoritative session/outbox guards remain in place.
- Executable Service Worker tests cover hanging network, fast network, no-cache startup, offline routes, late refresh and API/write bypass. The old code failed the bounded-startup regression before the fix.

## Validation

- Full regression suite: **416 passed, 0 failed**, including 30-order idempotency/stock/cash soak, FIFO, payment, recovery and release-gate checks.
- Windows initially lacked the `bash` executable name. Bundled `sh.exe` identifies itself as GNU Bash 5.2.37; an external workspace runtime alias was used without changing the deployment gate or repository tests.
- Parallel native libSQL test execution intermittently crashed on Windows with exit `3221225477`; the complete suite passed with `--test-concurrency=1`. Linux CI remains the parallel-execution gate.
- Next.js production build and TypeScript: **PASS** (locked Next.js 16.3.8, Node 24.19.0).
- Local production smoke: `/pos`, `/settings`, manifest, service worker and `/api/build` returned 200. `/api/health` returned controlled 503 `turso_not_configured` with `no-store`, as expected without DB credentials.
- Local `/api/build` has a null SHA outside Vercel; this smoke does not satisfy exact-deployment identity acceptance.
- `git diff --check`: **PASS**.
- No lint script or lint configuration is provided by this branch; a separate lint run is unavailable. Build TypeScript checks passed.

## Release blockers retained

Keep PR #112 Draft. Do not open the Preview marker or change the ignored-build policy until the release candidate and UAT prerequisites are ready.

1. Isolated Preview/UAT Turso credentials and backend READY evidence are still required. No Production credentials were copied, and no live DB transaction was performed.
2. Freeze the final head and obtain an intentional exact-SHA READY Preview, then run the read-only smoke with expected SHA and inspect runtime errors.
3. Physical Android install/standalone, viewport matrix, keyboard checkout, process-kill/offline recovery, reconnect/outbox and safe update acceptance remain unverified.
4. Perform transaction UAT on the isolated database, then exact merged-SHA Production deployment and post-deploy checks.

Previously completed manifest/install metadata, mobile layout, recovery, atomic cash VOID/edit and transaction integrity features were not reimplemented. Node engine pinning and legacy Vercel `builds` cleanup remain separate deployment-config backlog items requiring their own Preview validation.

## Second continuation — durable Offline cash commits

Started from verified clean head `199c868bb9d046a2db1fe5821ee22a33dcfac740`; its exact GitHub Actions run `37882879341` passed. PR #112 remained Draft and Vercel was canceled by the ignored-build step.

The IndexedDB transaction completion helper previously resolved on both error and abort. This allowed `queueOfflineCashSale` to return a receipt before a failed outbox transaction was safely persisted; the POS success path could then clear the cart. Outbox reads also returned an empty queue on unavailable storage, and failed deletion/patch operations could be mistaken for success.

- Only `IDBTransaction.oncomplete` now acknowledges successful work. Error, abort and synchronous storage failures reject with `offline_storage_failed`.
- Outbox list/delete/patch reject unavailable storage instead of reporting an empty/successful queue.
- Connections close on success and failure. Readiness waits for a completed read transaction and never reports READY on abort.
- Cache reads remain best-effort; unsuccessful cache writes reject so callers can handle them explicitly.
- POS displays a Thai storage-failure message and retains the existing cart because the success path runs only after the committed outbox result.
- Synchronous database-open failures are reported as unavailable storage.
- Cache/readiness versions advanced to `field-pwa-v9` / `8.0.0-pwa.8` so the revised offline client is warmed through the existing safe-update flow.

Validation: **436 tests passed, 0 failed**, including 20 new executable storage/checkout tests, full payment/stock/30-order regression coverage, Next.js production build, strict TypeScript and `git diff --check`. The baseline failed 10 of the first 11 storage cases before the fix. Tests run the actual transpiled TypeScript modules against controlled IndexedDB transaction events; browser storage quota and process-kill acceptance still require real-device testing.

No lint script/config was added. No database schema, Production credentials, Vercel gate or previously completed payment/stock business behavior was changed. The release blockers listed above remain in force.

## Third continuation — safe update races and recovery uncertainty

Verified clean starting head `1214906f9864011037f740f7c809e33587af0fc3`, with exact-head GitHub CI passing. Three executable runtime regressions reproduced unsafe activation: inaccessible recovery storage, a new cart during registration lookup, and a cart updated before React effects copied its count.

- The update guard reads the current cart directly from the store.
- Both local and legacy session recovery records block updates, including empty or malformed records. Storage access errors block activation with an operator-facing reason instead of permitting an update.
- Safety is checked again after asynchronous registration lookup, immediately before sending `SKIP_WAITING`.
- Failed registration lookup does not activate; failed activation messaging resets the initiated flag so later controller changes cannot trigger a mistaken reload.
- The same guard remains in use for deferred reload and controller-change safety.
- Cache/readiness versions: `field-pwa-v10` / `8.0.0-pwa.9`.

Validation: **458 tests passed, 0 failed**, including 22 new policy/runtime cases, full storage/payment/stock regression coverage, production build, TypeScript and `git diff --check`. The three runtime cases failed before the integration fix and passed afterward. No deployment policy or transaction business logic was changed. Exact Preview, isolated transaction UAT and real Android acceptance remain required.

## Fourth continuation — atomic Offline bill and stock persistence

Verified clean starting head `aa9e6554b488c22ee2c379160e6279ff3fff993a`. Previously, receipt acknowledgement and cart clearing followed the outbox commit, while projected stock was persisted separately without awaiting success. Process termination or a cache-write failure between these operations could leave a durable bill with the old cached stock.

- POS now commits a new outbox bill and its local stock projection in a single IndexedDB transaction spanning the existing outbox/cache stores.
- Projection reads the latest committed cached bootstrap inside that transaction and checks current cart availability before deduction. Missing/expired catalogs, unavailable variants and insufficient stock abort the entire operation.
- Stock-write failures roll back the outbox insertion. A duplicate request key is rejected instead of replacing its bill and deducting stock again.
- Receipt UI receives the committed bootstrap and no longer performs a separate fire-and-forget cache write.
- Original cache `savedAt` is retained: Offline selling does not extend the Cloud data freshness deadline.
- No IndexedDB schema/version migration or Cloud transaction behavior changed. Cache/readiness versions are `field-pwa-v11` / `8.0.0-pwa.10`.

Validation: **465 tests passed, 0 failed**, production build, TypeScript and `git diff --check` passed. Seven executable tests cover cold module relaunch with both records present, rollback on cache-write failure, consecutive stock deductions and overselling rejection, expired/missing catalog, missing variant and duplicate request rejection. These controlled IndexedDB transaction tests do not replace physical Android process-kill or isolated database UAT. Existing release blockers remain.

## Comprehensive readiness continuation

See [RELEASE_READINESS_2026-10-09.md](./RELEASE_READINESS_2026-10-09.md) for the full module/evidence matrix and operator preparation steps.

Started from verified clean `b4873720c23606a8129fc6c9e8654a3e96aeb55d`. Fixed retryable sync errors being quarantined or reported as success, sync-status indicators being overwritten by ordinary network success, Cloud cache reads resetting unresolved local stock, and unstructured Next backend initialization failures. Added mobile-visible pending/review counts and an explicit guarded retry action.

Final regression: **489 passed, 0 failed**; production build/TypeScript, 20 local shell/asset probes, 3 controlled missing-backend probes and configured login/protected reads passed. Live-local isolated Next/libSQL transaction UAT covered cash/replay/VOID/stock/fulfilled Offline sync/close day with zero variance. No Production transaction was performed.

Read-only Production smoke verified the public alias POS/Settings and JSON DB-health contract. Latest READY Production deployment remains main at `cced39ceb23bd7f12c116b0d323e3df56345175f`, not this candidate. Final candidate still needs exact Preview/UAT and physical Android acceptance before release. Cache/app versions `field-pwa-v12` / `8.0.0-pwa.11`.
