# FIELD Customer Master create durability handoff

Baseline: `668326a4386eb52f16334bec70ce77082d3f659d` (latest main after release-marker updates).

## Evidence

Customer creation generated a fresh random Customer ID for each POST. With an empty phone number, a committed request followed by a lost response could be retried into a duplicate customer. With a phone number, the retry hit the phone-duplicate guard but still could not tell the operator whether the first request had actually succeeded or which Customer ID was created.

## Change

- Persist exact customer-create intent before network send.
- Bind durable replay to actor + normalized name/phone/LINE ID.
- Replay before duplicate-phone validation so an exact retry returns the original Customer ID.
- Require exact ACK before clearing local recovery.
- Block another new customer while the previous create outcome is unknown.
- Leave loyalty point recovery and customer updates unchanged.

## Regression contract

Real file-backed libSQL proves an exact replay leaves one customer, one audit row and one durable request row, including customers without phone numbers. Changed payload/actor reuse conflicts; duplicate phone with a new request remains an authoritative rejection.

No schema migration or sale/payment/loyalty semantics are changed.
