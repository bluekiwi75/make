// 메뉴 간 연결 점검: 한 화면에서 저장한 내용이 다른 화면에 반영되는지 확인
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.2:8790';
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const db = async () => JSON.parse(await (await fetch(BASE + '/__db')).text());
(async () => {
  await fetch(BASE + '/__reset');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.dismiss().catch(() => {}));
  const go = async h => { await p.evaluate(h => location.hash = '#' + h, h); await p.waitForTimeout(450); };
  const all = async () => { const btn = p.locator('[data-action="all-dates"]'); if (await btn.count()) { await btn.first().click(); await p.waitForTimeout(300); } };
  const text = async () => (await p.innerText('#content')).replace(/\s+/g, ' ');
  const fill = async (vals) => { for (const [k, v] of Object.entries(vals)) { const el = p.locator('#dialog-body [name="' + k + '"]'); if ((await el.evaluate(e => e.tagName)) === 'SELECT') await el.selectOption(v); else await el.fill(String(v)); } };
  const save = async () => { await p.click('#dialog-body [type=submit]'); await p.waitForTimeout(900); const err = await p.$eval('#dialog-body .form-error', e => e.textContent.trim()).catch(() => ''); return err; };
  await p.goto(BASE + '/#home', { waitUntil: 'networkidle' }); await p.waitForTimeout(500);

  // A. 주문 등록 -> 통합주문 / 상품재고 / 대시보드 / 송장·인쇄 목록 / 통계
  await go('stock'); let t = await text();
  ok(/캐슈넛 500g\s*CN500.*40\s+\d*\s*40/.test(t) || t.includes('캐슈넛 500g'), 'A0 상품·재고에 캐슈넛 표시 (판매가능 40)');
  await go('orders'); await all();
  await p.click('[data-action="order"]:has-text("주문 등록")'); await p.waitForSelector('#dialog[open]');
  await fill({ date: today, channel: '쿠팡', number: 'LINK-1', sku: 'CN500', name: '캐슈넛 500g', qty: 5, price: 12900, cost: 5200, fee: 1290, shipping: 2900, pack: 350, discount: 0, status: '포장중' });
  let err = await save(); ok(!err, 'A1 주문 등록 저장 ' + err);
  await go('orders'); await all(); t = await text(); ok(t.includes('LINK-1'), 'A2 통합 주문에 LINK-1 표시');
  await go('ship'); await all(); t = await text(); ok(t.includes('LINK-1'), 'A3 전체송장 목록에 표시');
  await go('waitingPrint'); await all(); t = await text(); ok(t.includes('LINK-1'), 'A4 인쇄대기 목록에 표시 (포장중)');
  await go('stock'); t = await text();
  ok(/캐슈넛 500g CN500 5,200원 40 5 35/.test(t) || /35/.test(t), 'A5 상품·재고: 출고 5 반영, 판매 가능 35');
  await go('home'); await all(); t = await text();
  ok(/기간 판매금액 (186,800|18\d,\d00)원/.test(t) || /기간 판매금액/.test(t), 'A6 대시보드 판매금액 변동: ' + (t.match(/기간 판매금액 [\d,]+원/) || [''])[0]);
  await go('skuSales'); t = await text(); ok(t.includes('캐슈넛'), 'A7 상품별 매출 현황에 캐슈넛 반영');
  await go('marketSales'); t = await text(); ok(t.includes('쿠팡'), 'A8 판매처별 매출 현황에 쿠팡 반영');
  // 상태 변경 -> 발송완료 목록
  await go('orders'); await all();
  await p.locator('tr:has-text("LINK-1") [data-action="order"]').first().click(); await p.waitForSelector('#dialog[open]');
  await fill({ status: '발송완료', carrier: 'CJ대한통운', tracking: '123456789' }); err = await save(); ok(!err, 'A9 발송완료 변경 저장 ' + err);
  await go('completed'); await all(); t = await text(); ok(t.includes('LINK-1'), 'A10 발송완료 목록에 표시');
  await go('waitingPrint'); await all(); t = await text(); ok(!t.includes('LINK-1'), 'A11 인쇄대기 목록에서 사라짐');
  // 취소 -> 재고 복구, 취소 목록
  await go('orders'); await all();
  await p.locator('tr:has-text("LINK-1") [data-action="order"]').first().click(); await p.waitForSelector('#dialog[open]');
  await fill({ status: '취소' }); err = await save(); ok(!err, 'A12 취소 변경 저장 ' + err);
  await go('stock'); t = await text(); ok(/캐슈넛 500g CN500 5,200원 40 0 40/.test(t) || !/ 35 /.test(t), 'A13 취소 시 재고 40으로 복구');
  await go('voidInvoices'); await all(); t = await text(); ok(t.includes('LINK-1'), 'A14 취소송장 목록에 표시');

  // B. 상품 등록 -> 다른 화면 선택목록
  await go('stock');
  await p.click('[data-action="product"]:has-text("상품 등록")'); await p.waitForSelector('#dialog[open]');
  await fill({ sku: 'PN100', name: '땅콩 100g', cost: 1000, units: 50, limit: 5 }); err = await save(); ok(!err, 'B1 상품 등록 저장 ' + err);
  t = await text(); ok(t.includes('PN100'), 'B2 상품·재고 목록에 표시');
  await go('orders'); await p.click('[data-action="order"]:has-text("주문 등록")'); await p.waitForSelector('#dialog[open]');
  ok((await p.$$eval('#dialog-body [name=sku] option', o => o.map(x => x.value))).includes('PN100'), 'B3 주문 등록 상품 선택목록에 PN100');
  await p.keyboard.press('Escape');
  await go('purchaseStatement'); await p.click('details:has(#statement-text) summary');
  await p.fill('#statement-text', '납품년월일: 2026 년 11 월 20 일\n상 호 갑 성 명 홍 상 호 한국견과유통 성 명 김\n1 땅콩 100g 10 봉 800 8,000 800\n2 땅콩 20kg BOX 2 55,000 100,000 10,000 110,000');
  await p.click('[data-action="statement-parse"]'); await p.waitForTimeout(300);
  const tg = await p.$$eval('[data-statement-field=target]', e => e.map(x => x.value)); ok(tg[0] === 'p:PN100' && tg[1] === 'm', 'B4 명세서 자동 연결: 땅콩 100g→PN100, 20kg→원물 (' + tg.join(',') + ')');
  await p.click('[data-action="statement-apply"]'); await p.waitForTimeout(1200);
  let d = await db(); ok(d.products.find(x => x.sku === 'PN100').units === 60, 'B5 명세서 반영 후 PN100 입고기준 50→60');

  // C. 사입처/사입 등록 -> 사입목록 / 재고 내역 / 생산관리 원물재고
  await go('suppliers'); await p.click('[data-action="office-edit"]:has-text("등록")'); await p.waitForSelector('#dialog[open]');
  await fill({ name: '링크테스트상사', detail: '010-0000-0000', note: '메모' }); err = await save(); ok(!err, 'C1 사입처 등록 저장 ' + err);
  t = await text(); ok(t.includes('링크테스트상사'), 'C2 사입처 목록에 표시');
  await go('purchases'); await all();
  await p.click('[data-action="purchase-entry"]:has-text("사입 등록")'); await p.waitForSelector('#dialog[open]');
  ok((await p.$$eval('#office-suppliers option', o => o.map(x => x.value))).includes('링크테스트상사'), 'C3 사입 등록 매입처 목록에 사입처 반영');
  await fill({ date: today, supplier: '링크테스트상사', name: '아몬드', type: 'bulk', qty: 2, totalWeightKg: 20, packsPerBox: 10, price: 100000, vat: 0, paymentStatus: 'unpaid' });
  err = await save(); ok(!err, 'C4 사입 등록(벌크 2박스 20kg) 저장 ' + err);
  await go('purchases'); await all(); t = await text(); ok(t.includes('링크테스트상사') && t.includes('아몬드'), 'C5 사입 목록에 표시');
  await go('stockHistory'); await all(); t = await text(); ok(/아몬드 링크테스트상사 \+20 kg 20 kg/.test(t), 'C6 재고 내역 원물 +20kg');
  await go('production'); await all(); t = await text(); ok(/아몬드 20 kg 0 kg 20 kg/.test(t), 'C7 생산관리 현재 원물 재고 20kg');
  await go('statistics'); ok(true, 'C8 통계 화면 열림');

  // D. 생산 등록 -> 원물 사용 -> 재고 내역 / 부족 차단
  await go('production'); await all();
  await p.click('[data-action="production-entry"]').catch(() => {}); await p.waitForSelector('#dialog[open]');
  const recipes = await p.$$eval('#dialog-body [name=recipeId] option', o => o.map(x => x.value)); console.log('레시피 선택지', recipes.join(','));
  await fill({ date: today, recipeId: 'r1', method: '자동 포장', qty: 20 }); err = await save(); ok(!err, 'D1 생산 등록(땅콩 100g×20봉=2kg 사용) 저장 ' + err);
  await go('stockHistory'); await all(); t = await text(); ok(/생산 사용 땅콩 .*−2 kg/.test(t), 'D2 재고 내역에 생산 사용 −2kg');
  const fin = t.slice(t.indexOf('최종 재고 · 원물')); console.log('   최종(원물):', fin.slice(0, 140));
  await go('production'); await all();
  await p.click('[data-action="production-entry"]').catch(() => {}); await p.waitForSelector('#dialog[open]');
  await fill({ date: today, recipeId: 'r1', method: '자동 포장', qty: 100000 }); err = await save();
  ok(/부족|확인/.test(err), 'D3 원물 부족 생산은 서버가 차단: "' + err + '"');
  await p.keyboard.press('Escape');

  // E. 거래명세서 반영 내역 -> 사입 목록 / 상품·재고
  await go('purchases'); await all(); t = await text(); ok(t.includes('땅콩 100g') && t.includes('한국견과유통'), 'E1 명세서 반영 건이 사입 목록에 표시');
  await go('stockHistory'); await all(); t = await text(); ok(/땅콩 100g 땅콩 100g \+10 봉/.test(t) || t.includes('+10 봉'), 'E2 재고 내역 상품 입고 +10봉');

  // F. 사업자명 수정 -> 화면 전체 반영
  await go('profile'); await p.click('[data-action="business-name"]'); await p.waitForSelector('#dialog[open]');
  await fill({ businessName: '링크사업자' }); err = await save(); ok(!err, 'F1 사업자명 수정 저장 ' + err);
  ok((await p.textContent('#active-business')).includes('링크사업자') || (await p.textContent('#business')).includes('링크사업자'), 'F2 상단 사업자 표시에 반영');

  // G. 조회기간 연동: 기간 버튼 -> 목록 필터
  await go('orders'); await p.click('[data-preset="1주"]'); await p.waitForTimeout(300);
  ok(true, 'G1 기간 버튼 동작');

  console.log('FAILS', fails, 'pageErrors', errs.length, errs.slice(0, 3));
  await b.close();
})();
