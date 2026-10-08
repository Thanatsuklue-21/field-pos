# FIELD POS PWA — Mobile Acceptance Gate

Use this checklist against the exact release candidate commit. Automated unit/static tests are necessary but do not replace device acceptance.

## Device / viewport matrix

Phone portrait:
- 320 × 640
- 360 × 800
- 390 × 844
- 412 × 915
- 430 × 932

Tablet:
- 768 × 1024 portrait
- 800 × 1280 portrait
- 1024 × 768 landscape

## Route order

1. /pos
2. /queue
3. /orders
4. /stock
5. /expenses
6. /close
7. /settings

## Required pass criteria

- No page-level horizontal scroll at phone widths.
- Bottom navigation never covers checkout, queue, modal or destructive actions.
- Operator buttons have at least a 44 × 44 CSS-pixel hit area.
- Opening the Android keyboard keeps cash input, change and confirm reachable.
- Orders, Expenses and Stock history do not require horizontal table scrolling.
- Stock and expense inputs/selects do not force two-column grids wider than the viewport.
- Fixed modal cards stay inside the current VisualViewport and scroll internally.
- Long Thai menu names do not overlap price/status controls.
- Safe-area insets protect status/navigation bars and display cutouts.
- Cached POS catalog renders before Cloud revalidation when available.
- Offline mode accepts only the existing safe cash flow.
- PromptPay, bank/card, split and loyalty remain blocked in offline mode.
- A cold-start offline session is allowed only with a valid local operator snapshot and usable cached catalog.
- Reconnect revalidates the server session before any online write or outbox sync.
- Split-payment continuation and edit-cash recovery survive PWA process termination.
- Edit-cash recovery preserves the original customer and redeemed-points context.
- A mixed-customer multi-sale order cannot be auto-combined for edit.
- Waiting service-worker updates never force reload while cart/payment/split/queue/offline-sync state is unsafe.

## Transaction UAT scenarios

- Single cash sale → correct change → one sale → one queue.
- Two cash add-on sales in the same order → pre-production VOID restores every sale, stock and CRM exactly once.
- Mixed cash + bank add-on → automatic VOID blocked; Refund path required.
- Edit whole cash order before production → every item reopens in cart, prior cash amount prefilled, customer/points restored.
- Begin production → edit/auto-VOID blocked.
- Offline cash sale → local receipt/order marker → reconnect → one idempotent Cloud sync, no production queue duplication.
- App process killed with split/edit recovery present → reopen → recovery remains available.
- Service-worker update appears during active cart/payment → update remains deferred until safe.

## Evidence to record

- exact Git commit SHA
- Android device / OS / browser version
- standalone install result
- each viewport result
- Android keyboard/payment result
- cold-start offline result
- reconnect/outbox result
- split/edit process-kill recovery result
- service-worker update result
- remaining blockers, if any

Do not mark PR #112 ready for merge until this gate and Vercel exact-commit preview/release checks pass.

## Vercel note

The repository currently suppresses non-main Git deployments with `vercel.json > ignoreCommand`. Keep that suppression while Hobby deployment quota is constrained. When the release candidate is otherwise frozen, intentionally allow the PWA release branch once, verify a Preview for the exact candidate SHA, then restore the desired long-term deployment policy before production merge.


## Exact-commit Preview smoke check

After Vercel creates the one intentional Preview for the frozen candidate, verify the deployed build before Android UAT:

```bash
BASE_URL=https://<preview>.vercel.app EXPECTED_SHA=<40-char-git-sha> npm run pwa:smoke\n\n# Protected Preview (optional; keep the secret in CI / Vercel secrets)\nBASE_URL=https://<preview>.vercel.app EXPECTED_SHA=<40-char-git-sha> VERCEL_AUTOMATION_BYPASS_SECRET=<secret> npm run pwa:smoke
```

The smoke checker is read-only. It verifies the install manifest, Service Worker API bypass/cache headers, safe offline shells, Turso health and that the deployed Vercel build SHA exactly matches the approved candidate.


The smoke tool never prints the bypass secret and refuses to forward the bypass header across origins during redirects.


## Preview backend safety gate

Before transaction UAT on a Vercel Preview:

- **Do not attach the Production Turso credentials to Preview.**
- Settings → PWA / Device Readiness must show **Backend / Turso = READY**.
- If it shows **UAT BLOCKED**, provision a separate Preview/UAT Turso database and Preview-scoped credentials first.
- A Preview with no Turso must return a controlled 503 readiness response, not a runtime exception.
- Build identity must match the exact approved Preview commit before starting payment, stock, queue, refund, void or close-day UAT.
