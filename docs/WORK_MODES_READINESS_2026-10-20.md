# FIELD work modes and readiness review — 20 October 2026

Baseline: exact main/production `e58c1a1d15eede830a695d2d574ae4cb628c14a3`.
User approved the bounded design in chat: front/back mode switching on the existing permission model, Thai task descriptions and staff presets, preserving financial/stock rules.

## Audited journeys and findings

1. **Receive an order / review / pay.** Current production screenshots show the guided three-step sale flow, but tablet/medium-desktop navigation hid link text and accessible names. Keep visible, named navigation at all desktop breakpoints. Retain the existing payment flow, held orders, offline outbox and cart persistence.
2. **Switch to store management.** Previously a collapsed icon menu was the only distinction. Add a persistent mode header with front/back destinations allowed for the current user. Move Close Day into back-office navigation; add the missing delivery-reconciliation navigation link. Cashier/barista accounts without management permissions see personal-account settings instead of a misleading back-office zone.
3. **Assign staff work.** Current production creation form exposed ORDER/QUEUE/STOCK/REPORT and English account terminology. Add Thai explanations and presets for cashier, barista, full front-of-house and shift supervisor. Presets edit only an unsaved new-user form; no existing account is automatically changed. Existing server permission keys and the order-or-queue requirement remain intact. Stock includes receiving/waste and count proposals; report includes expense entry and Close Day. Supervisor never grants admin configuration access.
4. **Direct URL / restricted work.** The frontend previously mounted views even when the user could not call their APIs. Gate protected page content using an explicit route policy. Queue-only staff arriving at /pos are routed to /queue; other forbidden URLs show a safe task link before protected child effects mount. Server session/CSRF/admin/capability checks remain authoritative.
5. **Connectivity / account error handling.** Browser QA confirmed the floating ONLINE badge blocked the mode-switch click at 1024px. Move it into the mode header and keep it non-interactive. Replace inaccurate offline write-paused wording with neutral cached-menu/pending-bill guidance. Password reset previously closed and announced success after a caught server rejection; it now keeps the modal and shows the actual error. No credential policy or session-revocation behavior changed.
6. **Small-screen form.** Screenshot review caught horizontal overflow in the new role form at 320px. Constrain modal/select/fieldset widths, preserve vertical scrolling, and test actual scrollWidth/clientWidth as well as bounding boxes.

## Verification

- Node 24 / unchanged package lock and dependencies.
- New tests reproduced navigation/name/gating gaps, reset false success and status overlay behavior before the associated fixes.
- Full npm test: 832/832 passed outside the filesystem sandbox; production build passed. The native libSQL process exited abnormally in sandbox during a combined run; isolated 29 core integration tests and the complete unsandboxed run passed without removing tests.
- New intercepted browser matrix: four roles × 320/360/390/412/768/1024px. It checks mode destinations, protected-view non-mounting, accessible sidebar names, cart retention, four preset payloads, 320px form overflow and server-rejected password-reset feedback. All business writes in QA are mocked.
- All ten existing browser gates passed locally: workspace CTA/contrast, touch checkout, offline outbox, cashier, PromptPay nonblocking, Close Day recovery, queue waste, expense recovery, workspace expense recovery, backup preview.
- Targeted backend permission QA: 24 existing tests passed; examined session expiry/active checks, per-request current permissions, write origin+CSRF, admin route prefix, order/queue/report checks and stock transaction validation. No concrete bypass established in the examined scope.
- React review: hooks remain unconditional, listener cleanup is retained, route access is checked before child views mount, navigation prefetch stays disabled on POS, and no new dependencies or database migration were introduced.

## Evidence limits and operating prerequisites

Current production inventory includes unavailable ingredients and paused menus. This work does not invent stock or alter recipes, prices, costs, accounting or historical transactions. The owner must reconcile real stock and approved recipes before selling every menu.

Automated cashier telemetry proves deterministic UI behavior, not that every untrained person can use the system without assistance. A real first-use trial with staff remains the acceptance test for that claim. No production payment, provider transaction, account change, stock adjustment or backup restore was performed for QA.

The Codex Security plugin preflight was ready, but its mandatory policy resolver incorrectly reported that the existing Windows scan root did not exist. Scan `da0223ab-14f3-4359-9a81-27fecd28af03` remains resumable. There is no completed full security scan report; the source-based permission QA above is separately scoped evidence.

Use feature PR exact-head CI, then a separate `.vercel-release` marker PR. Verify production READY, exact main SHA + health deployment ID, page/API denial smoke and deployment-scoped runtime errors after release.
