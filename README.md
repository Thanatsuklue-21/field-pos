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

## Data and recovery

The server is authoritative for transactions made in the current Next.js app. IndexedDB caches bootstrap data for viewing when connectivity is lost; checkout is blocked offline. Keep an unresolved checkout's original request key and reconcile its result instead of creating a new bill.

Use the full backup page for state plus stock, purchase, recipe, cost and durable request ledgers. Version 2 backups include request keys; version 1 backups remain readable. Export reads all tables in a consistent transaction. Restore requires an owner confirmation and matching revision. Test recovery on a separate database before using it for an emergency.

`public/index.html`, `index.html` and `public/online*.js` are legacy migration/reference fixtures, not the primary application. Their public entry routes are quarantined to `/pos` in production. Do not use their local state as the source of truth for current shared sales or assume that legacy JSON exports contain the full accounting ledgers.

## Deployment and practical limits

Push a tested change to the connected GitHub repository and verify that Vercel Production is READY for the exact commit. Smoke-test `/api/health`, page routes and unauthenticated API denial. A successful page response alone does not verify logged-in checkout or the live payment provider.

The application keeps its shared business document in `field_state`, with transaction locking and separate accounting ledgers. POS and Queue polling send the last known revision; when nothing changed, the server returns a compact unchanged response without transferring/parsing the full state document. This is suited to the current small shop, but historical sales growth should still be measured before expanding to many users. Cash reconciliation assumes expenses are paid outside the sales drawer; cash-in/out tracking must be added if expenses are paid from it. LINE integration, automatic bank reconciliation, printer/pager hardware control and Android device acceptance are separate checks and must not be inferred from passing backend tests.
