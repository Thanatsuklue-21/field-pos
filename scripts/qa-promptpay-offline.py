"""Offline PromptPay: network drops, QR is rendered on the device from the cached receiving number, cashier records after seeing the money, and the bill syncs (flagged for bank matching) when the network returns. APIs intercepted; no live writes."""
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
    errors=[]; writes=[]; counters={"splitStart":0,"create":0,"checkout":0}; bodies=[]
    page.on("pageerror",lambda error: errors.append(str(error)))

    def handler(route):
        url=route.request.url
        path=url.split("/api/")[-1].split("?")[0]
        method=route.request.method
        if path=="auth/session":
            data={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"test"}
        elif path=="pos/bootstrap":
            data={"revision":1,"menu":[{"id":"test-menu","name":"เมนูทดสอบ","category":"TEST","price":55,"enabled":True,"available":True,"maxServings":20,"lowStock":False,"variants":[
                {"label":"100%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"matcha":5},"missingIngredients":[],"reason":None}]}],
                "availabilityStock":{"matcha":{"qty":100,"name":"Matcha"}},"settings":{}}
        elif path=="customers":
            data={"customers":[],"loyalty":{}}
        elif path=="payments/promptpay/config":
            data={"ready":True,"configured":True,"selectedProvider":"direct","provider":"direct","mode":"live","offlineQrId":"0826119798"}
        elif path=="pos/split/start":
            counters["splitStart"]+=1; data={"error":"unexpected"}
        elif path=="payments/promptpay/create":
            counters["create"]+=1; data={"error":"unexpected"}
        elif path=="pos/checkout" and method=="POST":
            counters["checkout"]+=1
            b=json.loads(route.request.post_data or "{}"); bodies.append(b)
            data={"ok":True,"offlinePromptPay":"matched","offlineFulfilled":True,"orderId":"order-off-1","queueNo":"Q009","pager":0,"saleIds":["sale-off-1"],"total":55,"received":55,"change":0,"revision":2}
        elif path=="queue":
            data={"queue":[]}
        else:
            data={"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
        route.fulfill(status=200,content_type="application/json",body=json.dumps(data))

    page.route("**/api/**",handler)
    page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
    expect(page.get_by_role("button",name="เมนูทดสอบ").first).to_be_visible()
    page.wait_for_function("()=>!!localStorage.getItem('field-pos-promptpay-qr-id-v1')")
    page.wait_for_timeout(1500)  # let the QR renderer chunk load and be cached
    context.set_offline(True)
    page.get_by_role("button",name="เมนูทดสอบ").first.click()
    page.get_by_role("button",name="ชำระเงิน",exact=True).click()
    payment=page.get_by_role("dialog",name="ชำระเงิน ฿55")
    pp=payment.get_by_role("button",name=re.compile(r"^PromptPay"))
    expect(pp).to_be_enabled()
    pp.click()
    payment.get_by_role("button",name="สร้าง QR ในเครื่อง (เน็ตหลุด)",exact=True).click()
    qr=payment.locator("[data-offline-qr] img")
    expect(qr).to_be_visible()
    src=qr.get_attribute("src") or ""; assert src.startswith("data:image/png;base64,") and len(src)>500,src[:60]
    expect(payment.locator("[data-offline-qr]")).to_contain_text("ยอด ฿55")
    page.screenshot(path=str(output/"offline-qr-390.png"))
    payment.get_by_role("button",name="เห็นเงินเข้าแล้ว · บันทึกบิล",exact=True).click()
    expect(page.get_by_text(re.compile("บันทึก PromptPay แบบ Offline แล้ว"))).to_be_visible()
    assert counters["checkout"]==0 and counters["splitStart"]==0 and counters["create"]==0,counters
    # Network returns: the stored bill syncs once with the offline PromptPay flags.
    context.set_offline(False)
    page.evaluate("()=>window.dispatchEvent(new Event('online'))")
    expect(page.get_by_text(re.compile("PromptPay 1 บิลตรวจยอดกับธนาคารแล้ว"))).to_be_visible(timeout=20000)
    assert counters["checkout"]==1,counters
    b=bodies[0]
    assert b["payment"]=="promptpay" and b["offlinePromptPay"] is True and b["offlineFulfilled"] is True and b["total"]==55 and b["received"]==55,b
    assert "paymentVerified" not in b,b
    assert counters["splitStart"]==0 and counters["create"]==0,counters
    assert not errors,errors
    print(json.dumps({"viewport":"390x844","offlineLocalQr":True,"syncedCheckouts":counters["checkout"],"serverQrCalls":counters["create"],"pageErrors":errors},ensure_ascii=False))
    browser.close()
