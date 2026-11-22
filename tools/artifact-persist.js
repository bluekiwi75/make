// 아티팩트에서 앱이 데이터를 남기게 하는 연결 코드입니다.
// 앱이 부르는 /api/state 요청을 같은 페이지 안의 Worker(검증 코드 그대로)로 처리하고,
// Worker가 쓰는 D1 표(market_state)를 아티팩트의 db(claude.use("db"))에 저장합니다.
// 문서 하나는 256KiB 이하여야 해서 저장 내용을 조각(chunk)으로 나눠 적습니다.
(() => {
  const OWNER = "artifact-owner";
  const CHUNK = 50000; // 글자 수. 한글은 3바이트라 150KB 안쪽에 머뭅니다.
  const realFetch = window.fetch.bind(window);
  let dbPromise = null;
  const getDb = () => dbPromise ??= (window.claude && window.claude.use ? window.claude.use("db") : Promise.resolve(null));
  const slot = key => key === OWNER ? "b1" : "b2";
  let queue = Promise.resolve();
  const serial = job => { const run = queue.then(job, job); queue = run.catch(() => {}); return run; };

  async function readRow(db, key) {
    const meta = await db.doc("state/" + slot(key)).get();
    if (!meta.exists) return null;
    const { revision, chunks } = meta.data();
    const parts = await Promise.all(Array.from({ length: chunks }, (_, i) => db.doc("state/" + slot(key) + "-" + i).get()));
    if (parts.some(part => !part.exists)) throw new Error("저장된 데이터가 불완전합니다.");
    return { revision, payload: parts.map(part => part.data().text).join("") };
  }
  async function writeRow(db, key, revision, payload) {
    const name = slot(key);
    const before = await db.doc("state/" + name).get();
    const oldChunks = before.exists ? before.data().chunks : 0;
    const count = Math.max(1, Math.ceil(payload.length / CHUNK));
    for (let i = 0; i < count; i++) await db.doc("state/" + name + "-" + i).set({ text: payload.slice(i * CHUNK, (i + 1) * CHUNK) });
    await db.doc("state/" + name).set({ revision, chunks: count, updatedAt: new Date().toISOString() });
    for (let i = count; i < oldChunks; i++) await db.doc("state/" + name + "-" + i).delete();
  }

  // Cloudflare D1의 일부(market_state 표)를 흉내 냅니다.
  const env = { DB: { prepare(sql) { return { bind(...a) { return {
    async first() {
      const db = await getDb(); if (!db) throw new Error("저장소를 사용할 수 없습니다.");
      if (/SELECT revision, payload FROM market_state/.test(sql)) return serial(() => readRow(db, a[0]));
      if (/json_extract\(payload, '\$\.businessName'\)/.test(sql)) {
        const row = await serial(() => readRow(db, a[0]));
        return row ? { name: JSON.parse(row.payload).businessName } : null;
      }
      return null;
    },
    async run() {
      const db = await getDb(); if (!db) throw new Error("저장소를 사용할 수 없습니다.");
      return serial(async () => {
        if (/^INSERT INTO market_state/.test(sql)) {
          if (await readRow(db, a[0])) return { meta: { changes: 0 } };
          await writeRow(db, a[0], 1, a[1]); return { meta: { changes: 1 } };
        }
        if (/^UPDATE market_state/.test(sql)) {
          const row = await readRow(db, a[1]);
          if (!row || row.revision !== a[2]) return { meta: { changes: 0 } };
          await writeRow(db, a[1], row.revision + 1, a[0]); return { meta: { changes: 1 } };
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
      const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(b);
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
