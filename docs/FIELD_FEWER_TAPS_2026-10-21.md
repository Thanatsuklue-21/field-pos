# FIELD fewer-tap work — 2026-10-21

Based on latest main `50e4ab7`, including pending-payment focus and exact-satang changes. Existing front/back workspace and account permissions are retained.

## Demonstrated gaps and repair

- Searching for a nonexistent menu left an unexplained blank area. Search now has a named, 44px clear action and an explicit empty result with one action that resets search/category together. The cart is retained. A genuinely unconfigured catalog instead explains the setup requirement and gives an admin-only products link.
- A new stock receipt copied the previous purchase date. New receipt entry now starts on today's Bangkok date. Reusing a historical preset preserves a date the operator deliberately edited.
- Receiving stock required scrolling past optional evidence fields. Quantity, price, date, payment method and conversion remain visible; supplier/evidence/note/history are in optional details. Sticky confirmation repeats the quantity, total and date before the existing explicit write.
- At 390×500 the catalog column shrank its category row under menu content. The short-screen layout scrolls the full catalog column without shrinking its controls.
- Review caught invalid intermediate price text crashing the new monetary preview. A presentation-only helper safely labels blank, invalid, negative and overflowing values. Server validation, submission eligibility, durable write identity and exact ACK handling remain unchanged.

## Automated evidence

`qa-quick-work.py` intercepts all business APIs and covers 320×740, 360×740, 390×844, 412×915, 430×932, 768×1024, 1024×768, 1280×800 and 390×500. It verifies search/category recovery, preserved cart, no additional bootstrap request, empty catalog guidance, valid explicit checkout ACK, date/preset behavior, optional note retention, invalid price preview, accessible labels and visible touch-sized confirmation.

Measured fixture paths: single-variant exact-cash sale is four taps; multivariant is five; receiving a correctly prefilled repeat purchase is two. These counts exclude typing, scrolling, review, navigation to the starting page and post-sale handoff. They are automated fixture measurements, not human first-use results. Final payment and stock confirmations remain explicit.

Regressions were observed before repair: missing search recovery, historical date reuse and short-screen category obstruction. Evidence and final per-suite results are held in the task's `quick-work-qa-20261021` folder. CI runs the new suite alongside the existing fifteen browser suites and the full backend/build gates.

## Release and operating limits

Ship only after required checks pass, through the existing separate `.vercel-release` marker PR. Verify the exact release SHA and deployment ID, health, POS, protected endpoints and runtime errors. No live checkout or stock write is part of production verification.

This patch does not establish universal novice usability or change payment, stock or accounting rules. Real menu/recipe/cost/stock data, physical Android/PWA/keyboard acceptance, live provider sandbox, restore drills and timed novice acceptance still require operating evidence. No migration or new environment variable is required. Rollback uses the previous verified release through the same marker gate.
