# FIELD customer points durability handoff

Baseline: `904a887fb8ae7a4f1496cb58ebad0f56320555aa` (latest `main` after PromptPay provider durability).

## New evidence

The Customers page adjusted loyalty points with a direct PATCH containing only `pointsDelta`. If the server committed and the response was lost, an operator retry could apply the delta a second time.

## Change

- Point adjustments now require a durable request key bound to actor, customer and exact delta.
- Server reuses `field_pos_requests` and returns exact acknowledgement fields.
- Client persists the intent before sending, replays the same request on reconnect/focus, and blocks new +/- actions while the old result is unknown.
- Authoritative pre-commit validation clears the local intent; transport/ACK ambiguity keeps it.
- Profile edits remain separate from the durable point-adjustment path.

## Validation contract

Tests cover lost-response replay, exact ACK, changed-payload/actor conflicts, required request identity, one audit row and one point effect in real file-backed libSQL.

This scope does not change checkout-earned/redeemed loyalty semantics and does not overlap the merged PromptPay or queue durability work.
