"""Owner releases a stuck own-account PromptPay bill from Orders → รายการรับเงินค้าง (field report 2026-11-17). APIs intercepted; no live writes."""
import argparse, json, re
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument("--base-url",default="http://localhost:3000");parser.add_argument("--browser",default="");parser.add_argument("--output",default="/tmp/field-promptpay-stuck-qa")
args=parser.parse_args()
state={"released":False};calls={"release":0};errors=[];writes=[]
SESSION={"id":"split-3d923db3-stuck","status":"requires_resolution","mode":"promptpay_full","total":45,"remainingAmount":45,"date":"2026-11-16","pager":0,"expiresAt":1,"createdAt":1,"updatedAt":1,
 "resolutionRequiredAt":2,"resolvedAt":None,"resolvedBy":None,"items":[{"id":"m1","name":"Pure Matcha Iced","variant":"ไม่หวาน","qty":1,"price":45}],"remainingQty":[1],"payments":[],"targetOrderId":None}
def handler(route):
    path=route.request.url.split("/api/")[-1].split("?")[0];m=route.request.method
    if path=="auth/session":d={"user":{"id":"owner","username":"owner","role":"admin","permissions":{}},"csrf":"t"}
    elif path=="pos/split/list":d={"sessions":[] if state["released"] else [SESSION]}
    elif path=="pos/split/promptpay-release-stuck" and m=="POST":
        calls["release"]+=1;b=json.loads(route.request.post_data or "{}")
        assert b.get("sessionId")==SESSION["id"] and len(b.get("requestKey",""))>=8,b
        state["released"]=True;d={"ok":True,"released":True,"session":{**SESSION,"status":"cancelled"}}
    elif path in ("orders","sales") or path.startswith("orders") or path.startswith("sales"):d={"orders":[],"sales":[],"items":[]}
    else:
        if m!="GET" and path!="telemetry/web-vitals":writes.append(path)
        d={"ok":True,"queue":[],"orders":[],"sales":[]}
    route.fulfill(status=200,content_type="application/json",body=json.dumps(d))
with sync_playwright() as p:
    la={"args":["--no-sandbox"]}
    if args.browser:la["executable_path"]=args.browser
    b=p.chromium.launch(**la);c=b.new_context(viewport={"width":1280,"height":800});pg=c.new_page();pg.set_default_timeout(30000)
    pg.on("pageerror",lambda e:errors.append(str(e)));pg.route("**/api/**",handler)
    pg.goto(args.base_url+"/orders",wait_until="domcontentloaded",timeout=60000)
    pg.get_by_text("฿45 คงเหลือ").first.click()
    dlg=pg.get_by_role("dialog")
    expect(dlg.get_by_text("PromptPay · ห้ามเปลี่ยนช่องทาง")).to_be_visible()
    btn=dlg.locator("[data-release-stuck]")
    expect(btn).to_be_disabled()  # must confirm the bank app first
    dlg.locator("[data-release-stuck-confirm]").check()
    expect(btn).to_be_enabled();bb=btn.bounding_box();assert bb and bb["height"]>=44,bb
    btn.click()
    expect(pg.get_by_text(re.compile("ปลดบิล PromptPay ค้าง ฿45 แล้ว"))).to_be_visible()
    expect(pg.get_by_text("฿45 คงเหลือ")).to_have_count(0)
    assert calls["release"]==1,calls
    assert not writes,writes
    assert not errors,errors
    print(json.dumps({"viewport":"1280x800","released":True,"releaseCalls":calls["release"],"confirmRequired":True,"pageErrors":errors},ensure_ascii=False))
    b.close()
