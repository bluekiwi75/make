// 사이트(아티팩트) → 연동 서버(MCP 커넥터) 전체 흐름을 시험합니다.
// 사용: node tools/build-artifact.mjs && node bridge/build.mjs && node tools/qa/site-bridge-test.mjs
// 브라우저 안의 claude.use("db"), claude.use("mcp")는 가짜로 대신하고, 연동 서버는 Node에서 실제 코드로 돌립니다.
import { createRequire } from "node:module";
import { makeD1, installMarketMocks, NAVER_SECRET, sentToNaver } from "./bridge-test.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

installMarketMocks();
const bridge = (await import(new URL("../../bridge/dist/worker.js", import.meta.url))).default;
const env = { DB: makeD1(), MARKET_CONNECTION_KEY: Buffer.alloc(32, 9).toString("base64"), BRIDGE_TOKEN: "abcdefghijklmnop12345" };
let connectorOnline = true;
async function bridgeTool(server, tool, args) {
  if (server !== "마켓데스크 연동" || !connectorOnline) return { error: "server_not_connected" };
  const response = await bridge.fetch(new Request("https://bridge.test/mcp/" + env.BRIDGE_TOKEN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) }), env);
  const reply = await response.json();
  return { payload: JSON.parse(reply.result.content[0].text) };
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const store = new Map();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
await ctx.exposeFunction("__dbGet", path => store.has(path) ? store.get(path) : null);
await ctx.exposeFunction("__dbSet", (path, text) => { store.set(path, text); });
await ctx.exposeFunction("__dbDel", path => { store.delete(path); });
await ctx.exposeFunction("__bridgeTool", bridgeTool);
await ctx.addInitScript(() => {
  window.claude = { use: async name => name === "db" ? { doc: path => ({
    get: async () => { const v = await window.__dbGet(path); return { exists: v !== null, data: () => v ? JSON.parse(v) : undefined }; },
    set: async data => { await window.__dbSet(path, JSON.stringify(data)); }, delete: async () => { await window.__dbDel(path); } }) }
    : name === "mcp" ? { callTool: async (server, tool, args) => { const r = await window.__bridgeTool(server, tool, args); if (r.error) throw { code: r.error }; return r; } } : null };
});
const page = await ctx.newPage(); const errs = []; page.on("pageerror", e => errs.push(e.message));
const site = "file:///home/user/make/dist/artifact/marketdesk.html";
const state = () => page.evaluate(async () => (await (await fetch("/api/state?business=1")).json()));
const toast = async () => (await page.textContent("#toast")).trim();

await page.goto(site + "#setup"); await page.waitForTimeout(1500);
let text = (await page.innerText("#content")).replace(/\s+/g, " ");
ok(text.includes("API 키 등록"), "판매처 연결 화면: API 키 등록 버튼 표시");
ok(!text.includes("연결 정보를 불러오지 못했습니다"), "연동 서버에서 연결 목록을 불러옴");

// 1) 네이버 API 키 등록
await page.click('[data-action="market-key"][data-market="naver"]'); await page.waitForSelector("#dialog[open]");
await page.fill('#dialog-body [name=id]', "app-id"); await page.fill('#dialog-body [name=secret]', "bad-secret"); await page.click("#dialog-body [type=submit]"); await page.waitForTimeout(800);
ok((await page.textContent("#dialog-body .form-error")).includes("네이버"), "형식이 틀린 키는 서버가 거부: " + (await page.textContent("#dialog-body .form-error")).slice(0, 40));
await page.fill('#dialog-body [name=secret]', NAVER_SECRET); await page.click("#dialog-body [type=submit]"); await page.waitForTimeout(1500);
ok((await page.innerText("#content")).includes("API 키 변경"), "API 키 저장 후 ‘API 키 변경’ 표시");
const sealed = await env.DB.prepare("SELECT sealed FROM market_connection").bind().first(); ok(sealed && !sealed.sealed.includes("app-id"), "키는 연동 서버에만 암호화되어 저장됨");
ok(![...store.values()].some(v => v.includes(NAVER_SECRET)), "이 사이트 저장소(db)에는 API 키가 없음");

// 2) 연결 확인, 주문 가져오기
await page.click('[data-action="market-test"][data-market="naver"]'); await page.waitForTimeout(1200);
ok((await toast()).includes("연결을 확인"), "연결 확인: " + await toast());
await page.click('[data-action="market-sync"][data-market="naver"]'); await page.waitForTimeout(2500);
ok((await toast()).includes("신규 2건"), "주문 가져오기: " + await toast());
let s = await state(); const naver = s.data.orders.filter(o => o.market === "naver");
ok(naver.length === 2 && naver[0].qty === 2 && naver[0].price === 11900 && naver[0].channel === "네이버", "사이트에 네이버 주문 2건 저장 (수량 2, 단가 11,900)");
await page.click('[data-action="market-sync"][data-market="naver"]'); await page.waitForTimeout(2500);
ok((await toast()).includes("신규 0건"), "다시 가져와도 중복 없음: " + await toast());
await page.evaluate(() => location.hash = "#orders"); await page.waitForTimeout(600); await page.click('[data-action="all-dates"]'); await page.waitForTimeout(400);
ok((await page.innerText("#content")).includes("ORD2026112300001"), "통합 주문 화면에 가져온 주문 표시");

await page.goto(site + "#setup"); await page.reload(); await page.waitForTimeout(1800);
await page.screenshot({ path: (process.argv[2] || "/tmp") + "/bridge-ok.png" });
// 3) 송장 전송
const target = naver[0];
await page.evaluate(async ([id]) => {
  const g = await (await fetch("/api/state?business=1")).json();
  const data = { ...g.data, orders: g.data.orders.map(o => o.id === id ? { ...o, carrier: "CJ대한통운", tracking: "611122223333", status: "포장중" } : o) };
  await fetch("/api/state?business=1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rev: g.rev, data }) });
}, [target.id]);
await page.goto(site + "#dispatch"); await page.reload(); await page.waitForTimeout(1800);
await page.click('[data-action="send-invoice"]:visible >> nth=0'); await page.waitForSelector("#dialog[open]"); await page.click("#dialog-body [type=submit]"); await page.waitForTimeout(2000);
ok((await toast()).includes("송장을 전송했습니다") || sentToNaver.length === 1, "송장 전송 요청: " + await toast());
ok(sentToNaver.length === 1 && sentToNaver[0].productOrderId === target.line && sentToNaver[0].trackingNumber === "611122223333" && sentToNaver[0].deliveryCompanyCode === "CJGLS", "네이버로 상품주문번호·CJGLS·송장번호 전달");
s = await state(); const after = s.data.orders.find(o => o.id === target.id); ok(after.status === "발송완료" && /^\d{4}-\d{2}-\d{2}$/.test(after.shipDate), "주문이 발송완료로 바뀜 (" + after.shipDate + ")");

// 4) 판매자센터 로그인 정보 등록
await page.goto(site + "#setup"); await page.waitForTimeout(1500);
await page.click('[data-action="seller-login"][data-channel="쿠팡"]'); await page.waitForSelector("#dialog[open]");
await page.fill("#dialog-body [name=username]", "seller01"); await page.fill("#dialog-body [name=password]", "pw-12345"); await page.click("#dialog-body [type=submit]"); await page.waitForTimeout(1500);
ok((await toast()).includes("저장했습니다"), "로그인 정보 저장: " + await toast());
ok(store.has("state/secret") && ![...store.values()].some(v => v.includes("pw-12345") || v.includes("seller01")), "로그인 정보는 암호화되어 저장됨(평문 없음)");
s = await state(); ok((s.data.loginChannels || []).includes("쿠팡"), "쿠팡이 로그인 정보 등록 목록에 표시");
await page.reload(); await page.waitForTimeout(1500); s = await state(); ok((s.data.loginChannels || []).includes("쿠팡"), "새로 열어도 유지");

// 5) 커넥터가 없을 때의 안내
connectorOnline = false;
await page.goto(site + "#setup"); await page.reload(); await page.waitForTimeout(2000);
text = (await page.innerText("#content")).replace(/\s+/g, " ");
ok(text.includes("커넥터") && text.includes("마켓데스크 연동"), "커넥터가 없으면 안내 문구: " + (text.match(/‘마켓데스크 연동’[^.]*\./) || [""])[0].slice(0, 70));
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(w[0] <= w[1] + 1, "휴대폰 폭 가로 넘침 없음 " + w.join("/"));
await page.screenshot({ path: process.argv[2] ? process.argv[2] + "/bridge-offline.png" : "/tmp/bridge-offline.png" });
console.log("FAILS", fails, "errors", errs.length, errs.slice(0, 3));
await browser.close();
process.exit(fails ? 1 : 0);
