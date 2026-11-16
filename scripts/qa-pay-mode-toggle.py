"""Visible pay-mode switch: 'จ่ายรวมบิลเดียว | แยกจ่ายตามคน' enters and leaves split mode without hidden menus. APIs intercepted; no live writes."""
import argparse, json, re
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument("--base-url",default="http://localhost:3000");parser.add_argument("--browser",default="");parser.add_argument("--output",default="/tmp/field-pay-mode-qa")
args=parser.parse_args()
def handler(route):
    path=route.request.url.split("/api/")[-1].split("?")[0]
    if route.request.method!="GET" and path!="telemetry/web-vitals": writes.append(path)
    if path=="auth/session":d={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"t"}
    elif path=="pos/bootstrap":d={"revision":1,"menu":[{"id":"m1","name":"เมนูทดสอบ","category":"T","price":55,"enabled":True,"available":True,"maxServings":20,"lowStock":False,"variants":[{"label":"100%","available":True,"maxServings":20,"lowStock":False,"recipeItems":{"x":1},"missingIngredients":[],"reason":None}]}],"availabilityStock":{"x":{"qty":100,"name":"x"}},"settings":{}}
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
    pg.get_by_role("button",name="เมนูทดสอบ").first.click()
    pay=None
    pg.get_by_role("button",name="ชำระเงิน",exact=True).click()
    pay=pg.get_by_role("dialog",name="ชำระเงิน ฿55")
    expect(pay.locator("[data-pay-mode]")).to_have_count(0)  # one cup: no split choice
    pay.get_by_role("button",name="ปิด").first.click() if pay.get_by_role("button",name="ปิด").count() else pg.keyboard.press("Escape")
    expect(pg.get_by_role("dialog",name="ชำระเงิน ฿55")).to_have_count(0)
    pg.get_by_role("button",name="เมนูทดสอบ").first.click()
    pg.get_by_role("button",name="ชำระเงิน",exact=True).click()
    expect(pg.get_by_role("dialog",name="ชำระเงิน ฿110")).to_be_visible()
    pay=pg.get_by_role("dialog",name=re.compile(r"^ชำระเงิน ฿"))  # title shows the current part during split
    single=pay.get_by_role("radio",name="จ่ายรวมบิลเดียว");split=pay.get_by_role("radio",name="แยกจ่ายตามคน")
    expect(single).to_have_attribute("aria-checked","true")
    box=split.bounding_box();assert box and box["height"]>=44,box
    split.click()
    expect(split).to_have_attribute("aria-checked","true")
    expect(pay.get_by_text("คนที่กำลังจ่าย")).to_be_visible()
    single.click()
    expect(single).to_have_attribute("aria-checked","true")
    expect(pay.get_by_text("คนที่กำลังจ่าย")).to_have_count(0)
    assert not writes,writes
    assert not errors,errors
    print(json.dumps({"viewport":"390x844","toggleVisible":True,"enterLeaveSplit":True,"liveWrites":False,"pageErrors":errors},ensure_ascii=False))
    b.close()
