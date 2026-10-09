# Payment flow audit — 9 October 2026

## Evidence boundary

User confirms Beam is not yet available. No real Beam API charge, bank scan, settlement, customer payment or Production write was performed. Automated provider responses are fixtures. Bank/card checkout records are manual confirmations, not processor authorization. This audit does not certify physical mobile usability or actual processor settlement.

## Completed 60-bill scenario

`test/payment-sixty-bills.test.mjs` uses a new file-backed libSQL database, real API handler, operator session and CSRF checks. It runs 60 one-cup bills at 55 THB: cash, bank, card and simulated Beam PromptPay, 15 bills per channel. Each checkout is replayed, then prepared, called and handed off. More than 300 API-handler calls include report/export and close-day checks; this is not a browser or HTTP transport test.

- Revenue: 3,300 THB; each payment channel: 825 THB.
- Opening cash: 500; expected/count cash: 1,325; variance: 0.
- Exactly 60 distinct bills/orders; no duplicate on replay.
- Exactly 180 ingredient SALE ledger entries.
- Matcha: 1,000 − 300 = 700 g; milk: 30,000 − 6,600 = 23,400 ml; cups: 500 − 60 = 440.
- QR provider lookup: 15; committed retries require no second provider lookup.
- Accounting CSV data contains exactly 60 bills with unique bill numbers.

## Confirmed gaps repaired

1. Checkout and Split provider verification accepted a paid charge without checking THB currency. The checkout regression reproduced an actual false-positive sale for USD before the fix. Both entry points now reject wrong currency before payment mutation. Missing Beam currency is no longer defaulted to THB for verification.
2. Provider response charge identity must match the charge requested by the operator; mismatched responses are rejected.
3. Paid QR charge reuse is rejected transactionally across normal checkout and Split. Claims are retained in the existing state document independently of sale/session pruning or trial-sales resets. Existing historical sale/session references are checked too. Original request-key replay still returns the original result. Failed claims roll back with stock and state.
4. Beam requests now have a 15-second abort deadline. A stalled request cannot report a successful payment; retry/recovery remains necessary after an ambiguous timeout.

Nine new integration cases cover the 60 bills, wrong currency on both entry points, charge reuse, pending, failed, wrong amount, missing currency and mismatched identity. QR rejection assertions check no sale and preserved stock; rejected Split reuse leaves its payment collection empty.

## Existing regression surfaces reviewed/run

| Flow | Evidence / practical limit |
|---|---|
| Cash tender, change, underpayment | POS/domain and API regressions; 60-bill cash subtotal and independent drawer close |
| Bank/card | Channel recording and report reconciliation; manual confirmation only |
| Split by person | Intermediate status/reload, repeated allocation, fractional quantity, complete once, cancellation/expiry/refund tests |
| QR reservation | Stock hold, reservation expiry/grace release and recovery tests |
| QR pending/failed/invalid result | Executable provider/API rejection cases; no success inferred from QR creation |
| Signed Webhook | HMAC over exact raw body, invalid signature rejection, live status verification, duplicate callback produces one sale/stock/queue/notification |
| Retry/idempotency | Checkout and Split request replay/conflicting request guards; new cross-bill charge reuse guard |
| Offline | Cash-only outbox, committed storage, unconfirmed response retention, same-key replay and reconnect authorization tests; QR requires online server verification |
| VOID/refund | Cash reversal; production-dependent stock return; external payment refunds require manual external confirmation and do not initiate Beam refunds |
| Close/report | Pending payments/open orders prevent close; channel totals and CSV agree; blind counting preserved |
| Mobile UX | Existing payment layout/recovery regressions; physical Android/keyboard/browser acceptance remains pending |

Final local validation: **545 PASS / 0 FAIL**, Next production build + TypeScript PASS, diff whitespace check PASS. No configured lint command exists. Windows native libSQL emitted intermittent access-violation exits during early high-volume runs; the final complete run used serial test execution and `--max-semi-space-size=128`. API test requests also yield an event-loop turn. This runtime limitation remains documented; a native process crash is not an assertion pass. Linux CI must validate the pushed head independently.

## Required Beam UAT after credentials arrive

Prepare a separate UAT database and HTTPS exact-head Preview. Add secrets only in server-side UAT environment: merchant ID, API key, Base64 Webhook HMAC key and explicit Playground environment. Never paste credentials into chat or use Production database keys for Preview. Verify provider readiness and exact deployment SHA before starting.

At least **60 actual Beam-backed bill attempts** are required in UAT, with provider charge IDs and bank/Playground evidence linked to each local bill:

| Attempts | Scenario |
|---:|---|
| 20 | Normal full QR payment, multiple devices and prices |
| 10 | QR payments in Split/person flows, reload between payers |
| 10 | Customer pays then closes app / operator reload / connection loss; server callback recovery |
| 10 | Duplicate/delayed callback and status polling overlap; exactly one sale and deduction |
| 5 | Unpaid QR expiry/cancellation; no revenue, correct stock release |
| 5 | Failed or late payment after reservation expiry; explicit recovery/reconciliation |

Unpaid/failed attempts are not successful paid bills. Additionally obtain at least **60 successful paid customer bills** before claiming the user's real-customer acceptance requirement is met; QA attempts alone do not substitute for that count. Actual customer acceptance requires live Beam authorization, merchant readiness and reconciliation to Beam/bank settlement including fees and settlement delay. Playground is useful integration evidence, not real revenue.

For every attempt compare local request key, Beam charge ID, amount in satang, THB currency, provider status, sale/bill identity, payment channel, stock ledger, queue, report and drawer impact. Verify the QR is scannable using an actual supported banking app. Verify missing configuration fails closed. Verify signature rejection and callback retries in isolated UAT. Record expected outcomes before executing controlled late/duplicate/failure cases.

Block release on duplicate charges/sales, unexplained stock or cash variance, paid-but-unrecorded bills, unsigned payment acceptance or unresolved late-payment cases. Refund reconciliation must include proof of the manual external refund while the application has no automatic Beam refund integration.

Official references checked: [Charges API](https://docs.beamcheckout.com/charges/charges-api), [charge lifecycle](https://docs.beamcheckout.com/charges/charges), [Webhook authentication](https://docs.beamcheckout.com/webhook-authentication). The API uses smallest-currency-unit amounts; final status and authenticated callbacks determine success. An abandoned charge may remain pending and a late success callback remains possible, so expiry recovery requires actual UAT evidence.
