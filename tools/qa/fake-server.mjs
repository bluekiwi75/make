// 가짜 D1 DB를 붙인 실제 Worker를 127.0.0.2:8790에 띄웁니다(데모 모드가 아닌 저장 흐름 테스트용). 먼저 node build.mjs 실행.
import { createServer } from "node:http";
const { default: worker } = await import(new URL("../../dist/server/index.js", import.meta.url));
const rows = new Map();
const today = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul"}).format(new Date());
const prods=[["AL500","구운 아몬드 500g",4400,120],["MX500","오리지날 믹스넛 500g",3800,3],["WN500","호두 500g",5200,60],["CN500","캐슈넛 500g",5200,40]].map(([sku,name,cost,units])=>({sku,name,cost,units,limit:5}));
const samples=[[0,"쿠팡","신규",3,10400],[1,"네이버","포장중",2,9900],[2,"쿠팡","발송완료",4,11900],[3,"올레즈","신규",1,12900],[1,"쿠팡","발송완료",1,10800],[0,"네이버","취소",2,10400]];
const seedOrders = samples.map(([i,channel,status,qty,price],j)=>({id:"s-"+j,number:"T-"+(10001+j),line:"",date:today,sku:prods[i].sku,name:prods[i].name,status,channel,qty,price,cost:prods[i].cost,fee:Math.round(price*qty*.1),shipping:2900,pack:350,discount:500,carrier:status==="발송완료"?"CJ대한통운":"",tracking:status==="발송완료"?"0000000000":""}));
const seed = {
  businessName:"테스트 사업자",
  products:prods,
  orders:seedOrders,
  officeRecordsExtra:undefined,
  purchases:[{id:"seed-1",date:"2026-11-01",supplier:"시드",name:"땅콩",memo:"",type:"bulk",unit:"박스",qty:1,price:50000,vat:5000,totalWeightKg:5,packsPerBox:1}],
  production:[{id:"prod-1",date:"2026-11-05",name:"땅콩 소포장",method:"자동 포장",unit:"봉",qty:10,memo:"",recipe:{id:"r1",unit:"봉",materials:[{name:"땅콩",grams:100}]}}],
  officeRecords:[{type:"recipes",id:"r1",name:"땅콩 소포장",detail:"땅콩 100g",note:"테스트",unit:"봉",materials:[{name:"땅콩",grams:100}]}]
};
const reset=()=>rows.set("test-user", {revision:1, payload:JSON.stringify({...seed,officeRecordsExtra:undefined})});
reset();
globalThis.__rows = rows;
const env = { DB:{ prepare(sql){ return { bind(...a){ return {
  async first(){ if(/SELECT revision, payload/.test(sql)) return rows.get(a[0])??null; if(/json_extract\(payload, '\$.businessName'\)/.test(sql)) return null; return null; },
  async run(){ if(/^UPDATE market_state/.test(sql)){ const r=rows.get(a[1]); if(r&&r.revision===a[2]){ rows.set(a[1],{revision:r.revision+1,payload:a[0]}); return {meta:{changes:1}}; } return {meta:{changes:0}}; }
    if(/^INSERT INTO market_state/.test(sql)){ if(!rows.has(a[0])){rows.set(a[0],{revision:1,payload:a[1]});return {meta:{changes:1}};} return {meta:{changes:0}}; } return {meta:{changes:0}}; } }; } }; } } };
const port = 8790;
createServer(async (inc, out) => {
  try {
    const chunks=[]; for await (const c of inc) chunks.push(c);
    const url = new URL(inc.url, "http://"+inc.headers.host);
    if (url.pathname==="/__reset") { reset(); out.writeHead(200).end("ok"); return; }
    if (url.pathname==="/__db") { out.writeHead(200,{"content-type":"application/json"}).end(rows.get("test-user").payload); return; }
    const headers = new Headers(); for (const [k,v] of Object.entries(inc.headers)) headers.set(k,String(v));
    headers.set("oai-authenticated-user-id","test-user");
    const res = await worker.fetch(new Request(url,{method:inc.method,headers,body:["GET","HEAD"].includes(inc.method)?undefined:Buffer.concat(chunks)}),env);
    out.writeHead(res.status,Object.fromEntries(res.headers)); out.end(Buffer.from(await res.arrayBuffer()));
  } catch(e){ out.writeHead(500).end(String(e)); }
}).listen(port,"0.0.0.0",()=>console.log("up"));
