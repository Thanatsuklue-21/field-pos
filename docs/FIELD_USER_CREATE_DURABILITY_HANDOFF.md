# FIELD Admin User Create durability handoff

Baseline: `448e280c1567208b2144869cb6591fd02e4a1a72`.

## Evidence

Admin User creation was a non-transactional two-step write: insert the account, then insert the audit row. A lost response after the account insert left the operator with `username_exists` on retry and no authoritative confirmation of the original account ID/configuration. Audit failure could also leave a user without its expected audit entry.

Persisting the full create payload in browser recovery was not acceptable because it contains a plaintext password.

## Change

- Client recovery persists only request key, username, role and normalized permissions. Password is never stored in localStorage.
- After reload, the pending request is restored and identity fields are locked; the admin must re-enter the same password to resume.
- Server binds durable identity to actor + username + role + permissions + a one-way digest of the submitted password.
- Account insert, audit row and durable request row commit in one database transaction.
- Exact replay returns the original account ID and configuration.
- Ordinary user PATCH/password-reset behavior is unchanged.

## Regression contract

Tests prove:
- browser recovery storage contains no password field/value,
- lost-response replay returns one account and one audit/request row,
- password/role/permissions/actor changes under the same request key conflict,
- an unrelated new request for an existing username remains `username_exists`,
- durable response/audit/request hash never contain plaintext password.

No schema migration or POS/payment/accounting semantics are changed.
