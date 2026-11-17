"""Solo start-of-day: POS shows "ยังไม่เปิดร้านวันนี้" with a one-tap path to open the cash shift before the first customer. APIs intercepted; no live writes."""
import argparse, json, re
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument("--base-url",default="http://localhost:3000");parser.add_argument("--browser",default="");parser.add_argument("--output",default="/tmp/field-pay-mode-qa")
args=parser.parse_args()
def handler(route):
    path=route.request.url.split("/api/")[-1].split("?")[0]
    if route.request.method!="GET" and path!="telemetry/web-vitals": writes.append(path)
    if path=="auth/session":d={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"t"}
    elif path=="pos/bootstrap":d={"revision":1,"menu":[{"id":"m1","name":"เมนูทดสอบ","category":"T","price":55,"enabled":True,"available":True,"maxServings":20,"lowStock":False,"variants":[{"label":"100%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"x":1},"missingIngredients":[],"reason":None}]}],"availabilityStock":{"x":{"qty":100,"name":"x"}},"settings":{},"operatorGuide":{"shiftStatus":"not_open","queueCount":0}}
    elif path=="customers":d={"customers":[],"loyalty":{}}
    else:d={"queue":[],"health":"ok","metrics":{},"alerts":[],"policy":{"auto":[],"approval":[],"never":[]}}
    route.fulfill(status=200,content_type="application/json",body=json.dumps(d))
writes=[];errors=[]
with sync_playwright() as p:
    la={"args":["--no-sandbox"]}
    if args.browser: la["executable_path"]=args.browser
    b=p.chromium.launch(**la);c=b.new_context(viewport={"width":390,"height":844});pg=c.new_page();pg.set_default_timeout(30000)
    pg.on("pageerror",lambda e:errors.append(str(e)));pg.route("**/api/**",handler)
    pg.goto(args.base_url+"/pos",wait_until="domcontentloaded",timeout=60000)
    banner=pg.locator("[data-shift-banner]")
    expect(banner).to_be_visible()
    expect(banner).to_contain_text("ยังไม่เปิดร้านวันนี้")
    btn=banner.locator("[data-shift-open]");bb=btn.bounding_box();assert bb and bb["height"]>=44,bb
    btn.click()
    expect(pg.get_by_role("dialog").first).to_be_visible()
    assert not writes,writes
    assert not errors,errors
    print(json.dumps({"viewport":"390x844","shiftBannerVisible":True,"opensWorkspace":True,"liveWrites":False,"pageErrors":errors},ensure_ascii=False))
    b.close()
