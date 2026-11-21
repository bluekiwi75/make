import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const build = fileURLToPath(new URL("./build.mjs", import.meta.url));
const result = spawnSync(process.execPath, [build], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const { default: worker } = await import("./dist/server/index.js");
const host = "127.0.0.1";
const port = Number(process.env.MARKETDESK_PORT || 8787);
const origin = "http://" + host + ":" + port;

createServer(async (incoming, outgoing) => {
  try {
    const method = incoming.method;
    if (!["GET", "HEAD"].includes(method)) {
      outgoing.writeHead(405).end();
      return;
    }
    const url = new URL(incoming.url, origin);
    if (url.origin !== origin) {
      outgoing.writeHead(400).end();
      return;
    }
    const response = await worker.fetch(new Request(url, { method }), {});
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(500).end("Local preview could not load the page.");
  }
}).listen(port, host, () => console.log("MarketDesk demo: " + origin + "/"));