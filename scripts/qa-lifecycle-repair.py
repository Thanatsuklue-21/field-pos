"""Confirmed stock/settlement defects. Every API is mocked; no live business writes."""
import argparse,json
from datetime import datetime,timezone,timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--base-url',default='http://localhost:3000');parser.add_argument('--output',default='/tmp/field-lifecycle-repair');parser.add_argument('--part',choices=['all','stock','settlement'],default='all');args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);today=datetime.now(timezone(timedelta(hours=7))).date().isoformat();results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 for width,height in [(320,740),(360,740),(390,844),(412,915),(1280,800)]:
  context=browser.new_context(viewport={'width':width,'height':height},has_touch=True);page=context.new_page();errors=[];stock=[];settlements=[];counts=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def handler(route):
   path=route.request.url.split('/api/')[-1];method=route.request.method;status=200;body=json.loads(route.request.post_data or '{}');data={}
   if path=='auth/session':data={'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test'}
   elif path=='stock/overview':data={'revision':1,'ingredients':[{'id':'hotcupset','name':'แก้วร้อนทดสอบ','qty':0,'unit':'set','safetyStock':0,'unitCost':0,'costStatus':'MISSING','costKind':'other','wasteMargin':0,'lowStock':True,'archived':False,'recentPurchases':[]}],'transactions':[]}
   elif path=='stock/cycle-count/proposals':data={'proposals':[]}
   elif path=='stock/cycle-count' and method=='POST':
    counts.append(body)
    if len(counts)==1:status=503;data={'error':'network_unavailable'}
    else:data={'ok':True,'requestKey':body['requestKey'],'cycleCount':{'createdBy':'owner'}}
   elif path=='stock/transactions' and method=='POST':
    stock.append(body)
    if len(stock)==1:status=400;data={'error':'purchase_date_closed'}
    else:data={'ok':True,'transaction':{'requestKey':body['requestKey'],'createdBy':'owner','ingredientId':'hotcupset','type':'PURCHASE'}};status=201
   elif path=='accounting/settlements' and method=='GET':data={'revision':1,'pending':[{'key':today+'|grab','saleDate':today,'platform':'grab','gross':100,'gpFees':29.5,'expectedAmount':70.5,'orders':1,'saleIds':['sale1']}],'history':[],'summary':{'records':0,'matched':0,'variance':0,'expected':0,'received':0,'netVariance':0}}
   elif path=='accounting/settlements' and method=='POST':
    settlements.append(body)
    if len(settlements)==1:status=503;data={'error':'network_unavailable'}
    else:data={'ok':True,'requestKey':body['requestKey'],'performedBy':'owner','operation':'reconcile','reconciliation':{'id':'rec1','saleDate':body['saleDate'],'platform':body['platform'],'receivedAmount':body['receivedAmount'],'receivedDate':body['receivedDate'],'note':body['note']}}
   elif path=='pos/bootstrap':data={'revision':1,'menu':[],'settings':{}}
   elif path=='customers':data={'customers':[],'loyalty':{}}
   elif path=='payments/promptpay/config':data={'ready':False,'configured':False}
   # Unknown writes must never silently pass this fixture.
   if method!='GET' and path not in ['stock/transactions','stock/cycle-count','accounting/settlements','telemetry/web-vitals']:raise AssertionError(path)
   route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
  page.route('**/api/**',handler)
  if args.part in ['all','stock']:
   page.goto(args.base_url+'/stock',wait_until='networkidle');page.get_by_role('button',name='รับเข้า',exact=True).tap();dialog=page.get_by_role('dialog',name='แก้วร้อนทดสอบ',exact=True)
   expect(dialog.get_by_label('หน่วยต่อแพ็ก',exact=True)).to_have_value('set')
   dialog.get_by_label('ราคาซื้อรวม (บาท)',exact=True).fill('200');dialog.get_by_label('ปริมาณต่อ 1 ขวด',exact=True).fill('50')
   confirm=dialog.get_by_role('button',name='ยืนยันและบันทึก',exact=True)
   dialog.get_by_label('หน่วยต่อแพ็ก',exact=True).select_option('piece');expect(confirm).to_be_disabled();expect(dialog.get_by_text('เลือกหน่วยต่อแพ็กให้ตรงกับสต็อก (ชุด)',exact=True).first).to_be_visible();assert not stock
   dialog.get_by_label('หน่วยต่อแพ็ก',exact=True).select_option('set');dialog.get_by_label('ราคาซื้อรวม (บาท)',exact=True).fill('');expect(confirm).to_be_disabled();dialog.get_by_label('ราคาซื้อรวม (บาท)',exact=True).fill('200')
   confirm.tap();expect(dialog.get_by_role('alert')).to_contain_text('วันที่ซื้อถูก Close Day แล้ว');assert len(stock)==1
   page.screenshot(path=str(out/f'{width}-stock-error.png'))
   expect(confirm).to_be_enabled();confirm.tap();expect(dialog).to_have_count(0);assert len(stock)==2 and stock[1]['unit']=='set' and stock[1]['packSizeUnit']=='set' and stock[1]['packSize']==50
   page.get_by_role('button',name='นับของจริง',exact=True).tap();dialog=page.get_by_role('dialog',name='นับของจริง',exact=True)
   actual=dialog.get_by_label('จำนวนจริง (set)',exact=True);actual.fill('');dialog.get_by_role('button',name='ยืนยันและปรับ Stock',exact=True).tap()
   expect(dialog.get_by_role('alert')).to_contain_text('ถ้าไม่มีของให้ใส่ 0');assert not counts
   actual.fill('0');dialog.get_by_role('button',name='ยืนยันและปรับ Stock',exact=True).tap();expect(dialog.get_by_role('button',name='ตรวจรายการสต็อกเดิม',exact=True)).to_be_visible()
   dialog.get_by_role('button',name='ตรวจรายการสต็อกเดิม',exact=True).tap();expect(dialog).to_have_count(0);assert len(counts)==2 and counts[0]==counts[1]
  if args.part in ['all','settlement']:
   page.goto(args.base_url+'/settlements',wait_until='networkidle');page.get_by_role('button',name='บันทึกเงินเข้า / กระทบยอด',exact=True).tap();dialog=page.get_by_role('dialog',name='Grab · '+today,exact=True)
   amount=dialog.get_by_label('ยอดเงินที่เข้าจริง',exact=True);confirm=dialog.get_by_role('button',name='ยืนยันเงินเข้าและกระทบยอด',exact=True)
   for raw in ['', ' ', '70.001']:
    amount.fill(raw);expect(confirm).to_be_disabled();assert not settlements
   amount.fill('0');expect(confirm).to_be_enabled();amount.fill('70.50');confirm.tap()
   expect(dialog.get_by_role('button',name='ตรวจรายการเดิม',exact=True)).to_be_visible();expect(amount).to_be_disabled();expect(dialog.get_by_role('alert')).to_contain_text('ยังไม่ทราบผล')
   page.screenshot(path=str(out/f'{width}-settlement-recovery.png'))
   # Close is allowed while idle but does not discard the durable intent.
   if width==320:dialog.get_by_role('button',name='ตรวจรายการเดิม',exact=True).click()
   else:
    dialog.get_by_role('button',name='ปิดการกระทบยอด',exact=True).click();expect(dialog).to_have_count(0)
    page.get_by_role('button',name='ตรวจ Request เดิม',exact=True).click()
   expect(page.get_by_text('ตรวจ Request เดิมแล้ว',exact=False)).to_be_visible()
   assert len(settlements)==2 and settlements[0]==settlements[1],settlements
   page.reload(wait_until='networkidle');expect(page.get_by_role('button',name='ตรวจ Request เดิม',exact=True)).to_have_count(0)
  assert not errors,errors
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  results.append({'width':width,'height':height,'stockPosts':len(stock),'settlementPosts':len(settlements),'errors':errors,'liveWrites':False});context.close()
 browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'passed':len(results),'liveWrites':False}))
