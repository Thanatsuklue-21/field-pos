# Current core integration audit

The former snapshot-only audit is superseded by the current `app/` frontend and `lib/pos-api.mjs`. Checkout, split payment, queue, void/refund, expenses, close day and stock operations now use authenticated server APIs and write transactions. Legacy standalone HTML remains in the repository and must not be confused with the current app.

## Core hardening

- Durable POS request table with actor/input hashes; legacy last-100 replay compatibility.
- Strict integer cart and split allocations; reject duplicate split indexes, missing/negative recipes and non-finite price/cash/stock input.
- Cancelled/void/refunded orders excluded from checkout add-ons and queue changes.
- All customer-call paths, including legacy per-cup finish, enforce FIFO.
- Grouped completion uses selected menu and expected progress to reject stale concurrent taps.
- Queue polls every five seconds while visible and avoids replacing newer revisions with old responses.
- Close day rejects blank cash counts; closed-day expenses and purchase expense writes are blocked.
- Full backup v2 includes durable request keys, retains v1 compatibility and exports one consistent database snapshot.
- Lock acquisition retries only explicit SQLITE_BUSY errors. Commits are never blindly retried.
- Real libSQL integration tests supplement fake database and static UI tests.

## Remaining operating checks

Confirm live menu, prices, recipes, inventory and provider settings through owner access. Complete Android/tablet checkout and queue acceptance, payment provider sandbox/live verification and backup recovery on an isolated database. Do not change recipe masters based on historical notes without inspecting the current database and owner-approved tasting results.
