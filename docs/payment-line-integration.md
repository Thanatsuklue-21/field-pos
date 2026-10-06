# Payment webhook and kitchen LINE integration

This repository uses Turso/libSQL (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) and database users. Supabase `DATABASE_URL`, `STORE_ID`, and `OPERATOR_PASSWORD` from the separate starter project do not configure this application.

The payment webhook remains `/api/payments/promptpay/webhook`. Beam signature validation and authenticated charge lookup remain mandatory; Opn uses authenticated charge lookup. Do not configure a gateway to send the separate custom HMAC adapter payload to this endpoint. Currency must be THB and amounts are checked in satang. Existing transactional request keys prevent duplicate stock/accounting/queue effects. Native providers do not share the custom adapter timestamp/signature format.

Optional server-only variables: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_KITCHEN_GROUP_ID`. No LINE channel secret is required for outbound push. Notifications are emitted for completed payments received through this webhook, including recovery on repeated callbacks. Cash checkout is unchanged.

An additive `field_line_outbox` table is created by existing schema initialization. Notifications run after settlement. A failed LINE push never changes payment success. A persistent retry key, fixed target/message, lease, exponential backoff, and a 23-hour retry cutoff limit duplicates. 4xx responses block the notification for manual investigation. Retry currently requires another webhook callback; there is no scheduled worker. A crash between settlement and notification creation can be recovered by a repeated completed callback. LINE acceptance does not prove delivery to every group member. Free message quota is governed by LINE and group recipient count.

Expired/cancelled sessions retain the existing unavailable/manual reconciliation behavior; no new PostgreSQL `review` status or stock resurrection is introduced. Existing user credentials and payment-provider environment variables must be retained on Vercel. Select the new Git commit in Deployments, then More > Redeploy after saving Production variables.
