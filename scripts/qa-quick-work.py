"""Count explicit common-path taps and check compact stock entry. All writes are mocked."""
import argparse,json,re
from datetime import datetime,timedelta,timezone
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://localhost:3000');parser.add_argument('--browser',default='');parser.add_argument('--output',default='/tmp/field-quick-work');parser.add_argument('--part',choices=['all','front','stock'],default='all');parser.add_argument('--short-only',action='store_true');args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);results=[]
today=datetime.now(timezone(timedelta(hours=7))).date();old=(today-timedelta(days=3)).isoformat();yesterday=(today-timedelta(days=1)).isoformat();today=today.isoformat()
with sync_playwright() as p:
    launch={'args':['--no-sandbox']}
    if args.browser:launch['executable_path']=args.browser
    browser=p.chromium.launch(**launch)
    for width,height in [(320,740),(360,740),(390,844),(412,915),(430,932),(768,1024),(1024,768),(1280,800),(390,500)]:
        if args.short_only and height>600:continue
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=True);page=context.new_page();errors=[];writes=[];bootstraps=[];counts={};steps={};scene={"catalogEmpty":False}
        def tap_step(control,flow,label):
            control.tap();steps.setdefault(flow,[]).append(label)
        page.on('pageerror',lambda e:errors.append(str(e)))
        purchase={'id':'past-purchase','stockTransactionId':'past-tx','supplier':'ร้านเดิม','purchaseDate':old,'packageQty':1,'packageUnit':'ถุง','packSize':1000,'packSizeUnit':'g','quantityReceived':1000,'usageUnit':'g','totalCost':120.5,'unitCost':.1205,'sourceUrl':'https://example.com/item','imageUrl':'','note':'ข้อมูลเดิม','createdAt':1,'conversionApproximate':False,'paymentMethod':'bank','cancelled':False}
        ingredient={'id':'matcha','name':'วัตถุดิบทดสอบ','qty':1000,'unit':'g','safetyStock':0,'unitCost':.1205,'costStatus':'CONFIRMED','costKind':'other','wasteMargin':0,'lowStock':False,'archived':False,'recentPurchases':[purchase],'purchaseProfile':{'packageUnit':'ถุง','packSize':1000,'packSizeUnit':'g','quantityPerPackage':1000,'usageUnit':'g','purchaseDate':old,'purchaseCost':120.5}}
        def handler(route):
            path=route.request.url.split('/api/')[-1];method=route.request.method;status=200
            if method!='GET' and path!='telemetry/web-vitals':writes.append({'path':path,'body':json.loads(route.request.post_data or '{}')})
            if path=='auth/session':data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
            elif path.startswith('pos/bootstrap'):
                bootstraps.append(path)
                variant=lambda label:{'label':label,'available':True,'maxServings':20,'lowStock':False,'recipeItems':{'matcha':5},'missingIngredients':[],'reason':None}
                data={'revision':1,'menu':[{'id':'single','name':'เมนูเดี่ยวทดสอบ','category':'ONE','price':55.5,'enabled':True,'available':True,'maxServings':20,'lowStock':False,'variants':[variant('50%')]},{'id':'multi','name':'เมนูหลายสูตรทดสอบ','category':'TWO','price':65.25,'enabled':True,'available':True,'maxServings':20,'lowStock':False,'variants':[variant('100%'),variant('0%')]}],'availabilityStock':{'matcha':{'qty':100,'name':'Matcha'}},'settings':{}}
                if scene['catalogEmpty']:data['menu']=[]
            elif path=='customers':data={'customers':[],'loyalty':{}}
            elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
            elif path=='pos/checkout' and method=='POST':
                body=writes[-1]['body'];total=55.5 if body['cart'][0]['id']=='single' else 65.25
                data={'ok':True,'orderId':'order-'+body['cart'][0]['id'],'queueNo':'Q001','pager':7,'billNo':'B001','saleIds':['sale'],'total':total,'received':total,'change':0,'revision':2}
            elif path=='stock/overview':data={'revision':1,'ingredients':[ingredient],'transactions':[],'attention':{'blockedMenus':0,'ingredients':[],'missingReferences':0}}
            elif path=='stock/cycle-count/proposals':data={'proposals':[]}
            elif path=='stock/transactions' and method=='POST':
                body=writes[-1]['body'];status=201;data={'ok':True,'transaction':{'requestKey':body['requestKey'],'createdBy':'owner','ingredientId':body['ingredientId'],'type':body['type']}}
            else:data={}
            route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
        page.route('**/api/**',handler)
        if args.part in ['all','front']:
            page.goto(args.base_url+'/pos',wait_until='networkidle');search=page.get_by_placeholder('ค้นหาเมนู เช่น มัทฉะ / กาแฟ',exact=True)
            search.fill('ไม่พบxyz');expect(page.get_by_text('ไม่พบเมนูที่ตรงกับคำค้นหรือหมวดนี้',exact=True)).to_be_visible();requests=len(bootstraps)
            page.get_by_role('button',name='ดูทุกเมนู',exact=True).tap();expect(page.get_by_role('button',name=re.compile('เมนูเดี่ยวทดสอบ'))).to_be_visible();assert len(bootstraps)==requests
            page.get_by_role('button',name='TWO',exact=True).tap();search.fill('เมนูเดี่ยว');page.get_by_role('button',name='ดูทุกเมนู',exact=True).press('Enter');expect(page.get_by_role('button',name=re.compile('เมนูเดี่ยวทดสอบ'))).to_be_visible()
            tap_step(page.get_by_role('button',name=re.compile('เมนูเดี่ยวทดสอบ')),'single','เลือกเมนู');expect(page.get_by_role('dialog')).to_have_count(0)
            search.fill('ไม่พบxyz');page.get_by_role('button',name='ล้างคำค้นเมนู',exact=True).tap();expect(search).to_have_value('');assert not writes
            tap_step(page.get_by_role('button',name='ชำระเงิน',exact=True),'single','ชำระเงิน');dialog=page.get_by_role('dialog',name='ชำระเงิน ฿55.50',exact=True)
            tap_step(dialog.get_by_role('button',name='รับเงินพอดี ฿55.50',exact=True),'single','รับเงินพอดี');tap_step(dialog.get_by_role('button',name='ยืนยันรับเงิน',exact=True),'single','ยืนยันรับเงิน');expect(page.get_by_role('dialog').filter(has_text='ชำระเงินสำเร็จ')).to_be_visible()
            counts['singleCashTaps']=len(steps['single']);assert counts['singleCashTaps']==4;assert writes[-1]['body']['cart']==[{'id':'single','variant':'50%','qty':1}]
            page.reload(wait_until='networkidle');tap_step(page.get_by_role('button',name=re.compile('เมนูหลายสูตรทดสอบ')),'multi','เลือกเมนู');tap_step(page.get_by_role('dialog').get_by_role('button',name=re.compile('ไม่หวาน.*0%')),'multi','เลือกสูตร')
            tap_step(page.get_by_role('button',name='ชำระเงิน',exact=True),'multi','ชำระเงิน');dialog=page.get_by_role('dialog',name='ชำระเงิน ฿65.25',exact=True);tap_step(dialog.get_by_role('button',name='รับเงินพอดี ฿65.25',exact=True),'multi','รับเงินพอดี');tap_step(dialog.get_by_role('button',name='ยืนยันรับเงิน',exact=True),'multi','ยืนยันรับเงิน');expect(page.get_by_role('dialog').filter(has_text='ชำระเงินสำเร็จ')).to_be_visible()
            counts['variantCashTaps']=len(steps['multi']);assert counts['variantCashTaps']==5;assert writes[-1]['body']['cart']==[{'id':'multi','variant':'0%','qty':1}]
            page.reload(wait_until='networkidle');search.fill('ไม่พบxyz');page.screenshot(path=str(out/f'{width}x{height}-search.png'))
            scene['catalogEmpty']=True;page.reload(wait_until='networkidle');expect(page.get_by_text('ยังไม่มีเมนูที่เปิดขาย',exact=True)).to_be_visible();expect(page.get_by_role('button',name='ดูทุกเมนู',exact=True)).to_have_count(0);expect(page.get_by_role('link',name='ไปจัดเมนู',exact=True)).to_have_attribute('href','/products')
        if args.part in ['all','stock']:
            page.goto(args.base_url+'/stock',wait_until='networkidle');tap_step(page.get_by_role('button',name='รับเข้า',exact=True),'purchase','รับเข้า');dialog=page.get_by_role('dialog',name='วัตถุดิบทดสอบ',exact=True)
            # Old receipts must not silently backdate a new receipt.
            expect(dialog.locator('input[type=date]')).to_have_value(today)
            expect(dialog.get_by_label('ราคาซื้อรวม (บาท)',exact=True)).to_have_value('120.5');expect(dialog.get_by_label('จำนวนแพ็ก',exact=True)).to_have_value('1')
            expect(dialog.get_by_label('ร้าน / แหล่งซื้อ',exact=True)).not_to_be_visible();expect(dialog.get_by_label('ช่องทางที่จ่ายค่าของ',exact=True)).to_be_visible()
            for raw in ['-','.','invalid','1e99']:
                dialog.get_by_label('ราคาซื้อรวม (บาท)',exact=True).fill(raw);expect(dialog.get_by_text('ตรวจราคาซื้อ',exact=False)).to_be_visible()
            dialog.get_by_label('ราคาซื้อรวม (บาท)',exact=True).fill('120.5')
            page.screenshot(path=str(out/f'{width}x{height}-purchase.png'))
            confirm=dialog.get_by_role('button',name='ยืนยันและบันทึก',exact=True);box=confirm.bounding_box();assert box and box['height']>=44 and box['y']>=0 and box['y']+box['height']<=height,box
            tap_step(confirm,'purchase','ยืนยันและบันทึก');expect(dialog).to_have_count(0);counts['repeatPurchaseTaps']=len(steps['purchase']);assert counts['repeatPurchaseTaps']==2
            body=writes[-1]['body'];assert body['purchaseDate']==today and body['purchaseCost']==120.5 and body['packageQty']==1 and body['packSize']==1000 and body['purchasePaymentMethod']=='bank',body
            page.get_by_role('button',name='รับเข้า',exact=True).tap();dialog=page.get_by_role('dialog',name='วัตถุดิบทดสอบ',exact=True);dialog.get_by_label('วันที่ซื้อ',exact=True).fill(yesterday)
            dialog.get_by_text('รายละเอียดเพิ่มเติม / ใช้ข้อมูลซื้อเดิม',exact=True).click();dialog.get_by_label('ใช้ข้อมูลซื้อเดิม',exact=True).select_option('past-purchase');expect(dialog.get_by_label('วันที่ซื้อ',exact=True)).to_have_value(yesterday)
            dialog.get_by_label('หมายเหตุรับเข้า',exact=True).fill('ตรวจรายละเอียดแล้ว');dialog.get_by_text('รายละเอียดเพิ่มเติม / ใช้ข้อมูลซื้อเดิม',exact=True).click();confirm=dialog.get_by_role('button',name='ยืนยันและบันทึก',exact=True);confirm.tap();expect(dialog).to_have_count(0)
            assert writes[-1]['body']['purchaseDate']==yesterday and writes[-1]['body']['purchaseNote']=='ตรวจรายละเอียดแล้ว'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors
        assert all(w['path'] in ['pos/checkout','stock/transactions'] for w in writes),writes
        results.append({'width':width,'height':height,**counts,'tapSteps':steps,'errors':errors,'mockedWrites':len(writes),'liveWrites':False});context.close()
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'passed':len(results),'liveWrites':False}))
