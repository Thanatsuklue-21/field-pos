# FIELD — Authoritative Data & Cross-Device Handoff (2026-11-01)

> Read this before starting a new Codex/ChatGPT task from any PC, phone or tablet. An AI memory summary is **not** the source of truth. No claim of ChatGPT memory/chat 100% synchronization.

## System boundaries
1. **POS code & operations:** `Thanatsuklue-21/field-pos`, exact current `origin/main`; do not reuse historical SHA. Identify exact PR/CI and Vercel production deployed SHA. On 2026-11-01 observed `379fbacd0cac574424d2c0442e31b28b84b000bd` (merged #490).
2. **R&D application code:** separate repo `Thanatsuklue-21/FieldRDDrink` (as of 2026-11-01 observed `21b53a77f7f9d8c013378faa9d8869e8404414ee`). This does **not** represent experiment data: Trials/Evidence are currently device-local browser storage; no cloud multi-device sync. [R&D Issue #8](https://github.com/Thanatsuklue-21/FieldRDDrink/issues/8) tracks hosted DB.
3. **Design intent:** FIELD Library document `FIELD_Preliminary_Contractor_Design_Set.pdf`, updated 2026-10-26: overall 3×6m, front left 2×2m bar, right 1×3m route, rear 3×3m **open-air**, insulated gable roof/ridge vent, roll-up PVC screens, no AC. **Preliminary, not construction/structural approval**; check for owner-approved newer revision.
4. **Business approvals and change decisions:** private editable Google Doc titled `FIELD_MASTER_CONTROL_LIVE — ข้อมูลอ้างอิงกลาง (PC / Phone / Tablet)`. Open through authorized account, read its latest revision and source links. Do not paste confidential backup/keys/customer data into public GitHub.
5. **ChatGPT Project:** use Project “คาเฟ่ Field” and open same chat if full transcript continuation is needed. Project Memory may reference relevant chats but is not deterministic sync; Google Drive link in project requires live reading, not background content mirroring.

## Strict evidence priority
- Owner's latest explicit approval **with its dated source**, followed by authoritative live system/source data; then older docs, then AI memory. Different domains have separate authorities—an architectural drawing cannot override a POS transaction and a code seed is not a tasting result.
- Contradictions become `CONFLICT` until resolved with dated evidence. Never resolve them by guessing or overwriting history.
- Every change record must include `domain | as-of time (Asia/Bangkok) | source URL or file | exact revision/commit | approval state | what supersedes what | outstanding verification`.
- Do not state “sync complete” until an actual PC→phone→tablet record/read/edit/offline replay test passes. A matching page load or code SHA is insufficient.
- Do not copy live R&D trial backups to public GitHub; use encrypted/private storage.

## Safeguards for POS handoff
- Read `README.md`, `docs/FIFO_STOCK_2026-10-31.md`, current `docs/INTEGRATION_AUDIT.md`, relevant current logic & tests.
- PR #490 (merged): server bootstrap/precheck + full-cart stock availability + atomic FIFO allocation and immutable exact purchase-cost snapshots. A precheck **does not reserve** stock; checkout must recheck in transactional write. Do not implement another parallel stock balance or change existing idempotent financial write authority.
- Historical handoffs including `docs/FIELD_MAIN_AUDIT.md` and earlier sections of `docs/FIELD_CONTINUATION_PROMPT.md` are dated snapshots, not current todo lists. Inspect actual code before considering any past P0 open.
- Exact production deployment, authenticated checkout, real payment provider, mobile hardware, cash drawer/accounting acceptance and real starting stock require separate evidence.

## R&D temporary safe exchange
Until a hosted database is implemented and deployed, source of actual tasting truth is **the original device's recorded Trial plus verified backup**, never a seed recipe or a remembered formula. Use explicit export on each device; any import must be non-destructive, immutable-ID aware and conflict rejecting (tracked by R&D PR #9). Do not run overwrite Restore unless the owner deliberately approves the target dataset and has an offline backup.

## Release / status labels
Use `CODE MERGED`, `CI PASSED`, `DEPLOYED`, `PRODUCTION READ VERIFIED`, `CROSS-DEVICE VERIFIED`, `OWNER ACCEPTED` separately. They are not interchangeable.

## Recurring readiness check
At the start and finish of every significant field update, read the current GitHub head and current private master register. If source cannot be read, return `NOT VERIFIED` instead of an invented success. Record the new Delta in the live register. Stop on conflict.

