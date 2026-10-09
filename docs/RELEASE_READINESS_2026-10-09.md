# FIELD POS — รายงานความพร้อม 9 ตุลาคม 2026

## สถานะที่ยืนยันแล้ว

โค้ด candidate ผ่านการตรวจอัตโนมัติและการทดสอบ Next production server บนฐานข้อมูลร้านจำลองในเครื่อง แต่ยังไม่ผ่าน gate สำหรับนำ PWA candidate นี้ไปใช้บน Production

- เริ่มตรวจจาก branch `feat/pwa-app-shell`, head `b4873720c23606a8129fc6c9e8654a3e96aeb55d` ที่ working tree สะอาดและ CI ผ่าน
- regression suite ล่าสุด: **489 ผ่าน / 0 ล้มเหลว** บน Node 24.19.0; Windows ใช้ test concurrency 1 สำหรับ native libSQL
- Next.js 16.3.8 production build และ strict TypeScript: **ผ่าน**
- `git diff --check`: **ผ่าน**; repo ไม่มี lint script/config จึงไม่ได้อ้างว่าผ่าน lint
- production shell/asset/identity ในเครื่อง 20 เส้นทาง: **ผ่าน**
- ไม่มี Turso: health, auth/session และ pos/bootstrap ตอบ controlled 503 พร้อม `no-store`
- มีฐานข้อมูล QA แยก: health/login/protected reads ของ candidate สุดท้าย **ผ่าน**
- PR #112 คง Draft; ผล CI ของ commit สุดท้ายบันทึกใน PR

## ผลตรวจตามส่วนงาน

| ส่วนงาน | หลักฐาน | ผลและขอบเขต |
|---|---|---|
| Login / session / CSRF / permissions | full regression + live-local login, protected reads, anonymous rejection, CSRF rejection | ผ่านในสภาพแวดล้อมทดสอบ |
| ขายเงินสด / เงินทอน / บิลซ้ำ | live-local checkout และ replay ผ่าน Next route จริง | ยอด 55 รับ 100 ทอน 45; replay อ้าง order เดิมและหักสต็อกครั้งเดียว |
| VOID / refund / stock / CRM | full regression; live-local VOID ก่อนผลิต | VOID คืนสต็อกตรงยอดเดิม; refund/CRM อยู่ใน regression coverage |
| สต็อก / หน่วย / purchase / cost / recipe | full regression + live-local stock/recipe/cost reads | ผ่าน; ข้อมูลสูตรและยอดจริงของร้านยังต้องเจ้าของยืนยัน |
| Queue / FIFO / add-on / split | full regression และ real file-backed libSQL integration | ผ่านใน test fixtures; pager จริงต้องทดสอบกับอุปกรณ์ |
| PromptPay / provider / webhook | contract, security, recovery และ replay regression | ผ่านแบบจำลอง; ไม่ได้ชำระเงินจริงหรือเปิด provider ใหม่ |
| Offline cash / atomic storage | commit/abort/quota/cold-module-relaunch/stock/duplicate tests | ผ่าน; บิลและ stock projection commit พร้อมกัน |
| Reconnect / outbox | retry/session-expiry/delete-failure/cache-preservation tests | ผ่าน; failure ไม่แสดง sync สำเร็จผิด และบิล retryable ยังอยู่ |
| รายงาน / expenses / cash shift / close day | full regression + live-local reads, shift open และ close day | ผ่าน; live-local cash variance = 0 และปิดวันแล้วขายเพิ่มถูกปฏิเสธ |
| Backup / audit / restore | full regression + live-local backup export read | ผ่านตามชุดทดสอบ; ไม่ restore ฐานข้อมูลจริง |
| Mobile / viewport / touch / recovery | automated/static regression | ผ่านตามชุดทดสอบ; ยังไม่ยืนยัน Android keyboard/viewport/process kill จริง |
| Install / standalone / staged update | manifest/SW/runtime tests และ local smoke | ผ่านตามชุดทดสอบ; ยังไม่ยืนยัน Home Screen installation บนเครื่องจริง |

## ปัญหาที่แก้ใน QA รอบนี้

1. Auth expiry / permission / throttling / timeout / server failure ระหว่าง sync ไม่ย้ายบิลไป review เหมือนธุรกรรมถูกปฏิเสธ บิลยัง pending และ retry ได้หลังแก้การเชื่อมต่อ/สิทธิ์
2. การ sync ที่ไม่ครบ รวมถึง Cloud commit แล้วลบ local outbox ไม่สำเร็จ ส่ง failure กลับให้ UI แทนจบแบบสำเร็จ
3. Sync ตรวจ session ที่ยืนยันแล้วภายใน helper และไม่ส่ง checkout จาก restricted Offline session หรือเมื่อไม่มี CSRF
4. API read สำเร็จและ online event ไม่กลบ `SYNCING` / `SYNC ERROR`; ต้องมี sync success จริงจึงล้างสถานะค้าง
5. การ refresh bootstrap จาก Cloud ไม่เขียนทับ local projected stock ขณะที่มี outbox unresolved อยู่ การตรวจและเขียนเกิดใน transaction เดียว
6. POS แสดงจำนวนบิลค้าง/ต้องตรวจบนมือถือด้วย พร้อมปุ่ม **ส่งบิลที่ค้าง** และข้อความเมื่อยังส่งไม่สำเร็จ; retry ถูกปิดเมื่อ offline/session ยังไม่ยืนยัน/กำลัง sync
7. DB-backed Next routes ตอบ structured 503 เมื่อไม่มี credentials หรือ initialization ใช้งานไม่ได้ โดยไม่เปิดเผยรายละเอียดภายใน

เพิ่ม 24 executable regression cases: sync 14, indicator 4, cache preservation 2, backend readiness 4. baseline sync ล้มเหลว 12/14 และ indicator 3/4 ก่อนแก้

Cache version `field-pwa-v12`; app version `8.0.0-pwa.11`. ไม่เปลี่ยน schema, credentials Production, deployment ignore policy หรือ business rules ที่เสร็จแล้ว

## หลักฐาน live-local และ Production

Live-local ใช้ file-backed libSQL แยกใน workspace, ข้อมูลเมนู/ลูกค้า/ผู้ใช้จำลอง และ Next production HTTP server จริง โดยไม่แตะข้อมูลร้าน:

- login/session; API reads ของ POS, queue/history, stock, expenses, customers, reports, readiness, recipes, costs, settings, close day และ backup
- เปิด cash shift, cash sale, replay, VOID คืน stock, fulfilled Offline sale, close day เงินสดคลาดเคลื่อน 0 และปฏิเสธ checkout หลังปิดวัน
- final candidate ตรวจซ้ำ health/login/protected reads, 20 shell/asset routes และ 3 missing-backend readiness routes
- ไม่มีการส่งข้อความ LINE, payment provider purchase, reset/restore หรือ write ไป Production

Vercel รายงาน production deployment ล่าสุด READY:

- SHA `cced39ceb23bd7f12c116b0d323e3df56345175f`, branch `main`
- deployment `dpl_9X47LfJEE2Xew3Uoa997hcz1ZPkB`
- read-only smoke ที่ `https://field-pos.vercel.app`: POS/Settings 200; health เป็น JSON 200 และ `ok:true`
- deployment URL และอีก alias มี Vercel protection; หน้า login ที่ตอบ 200 **ไม่ถูกนับเป็น app health ผ่าน**

Production smoke ยืนยันการตอบสนองและการเชื่อมต่อ DB ของ main รุ่นเดิมเท่านั้น ไม่ยืนยัน user/stock/menu/payment readiness ของร้าน และไม่ใช่หลักฐานว่า candidate PWA ล่าสุดถูก deploy แล้ว

## ก่อนเปิดใช้ candidate นี้หน้าร้าน

1. จัด Preview/UAT Turso แยกจาก Production และยืนยัน Backend/Turso READY
2. Freeze final SHA; เปิด Preview ตาม audited release gate เพียงรอบที่ตั้งใจ; ตรวจ SHA ตรงและ deployment READY
3. รัน exact-SHA smoke และตรวจ runtime errors; ทำ transaction UAT บนฐานข้อมูลแยก
4. ทดสอบ Android install → Home Screen → standalone; viewport, keyboard, offline process kill/relaunch, pending recovery, reconnect และ safe update
5. หลัง gate ผ่านจึง merge/deploy; ตรวจ merged SHA บน Production และ post-deploy smoke ก่อนประกาศ candidate พร้อมใช้งานจริง

ก่อนรับเงินจริงให้เจ้าของตรวจ Settings → SYSTEM READINESS: cash พร้อม, วันธุรกิจเปิด, menu/price/recipe/stock/สิทธิ์ถูกต้อง และเงินเปิดลิ้นชักตรงยอดจริง เปิด QR เฉพาะเมื่อ provider และ callback ผ่านการชำระทดสอบจริง

หากมีบิล Offline ค้าง ให้เชื่อมต่อและยืนยัน session แล้วกด **ส่งบิลที่ค้าง**; หากมีบิลต้องตรวจให้เจ้าของตรวจรายการก่อน ห้ามล้าง browser storage เพื่อแก้ปัญหา เพราะบิลที่ยังไม่ sync เก็บอยู่ในเครื่อง

## ตรวจ release checker เพิ่มเติม

รอบต่อจาก head `82c3ccb`: แก้ checker ที่ล็อก SW v6 ให้ตรวจรุ่นจาก candidate จริง, บังคับ full SHA, ตรวจไอคอน PNG/ขนาดและ HTML shell, ปฏิเสธ login/external redirects และกำหนด timeout. Workflow ตรวจ checkout HEAD ตรง SHA ก่อนเรียก Preview. เพิ่ม Next headers ให้ SW/manifest ใช้นโยบาย cache เดียวกับ Vercel เมื่อรันแอปโดยตรง

ผลล่าสุด: **505 tests ผ่าน / 0 ล้มเหลว**, build/TypeScript และ diff check ผ่าน. Real read-only smoke ผ่านกับ Next production server และฐานข้อมูล QA แยกในเครื่อง; SHA ใน local server เป็นค่าที่ป้อนผ่าน environment เพื่อทดสอบ checker ไม่ใช่หลักฐาน remote Preview. เวอร์ชัน PWA ยังคง v12 / `8.0.0-pwa.11` เพราะรอบนี้แก้เครื่องมือตรวจและ header โดยไม่เปลี่ยน shell หรือธุรกรรม

สถานะสุดท้าย: **code candidate ผ่าน QA ที่ทำได้ใน session นี้; rollout และการยอมรับบนอุปกรณ์จริงยังรอ gate ข้างต้น**
