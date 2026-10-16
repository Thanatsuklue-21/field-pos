"""Close Day lost-response browser regression with intercepted APIs only.

The first review POST is committed by the mock server but its response is lost.
The page must keep the durable intent, recover the exact same request identity,
and never create a second review. No production or live financial writes occur.
"""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser()
parser.add_argument("--base-url",default="http://127.0.0.1:3000")
parser.add_argument("--browser",default="")
parser.add_argument("--output",default="/tmp/field-close-day-qa")
args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
posts=[];committed={};page_errors=[]

with sync_playwright() as p:
    launch={"args":["--no-sandbox"]}
    if args.browser: launch["executable_path"]=args.browser
    browser=p.chromium.launch(**launch)
    context=browser.new_context(viewport={"width":390,"height":844})
    page=context.new_page();page.set_default_timeout(30000)
    page.on("pageerror",lambda e:page_errors.append(str(e)))

    def handler(route):
        path=route.request.url.split("/api/")[-1];method=route.request.method
        if path=="auth/session":
            return route.fulfill(status=200,content_type="application/json",body=json.dumps({"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"test"}))
        if path=="close-day" and method=="GET":
            data={"closes":[],"businessDate":"2026-10-16","shift":{"id":"shift-1","date":"2026-10-16","status":"open","openingCash":500,"openedAt":1,"openedBy":"owner"},"cashMovements":[],"drawerSnapshot":{"openingCash":500,"cashSales":0,"cashIn":0,"cashPaidOut":0,"cashOut":0,"availableCash":500}}
            return route.fulfill(status=200,content_type="application/json",body=json.dumps(data))
        if path=="close-day/review" and method=="POST":
            body=json.loads(route.request.post_data or "{}");posts.append(body)
            key=body["requestKey"]
            if key not in committed:
                committed[key]={"ok":True,"requestKey":key,"performedBy":"owner","operation":"review","review":{"id":"review-1","date":body["date"],"createdBy":"owner","countedCash":body["secondCount"],"expectedCash":500,"variance":0,"level":"OK","summary":"เงินสดตรงพอดี","evidence":[],"ownerConfirmRequired":False}}
                return route.abort("failed")
            assert body==posts[0],(posts[0],body)
            return route.fulfill(status=200,content_type="application/json",body=json.dumps(committed[key]))
        return route.fulfill(status=200,content_type="application/json",body="{}")

    page.route("**/api/**",handler)
    page.goto(args.base_url+"/close",wait_until="domcontentloaded",timeout=60000)
    page.get_by_placeholder("นับเงินจริงรอบแรก").fill("500")
    page.get_by_placeholder("นับเงินจริงรอบสอง").fill("500")
    page.get_by_role("button",name="ตรวจยอดก่อนปิดวัน",exact=True).click()
    expect(page.get_by_text("มีการตรวจหรือปิดวันครั้งก่อนรอยืนยัน",exact=True)).to_be_visible()
    expect(page.get_by_role("button",name="ตรวจรายการเดิม",exact=True)).to_be_visible()
    assert len(posts)==1 and len(committed)==1
    first=posts[0]
    assert first["operation"]=="review" and first["firstCount"]==500 and first["secondCount"]==500
    assert isinstance(first.get("requestKey"),str) and len(first["requestKey"])>=8

    page.reload(wait_until="domcontentloaded")
    expect(page.get_by_text("เงินสดตรงพอดี",exact=True)).to_be_visible()
    assert len(posts)==2 and posts[1]==first and len(committed)==1
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert not page_errors,page_errors

    result={"viewport":"390x844","reviewPosts":len(posts),"committedReviews":len(committed),"exactReplay":True,"reloadRecovery":True,"liveWrites":False,"pageErrors":page_errors}
    (out/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
    page.screenshot(path=str(out/"close-day-review-recovered.png"),full_page=True)
    print(json.dumps(result,ensure_ascii=False),flush=True)
    context.close();browser.close()
