# Prompt ส่งต่อให้ FIELD

> Current checkpoint (2026-10-13): main baseline สำหรับรอบล่าสุดคือ `6e05d6a98edb017b77972e9962a427829e6d5671`. Close Day device preflight/TOCTOU, cash drawer, expense delete, stock critical writes และ VOID/refund durability ถูก merge บน main แล้วตาม PR หลัง #256. PR #266 ยัง draft/open สำหรับ Purchase Edit/Cancel. งาน P0 ที่รอบล่าสุดตรวจพบและกำลังแก้แยกคือ Cycle Count Proposal approve/reject durable recovery; ต้องตรวจสถานะ PR ล่าสุดก่อนทำซ้ำ.


คัดลอกข้อความด้านล่างเข้า task ใหม่ของ FIELD:

---

คุณรับช่วงพัฒนา FIELD POS ในบทบาท Full-Stack/POS Architect/UX/Reliability/QA/Release Engineer
Repository: https://github.com/Thanatsuklue-21/field-pos
เป้าหมาย: Anyone Can Use FIELD POS — ระบบคุม flow ป้องกัน human error และรักษาความถูกต้องของเงิน/stock

## เริ่มงานจาก main ล่าสุดเท่านั้น

1. ตรวจ working tree ห้ามทับงานค้างของคนอื่น; `git fetch origin main`
2. บันทึก exact SHA `git rev-parse origin/main`; อ่าน latest merged PR, CI และ production release identity
3. อ่าน README, INTEGRATION_AUDIT, FIELD_MAIN_AUDIT (ถ้ามีบน main), test suite และ business logic ที่จะเปลี่ยน
4. สร้าง feature branch ใหม่จาก exact origin/main; ห้ามแก้ main หรือใช้ branch/PR เก่าเป็น baseline
5. ตรวจสถานะ PR #255 และ PR ของ `fix/field-safe-ack-handoff` ก่อน เพื่อไม่ทำงานซ้ำ; ถ้ายังไม่ merged ห้ามถือว่าฟีเจอร์นั้นอยู่บน main

## สิ่งที่ต้องรักษา

Architecture หลักคือ Next.js/React/Vercel Functions/Turso-libSQL ไม่ rewrite ถ้าไม่มี measured evidence
Server authoritative checkout/payment/stock; durable idempotency ผูก operation/actor/payload; immutable cost/audit; safe stock reversal; FIFO; origin/CSRF/permissions; Close Day accounting guards; provider/payment reconciliation

Critical write ต้อง Prepare → Persist identity → Send → Authoritative Commit → Exact ACK → Clear Recovery
Unknown response ไม่ใช่ failed; ห้าม generate new key/เปลี่ยน payload/ล้าง recovery เมื่อผลยัง ambiguous; ห้าม blind retry financial mutations

## งานรอบที่ส่งต่อ

- Audit พบ Expense key เดิมอยู่ใน React state, replay ไม่รอด close/delete และ invalid JSON อาจดูเป็น ACK
- Patch `fix/field-safe-ack-handoff` เพิ่ม persisted Expense intent/exact ACK, durable request ledger เดิม, closed-day/deleted replay และ Thai operator guidance
- Tests/build/browser matrix ถูกบันทึกใน FIELD_MAIN_AUDIT; browser APIs เป็น mock, ไม่ใช่ authenticated production proof
- ตรวจสถานะจริงบน main ก่อนใช้ module `lib/expense-recovery.ts`

## ลำดับถัดไป

P0 ก่อน:
1. Review/integrate pending shared API/IndexedDB fixes ใน PR #255 ด้วย baseline ใหม่; ไม่ duplicate implementation
หาก PR #255 conflict ที่ api-client.ts ต้องรักษาทั้ง timeout/cancellation fixes และการ reject malformed/incomplete ACK ของ main ใหม่; ห้ามคืน res.json().catch(()=>({})) ให้ successful writes

2. ตรวจ Close Day กับ local cash outbox, pending cash/PromptPay/expense intents บนเครื่องนี้: baseline close page ยังไม่มี device-local preflight; server ไม่รู้ยอด offline ที่ยังไม่ sync อย่าปิดวันจากข้อมูลไม่ครบ
3. Audit recovery ของ cash drawer movement/delete/stock correction ทุกจุด; fix เฉพาะ evidence พร้อม test lost response/reload/reconnect/exact replay

P1: Thai errors + locked unresolved input + contextual recovery action; ห้าม technical codes หรือบอกเงิน/stock ปลอดภัยก่อนมี ACK; preserve owner permissions
P2: วัด menu tap/render/network request count/cold bootstrap จาก production code จริง และทดสอบผู้ใช้ใหม่ ~1 นาที
P3: routine Quick Expense, latest bill/receipt, queue/payment/close blockers ใน Today Workspace โดย reuse APIs และ recovery module เดิม ไม่เพิ่ม financial bypass endpoint

Primary UI = ขาย; secondary = drawer/bottom sheet งานร้าน; deep admin = หน้าเดิม
Touch ≥44px, menu unavailable กดไม่ได้, modifiers จาก master จริง; sweetness 100/50/0 ตามสูตร โดยเฉพาะ Pure Matcha; ห้ามเพิ่มปั่น/VAT/enterprise features ที่ไม่มี requirement
Queue batching เฉพาะ compatible drinks ภายใน order เดียว ไม่ข้าม FIFO; action feedback ชัดเจน

## QA/Release ในทุก improvement

- เพิ่ม regression ที่ตรวจ business behavior จริง ไม่แก้ test เพียงเพื่อ CI เขียว
- `npm ci`, `npm test`, `npm run build`, diff review ต้องผ่าน
- Coverage: cash/PromptPay, duplicate/lost response, offline/reconnect, stock, FIFO, expense, VOID/refund, Close Day; PWA/Android แยกจาก desktop Chromium
- Mobile widths 320/360/390/412/430 + tablet portrait/landscape; ตรวจ keyboard, bottom navigation, viewport, touch targets
- `scripts/qa-expense-recovery.py` ใช้ production build และ mock APIs สำหรับ Expense regression; ต้องมี Python Playwright/Chromium; ห้ามรัน build ทับ server ระหว่าง browser test
- เปิด PR, ตรวจ CI exact head, merge เมื่อ evidence ผ่านและ repository protection อนุญาต; ห้าม bypass approval checks
- Fetch/re-read main ใหม่ก่อน improvement ถัดไป
- Release ตาม existing gate; health SHA ต้องตรง deployment แล้ว smoke auth denial/page routes จาก production; live payment acceptance ใช้ sandbox/isolated DB ที่ได้รับอนุญาต ไม่สร้าง transaction บน productionเพื่อทดลอง
- ส่งต่อ issue/priority, exact tested SHA, validation results, blockers และ next steps ในเอกสาร

Definition of Done ไม่ใช่เพียง CI เขียว: ต้องไม่มี unresolved critical/high issue, transaction/reconnect/FIFO/close correctness, mobile blockers, production smoke และ operator acceptance
ถ้ายังมีรายการยังไม่ได้ตรวจ ต้องรายงานตรง ๆ ห้ามอ้างว่าระบบสมบูรณ์หรือใช้ง่ายภายใน 1 นาทีโดยไม่ได้ทดสอบ

เริ่ม audit exact main ล่าสุด รายงาน Architecture / strengths / friction / critical risks / P0–P3 แล้วแก้ P0/P1 ที่มีหลักฐานโดยไม่ถามยืนยันซ้ำในงานที่ได้รับอนุญาต

---
