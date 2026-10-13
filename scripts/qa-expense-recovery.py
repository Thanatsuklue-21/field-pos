"""Browser regression of production UI with intercepted test APIs; no live writes.
Requires Python playwright and Chromium. Start npm run build && npm start first.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://localhost:3000')
parser.add_argument('--browser', default='/usr/bin/chromium')
parser.add_argument('--output', default='/tmp/field-expense-qa')
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
results = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.browser, args=['--no-sandbox'])
    for width, height in [(320,640),(360,740),(390,844),(412,915),(430,932),(768,1024),(1024,768)]:
        context = browser.new_context(viewport={'width':width,'height':height})
        page = context.new_page()
        errors, sent, stored = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def route_api(route):
            path = route.request.url.split('/api/')[-1]
            if path == 'auth/session':
                data = {'user':{'id':'owner','username':'owner','role':'admin','permissions':{}},'csrf':'test-csrf'}
            elif path == 'expenses' and route.request.method == 'POST':
                body = route.request.post_data_json
                sent.append(body)
                if not stored:
                    stored.append({'id':'exp-test-1','createdBy':'owner',**body})
                    route.fulfill(status=201, content_type='application/json', body='{truncated')
                    return
                assert body == sent[0], 'Recovery changed original payload/key'
                data = {'ok':True,'expense':stored[0],'replayed':True}
            elif path == 'expenses':
                data = {'expenses':stored,'businessDate':'2026-10-13','shift':{'id':'shift-1','date':'2026-10-13','status':'open','openingCash':100},'drawerSnapshot':{'availableCash':100 if not stored else 70}}
            else:
                data = {'health':'ok','metrics':{},'alerts':[],'policy':{'auto':[],'approval':[],'never':[]}}
            route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
        page.route('**/api/**', route_api)
        page.goto(args.base_url+'/expenses')
        page.get_by_role('button', name='เพิ่ม', exact=True).click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('จำนวนเงิน', exact=True).fill('30')
        dialog.get_by_label('รายละเอียด / เหตุผล', exact=True).fill('ค่าจอดรถ')
        dialog.get_by_role('button', name='ยืนยันค่าใช้จ่าย', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('ยังไม่ทราบผลการบันทึก')
        expect(dialog.get_by_label('จำนวนเงิน', exact=True)).to_be_disabled()
        expect(dialog.get_by_label('หมวดค่าใช้จ่าย')).to_be_disabled()
        expect(dialog.get_by_role('button', name='โอน/ธนาคาร', exact=True)).to_be_disabled()
        dialog.get_by_role('button', name='ปิดหน้าต่าง · เก็บรายการไว้', exact=True).click()
        page.reload()
        expect(page.get_by_role('button', name='ตรวจผลรายการเดิม', exact=True)).to_be_visible()
        page.get_by_role('button', name='ตรวจรายการค้าง', exact=True).click()
        expect(page.get_by_role('dialog').get_by_label('จำนวนเงิน', exact=True)).to_have_value('30')
        expect(page.get_by_role('dialog').get_by_label('จำนวนเงิน', exact=True)).to_be_disabled()
        page.screenshot(path=str(output/f'expense-pending-{width}.png'), full_page=True)
        page.get_by_role('dialog').get_by_role('button', name='ตรวจผลรายการเดิม', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.get_by_text('รายการนี้ถูกบันทึกไว้แล้ว · ระบบไม่สร้างซ้ำ', exact=True)).to_be_visible()
        assert len(stored)==1 and len(sent)==2
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflow'
        assert not errors, errors
        results.append({'viewport':[width,height],'lost_response_reload_exact_replay':'pass','committed_expenses':len(stored),'send_attempts':len(sent),'page_errors':errors,'document_overflow':False})
        context.close()
    # Explicit offline preflight must persist first, then recover exactly on reconnect.
    context = browser.new_context(viewport={'width':390,'height':844})
    page = context.new_page()
    stored, sent = [], []
    page.route('**/api/**', route_api)
    page.goto(args.base_url+'/expenses')
    page.get_by_role('button',name='เพิ่ม',exact=True).click()
    dialog=page.get_by_role('dialog')
    dialog.get_by_label('จำนวนเงิน',exact=True).fill('30')
    dialog.get_by_label('รายละเอียด / เหตุผล',exact=True).fill('น้ำแข็ง')
    context.set_offline(True)
    dialog.get_by_role('button',name='ยืนยันค่าใช้จ่าย',exact=True).click()
    expect(dialog.get_by_role('alert')).to_contain_text('ยังไม่ได้ส่งรายการเพราะออฟไลน์')
    assert len(sent)==0
    # Reconnect sends the persisted request. The first response is still truncated.
    context.set_offline(False)
    expect(dialog.get_by_role('alert')).to_contain_text('ยังไม่ทราบผลการบันทึก')
    dialog.get_by_role('button',name='ตรวจผลรายการเดิม',exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)
    assert len(sent)==2 and len(stored)==1
    results.append({'offline_preflight_reconnect_exact_replay':'pass','committed_expenses':1})
    context.close()
    browser.close()

(output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'scenarios':len(results),'result':'pass','artifact_directory':str(output)},ensure_ascii=False))
