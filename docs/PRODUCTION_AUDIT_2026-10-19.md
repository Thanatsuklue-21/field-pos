# FIELD POS production audit — 19 October 2026

## Identity and release state

- Fetched `origin/main`: `2fb700229602f86525db5dacbbcf62748ad4bb69`.
- Clean checkout; new branch `audit/production-readiness-20261019` from that exact SHA. Older local PWA branch was preserved.
- Latest merged PR inspected: #452 (Stock guided reviews), following #451/#450/#449. #452 head CI run 39228052006 succeeded.
- Open release PR #448 is Draft and based on an older main. It is not acceptance evidence for this candidate.
- Current READY production: `72bda39275a4a91db16fbff1284273f9b5b09e42`, deployment `dpl_FA6EjjdVH3crNQZhko5yr16zAdHV`, region sin1, alias https://field-pos.vercel.app.
- Production health independently returned that same SHA and deployment ID. Newer main deployments were CANCELED under the marker gate; a green Vercel commit status did not mean deployed.
- PR: https://github.com/Thanatsuklue-21/field-pos/pull/453. Latest code checkpoint `e4fdf16cd4a5278ad86c06cd41b71c9c5fb81157`; documentation commits may follow. Always inspect the final PR head and its CI.
- No production deployment, financial write, provider payment, LINE message, restore, credential change or architecture migration was performed. `.vercel-release` is unchanged.

## Fixed issues and before/after acceptance

| Priority / trigger | Baseline | Candidate evidence |
| --- | --- | --- |
| P0 exact cash reconciliation: opening 0.10 + sales 0.20; count 0.30 | Expected 0.30000000000000004, variance -5.551115123125783e-17; Close Day can demand a variance reason after a zero-variance review | Expected 0.30, variance exactly 0; real file-backed libSQL close commits without a reason; replay retains one close and one audit |
| P0 real shortage: same drawer; count 0.29 | Variance -0.010000000000000064 | Exactly -0.01, shortage retained |
| P0 drawer opening 0.30, cash expense 0.10, withdrawal 0.20 | Valid withdrawal can be rejected by float residue | Exact withdrawal accepted; subsequent 0.01 rejected; replay has one movement/audit |
| P0 drawer ACK: opening 0.10 + cash-in 0.20 | availableCash 0.30000000000000004 | Exactly 0.30 |
| P0 cash price 0.10, received 0.30 | Change 0.19999999999999998 | Change exactly 0.20; forged client price ignored; same request deducts stock once |
| P0 split cash: price 0.10 × 3 | remainingAmount 0.30000000000000004; exact tender can fail | Remaining/payment amount 0.30, change 0; completed sale and stock deduction occur once |
| P0 offline successful but mismatched ACK | Sync deleted a pending bill without checking its own total/received/change/fulfilled state | Ten wrong/incomplete ACK regressions retain the original pending body/key, then exact replay removes it once |
| P1 regression portability | PWA source assertion failed on Windows CRLF | Normalize source line endings; preserve all lifecycle/recovery assertions |

`lib/domain/money.mjs` uses BigInt decimal coefficients for accumulation/multiplication and rounds to satang half away from zero at the output boundary. It accepts existing numeric/decimal-string inputs, rejects invalid/overflow totals, retains fractional expense-cost precision until aggregate rounding and serializes API values in baht. No new runtime dependency, schema or stored historical record migration was added. Drawer/Close Day, expense/profit aggregates, checkout/split/add-on/refund totals now use it. Review and final close share `reconcileCash`.

The offline guard requires a successful fulfilled cash result with pager 0, order/queue/sale IDs and matching numeric money fields. Unconfirmed responses retain pending status and request body/key, record `offline_sync_unconfirmed`, stop that sync pass and allow later replay. It does not treat HTTP 200 as a proof of sale, nor clear local data to recover.

## Validation and limits

- Installed from the existing `package-lock.json` using `npm ci --no-audit --no-fund`; no dependency/lockfile changes committed.
- Final local full suite on Node 24.19.0: **819 passed, 0 failed, 0 skipped/cancelled**, 46.2 seconds. Ran with `--test-concurrency=1` outside the Windows sandbox. Earlier sandbox runs had intermittent native libSQL worker exits in varying test files; no assertions were disabled, and the complete final run passed.
- Final Next.js 16.3.8 production build and explicit `tsc --noEmit`: passed. Existing `preferredRegion` deprecation remains.
- `git diff --check`: passed. No ESLint script/config exists on main; **lint was not run and is not claimed passed**.
- All nine existing Chromium production-build QA scripts passed: touch (7 phone/tablet viewports), offline outbox (7 scenarios), cashier, PromptPay nonblocking, Close Day lost-response, Queue waste review (3 viewports), Expense recovery (8 scenarios), Workspace Expense recovery, Backup preview (3 viewports). APIs were intercepted; this does not prove live provider/DB integration.
- Rechecked final checkout build with cashier, PromptPay and Close Day browser scripts. The final offline-ACK code is covered by executable module regressions; the outbox browser script covers storage denial/read recovery rather than a complete exact-ACK reconnect flow.
- Exact-head Linux CI for `58463cd9ee0c35957929daf50677ce3672e51f4a`: run https://github.com/Thanatsuklue-21/field-pos/actions/runs/39229951380 succeeded. This predates the offline ACK commit. Final PR-head CI must be checked separately before merge/release.
- `npm audit --omit=dev --json`: registry reported 0 vulnerabilities. This is dependency advisory coverage, not a proof of application security.
- Read-only production smoke: health 200 JSON/`no-store`, POS/Close/Stock 200 HTML; anonymous bootstrap and cash-shift 401 JSON/`no-store`. Health backend timing 540.5 ms in this single sample; external request time 1943 ms. Page samples 105/342/351 ms; anonymous reads 258/132 ms. These are single sequential observations, not cold-start or percentile measurements and not candidate performance results.
- Decimal aggregation of 10,000 one-satang values: total exactly 100; median 6.40 ms over 7 local samples. No performance improvement is claimed from a correctness patch.

## Remaining P0–P3 work; not 10/10

| Priority | Area | Evidence / next acceptance |
| --- | --- | --- |
| P0 | Complete money audit | `app/pos/page.tsx` still uses binary arithmetic for cart/payment previews, local offline change, GP and loyalty estimates, and `.toFixed(0)` can hide satang. `lib/domain/loyalty.mjs`, delivery, costing and some report/accounting helpers still have float multiplication/division/rounding. Migrate with independent fixtures for discounts, points thresholds, fractional COGS, GP and consistent UI/server outputs. This PR does not claim whole-system decimal safety. |
| P0 | Offline capture/stock recovery | Outbox persistence and the projected bootstrap cache are separate transactions (`queueOfflineCashSale` then `finishOfflineSale`/`cachePut(...).catch`). Need a process-kill/cache-write-abort acceptance proving a bill and stock projection cannot diverge, and prevent overselling from an old projection after relaunch. The new ACK guard protects deletion only. |
| P0 | Provider and isolated deployment acceptance | No isolated HTTPS Preview DB/provider session was available/configured for this audit. Need exact-SHA preview with an isolated DB, full checkout→payment callback→replay→reversal→close UAT and post-deploy runtime review before promoting. Live production is an older release. |
| P1 | Audit immutability/recovery | Application paths append audit records and reversal tests cover one-time effects. `field_audit` is an ordinary SQL table; database-enforced tamper resistance, retention/privileged-access policy and a timed isolated full restore drill were not proven. Do not describe it as cryptographically immutable. |
| P1 | Accessibility/device acceptance | Existing dialog/label/focus/touch regressions pass. Need assistive-technology and nested-modal focus testing, measured contrast across all admin pages, actual Android keyboard/safe-area/install/process-kill acceptance. Chromium viewport resizing does not replace hardware acceptance. |
| P1 | Release controls | PR #448 remains Draft and stale relative to this work. Resolve the intended release contents against fresh main, exact-head CI and isolated UAT. Do not bypass the marker to make a newer deployment appear. |
| P2 | Performance/observability | Current revision polling, schema startup versioning, GET coalescing, idle maintenance and log-only Web Vitals already exist; retained. Collect authenticated cold/warm route/API/IndexedDB timings and real LCP/INP/CLS/TTFB distributions on representative devices/history sizes. No causal bottleneck or p95 improvement is established by this audit; no Redis/FastAPI/dependency rewrite justified. |
| P2 | CI/lint hygiene | Add an agreed lint baseline; keep the native Windows runner limitation visible. Consider artifact retention for browser output and release-specific runtime error monitoring. |
| P3 | Operator acceptance | Observe new operators completing cash, ambiguous payment, stock correction and close-day tasks; record task completion/errors/taps. Automated 7-interaction cashier timing is not evidence that a human can learn the system in one minute. |

Release remains blocked by the open acceptance items above. Passing this scoped PR is not a whole-system production-readiness certificate. Data Analytics was not invoked simply to create a dashboard: no representative business/performance dataset was available, and synthetic test outputs must not be presented as store KPIs.

Local reproducible evidence is in the parent workspace `audit-20261019/` and `audit-*.log` files; they contain QA fixtures only. Browser screenshots/JSON were not copied into synced project sources. Start the production build on port 3100 and invoke the existing `scripts/qa-*.py --base-url http://localhost:3100 --output ...` commands; never build over a running test server.
