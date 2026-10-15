# FIELD Delivery Settlement durability handoff

Baseline: `04287026c4139800fca4f3290b400255cfd9a1b8`.

## Evidence

Delivery settlement reconciliation and cancellation were financial POSTs without durable request identity.

- Reconcile creates a random `drec_...` record and removes the sale group from pending. If the response is lost after commit, retry returns `delivery_settlement_group_not_found` rather than the committed reconciliation.
- Cancel mutates the reconciliation. If its response is lost after commit, retry returns `settlement_already_cancelled` rather than confirming the original cancellation.

## Change

- One recovery channel covers Reconcile and Cancel.
- Exact financial intent is persisted before network send and replayed on reconnect/focus/visible resume.
- Server request identity is bound to actor + normalized settlement input through `field_pos_requests`.
- Replay runs before pending-group or already-cancelled validation.
- State-version snapshot, audit row and financial mutation are written once in the same transaction as durable request memory.
- UI blocks another Reconcile/Cancel while an earlier result is unknown.

## Regression contract

File-backed libSQL tests prove exact replay creates one reconciliation, one reconcile audit/state-version, one cancellation and one cancel audit/state-version. Changed payload/cross-actor request reuse conflicts, and both financial POSTs require a request key.

No schema migration or checkout/stock/recipe semantics are changed.
