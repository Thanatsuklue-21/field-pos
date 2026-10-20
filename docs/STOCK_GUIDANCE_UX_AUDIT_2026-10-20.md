# FIELD POS stock guidance and readable unavailable menus — 20 October 2026

Baseline: exact latest main/production `90b7c4a9e17450b69aa8c353d70568c2559eac62`. Continues the approved readiness roadmap and stock-blocker navigation requirement. Existing FIELD layout, routes and permissions are retained.

## Captured flow and findings

1. **Front-of-house menu selection — corrected.** Fresh production capture showed unavailable menu cards faded so far that names and shortage reasons were hard to read. Explicit unavailable foreground/background tokens now meet 4.5:1 in regression checks; whole-card opacity is one. Disabled ordering behavior is unchanged. Recipe variant options use the same readable treatment.
2. **Back-office stock work — corrected.** Fresh production stock capture showed all ingredients and four actions per active card, with English management terminology. Stock now has a Thai task title; daily receiving/waste actions stay visible and admin master/reset actions start collapsed. A read-only attention projection names the existing ingredients and menus affected by current shortages. Catalog and in-place workspace guidance lead to `/stock?attention=shortage`; staff can switch to all ingredients or search. Archived/disabled/hidden-category/invalid-price menus are excluded from the projection, matching POS visibility. Missing ingredient references are separately flagged for owner recipe review.
3. **Recovery and small-screen guidance — corrected.** Intercepted browser tests distinguish successful no-shortage data, unavailable projection and server failure. A refresh failure cannot retain an all-clear statement. At 320px screenshot review caught contradictory tap-menu instructions above an all-unavailable warning and a stock CTA for order-only cashiers. The generic instruction is now hidden in that state; stock actions require existing stock/admin access, while other staff get a clear instruction to ask their manager. Recipe-only blockers point to recipe/status review, without a misleading stock CTA. The warning refers to displayed menus because category/search filters may be active. Mobile guidance buttons use short visible labels and full accessible names to leave more space for ingredients.

## Backend and transaction boundary

`/api/stock/overview` retains its existing authorization before state reads. The added projection contains ingredient IDs and affected menu names, not prices or recipe quantities. Tests assert only SELECT queries, unchanged revision and rejection of non-stock staff. The projection reuses current availability logic and does not grant permission or alter sellability. No payment, stock write, recipe mutation, costing, accounting, durable-write recovery, schema or dependency changes.

## Validation and evidence

- Full npm test: 846/846 passed; production build passed on Node 24.
- New regression tests failed before implementation: missing read-only projection, missing contrast tokens, missing stock UI, contradictory tap instruction, and recipe-only stock CTA.
- New browser matrix: five widths (320/360/390/412/1024) x admin/stock roles, plus cashier-only and recipe-only scenarios. It checks touch/keyboard filtering, real affected-menu context, admin-only collapsed controls, search and empty/error/healthy states, horizontal reflow, disabled ordering and computed text contrast. Tailwind Lab colors are converted through the browser before measuring contrast.
- All twelve existing browser suites passed locally; after the final POS guidance changes, touch checkout and cashier flow were rerun and passed. Exact-head CI runs all thirteen suites on the final code before merge.
- Independent read-only review found no material issues, including the final blocker/permission correction.
- Accepted local captures: `guidance-audit/01-front-before.jpg`, `guidance-audit/02-stock-before.jpg`, and `guidance-qa/qa-stock-attention/*`. These are local audit artifacts outside the source checkout, not committed business screenshots. Fresh production verification is recorded after release in the same local audit bundle.

## Limits and next acceptance

This verifies the scoped flow, not full accessibility certification or universal first-use success. Actual stock, packaging, prices, recipes and costs still need owner confirmation; no values were invented. Full provider sandbox checks, measured real-device performance and novice staff acceptance remain separate roadmap work. Browser QA intercepts all business writes; production verification is read-only. Release requires feature exact-head CI, then a separate marker-only release PR and exact production SHA/health/runtime checks.
