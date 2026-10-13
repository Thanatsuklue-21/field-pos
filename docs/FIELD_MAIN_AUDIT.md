# FIELD POS — main audit และส่งต่อรอบ Anyone Can Use

## Latest checkpoint — 2026-10-13 shared client / offline persistence

- Exact baseline รอบนี้: `main 4844a0a34f5fc1e83744e30173b3db5965ad7c0b` หลัง merge PR #269; branch ใหม่ไม่ใช้ PR #255 เป็น baseline.
- PR #255 ยัง open/unmergeable บน base เก่า. Audit แบบ selective พบ 2 gap ที่ main ยังขาด: (1) GET timeout/cancellation/header handling ใน shared API client และ (2) IndexedDB readwrite transaction ที่ error/abort ถูก resolve เป็น success.
- Port เฉพาะ gap ดังกล่าว โดยรักษา current-main malformed/incomplete successful-ACK rejection, checkout exact ACK, Close Day strict offline read และ financial recovery controls.
- Offline cash put/patch/delete จะถือว่าสำเร็จเมื่อ transaction complete เท่านั้น; unavailable/failed persistence ไม่ถูกตีความว่าเก็บบิลแล้ว.
- Caller-owned AbortSignal ไม่เข้า shared GET coalescing, ไม่ fallback cache และไม่ emit offline; internal GET timeout ครอบ response body consumption.
- เพิ่ม regression tests สำหรับ Headers/tuple headers, cancellation isolation, stalled JSON body timeout, cache-storage failure, transaction abort และ synchronous quota failure.
- เพิ่มข้อความไทย `offline_storage_write_failed` เพื่อไม่ให้พนักงานเข้าใจผิดว่าบิล Offline ถูกยืนยันแล้ว.
- Validation สุดท้ายต้องอ้าง exact PR-head CI; session นี้ไม่อ้าง local npm test/build เพราะ container ไม่มี outbound GitHub clone.


## Latest checkpoint — 2026-10-13 cycle-count review durability

- Exact baseline: `main 6e05d6a98edb017b77972e9962a427829e6d5671` (PR #268 merged).
- PR #255 ยัง open/unmerged และ base เก่า; ห้ามถือว่า shared-client/offline patch อยู่บน main.
- PR #256 merge แล้ว. PR #266 ยัง draft/open และทำ Purchase Edit/Cancel durability; รอบนี้ไม่แก้ scope ซ้ำ.
- Evidence ใหม่บน main: Owner approve/reject ของ Cycle Count Proposal เรียก API ตรงจาก `app/stock/page.tsx` โดยไม่มี persisted request identity. ฝั่ง approve ยังมีกรณี `stale/expired` ที่ commit proposal status + audit แล้วตอบ 409 จึงห้ามตีความ 409 เหล่านี้ว่า no-op.
- Patch รอบนี้ใช้ stock recovery channel เดิม, เพิ่ม durable ledger binding `operation + actor + exact payload + proposalId`, exact ACK, replay หลัง lost response/reload/reconnect และ Close Day blocker สำหรับ unresolved approve/reject.
- ไม่มี schema migration, bypass endpoint, payment/checkout semantics หรือ stock authority ใหม่.
- Validation สุดท้ายต้องอ้าง exact PR head CI; local container ใน session นี้ clone GitHub ไม่ได้ จึงไม่อ้าง local npm test/build.


วันที่ตรวจ: 2026-10-13 UTC
Baseline: `origin/main` = `fe0688e7c43913ded21db5dab62ee8fc1fd14184`
Feature branch สร้างใหม่จาก exact baseline: `fix/field-safe-ack-handoff`
สถานะ branch/PR/CI ล่าสุดให้ตรวจจาก GitHub ก่อนเริ่มงานต่อเสมอ

## 1. Current Architecture

- Next.js 16 / React 19 / TypeScript; state ฝั่งหน้าขายใช้ Zustand และ cart local เพื่อให้แตะเมนูได้ทันที
- Next API route ส่งต่อเข้า `lib/api.mjs`; Vercel Functions และ Turso/libSQL เป็น backend หลัก
- เอกสารธุรกิจร่วมอยู่ใน `field_state` พร้อม revision และ transaction locking
- มี stock/purchase/cost ledgers, audit และ `field_pos_requests` สำหรับ durable idempotency; backup v2 รวม request ledger
- Origin/CSRF validation, HttpOnly Secure SameSite session cookie, permissions และ scrypt password hashing
- IndexedDB เป็น menu cache และ cash outbox; ไม่ใช่ source of truth ของยอดร่วม
- PromptPay ผ่าน Beam/Opn: server ตรวจ provider status ก่อนสร้างยอดขาย มี reservation/recovery; client ไม่ตัดสิน paid จาก QR
- Legacy `public/index.html` / `online*.js` ถูก quarantine ไป `/pos` ใน production ไม่ใช่ app หลัก
- `docs/ARCHITECTURE_V8.md` บน baseline ยังมีข้อความ device-local จาก phase แรก จึงต้องอ่านร่วมกับ README และ INTEGRATION_AUDIT; ห้ามใช้ข้อความเก่าเป็นเหตุผล rewrite

**ข้อสรุป:** ต่อยอด architecture เดิมได้ ไม่มี evidence สนับสนุนการย้ายไป FastAPI/PostgreSQL/Redis หรือ migration ใหญ่

## 2. Controls ที่เหนือกว่า basic POS แล้ว

- Checkout ตรวจราคา สูตร availability และ cash ที่ server; commit sale/stock/cost snapshot/loyalty/queue ร่วมกัน
- Durable replay ผูก operation, actor และ payload; ไม่พึ่ง cache 100 รายการเพียงอย่างเดียว
- Queue enforce FIFO ที่ server และตรวจ expected progress เพื่อป้องกัน stale taps; grouped preparation ภายใน order
- VOID/refund มี reversal/audit; cost-at-sale ถูกเก็บเป็น snapshot
- Hold Bill ไม่สร้าง sale ไม่ตัด stock; resume อ่าน master ปัจจุบันก่อน checkout
- Cash pending / PromptPay pending ใช้รายการเดิมเมื่อผลส่งกลับกำกวม
- Offline cash outbox sync ด้วย key เดิม; disabled PromptPay/split/loyalty/add-on offline; fulfilled offline order ไม่กลับเข้า live FIFO
- Expense ตรวจเงินในลิ้นชักและ business day; Closed Day มี accounting reconciliation, pending-payment/order/stock-approval guards และ blind cash recount
- Today Workspace มีใน POS แล้ว: queue/orders/stock/readiness แบบ drawer; payment mutation บล็อกการเปิด hub
- Revision polling, compact responses, GET coalescing และ batched schema startup ลดการโหลดซ้ำ

## 3. UX friction ที่ยังเหลือบน baseline

- Today Workspace เป็น read panel หลายงานยังต้องไปหน้าเต็ม เช่น expense, receipt, bar action และ close corrections
- Expense เดิมปิด/reload ฟอร์มแล้วสูญเสีย request key ที่อยู่ใน React state; ข้อความ network เป็น technical code
- ระหว่าง pending expense การแสดง before/after drawer balance อาจทำให้ดูเหมือนต้องหักเงินรอบใหม่
- งานร้านหลายหน้าและข้อความใน Close Day ยังมีศัพท์ technical; primary menu/touch flow มี controls เดิมจำนวนมากแล้ว ไม่ควรออกแบบใหม่ทั้งหน้า
- ยังไม่มี evidence จาก new operator ว่าเรียนรู้ได้ภายใน 1 นาที
- ไม่พบ active app manifest/service worker/install registration ใน `app/`, `components/`, `lib/`, `public/` ที่ตรวจ; legacy inline manifest ไม่ยืนยัน PWA standalone ของ app ใหม่
- Mobile regression รอบนี้ทดสอบ Expense ใน Chromium เท่านั้น ไม่ใช่ Android hardware, keyboard จริง หรือทุกหน้า POS

## 4. Critical risks และสิ่งที่แก้ใน PR นี้

### P0 — Expense identity/ACK

**Evidence:** `app/expenses/page.tsx` baseline เก็บ key ใน useState; openCreate สร้าง key ใหม่ และ success ล้างฟอร์มทันทีหลัง await api ไม่มี exact ACK validation

**แก้:** `lib/expense-recovery.ts` persist actor/date/payload/key ก่อนส่ง; reload/close เก็บรายการเดิม; unknown result ล็อกข้อมูลและไม่เปิดยอดใหม่; reconnect ส่ง exact request เดิม; ACK ต้องตรง key/actor/date/amount/category/description/paymentMethod จึงล้าง recovery

storage ใช้ไม่ได้หรือข้อมูลค้างอ่านไม่ได้ = หยุดส่ง; explicit pre-commit validation rejection จึงปล่อยแก้ไขได้; conflict/500/unknown ยังคง identity

### P0 — HTTP success แต่ body อ่านไม่ได้/ไม่ครบ

**Evidence:** baseline `lib/api-client.ts` ใช้ `res.json().catch(()=>({}))`; cash checkout และ offline sync บาง flow เดินต่อเป็น success จาก HTTP status

**แก้:** successful response ที่ unreadable/null/scalar หรือ empty/array write ACK เป็น status 0 เพื่อรักษา recovery; checkout ต้องมี authoritative sale/order/queue/totals ที่ครบ ไม่ล้าง cash recovery จาก `{ok:true}` เพียงอย่างเดียว ไม่มี blind retry

### P0 — Expense replay หลัง close/delete

**Evidence:** baseline expense replay อยู่หลัง day_closed และอาศัย record ใน doc.expenses; ลบ record แล้ว replay key เดิมอาจสร้างยอดอีกครั้ง

**แก้:** reuse durable request ledger เดิมใน transaction เดิม; actor/input/operation hash; replay ก่อน day guard; backfill legacy matching expense เมื่อ recover; new key ของวันที่ปิดยัง reject; deleted expense replay เป็น ACK ของ commit เดิม ไม่สร้าง expense หรือ audit-create ซ้ำ

### P1 — Operator recovery guidance

**แก้:** pending banner, “ตรวจรายการค้าง/ตรวจผลรายการเดิม”, locked fields, error ไทยใน modal, ปิดหน้าต่างโดยเก็บรายการไว้, หยุด simulation การหักเงินซ้ำเมื่อ pending และ modal scrollable สูงไม่เกิน 90dvh

## 5. Validation และข้อจำกัด

- `npm ci --no-audit --no-fund` ผ่านจาก lockfile ของ main
- Full suite: **435 tests ผ่าน**, ไม่มี fail/skip/cancel
- `npm run build` ผ่าน compilation/TypeScript/route generation
- `git diff --check` ผ่านก่อน commit
- New behavioral tests: reload/lost response, inexact ACK, storage denial/corruption, actor isolation, validation-vs-ambiguity; API body loss/empty/incomplete checkout ACK
- Real file-backed libSQL: expense concurrency, cross-actor conflict, close then replay, delete/cache-eviction then replay; assert financial/audit/state effects ไม่ซ้ำ
- Chromium production-build regression: 320, 360, 390, 412, 430px; tablet 768×1024 และ 1024×768; lost response → locked form → close/reload → exact replay → one commit; offline preflight → reconnect → exact replay; ไม่มี page error หรือ document overflow ใน scenarios ที่ทดสอบ
- Reproduce browser test: ติดตั้ง Python Playwright และ Chromium แล้ว run `python scripts/qa-expense-recovery.py --base-url http://localhost:3000 --browser /usr/bin/chromium` หลัง build/start; API ถูก mock ไม่มี live financial writes
- Production **baseline** smoke ที่ `https://field-pos.vercel.app`: health/pos/expenses/close = 200; unauthenticated bootstrap/expenses = 401; health reports exact `fe0688e...`, main/production/Turso
- Baseline CI run `38352649301` และ Production Smoke `38352685591` = success; latest merged PR #253 release main, ก่อนหน้ามี #251 expense guards/#252 close corrections/#249 owner recovery
- Production smoke ข้างต้นไม่ใช่ authenticated checkout/provider/device acceptance ของ patch ใหม่ และไม่ใช่การวัด INP/FPS

## 6. Improvement ถัดไป P0–P3

| Priority | งานถัดไป | Evidence/acceptance |
| --- | --- | --- |
| P0 | ตรวจสถานะ PR #255 ก่อนทำ shared-client/offline write work ซ้ำ | PR เดิมยัง open ตอนเริ่ม audit; มี API headers/cancellation/body timeout และ IndexedDB failed-write acknowledgement; review/rebase กับ main ใหม่ก่อนรวม |
| P0 | Close Day ตรวจ recovery ฝั่ง device และ unresolved offline receipts | baseline close page ไม่อ่าน local cash outbox; server ไม่เห็น unsynced local bill; เพิ่ม conservative device preflight + recovery action โดยไม่ลด server reconciliation; acceptance ห้าม close ผ่านทั้งที่ local bill ค้าง |
| P0 | Audit cash drawer movement, delete, stock adjustment และ recovery identity | ตรวจ Prepare→Persist→Send→Commit→Exact ACK→Clear ทีละ endpoint; ห้ามสรุปว่าทุก write ปลอดภัยจาก Expense tests |
| P1 | ทำ known-error guidance ร่วมสำหรับ critical flows | ภาษาไทยบอกเหตุการณ์/สิ่งที่ยังไม่ทราบ/ขั้นตอนถัดไป; ห้ามแสดง technical codes; อย่าบอก “เงินปลอดภัยแล้ว” ก่อน server evidence |
| P1 | จัด clear owner/staff corrective actions | Recovery อยู่บนบริบทเดิม; staff ไม่ bypass owner confirmation |
| P2 | วัด menu tap/render/bootstrap และ new-operator learning | production code + representative menu, Android/tablet, cold/warm; อย่าเปลี่ยน write semantics เพื่อ latency |
| P3 | Quick Expense ใน Today Workspace โดย reuse recovery module + durable Expense API | permission/actor/date/ACK/reconnect guards เดิม, แค่ contextual drawer ไม่มี API ใหม่; อย่าซ้อน payment modal |
| P3 | Receipt/latest bill + pending payments/close blockers ใน hub | progressive disclosure, contextual corrective actions; งาน admin ลึกยังอยู่หน้าเต็ม |

P4–P6 ต่อจากนั้น: Android/PWA/keyboard acceptance, order-local compatible batching, guided Close Day fixes. ห้ามเพิ่ม blender/VAT/enterprise tables ที่ master/use case ไม่มี

## 7. Release และรับงานต่อ

- เปิด PR จาก branch ใหม่และตรวจ CI ของ exact head ก่อน merge ตาม workflow ที่ผู้ใช้อนุญาต; ไม่ bypass required review/protection
- หลัง merge ต้อง fetch และอ่าน exact origin/main ใหม่; ไม่ใช้ branch นี้หรือ PR #255 เป็น baseline รอบถัดไป
- เคารพ release gate ใน `.vercel-release`/`vercel.json`; merge ไม่ใช่หลักฐานว่า deployment ใหม่เกิดแล้ว
- รายงาน SHA ที่ทดสอบ/merge/deploy แยกกัน; production health ต้องตรง release ที่ตั้งใจ แล้วทำ smoke ใหม่
- ยังห้ามประกาศ “สมบูรณ์แบบ/พร้อมระดับสูงครบทุกด้าน”: ยังมี P0 review items, device/keyboard/PWA, live provider และ operator learning acceptance
- ดู prompt พร้อมใช้ใน `docs/FIELD_CONTINUATION_PROMPT.md`
