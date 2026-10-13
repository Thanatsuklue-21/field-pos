# FIELD touch UX — ส่งต่อ

Baseline: `815d3c0def5ca490ac45ca885a72c44abfd20541` (PR #271), fresh branch `ux/field-touch-cart`.

## ปัญหาที่พบและแก้

- หน้าทวนรายการใน Payment ใช้ปุ่มจำนวน/ลบ 36px; ปรับเป็น 44px ทั้งบิลปกติและแยกบิล
- ปุ่มปิด Payment/Modifier เล็กและไม่มีชื่อ; เพิ่มพื้นที่แตะ 44px และชื่อภาษาไทย รวมปิด/ลบบิลพัก
- แถวจำนวนในบิลแยกพร้อมราคาแน่นบน 320px; ให้ wrap ตามพื้นที่จริง
- เพิ่มชื่อปุ่มเพิ่ม/ลด/ลบในตะกร้า desktop และชื่อช่องเงินรับ เพื่ออ่านผ่าน assistive technology และทดสอบการกดด้วยชื่อได้
- ขั้นตอนตรวจรายการ/รับเงินและสถานะรอ PromptPay ใช้ภาษาไทย
- Payment มีชื่อ dialog ผูกกับยอดจริง

คงสีทอง FIELD, hierarchy หน้าขายและ compact payment เดิม ไม่มี request/API/financial state change; stock-aware increment และ cash-underpayment guard เดิมทำงานต่อ

## Regression

`python scripts/qa-pos-touch.py --base-url http://localhost:3100 --output /tmp/field-touch-qa`

ใช้ production build, Chromium และ mock APIs (ไม่มี live financial writes). ตรวจ 320/360/390/412/430 + tablet portrait/landscape: ขนาดปุ่มจริง, เพิ่ม/ลดจำนวนกับยอด, split allocation, รับพอดี/เงินไม่ครบ, ปิดกลับเมนู และ horizontal overflow. ต้อง build เสร็จแล้ว start server ก่อนรัน ห้าม build ทับ server ที่กำลังทดสอบ

`npm ci` ผ่าน; full `npm test` ผ่าน 533/533; `npm run build` ผ่าน; `git diff --check` ผ่าน. Chromium browser regression ผ่าน 7/7 viewports; artifacts อยู่ `/workspace/field-touch-qa/results.json` และ screenshots. ไม่มี page errors หรือ financial POST ในชุดนี้.

ระหว่างทำงาน main มี PR #272 (`34af0ee`) เพิ่ม Purchase Edit/Cancel durability ในไฟล์ stock/backend ซึ่งไม่ทับ UI ที่เปลี่ยนรอบนี้; ต้องให้ PR CI ตรวจ merged result ก่อน merge.

## งานถัดไป

1. Fetch latest main; ตรวจ PR/CI และ implementation ก่อนแก้ต่อ
2. ทดสอบ Android/PWA จริงพร้อม keyboard เปิด, safe-area และ hardware tablet; Chromium viewport ไม่ทดแทน hardware acceptance
3. ให้พนักงานใหม่รับออเดอร์จริงเพื่อวัดเวลา/จำนวน tap ก่อนอ้างเรียนรู้ใน 1 นาที
4. ตรวจ Today Workspace quick expense/latest receipt โดย reuse durable API และ recovery เดิม
5. ตรวจ focus trap/keyboard navigation ของทุก modal ในงาน accessibility ถัดไป
6. Release ผ่าน existing marker gate และ smoke deployment SHA; merge ไม่ใช่ deploy
