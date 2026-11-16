"""Cancel an open or stuck PromptPay QR from the payment sheet (field report 2026-11-16): two-step, releases the server reservation, unlocks cash. APIs intercepted; no live writes."""
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
    errors=[]; writes=[]; counters={"splitStart":0,"create":0,"providerStatus":0,"splitPay":0,"checkout":0,"confirm":0,"release":0}; mode={"failFirstCreate":False}
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
            if mode["failFirstCreate"] and counters["create"]==1:
                route.fulfill(status=409,content_type="application/json",body=json.dumps({"error":"promptpay_charge_creation_unknown"}));return
            data={"chargeId":"pd_0123456789abcdef01234567","provider":"direct","status":"pending","paid":False,"amount":55,"currency":"THB","qrUrl":"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","referenceId":"split-pp-1"}
        elif path=="pos/split/status" and method=="POST":
            data={"ok":True,"session":{"id":"split-pp-1","status":"collecting","total":55,"orderId":None,"queueNo":None,"pager":None}}
        elif path=="payments/promptpay/status" and method=="POST":
            counters["providerStatus"]+=1
            paid=counters["confirm"]>=1
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
            data={"ok":True,"orderId":"unexpected","queueNo":"BAD","pager":99,"saleIds":["bad"],"total":55,"received":55,"change":0}
        elif path=="pos/split/provider-release" and method=="POST":
            counters["release"]+=1
            assert json.loads(route.request.post_data or "{}").get("paymentReference")=="pd_0123456789abcdef01234567"
            data={"ok":True,"session":{"id":"split-pp-1","status":"cancelled"}}
        elif path=="queue":
            data={"queue":[]}
        else:
            data={"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
        route.fulfill(status=200,content_type="application/json",body=json.dumps(data))

    page.route("**/api/**",handler)
    def run(fail_first):
        mode["failFirstCreate"]=fail_first
        for k in counters: counters[k]=0
        page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
        page.evaluate("()=>localStorage.removeItem('field-pos-pending-promptpay-v1')")
        page.reload(wait_until="domcontentloaded")
        if not fail_first: page.get_by_role("button",name="เมนูทดสอบ").first.click()  # cancel keeps the cart for the next payment method
        page.get_by_role("button",name="ชำระเงิน",exact=True).click()
        payment=page.get_by_role("dialog",name="ชำระเงิน ฿55")
        payment.get_by_role("button",name=re.compile(r"PromptPay")).click(timeout=8000)
        payment.get_by_role("button",name="สร้าง QR ให้ลูกค้า",exact=True).click()
        if fail_first:
            expect(payment.get_by_role("button",name="กำลังรอผล QR เดิม...",exact=True)).to_be_visible()  # stuck-looking sheet
        else:
            expect(payment.get_by_alt_text("PromptPay QR")).to_be_visible()
        cancel=payment.locator("[data-cancel-prompt]")
        expect(cancel).to_be_visible()
        b=cancel.bounding_box();assert b and b["height"]>=44,b
        cancel.click()
        ask=payment.get_by_role("alertdialog",name="ยืนยันยกเลิก QR")
        ask.get_by_role("button",name="กลับ",exact=True).click()
        assert counters["release"]==0,counters
        cancel.click()
        payment.get_by_role("alertdialog",name="ยืนยันยกเลิก QR").get_by_role("button",name="ยกเลิก QR",exact=True).click()
        expect(payment.get_by_text(re.compile("ยกเลิก QR ฿55 แล้ว"))).to_be_visible(timeout=15000)
        assert counters["release"]==1 and counters["splitPay"]==0 and counters["checkout"]==0,counters
        expect(payment.get_by_role("button",name="เงินสด",exact=True)).to_be_enabled()
        assert page.evaluate("()=>localStorage.getItem('field-pos-pending-promptpay-v1')") is None
        return dict(counters)
    normal=run(False)
    stuck=run(True)
    assert stuck["create"]>=2,stuck
    assert not errors,errors
    print(json.dumps({"viewport":"390x844","cancelOpenQr":normal,"cancelStuckQr":stuck,"pageErrors":errors},ensure_ascii=False))
    browser.close()
