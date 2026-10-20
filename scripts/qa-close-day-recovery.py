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
posts=[];committed={};close_posts=[];page_errors=[]

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
        if path=="close-day" and method=="POST":
            body=json.loads(route.request.post_data or "{}");close_posts.append(body)
            data={"ok":True,"requestKey":body["requestKey"],"performedBy":"owner","operation":"close","close":{
                "id":"close-1","date":body["date"],"closedBy":"owner","openingCash":body["openingCash"],
                "countedCash":body["countedCash"],"reviewId":body["reviewId"],"cashVariance":0,"varianceReason":""
            },"revision":2}
            return route.fulfill(status=201,content_type="application/json",body=json.dumps(data))
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

    close_button=page.get_by_role("button",name="ปิดร้านวันนี้",exact=True)
    expect(close_button).to_be_enabled()
    close_button.click()
    close_dialog=page.get_by_role("dialog",name="ยืนยันปิดร้านวันนี้",exact=True)
    expect(close_dialog).to_be_visible()
    expect(close_dialog.get_by_text("ระบบจะตรวจรายการค้างในเครื่องอีกครั้งเมื่อกดยืนยัน",exact=False)).to_be_visible()
    assert close_posts==[],close_posts
    cancel=close_dialog.get_by_role("button",name="ยังไม่ปิดวัน",exact=True)
    confirm=close_dialog.get_by_role("button",name="ยืนยันปิดวัน",exact=True)
    for control in [cancel,confirm]:
        box=control.bounding_box()
        assert box and box["width"]>=44 and box["height"]>=44,box
    cancel.click()
    expect(close_dialog).to_have_count(0)
    assert close_posts==[],close_posts

    close_button.click()
    close_dialog=page.get_by_role("dialog",name="ยืนยันปิดร้านวันนี้",exact=True)
    close_dialog.get_by_role("button",name="ยืนยันปิดวัน",exact=True).click()
    expect(close_dialog).to_have_count(0)
    # The dialog closes after the durable intent is prepared, before the async
    # write completes. Assert on the exact-ACK UI state, not dialog teardown.
    expect(page.get_by_text("ปิดวันสำเร็จ · เงินสด ตรงพอดี",exact=True)).to_be_visible()
    assert page.evaluate("localStorage.getItem('field-close-day-write-pending-v1:owner')") is None
    assert len(close_posts)==1,close_posts
    close_body=close_posts[0]
    assert close_body["operation"]=="close" and close_body["date"]=="2026-10-16"
    assert close_body["openingCash"]==500 and close_body["countedCash"]==500 and close_body["reviewId"]=="review-1"
    assert isinstance(close_body.get("requestKey"),str) and len(close_body["requestKey"])>=8
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert not page_errors,page_errors

    result={"viewport":"390x844","reviewPosts":len(posts),"committedReviews":len(committed),"exactReplay":True,"reloadRecovery":True,"guidedCloseReview":True,"closePosts":len(close_posts),"cancelNoWrite":True,"touch44":True,"liveWrites":False,"pageErrors":page_errors}
    (out/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
    page.screenshot(path=str(out/"close-day-guided-close.png"),full_page=True)
    print(json.dumps(result,ensure_ascii=False),flush=True)
    context.close();browser.close()
