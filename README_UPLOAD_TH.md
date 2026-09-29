# FIELD POS v4.6 — Upload / Deploy

## ไฟล์หลัก
- `public/index.html` = FIELD POS v4.6 Latest Field Sync
- `api/`, `lib/`, `scripts/`, `vercel.json`, `package.json` = โครง server / Turso เดิมที่คงไว้

## อัปโหลดผ่าน GitHub
1. สำรอง repo `field-pos` ปัจจุบันก่อน
2. อัปโหลดโฟลเดอร์ทั้งหมดนี้ไปที่ root ของ repo เดิม
3. ให้ `public/index.html` แทนไฟล์หน้า POS เดิม
4. ห้ามลบ Environment Variables เดิมใน Vercel
5. Commit ไป branch `main`
6. Vercel จะสร้าง deployment ใหม่อัตโนมัติ

## หลัง Deploy ให้ทดสอบ
- รับออเดอร์ / Cart / ชำระเงิน
- Queue FIFO / ทำ / QC / ส่ง
- Stock deduction / safety stock
- Report / expenses / CRM
- Menu > FIELD Menu Control Center
- Recipe Builder / Custom Menu / Import Master
- FIELD Orange = Sunquick 25g + น้ำ 145g
- Pure Matcha = ไม่หวานเท่านั้น
- Signature = 100% / 50% / 0%
- Online sync / Turso ตาม Environment Variables เดิม

## Rollback
ใช้ deployment ก่อนหน้าใน Vercel หรือไฟล์ v4.5/v4.4 backup
