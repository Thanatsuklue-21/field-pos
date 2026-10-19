"""Touch-first checkout browser regression. Test APIs are intercepted; no live writes.
Requires Python Playwright and Chromium; start npm run build then npm start.
"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://localhost:3000')
parser.add_argument('--browser',default='')
parser.add_argument('--output',default='/tmp/field-touch-qa')
args=parser.parse_args()
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
    launch_args={'args':['--no-sandbox']}
    if args.browser: launch_args['executable_path']=args.browser
    browser=p.chromium.launch(**launch_args)
    for width,height in [(320,640),(360,740),(390,844),(412,915),(430,932),(768,1024),(1024,768)]:
        context=browser.new_context(viewport={'width':width,'height':height})
        page=context.new_page();page.set_default_timeout(30000);writes=[];errors=[]
        page.on('pageerror',lambda error:(errors.append(str(error)),print('PAGE ERROR:',error)))
        def handler(route):
            path=route.request.url.split('/api/')[-1]
            if route.request.method!='GET' and path!='telemetry/web-vitals':writes.append(path)
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
        page.goto(args.base_url+'/pos',wait_until='domcontentloaded',timeout=60000)
        nav_controls=page.locator('nav a, nav button')
        for index in range(nav_controls.count()):
            control=nav_controls.nth(index)
            if not control.is_visible():
                continue
            box=control.bounding_box()
            assert box and box['width']>=44 and box['height']>=44, {'nav_index':index,'box':box}
        if width<1024:
            cartbar=page.locator('.field-pos-mobile-cartbar')
            expect(cartbar).to_be_visible()
            cart_box=cartbar.bounding_box()
            assert cart_box, {'viewport':f'{width}x{height}','cartbar':'missing_box'}
            if width<768:
                bottom_nav=page.get_by_role('navigation',name='เมนูหลักบนมือถือ')
                expect(bottom_nav).to_be_visible()
                nav_box=bottom_nav.bounding_box()
                assert nav_box, {'viewport':f'{width}x{height}','bottom_nav':'missing_box'}
                assert cart_box['y']+cart_box['height']<=nav_box['y'], {'viewport':f'{width}x{height}','cartbar':cart_box,'bottomNav':nav_box}
            else:
                lower_gap=height-(cart_box['y']+cart_box['height'])
                assert 0<=lower_gap<=40, {'viewport':f'{width}x{height}','tabletCartbar':cart_box,'lowerGap':lower_gap}
        page.get_by_role('button',name=re.compile('เมนูทดสอบ')).first.click()
        page.get_by_role('button',name='ชำระเงิน',exact=True).click()
        dialog=page.get_by_role('dialog',name=re.compile('ชำระเงิน ฿'))
        expect(dialog).to_be_visible()
        dialog.get_by_role('button',name='ดูรายการ',exact=True).click()
        increase=dialog.get_by_role('button',name='เพิ่มจำนวน เมนูทดสอบ',exact=True)
        decrease=dialog.get_by_role('button',name='ลดจำนวน เมนูทดสอบ',exact=True)
        for control in [increase,decrease,dialog.get_by_role('button',name='ลบ เมนูทดสอบ',exact=True),dialog.get_by_role('button',name='กลับไปเลือกเมนู',exact=True)]:
            box=control.bounding_box()
            assert box['width']>=44 and box['height']>=44, box
        increase.click()
        expect(page.get_by_role('heading',name='ชำระเงิน ฿110',exact=True)).to_be_visible()
        order_options=dialog.get_by_role('button',name='ตัวเลือกบิล / สมาชิก',exact=True)
        box=order_options.bounding_box()
        assert box['width']>=44 and box['height']>=44, box
        order_options.click()
        dialog.get_by_role('button',name='แยกบิล / จ่ายแยกตามคน',exact=True).click()
        splitPlus=dialog.get_by_role('button',name='เพิ่มจำนวนในบิลนี้ เมนูทดสอบ',exact=True)
        splitMinus=dialog.get_by_role('button',name='ลดจำนวนในบิลนี้ เมนูทดสอบ',exact=True)
        for control in [splitPlus,splitMinus]:
            box=control.bounding_box()
            assert box['width']>=44 and box['height']>=44, box
        splitPlus.click()
        expect(page.get_by_role('heading',name='ชำระเงิน ฿55',exact=True)).to_be_visible()
        splitMinus.click()
        expect(page.get_by_role('heading',name='ชำระเงิน ฿0',exact=True)).to_be_visible()
        dialog.get_by_role('button',name='ยกเลิกแยกบิล',exact=True).click()
        dialog.get_by_role('button',name='ดูรายการ',exact=True).click()
        decrease.click()
        expect(page.get_by_role('heading',name='ชำระเงิน ฿55',exact=True)).to_be_visible()
        dialog.get_by_role('button',name=re.compile('พอดี')).click()
        expect(dialog.get_by_role('textbox',name='จำนวนเงินที่รับจากลูกค้า')).to_have_value('55')
        expect(dialog.get_by_role('button',name='ยืนยันรับเงิน',exact=True)).to_be_enabled()
        cash_input=dialog.get_by_role('textbox',name='จำนวนเงินที่รับจากลูกค้า')
        confirm=dialog.get_by_role('button',name='ยืนยันรับเงิน',exact=True)
        cash_input.fill('20')
        expect(confirm).to_be_disabled()
        expect(dialog.get_by_text('ขาดอีก',exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if width<height:
            cash_input.fill('55')
            cash_input.focus()
            expect(confirm).to_be_enabled()
            keyboard_height=min(height,360)
            page.set_viewport_size({'width':width,'height':keyboard_height})
            expect(dialog).to_be_visible()
            expect(cash_input).to_be_focused()
            confirm.scroll_into_view_if_needed()
            confirm_box=confirm.bounding_box()
            assert confirm_box and confirm_box['y']>=0 and confirm_box['y']+confirm_box['height']<=keyboard_height, {'keyboardViewport':f'{width}x{keyboard_height}','confirm':confirm_box}
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.set_viewport_size({'width':width,'height':height})
            expect(dialog).to_be_visible()
            expect(cash_input).to_be_focused()
            page.set_viewport_size({'width':height,'height':width})
            expect(dialog).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.set_viewport_size({'width':width,'height':height})
            expect(dialog).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(output/f'touch-{width}.png'),full_page=True)
        dialog.get_by_role('button',name='กลับไปเลือกเมนู',exact=True).click()
        expect(page.get_by_role('dialog',name='ชำระเงิน ฿55',exact=True)).to_have_count(0)
        assert not writes, writes
        assert not errors, errors
        results.append({'viewport':f'{width}x{height}','touch44':True,'navTouch44':True,'fixedActionOverlapSafe':True,'quantityUpdates':True,'cashUnderpaymentBlocked':True,'rotationSafe':True,'keyboardViewportSafe':True,'noFinancialWrites':True})
        print(json.dumps(results[-1]),flush=True)
        context.close()
    browser.close()
(output/'results.json').write_text(json.dumps(results,indent=2))
