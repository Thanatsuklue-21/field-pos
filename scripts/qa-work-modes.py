"""Role/mode UX regression on production build. All APIs intercepted; no live writes."""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://localhost:3000');parser.add_argument('--browser',default='');parser.add_argument('--output',default='/tmp/field-work-modes')
args=parser.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True);results=[]
roles={'cashier':{'order':True},'barista':{'queue':True},'shift':{'order':True,'queue':True,'stock':True,'report':True},'admin':{}}
with sync_playwright() as p:
    launch={'args':['--no-sandbox']}
    if args.browser:launch['executable_path']=args.browser
    browser=p.chromium.launch(**launch)
    for width,height in [(320,740),(360,740),(390,844),(412,915),(768,1024),(1024,768)]:
        for role,permissions in roles.items():
            context=browser.new_context(viewport={'width':width,'height':height},has_touch=True)
            draft={'state':{'items':[{'key':'menu::100%','id':'menu','name':'เมนูทดสอบ','variant':'100%','price':55,'qty':1}]},'version':0}
            context.add_init_script('if(!localStorage.getItem("field-pos-cart-v1"))localStorage.setItem("field-pos-cart-v1",'+json.dumps(json.dumps(draft))+')')
            page=context.new_page();errors=[];writes=[];requests=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            def handler(route):
                path=route.request.url.split('/api/')[-1];requests.append(path)
                if route.request.method!='GET' and path!='telemetry/web-vitals':writes.append(path)
                if path=='auth/session':data={'user':{'id':'owner','username':role,'role':'admin' if role=='admin' else 'staff','permissions':permissions},'csrf':'test'}
                elif path=='pos/bootstrap':data={'revision':1,'menu':[{'id':'menu','name':'เมนูทดสอบ','category':'TEST','price':55,'enabled':True,'available':True,'maxServings':20,'lowStock':False,'variants':[{'label':'100%','available':True,'maxServings':20,'lowStock':False,'recipeItems':{},'missingIngredients':[],'reason':None}]}],'availabilityStock':{},'settings':{}}
                elif path in ['pos/queue','queue']:data={'orders':[],'queue':[]}
                elif path=='pos/history':data={'sales':[]}
                elif path=='customers':data={'customers':[],'loyalty':{}}
                elif path=='expenses':data={'expenses':[],'businessDate':'2026-10-20','shift':{'id':'shift','status':'open','openingCash':1000},'drawerSnapshot':None}
                elif path=='control-center':data={'analysis':None}
                elif path=='management/dashboard':data={'topItems':[],'lowStock':[],'recommendations':[],'analytics':{'purchaseRecommendations':[]},'costQuality':{'status':'ok'}}
                elif path=='ai/supervisor':data={'health':'ok','metrics':{},'alerts':[],'policy':{'auto':[],'approval':[],'never':[]}}
                elif path=='admin/users':data={'users':[{'id':'00000000-0000-4000-8000-000000000001','username':'demo','role':'staff','permissions':{'order':True,'queue':True},'active':True}]}
                elif path.startswith('admin/users/'):
                    return route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':'admin_required'}))
                else:data={'ready':False,'configured':False}
                route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
            page.route('**/api/**',handler)
            page.goto(args.base_url+'/pos',wait_until='domcontentloaded')
            if role=='barista':expect(page).to_have_url(re.compile('/queue$'))
            else:expect(page.get_by_role('heading',name='รับออเดอร์',exact=True)).to_be_visible()
            modes=page.get_by_role('navigation',name='สลับโหมดการทำงาน')
            assert 'ai/supervisor' not in requests and 'ai/chat' not in requests,requests
            if width>=768:
                expect(page.get_by_role('navigation',name='งานประจำวัน').get_by_role('link',name='สต็อก',exact=True)).to_have_count(0)
            else:
                expect(page.get_by_role('navigation',name='เมนูหลักบนมือถือ').get_by_role('link',name='ปิดยอดประจำวัน',exact=True)).to_have_count(0)
            expect(modes.get_by_role('link',name='หน้าร้าน',exact=True)).to_be_visible()
            if role in ['admin','shift']:
                expect(modes.get_by_role('link',name='หลังร้าน',exact=True)).to_be_visible()
                before=page.evaluate('localStorage.getItem("field-pos-cart-v1")')
                modes.get_by_role('link',name='หลังร้าน',exact=True).click()
                expect(page).to_have_url(re.compile('/dashboard$'))
                expect(page.get_by_text('โหมดหลังร้าน',exact=True)).to_be_visible()
                if width>=768:
                    nav=page.get_by_role('navigation',name='งานประจำวัน')
                    expect(nav.get_by_role('link',name='รับออเดอร์',exact=True)).to_have_count(0)
                    for link in nav.get_by_role('link').all():
                        assert link.inner_text().strip(),link.get_attribute('href')
                        assert link.get_attribute('aria-label') or link.inner_text().strip()
                modes.get_by_role('link',name='หน้าร้าน',exact=True).click()
                expect(page).to_have_url(re.compile('/pos$'))
                assert page.evaluate('localStorage.getItem("field-pos-cart-v1")')==before
            else:expect(modes.get_by_role('link',name='หลังร้าน',exact=True)).to_have_count(0)
            assert 'ai/supervisor' not in requests and 'ai/chat' not in requests,requests
            page.get_by_role('button',name='เปิดผู้ช่วย FIELD',exact=True).click()
            helper=page.get_by_role('dialog',name='FIELD AI Supervisor',exact=True)
            expect(helper).to_be_visible()
            assert 'ai/chat' not in requests,requests
            helper.get_by_role('button',name='ปิด FIELD AI Supervisor',exact=True).click()
            expect(helper).to_have_count(0)
            expect(page.get_by_role('button',name='FIELD AI Supervisor',exact=True)).to_have_count(0)
            page.wait_for_timeout(300)  # Allow mode color transition to settle for visual QA.
            page.screenshot(path=str(out/f'{width}-{role}-front.png'))
            # Direct URL denial must happen before protected view mounts/API is requested.
            requests.clear();page.goto(args.base_url+('/users' if role!='admin' else '/reports'),wait_until='domcontentloaded')
            if role!='admin':
                expect(page.get_by_role('heading',name='หน้านี้ไม่อยู่ในสิทธิ์ของคุณ')).to_be_visible()
                assert 'admin/users' not in requests
                page.get_by_role('link',name='ไปหน้างานของฉัน').click()
                expect(page).to_have_url(re.compile('/queue$' if role=='barista' else '/pos$'))
            if role=='admin':
                page.goto(args.base_url+'/users',wait_until='domcontentloaded')
                page.get_by_role('button',name='เพิ่มผู้ใช้',exact=True).click()
                dialog=page.get_by_role('dialog',name='เพิ่มผู้ใช้',exact=True)
                expect(dialog).to_be_visible()
                box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width,box
                assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth'), 'role dialog has horizontal overflow'
                for name,expected in [('คนขาย',[True,False,False,False]),('คนชง',[False,True,False,False]),('หน้าร้านครบ',[True,True,False,False]),('ผู้ดูแลกะ',[True,True,True,True])]:
                    dialog.get_by_role('button',name=re.compile('^'+name)).click()
                    for label,checked in zip(['รับออเดอร์ / รับเงิน','ทำเครื่องดื่ม / ส่งมอบ','รับเข้า / ดูแลสต็อก','รายงาน / ปิดยอด'],expected):
                        expect(dialog.get_by_role('checkbox',name=label,exact=True)).to_be_checked(checked=checked)
                page.screenshot(path=str(out/f'{width}-role-presets.png'))
                dialog.get_by_role('button',name='ปิดการสร้างผู้ใช้').click()
                page.get_by_role('button',name='รีเซ็ตรหัสผ่าน',exact=True).click()
                reset=page.get_by_role('dialog',name='รีเซ็ตรหัสผ่าน',exact=True)
                reset.get_by_label('รหัสผ่านใหม่',exact=True).fill('Test-only-password')
                reset.get_by_role('button',name='ยืนยันรีเซ็ต',exact=True).click()
                expect(reset).to_be_visible();expect(reset.get_by_role('alert')).to_contain_text('ไม่มีสิทธิ์')
                assert writes==['admin/users/00000000-0000-4000-8000-000000000001'],writes
            else:assert not writes,writes
            assert not errors,errors
            results.append({'width':width,'role':role,'pageErrors':errors,'liveWrites':False,'mockedWrites':writes})
            context.close()
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(results),'roles':4,'viewports':6,'liveWrites':False}))
