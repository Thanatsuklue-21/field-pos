"""Production-build browser regression. Test APIs are intercepted; no live writes.
Requires Python Playwright and Chromium; start npm run build then npm start.
"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://localhost:3000')
parser.add_argument('--browser',default='/usr/bin/chromium')
parser.add_argument('--output',default='/tmp/field-outbox-qa')
args=parser.parse_args()
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=args.browser,args=['--no-sandbox'])
    for width,height in [(320,640),(360,740),(390,844),(412,915),(430,932),(768,1024),(1024,768)]:
        context=browser.new_context(viewport={'width':width,'height':height})
        context.add_init_script("window.__fieldOpen=indexedDB.open.bind(indexedDB); indexedDB.open=()=>{throw new DOMException('Storage blocked','SecurityError')};")
        page=context.new_page();page.set_default_timeout(30000);writes=[];errors=[]
        page.on('pageerror',lambda error:(errors.append(str(error)),print('PAGE ERROR:',error)))
        def handler(route):
            path=route.request.url.split('/api/')[-1]
            if route.request.method!='GET':writes.append(path)
            if path=='auth/session':
                data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
            elif path=='pos/bootstrap':
                data={'revision':1,'menu':[{'id':'test-menu','name':'เมนูทดสอบ','category':'TEST','price':55,'enabled':True,'available':True,'maxServings':20,'lowStock':False,'variants':[{'label':'100%','available':True,'maxServings':20,'lowStock':False,'recipeItems':{'matcha':5},'missingIngredients':[],'reason':None}]}],'availabilityStock':{'matcha':{'qty':100,'name':'Matcha'}},'settings':{}}
            elif path=='customers':data={'customers':[],'loyalty':{}}
            elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
            elif path=='ai/chat':data={'answer':'ตรวจงานร้านจากข้อมูลทดสอบแล้ว','actions':[],'mode':'rules','snapshot':{'health':'ok','metrics':{},'alerts':[],'policy':{'auto':[],'approval':[],'never':[]}}}
            else:data={'health':'ok','metrics':{},'alerts':[],'policy':{'auto':[],'approval':[],'never':[]}}
            route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        page.route('**/api/**',handler)
        page.goto(args.base_url+'/pos')
        warning=page.get_by_role('alert').filter(has_text='ยังอ่านบิล Offline ในเครื่องไม่ได้')
        expect(warning).to_be_visible(timeout=30000)
        expect(warning).to_contain_text('อย่าล้างข้อมูลเบราว์เซอร์')
        page.get_by_role('button',name=re.compile('เมนูทดสอบ')).first.click()
        context.set_offline(True)
        page.get_by_role('button',name='ชำระเงิน',exact=True).click()
        page.get_by_role('button',name=re.compile('พอดี')).click()
        page.get_by_role('button',name='บันทึกเงินสด Offline',exact=True).click()
        expect(page.get_by_text('เครื่องนี้ไม่สามารถเปิดพื้นที่เก็บ Offline ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนขาย',exact=True)).to_be_visible()
        assert not writes, writes
        expect(page.get_by_role('button',name='รับออเดอร์ถัดไป',exact=True)).to_have_count(0)
        payment=page.locator('div.fixed.inset-0').filter(has=page.get_by_role('heading',name='รับเงิน ฿55',exact=True))
        payment.locator('button').first.click()
        # Restore real IndexedDB, then perform a read-only retry while still offline.
        page.evaluate('indexedDB.open=window.__fieldOpen')
        page.get_by_role('button',name='อ่านรายการ Offline อีกครั้ง',exact=True).click()
        expect(warning).to_have_count(0)
        expect(page.get_by_role('button',name='ชำระเงิน',exact=True)).to_be_enabled()
        assert not writes, writes
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors, errors
        # The assistant must remain reachable without a floating Checkout blocker.
        expect(page.get_by_role('button',name='FIELD AI Supervisor',exact=True)).to_have_count(0)
        context.set_offline(False)
        page.get_by_role('button',name='งานร้าน',exact=True).click()
        page.get_by_role('button',name='ถามผู้ช่วยเรื่องงานร้าน',exact=True).click()
        expect(page.get_by_role('dialog',name='งานร้าน FIELD',exact=True)).to_have_count(0)
        expect(page.get_by_text('ตรวจงานร้านจากข้อมูลทดสอบแล้ว',exact=True)).to_be_visible()
        assert writes==['ai/chat'], writes
        assert not errors, errors
        page.screenshot(path=str(output/f'outbox-recovered-{width}.png'),full_page=True)
        results.append({'viewport':[width,height],'unreadable_outbox_blocks_offline_sale':True,'read_only_recovery_preserves_cart':True,'financial_writes':[],'assistant_requests':writes,'page_errors':errors})
        context.close()
    browser.close()
(output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'result':'pass','scenarios':len(results),'output':str(output)}))
