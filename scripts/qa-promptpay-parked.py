"""Parked PromptPay: cashier parks a pending QR, takes the next cash order, and the late payment completes in the background without touching the new cart. APIs intercepted; no live writes."""
import argparse, json, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument("--base-url",default="http://localhost:3000")
parser.add_argument("--browser",default="")
parser.add_argument("--output",default="/tmp/field-promptpay-qa")
args=parser.parse_args()
output=Path(args.output); output.mkdir(parents=True,exist_ok=True)

with sync_playwright() as p:
    launch_args={"args":["--no-sandbox"]}
    if args.browser: launch_args["executable_path"]=args.browser
    browser=p.chromium.launch(**launch_args)
    context=browser.new_context(viewport={"width":390,"height":844})
    page=context.new_page(); page.set_default_timeout(30000)
    errors=[]; writes=[]; state={"paid":False}; counters={"splitStart":0,"create":0,"providerStatus":0,"splitPay":0,"checkout":0,"confirm":0}
    page.on("pageerror",lambda error: errors.append(str(error)))

    def handler(route):
        url=route.request.url
        path=url.split("/api/")[-1]
        method=route.request.method
        if method!="GET" and path!="telemetry/web-vitals": writes.append({"method":method,"path":path})
        if path=="auth/session":
            data={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"test"}
        elif path=="pos/bootstrap":
            data={"revision":1,"menu":[{"id":"test-menu","name":"เมนูทดสอบ","category":"TEST","price":55,"enabled":True,"available":True,"maxServings":20,"lowStock":False,"variants":[
                {"label":"50%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"matcha":5},"missingIngredients":[],"reason":None},
                {"label":"100%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"matcha":5},"missingIngredients":[],"reason":None}
            ]}],"availabilityStock":{"matcha":{"qty":100,"name":"Matcha"}},"settings":{}}
        elif path=="customers":
            data={"customers":[],"loyalty":{}}
        elif path=="payments/promptpay/config":
            data={"ready":True,"configured":True,"selectedProvider":"direct","provider":"direct","mode":"live"}
        elif path=="pos/split/start" and method=="POST":
            counters["splitStart"]+=1
            data={"ok":True,"session":{"id":"split-pp-1","status":"collecting","total":55,"orderId":None,"queueNo":None,"pager":None}}
        elif path=="payments/promptpay/create" and method=="POST":
            counters["create"]+=1
            data={"chargeId":"pd_0123456789abcdef01234567","provider":"direct","status":"pending","paid":False,"amount":55,"currency":"THB","qrUrl":"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","referenceId":"split-pp-1"}
        elif path=="pos/split/status" and method=="POST":
            data={"ok":True,"session":{"id":"split-pp-1","status":"completed" if state["paid"] else "collecting","total":55,"orderId":"order-pp-1" if state["paid"] else None,"queueNo":"QPP1" if state["paid"] else None,"pager":8 if state["paid"] else None}}
        elif path=="payments/promptpay/status" and method=="POST":
            counters["providerStatus"]+=1
            paid=state["paid"] or counters["confirm"]>=1
            data={"chargeId":"pd_0123456789abcdef01234567","provider":"direct","status":"paid" if paid else "pending","paid":paid,"amount":55,"currency":"THB","qrUrl":"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","referenceId":"split-pp-1"}
        elif path=="payments/promptpay/direct/confirm" and method=="POST":
            counters["confirm"]+=1
            assert json.loads(route.request.post_data or "{}").get("chargeId")=="pd_0123456789abcdef01234567"
            data={"chargeId":"pd_0123456789abcdef01234567","provider":"direct","status":"paid","paid":True,"amount":55,"currency":"THB","referenceId":"split-pp-1","confirmMode":"manual"}
        elif path=="pos/split/pay" and method=="POST":
            counters["splitPay"]+=1
            data={"ok":True,"orderId":"order-pp-1","queueNo":"QPP1","pager":8,"saleIds":["sale-pp-1"],"total":55,"received":55,"change":0,"revision":2}
        elif path=="pos/checkout" and method=="POST":
            counters["checkout"]+=1
            data={"ok":True,"orderId":"order-cash-2","queueNo":"QC2","pager":9,"saleIds":["sale-cash-2"],"total":55,"received":55,"change":0,"revision":3}
        elif path=="queue":
            data={"queue":[]}
        else:
            data={"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
        route.fulfill(status=200,content_type="application/json",body=json.dumps(data))

    page.route("**/api/**",handler)
    page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
    page.get_by_role("button",name="เมนูทดสอบ").first.click()
    page.get_by_role("button",name="ชำระเงิน",exact=True).click()
    payment=page.get_by_role("dialog",name="ชำระเงิน ฿55")
    payment.get_by_role("button",name=re.compile(r"PromptPay")).click()
    payment.get_by_role("button",name="สร้าง QR ให้ลูกค้า",exact=True).click()
    expect(payment.get_by_alt_text("PromptPay QR")).to_be_visible()
    park=payment.locator("[data-park-prompt]")
    expect(park).to_be_visible()
    box=park.bounding_box();assert box and box["height"]>=44,box
    park.click()
    expect(page.get_by_role("dialog",name="ชำระเงิน ฿55")).to_have_count(0)
    chip=page.locator("[data-parked-prompt]")
    expect(chip).to_be_visible()
    expect(chip).to_contain_text("รอเงินเข้า PromptPay ฿55")
    stored=page.evaluate("()=>JSON.parse(localStorage.getItem('field-pos-pending-promptpay-v1')||'null')")
    assert stored and stored.get("parked") is True,stored
    page.screenshot(path=str(output/"parked-chip-390.png"))
    # Next customer, cash.
    page.get_by_role("button",name="เมนูทดสอบ").first.click()
    page.get_by_role("button",name="ชำระเงิน",exact=True).click()
    pay2=page.get_by_role("dialog",name="ชำระเงิน ฿55")
    pay2.get_by_role("button",name="เงินสด",exact=True).click()
    pay2.get_by_label("จำนวนเงินที่รับจากลูกค้า").fill("55")
    # Late PromptPay arrives while the second sheet is open.
    state["paid"]=True
    expect(page.get_by_text("ได้รับเงิน PromptPay ฿55 · คิว QPP1 เข้าคิวแล้ว")).to_be_visible(timeout=12000)
    expect(chip).to_have_count(0)
    expect(pay2).to_be_visible()
    expect(pay2.get_by_label("จำนวนเงินที่รับจากลูกค้า")).to_have_value("55")
    assert counters["splitPay"]==0,counters  # server closed the bill on the bank notification
    pay2.get_by_role("button",name="ยืนยันรับเงิน",exact=True).click()
    expect(page.get_by_text("ชำระเงินสำเร็จ",exact=True)).to_be_visible(timeout=12000)
    assert counters["checkout"]==1 and counters["splitPay"]==0,counters
    stored=page.evaluate("()=>localStorage.getItem('field-pos-pending-promptpay-v1')")
    assert stored is None,stored
    assert not errors,errors
    print(json.dumps({"viewport":"390x844","parked":True,"backgroundSplitPay":counters["splitPay"],"cashCheckout":counters["checkout"],"secondCartKept":True,"pageErrors":errors},ensure_ascii=False))
    browser.close()
