# Shop lifecycle audit and repairs — 21 October 2026

Base: exact latest main `555f8f165ac75375faa03ef9de057d192234b993`. User authorized broad bug discovery/repair across front/back office, from ordering through shop close. This is an evidence-based pass, not a claim that every possible bug is eliminated. No production business writes or data migration.

## Confirmed defects and repairs

1. Existing hot-cup stock uses `set`, but receipt conversion did not support it. `serve` was offered in master UI but unsupported too. Add distinct set/serve units and their same-unit aliases; offer them in receive/edit/master controls and align the server master whitelist. Default new receipt packaging to the actual usage unit. Never infer that one piece equals one cup-and-lid set. Existing incompatible count/mass conversions remain rejected.
2. Stock write errors appeared behind dialogs. Shared error and exact-request retry feedback now appears in all six stock dialogs, with transaction feedback inside the sticky confirmation area. Invalid conversion and blank/invalid purchase cost block new confirmation; errors explain what must be corrected. Existing durable identity and ACK rules remain.
3. A pending settlement locked its dialog while its retry/error appeared behind the overlay. Keep inputs locked while busy/pending, expose error and same-request retry inside, allow idle close without deleting the durable intent, and retain busy dismissal prevention.
4. Empty settlement amount became zero through `Number('')`. Require explicit currency input; explicitly entered zero is still supported.
5. A settlement amount such as 70.001 committed server-rounded 70, but exact ACK expected 70.001 forever. Reject fractional-satang entry before preparing new intents. Existing legacy intent ACK compares the exact server-rounded amount while retaining all request, actor, operation, date, platform and note checks; replay payload/key is never rewritten. Tests reject a wrong cent and wrong actor.
6. A cleared stock-count input became zero. Require an explicit nonnegative finite quantity; an explicit zero still represents no stock. For package counts one optional empty component counts as zero only when another component is explicitly entered. No adjustment occurs from a completely blank count.

## Coverage matrix

| Area | Evidence |
|---|---|
| Order entry and cart | Search/category recovery, available-first ordering, variants, preserved cart, satang, responsive touch and keyboard |
| Cash/payment | Exact ACK, cash/change, split payment, delayed/ambiguous response, PromptPay nonblocking, modal focus/busy locks |
| Queue and handoff | FIFO, preparation/call/handoff, waste review, offline outbox and exact replay |
| Stock and purchasing | Set/serve/legacy aliases, incompatible units, explicit quantities, purchase edit/reversal, inventory ledger and recovery |
| Expenses and settlements | Durable expense recovery; blank/subsatang entry, lost settlement response, exact same-payload retry and legacy rounded ACK |
| Close day | Shift opening, pending-write blockers, blind count/review, lost response recovery, stock/payment/expense reconciliation gates |
| Back office/access | Front/back mode and role matrix, catalog readiness, admin namespaces, customer/user/recipe/master durable writes |
| Operations | Backup preview, production build, health/exact release checks, protected endpoints and runtime error observation |

## Regression evidence

New `qa-lifecycle-repair.py` intercepts all APIs at 320/360/390/412/1280 widths. It requires disabled mismatched units, actionable in-dialog stock errors, set receipt payload, cleared-count rejection, same-key stock-count retry, blank/subsatang settlement rejection and same-payload settlement retry both inside and outside the modal. It is included in CI alongside the existing sixteen browser suites.

Red results are retained: old UI defaulted set stock to grams; blank settlement confirm stayed enabled; old count path had no inline blank warning. Domain tests failed on unsupported set/serve, missing explicit-count/amount helpers and legacy ACK mismatch before repair. Real libSQL master/receipt regression first returned 400, then passed: create set master, receive fifty sets, replay once, fifty total and one ledger row.

Final local backend suite: 856/856. Final production build passed. An independent review traced lifecycle/recovery paths and found the settlement issues above; final patch review and full browser/CI results are recorded with release evidence. Initial Windows native subprocess exits and intermediate source/test failures remain in task logs; no application safety assertion was removed to conceal them.

## Release and limits

All required browser suites and exact-head CI must pass; release uses the existing marker-only PR gate. Verify exact production SHA/deployment, health, POS/protected routes, authenticated read-only stock preview and runtime errors. No real stock receipt, sale, accounting entry or shop close is part of production verification.

Physical Android/PWA keyboard/storage/power-loss behavior, real payment-provider sandbox and bank reconciliation, timed isolated restore and novice acceptance still need operating evidence. Actual quantities/prices/recipes/costs remain the owner's responsibility. Automated fixtures cannot prove those facts or full accounting certification. Rollback follows the previous verified release through the same marker gate.
