// 아티팩트에서 앱이 데이터를 남기게 하는 연결 코드입니다.
// 앱이 부르는 /api/state 요청을 같은 페이지 안의 Worker(검증 코드 그대로)로 처리하고,
// Worker가 쓰는 D1 표(market_state)를 아티팩트의 db(claude.use("db"))에 저장합니다.
//
// 저장 구조(format 2): 사업자별로 메타 문서 1개와 내용 문서 여러 개를 둡니다.
//   state/b1            메타: {format, revision, businessName, parts:[{id,key,hash}], updatedAt}
//   state/b1-<조각id>   내용: {text}  (JSON 문자열, 한 문서 150KB 이하)
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
    if (url.pathname === "/api/markets") return reply({ error: "이 사이트에서는 판매처 API 연동을 사용하지 않습니다." }, 503);
    if (url.pathname === "/api/purchase-document") return reply({ error: "원본 파일 저장은 지원하지 않습니다." }, 503);
    const worker = globalThis.__marketWorker;
    if (!worker) return reply({ error: "저장 기능을 불러오지 못했습니다." }, 503);
    if (!(await getDb())) return reply({ error: "저장소를 사용할 수 없습니다. 로그인한 상태에서 다시 열어 주세요." }, 503);
    const headers = new Headers(init.headers || {});
    headers.set("oai-authenticated-user-id", OWNER);
    headers.set("origin", url.origin);
    try { return await worker.fetch(new LocalRequest(url.href, { ...init, headers }), env); }
    catch (error) { return reply({ error: "저장 중 오류가 발생했습니다." }, 500); }
  };
})();
