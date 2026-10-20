# FIELD POS 8.1 — รายงานความเร็ว ความเสถียร ความแม่นยำ และการใช้งาน

วันที่สรุป: 20 ตุลาคม 2026 (Asia/Bangkok)

## ระบบใช้งานได้ดีแล้วหรือยัง

**โค้ดรุ่น 8.1 ผ่านการทดสอบที่ระบุด้านล่าง และพร้อมนำไปทดสอบ UAT แบบควบคุม แต่ยังไม่ใช่หลักฐานว่าพร้อมรับเงินจริงทุกช่องทาง หรือว่าผู้ใช้ใหม่ทุกคนใช้ได้ทันที**

รุ่นนี้แก้ความเสี่ยงเพิ่มจากรอบก่อน โดยเฉพาะบิล offline กับสต็อกที่เคยบันทึกคนละจังหวะ, เงินสตางค์ที่หน้าจอเคยปัดหาย, คะแนนสะสมที่อาจขาด และกำไรที่เคยไม่หักค่าธรรมเนียมเดลิเวอรีครบ ไม่มีการเปลี่ยน Next.js/React/Vercel/Turso หรือเพิ่ม dependency ใหม่

Production และโค้ดที่ทดสอบเป็นคนละรุ่น ต้องตรวจ SHA ก่อนใช้ผลรายงาน:

| รายการ | สถานะที่ตรวจได้ |
| --- | --- |
| ฐาน main ล่าสุดที่ใช้ต่อยอด | `f1d0525badcd36f6a2917d52d30abac749610596` |
| Code SHA รุ่น 8.1 ที่ผ่านชุดทดสอบ | `7c424d28ef570ec5886259a0ae913b737d591c44` |
| PR รุ่น 8.1 | [#464](https://github.com/Thanatsuklue-21/field-pos/pull/464) |
| CI ของ code SHA ข้างต้น | [run 39358720713 — ผ่าน](https://github.com/Thanatsuklue-21/field-pos/actions/runs/39358720713) |
| Production ที่ตรวจ health จริง | `f1d0525badcd36f6a2917d52d30abac749610596` |
| Production deployment | `dpl_DLn5V9wowTbKuncrPFQJ2JWmHbGw` — READY |
| Production URL | https://field-pos.vercel.app |

ระหว่างทำงาน มีงานอีกชุด merge PR #453 และปรับ main เพิ่มแล้ว จึงสร้าง branch ใหม่ `feat/field-pos-v81-reliability-20261020` จาก exact main ข้างต้น แล้วย้ายเฉพาะงานที่ยังขาดมา รวม conflict โดยรักษาข้อความชำระเงิน, สีทองที่อ่านชัด, การแยกงานประจำวัน/หลังร้าน, parallel auth/bootstrap, queue summary แบบ linear และ guided password reset ของ main ไม่ force-push ทับ branch ของผู้อื่น

เอกสาร/ผลทดสอบอาจมี commit ตามหลัง code SHA โดยไม่มีการเปลี่ยนโปรแกรม ให้ตรวจ final PR head และ CI ที่หน้า PR ก่อน merge เสมอ รอบนี้ไม่ได้ merge หรือ deploy รุ่น 8.1 และไม่ได้เปลี่ยน release marker

## สิ่งที่แก้เพิ่มและหลักฐานก่อน/หลัง

| ประเด็น | ก่อนแก้ | หลังแก้และหลักฐาน |
| --- | --- | --- |
| Offline bill + stock | ออกใบยืนยันหลังเขียน outbox ก่อน แล้วค่อยเขียน stock cache แยก; หากเขียน cache ล้มเหลวอาจเปิดใหม่แล้วเห็น stock เก่า | เขียนสอง store ใน IndexedDB transaction เดียว; ผ่านกรณี cold module restart, cache quota failure/rollback, concurrent 4 บิลแต่ stock พอ 3, duplicate key, cache เก่า/หาย/สูตรผิด/ราคาผิด |
| Cloud refresh ขณะมีบิลค้าง | GET bootstrap สามารถเขียนทับ stock ที่เครื่องหักไปแล้ว | ตรวจ outbox ใน transaction เดียวกับ cache refresh; บิล unresolved บล็อกการเขียนทับ จนยืนยัน/ลบบิลสำเร็จ |
| Session หมดอายุ/รอส่งใหม่ | HTTP 401/403/408/425/429 อาจเปลี่ยนบิลเป็น needs_review | คง pending/body/key เดิม และส่งซ้ำได้หลัง session/เครือข่ายกลับมา; 5 regression แสดงปัญหาก่อนแก้และผ่านหลังแก้ |
| ยอดที่ผู้ขายเห็น | `.toFixed(0)` ปัดสตางค์ทิ้ง เช่น 55.25 แสดง 55 และทอน 44.85 แสดง 45 | shared formatter แสดง 55.25/44.85 และ comma grouping; whole-baht label เดิมยังใช้ได้ ทดสอบ actual browser ที่ 320/390/768 px |
| เงินใน browser/server | cart, GP, change และ preview บางจุดยังคูณ/ลบ float | ใช้ BigInt decimal sum/multiply ร่วมกัน; server ยังคงตรวจราคาจาก master และ stock จริง |
| คะแนนสะสม | ยอด 0.30 / เกณฑ์ 0.10 อาจได้ 2 แทน 3 | exact decimal floor division ให้ 3; ทดสอบยอดต่ำกว่าเกณฑ์และ divisor ผิด |
| กำไรเดลิเวอรี | รายได้ 100, COGS 20, รายจ่าย 10, GP 30 เคยแสดงกำไรดำเนินงาน 70 | ได้ 40; gross profit ยังคง 80 ก่อนหักค่าใช้จ่าย/GP; Dashboard/Close/Reports เปิดเผยค่าธรรมเนียม ไม่แก้ snapshot ปิดวันเก่าย้อนหลัง |
| Sign-in | ข้อความอังกฤษและ label ไม่ผูก input; ส่งซ้ำได้ระหว่างรอ | ภาษาไทย, label/input เชื่อมกัน, error alert, submit mutex/disabled/busy; browser พบช่องผ่านชื่อภาษาไทยและอ่านข้อความผิดได้ |

โค้ดเดิมจาก PR #453 เรื่อง checkout/split/drawer/Close Day satang, exact offline ACK และ durable replay อยู่บน main แล้วและยังผ่าน regression ไม่ได้เขียนสถาปัตยกรรมใหม่ทับ

## ความแม่นยำ: จำลองวันขายผ่านโปรแกรมจริง

ใช้ Next production build และฐาน file-backed libSQL ใหม่ที่แยกใน workspace เรียก HTTP ผ่าน Next API จริงด้วย session/CSRF สำหรับ QA เท่านั้น ไม่ใช่แค่เรียกฟังก์ชันคำนวณ และไม่ใช้ฐานของร้าน

ขั้นตอน: เปิดกะเงินสด 500 → อ่าน POS/Queue → ขาย 60 บิล → ส่ง checkout ซ้ำทุกบิล → ทำ/เรียก/ส่งมอบคิวครบ → รายจ่าย cash/bank → Dashboard → blind recount → Close Day → replay close → ทดสอบว่าปิดวันแล้วขายเพิ่มไม่ได้

| ตัวชี้วัด | ค่าที่คาดหวังอิสระ | ผลที่ตรวจจาก API/ฐานข้อมูล |
| --- | ---: | ---: |
| Requests ทั้งหมด | 351 | 351; ไม่มี HTTP outcome ที่ไม่คาดหมาย |
| บิลขายจริงใน fixture | 60 | 60 หลังส่ง checkout ซ้ำอีก 60 ครั้ง |
| SALE stock ledger entries | 180 | 180; ไม่เพิ่มเป็นสองเท่า |
| รายได้ 60 × 55.25 | 3,315.00 | 3,315.00 |
| COGS 60 × 19.60 | 1,176.00 | 1,176.00 |
| GP: 10 delivery bills | 165.80 | 165.80 |
| ค่าใช้จ่ายดำเนินงาน | 80.10 | 80.10 |
| กำไรหลังรายจ่ายและ GP | 1,893.10 | 1,893.10 |
| เงินสดปลายวัน: 500 + 30×55.25 − 30.10 | 2,127.40 | 2,127.40; variance 0 |
| Matcha / Milk / Cup คงเหลือ | 700 / 23,400 / 440 | ตรงทั้งสามรายการ |
| Close Day หลัง replay | 1 | 1 |

แหล่งผลแบบอ่านด้วยเครื่อง: [qa-evidence/field-v81-http.json](qa-evidence/field-v81-http.json). Harness: `node scripts/qa-production-scenario.mjs seed <new-local-db> <output>` แล้ว start Next ด้วย QA-only file DB และ `PUBLIC_ORIGIN=https://field.qa`, จากนั้น `run <same-db> <output>`. Harness ปฏิเสธ remote base URL และไม่ overwrite ฐานเดิม

ไม่ใช่หลักฐานรับเงินธนาคาร/บัตร/PromptPay จริง: bank/card/platform ใน fixture เป็นการบันทึกช่องทางตาม API, provider QR/webhook อยู่ใน regression/mock coverage และต้องทดสอบ sandbox/live ตาม gate แยก

## ความเร็วที่วัดได้

วัดเมื่อโค้ดรวม main ล่าสุดแล้ว รวม 351 requests ใน 24.013 วินาทีบนเครื่อง Windows ทดสอบ มีงาน QA อื่นร่วมใช้เครื่อง ค่าจึงสะท้อนสภาพเครื่องขณะนั้น ไม่ใช่ SLA และไม่ใช่ latency ของ Turso/Vercel production

| งาน | จำนวนตัวอย่าง | Median | p95 | สูงสุด |
| --- | ---: | ---: | ---: | ---: |
| Checkout ใหม่ | 60 | 73.95 ms | 208.37 ms | 258.89 ms |
| Checkout replay คีย์เดิม | 60 | 39.65 ms | 82.58 ms | 111.84 ms |
| อัปเดตคิว | 180 | 67.10 ms | 136.97 ms | 271.20 ms |
| อ่าน bootstrap ที่ล็อกอินแล้ว | 21 | 28.22 ms | 47.31 ms | 53.06 ms |
| อ่านคิว | 20 | 26.92 ms | 44.22 ms | 45.27 ms |

ตารางนี้แยก checkout ใหม่/replay และตัด anonymous rejection ออกจาก bootstrap แล้ว การรายงานก่อนหน้านี้ที่ checkout p95 ~33 ms มาจากคนละ checkpoint/สภาพโหลดเครื่อง ไม่ใช้เป็น before/after เพื่ออ้างว่ารุ่นใหม่เร็วขึ้นหรือช้าลง เพราะไม่มีการควบคุมสภาพการวัดให้เท่ากัน

Production smoke รอบล่าสุด: health JSON 200, DB timing 431.1 ms ในหนึ่ง request; anonymous bootstrap 401 พร้อม no-store. ตัวอย่างเดียวไม่ใช่ cold-start percentile และยังไม่ได้วัด field LCP/INP/CLS/TTFB ของพนักงานจริง จึงยังไม่มีเหตุผลย้ายไป FastAPI/Redis

## ความเสถียรและ regression

- Final local suite บนฐานใหม่: **842 ผ่าน / 0 fail / 0 skip / 0 cancelled**, 82.24 วินาที, Node 24.19.0, serial test files สำหรับ native libSQL บน Windows
- Production build Next.js 16.3.8 และ explicit TypeScript: ผ่าน; ยังมี preferredRegion deprecation เดิม
- Exact code SHA Linux CI: ผ่าน backend tests, production build และ browser QA **10 ชุด** รวมชุดใหม่ satang/atomic offline/sign-in
- Browser เดิม: touch 7 ขนาดจอ, offline storage denial/recovery, cashier flow, PromptPay pending, Close Day lost response, Queue WASTE review, Expense recovery, Workspace Expense recovery, Backup preview
- ชุดใหม่: ราคา 55.25 รับ 100.10 ทอน 44.85; offline transaction มีบิล 1 กับ milk stock 4 ที่เขียนพร้อมกัน; login labels/errors; 320/390/768 px
- เหตุการณ์เดิมยังครอบคลุม stock race, concurrent retry, durable replay หลัง cache eviction, wrong actor/payload, VOID/refund reversal, FIFO และ close guards
- ไม่ปิด/skip tests เพื่อให้ผ่าน; source assertions ที่ล็อกการปัด `.toFixed(0)` ถูกปรับให้ตรวจ formatter สตางค์ โดยยังเก็บ guard/label/flow assertions และเพิ่ม executable/browser evidence
- `git diff --check` ผ่าน. Repo ยังไม่มี lint configuration จึงไม่ได้อ้างว่า lint ผ่าน
- Windows native libSQL/runner เคยจบ process ระหว่างรอบทดสอบ และ local HTTP server จบหลัง scenario สำเร็จ; final suite และ Linux CI ผ่าน แต่ยังไม่ใช่ soak test หลายชั่วโมง ต้องตรวจ runtime window ใน environment เป้าหมายก่อน release

## Flow และ design audit

ใช้ Product Design audit ตรวจภาพที่จับจริง รักษาระบบภาพ FIELD สีทอง รูปแบบปุ่ม/การ์ดเดิม และแยกข้อมูลตัวอย่างจากข้อมูลร้าน ภาพ production POS/Workspace และภาพ candidate payment/sign-in เก็บในรายงาน HTML ที่ส่งมอบใน workspace ภาพ production ที่จับก่อน refresh baseline ไม่ใช่ภาพยืนยัน SHA ของ candidate

1. **เข้าสู่ระบบ** — รุ่นใหม่ใช้ภาษาไทย ชื่อช่องชัด และบอกความผิดพลาดโดยไม่แสดง technical code; เพิ่ม label semantics และกันส่งซ้ำ
2. **เปิดร้าน** — มีคำแนะนำเริ่มงานและเงินตั้งต้นใน workspace; ไม่ยืนยันเปิดร้านจริงใน production ระหว่าง audit ใช้ API fixture และ browser regression สำหรับการยืนยัน/ยกเลิก
3. **เลือกเมนู/สูตร** — มีลำดับ 1–2–3, หมวดหมู่, เหตุผลที่ unavailable และ stock guard; ราคาบนหน้าจอไม่ปัดสตางค์ทิ้ง รุ่น main ล่าสุดใช้คำว่า ตรวจออเดอร์/ชำระเงินให้สม่ำเสมอแล้ว
4. **ชำระเงิน** — total/review/change ใช้ยอดเดียวกัน ยอดพอดีและ tender shortcuts ยังคงอยู่ ปุ่มยืนยันอยู่เหนือ navigation/keyboard ตาม browser geometry QA; offline receipt แยกจาก cloud-paid receipt ชัดเจน
5. **ทำคิว/ส่งมอบ** — handoff พาไปงานถัดไปใน POS ไม่สร้างหลายทางเลือกโดยไม่จำเป็น; server ยังคงบังคับ FIFO และ mutation/replay; ไม่ใช้ผล screenshot แทนผล backend
6. **ปิดวัน** — independent count/recount, device outbox/recovery preflight และ server reconciliation ทำงานต่อ; พบบิลค้าง/คิวค้างต้องแก้ก่อนปิด ไม่มี bypass

**ข้อดีที่ยืนยันในขอบเขตทดสอบ:** งานหลักอยู่หน้า POS เดียว, ใช้ชื่อปุ่มชัด, primary action เด่น, target ขนาด 44 px ใน flow ที่ตรวจ, recovery ไม่ทำให้บิลหาย และผลเงินตรงกับฐาน

**สิ่งที่ยังอ้างไม่ได้:** screenshot ไม่ยืนยัน screen-reader compliance ทุกหน้า; ยังไม่ได้ให้พนักงานใหม่หลายคนทำงานโดยไม่ช่วย จึงไม่มีหลักฐานว่า “ใครก็ใช้ได้” หรือเรียนรู้ใน 1 นาที และ browser viewport ไม่แทน Android keyboard/gesture/process-kill จริง

## ปลั๊กอินและเครื่องมือที่ใช้ให้เกิดผลจริง

| เครื่องมือ | ประโยชน์และผลที่ใช้ตัดสิน |
| --- | --- |
| GitHub | ตรวจ merged/open PR/CI, พบการทำงานพร้อมกัน, รักษา main ใหม่และไม่ force-push, เปิด #464 และตรวจ exact code SHA |
| Vercel | แยก READY deployment/commit จริงจากเพียง success status, ตรวจ production ล่าสุดและ health identity |
| Product Design | อ่าน audit framework, ตรวจภาพ flow/ข้อความ/ลำดับงาน/ความอ่านง่ายและข้อจำกัด accessibility โดยไม่สร้าง mockup ใหม่ทับ product เดิม |
| In-app Browser | เข้า production ด้วย session ของร้านและตรวจ POS/Workspace แบบอ่านอย่างเดียว ไม่กดเปิดกะ/รับเงิน/ปิดวันจริง |
| Comprehensive QA + browser tests | ทดสอบ state, invalid input, retry, cancellation, mobile geometry, offline/restart, error recovery และ outcome ในฐานข้อมูล |
| Structured test evidence | เก็บ fixture, expected values, request samples, median/p95 และ snapshot ใน JSON ใช้ทำรายงานโดยไม่ทำ synthetic data ให้ดูเป็นยอดขายของร้าน |

ไม่เรียก Figma/ImageGen/ตัวสร้างเว็บหรือเพิ่มบริการ analytics เพียงเพื่อให้ใช้ปลั๊กอินครบ เพราะรอบนี้ต้องแก้ product ที่มีอยู่และตรวจความถูกต้อง ไม่ได้ต้องการ design system/ภาพใหม่หรือส่งข้อมูลร้านออกไปสร้าง dashboard

## เกณฑ์ก่อนเปิดใช้จริง

| ด้าน | ผลรอบนี้ | เกณฑ์ที่ยังต้องผ่าน |
| --- | --- | --- |
| เงินสด/เงิน/stock/replay/close | ผ่าน fixtures, API จริงบนฐานแยก และ regression | Owner ยืนยัน master ราคา สูตร หน่วย สต็อก และเปิดกะบนข้อมูลจริง; exact deploy UAT |
| Offline | ผ่าน atomic/rollback/concurrency และ browser storage | Android จริง: ปิดแอป/เปิดใหม่ offline, storage pressure, reconnect และตรวจ bill/stock retained |
| QR/provider | mock/contract/recovery coverage | isolated HTTPS sandbox/provider callback และ merchant readiness; ห้ามตีความการมี QR ว่ารับเงินจริงสำเร็จ |
| การใช้ง่าย | flow/labels/touch/geometry ผ่านขอบเขตที่ทดสอบ | สังเกตพนักงานใหม่ทำขาย/แก้ปัญหา/ปิดวัน วัด task completion/errors/taps |
| ความเร็ว | มี local p50/p95 ที่มีขอบเขตชัด | authenticated cold/warm production distributions บนอุปกรณ์ร้าน/เครือข่ายจริง |
| ความเสถียร/backup/audit | unit/integration/browser gates ผ่าน | isolated restore drill, runtime-error window, retention/tamper-resistance policy และ soak บน target runtime |
| Release | PR code CI ผ่าน; production ปัจจุบัน healthy | review final diff/SHA, isolated exact-SHA UAT, release marker ที่ตั้งใจ, post-deploy smoke/rollback readiness |

**คำตัดสิน:** พัฒนารุ่น 8.1 และทำ regression ได้ดีขึ้นอย่างมีหลักฐาน โดยปิดช่องโหว่สำคัญเพิ่มแล้ว แต่ยังไม่รับรอง 10/10, full WCAG หรือใช้เงินจริงได้ทุกโหมด การปล่อยรุ่นต้องผ่าน acceptance ข้างต้น ไม่ใช่ดูเพียงจำนวน tests หรือ CI สีเขียว
