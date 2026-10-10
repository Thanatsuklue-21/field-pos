# ตรวจ Flow และจำลองขาย 10 แก้ว — 9 ตุลาคม 2026

## ขอบเขตที่ตรวจจริง

เริ่มจาก clean branch `feat/pwa-app-shell` head `6c9cb5b` ที่ตรงกับ PR #112. ใช้ฐานข้อมูล file-backed libSQL ใหม่แยกจาก Production, เมนู/สูตร/ผู้ใช้จำลอง และตรวจสองทาง: authenticated backend route integration และ Next production HTTP server จริง. HTTP run รวม 77 requests. ทดสอบ frontend Reports ด้วยการ render component จริงและข้อมูลทดสอบ; ไม่ใช่หลักฐาน Android/browser หลังล็อกอิน

Full regression: **536 ผ่าน / 0 ล้มเหลว**, build/TypeScript ผ่าน. กรณีใหม่ 10 tests ครอบคลุมการขาย 10 แก้ว, daily finance, payment split, independent cash count, stock export, CSV/date และ frontend loading/summary

## สมมุติฐานร้านทดสอบ

- ขาย QA Matcha Latte 10 บิล บิลละ 1 แก้ว ราคา 55 บาท; เงินสดทุกบิล รับ 100 บาท ทอน 45 บาท
- สูตรต่อแก้ว: matcha 5 g @ 2 บาท/g + milk 110 ml @ 0.06 บาท/ml + cup 1 ใบ @ 3 บาท = **ต้นทุน 19.60 บาท/แก้ว**
- เงินทอนตั้งต้น 500 บาท; เติมเงินทอน 100 บาท; นำเงินไปเก็บ 200 บาท
- รายจ่ายจำลอง: ทำความสะอาด 50 บาทจ่ายจากลิ้นชัก และค่าสาธารณูปโภค 30 บาทจ่ายผ่านธนาคาร
- ไม่ซื้อสต็อกเพิ่ม, ไม่ให้ส่วนลด/แต้ม, ไม่ VOID/refund ในชุด 10 แก้วนี้. VOID/refund และช่องทางจ่ายอื่นมี regression แยก ไม่ใช่การชำระเงินจริง

## ผลยอดขายและกำไร

| รายการ | คาดหวัง | ผลจริงจาก API/CSV |
|---|---:|---:|
| บิล / แก้ว | 10 / 10 | 10 / 10 |
| เงินรับจากลูกค้าก่อนทอน | 1,000 | 1,000 |
| เงินทอนรวม | 450 | 450 |
| ยอดขายสุทธิ | 550 | 550 |
| COGS ที่ใช้ขาย | 196 | 196 |
| กำไรขั้นต้น | 354 | 354 |
| รายจ่ายดำเนินงาน | 80 | 80 |
| ซื้อสต็อกเพิ่ม | 0 | 0 |
| กำไรหลังรายจ่ายดำเนินงาน | 274 | 274 |
| เงินสดคาดหวัง / นับจริง | 900 / 900 | 900 / 900 |
| เงินสดคลาดเคลื่อน | 0 | 0 |

ยอดในตารางแสดงเงินที่ความละเอียดสองทศนิยม; COGS ภายในเป็น floating-point โดย assertions ใช้ tolerance ต่ำกว่า 0.00000001 บาท

เงินสด = 500 ตั้งต้น + 550 ยอดขายเงินสด + 100 เติมเข้า − 50 รายจ่ายจากลิ้นชัก − 200 นำออก = **900 บาท**. รายจ่ายผ่านธนาคาร 30 บาทลดกำไร แต่ไม่หักเงินในลิ้นชัก. เงินตั้งต้น/เติมเข้า/นำออกไม่ใช่ยอดขายหรือรายจ่ายดำเนินงาน

## ผลสต็อก

| วัตถุดิบ | เริ่มต้น | ใช้ขาย 10 แก้ว | คงเหลือจริง |
|---|---:|---:|---:|
| Matcha (g) | 1,000 | 50 | 950 |
| Milk (ml) | 30,000 | 1,100 | 28,900 |
| Cup (ใบ) | 500 | 10 | 490 |

มูลค่าสต็อกตามต้นทุนจำลองลดจาก 5,300 เป็น **5,104 บาท**, ลด 196 บาทตรง COGS. มี stock SALE ledger 30 แถว = 10 บิล × 3 วัตถุดิบ. ส่ง checkout request เดิมซ้ำทุกบิลแล้วไม่สร้างยอดขาย/บิล/การหักสต็อกเพิ่ม

## Flow ที่ตรวจ

| ขั้นตอน | หลักฐานและผล |
|---|---|
| Login / session / permissions | Next HTTP login/session จริง; anonymous bootstrap ถูกปฏิเสธ; full regression ตรวจ CSRF/สิทธิ์ |
| เลือกเมนู / ขาย / เงินทอน | authenticated checkout ใช้สูตรและราคาจาก server; receipt 55/100/45 ตรงทุกบิล |
| บิลซ้ำ / ความไม่แน่นอน | replay ทั้ง 10 request keys กลับ order เดิม; offline acknowledgement/storage regressions ผ่าน |
| เตรียม / call / ส่งมอบ | select → complete item → call → return ผ่านทุกบิล; active queue เหลือ 0 |
| รายจ่าย / เงินเข้าออก | cash expense และ bank expense แยก; movements ไม่กลายเป็นยอดขาย |
| ปิดวัน | masked drawer result ก่อน close; นับ 900 แล้ว variance 0; ขายหลังปิดวันถูกปฏิเสธ 409 |
| Reports frontend | วันนี้แยกจากยอดสะสม, แสดงค่าใช้จ่าย/COGS/กำไร; โหลดค้างไม่แสดงยอดศูนย์ปลอม; error มี retry |
| รายงาน / export | summary, close และ CSV ตรงกัน; อ่าน CSV กลับด้วย parser อิสระได้ 10 บิล/10 แก้ว/550/80/variance 0 |
| สต็อกศูนย์/ติดลบ | test แยกยืนยัน CSV แสดงยอดจริงและ reconciliation flag; ไม่ซ่อนรายการหรือคิด asset value ติดลบ |

## สิ่งที่พัฒนา

1. เพิ่ม daily summary ที่แยกวันนี้/วันอื่น, COGS, ค่าใช้จ่ายดำเนินงาน, ซื้อสต็อก, กำไร และผลตรวจเงินสดหลังปิดวัน
2. เพิ่ม CSV สรุปวันนี้และรายละเอียดเมนูรายบิล. Line gross ในรายการเมนูเป็นราคาก่อนส่วนลด; ยอดขายสุทธิหลังส่วนลดให้อ่าน Sales CSV เพื่อไม่รวมรายรับผิด
3. Stock CSV แสดง zero/negative balances และ `reconciliationRequired` ขณะที่ inventory valuation ยังคงนโยบายเดิม
4. ชื่อไฟล์ใช้วันที่ธุรกิจ Asia/Bangkok จาก server; CSV รองรับ UTF-8 BOM, quotes, commas และ CR/LF
5. Reports แสดงสถานะโหลด/ข้อผิดพลาดและแยกชื่อกำไรสะสมจากกำไรวันนี้

## รายงานออกเป็นอะไร

แอปมีปุ่มดาวน์โหลด **CSV (.csv)** เป็นตาราง header/แถว/คอลัมน์ เปิดใน Excel หรือ Google Sheets ได้. ไม่ได้เพิ่ม .xlsx หรือ PDF ในรอบนี้. ไฟล์ CSV นี้ไม่ใช่ใบกำกับภาษี

| ไฟล์ตัวอย่างที่ออกจริง | รูปแบบ / ขอบเขต |
|---|---|
| `FIELD_dailySummary_2026-10-09.csv` | 1 แถววันนี้: บิล/แก้ว/รายรับ/COGS/รายจ่าย/กำไร/ช่องทางรับ/ผลปิดวัน |
| `FIELD_sales_2026-10-09.csv` | 10 แถวรายบิล: วันที่, billNo, status, gross/discount/net, COGS, ช่องทางเงิน, จำนวนแก้ว |
| `FIELD_saleItems_2026-10-09.csv` | 10 แถวรายการเมนู: วันที่/บิล/เมนู/variant/qty/unitPrice/lineGross/unitCost/lineCogs |
| `FIELD_expenses_2026-10-09.csv` | 2 แถว: วันที่/หมวด/รายละเอียด/จำนวนเงิน/วิธีจ่าย/แหล่งรายการ |
| `FIELD_stock_2026-10-09.csv` | 3 แถว stock ปัจจุบัน: ingredient/name/qty/unit/unitCost/value/costStatus/reconciliationRequired |
| `FIELD_cashMovements_2026-10-09.csv` | 2 แถวเติมเข้า/นำออก: วันที่/เวลา/type/amount/reason/shift |

ชื่อไฟล์คือวัน export ตามเวลาไทย. Daily Summary เป็นวันนี้; Sales/Items/Expenses/Cash Movements เป็นประวัติทั้งหมด และ Stock เป็น snapshot ปัจจุบัน. ฐาน QA มีข้อมูลวันเดียวจึงออกเป็นรายการวันนี้ทั้งหมด แต่บนร้านที่มีประวัติหลายวันต้องใช้คอลัมน์ date/status เพื่อเลือกช่วงและแยก paid/void/refunded

## ข้อจำกัดและก่อนใช้หน้าร้าน

ราคา/สูตร/ต้นทุนข้างต้นเป็นสมมุติ ไม่ใช่ผลขายหรือสต็อกจริงของร้าน. ไม่มีการเขียน Production, provider charge, LINE message, merge หรือ deploy. PWA v15 / app `8.0.0-pwa.14`

ยังรอ isolated HTTPS Preview/UAT database, exact-head deployment และ Android install/keyboard/offline recovery/UI acceptance. Full suite ผ่านไม่ใช่การยืนยันทุกอุปกรณ์หรือรายงานทางบัญชีของร้านจริง
