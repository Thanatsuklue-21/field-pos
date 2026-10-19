"""Cashier-flow metrics browser QA. All APIs are intercepted; no live financial writes.

Measures the deterministic UI interaction path for a new cashier without claiming
human training speed. Human time-to-learn must be measured separately on real hardware.
"""
import argparse
import json
import re
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument("--base-url",default="http://localhost:3000")
parser.add_argument("--browser",default="")
parser.add_argument("--output",default="/tmp/field-cashier-flow-qa")
args=parser.parse_args()
output=Path(args.output); output.mkdir(parents=True,exist_ok=True)

with sync_playwright() as p:
    launch_args={"args":["--no-sandbox"]}
    if args.browser: launch_args["executable_path"]=args.browser
    browser=p.chromium.launch(**launch_args)
    context=browser.new_context(viewport={"width":390,"height":844})
    page=context.new_page(); page.set_default_timeout(30000)
    writes=[]; errors=[]; checkout_bodies=[]; taps=0
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
            data={"ok":True,"orderId":"order-test-1","queueNo":"Q001","pager":7,"billNo":"B001","saleIds":["sale-test-1"],"total":55,"received":100,"change":45,"revision":2}
        elif path=="queue":
            data={"queue":[]}
        else:
            data={"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
        route.fulfill(status=200,content_type="application/json",body=json.dumps(data))

    page.route("**/api/**",handler)
    started=time.perf_counter()
    page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)

    # Routine mobile operations must stay on the POS surface instead of route-switching.
    mobile_nav=page.get_by_role("navigation",name="เมนูหลักบนมือถือ")
    workspace_button=mobile_nav.get_by_role("button",name="งานร้าน",exact=True)
    expect(workspace_button).to_be_visible()
    before_workspace_url=page.url
    workspace_button.click()
    workspace=page.get_by_role("dialog",name="งานร้าน FIELD")
    expect(workspace).to_be_visible()
    assert page.url==before_workspace_url and page.url.endswith("/pos"), page.url
    workspace.get_by_role("button",name="ปิดงานร้าน",exact=True).click()
    expect(workspace).to_have_count(0)

    def tap(locator):
        nonlocal_taps[0]+=1
        locator.click()

    nonlocal_taps=[0]
    expect(page.get_by_text("แตะเมนูที่ลูกค้าสั่ง",exact=True)).to_be_visible()
    tap(page.get_by_role("button",name="เมนูทดสอบ").first)
    variant=page.get_by_role("dialog")
    expect(variant).to_be_visible()
    tap(variant.get_by_role("button",name=re.compile(r"หวานน้อย.*50%")).first)
    expect(page.get_by_text("ลูกค้าสั่งครบหรือยัง?",exact=True)).to_be_visible()
    tap(page.get_by_role("button",name="ชำระเงิน",exact=True))
    payment=page.get_by_role("dialog",name="ชำระเงิน ฿55")
    expect(payment).to_be_visible()
    expect(payment.get_by_text("รับเงินจากลูกค้า",exact=True)).to_be_visible()
    tap(payment.get_by_role("button",name="รับเงินพอดี ฿55",exact=True))
    # Use 100 to exercise the change path while keeping payment deterministic.
    payment.get_by_role("textbox",name="จำนวนเงินที่รับจากลูกค้า").fill("100")
    nonlocal_taps[0]+=1
    expect(payment.get_by_text("ทอน 45 บาท แล้วกดยืนยัน",exact=True)).to_be_visible()
    expect(payment.get_by_text("เงินทอน",exact=True)).to_be_visible()
    expect(payment.get_by_text("฿45",exact=True)).to_be_visible()
    tap(payment.get_by_role("button",name="ยืนยันรับเงิน",exact=True))

    success=page.get_by_text("ชำระเงินสำเร็จ",exact=True)
    expect(success).to_be_visible()
    expect(page.get_by_text("คิว Q001",exact=True)).to_be_visible()
    expect(page.get_by_text("บัตร 7",exact=True)).to_be_visible()
    expect(page.get_by_text("฿45",exact=True)).to_be_visible()
    handoff=page.get_by_role("dialog",name="ชำระเงินสำเร็จ",exact=True)
    expect(handoff).to_be_visible()
    primary=handoff.get_by_role("button",name="ทำคิว Q001 ต่อเลย",exact=True)
    expect(primary).to_be_visible()
    # Payment handoff is intentionally non-dismissible and exposes one guided next action.
    assert handoff.get_by_role("button").count()==1
    assert handoff.get_by_role("button",name=re.compile(r"ปิด|Close|Dismiss")).count()==0
    tap(primary)
    expect(page.get_by_text("ชำระเงินสำเร็จ",exact=True)).to_have_count(0)
    workspace=page.get_by_role("dialog",name="งานร้าน FIELD",exact=True)
    expect(workspace).to_be_visible()
    expect(workspace.get_by_text("งานร้าน",exact=True)).to_be_visible()
    assert len(checkout_bodies)==1, checkout_bodies

    elapsed_ms=round((time.perf_counter()-started)*1000)
    assert len(checkout_bodies)==1, checkout_bodies
    body=checkout_bodies[0]
    assert body["payment"]=="cash"
    assert body["received"]==100
    assert body["cart"]==[{"id":"test-menu","variant":"50%","qty":1}]
    assert isinstance(body.get("requestKey"),str) and body["requestKey"]
    assert not errors, errors
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

    result={
        "viewport":"390x844",
        "uiInteractions":nonlocal_taps[0],
        "automationElapsedMs":elapsed_ms,
        "checkoutRequests":len(checkout_bodies),
        "durableRequestKeyPresent":True,
        "cashChangeVerified":45,
        "queueVerified":"Q001",
        "pagerVerified":7,
        "handoffRequiresNextAction":True,
        "nextCustomerResetVerified":True,
        "workspaceStayedOnPos":True,
        "pageErrors":errors,
        "note":"Automation timing is regression telemetry only; it is not a human training-time claim."
    }
    (output/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
    page.screenshot(path=str(output/"cashier-flow-390.png"),full_page=True)
    print(json.dumps(result,ensure_ascii=False),flush=True)
    context.close(); browser.close()
