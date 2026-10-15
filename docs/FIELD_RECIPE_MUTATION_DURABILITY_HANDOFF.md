# FIELD Recipe mutation durability handoff

Baseline: `a1bb494eb9238cfd4e0696f414dfe62c28adae4b`.

## Evidence

Three Recipe/R&D writes were non-idempotent:
- Publish generated a new recipe-version row and incremented the current version every POST.
- Approved reconcile consumed a legacy drift and then created a version; retry after a lost response returned `approved_recipe_not_legacy_match` instead of the committed result.
- Creating an R&D comment generated a fresh comment ID every POST.

## Change

- One device-local recovery channel covers Publish, Approved Reconcile and Comment Create.
- Exact intent is persisted before POST and replayed on reconnect/focus/visible resume.
- Server binds each request key to actor + normalized operation input through `field_pos_requests`.
- Durable replay runs before state-dependent validation/mutation.
- Exact ACK is required before local recovery clears.
- UI blocks another non-idempotent Recipe write while the prior outcome is unknown.
- Existing Comment PATCH remains unchanged because applying the same field values is idempotent.

## Regression contract

File-backed libSQL tests prove:
- Publish replay creates exactly one recipe version.
- Reconcile replay returns the original committed version after the legacy drift is already consumed.
- Comment replay creates exactly one R&D comment.
- Changed payload or actor reuse conflicts.
- Every non-idempotent Recipe POST requires a durable request key.

No schema migration or checkout/payment/stock semantics are changed.
