"""Read-only catalog readiness UI regression; all APIs intercepted."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://localhost:3000');parser.add_argument('--browser',default='');parser.add_argument('--output',default='/tmp/field-catalog-readiness');args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);results=[]
with sync_playwright() as p:
    launch={'args':['--no-sandbox']}
    if args.browser:launch['executable_path']=args.browser
    browser=p.chromium.launch(**launch)
    for width,height in [(320,740),(360,740),(390,844),(412,915),(768,1024)]:
        context=browser.new_context(viewport={'width':width,'height':height})
        page=context.new_page();errors=[];writes=[];scenario={'ready':False}
        page.on('pageerror',lambda e:errors.append(str(e)))
        def handler(route):
            path=route.request.url.split('/api/')[-1]
            if route.request.method!='GET' and path!='telemetry/web-vitals':writes.append(path)
            if path=='auth/session':data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
            elif path=='control-center':
                catalog={'status':'READY' if scenario['ready'] else 'REVIEW','activeMenus':1,'availableMenus':1 if scenario['ready'] else 0,'issues':[] if scenario['ready'] else [{'code':'stock_shortage','title':'วัตถุดิบไม่พอสำหรับบางเมนู','href':'/stock','action':'ไปตรวจของจริง / รับเข้า','count':1,'items':[{'name':'Matcha Latte','detail':'ขาด นม Meiji'}]},{'code':'cost_unconfirmed','title':'ต้นทุนยังไม่ครบหรือยังไม่ยืนยัน','href':'/costs','action':'ไปตรวจต้นทุน','count':1,'items':[{'name':'Milk','detail':'ยังไม่ยืนยันต้นทุน'}]}]}
                data={'analysis':{'generatedAt':1,'date':'2026-10-20','level':'OK','signals':[],'recommendations':[],'metrics':{},'evidence':{'lowStock':[],'largeMovements':[],'highRiskActions':[],'pendingOwnerApprovals':[],'stockIntegrity':[]},'readiness':{'generatedAt':1,'date':'2026-10-20','status':'READY','score':100,'summary':{'total':0,'ready':0,'warn':0,'blocked':0},'checks':[],'nextActions':[],'catalog':catalog}}}
            else:data={}
            route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        page.route('**/api/**',handler);page.goto(args.base_url+'/control',wait_until='networkidle')
        card=page.get_by_role('region',name='ความพร้อมข้อมูลก่อนขาย',exact=True);expect(card).to_be_visible()
        expect(card.get_by_text('มีข้อมูลต้องตรวจ',exact=True)).to_be_visible()
        expect(card.get_by_text('ผลตรวจระบบปกติไม่ได้ยืนยันว่าทุกเมนูมีของพร้อมขาย',exact=False)).to_be_visible()
        card.get_by_text('วัตถุดิบไม่พอสำหรับบางเมนู · 1 รายการ',exact=True).click()
        expect(card.get_by_text('ขาด นม Meiji',exact=True)).to_be_visible()
        expect(card.get_by_role('link',name='ไปตรวจของจริง / รับเข้า',exact=True)).to_have_attribute('href','/stock')
        expect(page.get_by_text('ตรวจระบบและบัญชีแบบละเอียด',exact=True)).to_be_visible()
        assert card.evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        page.screenshot(path=str(out/f'{width}-catalog-review.png'))
        scenario['ready']=True;page.reload(wait_until='networkidle')
        expect(card.get_by_text('ตรวจข้อมูลหลักแล้ว',exact=True)).to_be_visible()
        expect(card.get_by_text('มีข้อมูลต้องตรวจ',exact=True)).to_have_count(0)
        assert not errors,errors
        assert not writes,writes
        results.append({'width':width,'reviewAndReady':True,'pageErrors':errors,'writes':writes});context.close()
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'passed':len(results),'liveWrites':False}))
