# FIELD stability and operator UX review — 20 October 2026

## Baseline and scope

Fresh branch from exact `origin/main 2dbbd92490bbc60f8c68cf721250810aef40c95f`; latest release PR #472 inspected. Main FIELD POS CI 39389343882 passed; scheduled production smoke 39443104368 also passed. No direct main edits, schema changes, dependency upgrades or financial endpoint changes.

Architecture remains Next.js/React/Zustand with Vercel route adapters and Turso/libSQL transactions. Durable actor/payload/operation-bound request identities, exact acknowledgements, FIFO and transaction ledgers are retained. Existing work-mode/catalog/stock guidance and memoized POS filtering are present; they are not rebuilt. Old code is not replaced merely because of age.

## Baseline evidence

- `npm ci`, full `npm test`: 846/846, `npm run build` passed.
- Read-only production health returned the exact baseline SHA, production/main, Turso, deployment `dpl_2qnig3KjeiRjcmcnJyj4BiHTE1Bj`. `/pos`, `/queue`, `/stock`, `/close`: 200. Unauthenticated `/api/pos/bootstrap`: 401.
- Browser reproducer on the production build paused one intercepted checkout response. Tab/Shift+Tab reached the background mobile navigation and checkout action even while Payment was busy. Shared ModalFocus only excluded a direct disabled attribute, so inherited disabled fieldset controls were mistaken for focusable boundaries.
- The same pending state simultaneously showed the assertive waiting message, green ready-to-confirm card and exact-cash confirmation hint. These instructions conflict after the operator already confirmed.
- Screenshots and logs: `/workspace/field-stability-qa/baseline-focus`, `/tmp/field-focus-red.log`. Browser business APIs are intercepted; no live financial writes.

## Repair and candidate verification

Shared focus boundaries now exclude controls disabled by ancestor fieldsets and controls with no visible layout box/visibility. An all-disabled dialog keeps focus on its own panel. Initial focus and restoration behavior are preserved. Payment hides the ready-to-confirm card and exact-cash hint only while busy; the assertive pending warning and existing financial lock remain.

`scripts/qa-modal-focus.py` is a production-build regression added to CI. It failed on baseline for an injected hidden end control (a shared-component boundary case), background Tab/Shift+Tab escape during an intercepted delayed checkout, and contradictory confirmation hints. It also requires Escape to remain blocked while writing, exactly one checkout request, and a success dialog only after the exact mocked ACK. All API calls are intercepted.

Candidate `npm test` 846/846, production build and diff check passed. All 14 browser suites passed in the final results: modal focus, stock attention, catalog readiness, work modes, workspace CTA/contrast, touch checkout, offline outbox, cashier, PromptPay nonblocking, Close Day recovery, queue waste, expense recovery, workspace expense recovery and backup preview. The work-mode matrix has 24 role/viewport cases; touch QA has seven viewports with simulated keyboard/rotation; workspace CTA has 20 input/viewport cases.

The first browser pass was 12/14. One work-mode case timed out on the initial loading screen under the normal 5-second assertion; the unchanged suite passed all 24 cases on isolated recheck with the same timeout. This is recorded as intermittent startup timing, not proof that cold-start performance is solved. The Close Day test race described below was repaired and passed. The final version of the new modal regression was also rerun successfully with normal assertions.

Results/logs/screenshots: `/workspace/field-stability-qa/candidate/summary.json`, `rechecks.json`, per-suite logs and screenshot directories. Initial failures remain in the first summary; they are not relabeled as initial passes. No test/financial guard was removed, no assertion timeout was increased, and no live business writes occurred. Feature-head and merged-main CI are tracked on the PR before claiming integration complete.

A pre-existing Close Day browser assertion raced the asynchronous write: it checked POST count immediately after the review dialog disappeared. `confirmCloseDay` intentionally closes the dialog after preparing the durable intent and before the asynchronous API completes. The browser test now waits for the exact-ACK success message and also requires recovery storage to be cleared; all one-write/payload/cancel checks remain. No Close Day application logic was changed. Initial failure is retained in the QA summary; the corrected suite passed before PR.

## Coverage and limits

The full backend suite covers checkout/cash/PromptPay, durable duplicate and lost-response recovery, offline ACK handling, stock transactions and reversals, FIFO, expenses, VOID/refund, Close Day, permission and backup validation. Browser suites cover corresponding operator/recovery flows and responsive layouts with intercepted APIs. Neither proves live provider settlement or a physical cash count.

No claim that all possible faults are eliminated, all reports are accounting-certified, or that staff learn the system in one minute. Actual Android/PWA keyboard, hardware/storage behavior, provider sandbox acceptance, physical shop master data, timed isolated restore drill and measured human first-use acceptance remain required. No architecture rewrite or performance gain is claimed without measurements.

## Assessment and P0–P3 priorities

- Strengths beyond a basic POS: server-authoritative financial/stock commits, durable request ledger and exact replay, retained payment uncertainty, stock reversal evidence, FIFO production, guided Close Day, read-only catalog readiness, role-based front/back modes and in-POS daily work. This is not a claim of database-enforced audit immutability.
- P0: the checked automated transaction suite is green; real provider sandbox/reconciliation, power-loss/storage acceptance and isolated restore timing still need operating evidence. Never simplify safety to shorten the UI flow.
- P1: confirmed inherited-disabled/hidden keyboard boundaries and contradictory pending instructions are repaired here. Review additional modal keyboard paths on actual devices before declaring universal accessibility.
- P2: direct-add/sweetness policies, compact payment, memoized menu/cart work and on-demand assistant already exist. Measure cold start and staff first-use behavior; one local 5-second startup assertion timeout is recorded for isolated recheck, not evidence for a framework rewrite.
- P3: Today Workspace already contains routine expense and receipt/queue/stock guidance. Improve only a demonstrated gap and reuse the existing durable APIs, rather than reimplementing the older roadmap.

## Next safe work

Fetch latest main and inspect existing implementation before changes. Prioritize remaining evidence-backed money/stock/recovery issues over cosmetic work. Recheck all modal keyboard paths, provider sandbox and actual Android after this bounded fix. Measure real first-use taps/time and rendering/network behavior before optimizing further. Follow the existing release-marker gate; merge is not deployment.
