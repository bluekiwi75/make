// 연동 서버(bridge)를 로컬에서 시험합니다: node bridge/build.mjs && node tools/qa/bridge-test.mjs
// node:sqlite로 D1을 흉내 내고, 판매처 API는 가짜 응답으로 대신합니다. 실제 판매처에는 접속하지 않습니다.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0000_market_state.sql", "0001_market_connection.sql", "0002_market_connection_extra.sql"])
    db.exec(readFileSync(new URL("../../drizzle/" + file, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  return { prepare(sql) {
    const stmt = db.prepare(sql);
    return { bind: (...a) => ({
      first: async () => stmt.get(...a) ?? null,
      all: async () => ({ results: stmt.all(...a).map(row => ({ ...row })) }),
      run: async () => ({ meta: { changes: Number(stmt.run(...a).changes) } })
    }) };
  } };
}

export const NAVER_SECRET = "$2a$10$abcdefghijklmnopqrstuu";
export const sentToNaver = [];
export function installMarketMocks() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url), json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.endsWith("/oauth2/token")) {
      const form = new URLSearchParams(String(options.body));
      if (!form.get("client_id") || !form.get("client_secret_sign")) return json({ message: "bad" }, 400);
      return json({ access_token: "tok-" + form.get("client_id") });
    }
    if (u.includes("/last-changed-statuses")) return json({ data: { lastChangeStatuses: [{ productOrderId: "2026112300001" }, { productOrderId: "2026112300002" }] } });
    if (u.endsWith("/product-orders/query")) return json({ data: JSON.parse(options.body).productOrderIds.map((id, i) => ({
      order: { orderId: "ORD" + id, orderDate: "2026-11-23T10:00:00+09:00" },
      productOrder: { productOrderId: id, productName: "호두 500g", productOrderStatus: "PAYED", placeOrderStatus: i ? "NOT_YET" : "OK", quantity: 2, unitPrice: 11900, totalProductAmount: 23800, optionManageCode: "WN500", paymentCommission: 500 },
      delivery: {} })) });
    if (u.endsWith("/product-orders/dispatch")) { const b = JSON.parse(options.body); sentToNaver.push({ auth: options.headers.Authorization, ...b.dispatchProductOrders[0] }); return json({ data: { successProductOrderIds: b.dispatchProductOrders.map(x => x.productOrderId) } }); }
    if (u.includes("api-gateway.coupang.com") && u.includes("ordersheets")) return json({ code: "200", data: u.includes("status=ACCEPT") ? [{ orderId: 777, shipmentBoxId: 555, status: "ACCEPT", paidAt: "2026-11-23T09:00:00", orderItems: [{ vendorItemId: 99, vendorItemName: "구운 아몬드 500g", shippingCount: 1, cancelCount: 0, salesPrice: { units: 10400, currencyCode: "KRW" }, externalVendorSkuCode: "AL500" }] }] : [], nextToken: "0" });
    return real(url, options);
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  installMarketMocks();
  const bridge = (await import(new URL("../../bridge/dist/worker.js", import.meta.url))).default;
  const env = { DB: makeD1(), MARKET_CONNECTION_KEY: Buffer.alloc(32, 7).toString("base64"), BRIDGE_TOKEN: "abcdefghijklmnop12345" };
  const rpc = (body, token = env.BRIDGE_TOKEN, method = "POST") => bridge.fetch(new Request("https://bridge.test/mcp/" + token, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }), env);
  const call = async args => { const r = await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "market_api", arguments: args } })).json(); return JSON.parse(r.result.content[0].text); };

  ok((await rpc({}, "wrong-token-wrong-token")).status === 404, "토큰이 틀리면 404");
  ok((await rpc({}, env.BRIDGE_TOKEN, "GET")).status === 405, "GET은 405");
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } })).json();
  ok(init.result.serverInfo.name === "marketdesk-bridge" && init.result.capabilities.tools, "initialize 응답");
  ok((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202, "알림에는 202");
  const tools = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  ok(tools.result.tools[0].name === "market_api" && tools.result.tools[0].inputSchema.required.includes("action"), "tools/list에 market_api");

  let r = await call({ action: "list", business: "1" }); ok(r.status === 200 && r.body.connections.length === 0, "처음에는 연결 없음");
  r = await call({ action: "test", business: "1", market: "naver" }); ok(r.status === 409 && r.body.error.includes("API 키를 먼저"), "키 없이 test: " + r.body.error);
  r = await call({ action: "save", business: "1", market: "naver", id: "app-id", secret: "not-bcrypt" }); ok(r.status === 400 && r.body.error.includes("네이버"), "형식이 틀린 네이버 키 거부");
  r = await call({ action: "save", business: "1", market: "naver", id: "app-id", secret: NAVER_SECRET }); ok(r.status === 200 && r.body.saved, "네이버 API 키 저장");
  const sealed = env.DB.prepare("SELECT sealed FROM market_connection").bind; // 저장된 값이 평문이 아닌지
  r = await call({ action: "list", business: "1" }); ok(r.body.connections.length === 1 && r.body.connections[0].market === "naver", "연결 목록에 네이버");
  const raw = await env.DB.prepare("SELECT sealed FROM market_connection WHERE business = ?").bind("1").first(); ok(!raw.sealed.includes(NAVER_SECRET) && !raw.sealed.includes("app-id"), "저장된 키는 암호화되어 있음");
  r = await call({ action: "test", business: "1", market: "naver" }); ok(r.status === 200 && r.body.connected === true, "네이버 연결 확인");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  r = await call({ action: "fetch", business: "1", market: "naver", date: today }); ok(r.status === 200 && r.body.items.length === 2, "네이버 주문 가져오기: " + (r.body.items || []).length + "건");
  const it = r.body.items[0]; ok(it.market === "naver" && it.number === "ORD2026112300001" && it.line === "2026112300001" && it.qty === 2 && it.price === 11900 && it.marketSku === "WN500" && it.status === "포장중", "주문 항목 변환(번호, 수량 2, 단가 11,900, 포장중)");
  r = await call({ action: "fetch", business: "1", market: "naver", date: "2099-01-01" }); ok(r.status === 400, "미래 날짜는 거부");
  r = await call({ action: "dispatch", business: "1", market: "naver", productOrderId: "2026112300001", deliveryCompanyCode: "CJGLS", trackingNumber: "123456789012" });
  ok(r.status === 200 && r.body.sent === true && sentToNaver[0].trackingNumber === "123456789012" && sentToNaver[0].deliveryCompanyCode === "CJGLS" && sentToNaver[0].auth === "Bearer tok-app-id", "송장 전송: 네이버로 상품주문번호·택배사·송장번호 전달");
  r = await call({ action: "dispatch", business: "1", market: "naver", productOrderId: "abc", deliveryCompanyCode: "CJGLS", trackingNumber: "1" }); ok(r.status === 400, "상품주문번호 형식이 틀리면 거부");
  r = await call({ action: "dispatch", business: "1", market: "coupang", productOrderId: "1", deliveryCompanyCode: "X", trackingNumber: "1" }); ok(r.status === 400, "네이버 외 송장 전송은 거부");
  r = await call({ action: "save", business: "2", market: "naver", id: "app-id", secret: NAVER_SECRET }); ok(r.status === 409, "같은 판매자 계정을 다른 사업자에 저장하면 거부");
  r = await call({ action: "save", business: "1", market: "coupang", id: "A00000000", access: "accesskey123", secret: "secretkey123" }); ok(r.status === 200, "쿠팡 API 키 저장");
  r = await call({ action: "fetch", business: "1", market: "coupang", date: today }); ok(r.status === 200 && r.body.items.length >= 1 && r.body.items[0].channel === "쿠팡" && r.body.items[0].status === "신규", "쿠팡 주문 가져오기");
  r = await call({ action: "list", business: "1" }); ok(r.body.connections.length === 2 && r.body.connections.every(c => c.last_sync || c.market === "coupang" || c.market === "naver"), "연결 목록 2개, 마지막 수집 시각 기록");
  console.log("FAILS", fails);
  process.exit(fails ? 1 : 0);
}
