"""Payment busy-state keyboard regression. All APIs are intercepted; no live financial writes.

"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument("--base-url",default="http://localhost:3000")
parser.add_argument("--browser",default="")
parser.add_argument("--output",default="/tmp/field-modal-focus-qa")
args=parser.parse_args()
output=Path(args.output); output.mkdir(parents=True,exist_ok=True)

with sync_playwright() as p:
    launch_args={"args":["--no-sandbox"]}
    if args.browser: launch_args["executable_path"]=args.browser
    browser=p.chromium.launch(**launch_args)
    context=browser.new_context(viewport={"width":390,"height":844})
    page=context.new_page(); page.set_default_timeout(30000)
    writes=[]; errors=[]; checkout_bodies=[]; pending_routes=[]
    page.on("pageerror",lambda error: errors.append(str(error)))

    def handler(route):
        path=route.request.url.split("/api/")[-1]
        method=route.request.method
        if method!="GET" and path!="telemetry/web-vitals": writes.append({"method":method,"path":path})
        if path=="auth/session":
            data={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"test"}
        elif path=="pos/bootstrap":
            data={"revision":1,"menu":[{"id":"test-menu","name":"เมนูทดสอบ","category":"TEST","price":55,"enabled":True,"available":True,"maxServings":20,"lowStock":False,"variants":[
                {"label":"50%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"matcha":5},"missingIngredients":[],"reason":None},
                {"label":"100%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"matcha":5},"missingIngredients":[],"reason":None}
            ]}],"availabilityStock":{"matcha":{"qty":100,"name":"Matcha"}},"settings":{}}
        elif path=="customers": data={"customers":[],"loyalty":{}}
        elif path=="payments/promptpay/config": data={"ready":False,"configured":False}
        elif path=="pos/checkout" and method=="POST":
            body=json.loads(route.request.post_data or "{}"); checkout_bodies.append(body)
            pending_routes.append(route)
            return
        elif path=="queue":
            data={"queue":[]}
        else:
            data={"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
        route.fulfill(status=200,content_type="application/json",body=json.dumps(data))

    page.route("**/api/**",handler)
    page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
    page.get_by_role("button",name="เมนูทดสอบ").first.click()
    page.get_by_role("dialog").get_by_role("button",name=re.compile(r"หวานน้อย.*50%")).click()
    page.get_by_role("button",name="ชำระเงิน",exact=True).click()
    payment=page.get_by_role("dialog",name="ชำระเงิน ฿55",exact=True)
    payment.get_by_role("button",name="รับเงินพอดี ฿55",exact=True).click()
    issues=[]
    # Dynamic panels can contain controls hidden with CSS or a hidden ancestor.
    # Neither is a valid boundary for the shared dialog's keyboard loop.
    payment.evaluate("e=>{const b=document.createElement('button');b.id='qa-hidden-boundary';b.hidden=true;b.textContent='hidden boundary';e.append(b)}")
    close=payment.get_by_role("button",name="กลับไปเลือกเมนู",exact=True)
    confirm=payment.get_by_role("button",name="ยืนยันรับเงิน",exact=True)
    close.focus();page.keyboard.press("Shift+Tab")
    if not confirm.evaluate("e=>e===document.activeElement"): issues.append("hidden control breaks reverse Tab boundary")
    payment.evaluate("e=>e.querySelector('#qa-hidden-boundary').remove()")
    confirm.click()
    expect(payment.locator("fieldset")).to_have_attribute("aria-busy","true")
    page.screenshot(path=str(output/"01-payment-pending.png"))
    if payment.get_by_text("ยอดพอดี · กดยืนยันรับเงิน",exact=True).count(): issues.append("ready-to-confirm guidance remains during write")
    if payment.get_by_text("รับเงินพอดียอด · กดยืนยันชำระได้เลย",exact=True).count(): issues.append("exact-cash confirmation hint remains during write")
    # With all controls disabled by the parent fieldset, Tab must stay on
    # the dialog itself, never reach the menu/navigation behind a pending write.
    for key in ["Tab","Shift+Tab","Tab","Tab"]:
        page.keyboard.press(key)
        inside=payment.evaluate("e=>e===document.activeElement||e.contains(document.activeElement)")
        page.screenshot(path=str(output/"02-keyboard-pending.png"))
        if not inside: issues.append({"key":key,"active":page.evaluate("document.activeElement.outerHTML.slice(0,180)")})
    page.keyboard.press("Escape")
    expect(payment).to_be_visible()
    assert len(checkout_bodies)==1,checkout_bodies
    assert writes==[{"method":"POST","path":"pos/checkout"}],writes
    pending_routes[0].fulfill(status=200,content_type="application/json",body=json.dumps({"ok":True,"orderId":"order-test-1","queueNo":"Q001","pager":7,"billNo":"B001","saleIds":["sale-test-1"],"total":55,"received":55,"change":0,"revision":2}))
    expect(page.get_by_role("dialog",name="ชำระเงินสำเร็จ",exact=True)).to_be_visible()
    assert not errors,errors
    assert not issues,issues
    result={"busyKeyboardContained":True,"escapeBlockedDuringWrite":True,"checkoutWrites":len(checkout_bodies),"successAfterExactAck":True}
    (output/"results.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
    browser.close()
