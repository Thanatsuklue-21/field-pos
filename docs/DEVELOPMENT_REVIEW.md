# FIELD development review

Reviewed from main commit `3fd14b41470dff5294d8dcf37bcbd9fce9053656`.

## Scope and evidence

The repository contains POS, queue, orders, products, recipes, stock, costs,
expenses, customers, close day, settlements, reports, dashboard, control,
backup, users, audit and settings routes. This pass runs the existing repository
suite and production build; it is not a claim of manual acceptance of every route.
No production database, payment provider or authenticated production session was used.

## Shared client fixes

All application sections use `lib/api-client.ts`. Request headers now preserve
all supported Fetch header forms, including Headers objects and tuple arrays,
so CSRF and explicit content types are retained. Caller-cancelable reads are
isolated from shared reads; ordinary concurrent reads still coalesce. Writes
remain single-attempt. Behavioral tests exercise headers and concurrent cancellation.

The GET timeout now covers JSON body consumption as well as receiving headers.
Caller cancellation retains its original abort reason without changing network
status or returning cached bootstrap data. If IndexedDB is unavailable during
network recovery, the client still reports the original network failure.
Behavioral tests cover stalled response bodies, cancellation with cache present,
and storage failure during fallback.

## Next development priorities

- POS / orders / queue: device acceptance of checkout, grouped preparation,
  FIFO, refunds and ambiguous-payment recovery.
- Products / recipes / stock / costs: verify approved live masters and units;
  exercise purchases, reversals and stock reconciliation on an isolated database.
- Expenses / close / settlements / reports / dashboard / control: reconcile
  shared business dates, refunds, drawer movements and closed-day restrictions.
- Customers / users / audit / settings: authenticated permission and session
  acceptance across staff and owner roles.
- Backup: restore an exported backup into a separate database and compare ledgers.
- Integrations: independently verify Beam/Opn, LINE and printer/pager behavior.
- Performance: measure mobile interaction and loading on the actual production
  URL before claiming a speed improvement. A usable share URL is still required.

Preserve history and backward compatibility. Keep database migrations additive.
Do not infer production readiness from a passing source test or page response.
