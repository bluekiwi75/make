// 마켓데스크 연동 서버(MCP): 판매처 API 호출과 API 키 보관만 맡습니다. 주문 저장은 사이트가 합니다.
// 이 파일은 bridge/build.mjs가 앱의 Worker 코드(markets.mjs 등) 뒤에 붙여서 하나의 Worker로 만듭니다.
// 그래서 validatedCredentials, sealMarket, collectors, naverToken, marketFetch 같은 이름을 그대로 씁니다.

const BRIDGE_OWNER = "bridge-owner";
const BRIDGE_TOOL = {
  name: "market_api",
  description: "마켓데스크 판매처 연동. action: list(연결 목록), save(API 키 저장), test(연결 확인), fetch(하루치 주문 가져오기), dispatch(네이버 송장 전송). 결과는 {status, body} JSON입니다.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "save", "test", "fetch", "dispatch"] },
      business: { type: "string", enum: ["1", "2"] },
      market: { type: "string", enum: ["coupang", "naver", "eleven", "auction", "gmarket"] },
      date: { type: "string", description: "fetch: 조회 날짜(YYYY-MM-DD)" },
      id: { type: "string" }, secret: { type: "string" }, access: { type: "string" }, issuer: { type: "string" },
      productOrderId: { type: "string", description: "dispatch: 네이버 상품주문번호" },
      deliveryCompanyCode: { type: "string", description: "dispatch: 택배사 코드(예: CJGLS)" },
      trackingNumber: { type: "string", description: "dispatch: 송장번호" }
    },
    required: ["action", "business"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: false, openWorldHint: true }
};

function sameText(a, b) {
  const x = marketEncoder.encode(String(a)), y = marketEncoder.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function bridgeApi(env, input) {
  if (!env.DB) throw new MarketError("저장소(D1)가 연결되지 않았습니다.", 503);
  const business = input.business;
  if (!Object.hasOwn(businessDefaults, business)) throw new MarketError("사업자를 선택해 주세요.");
  const owner = BRIDGE_OWNER, action = input.action;
  if (action === "list") {
    const rows = await env.DB.prepare("SELECT market,last_sync FROM market_connection WHERE owner_id = ? AND business = ? UNION ALL SELECT market,last_sync FROM market_connection_extra WHERE owner_id = ? AND business = ?")
      .bind(owner, business, owner, business).all();
    return { connections: rows.results };
  }
  const market = input.market;
  if (!Object.hasOwn(marketProviders, market)) throw new MarketError("지원 판매처를 선택해 주세요.");
  const aad = marketAad(owner, business, market);
  const table = newMarketTable(market);
  if (action === "save") {
    const credentials = validatedCredentials(market, input);
    const sellerHash = marketHex(await crypto.subtle.digest("SHA-256", marketEncoder.encode(JSON.stringify([owner, market, market === "eleven" ? credentials.secret : credentials.id.toLowerCase()]))));
    const exists = await env.DB.prepare("SELECT business FROM " + table + " WHERE owner_id = ? AND market = ? AND seller_hash = ? AND business <> ?").bind(owner, market, sellerHash, business).first();
    if (exists) throw new MarketError("이 판매자 계정은 다른 사업자에 이미 등록되어 있습니다.", 409);
    const sealed = await sealMarket(env, aad, credentials);
    await env.DB.prepare("INSERT INTO " + table + " (owner_id,business,market,seller_hash,sealed) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,business,market) DO UPDATE SET seller_hash=excluded.seller_hash,sealed=excluded.sealed,last_sync=CASE WHEN " + table + ".seller_hash=excluded.seller_hash THEN " + table + ".last_sync END")
      .bind(owner, business, market, sellerHash, sealed).run();
    return { saved: true };
  }
  if (!["test", "fetch", "dispatch"].includes(action)) throw new MarketError("지원하지 않는 작업입니다.");
  if (action === "dispatch" && market !== "naver") throw new MarketError("송장 전송은 네이버만 지원합니다.");
  const saved = await env.DB.prepare("SELECT sealed FROM " + table + " WHERE owner_id = ? AND business = ? AND market = ?").bind(owner, business, market).first();
  if (!saved) throw new MarketError("이 사업자의 API 키를 먼저 저장해 주세요.", 409);
  const credentials = await openMarket(env, aad, saved.sealed);
  if (action === "dispatch") {
    const productOrderId = String(input.productOrderId || ""), tracking = String(input.trackingNumber || ""), code = String(input.deliveryCompanyCode || "").toUpperCase();
    if (!/^\d{1,40}$/.test(productOrderId) || !tracking || tracking.length > 60 || !/^[A-Z0-9_]+$/.test(code)) throw new MarketError("전송할 주문과 송장 정보를 확인해 주세요.");
    const headers = { ...await naverToken(credentials), "Content-Type": "application/json" };
    const r = await marketFetch("naver", naverOrdersUrl + "/dispatch", { method: "POST", headers, body: JSON.stringify({ dispatchProductOrders: [{ productOrderId, deliveryMethod: "DELIVERY", deliveryCompanyCode: code, trackingNumber: tracking, dispatchDate: new Date().toISOString() }] }) });
    if (!r.data?.successProductOrderIds?.map(String).includes(productOrderId)) throw new MarketError(r.data?.failProductOrderInfos?.[0]?.message || "전송 결과를 판매자센터에서 확인해 주세요.", 422);
    return { sent: true };
  }
  const today = marketDay(new Date());
  const date = action === "fetch" ? input.date : today;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today) throw new MarketError("조회 날짜를 확인해 주세요.");
  const items = await collectors[market](credentials, date, action === "test", market);
  if (action === "test") return { connected: true };
  await env.DB.prepare("UPDATE " + table + " SET last_sync = ? WHERE owner_id = ? AND business = ? AND market = ?").bind(new Date().toISOString(), owner, business, market).run();
  return { items: items.filter(Boolean) };
}

async function bridgeCall(env, args) {
  try { return { status: 200, body: await bridgeApi(env, args || {}) }; }
  catch (error) {
    if (error instanceof MarketError) return { status: error.status, body: { error: error.message } };
    console.error("bridge error", error && error.name);
    return { status: 500, body: { error: "연동 서버에서 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." } };
  }
}

async function bridgeRpc(env, message) {
  const { id, method, params } = message || {};
  const ok = result => ({ jsonrpc: "2.0", id, result });
  const fail = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
  if (id === undefined || id === null) return null; // 알림(notification)에는 답하지 않습니다
  if (method === "initialize") return ok({ protocolVersion: params?.protocolVersion || "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "marketdesk-bridge", version: "1.0.0" } });
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: [BRIDGE_TOOL] });
  if (method === "tools/call") {
    if (params?.name !== BRIDGE_TOOL.name) return fail(-32602, "알 수 없는 도구입니다.");
    const result = await bridgeCall(env, params.arguments);
    return ok({ content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
  }
  return fail(-32601, "지원하지 않는 요청입니다.");
}

async function bridgeFetch(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/mcp\/([A-Za-z0-9_-]{16,})$/);
  if (!match || !env.BRIDGE_TOKEN || !sameText(match[1], env.BRIDGE_TOKEN)) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return new Response("", { status: 405, headers: { Allow: "POST" } });
  let body;
  try { body = await request.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON을 읽을 수 없습니다." } }, { status: 400 }); }
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map(message => bridgeRpc(env, message)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(batch ? replies : replies[0]);
}
