"""Own-account PromptPay QR: manual two-step confirm when the bank notification does not arrive. APIs intercepted; no live writes."""
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
    errors=[]; writes=[]; counters={"splitStart":0,"create":0,"providerStatus":0,"splitPay":0,"checkout":0,"confirm":0}
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
    expect(payment.get_by_text(re.compile("ยอดล็อก ฿55.*เข้าบัญชีร้านโดยตรง"))).to_be_visible()
    # Notification never arrives: two-step manual confirm.
    page.wait_for_timeout(3500)
    assert counters["confirm"]==0 and counters["splitPay"]==0, counters
    fallback=payment.get_by_role("button",name=re.compile("แจ้งเตือนไม่มา"))
    box=fallback.bounding_box();assert box and box["height"]>=44,box
    fallback.click()
    ask=payment.get_by_role("alertdialog",name="ยืนยันเห็นเงินเข้า")
    expect(ask).to_be_visible()
    ask.get_by_role("button",name="ยังไม่เห็น",exact=True).click()
    expect(ask).to_have_count(0)
    assert counters["confirm"]==0, counters
    fallback.click()
    page.wait_for_timeout(600)
    yes=payment.get_by_role("alertdialog",name="ยืนยันเห็นเงินเข้า").get_by_role("button",name="เห็นแล้ว · ปิดบิล",exact=True)
    yb=yes.bounding_box();footer=payment.get_by_role("button",name="กำลังรอผล QR เดิม...",exact=True).bounding_box()
    assert yb and footer and yb["y"]+yb["height"]<=footer["y"]-8,(yb,footer)  # visible above the sticky footer without manual scrolling
    page.screenshot(path=str(output/"direct-confirm-390.png"))
    payment.get_by_role("alertdialog",name="ยืนยันเห็นเงินเข้า").get_by_role("button",name="เห็นแล้ว · ปิดบิล",exact=True).click()
    expect(page.get_by_text("ชำระเงินสำเร็จ",exact=True)).to_be_visible(timeout=12000)
    assert counters["confirm"]==1, counters
    assert counters["splitPay"]==1, counters
    assert counters["checkout"]==0, counters
    assert not errors, errors
    print(json.dumps({"viewport":"390x844","manualConfirm":counters["confirm"],"splitPay":counters["splitPay"],"cancelPathSafe":True,"pageErrors":errors},ensure_ascii=False))
    browser.close()
