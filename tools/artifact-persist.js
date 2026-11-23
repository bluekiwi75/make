// 아티팩트에서 앱이 데이터를 남기게 하는 연결 코드입니다.
// 앱이 부르는 /api/state 요청을 같은 페이지 안의 Worker(검증 코드 그대로)로 처리하고,
// Worker가 쓰는 D1 표(market_state)를 아티팩트의 db(claude.use("db"))에 저장합니다.
//
// 저장 구조(format 2): 사업자별로 메타 문서 1개와 내용 문서 여러 개를 둡니다.
//   state/b1            메타: {format, revision, businessName, parts:[{id,key,hash}], updatedAt}
//   state/b1-<조각id>   내용: {text}  (JSON 문자열, 한 문서 150KB 이하)
//   state/secret        판매자센터 로그인 정보 암호화 키(소유자만 읽을 수 있음)
// 주문(orders)은 주문일의 월별로 나눠 저장해서 새 주문을 가져와도 해당 월 문서만 다시 씁니다.
// 나머지 항목(원가시트, 레시피, 상품, 사입, 스케줄 등)은 항목마다 따로 저장합니다.
// 내용이 바뀐 문서만 쓰고(hash 비교), 없어진 문서는 지웁니다. format 1(조각 b1-0…)도 읽을 수 있습니다.
(() => {
  const OWNER = "artifact-owner";
  const PART_BYTES = 150000; // 문서 하나의 상한(256KiB)보다 넉넉히 작게
  const realFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  let dbPromise = null;
  const getDb = () => dbPromise ??= (window.claude && window.claude.use ? window.claude.use("db") : Promise.resolve(null));
  const slot = key => key === OWNER ? "b1" : "b2";
  let queue = Promise.resolve();
  const serial = job => { const run = queue.then(job, job); queue = run.catch(() => {}); return run; };
  const cache = new Map(); // slot -> {revision, payload}

  // 문자열 변경 감지용 해시(cyrb53)
  function hash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ":" + text.length;
  }
  const byteLength = text => encoder.encode(text).length;
  const safeId = text => text.replace(/[^A-Za-z0-9_\-.~]/g, "_").slice(0, 60);

  // 긴 JSON 문자열 하나를 150KB 이하 조각들로 나눕니다(글자 수로 줄여 가며 바이트를 확인).
  function splitText(text) {
    if (byteLength(text) <= PART_BYTES) return [text];
    const out = []; let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + 50000);
      while (end - start > 1 && byteLength(text.slice(start, end)) > PART_BYTES) end = start + Math.floor((end - start) * 0.8);
      out.push(text.slice(start, end)); start = end;
    }
    return out;
  }
  // 주문 배열을 주문일의 월별로 묶고, 한 달이 150KB를 넘으면 연속된 조각으로 나눕니다.
  function orderParts(orders) {
    const byMonth = new Map();
    for (const order of orders) {
      const month = typeof order.date === "string" && /^\d{4}-\d{2}/.test(order.date) ? order.date.slice(0, 7) : "none";
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(order);
    }
    const parts = [];
    for (const [month, rows] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0]))) {
      let current = [], size = 2, index = 0;
      const flush = () => { if (current.length) { parts.push({ id: "orders-" + month + "-" + index++, key: "orders", text: JSON.stringify(current) }); current = []; size = 2; } };
      for (const row of rows) {
        const text = JSON.stringify(row), bytes = byteLength(text) + 1;
        if (size + bytes > PART_BYTES) flush();
        current.push(row); size += bytes;
      }
      flush();
    }
    return parts;
  }
  function buildParts(payload) {
    const data = JSON.parse(payload);
    const parts = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (key === "orders" && Array.isArray(value)) { parts.push(...orderParts(value)); continue; }
      splitText(JSON.stringify(value)).forEach((text, i) => parts.push({ id: safeId(key) + "-" + i, key, text }));
    }
    if (!parts.some(part => part.key === "orders")) parts.push({ id: "orders-none-0", key: "orders", text: "[]" });
    return { parts: parts.map(part => ({ ...part, hash: hash(part.text) })), businessName: typeof data.businessName === "string" ? data.businessName : "" };
  }

  async function readMeta(db, key) {
    const meta = await db.doc("state/" + slot(key)).get();
    return meta.exists ? meta.data() : null;
  }
  async function readParts(db, name, ids) {
    const texts = new Array(ids.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (next < ids.length) {
        const i = next++;
        const doc = await db.doc("state/" + name + "-" + ids[i]).get();
        if (!doc.exists) throw new Error("저장된 데이터가 불완전합니다.");
        texts[i] = doc.data().text;
      }
    }));
    return texts;
  }
  async function readRow(db, key) {
    const name = slot(key);
    const meta = await readMeta(db, key);
    if (!meta) return null;
    const cached = cache.get(name);
    if (cached && cached.revision === meta.revision) return { revision: meta.revision, payload: cached.payload };
    let payload;
    if (meta.format === 2) {
      const texts = await readParts(db, name, meta.parts.map(part => part.id));
      const data = {}, orders = [];
      const grouped = new Map();
      meta.parts.forEach((part, i) => { if (!grouped.has(part.key)) grouped.set(part.key, []); grouped.get(part.key).push(texts[i]); });
      for (const [k, list] of grouped) {
        if (k === "orders") for (const text of list) orders.push(...JSON.parse(text));
        else data[k] = JSON.parse(list.join(""));
      }
      data.orders = orders;
      payload = JSON.stringify(data);
    } else { // format 1: 조각을 이어 붙인 한 덩어리
      const texts = await readParts(db, name, Array.from({ length: meta.chunks }, (_, i) => String(i)));
      payload = texts.join("");
    }
    cache.set(name, { revision: meta.revision, payload });
    return { revision: meta.revision, payload };
  }
  async function writeRow(db, key, revision, payload) {
    const name = slot(key);
    const old = await readMeta(db, key);
    const oldHashes = new Map(old && old.format === 2 ? old.parts.map(part => [part.id, part.hash]) : []);
    const { parts, businessName } = buildParts(payload);
    for (const part of parts) if (oldHashes.get(part.id) !== part.hash) await db.doc("state/" + name + "-" + part.id).set({ text: part.text });
    await db.doc("state/" + name).set({ format: 2, revision, businessName, parts: parts.map(({ id, key: k, hash: h }) => ({ id, key: k, hash: h })), updatedAt: new Date().toISOString() });
    // 이제 쓰이지 않는 이전 문서를 지웁니다.
    const keep = new Set(parts.map(part => part.id));
    if (old && old.format === 2) for (const part of old.parts) if (!keep.has(part.id)) await db.doc("state/" + name + "-" + part.id).delete();
    if (old && old.format !== 2) for (let i = 0; i < (old.chunks || 0); i++) await db.doc("state/" + name + "-" + i).delete();
    cache.set(name, { revision, payload });
  }

  // 판매자센터 로그인 정보를 암호화하는 키: 처음 필요할 때 만들어 db(state/secret)에 둡니다(소유자만 읽을 수 있음).
  let secretPromise = null;
  const secretKey = db => secretPromise ??= (async () => {
    const doc = await db.doc("state/secret").get();
    if (doc.exists && doc.data().key) return doc.data().key;
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await db.doc("state/secret").set({ key });
    return key;
  })().catch(error => { secretPromise = null; throw error; });

  // 판매처 API 연동: 외부 접속은 claude.ai 커넥터 ‘마켓데스크 연동’(bridge/ 폴더의 연동 서버)을 통해서만 합니다.
  const BRIDGE_SERVER = "마켓데스크 연동";
  class BridgeError extends Error { constructor(message, status) { super(message); this.status = status; } }
  async function bridgeCall(args) {
    const mcp = window.claude && window.claude.use ? await window.claude.use("mcp") : null;
    if (!mcp) throw new BridgeError("연동 서버를 사용할 수 없습니다. claude.ai에 로그인한 상태에서 이 사이트를 열어 주세요.", 503);
    let result;
    try { result = await mcp.callTool(BRIDGE_SERVER, "market_api", args, { cache: false }); }
    catch (error) {
      const code = error && error.code;
      if (["server_not_connected", "server_not_found", "not_granted", "needs_reauth"].includes(code))
        throw new BridgeError("‘" + BRIDGE_SERVER + "’ 커넥터가 연결되어 있지 않거나 허용되지 않았습니다. claude.ai 설정의 커넥터에서 연동 서버를 추가하고 이 사이트의 사용을 허용해 주세요.", 503);
      throw new BridgeError("연동 서버를 호출하지 못했습니다" + (code ? " (" + code + ")" : "") + ". 잠시 후 다시 시도해 주세요.", 502);
    }
    const out = result && result.payload;
    if (!out || typeof out.status !== "number" || !out.body) throw new BridgeError("연동 서버의 응답을 읽을 수 없습니다.", 502);
    return out;
  }
  const kstDay = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  const carrierCodes = { "CJ대한통운": "CJGLS", "대한통운": "CJGLS", "우체국택배": "EPOST", "한진택배": "HANJIN", "롯데택배": "HYUNDAI", "로젠택배": "KGB" };

  // 앱 데이터 읽기·쓰기(같은 Worker의 /api/state를 거쳐 검증을 받습니다)
  async function stateCall(method, business, payload) {
    const url = new URL("/api/state?business=" + business, location.href);
    const headers = new Headers({ "content-type": "application/json" });
    headers.set("oai-authenticated-user-id", OWNER); headers.set("origin", url.origin);
    const response = await globalThis.__marketWorker.fetch(new LocalRequest(url.href, { method, headers, body: payload ? JSON.stringify(payload) : undefined }), env);
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  async function handleMarkets(url, init) {
    const business = url.searchParams.get("business") || "1";
    try {
      if ((init.method || "GET").toUpperCase() === "GET") { const out = await bridgeCall({ action: "list", business }); return reply(out.body, out.status); }
      let input;
      try { input = JSON.parse(init.body); } catch { return reply({ error: "입력 내용을 확인해 주세요." }, 400); }
      const { market, action } = input || {};
      if (action === "save") { const { id, secret, access, issuer } = input; const out = await bridgeCall({ action, business, market, id, secret, access, issuer }); return reply(out.body, out.status); }
      if (action === "test") { const out = await bridgeCall({ action, business, market }); return reply(out.body, out.status); }
      if (action === "sync") {
        const out = await bridgeCall({ action: "fetch", business, market, date: input.date });
        if (out.status !== 200) return reply(out.body, out.status);
        const lib = globalThis.__marketLib;
        for (let attempt = 0; attempt < 3; attempt++) {
          const state = await stateCall("GET", business);
          if (state.status !== 200) return reply({ error: "주문 목록을 불러오지 못했습니다." }, 500);
          const merged = lib.mergeMarketOrders(state.body.data, out.body.items);
          if (!merged.added && !merged.updated) return reply({ added: merged.added, updated: merged.updated, skipped: merged.skipped }, 200);
          const saved = await stateCall("PUT", business, { rev: state.body.rev, data: merged.data });
          if (saved.status === 200) return reply({ added: merged.added, updated: merged.updated, skipped: merged.skipped }, 200);
          if (saved.status !== 409) return reply({ error: saved.body.error || "주문 저장 한도에 도달했거나 일부 주문 정보가 지원 범위를 벗어났습니다." }, 422);
        }
        return reply({ error: "사업자 자료가 변경되었습니다. 다시 가져와 주세요." }, 409);
      }
      if (action === "dispatch") {
        if (market !== "naver") return reply({ error: "지원하지 않는 작업입니다." }, 400);
        const state = await stateCall("GET", business);
        if (state.status !== 200 || state.body.rev !== input.rev) return reply({ error: "주문 목록을 새로고침해 주세요." }, 409);
        const { orders, officeRecords = [] } = state.body.data;
        const index = orders.findIndex(o => o.id === input.id), order = orders[index];
        if (!order || order.market !== "naver" || !["신규", "포장중"].includes(order.status) || !order.line || !order.tracking || !order.carrier) return reply({ error: "전송할 주문과 송장 정보를 확인해 주세요." }, 400);
        const carrier = order.carrier.replace(/\s/g, "");
        const configured = officeRecords.find(item => item.type === "carriers" && item.name.replace(/\s/g, "") === carrier);
        const code = (configured?.detail || carrierCodes[carrier] || carrier).toUpperCase();
        if (!/^[A-Z0-9_]+$/.test(code)) return reply({ error: "택배사에 네이버 택배사 코드를 입력해 주세요." }, 400);
        const sent = await bridgeCall({ action: "dispatch", business, market, productOrderId: order.line, deliveryCompanyCode: code, trackingNumber: order.tracking });
        if (sent.status !== 200) return reply(sent.body, sent.status);
        const fresh = await stateCall("GET", business);
        const at = fresh.body.data.orders.findIndex(o => o.id === order.id);
        const target = fresh.body.data.orders[at];
        if (at < 0 || target.tracking !== order.tracking || target.carrier !== order.carrier || !["신규", "포장중"].includes(target.status)) return reply({ error: "네이버 전송 완료. 목록이 변경되어 주문 상태를 다시 수집해 주세요." }, 409);
        const next = { ...fresh.body.data, orders: fresh.body.data.orders.map((o, i) => i === at ? { ...o, status: "발송완료", shipDate: kstDay() } : o) };
        const saved = await stateCall("PUT", business, { rev: fresh.body.rev, data: next });
        if (saved.status !== 200) return reply({ error: "네이버 전송 완료. 목록이 변경되어 주문 상태를 다시 수집해 주세요." }, 409);
        return reply({ sent: true }, 200);
      }
      return reply({ error: "지원하지 않는 작업입니다." }, 400);
    } catch (error) {
      if (error instanceof BridgeError) return reply({ error: error.message }, error.status);
      return reply({ error: "판매처 연결을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
    }
  }

  // Cloudflare D1의 일부(market_state 표)를 흉내 냅니다.
  const env = { DB: { prepare(sql) { return { bind(...a) { return {
    async first() {
      const db = await getDb(); if (!db) throw new Error("저장소를 사용할 수 없습니다.");
      if (/SELECT revision, payload FROM market_state/.test(sql)) return serial(() => readRow(db, a[0]));
      if (/json_extract\(payload, '\$\.businessName'\)/.test(sql)) {
        const meta = await serial(() => readMeta(db, a[0]));
        if (!meta) return null;
        if (meta.format === 2) return { name: meta.businessName || undefined };
        const row = await serial(() => readRow(db, a[0]));
        return row ? { name: JSON.parse(row.payload).businessName } : null;
      }
      return null;
    },
    async run() {
      const db = await getDb(); if (!db) throw new Error("저장소를 사용할 수 없습니다.");
      return serial(async () => {
        if (/^INSERT INTO market_state/.test(sql)) {
          if (await readMeta(db, a[0])) return { meta: { changes: 0 } };
          await writeRow(db, a[0], 1, a[1]); return { meta: { changes: 1 } };
        }
        if (/^UPDATE market_state/.test(sql)) {
          const meta = await readMeta(db, a[1]);
          if (!meta || meta.revision !== a[2]) return { meta: { changes: 0 } };
          await writeRow(db, a[1], meta.revision + 1, a[0]); return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      });
    }
  }; } }; } } };

  class LocalRequest {
    constructor(url, init) {
      this.url = url; this.method = (init.method || "GET").toUpperCase();
      this.headers = new Headers(init.headers || {});
      this.bodyBytes = init.body == null ? new Uint8Array() : null;
      this._body = init.body;
    }
    async arrayBuffer() {
      if (this.bodyBytes) return this.bodyBytes.buffer;
      const b = this._body;
      const bytes = typeof b === "string" ? encoder.encode(b) : b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(b);
      return bytes.buffer;
    }
    async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
    async json() { return JSON.parse(await this.text()); }
  }
  const reply = (body, status) => Response.json(body, { status });

  window.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    if (url.pathname === "/api/purchase-document") return reply({ error: "원본 파일 저장은 지원하지 않습니다." }, 503);
    const worker = globalThis.__marketWorker;
    if (!worker) return reply({ error: "저장 기능을 불러오지 못했습니다." }, 503);
    if (!(await getDb())) return reply({ error: "저장소를 사용할 수 없습니다. 로그인한 상태에서 다시 열어 주세요." }, 503);
    if (url.pathname === "/api/markets") return handleMarkets(url, init);
    const headers = new Headers(init.headers || {});
    headers.set("oai-authenticated-user-id", OWNER);
    headers.set("origin", url.origin);
    try { const db = await getDb(); env.MARKET_CONNECTION_KEY = await secretKey(db); return await worker.fetch(new LocalRequest(url.href, { ...init, headers }), env); }
    catch (error) { return reply({ error: "저장 중 오류가 발생했습니다." }, 500); }
  };
})();
