"""Real browser / IndexedDB QA with intercepted HTTP; no production writes."""
import argparse,json,re
from decimal import Decimal
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://localhost:3100');parser.add_argument('--output',default='../vnext-report/browser-v81');args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
bootstrap={'revision':1,'menu':[{'id':'tea','name':'ชาทดสอบสตางค์','category':'TEST','price':55.25,'enabled':True,'available':True,'maxServings':3,'lowStock':True,'variants':[{'label':'100%','available':True,'maxServings':3,'lowStock':True,'recipeItems':{'milk':2},'missingIngredients':[],'reason':None}]}],'availabilityStock':{'milk':{'qty':6,'name':'Milk'}},'settings':{}}
read_db="""async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('field-pos-client',2);r.onsuccess=()=>ok(r.result);r.onerror=no});try{return await new Promise((ok,no)=>{const tx=db.transaction(['cache','cash-outbox'],'readonly'),c=tx.objectStore('cache').get('/api/pos/bootstrap'),o=tx.objectStore('cash-outbox').getAll();tx.oncomplete=()=>ok({cache:c.result,outbox:o.result});tx.onerror=no})}finally{db.close()}}"""
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(args=['--no-sandbox'])
    for width in [320,390,768]:
        context=browser.new_context(viewport={'width':width,'height':844});page=context.new_page();page.set_default_timeout(15000);posts=[];errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        def handler(route):
            path=route.request.url.split('/api/')[-1]
            if path=='auth/session':data={'user':{'id':'qa-owner','username':'qa-owner','role':'admin','permissions':{}},'csrf':'fixture-only'}
            elif path=='pos/bootstrap':data=bootstrap
            elif path=='customers':data={'customers':[],'loyalty':{}}
            elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
            elif path=='pos/checkout':
                b=route.request.post_data_json;posts.append(b)
                total=Decimal('55.25')*sum(x['qty'] for x in b['cart']);received=Decimal(str(b['received']))
                data={'ok':True,'orderId':'qa-order','queueNo':'Q001','pager':7,'saleIds':['qa-sale'],'total':float(total),'received':float(received),'change':float(received-total),'revision':2}
            else:data={}
            route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        page.route('**/api/**',handler);page.goto(args.base_url+'/pos',wait_until='domcontentloaded')
        page.get_by_role('button',name=re.compile('ชาทดสอบสตางค์')).first.click();page.get_by_role('button',name='ชำระเงิน',exact=True).click()
        payment=page.get_by_role('dialog',name='ชำระเงิน ฿55.25',exact=True);expect(payment).to_be_visible()
        payment.get_by_role('textbox',name='จำนวนเงินที่รับจากลูกค้า').fill('100.10')
        expect(payment.get_by_text('฿44.85',exact=True)).to_be_visible()
        page.screenshot(path=str(out/f'payment-satang-{width}.png'),full_page=True)
        payment.get_by_role('button',name='ยืนยันรับเงิน',exact=True).click();expect(page.get_by_role('dialog',name='ชำระเงินสำเร็จ',exact=True)).to_be_visible()
        assert len(posts)==1 and posts[0]['received']==100.1
        page.get_by_role('button',name='ทำคิว Q001 ต่อเลย',exact=True).click();page.get_by_role('button',name='ปิดงานร้าน',exact=True).click()
        # Await the actual persisted catalog, then sell offline without API writes.
        page.wait_for_function("async()=>{try{const r=indexedDB.open('field-pos-client',2);const db=await new Promise(ok=>r.onsuccess=()=>ok(r.result));const tx=db.transaction('cache','readonly'),v=await new Promise(ok=>{const q=tx.objectStore('cache').get('/api/pos/bootstrap');q.onsuccess=()=>ok(q.result)});db.close();return !!v?.value}catch{return false}}")
        page.get_by_role('button',name=re.compile('ชาทดสอบสตางค์')).first.click();context.set_offline(True)
        page.get_by_role('button',name='ชำระเงิน',exact=True).click();payment=page.get_by_role('dialog',name='ชำระเงิน ฿55.25',exact=True)
        payment.get_by_role('textbox',name='จำนวนเงินที่รับจากลูกค้า').fill('100.10');payment.get_by_role('button',name='บันทึกเงินสด Offline',exact=True).click()
        expect(page.get_by_role('dialog',name='บันทึกเงินสดไว้ในเครื่องแล้ว',exact=True)).to_be_visible()
        data=page.evaluate(read_db);assert len(data['outbox'])==1 and data['cache']['value']['availabilityStock']['milk']['qty']==4,data
        assert data['outbox'][0]['body']['total']==55.25 and data['outbox'][0]['body']['received']==100.1
        page.screenshot(path=str(out/f'offline-committed-{width}.png'),full_page=True)
        # Re-read both stores in a fresh transaction after the receipt.
        persisted=page.evaluate(read_db)
        assert len(persisted['outbox'])==1 and persisted['cache']['value']['availabilityStock']['milk']['qty']==4
        assert not errors,errors
        results.append({'width':width,'satangVisible':True,'change':44.85,'onlineWrites':len(posts),'offlineBillCount':1,'committedStock':4,'pageErrors':errors,'scope':'mock APIs + real browser IndexedDB; physical process kill not tested'})
        context.close()
    # Labels and errors of the real sign-in UI are observable by accessibility APIs.
    context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page()
    def login_route(route):
        path=route.request.url.split('/api/')[-1]
        route.fulfill(status=401 if path in ['auth/session','auth/login'] else 200,content_type='application/json',body=json.dumps({'error':'invalid_credentials'} if path=='auth/login' else {}))
    page.route('**/api/**',login_route);page.goto(args.base_url+'/pos')
    page.get_by_label('ชื่อผู้ใช้',exact=True).fill('qa-only');page.get_by_label('รหัสผ่าน',exact=True).fill('dummy-fixture-password')
    page.get_by_role('button',name='เข้าสู่ระบบ',exact=True).click();expect(page.get_by_role('alert').filter(has_text='ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')).to_be_visible()
    page.screenshot(path=str(out/'login-labelled-error.png'),full_page=True);context.close();browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'result':'pass','viewports':len(results),'satangAndAtomicStorage':True,'loginLabels':True}))
