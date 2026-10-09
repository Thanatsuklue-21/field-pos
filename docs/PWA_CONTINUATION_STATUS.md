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
