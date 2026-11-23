// 연동 서버를 하나의 Worker 파일(bridge/dist/worker.js)로 만듭니다: node bridge/build.mjs
// 앱의 Worker 번들(build.mjs 결과)에서 사이트 화면 파일과 기본 진입점을 빼고, 연동 서버 코드를 붙입니다.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const built = spawnSync(process.execPath, [fileURLToPath(new URL("build.mjs", root))], { stdio: "inherit" });
if (built.status !== 0) throw Error("build.mjs failed");
let base = readFileSync(new URL("dist/server/index.js", root), "utf8")
  .replace(/^const assets = .*\n/, "const assets = {};\n")
  .replace("export default {", "const appWorker = {");
if (base.includes("export default")) throw Error("transform failed");
const bridge = readFileSync(new URL("bridge/bridge.mjs", root), "utf8");
const out = base + "\n" + bridge + "\nexport default { fetch: bridgeFetch };\n";
mkdirSync(new URL("bridge/dist/", root), { recursive: true });
writeFileSync(new URL("bridge/dist/worker.js", root), out);
console.log(fileURLToPath(new URL("bridge/dist/worker.js", root)), out.length);
