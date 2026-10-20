"""Stock guidance and unavailable menu readability. API writes are intercepted."""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://localhost:3000');parser.add_argument('--browser',default='');parser.add_argument('--output',default='/tmp/field-stock-attention');args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);results=[]
def contrast(fg,bg):
    def lum(color):
        rgb=[float(v)/255 for v in re.findall(r'[\d.]+',color)[:3]]
        return sum((v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4)*w for v,w in zip(rgb,[.2126,.7152,.0722]))
    a,b=lum(fg),lum(bg);return (max(a,b)+.05)/(min(a,b)+.05)
with sync_playwright() as p:
    launch={'args':['--no-sandbox']}
    if args.browser:launch['executable_path']=args.browser
    browser=p.chromium.launch(**launch)
    for width,height in [(320,740),(360,740),(390,844),(412,915),(1024,900)]:
      for role in ['admin','stock']:
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=True);page=context.new_page();errors=[];writes=[];scenario={'mode':'shortage'}
        page.on('pageerror',lambda e:errors.append(str(e)))
        def handler(route):
            path=route.request.url.split('/api/')[-1]
            if route.request.method!='GET' and path!='telemetry/web-vitals':writes.append(path)
            status=200
            if path=='auth/session':data={'user':{'id':role,'username':role,'role':'staff' if scenario.get('cashier') else ('admin' if role=='admin' else 'staff'),'permissions':{'order':True} if scenario.get('cashier') else {'stock':True}},'csrf':'test'}
            elif path=='stock/overview':
                rows=[{'id':id,'name':name,'qty':qty,'unit':'g','safetyStock':0,'unitCost':1,'costStatus':'CONFIRMED','costKind':'other','wasteMargin':0,'lowStock':False,'archived':False,'recentPurchases':[]} for id,name,qty in [('milk','นมทดสอบ',1000 if scenario['mode']=='ready' else 0),('syrup','ไซรัปทดสอบ',1000)]]
                data={'revision':1,'ingredients':rows,'transactions':[],'attention':{'blockedMenus':0 if scenario['mode']=='ready' else 1,'ingredients':[] if scenario['mode']=='ready' else [{'id':'milk','menuNames':['ลาเต้ทดสอบ']}],'missingReferences':0}}
                if scenario['mode']=='missing':del data['attention']
                if scenario['mode']=='error':status=503;data={'error':'test_unavailable'}
            elif path=='stock/cycle-count/proposals':data={'proposals':[]}
            elif path=='pos/bootstrap':data={'revision':1,'menu':[{'id':'latte','name':'ลาเต้ทดสอบ','category':'TEST','price':55,'enabled':True,'available':False,'maxServings':0,'lowStock':False,'variants':[{'label':'normal','available':False,'maxServings':0,'recipeItems':{'milk':100},'missingIngredients':[] if scenario.get('recipe') else [{'id':'milk','name':'นมทดสอบ'}],'reason':'recipe_missing' if scenario.get('recipe') else 'stock_shortage'}]}],'availabilityStock':{'milk':{'name':'นมทดสอบ','qty':0}},'settings':{}}
            elif path=='customers':data={'customers':[],'loyalty':{}}
            elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
            else:data={}
            route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
        page.route('**/api/**',handler)
        page.goto(args.base_url+'/stock?attention=shortage',wait_until='networkidle')
        expect(page.get_by_role('heading',name='วัตถุดิบและบรรจุภัณฑ์',exact=True)).to_be_visible()
        guidance=page.get_by_role('region',name='ของที่ทำให้เมนูหยุดขาย',exact=True);expect(guidance).to_be_visible()
        expect(page.get_by_role('heading',name='นมทดสอบ',exact=True)).to_be_visible();expect(page.get_by_role('heading',name='ไซรัปทดสอบ',exact=True)).to_have_count(0)
        expect(page.get_by_text('กระทบเมนู: ลาเต้ทดสอบ',exact=True)).to_be_visible()
        if role=='admin':
            expect(page.get_by_role('button',name='แก้ข้อมูลวัตถุดิบ',exact=True)).not_to_be_visible()
            page.get_by_text('จัดการข้อมูลวัตถุดิบ',exact=True).click();expect(page.get_by_role('button',name='แก้ข้อมูลวัตถุดิบ',exact=True)).to_be_visible()
        else:expect(page.get_by_text('จัดการข้อมูลวัตถุดิบ',exact=True)).to_have_count(0)
        search=page.get_by_role('textbox',name='ค้นหาวัตถุดิบ / บรรจุภัณฑ์',exact=True);search.fill('หาไม่พบ')
        expect(page.get_by_text('ไม่พบรายการตามคำค้น',exact=True)).to_be_visible();search.fill('')
        page.get_by_role('heading',name='วัตถุดิบและบรรจุภัณฑ์',exact=True).scroll_into_view_if_needed();page.screenshot(path=str(out/f'{width}-{role}-shortage.png'))
        page.get_by_role('button',name='ดูวัตถุดิบทั้งหมด',exact=True).tap();expect(page.get_by_role('heading',name='ไซรัปทดสอบ',exact=True)).to_be_visible()
        page.get_by_role('button',name='เฉพาะของที่ทำให้เมนูหยุดขาย',exact=True).press('Enter');expect(page.get_by_role('heading',name='ไซรัปทดสอบ',exact=True)).to_have_count(0)
        scenario['mode']='ready';guidance.get_by_role('button',name='ตรวจข้อมูลล่าสุด',exact=True).click();expect(guidance.get_by_text('ไม่พบของขาดที่ทำให้เมนูหยุดขายจากข้อมูลล่าสุด',exact=True)).to_be_visible()
        scenario['mode']='error';guidance.get_by_role('button',name='ตรวจข้อมูลล่าสุด',exact=True).click();expect(page.get_by_role('alert').filter(has_text='ยังโหลดข้อมูลสต็อกล่าสุดไม่ได้')).to_be_visible();expect(page.get_by_text('ไม่พบของขาดที่ทำให้เมนูหยุดขายจากข้อมูลล่าสุด',exact=True)).to_have_count(0)
        scenario['mode']='missing';page.reload(wait_until='networkidle');expect(page.get_by_text('ยังอ่านรายการของขาดไม่ได้ กรุณาตรวจข้อมูลล่าสุดอีกครั้ง',exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        if role=='admin':
            page.goto(args.base_url+'/pos',wait_until='networkidle');card=page.locator('.pos-menu-card');expect(card).to_be_disabled()
            expect(page.get_by_text('แตะเมนูที่ลูกค้าสั่ง',exact=True)).to_have_count(0)
            styles=card.evaluate('(e)=>{const s=getComputedStyle(e);return {opacity:s.opacity,fg:s.color,bg:s.backgroundColor}}')
            assert float(styles['opacity'])==1,styles
            for el in [card.locator('b'),card.locator('small').last,card.get_by_text('หมดชั่วคราว',exact=True)]:
                color=el.evaluate('(e)=>{const s=getComputedStyle(e),c=document.createElement("canvas");c.width=c.height=1;const ctx=c.getContext("2d");function rgb(value){ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const d=ctx.getImageData(0,0,1,1).data;return d[3]===0?"transparent":"rgb("+d[0]+","+d[1]+","+d[2]+")"}return {fg:rgb(s.color),bg:rgb(s.backgroundColor)}}');bg=color['bg'] if color['bg'] not in ['rgba(0, 0, 0, 0)','transparent'] else styles['bg'];assert contrast(color['fg'],bg)>=4.5,color
            card.locator('small').last.scroll_into_view_if_needed();page.screenshot(path=str(out/f'{width}-unavailable-menu.png'))
            scenario['cashier']=True;page.reload(wait_until='networkidle');expect(page.get_by_role('button',name='ตรวจสต็อกตรงนี้',exact=True)).to_have_count(0);expect(page.get_by_text('ให้ผู้ดูแลสต็อกหรือเจ้าของร้านตรวจของจริงก่อนขาย',exact=True)).to_be_visible()
            scenario.update(cashier=False,recipe=True);page.reload(wait_until='networkidle');expect(page.get_by_role('button',name='ตรวจสต็อกตรงนี้',exact=True)).to_have_count(0);expect(page.get_by_text('ให้เจ้าของร้านตรวจสูตรและสถานะเมนูก่อนขาย',exact=True)).to_be_visible()
        assert not errors,errors;assert not writes,writes
        results.append({'width':width,'role':role,'errors':errors,'writes':writes});context.close()
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'passed':len(results),'liveWrites':False}))
