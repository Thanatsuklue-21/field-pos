"""Exercise stale-stock taps against intercepted APIs; never writes live data."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://127.0.0.1:3000')
parser.add_argument('--output',default='qa-fifo-precheck')
parser.add_argument('--browser',default='')
args=parser.parse_args()
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(**({'executable_path':args.browser} if args.browser else {}))
    for width in [320,360,390,412]:
        context=browser.new_context(viewport={'width':width,'height':844})
        page=context.new_page();errors=[];state={'sold_out':False,'reads':0}
        page.on('pageerror',lambda error:errors.append(str(error)))
        def handle(route):
            path=route.request.url.split('/api/')[-1]
            if path=='auth/session':
                data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
            elif path=='pos/bootstrap':
                state['reads']+=1
                count=0 if state['sold_out'] else 3
                data={'revision':2 if state['sold_out'] else 1,'menu':[{'id':'milk','name':'FIFO drink','price':50,'category':'TEST','enabled':True,'available':count>0,'maxServings':count,'lowStock':count>0,'variants':[{'label':'S','available':count>0,'maxServings':count,'lowStock':count>0,'recipeItems':{'milk':0.1},'missingIngredients':[] if count else [{'id':'milk','name':'Milk'}]}]}],'availabilityStock':{'milk':{'name':'Milk','qty':0 if state['sold_out'] else 0.3}},'settings':{}}
            elif path=='customers':data={'customers':[],'loyalty':{}}
            elif path=='stock/overview':data={'revision':2,'ingredients':[{'id':'milk','name':'Milk','qty':0,'unit':'g','unitCost':2,'safetyStock':0,'recentPurchases':[]}],'transactions':[],'attention':{'blockedMenus':0,'ingredients':[],'missingReferences':0},'openingInventory':{'revision':2,'items':[{'id':'milk','name':'Milk','qty':10,'unit':'g','capturedAt':None,'costStatus':'PROVISIONAL'}]}}
            elif path=='stock/cycle-count/proposals':data={'proposals':[]}
            elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
            elif route.request.method!='GET' and path!='telemetry/web-vitals':
                raise AssertionError('Unexpected business write: '+path)
            else:data={'queue':[],'metrics':{},'alerts':[],'policy':{'auto':[],'approval':[],'never':[]}}
            route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        page.route('**/api/**',handle)
        page.goto(args.base_url+'/pos',wait_until='networkidle')
        menu=page.get_by_role('button',name='FIFO drink').first
        expect(menu).to_be_enabled()
        before=state['reads'];state['sold_out']=True
        menu.click()
        expect(page.get_by_role('button',name='ชำระเงิน',exact=True)).to_be_disabled()
        expect(menu).to_be_disabled()
        assert state['reads']>before,'Menu tap must fetch server stock before adding'
        assert not errors,errors
        page.screenshot(path=str(output/f'fifo-{width}.png'),full_page=True)
        page.goto(args.base_url+'/stock',wait_until='networkidle')
        opening=page.get_by_text('ยอดยกมาก่อนเปิดใช้จริง',exact=True)
        expect(opening).to_be_visible();opening.click()
        expect(page.get_by_role('list',name='รายการยอดยกมา')).to_contain_text('Milk')
        expect(page.get_by_role('list',name='รายการยอดยกมา')).to_contain_text('10 g')
        context.close()
    browser.close()
print('PASS: server stock changes block stale taps at 320/360/390/412 px; no runtime errors or business writes')
