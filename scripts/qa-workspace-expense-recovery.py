"""Today Workspace quick-expense lost-response recovery QA.

All APIs are intercepted. The first expense POST simulates a lost response after the
request is observed; the retry must reuse the exact durable request identity.
No live financial writes are possible.
"""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser()
parser.add_argument("--base-url",default="http://localhost:3000")
parser.add_argument("--browser",default="/usr/bin/chromium")
parser.add_argument("--output",default="/tmp/field-workspace-expense-qa")
args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
posts=[];page_errors=[]

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=args.browser,args=["--no-sandbox"])
    context=browser.new_context(viewport={"width":390,"height":844})
    page=context.new_page();page.set_default_timeout(30000)
    page.on("pageerror",lambda e:page_errors.append(str(e)))

    def handler(route):
        path=route.request.url.split("/api/")[-1]; method=route.request.method
        if path=="auth/session":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"test"}))
        if path=="pos/bootstrap":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"revision":1,"menu":[],"availabilityStock":{},"settings":{}}))
        if path=="customers":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"customers":[],"loyalty":{}}))
        if path=="payments/promptpay/config":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"ready":False,"configured":False}))
        if path=="pos/queue":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"orders":[]}))
        if path=="pos/history":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"sales":[]}))
        if path=="control-center":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"analysis":None}))
        if path=="expenses" and method=="GET":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"expenses":[],"businessDate":"2026-10-14","shift":None,"drawerSnapshot":None}))
        if path=="expenses" and method=="POST":
            body=json.loads(route.request.post_data or "{}");posts.append(body)
            if len(posts)==1:
                return route.abort("failed")
            ack={"ok":True,"expense":{"id":"exp-test","requestKey":body["requestKey"],"createdBy":"owner","date":body["date"],"amount":body["amount"],"category":body["category"],"description":body["description"],"paymentMethod":body["paymentMethod"]}}
            return route.fulfill(status=200,content_type="application/json",body=json.dumps(ack))
        return route.fulfill(status=200,content_type="application/json",body="{}")

    page.route("**/api/**",handler)
    page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
    page.get_by_role("button",name="งานร้าน",exact=True).click()
    workspace=page.get_by_role("dialog",name="งานร้าน FIELD")
    expect(workspace).to_be_visible()
    workspace.get_by_role("button",name="รายจ่าย",exact=True).click()
    workspace.get_by_role("button",name="โอน",exact=True).click()
    workspace.get_by_role("spinbutton",name="จำนวนเงินค่าใช้จ่ายด่วน").fill("45") if workspace.get_by_role("spinbutton",name="จำนวนเงินค่าใช้จ่ายด่วน").count() else workspace.get_by_label("จำนวนเงินค่าใช้จ่ายด่วน").fill("45")
    workspace.get_by_label("รายละเอียดค่าใช้จ่ายด่วน").fill("ค่าส่งของ")
    workspace.get_by_role("button",name="ยืนยันค่าใช้จ่าย",exact=True).click()

    expect(workspace.get_by_text("มีค่าใช้จ่ายเดิมรอยืนยัน",exact=True)).to_be_visible()
    expect(workspace.get_by_role("button",name="ตรวจผลรายการเดิม",exact=True)).to_be_visible()
    assert len(posts)==1
    first=posts[0]
    assert first["paymentMethod"]=="bank" and first["amount"]==45
    assert isinstance(first.get("requestKey"),str) and first["requestKey"].startswith("expense:")

    workspace.get_by_role("button",name="ตรวจผลรายการเดิม",exact=True).click()
    expect(workspace.get_by_text("ตรวจพบว่ารายการเดิมบันทึกแล้ว · ไม่สร้างซ้ำ",exact=False)).to_be_visible()
    assert len(posts)==2
    second=posts[1]
    assert second==first,(first,second)
    assert not page_errors,page_errors

    result={"viewport":"390x844","expensePosts":len(posts),"exactReplay":True,"requestKey":first["requestKey"],"liveWrites":False,"pageErrors":page_errors}
    (out/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
    page.screenshot(path=str(out/"workspace-expense-recovery.png"),full_page=True)
    print(json.dumps(result,ensure_ascii=False),flush=True)
    context.close();browser.close()
