# FIELD POS — One-Minute Cashier UX Gate

Release date target: 2026-10-13 onward.

## Goal

A first-time operator should understand the normal sale path within one minute without knowing POS terminology.

Normal sale mental model:

1. เลือกเมนู
2. ทวนบิล
3. รับเงิน

Advanced features must not compete with that path.

## Normal-sale acceptance

- The POS landing screen states the current next action.
- A single-choice menu adds directly to cart; multi-choice menus explain the required option.
- Search can be cleared in one tap.
- A filtered search never leaves a blank unexplained menu grid.
- The mobile cart bar keeps item count, total and checkout action visible.
- Opening payment shows order review first.
- Tender controls remain hidden until the operator confirms the bill review.
- Pending PromptPay recovery is exempt from the review reveal rule so an existing payment can still be reconciled safely.
- After review confirmation, the system reveals payment methods and tender controls.
- Cash remains the default routine method.
- Exact cash and common tender amounts are one-tap actions.
- Change is visible before commit.
- The final commit button remains server-authoritative and retains all existing recovery/idempotency guards.
- Advanced member, points and split-bill controls explicitly say routine sales can ignore them.
- Successful payment shows pager/change and one dominant “รับออเดอร์ถัดไป” action.

## Usability constraints

- No routine operator action below 44 × 44 CSS px.
- No page-level horizontal scrolling at 320–430 px.
- No full-screen loading overlay for ordinary local interactions.
- The Android keyboard must not cover the cash confirmation path.
- Transaction/recovery warnings must use plain Thai and state the corrective action.
- Offline synthetic operator mode remains cash-only and cannot expose queue/admin mutation paths.

## Regression rule

These UX changes are presentation and sequencing only. They must not weaken:

- server-authoritative checkout
- stock revalidation
- payment reconciliation
- request-key idempotency
- FIFO queue
- refund/void rules
- close-day rules
- offline cash durability
