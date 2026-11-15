"""Android phone/tablet matrix: layout, touch reachability and POS cash flow.

All APIs are intercepted; no live writes. Covers small/old phones to 10-inch
tablets in both orientations, Android large-text setting (130%) and a
low-end CPU (6x throttle). Start `npm run build` then `npm start` first.
"""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://127.0.0.1:3000')
parser.add_argument('--browser',default='')
parser.add_argument('--output',default='/tmp/field-android-matrix')
args=parser.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True)

# (label, width, height, deviceScaleFactor)
DEVICES=[
  ('small-phone',320,640,2),('budget-phone',360,640,2),('common-phone',360,800,3),
  ('mid-phone',384,854,2.8),('pixel',412,915,2.6),('large-phone',430,932,3),
  ('phone-landscape',800,360,3),('7in-tablet',600,960,2),('7in-landscape',960,600,2),
  ('10in-tablet',800,1280,2),('10in-landscape',1280,800,2),('small-landscape',1024,600,1.5),
]
ROUTES=['/pos','/queue','/orders','/expenses','/close','/dashboard','/stock']
UA='Mozilla/5.0 (Linux; Android 13; FIELD-QA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

def handler_for(writes):
    def handler(route):
        path=route.request.url.split('/api/')[-1].split('?')[0]
        if route.request.method!='GET' and path!='telemetry/web-vitals':writes.append(path)
        if path=='auth/session':data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
        elif path=='pos/bootstrap':data={'revision':1,'menu':[{'id':f'm{i}','name':n,'category':'DRINK','price':55+i*5,'enabled':True,'available':True,'maxServings':20,'lowStock':False,'variants':[{'label':'100%','available':True,'maxServings':20,'lowStock':False,'recipeItems':{'milk':1},'missingIngredients':[],'reason':None}]} for i,n in enumerate(['ชาไทยเย็น','ชาเขียวมัทฉะลาเต้เย็นหวานน้อย','กาแฟลาเต้','โกโก้','อเมริกาโน่','ชาใต้'])],'availabilityStock':{'milk':{'qty':200,'name':'Milk'}},'settings':{}}
        elif path in ['pos/queue','queue']:data={'orders':[],'queue':[]}
        elif path=='pos/history':data={'sales':[]}
        elif path=='customers':data={'customers':[],'loyalty':{}}
        elif path=='expenses':data={'expenses':[],'businessDate':'2026-11-16','shift':{'id':'shift','status':'open','openingCash':1000},'drawerSnapshot':None}
        elif path=='management/dashboard':data={'topItems':[],'lowStock':[],'recommendations':[],'analytics':{'purchaseRecommendations':[]},'costQuality':{'status':'ok'}}
        elif path=='stock/overview':data={'revision':1,'ingredients':[{'id':'milk','name':'Milk','qty':200,'unit':'g','unitCost':2,'safetyStock':0,'recentPurchases':[]}],'transactions':[],'attention':{'blockedMenus':0,'ingredients':[],'missingReferences':0},'openingInventory':{'revision':1,'items':[]}}
        elif path=='stock/cycle-count/proposals':data={'proposals':[]}
        elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
        else:data={'health':'ok','metrics':{},'alerts':[],'policy':{'auto':[],'approval':[],'never':[]}}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
    return handler

AUDIT_JS="""()=>{
  const vw=innerWidth,vh=innerHeight,issues=[];
  if(document.documentElement.scrollWidth>vw+1)issues.push({kind:'horizontal_overflow',scrollWidth:document.documentElement.scrollWidth,vw});
  // With a modal open, the page behind it is meant to be unreachable: audit the dialog only.
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(d=>d.getBoundingClientRect().height>0);
  const root=dialogs.length?dialogs[dialogs.length-1]:document;
  for(const el of root.querySelectorAll('button,a[href],[role="button"],input,select,textarea')){
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    if(!r.width||!r.height||cs.visibility==='hidden'||cs.display==='none')continue;
    if(r.right<=0||r.bottom<=0||r.left>=vw||r.top>=vh)continue;           // offscreen (scrollable)
    if(el.closest('[aria-hidden="true"],[inert]'))continue;
    const name=(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||el.tagName).trim().slice(0,40);
    if(['BUTTON','A'].includes(el.tagName)||el.getAttribute('role')==='button'){
      if(r.width<43.5||r.height<43.5)issues.push({kind:'small_target',name,w:Math.round(r.width),h:Math.round(r.height)});
    }
    // Is the control's visible centre actually hittable (not covered by another layer)?
    const cx=Math.min(Math.max(r.left+r.width/2,1),vw-1),cy=Math.min(Math.max(r.top+r.height/2,1),vh-1);
    const hit=document.elementFromPoint(cx,cy);
    if(hit&&hit!==el&&!el.contains(hit)&&!hit.contains(el)&&r.top>=0&&r.bottom<=vh){
      const scroller=el.closest('.overflow-auto,.overflow-y-auto,.soft-scroll');
      // A control scrolled under a fixed bar inside its own scroller is reachable by scrolling.
      if(!scroller||scroller.contains(hit))issues.push({kind:'covered',name,by:(hit.getAttribute('aria-label')||hit.className||hit.tagName).toString().slice(0,60)});
    }
  }
  return issues;
}"""

results=[];failures=[]
with sync_playwright() as p:
    launch={'args':['--no-sandbox']}
    if args.browser:launch['executable_path']=args.browser
    browser=p.chromium.launch(**launch)
    for label,w,h,dpr in DEVICES:
        for variant in ['default','large-text','low-end']:
            if variant!='default' and label not in ['small-phone','budget-phone','7in-tablet','10in-landscape']:continue
            ctx=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=w<700,has_touch=True,user_agent=UA,locale='th-TH')
            if variant=='large-text':ctx.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize='130%'})")
            page=ctx.new_page();page.set_default_timeout(15000);errors=[];writes=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.route('**/api/**',handler_for(writes))
            if variant=='low-end':
                cdp=ctx.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',{'rate':6})
            entry={'device':f'{label} {w}x{h}','variant':variant,'routes':{}}
            for route in ROUTES:
                page.goto(args.base_url+route,wait_until='networkidle')
                page.wait_for_timeout(350)
                issues=page.evaluate(AUDIT_JS)
                entry['routes'][route]=issues
                if issues:failures.append({'device':entry['device'],'variant':variant,'route':route,'issues':issues[:6]})
                page.screenshot(path=str(out/f'{label}-{variant}-{route.strip("/")}.png'))
            # Routine cash sale flow on /pos
            page.goto(args.base_url+'/pos',wait_until='networkidle')
            menu=page.get_by_role('button',name=re.compile('ชาไทยเย็น')).first
            menu.scroll_into_view_if_needed()
            t0=page.evaluate('performance.now()');menu.tap()
            page.wait_for_function("()=>/1 แก้ว/.test(document.body.innerText)")
            entry['tapToCartMs']=round(page.evaluate('performance.now()')-t0)
            page.get_by_role('button',name='ชำระเงิน',exact=True).first.click()
            dialog=page.get_by_role('dialog',name=re.compile('ชำระเงิน ฿'))
            expect(dialog).to_be_visible()
            dialog.get_by_role('button',name=re.compile('พอดี')).click()
            confirm=dialog.get_by_role('button',name='ยืนยันรับเงิน',exact=True)
            confirm.scroll_into_view_if_needed();expect(confirm).to_be_enabled()
            box=confirm.bounding_box();vh=page.viewport_size['height']
            entry['confirmReachable']=bool(box and box['y']>=0 and box['y']+box['height']<=vh and box['height']>=44)
            if not entry['confirmReachable']:failures.append({'device':entry['device'],'variant':variant,'route':'/pos payment','issues':[{'kind':'confirm_unreachable','box':box}]})
            issues=page.evaluate(AUDIT_JS)
            if issues:failures.append({'device':entry['device'],'variant':variant,'route':'/pos payment dialog','issues':issues[:6]})
            page.screenshot(path=str(out/f'{label}-{variant}-payment.png'))
            entry['pageErrors']=errors;entry['writes']=writes
            if errors:failures.append({'device':entry['device'],'variant':variant,'route':'*','issues':[{'kind':'page_error','errors':errors[:3]}]})
            assert not writes,writes
            results.append({k:v for k,v in entry.items() if k!='routes'})
            ctx.close()
    browser.close()
for r in results:print(json.dumps(r,ensure_ascii=False))
print(json.dumps({'failures':len(failures)},ensure_ascii=False))
for f in failures:print(json.dumps(f,ensure_ascii=False))
