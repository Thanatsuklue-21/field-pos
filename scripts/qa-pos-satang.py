"""Satang display regression on production build; all APIs intercepted, no live writes."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument("--base-url",default="http://localhost:3000")
parser.add_argument("--browser",default="")
parser.add_argument("--output",default="/tmp/field-satang-qa")
args=parser.parse_args()
output=Path(args.output); output.mkdir(parents=True,exist_ok=True)

with sync_playwright() as p:
    launch_args={"args":["--no-sandbox"]}
    if args.browser: launch_args["executable_path"]=args.browser
    browser=p.chromium.launch(**launch_args)
    results=[]
    for width,height in [(320,740),(390,844),(1024,768)]:
        context=browser.new_context(viewport={"width":width,"height":height})
        page=context.new_page(); page.set_default_timeout(30000)
        writes=[]; errors=[]; checkout_bodies=[]
        page.on("pageerror",lambda error: errors.append(str(error)))
    
        def handler(route):
            path=route.request.url.split("/api/")[-1]
            method=route.request.method
            if method!="GET" and path!="telemetry/web-vitals": writes.append({"method":method,"path":path})
            if path=="auth/session":
                data={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"test"}
            elif path=="pos/bootstrap":
                data={"revision":1,"menu":[{"id":"test-menu","name":"เมนูทดสอบ","category":"TEST","price":55.5,"enabled":True,"available":True,"maxServings":20,"lowStock":False,"variants":[
                    {"label":"50%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"matcha":5},"missingIngredients":[],"reason":None},
                    {"label":"100%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"matcha":5},"missingIngredients":[],"reason":None}
                ]}],"availabilityStock":{"matcha":{"qty":100,"name":"Matcha"}},"settings":{}}
            elif path=="customers": data={"customers":[],"loyalty":{}}
            elif path=="payments/promptpay/config": data={"ready":False,"configured":False}
            elif path=="pos/checkout" and method=="POST":
                body=json.loads(route.request.post_data or "{}"); checkout_bodies.append(body)
                data={"ok":True,"orderId":"order-test-1","queueNo":"Q001","pager":7,"billNo":"B001","saleIds":["sale-test-1"],"total":55.5,"received":100,"change":44.5,"revision":2}
            elif path=="queue":
                data={"queue":[]}
            else:
                data={"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
            route.fulfill(status=200,content_type="application/json",body=json.dumps(data))
    
        page.route("**/api/**",handler)
        page.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
        menu=page.get_by_role("button",name="เมนูทดสอบ").first
        expect(menu).to_be_visible()
        page.screenshot(path=str(output/f"01-menu-{width}.png"))
        expect(menu).to_contain_text("฿55.50")
        menu.click()
        variant=page.get_by_role("dialog")
        expect(variant.get_by_role("button",name=re.compile(r"หวานน้อย.*50%"))).to_contain_text("฿55.50")
        variant.get_by_role("button",name=re.compile(r"หวานน้อย.*50%")).click()
        page.get_by_role("button",name="ชำระเงิน",exact=True).click()
        payment=page.get_by_role("dialog",name="ชำระเงิน ฿55.50",exact=True)
        expect(payment).to_be_visible()
        cash=payment.get_by_role("textbox",name="จำนวนเงินที่รับจากลูกค้า")
        cash.fill("55.4")
        expect(payment.get_by_text("ขาดอีก",exact=True)).to_be_visible()
        expect(payment.get_by_text("฿0.10",exact=True)).to_be_visible()
        expect(payment.get_by_role("button",name="ยืนยันรับเงิน",exact=True)).to_be_disabled()
        payment.get_by_role("button",name="รับเงินพอดี ฿55.50",exact=True).click()
        expect(cash).to_have_value("55.5")
        cash.fill("100")
        expect(payment.get_by_text("฿44.50",exact=True)).to_be_visible()
        page.screenshot(path=str(output/f"02-payment-{width}.png"))
        payment.get_by_role("button",name="ยืนยันรับเงิน",exact=True).click()
        success=page.get_by_role("dialog",name="ชำระเงินสำเร็จ",exact=True)
        expect(success).to_be_visible()
        expect(success.get_by_text("฿44.50",exact=True)).to_be_visible()
        assert len(checkout_bodies)==1 and checkout_bodies[0]['total']==55.5 and checkout_bodies[0]['received']==100,checkout_bodies
        assert writes==[{"method":"POST","path":"pos/checkout"}],writes
        assert not errors,errors
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(output/f"03-success-{width}.png"))
        results.append({'width':width,'satangLabels':True,'underpaymentBlocked':True,'authoritativeChange':44.5,'checkoutWrites':1})
        print(json.dumps(results[-1]),flush=True)
        context.close()
    browser.close()
(output/'results.json').write_text(json.dumps(results,indent=2))
