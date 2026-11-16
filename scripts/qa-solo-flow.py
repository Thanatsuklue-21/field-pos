"""Solo-operator full cycle: sell → make → hand over, counting every tap.

All APIs are intercepted with a stateful mock queue; no live writes.
Scenarios at 390x844 (phone) and 800x1280 (tablet):
  A) customer waiting at the counter: menu → pay → confirm → make now →
     done → hand over now (pager call + pickup in one server action).
  B) line of customers: two sales back to back using "take next order",
     then both cups are made and handed over in FIFO order.
  C) sweetness change from the cart chip moves exactly one cup.
Start `npm run build` then `npm start` first.
"""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://127.0.0.1:3000')
parser.add_argument('--browser',default='')
parser.add_argument('--output',default='/tmp/field-solo-flow')
args=parser.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True)

MENU=[{'id':'thai-tea','name':'ชาไทยเย็น','category':'TEA','price':55,'enabled':True,'available':True,'maxServings':20,'lowStock':False,'variants':[
  {'label':l,'available':True,'maxServings':20,'lowStock':False,'recipeItems':{'tea':1},'missingIngredients':[],'reason':None} for l in ['100%','50%','0%']]}]

def run(p,width,height):
    launch={'args':['--no-sandbox']}
    if args.browser:launch['executable_path']=args.browser
    browser=p.chromium.launch(**launch)
    ctx=browser.new_context(viewport={'width':width,'height':height},has_touch=True,is_mobile=width<700)
    page=ctx.new_page();page.set_default_timeout(15000)
    state={'orders':[],'rev':10,'seq':0,'checkouts':[],'actions':[]};errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def snapshot():return {'revision':state['rev'],'orders':state['orders']}
    def handler(route):
        req=route.request;path=req.url.split('/api/')[-1].split('?')[0];method=req.method
        if path=='auth/session':data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
        elif path=='pos/bootstrap':data={'revision':1,'menu':MENU,'availabilityStock':{'tea':{'qty':100,'name':'Tea'}},'settings':{}}
        elif path=='pos/checkout' and method=='POST':
            body=json.loads(req.post_data or '{}');state['checkouts'].append(body);state['seq']+=1;n=state['seq']
            items=[{'id':c['id'],'name':'ชาไทยเย็น','variant':c['variant'],'qty':c['qty'],'readyQty':0,'calledQty':0} for c in body['cart']]
            total=55*sum(c['qty'] for c in body['cart'])
            state['orders'].append({'id':f'o{n}','queueNo':f'Q00{n}','pagerNo':n,'status':'assigned','time':1000+n,'items':items});state['rev']+=1
            data={'ok':True,'orderId':f'o{n}','queueNo':f'Q00{n}','pager':n,'billNo':f'B00{n}','saleIds':[f's{n}'],'total':total,'received':body.get('received',total),'change':body.get('received',total)-total,'revision':state['rev']}
        elif path=='pos/queue' and method=='GET':data=snapshot()
        elif path=='pos/queue' and method=='POST':
            body=json.loads(req.post_data or '{}');state['actions'].append(body['action'])
            order=next(o for o in state['orders'] if o['id']==body['orderId'])
            head=next((o for o in state['orders'] if not all(i['calledQty']>=i['qty'] for i in o['items'])),None)
            if body['action']=='complete_item':
                assert head and head['id']==order['id'],'FIFO violated'
                order['items'][body['itemIndex']]['readyQty']=order['items'][body['itemIndex']]['qty'];order['status']='making'
            elif body['action']=='handoff_now':
                assert all(i['readyQty']>=i['qty'] for i in order['items']),'handoff before ready'
                assert head and head['id']==order['id'],'FIFO violated'
                state['orders'].remove(order)
            elif body['action']=='call':
                for i in order['items']:i['calledQty']=i['qty']
                order['status']='ready'
            elif body['action']=='return':state['orders'].remove(order)
            state['rev']+=1
            data={'ok':True,'requestKey':body['requestKey'],'performedBy':'owner','orderId':body['orderId'],'action':body['action'],'revision':state['rev'],'orders':state['orders']}
        elif path=='pos/history':data={'sales':[]}
        elif path=='customers':data={'customers':[],'loyalty':{}}
        elif path=='expenses':data={'expenses':[],'businessDate':'2026-11-16','shift':{'id':'shift','status':'open','openingCash':1000},'drawerSnapshot':None}
        elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
        else:data={'health':'ok','metrics':{},'alerts':[],'policy':{'auto':[],'approval':[],'never':[]},'analysis':None}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
    page.route('**/api/**',handler)
    page.goto(args.base_url+'/pos',wait_until='networkidle')
    taps=[0]
    def tap(locator):
        taps[0]+=1;locator.click()
    menu=page.get_by_role('button',name=re.compile('ชาไทยเย็น')).first
    def sell(next_order):
        tap(menu)  # quick add: normal sweetness, no modal
        expect(page.get_by_role('dialog',name=re.compile('ชาไทยเย็น'))).to_have_count(0)
        tap(page.get_by_role('button',name='ชำระเงิน',exact=True).first)
        pay=page.get_by_role('dialog',name=re.compile('ชำระเงิน ฿'))
        tap(pay.get_by_role('button',name=re.compile('รับเงินพอดี')))
        expect(pay.get_by_role('textbox',name='จำนวนเงินที่รับจากลูกค้า')).to_have_value('55')
        tap(pay.get_by_role('button',name='ยืนยันรับเงิน',exact=True))
        handoff=page.get_by_role('dialog',name='ชำระเงินสำเร็จ',exact=True)
        expect(handoff).to_be_visible()
        assert handoff.get_by_role('button').count()==2
        if next_order:
            tap(handoff.get_by_role('button',name=re.compile('รับออเดอร์ถัดไปก่อน')))
            expect(handoff).to_have_count(0)
            expect(page.get_by_text('แตะเมนูที่ลูกค้าสั่ง',exact=True)).to_be_visible()
        else:
            tap(handoff.get_by_role('button',name=re.compile(r'ทำคิว Q\d+ ต่อเลย')))
    def make_and_handover(queue_no,last=True):
        ws=page.get_by_role('dialog',name='งานร้าน FIELD',exact=True)
        expect(ws).to_be_visible()
        card=ws.locator('div.rounded-2xl',has_text=queue_no).first
        done=ws.get_by_role('button',name=re.compile(r'^ทำ .+ ครบ$'))
        expect(done.first).to_be_visible();tap(done.first)
        give=ws.locator('[data-solo-handoff]')
        expect(give).to_be_visible();tap(give)
        if last:
            # Queue empty → back on the menu automatically for the next customer.
            expect(ws).to_have_count(0)
            expect(page.get_by_text('แตะเมนูที่ลูกค้าสั่ง',exact=True)).to_be_visible()
        else:
            expect(ws.get_by_text(re.compile('ส่งมอบ '+queue_no+' แล้ว'))).to_be_visible()
    result={'viewport':f'{width}x{height}'}
    # A) single customer at the counter
    sell(next_order=False);make_and_handover('Q001')
    result['tapsSingleCustomerFullCycle']=taps[0]
    assert state['actions']==['complete_item','handoff_now'],state['actions']
    page.screenshot(path=str(out/f'A-{width}.png'))
    # B) two customers in line: take both orders first, then make in FIFO order
    taps[0]=0;state['actions'].clear()
    sell(next_order=True);sell(next_order=False)
    make_and_handover('Q002',last=False);make_and_handover('Q003')
    result['tapsTwoCustomersFullCycle']=taps[0]
    assert state['actions']==['complete_item','handoff_now','complete_item','handoff_now'],state['actions']
    assert state['orders']==[],state['orders']
    # C) sweetness chip moves exactly one cup
    tap(menu);tap(menu)
    page.get_by_role('button',name='ชำระเงิน',exact=True).first.click()
    pay=page.get_by_role('dialog',name=re.compile('ชำระเงิน ฿110'))
    pay.get_by_role('button',name='ดูรายการ',exact=True).click()
    group=pay.get_by_role('group',name='ความหวาน ชาไทยเย็น').first
    chip=group.get_by_role('button',name='หวานน้อย',exact=True)
    box=chip.bounding_box();assert box and box['height']>=44,box
    chip.click()
    expect(pay.get_by_role('group',name='ความหวาน ชาไทยเย็น')).to_have_count(2)
    expect(page.get_by_role('heading',name='ชำระเงิน ฿110',exact=True)).to_be_visible()
    pay.get_by_role('button',name=re.compile('รับเงินพอดี')).click()
    pay.get_by_role('button',name='ยืนยันรับเงิน',exact=True).click()
    expect(page.get_by_role('dialog',name='ชำระเงินสำเร็จ',exact=True)).to_be_visible()
    cart=sorted((c['variant'],c['qty']) for c in state['checkouts'][-1]['cart'])
    assert cart==[('100%',1),('50%',1)],cart
    result['sweetnessChipMovesOneCup']=True
    result['checkouts']=len(state['checkouts']);result['pageErrors']=errors
    assert not errors,errors
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(out/f'C-{width}.png'))
    browser.close()
    return result

with sync_playwright() as p:
    for w,h in [(390,844),(800,1280)]:
        print(json.dumps(run(p,w,h),ensure_ascii=False),flush=True)
