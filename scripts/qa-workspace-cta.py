"""Workspace CTA / computed contrast regression; intercepted APIs only, no live writes."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://localhost:3000')
parser.add_argument('--browser',default='')
parser.add_argument('--output',default='/tmp/field-workspace-cta')
args=parser.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
    launch={'args':['--no-sandbox']}
    if args.browser:launch['executable_path']=args.browser
    browser=p.chromium.launch(**launch)
    for width,height in [(320,740),(360,740),(390,844),(412,915),(768,1024)]:
        for mode in ['mouse','touch','Enter','Space']:
            context=browser.new_context(viewport={'width':width,'height':height},has_touch=True)
            page=context.new_page();errors=[];writes=[];scenario={'shift':True,'stock':True}
            page.on('pageerror',lambda e:errors.append(str(e)))
            def handler(route):
                path=route.request.url.split('/api/')[-1]
                if route.request.method!='GET' and path!='telemetry/web-vitals':writes.append(path)
                if path=='auth/session':data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
                elif path=='pos/bootstrap':data={'revision':1,'menu':[{'id':'latte','name':'Matcha Latte','category':'TEST','price':55,'enabled':True,'available':False,'maxServings':0,'lowStock':False,'variants':[{'label':'100%','available':False,'maxServings':0,'lowStock':False,'recipeItems':{'milk':100},'missingIngredients':[{'id':'milk','name':'นม Meiji'}],'reason':None}]}] if scenario['stock'] else [],'availabilityStock':{},'settings':{}}
                elif path=='pos/queue':data={'orders':[]}
                elif path=='pos/history':data={'sales':[]}
                elif path=='expenses':data={'expenses':[],'businessDate':'2026-10-20','shift':{'id':'shift','status':'open','openingCash':1000} if scenario['shift'] else None,'drawerSnapshot':None}
                elif path=='control-center':data={'analysis':None}
                elif path=='customers':data={'customers':[],'loyalty':{}}
                else:data={'ready':False,'configured':False}
                route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
            page.route('**/api/**',handler)
            page.goto(args.base_url+'/pos',wait_until='domcontentloaded')
            page.get_by_role('button',name='งานร้าน',exact=True).click()
            dialog=page.get_by_role('dialog',name='งานร้าน FIELD');cta=dialog.get_by_role('button',name='ทำตามนี้',exact=True)
            expect(cta).to_be_visible();box=cta.bounding_box();assert box['width']>=44 and box['height']>=44
            # It starts on stock already: action must still expose a new, focused guide.
            expect(page.locator('#workspace-task-stock')).to_be_visible()
            expect(page.locator('#workspace-stock-guidance')).to_have_count(0)
            if mode=='mouse':cta.click()
            elif mode=='touch':cta.tap()
            else:cta.focus();cta.press(mode)
            guide=page.locator('#workspace-stock-guidance');expect(guide).to_be_visible();expect(guide).to_be_focused()
            expect(guide.get_by_text('ขาด นม Meiji',exact=True)).to_be_visible()
            expect(guide.get_by_role('link')).to_have_attribute('href','/stock?attention=shortage')
            expect(cta).to_have_attribute('aria-expanded','true')
            assert not errors,errors
            assert not writes,writes
            page.screenshot(path=str(out/f'{width}-{mode}.png'))
            results.append({'width':width,'input':mode,'guide':True,'errors':errors,'writes':writes})
            # Green and disabled buttons use actual computed styles, never faded text.
            scenario.update(shift=False,stock=False)
            page.reload(wait_until='domcontentloaded');page.get_by_role('button',name='งานร้าน',exact=True).click()
            start=page.get_by_role('button',name='เปิดร้านวันนี้',exact=True)
            expect(start).to_be_visible()
            green=page.get_by_role('button',name='เริ่มงาน',exact=True)
            expect(green).to_be_visible()
            start.click()
            expect(page.get_by_role('alertdialog',name='ยืนยันเงินตั้งต้นเปิดร้าน')).to_be_visible()
            expect(start).to_be_disabled()
            confirm=page.get_by_role('button',name='ยืนยันเปิดร้าน',exact=True)
            page.wait_for_timeout(300)  # Existing 200ms color transition must settle before measuring.
            for element in [green,start,confirm]:
                colors=element.evaluate('(e)=>{const s=getComputedStyle(e);return {fg:s.color,bg:s.backgroundColor,opacity:s.opacity}}')
                def lum(rgb):
                    values=[int(x)/255 for x in rgb[rgb.index('(')+1:rgb.index(')')].split(',')[:3]]
                    return sum((v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4)*w for v,w in zip(values,[.2126,.7152,.0722]))
                assert colors['opacity']=='1',colors
                a,b=lum(colors['fg']),lum(colors['bg']);assert (max(a,b)+.05)/(min(a,b)+.05)>=4.5,colors
            scenario['shift']=True
            page.reload(wait_until='domcontentloaded')
            page.get_by_role('button',name='งานร้าน',exact=True).click()
            dialog.get_by_role('button',name='ดูงานอื่น',exact=True).click()
            dialog.get_by_role('button',name='รายจ่าย',exact=True).click()
            dialog.get_by_role('button',name='โอน',exact=True).click()
            dialog.get_by_label('จำนวนเงินค่าใช้จ่ายด่วน').fill('45')
            gold=dialog.get_by_role('button',name='ยืนยันค่าใช้จ่าย',exact=True)
            expect(gold).to_be_enabled()
            page.wait_for_timeout(300)
            colors=gold.evaluate('(e)=>{const s=getComputedStyle(e);return {fg:s.color,bg:s.backgroundColor,opacity:s.opacity}}')
            a,b=lum(colors['fg']),lum(colors['bg']);assert (max(a,b)+.05)/(min(a,b)+.05)>=4.5,colors
            assert not errors,errors
            assert not writes,writes
            context.close()
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(results),'viewports':5,'inputs':4,'liveWrites':False}))
