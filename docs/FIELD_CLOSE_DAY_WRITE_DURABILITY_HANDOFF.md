# FIELD Close Day write durability handoff

Baseline: `73a88d53a04fb17707a0547bca588ce16a2bdf61`.

## Evidence

Close Day had two critical non-idempotent writes without durable request identity.

- Review generated a new `close_review_...` record. A lost response could cause the operator to submit another review instead of recovering the committed one.
- Final Close generated `close_...`, consumed the review and closed the cash shift. A lost response followed by retry returned `day_already_closed` rather than the original committed close.
- Blind recount mismatch also writes an audit row. If that 409 response was lost, retry could duplicate the mismatch audit.

## Change

- One device-local recovery channel covers Review and final Close.
- Review/Close input is persisted before POST and replayed on reconnect/focus/visible resume.
- Server binds request identity to actor + explicit business date + exact cash/review inputs.
- Durable replay runs before day-closed, shift, review and accounting state validation.
- Successful Review/Close writes state, audit and request identity atomically.
- Blind recount mismatch stores its authoritative 409 outcome with the audit row so replay does not duplicate audit.
- Close Day device preflight now treats unresolved Review/Close intent as a blocker.
- UI locks count/final-close controls while the previous request is unresolved.

## Regression contract

Tests prove:
- exact Review replay returns one review and one audit,
- mismatch replay returns the same 409 and one mismatch audit,
- final Close replay returns the original close after review/shift were consumed,
- changed payload/actor reuse conflicts,
- both POSTs require request identity and explicit business date,
- device preflight detects pending Close Day writes.

No schema migration or checkout/payment/stock semantics are changed.
