# FIELD — offline outbox read safety

Baseline: exact origin/main `6e05d6a98edb017b77972e9962a427829e6d5671`.
New feature branch: `fix/field-offline-outbox-read-safety`.

## Audit

Main already includes device-local Close Day preflight, rechecking after final
confirmation (PR #268), compact payment UX (#267), and durable Stock/VOID/refund
recovery. These controls were retained rather than implemented again.

The remaining issue was that POS summary/sync called `offlineCashList`, which
returned an empty list for unavailable IndexedDB or failed reads. That could
look like zero unsynced bills. Close Day used a separate strict reader, so the
screens did not agree about unreadable storage.

## Change

- POS summary/sync now use the strict reader through the existing list function.
- An empty list requires a successful, completed read transaction.
- Failed open/read/abort, missing results, unexpected result shape and corrupted
  request identity/date/status reject instead of returning zero.
- A blocked open that later succeeds closes its late connection.
- Synchronous storage errors are normalized to offline_storage_unavailable.
- POS shows a persistent Thai warning and a read-only retry action. Unknown
  counts are not shown as a verified pending-bill badge.
- Offline checkout rereads existing bills before capturing another offline sale.
  Unreadable storage prevents reaching the outbox put/success path; the cart stays.
- No recovery record is removed and no server or database schema is changed.

## Checkout obstruction found during browser QA

The floating AI button intercepted the mobile Checkout button at 320px. Its
floating entry is now hidden on POS at all widths. The assistant remains
available from Today Workspace's header; that action closes the workspace
before opening the existing assistant. Other routes keep their entry point.
No payment or AI backend behavior was changed.

## Validation

Completed on this change set:
- Lockfile install (`npm ci --cache /tmp/field-npm-clean-cache --no-audit --no-fund`) passed.
- `npm test`: 517 passed, zero failures/skips/cancellations (16 new regressions).
- `npm run build`: compilation, TypeScript and route generation passed.
- `git diff --check`: passed before commit.
- Chromium production-build QA: all seven viewports passed (320/360/390/412/430px,
  768×1024 and 1024×768). Offline storage denial produced no financial request or
  success receipt; Cart stayed; read-only retry recovered; Checkout was clicked
  normally; Workspace closed before opening the assistant.
- Browser APIs were mocked. Hardware Android/PWA and live provider acceptance
  were not performed. Inspect the latest exact-head PR CI before merging.

`test/offline-outbox-read.test.mjs` covers empty/sorted valid reads, denied/error/
blocked opens, abort/read failures, missing/corrupt results and summary/sync
with no mutations when storage is unreadable.

Production-build browser regression is reproducible with
`python scripts/qa-offline-outbox.py --base-url http://localhost:3100`
after build/start. It uses intercepted test APIs and real browser IndexedDB:
storage denial blocks offline confirmation, read-only recovery preserves Cart,
Checkout uses an ordinary click, and assistant access moves through Workspace.
It does not verify live providers, production transactions or Android hardware.

## Next steps

1. Continue from newly fetched main after merge; do not reuse this branch as baseline.
2. Review pending PR #255 on current main before implementing failed-write or
   API header/cancellation fixes again. This change addresses read failures;
   it does not claim all IndexedDB writes are acknowledged correctly.
3. Test actual Android/tablet storage denial/recovery and retained offline bills.
   Do not clear browser storage when unsynced bills remain.
4. Keep the existing Close Day preflight/server reconciliation and exact payment
   ACK controls. Server cannot see offline bills that never synced from other devices.
