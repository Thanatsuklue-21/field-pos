# FIELD Product Master create durability handoff

Baseline: `9696dd9b22b0411abd568aadb8ae9d6829e8c4ec`.

## Evidence

New Product Master creation used a direct POST that generated a fresh random menu ID every call. If the server committed and the response was lost, retrying could create a second Draft menu. A selected menu image was then uploaded in a second request, so product creation could also succeed while the image write was lost.

## Change

- Persist the exact new-product intent before network send.
- Bind durable replay to actor + name/category/prep-base/price + compressed image.
- Create the Draft Product and optional menu-image row in one database transaction.
- Replay the original Product ID and image URL after an ambiguous/lost response.
- Require exact ACK before clearing local recovery and block another new Product while the old outcome is unknown.
- Existing Product edit and image-update flows remain unchanged.

## Regression contract

Real file-backed libSQL tests prove replay produces one Product, one image row, one audit row and one durable request row. Changed payload/actor reuse conflicts. Invalid/missing request identity and invalid image fail before any product write.

No schema migration, checkout, payment, queue, recipe or existing-product semantics are changed.
