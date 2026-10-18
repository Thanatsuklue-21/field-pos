"""Queue waste/remake guided review browser regression.
All APIs are intercepted; no live financial or stock writes.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument("--base-url",default="http://localhost:3000")
parser.add_argument("--browser",default="")
parser.add_argument("--output",default="/tmp/field-queue-waste-qa")
args=parser.parse_args()
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)

def order(waste_count=0):
    return {
        "id":"order-1","queueNo":"Q001","pagerNo":1,"status":"making","time":1,
        "items":[{
            "id":"matcha-latte","name":"มัทฉะลาเต้","variant":"100%","qty":1,
            "readyQty":0,"calledQty":0,"prepSelected":True,"wasteCount":waste_count,
            "prepGroup":{"id":"MATCHA","compatibilityKey":"matcha-100","label":"MATCHA","batchMode":"NONE"}
        }],
        "prepGroups":[{"id":"MATCHA","label":"MATCHA","batchMode":"NONE","qty":1,"pendingQty":1,
            "items":[{"id":"matcha-latte","name":"มัทฉะลาเต้","variant":"100%","qty":1,"pendingQty":1,"compatibilityKey":"matcha-100"}]}]
    }

results=[]
with sync_playwright() as p:
    launch={"args":["--no-sandbox"]}
    if args.browser: launch["executable_path"]=args.browser
    browser=p.chromium.launch(**launch)
    for width,height in [(320,740),(390,844),(768,1024)]:
        context=browser.new_context(viewport={"width":width,"height":height})
        page=context.new_page();page.set_default_timeout(30000)
        writes=[];errors=[];revision=[1]
        page.on("pageerror",lambda error: errors.append(str(error)))

        def handler(route):
            path=route.request.url.split("/api/")[-1]
            method=route.request.method
            if path=="auth/session":
                data={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"test"}
            elif path=="pos/queue" and method=="GET":
                data={"revision":revision[0],"orders":[order(0)]}
            elif path=="pos/queue" and method=="POST":
                body=route.request.post_data_json or {}
                writes.append(body)
                revision[0]+=1
                data={
                    "ok":True,"requestKey":body.get("requestKey"),"performedBy":"owner",
                    "orderId":"order-1","action":body.get("action"),"revision":revision[0],
                    "orders":[order(1)],"wasteCost":12.5
                }
            elif path=="telemetry/web-vitals":
                data={"ok":True}
            else:
                data={"ok":True}
            route.fulfill(status=200,content_type="application/json",body=json.dumps(data))

        page.route("**/api/**",handler)
        page.goto(args.base_url+"/queue",wait_until="domcontentloaded",timeout=60000)

        waste=page.get_by_role("button",name="ชงเสีย / ทำใหม่",exact=True)
        expect(waste).to_be_visible()
        waste.click()
        dialog=page.get_by_role("dialog",name="ชงเสีย / ทำใหม่ 1 แก้ว",exact=True)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_text("ลงค่าใช้จ่าย WASTE อัตโนมัติ",exact=False)).to_be_visible()
        expect(dialog.get_by_text("หักวัตถุดิบเพิ่มตามสูตรที่ใช้ตอนขาย",exact=False)).to_be_visible()
        assert writes==[], writes

        cancel=dialog.get_by_role("button",name="ยังไม่บันทึก",exact=True)
        confirm=dialog.get_by_role("button",name="ยืนยันชงเสีย / ทำใหม่",exact=True)
        for control in [cancel,confirm]:
            box=control.bounding_box()
            assert box and box["width"]>=44 and box["height"]>=44, {"viewport":f"{width}x{height}","box":box}
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        cancel.click()
        expect(dialog).to_have_count(0)
        assert writes==[], writes

        waste.click()
        dialog=page.get_by_role("dialog",name="ชงเสีย / ทำใหม่ 1 แก้ว",exact=True)
        dialog.get_by_role("button",name="ยืนยันชงเสีย / ทำใหม่",exact=True).click()
        expect(dialog).to_have_count(0)
        expect(page.get_by_text("บันทึก WASTE มัทฉะลาเต้ 1 แก้วแล้ว",exact=False)).to_be_visible()
        assert len(writes)==1, writes
        body=writes[0]
        assert body.get("action")=="waste_remake", body
        assert body.get("orderId")=="order-1", body
        assert body.get("itemIndex")==0, body
        assert body.get("reason")=="ชงเสีย / ทำใหม่", body
        assert isinstance(body.get("requestKey"),str) and len(body["requestKey"])>=8, body
        assert not errors, errors
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=str(output/f"queue-waste-{width}.png"),full_page=True)
        row={"viewport":f"{width}x{height}","reviewBeforeWrite":True,"cancelNoWrite":True,"singleConfirmWrite":True,"touch44":True,"noOverflow":True}
        results.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
        context.close()
    browser.close()

(output/"results.json").write_text(json.dumps(results,ensure_ascii=False,indent=2))
