# Payment integrity repairs — 21 October 2026

Based on exact main 42edb310d637f42228516efef840ef31c4a34dcb. Fixes the readiness audit's paid-charge reuse, HTTP split-payment retry and Opn webhook contract defects. Shop menu, recipe, stock and cost values remain intentionally provisional, per owner instruction; readiness warnings must remain visible until real data is entered.

## Resulting behavior

- A paid QR charge must match the intended checkout request or split session, provider, THB currency and server-calculated amount. An attached split charge must match too. Provider verification fields come from server lookups, overriding caller claims.
- A reserved `payment-charge:` row in the existing durable request ledger records consumption atomically with payment. Its primary key prevents reuse across fresh request keys, and full backup/restore already includes it. This avoids a new table or destructive migration. Historical sales and partial payments also prevent reuse of receipts predating this release, including refunded receipts.
- The same committed request still replays before calling the provider, including when the provider is temporarily unavailable. Split HTTP preflight now uses the same operation identity as its transactional commit.
- Full restore retains current consumed-charge guards and merges backup guards without replacing existing evidence. Restoring a backup taken before payment therefore cannot make that charge spendable again. Restored unresolved sessions still require reconciliation with the provider; restore cannot reverse real-world payments.
- Owner test-sales and full-test-data cleanup also retain these provider guards; clearing local test history cannot reverse a payment at the provider.
- Opn creation stores the FIELD reference in metadata; lookup restores that reference (with legacy FIELD description fallback). Webhook normalization maps charge.complete to the application's succeeded/failed contract using independently fetched provider state. [Official provider webhook contract](https://docs.omise.co/api-webhooks).
- Opn currency is normalized to uppercase so provider `thb` responses pass the same THB check as Beam. An HTTP integration test finalizes one sale through Opn webhook and verifies duplicate delivery creates no additional sale or stock deduction. [Official charge response contract](https://docs.omise.co/charges-api).
- Cashier errors explain a reused receipt or mismatching payment in Thai without encouraging another charge.

No price, recipe, stock deduction, refund amount, loyalty or accounting calculation has changed. No production test sale or provider payment is part of validation.

## Regression evidence

`payment-integrity.test.mjs` uses real isolated libSQL databases: HTTP cash retry after lost response; charge reuse with fresh keys; intended reference/currency mismatch and stock rollback; authoritative provider metadata; QR replay without provider access; full backup/restore preserving consumed charge and replay; concurrent payment requests; transaction failure rollback; historical refunded charge reuse rejection. Opn tests use mocked provider responses, including legacy references and spoofed webhook fields.

Existing refund and CRM fixtures now include the full verified provider context rather than incomplete synthetic payment assertions. Broad tests and CI browser QA remain required before release. Live-provider acceptance, physical Android testing, staff usability and sustained load measurements are operating checks, not implied by regression passes.

## Release and rollback

Merge the tested feature PR first. Only after exact-main CI succeeds, update `.vercel-release` in a separate release PR. Verify Vercel READY, exact release SHA via health, `/pos`, guarded APIs and runtime logs. Rollback must preserve the durable ledger; deploying old code would remove these payment guards and is not a complete security remedy. No schema downgrade is required.
