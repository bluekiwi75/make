const { chromium } = require('playwright'); const fs = require('fs');
const BASE = 'http://127.0.0.2:8790'; const OUT = process.argv[2];
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const only = process.argv[3]; // optional page filter
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  let pageErrors = [], api = [], dialogsAuto = 0;
  p.on('pageerror', e => pageErrors.push(e.message));
  p.on('response', async r => { if (r.url().includes('/api/') && r.request().method() !== 'GET') api.push(r.request().method() + ' ' + r.status() + ' ' + new URL(r.url()).pathname); });
  p.on('filechooser', fc => { fc.setFiles([]).catch(() => {}); });
  p.on('dialog', d => { dialogsAuto++; d.dismiss().catch(() => {}); });
  ctx.on('page', pg => { if (pg !== p) pg.close().catch(() => {}); });
  const reset = () => fetch(BASE + '/__reset');
  const load = async h => { await reset(); await p.goto(BASE + '/#' + h, { waitUntil: 'domcontentloaded' }); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(250); };
  await load('home');
  const hashes = await p.$$eval('a[href^="#"]', a => [...new Set(a.map(x => x.getAttribute('href').slice(1)).filter(Boolean))]);
  const report = []; const issues = [];
  for (const h of hashes) {
    if (only && h !== only) continue;
    await load(h);
    const heading = await p.$eval('#content h1', e => e.textContent.trim()).catch(() => '');
    const content = await p.$eval('#content', e => e.innerText).catch(() => '');
    const rec = { page: h, heading, actions: [] };
    if (h !== 'home' && heading === '주문 운영 대시보드') issues.push(`[${h}] 링크가 홈으로 되돌아감(미등록 화면)`);
    if (/undefined|NaN|\[object/.test(content)) issues.push(`[${h}] 화면에 undefined/NaN/[object] 표시`);
    const buttons = await p.$$eval('#content button:not([disabled]), #content a.button', els => els.map((e, i) => ({ i, t: (e.textContent || '').trim().slice(0, 30), a: e.dataset.action || e.getAttribute('href') || e.type })));
    for (const bt of buttons) {
      if (['close'].includes(bt.a)) continue;
      await load(h); pageErrors = []; api = []; dialogsAuto = 0;
      const el = p.locator('#content button:not([disabled]), #content a.button').nth(bt.i);
      const before = await p.evaluate(() => location.hash);
      let result = { btn: bt.t || bt.a, action: bt.a };
      try {
        await el.click({ timeout: 4000 }); await p.waitForTimeout(350);
        const open = await p.$('#dialog[open]');
        if (open) {
          result.dialog = await p.$eval('#dialog-body h2', e => e.textContent.trim()).catch(() => '?');
          const inputs = await p.$$('#dialog-body input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), #dialog-body textarea, #dialog-body select');
          for (const inp of inputs) {
            const tag = await inp.evaluate(e => e.tagName), type = await inp.evaluate(e => e.type), val = await inp.inputValue().catch(() => ''), dis = await inp.isDisabled(), vis = await inp.isVisible();
            if (dis || !vis) continue;
            if (tag === 'SELECT') { if (!val) { const v = await inp.evaluate(e => [...e.options].map(o => o.value).find(x => x)); if (v) await inp.selectOption(v); } continue; }
            if (val) continue;
            if (type === 'date') await inp.fill(today); else if (type === 'number') await inp.fill('1'); else if (type === 'password') await inp.fill('test1234'); else await inp.fill('테스트');
          }
          const submit = await p.$('#dialog-body [type=submit]');
          if (submit) {
            await submit.click().catch(() => {}); await p.waitForTimeout(700);
            result.formError = (await p.$eval('#dialog-body .form-error', e => e.textContent.trim()).catch(() => '')) || undefined;
            result.toast = (await p.$eval('#toast', e => e.textContent.trim()).catch(() => '')) || undefined;
            result.closed = !(await p.$('#dialog[open]'));
          }
        } else {
          result.toast = (await p.$eval('#toast', e => e.textContent.trim()).catch(() => '')) || undefined;
          const after = await p.evaluate(() => location.hash); if (after !== before) result.navigated = after;
        }
      } catch (e) { result.err = e.message.split('\n')[0].slice(0, 120); }
      if (pageErrors.length) result.pageErrors = pageErrors.slice();
      if (api.length) result.api = api.slice();
      if (dialogsAuto) result.nativeDialogs = dialogsAuto;
      rec.actions.push(result);
      if (result.pageErrors) issues.push(`[${h}] "${result.btn}" 실행 중 오류: ${result.pageErrors[0]}`);
      if (result.err) issues.push(`[${h}] "${result.btn}" 클릭 실패: ${result.err}`);
      if (result.api && result.api.some(x => / (4|5)\d\d /.test(x))) issues.push(`[${h}] "${result.btn}" 서버 거부: ${result.api.join(', ')} ${result.formError || ''}`);
    }
    report.push(rec); console.log(h, heading, buttons.length + '개 명령');
  }
  fs.writeFileSync(OUT + '/crawl.json', JSON.stringify({ report, issues }, null, 1));
  console.log('\nISSUES', issues.length); issues.forEach(i => console.log(' -', i));
  await b.close();
})();
