"""PromptPay non-blocking browser QA. All APIs are intercepted; no live money or stock writes."""
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
    errors=[]; writes=[]; counters={"splitStart":0,"create":0,"providerStatus":0,"splitPay":0,"checkout":0}
    page.on("pageerror",lambda error: errors.append(str(error)))

    def handler(route):
        url=route.request.url
        path=url.split("/api/")[-1]
        method=route.request.method
        if method!="GET": writes.append({"method":method,"path":path})
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
            data={"ready":True,"configured":True,"selectedProvider":"beam","mode":"test"}
        elif path=="pos/split/start" and method=="POST":
            counters["splitStart"]+=1
            data={"ok":True,"session":{"id":"split-pp-1","status":"collecting","total":55,"orderId":None,"queueNo":None,"pager":None}}
        elif path=="payments/promptpay/create" and method=="POST":
            counters["create"]+=1
            data={"chargeId":"ch_pp_test_1","provider":"beam","status":"pending","paid":False,"amount":55,"currency":"THB","qrUrl":"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","referenceId":"split-pp-1"}
        elif path=="pos/split/status" and method=="POST":
            data={"ok":True,"session":{"id":"split-pp-1","status":"collecting","total":55,"orderId":None,"queueNo":None,"pager":None}}
        elif path=="payments/promptpay/status" and method=="POST":
            counters["providerStatus"]+=1
            paid=counters["providerStatus"]>=2
            data={"chargeId":"ch_pp_test_1","provider":"beam","status":"succeeded" if paid else "pending","paid":paid,"amount":55,"currency":"THB","qrUrl":"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","referenceId":"split-pp-1"}
        elif path=="pos/split/pay" and method=="POST":
            counters["splitPay"]+=1
            data={"ok":True,"orderId":"order-pp-1","queueNo":"QPP1","pager":8,"saleIds":["sale-pp-1"],"total":55,"received":55,"change":0,"revision":2}
        elif path=="pos/checkout" and method=="POST":
            counters["checkout"]+=1
            data={"ok":True,"orderId":"unexpected","queueNo":"BAD","pager":99,"saleIds":["bad"],"total":55,"received":55,"change":0}
        elif path=="queue":
            data={"queue":[]}
        else:
            data={"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
        route.fulfill(status=200,content_type="application/json",body=json.dumps(data))

    page.route("**/api/**",handler)
    page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
    page.get_by_role("button",name="เมนูทดสอบ").first.click()
    variant=page.get_by_role("dialog")
    variant.get_by_role("button",name=re.compile(r"หวานน้อย.*50%")).first.click()
    page.get_by_role("button",name="ชำระเงิน",exact=True).click()
    payment=page.get_by_role("dialog",name="รับเงิน ฿55")
    expect(payment).to_be_visible()
    payment.get_by_role("button",name=re.compile(r"PromptPay")).click()
    expect(payment.get_by_text("กดสร้าง QR ให้ลูกค้า",exact=True)).to_be_visible()
    payment.get_by_role("button",name="สร้าง QR ให้ลูกค้า",exact=True).click()

    expect(payment.get_by_alt_text("PromptPay QR")).to_be_visible()
    expect(payment.get_by_text("กำลังรอผล PromptPay เดิม",exact=False)).to_be_visible()
    expect(payment.get_by_role("button",name="กลับไปเลือกเมนู")).to_be_disabled()
    expect(payment.get_by_role("button",name="เงินสด",exact=True)).to_be_disabled()
    expect(payment.get_by_role("button",name="ช่องทางอื่น",exact=True)).to_be_disabled()
    expect(payment.get_by_role("button",name="โอน",exact=True)).to_have_count(0)
    expect(payment.get_by_role("button",name="บัตร",exact=True)).to_have_count(0)
    expect(payment.get_by_role("button",name="เดลิเวอรี",exact=True)).to_have_count(0)
    expect(payment.get_by_role("button",name="กำลังรอผล QR เดิม...",exact=True)).to_be_disabled()

    expect(page.get_by_text("ชำระเงินสำเร็จ",exact=True)).to_be_visible(timeout=12000)
    expect(page.get_by_text("คิว QPP1 · กู้คืนรายการเดิม",exact=True)).to_be_visible()
    expect(page.get_by_text("บัตร 8",exact=True)).to_be_visible()

    pending=page.evaluate("localStorage.getItem('field-pos-pending-promptpay-v1')")
    assert pending is None, pending
    assert counters["splitStart"]==1, counters
    assert counters["create"]==1, counters
    assert counters["providerStatus"]>=2, counters
    assert counters["splitPay"]==1, counters
    assert counters["checkout"]==0, counters
    assert not errors, errors
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

    result={"viewport":"390x844","splitStart":counters["splitStart"],"qrCreates":counters["create"],"providerStatusChecks":counters["providerStatus"],"splitPay":counters["splitPay"],"checkoutCalls":counters["checkout"],"pendingCleared":pending is None,"pageErrors":errors}
    (output/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
    page.screenshot(path=str(output/"promptpay-nonblocking-390.png"),full_page=True)
    print(json.dumps(result,ensure_ascii=False),flush=True)
    context.close(); browser.close()
