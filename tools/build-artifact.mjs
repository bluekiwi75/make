// Claude 아티팩트용 단일 HTML을 만듭니다: node tools/build-artifact.mjs [--demo] [출력경로]
//  기본: 저장 모드. 페이지 안의 Worker가 데이터를 검증하고 아티팩트 db에 저장합니다(tools/artifact-persist.js).
//  --demo: 샘플 데이터로 고정한 체험 모드(저장 안 됨).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const demoMode = process.argv.includes("--demo");
const outArg = process.argv.slice(2).find(arg => !arg.startsWith("--"));
const p = f => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
let html = p("index.html");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
let app = p("app.js");
if (demoMode) {
  app = app.replace('if(location.hostname==="127.0.0.1"||location.hostname==="localhost"){demo=true;', '{demo=true;');
  if (!app.includes("{demo=true;")) throw Error("patch failed");
}
let persistScripts = "";
if (!demoMode) {
  const built = spawnSync(process.execPath, [fileURLToPath(new URL("../build.mjs", import.meta.url))], { stdio: "inherit" });
  if (built.status !== 0) throw Error("build.mjs failed");
  let worker = readFileSync(new URL("../dist/server/index.js", import.meta.url), "utf8")
    .replace(/^const assets = .*\n/, "const assets = {};\n")
    .replace("export default {", "globalThis.__marketWorker = {");
  if (worker.includes("export default") || !worker.includes("globalThis.__marketWorker")) throw Error("worker transform failed");
  persistScripts = "<script>" + readFileSync(new URL("./artifact-persist.js", import.meta.url), "utf8").replace(/<\/script/gi, "<\\/script") + "</script>\n" +
    "<script>(()=>{\n" + worker.replace(/<\/script/gi, "<\\/script") + "\n})();</script>\n";
}

const scan = p("purchase-scan.js");
const pageTextSrc = scan.slice(scan.indexOf("function pageText("), scan.indexOf("async function readDocument("));
if (!pageTextSrc.startsWith("function pageText(")) throw Error("pageText not found in purchase-scan.js");
const reader = `
const pdfBase="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
let pdfReady;
function loadPdfLibrary(){
  const add=src=>new Promise((resolve,reject)=>{const el=document.createElement("script");el.src=src;el.onload=resolve;el.onerror=()=>reject(Error("PDF 읽기 도구를 불러오지 못했습니다."));document.head.append(el);});
  return pdfReady??=add(pdfBase+"pdf.min.js").then(()=>add(pdfBase+"pdf.worker.min.js")).then(()=>{pdfjsLib.GlobalWorkerOptions.workerSrc=pdfBase+"pdf.worker.min.js";}).catch(error=>{pdfReady=null;throw error;});
}
async function scanPurchaseFile(scanner,file,pageLimit,signal,onProgress){
  if(!/\\.pdf$/i.test(file.name))throw Error("이 화면에서는 PDF 파일만 읽을 수 있습니다. 이미지는 내용을 붙여넣어 분석해 주세요.");
  onProgress("PDF 읽기 도구를 준비하는 중…");
  await loadPdfLibrary();
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
  const count=Math.min(pdf.numPages,pageLimit),pages=[];
  for(let i=1;i<=count;i++){
    if(signal.aborted)throw new DOMException("취소","AbortError");
    onProgress("PDF "+i+"/"+count+"쪽에서 텍스트 확인 중…");
    const {items}=await (await pdf.getPage(i)).getTextContent();
    pages.push(pageText(items));
  }
  const text=pages.join("\\n");
  if(text.trim().length<30)throw Error("스캔본이라 글자를 읽지 못했습니다. 내용을 붙여넣어 분석해 주세요.");
  return {text,pagesRead:count,totalPages:pdf.numPages};
}
`;
app = app.replace(/function scanPurchaseFile\(/, "function scanPurchaseFileUnused(") + pageTextSrc + reader;
const esc = s => s.replace(/<\/script/gi, "<\\/script");
const css = p("app.css");
const out = `<title>마켓데스크</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>body{background:#f4f6f2;color:#1d3029}${css}</style>
${body.replace(/<script[^>]*><\/script>/g, "")}
${persistScripts}<script>${esc(p("raw-stock.js"))}</script>
<script>${esc(p("statement.js"))}</script>
<script type="module">${esc(app)}</script>
`;
const target = new URL(outArg || "../dist/artifact/marketdesk.html", import.meta.url);
mkdirSync(new URL(".", target), { recursive: true });
writeFileSync(target, out);
console.log(fileURLToPath(target), out.length);
