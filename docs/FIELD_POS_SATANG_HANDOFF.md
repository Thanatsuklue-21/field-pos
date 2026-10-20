# FIELD POS satang labels — 20 October 2026

## Baseline and evidence

Fresh branch `fix/field-pos-money-display` from exact `origin/main bc457ad4b3bf4af9b484a8d40cfe196a6029ac36` (#473). Latest FIELD POS CI 39454284671 passed. Production read-only health still identifies the prior release `2dbbd92`, as expected under the unchanged release-marker gate.

Products API accepts finite positive prices with fractional baht. The baseline production-build browser fixture supplied 55.50, but the menu card displayed 56. POS used `toFixed(0)` on 24 money labels, including totals, split review, exact cash, held bills and authoritative change. A 44.50 server change could therefore be shown as 45 even though the stored amount was correct. This is a P1 cash-handling risk, not evidence of a duplicate transaction or incorrect server commit.

Baseline screenshot: `/workspace/field-money-qa/baseline/01-menu-320.png`; browser regression failed on expected `฿55.50` vs actual `฿56`. Formatter unit regression failed before implementation.

## Repair

`formatBaht` reuses existing exact decimal satang rounding. It keeps whole-baht labels compact (55) and shows both decimal places for non-zero satang (55.50, 44.50, 0.10). Invalid/overflow amounts still fail closed. All 24 whole-baht-only POS money labels use this helper; existing GP rate/fee precision is retained.

No price/master data, discount/loyalty policy, arithmetic, request identity, API, schema or recovery behavior is changed. Server remains authoritative. This is not a whole-system fractional pricing/costing audit or a new sub-satang price policy.

## Regression and validation

`qa-pos-satang.py` intercepts every API request and is added to CI. On 320/390/1024px it checks menu/variant prices, payment total, 0.10 shortage and disabled confirmation, exact-cash fill, 44.50 change before and after authoritative ACK, one checkout request with unchanged numeric amounts, no other business writes, no page errors and no overflow.

`npm ci` passed; full `npm test` 848/848 passed; production build and diff check passed. The new satang browser regression passed at all three viewports. Existing touch checkout (seven viewports including simulated keyboard/rotation), cashier handoff and PromptPay nonblocking suites also passed locally. API writes were intercepted; no live transactions or master data changes.

The initial full suite exposed five source assertions tied to the former `toFixed(0)` expressions. They now require `formatBaht` while retaining the other guidance, shortcut, modifier, quantity, mobile and net-payable assertions. The executable satang/browser regressions prove the changed behavior. CI runs all 15 browser suites on the exact feature head; merged-main CI remains required.

Screenshots/results: `/workspace/field-money-qa/candidate`, `touch`, `cashier`, `promptpay`. No performance or actual-device acceptance claim is inferred from desktop Chromium.

## Continue safely

Fetch latest main and inspect CI before starting another change. Do not redo #473 focus/pending-message work or rewrite architecture. Keep currency formatting distinct from financial calculation and persisted request bodies. Follow the existing release gate; release smoke must verify the actual deployment SHA. Actual Android/PWA, provider sandbox, physical cash handling, restore drill and human first-use acceptance remain separate operating evidence.
