# FIELD POS — product and engineering review

## Scope and evidence

Review of the current PWA candidate, existing transaction/recovery evidence, shared app shell, POS flow and permission-filtered navigation. Started from clean `efbd1d500413b1bf57430936bc75f32daa559898`, matching Draft PR #112. This is a repository and behavior review, not a claim to have reviewed all world knowledge or to have proven the app is the best product.

Current checks: **526 executable regressions PASS / 0 FAIL**, Next production build/TypeScript PASS. Six new navigation cases cover all permitted admin destinations, priority, staff/offline restrictions and immutable permission input. Prior full integration evidence covers stock, payments, replay, VOID/refund, queue, cash close and local recovery.

Browser inspection reached the actual local login screen. Sign-in failed with `origin_not_configured`: direct production-server QA used HTTP, whereas this app requires an HTTPS public origin. No authenticated POS screenshot, mobile browser layout, screen-reader behavior or physical Android acceptance is claimed. Keep the HTTPS requirement; use the isolated HTTPS Preview for those checks.

## Architecture and code language

Keep the established TypeScript/React/Next client and server-authoritative libSQL/Turso transactions. Existing tests demonstrate durable request replay and atomic stock/payment mutations. A framework/language rewrite has no measured benefit in the evidence available and would reopen transaction/recovery regression surfaces.

Keep responsibilities clear: UI state in React/Zustand; durable local recovery/outbox in IndexedDB; final sale, stock and payment authority in server transactions. Offline cash is a restricted exception with explicit acknowledgement and reconciliation, not permission to move general financial writes to client caches.

The large POS component and mixed JS/TS server are maintenance risks, not measured runtime defects. Next staged work should extract a tested checkout state machine and shared typed receipt/error contracts one boundary at a time; preserve replay hashes, server behavior and recovery keys. Avoid broad cleanup while release gates remain outstanding.

## Critical flow review

| Journey | Current evidence / decision | Next acceptance |
|---|---|---|
| Open app / revalidate session | Restricted cached shell; online writes require revalidation | Installed Android cold start, slow connection, process kill |
| Select menu / cart / pay | Stock availability and transaction regressions pass | Real staff usability, keyboard and phone widths |
| Cash checkout / uncertain response | Durable request key, receipt acknowledgement, server replay | Isolated HTTPS end-to-end UAT |
| Offline cash / reconnect | Atomic local bill+stock; preserve unresolved outbox; explicit retry | Multi-tab/device/operator handoff, reconnect after restart |
| Queue / edit / VOID / refund | Existing FIFO and atomic reversal integration evidence | Actual pager workflow and production handoff |
| Stock / recipes / cost | Server authority and exact deduction tests | Owner verifies actual recipes, units, opening quantities |
| Close day / cash / report | Cash-close integration evidence includes zero variance | Staff opening/closing checklist and real store settings |
| Administration on phone | Fixed missing mobile destinations in this revision | HTTPS browser viewport/accessibility checks |

## Fixes in this revision

The mobile overflow previously included only Expenses, Close and Settings, omitting permitted Products, Recipes, Costs, Customers, Reports, Backup, Users, Audit and Dashboard destinations. It now includes every permission-filtered non-primary destination, with operational shortcuts first. Primary navigation remains four actions; the longer overflow is height-bounded and scrollable. Staff and restricted Offline users gain no new permissions.

Navigation now provides accessible names for icon-only tablet links, current-page semantics and labelled navigation regions. Escape closes the expanded mobile panel and returns focus to its trigger. Shared controls get a visible keyboard focus indicator. POS search/dismiss controls have explicit names; notice/outbox status text has polite, atomic announcement semantics. Network messages use plain Thai, and the notification width is bounded on narrow screens.

These are code-level accessibility improvements, not a WCAG conformance certification. Real screen-reader and keyboard testing remains necessary.

## Highest-value remaining work

1. Release prerequisites: separate Preview/UAT database, frozen exact-SHA READY Preview, Android acceptance and post-release verification.
2. Show durable operator-visible reconciliation for accepted Offline sales that return `stockReconciliationRequired`; today the server reports it but the sync UI does not explicitly present that flag. Design its acknowledgement/recovery lifecycle before changing the outbox schema.
3. Exercise operator handoff and simultaneous tabs. Server replay hashes include actor identity; an uncertain committed bill retried by another operator needs a safe lookup/review flow, not a newly generated request key.
4. Measure installed-device startup, checkout latency and layout stability before optimization; current build/test speed is not a real-device performance benchmark.
5. Complete modal keyboard/focus and screen-reader acceptance, then simplify checkout prompts based on actual staff trials. Avoid a visual redesign that hides business/recovery states.

## Primary references used

- [W3C: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): existing status changes need programmatic semantics; excessive announcements can interrupt work.
- [W3C: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): assess target size and spacing; retain the project's 44px operational target policy.
- [web.dev: Offline data](https://web.dev/learn/pwa/offline-data): durable local data and transaction boundaries matter for Offline apps and concurrent instances.
- [web.dev: Caching](https://web.dev/learn/pwa/caching): caching supports fast/offline experience, but assets and sensitive transactional data require different handling.

No Production mutation, provider charge, LINE message, credential change, merge or deployment was performed. PWA versions: `field-pwa-v14` / `8.0.0-pwa.13`.
