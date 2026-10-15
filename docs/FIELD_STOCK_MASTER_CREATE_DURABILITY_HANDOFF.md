# FIELD stock master create durability handoff

Baseline: `4376c2f7320f6649fcf2253b2a93da7596e4c82f`.

## Evidence

Creating a new Stock Ingredient Master used a direct POST without durable request identity. The server generated a fresh random ingredient ID on every call. If the first transaction committed but the response was lost, an operator retry could create a second master for the same real-world ingredient and later split stock/recipe references across different IDs.

## Change

- Reuse the existing Stock recovery channel with a new `ingredientCreate` operation.
- Persist the exact create intent before network send.
- Bind the durable server request to actor + normalized name/unit/safety stock/cost kind/waste margin through `field_pos_requests`.
- Replay the original created ingredient after a lost response instead of generating a second ID.
- Require exact ACK before clearing local recovery.
- Keep the create intent visible to Close Day device preflight.
- Preserve supported syrup/concentrate waste margin on creation.
- Existing ingredient PATCH editing remains value-idempotent and is not rewritten in this change.

## Regression contract

Real file-backed libSQL tests must prove one ingredient, one audit row and one durable request row after replay; changed payload or actor reuse must conflict; missing request identity must reject.

No schema migration, payment, checkout, queue, purchase or recipe semantics are changed.
