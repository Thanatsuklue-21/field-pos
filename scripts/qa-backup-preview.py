"""Backup UI race/recovery regression; all APIs intercepted, no live data writes."""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://localhost:3000')
parser.add_argument('--browser', default='')
parser.add_argument('--output', default='/tmp/field-backup-preview-qa')
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)


async def main():
    results = []
    async with async_playwright() as p:
        launch = {'args': ['--no-sandbox']}
        if args.browser:
            launch['executable_path'] = args.browser
        browser = await p.chromium.launch(**launch)
        for width, height in [(320, 640), (390, 844), (768, 1024)]:
            context = await browser.new_context(viewport={'width': width, 'height': height})
            page = await context.new_page()
            errors, sent = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            meta_ready, release_meta = asyncio.Event(), asyncio.Event()
            restore_ready, release_restore = asyncio.Event(), asyncio.Event()
            meta_mode = 'hold'
            restore_mode = 'hold'

            async def api(route):
                nonlocal meta_mode, restore_mode
                path = route.request.url.split('/api/')[-1]
                status = 200
                if path == 'auth/session':
                    data = {'user': {'id': 'owner', 'username': 'owner', 'role': 'admin', 'permissions': {}}, 'csrf': 'test-csrf'}
                elif path == 'admin/backup/preview':
                    candidate = route.request.post_data_json['backup']
                    data = {'fingerprint': candidate['fingerprint'], 'schemaVersion': 2, 'recordCounts': {'sales': 1}}
                elif path == 'state/meta':
                    if meta_mode == 'hold':
                        meta_ready.set()
                        await release_meta.wait()
                    if meta_mode == 'fail':
                        status, data = 503, {'error': 'database_temporarily_unavailable'}
                    else:
                        data = {'revision': 'invalid' if meta_mode == 'malformed' else 7}
                elif path == 'admin/backup/restore':
                    body = route.request.post_data_json
                    sent.append(body)
                    if restore_mode == 'hold':
                        restore_ready.set()
                        await release_restore.wait()
                        await route.fulfill(status=200, content_type='application/json', body='{truncated')
                        return
                    data = {'ok': True, 'requestKey': body['requestKey'], 'performedBy': 'owner',
                            'fingerprint': body['backupFingerprint'], 'revision': body['expectedRevision'] + 1, 'replayed': True}
                elif path == 'admin/backup/export':
                    status, data = 503, {'error': 'export_unavailable'}
                else:
                    data = {'metrics': {}, 'alerts': [], 'policy': {'auto': [], 'approval': [], 'never': []}}
                await route.fulfill(status=status, content_type='application/json', body=json.dumps(data))

            await page.route('**/api/**', api)
            await page.goto(args.base_url + '/backup')
            upload = page.locator('input[type="file"]')
            confirm = page.get_by_role('checkbox')
            restore = page.get_by_role('button', name='RESTORE FULL BACKUP', exact=True)
            file_a = {'name': 'a.json', 'mimeType': 'application/json', 'buffer': json.dumps({'fingerprint': 'a' * 64}).encode()}
            file_b = {'name': 'b.json', 'mimeType': 'application/json', 'buffer': json.dumps({'fingerprint': 'b' * 64}).encode()}

            await upload.set_input_files(file_a)
            await asyncio.wait_for(meta_ready.wait(), 10)
            await expect(upload).to_be_disabled()
            await expect(restore).to_have_count(0)  # No actionable preview until revision is known.
            release_meta.set()
            await expect(confirm).to_be_enabled()
            await confirm.check()

            # A different file invalidates the previous confirmation even if both previews pass.
            meta_mode = 'ok'
            await upload.set_input_files(file_b)
            await expect(upload).to_be_enabled()
            await expect(confirm).not_to_be_checked()
            await expect(restore).to_be_disabled()

            # A failed or malformed metadata read must leave no restorable candidate.
            for mode in ['fail', 'malformed']:
                meta_mode = mode
                await upload.set_input_files(file_a)
                await expect(page.get_by_role('status')).to_contain_text('การตรวจไฟล์ข้อมูลสำรอง')
                await expect(restore).to_have_count(0)
                assert len(sent) == 0

            meta_mode = 'ok'
            await upload.set_input_files(file_a)
            await confirm.check()
            await restore.click()
            await asyncio.wait_for(restore_ready.wait(), 10)
            await expect(upload).to_be_disabled()
            await expect(confirm).to_be_disabled()
            await expect(page.get_by_role('button', name='RETRY SAME RESTORE')).to_be_disabled()
            assert len(sent) == 1
            release_restore.set()
            await expect(page.get_by_role('status')).to_contain_text('เก็บ request เดิมไว้แล้ว')
            original = sent[0]

            # Reload keeps identity; a different file cannot replace the unresolved operation.
            restore_mode = 'exact'
            await page.reload()
            await upload.set_input_files(file_b)
            await expect(page.get_by_role('status')).to_contain_text('ไฟล์นี้ไม่ใช่ไฟล์เดิม')
            await expect(confirm).to_be_disabled()
            await expect(page.get_by_role('button', name='RETRY SAME RESTORE')).to_be_disabled()
            await upload.set_input_files(file_a)
            await expect(confirm).to_be_enabled()
            await expect(confirm).not_to_be_checked()
            await confirm.check()
            await page.get_by_role('button', name='RETRY SAME RESTORE').click()
            await expect(page.get_by_role('status')).to_contain_text('กู้คืน Full Backup สำเร็จ')
            assert len(sent) == 2 and sent[1] == original, 'Replay changed identity/payload'
            assert await page.evaluate('localStorage.getItem("field-backup-restore-pending-v1:owner")') is None

            await page.get_by_role('button', name='DOWNLOAD FULL BACKUP').click()
            await expect(page.get_by_role('status')).to_contain_text('การส่งออกข้อมูลสำรอง')
            await expect(upload).to_be_enabled()
            assert not errors, errors
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflow'
            await page.screenshot(path=str(output / f'backup-{width}.png'), full_page=True)
            results.append({'viewport': [width, height], 'preview_guards': 'pass', 'confirmation_reset': 'pass',
                            'metadata_fail_closed': 'pass', 'lost_response_reload_exact_replay': 'pass',
                            'export_error_handled': 'pass', 'restore_attempts': len(sent), 'page_errors': errors})
            await context.close()
        await browser.close()
    (output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps({'result': 'pass', 'viewports': len(results), 'artifact_directory': str(output)}))


asyncio.run(main())
