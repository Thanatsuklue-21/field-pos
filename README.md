# FIELD Café POS

Single-shop POS for a small team, using Next.js/React, Vercel Functions and Turso/libSQL. The current application is the `app/` frontend: `/pos`, `/queue`, `/orders`, `/stock`, `/costs`, `/recipes`, `/expenses`, `/customers`, `/close`, `/reports`, `/backup`, `/users`, `/audit` and `/settings`.

## Core operating flow

1. Owner confirms menu prices, variants, recipes, purchase costs and ingredient balances. Review SYSTEM READINESS in Settings before opening.
2. Checkout validates the current server menu and stock, calculates the bill on the server and commits the sale, stock ledger, cost snapshot, loyalty points and queue in one write transaction.
3. Cash checkout checks received money and calculates change. PromptPay is payment-first: the POS creates a provider QR, polls the server while the customer pays, and only creates the sale/order after the provider reports success and the server re-verifies the charge. Displaying a QR alone never marks a bill paid. Split payments reserve ingredients until completion or resolution.
4. Queue recommends work for the oldest customer. Accept a menu, then complete all its remaining identical cups with one button. Ready menus may be called early, or all drinks called together. Calls and final handoff enforce FIFO on the server. The Bluetooth pager still requires pressing its number on the physical device.
5. Print or reprint receipts from the order details in `/orders` using the browser print dialog.
6. Close day requires counted cash, no unfinished orders and no unresolved payments. Sales, refunds, expenses and purchase expenses for a closed day are blocked.

Checkout and queue operations have durable request keys stored in `field_pos_requests`. A request key cannot be reused with changed input or a different actor. The state document retains its last 100 request responses for compatibility; the durable table protects newer transactions after that cache expires. Requests predating this migration are protected only while their legacy keys remain available.

## Setup and validation

- Node.js 20 or newer; use `npm ci`, `npm test`, `npm run build`, then `npm run dev` or `npm start`.
- Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `PUBLIC_ORIGIN` to the exact application origin. Keep credentials server-side. Schema installation is additive and runs before API handling.
- Provision the first API admin with `npm run bootstrap -- admin`; the bootstrap prompts securely for a password. Do not initialize another admin when using an existing configured database.
- Configure Beam PromptPay with `PROMPTPAY_PROVIDER=beam`, `BEAM_ENV=playground`, `BEAM_MERCHANT_ID`, `BEAM_API_KEY` and `BEAM_WEBHOOK_HMAC_KEY`. Keep all credentials server-side and test in Playground before Production. Legacy Omise/Opn remains available as a migration fallback when `PROMPTPAY_PROVIDER=opn`.
- Session cookies are HttpOnly/Secure/SameSite=Strict; writes validate origin, CSRF and server action permissions.
- `npm test` includes real file-backed libSQL tests of checkout, stock deduction, grouped preparation, FIFO, close day, split payments, concurrent retries and durable idempotency.

## Solo-operator order entry

The POS keeps cart interactions local and immediate. An unpaid cart can be parked with **Hold Bill** and restored on the same device without creating a sale, deducting stock, or entering the production queue. Restoring a held cart re-reads current menu names, prices, variants and availability before checkout. A held bill cannot be created while a payment result is ambiguous or while the cart is the unpaid remainder of an existing split-payment queue.

## Data and recovery

The server remains authoritative for shared transactions. IndexedDB caches POS bootstrap data and also holds a durable cash outbox: when the browser is explicitly offline, the POS may capture a normal full cash sale locally, project recipe usage against cached stock, and sync the same idempotent request when connectivity returns. Offline mode deliberately disables PromptPay, split bills, loyalty redemption/earning and add-ons to an existing queue. Synced offline sales are recorded as already fulfilled so they do not re-enter the live production FIFO; any stock deficit is preserved for reconciliation. If a write becomes network-ambiguous after transmission starts, keep the original request key and reconcile it instead of creating a second bill.

Use the full backup page for state plus stock, purchase, recipe, cost and durable request ledgers. Version 2 backups include request keys; version 1 backups remain readable. Export reads all tables in a consistent transaction. Restore requires an owner confirmation and matching revision. Test recovery on a separate database before using it for an emergency.

`public/index.html` and `public/online*.js` are legacy migration/reference fixtures, not the primary application. Their public entry routes are quarantined to `/pos` in production. Do not use their local state as the source of truth for current shared sales or assume that legacy JSON exports contain the full accounting ledgers. Obsolete standalone telemetry/insights/root-HTML assets were removed from the active repository.

## PWA operating model

The current app is installable as **FIELD POS** from supported browsers. The manifest launches at `/pos` in standalone mode, while the service worker caches only the app shell/static assets and same-origin images. Requests under `/api/` are deliberately never cached by the service worker; checkout, payment, stock, queue, refund, void, expenses and close-day semantics remain server-authoritative.

PWA updates are staged. A waiting service worker does not force-reload the POS while the cart, payment recovery, split-payment state, queue action or offline sync is active. The operator can install or inspect PWA/device readiness from Settings. IndexedDB schema remains version 2; the PWA layer reuses the existing bootstrap cache and durable offline cash outbox rather than creating a second offline database.

## Deployment and practical limits

Push a tested change to the connected GitHub repository and verify that Vercel Production is READY for the exact commit. Smoke-test `/api/health`, page routes and unauthenticated API denial. A successful page response alone does not verify logged-in checkout or the live payment provider.

The application keeps its shared business document in `field_state`, with transaction locking and separate accounting ledgers. POS and Queue polling send the last known revision; when nothing changed, the server returns a compact unchanged response without transferring/parsing the full state document. This is suited to the current small shop, but historical sales growth should still be measured before expanding to many users. Cash reconciliation includes opening float, cash sales, cash-paid expenses and audited cash drawer movements. Multi-sale/add-on orders can be refunded atomically as one order so sale state, stock reversal, CRM reversal and refund audit metadata stay aligned. LINE integration, automatic bank reconciliation, printer/pager hardware control and Android device acceptance are separate checks and must not be inferred from passing backend tests.
