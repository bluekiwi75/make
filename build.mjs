import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const assets = {};
for (const [name,type] of [["index.html","text/html"],["app.css","text/css"],["app.js","text/javascript"],["raw-stock.js","text/javascript"],["purchase-scan.html","text/html"],["purchase-scan.js","text/javascript"]]) {
  assets["/" + name] = {type, body: await readFile(new URL("public/" + name, import.meta.url), "utf8")};
}
const scanner=assets["/purchase-scan.js"].body.replace(/\r\n?/g,"\n");
assets["/purchase-scan.html"].body=assets["/purchase-scan.html"].body.replace(
  '<script defer src="/purchase-scan.js"></script>',()=>"<script>"+scanner+"</script>"
);
const scannerHash=createHash("sha256").update(scanner).digest("base64");
const worker = await readFile(new URL("worker.mjs", import.meta.url), "utf8");
const markets = await readFile(new URL("markets.mjs", import.meta.url), "utf8");
const extra = await readFile(new URL("additional-markets.mjs",import.meta.url),"utf8");
const saxSource = await readFile(new URL("vendor/sax.js",import.meta.url),"utf8");
const xmlParser = "const sax=(()=>{const exports={};\n"+saxSource+"\nreturn exports;})();\n";
const bcryptUmd = await readFile(new URL("vendor/bcryptjs-3.0.3.js", import.meta.url), "utf8");
const bcrypt = "const bcrypt = (() => {const module = {exports:{}};const exports=module.exports;const require=()=>globalThis.crypto;\n" +
  bcryptUmd + "\nreturn module.exports;})();\n";
await mkdir(new URL("dist/server/", import.meta.url), {recursive:true});
await mkdir(new URL("dist/.openai/", import.meta.url), {recursive:true});
await writeFile(new URL("dist/server/index.js", import.meta.url), "const assets = " + JSON.stringify(assets) + ";\nconst scannerHash = " + JSON.stringify(scannerHash) + ";\n" + xmlParser + bcrypt + assets["/raw-stock.js"].body + "\n" + worker + "\n" + markets + "\n" + extra);
await copyFile(new URL(".openai/hosting.json", import.meta.url), new URL("dist/.openai/hosting.json", import.meta.url));
