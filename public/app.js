const $ = (id) => document.getElementById(id);
const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = new Intl.NumberFormat("ko-KR");
const won = n => fmt.format(n) + "원";
const day = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul"}).format(new Date());
const channels = ["쿠팡","네이버","11번가","옥션","지마켓","올웨이즈","올레즈","기타"];
const states = ["신규","포장중","발송완료","취소","반품"];
const tabs = {
  home:["대시보드","M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z"],
  orders:["통합 주문","M5 4h14v17H5z M8 8h8 M8 12h8 M8 16h5"],
  ship:["배송·송장","M2 5h13v12H2z M15 9h4l3 4v4h-7 M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  stock:["상품·재고","M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10"],
  profit:["판매 손익","M3 4v17h18 M7 16l5-5 4 2 5-7"],
  purchases:["사입관리","M3 4h3l3 11h10l2-8H7 M10 20h1 M17 20h1"],
  salesManagement:["매출 관리"],
  purchaseOrders:["발주 관리"],
  recipes:["제품 레시피"],
  production:["생산관리","M3 21V9l6 3V7l6 3V3h4l2 18H3z M7 16h2 M13 16h2"],
  statistics:["통계관리","M3 3v18h18 M7 16v-4 M12 16V8 M17 16V5"],
  setup:["판매처 설정","M10 13a4 4 0 0 0 6 0l4-4a4 4 0 1 0-6-6l-2 2 M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 1 0 6 6l2-2"]
};
const icon = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="'+d+'"/></svg>';
let store = {orders:[],products:[]}, rev = 0, ready = false, busy = false;
const defaultNames = {"1":"사업자 1","2":"사업자 2"};
let names = {...defaultNames}, business = "1", switching = false;
try { if(sessionStorage.getItem("market-business")==="2") business="2"; } catch {}
const linkedBusiness=new URLSearchParams(location.search).get("business");
if(Object.hasOwn(defaultNames,linkedBusiness))business=linkedBusiness;
let filter = {q:"",channel:"",status:""};
let demo = false;
let demoStores = {};
const marketNames={coupang:"쿠팡 Wing",naver:"네이버 스마트스토어",eleven:"11번가",auction:"옥션",gmarket:"지마켓"};
let marketConnections={}, marketLoaded=false, marketLoading=false, marketError="";
let toastTimer;
const rangeByPage = {};
function dateRange(view) {
  if (!rangeByPage[view]) {
    const today = day();
    const monthly = view === "home" || view === "profit";
    rangeByPage[view] = {
      start: monthly ? today.slice(0, 7) + "-01" : "",
      end: monthly ? today : ""
    };
  }
  return rangeByPage[view];
}
function periodOrders(view) {
  if(Object.hasOwn(tasks,view))return store.orders;
  const {start, end} = dateRange(view);
  return store.orders.filter(o => (!start || o.date >= start) && (!end || o.date <= end));
}
function rangeControl(view) {
  const {start, end} = dateRange(view);
  return '<form class="range-filter" id="period-form"><strong>조회 기간 · '+(view==="purchases"?"매입일":view==="production"?"생산일":"주문일")+'</strong>' +
    '<label><input type="date" name="start" aria-label="시작일" value="' + esc(start) + '"></label><span>~</span>' +
    '<label><input type="date" name="end" aria-label="종료일" value="' + esc(end) + '"></label>' +
    '<button type="submit" class="primary">조회</button>' + btn("전체 기간","all-dates") + '</form>';
}
function readPeriod(form) {
  if (!form.reportValidity()) return;
  const {start, end} = form.elements;
  if (start.value && end.value && start.value > end.value) {
    notify("종료일을 시작일과 같거나 이후로 선택해 주세요.");
    end.focus();
    return;
  }
  return {start:start.value, end:end.value};
}
const tasks={collect:["주문수집",tabs.orders[1]],export:["인쇄파일 내보내기",tabs.profit[1]],printFolder:["폴더 설정","M3 6h7l2 2h9v11H3z"],invoices:["송장번호 가져오기",tabs.ship[1]],dispatch:["송장번호 전송",tabs.ship[1]]};
const queues={
 results:["수집 결과확인",o=>!!o.market],
 bundles:["묶음누락 점검",o=>!o.tracking&&["신규","포장중"].includes(o.status)&&store.orders.some(other=>other.id!==o.id&&other.channel===o.channel&&other.number===o.number)],
 notes:["배송메모 점검",o=>!!o.deliveryMemo],
 matching:["상품매칭",o=>!o.sku], searchOrders:["찾아 바꾸기",()=>true],
 waitingPrint:["인쇄대기 목록",o=>!o.tracking&&["신규","포장중"].includes(o.status)],
 waitingShip:["발송대기 목록",o=>!!o.tracking&&["신규","포장중"].includes(o.status)],
 cancelled:["취소주문체크...",o=>["취소","반품"].includes(o.status)],
 shippingWork:["발송처리",o=>!!o.carrier&&!!o.tracking&&["신규","포장중"].includes(o.status)],
 completed:["발송완료 목록",o=>o.status==="발송완료"]
};
for(const [id,[name]] of Object.entries(queues))tasks[id]=[name,tabs.orders[1]];
const taskOverview=["ship","전체송장 목록"];
const sidebarTasks=["collect","export","invoices","dispatch"];
const taskGroups=[
  ["1. 주문수집",["collect","results","bundles","notes","matching","searchOrders"],"waitingPrint"],
  ["2. 송장인쇄",["export","invoices"],"waitingShip"],
  ["3. 상품발송",["cancelled","shippingWork","dispatch"],"completed"]
];
function queueView(id){
 const [title,test]=queues[id],rows=periodOrders(id).filter(test);
 const actions=id==="shippingWork"?btn("선택 발송처리","complete-selected",true):"";
 const descriptions={bundles:"같은 판매처·주문번호에서 송장이 없는 상품을 점검합니다.",searchOrders:"상품명과 배송메모의 바꾸기 규칙을 위에서부터 인쇄파일에 적용합니다.",shippingWork:"택배사와 송장번호가 등록된 주문을 선택해 발송일과 상태를 저장합니다. 네이버 API 주문은 송장번호 전송에서 처리하세요."};
 return head(title,descriptions[id]||"현재 사업자의 해당 주문상품을 조회합니다.",actions)+
 (id==="results"?collectionSummary():"")+
 (id==="searchOrders"?printRulesPanel():"")+
 '<section class="panel">'+panelHead(title+' · '+rows.length+'건',id==="shippingWork"?selectionActions():"")+'<div class="filters"><input type="search" id="queue-search" aria-label="목록 검색" placeholder="주문번호, 상품명, 판매처 검색"></div><div id="queue-result">'+orderTable(sorted(rows),true)+'</div></section>';
}
const page=()=>{const id=location.hash.slice(1);return [tabs,tasks,officeViews].some(items=>Object.hasOwn(items,id))?id:"home";};
const key = o => JSON.stringify([o.channel,o.number,o.line]);
const usesStock = o => !!o.sku && !["취소","반품"].includes(o.status) &&
  (o.stockOverride ?? (["포장중","발송완료"].includes(o.status)||!!o.market));
const stockUsed = (data,sku) => data.orders.filter(o=>o.sku===sku&&usesStock(o)).reduce((sum,o)=>sum+o.qty,0);
const costsReady = o => !o.market||o.costsReviewed;
const info = o => {
  const gross=o.marketGross??o.qty*o.price, cogs=o.qty*o.cost;
  return {gross,cogs,profit:gross-cogs-o.fee-o.shipping-o.pack-o.discount};
};
const sorted = orders => [...orders].sort((a,b)=>b.date.localeCompare(a.date));
const options = (rows, current) => rows.map(r=>{const [v,l]=Array.isArray(r)?r:[r,r];return '<option value="'+esc(v)+'"'+(current===v?' selected':'')+'>'+esc(l)+'</option>';}).join("");
const btn = (label,action,primary=false) => '<button type="button" data-action="'+action+'"'+(primary?' class="primary"':'')+'>'+label+'</button>';
const bplus = icon("M12 5v14 M5 12h14");
const bfile = icon("M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5");
const pageHeading = (title,desc,actions="")=>'<div class="hero"><div><h1>'+title+'</h1><p>'+desc+'</p></div><div class="buttons">'+actions+'</div></div>';
const head = (title,desc,actions)=>pageHeading(title,desc,actions)+(Object.hasOwn(tasks,page())||["setup","statistics"].includes(page())?"":rangeControl(page()));
const panelHead = (title,actions="")=>'<div class="panelhead"><h2>'+title+'</h2><div class="buttons">'+actions+'</div></div>';
const th = labels => labels.map(x=>'<th'+(x.startsWith('!')?' class="money"':'')+'>'+x.replace(/^!/,"")+'</th>').join("");
const tag = status => '<span class="tag '+(["취소","반품"].includes(status)?"alert":status==="신규"?"wait":"")+'">'+esc(status)+'</span>';
const card = (title,value,caption) => '<div class="card"><small>'+title+'</small><strong class="amount">'+value+'</strong><p class="muted">'+caption+'</p></div>';
const money = n => '<td class="money">'+won(n)+'</td>';
function notify(message) {
  $("toast").textContent=message;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$("toast").textContent="",4500);
}
async function load(target = business) {
  if(demo){
    store=demoStores[target];
    names=Object.fromEntries(Object.entries(demoStores).map(([slot,data])=>[slot,data.businessName]));
  }else{
    const response=await fetch("/api/state?business="+target,{cache:"no-store"});
    if(!response.ok) throw Error("저장소 접속에 실패했습니다 ("+response.status+").");
    const payload=await response.json();
    store=payload.data;
    rev=payload.rev;
    names=payload.names;
  }
  if(target!==business){marketConnections={};marketLoaded=false;marketError="";}
  business=target;
  ready=true;
  $("connection").textContent=demo?"샘플 모드":"온라인 저장";
  render();
}
async function marketCall(data, target=business){
  const response=await fetch("/api/markets?business="+target,data?{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)
  }:{cache:"no-store"});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||"판매처 연결 정보를 불러오지 못했습니다.");
  return result;
}
async function loadMarkets(){
  if(demo||marketLoading||marketLoaded)return;
  marketLoading=true;
  const target=business;
  try{
    const {connections}=await marketCall(null,target);
    if(target===business&&!demo){
      marketConnections=Object.fromEntries(connections.map(connection=>[connection.market,connection]));
      marketLoaded=true;
      marketError="";
    }
  }catch(error){
    if(target===business&&!demo){marketError=error.message;marketLoaded=true;}
  }finally{
    marketLoading=false;
    if(["setup","collect"].includes(page())&&ready&&!demo)render();
  }
}
async function runMarket(market,action,button){
  if(!marketLoaded||demo||busy||switching)return;
  const target=business;
  busy=true;
  renderBusiness();
  button.disabled=true;
  const idle=button.textContent;
  button.textContent=action==="test"?"연결 확인 중…":"주문 조회 중…";
  try{
    const {added,updated,skipped}=await marketCall({market,action,date:day()},target);
    if(action==="test"){
      notify(marketNames[market]+" 주문 API 연결을 확인했습니다.");
      return;
    }
    await load(target);
    marketLoaded=false;
    await loadMarkets();
    notify("신규 "+added+"건 · 갱신 "+updated+"건"+(skipped?" · 확인 필요 "+skipped+"건":""));
  }finally{busy=false;button.disabled=false;button.textContent=idle;renderBusiness();}
}
async function changeBusiness(target) {
  if(target===business||!Object.hasOwn(defaultNames,target))return;
  if(busy||switching){
    renderBusiness();
    notify("진행 중인 작업이 끝난 뒤 사업자를 선택해 주세요.");
    return;
  }
  switching=true;
  renderBusiness();
  try{
    await load(target);
    filter={q:"",channel:"",status:""};

    if(!demo)try{sessionStorage.setItem("market-business",target);}catch{}
  }catch(error){notify(error.message);}
  finally{switching=false;render();}
}
async function commit(next, deletion, login, sendNewInvoices = false) {
  if(busy||switching) throw Error("진행 중인 작업이 끝난 뒤 다시 저장해 주세요.");
  const previousOrders=sendNewInvoices ? new Map(store.orders.map(order=>[order.id,order])) : null;
  const invoices=previousOrders ? next.orders.filter(order=>{
    if(!canSendInvoice(order))return false;
    const previous=previousOrders.get(order.id);
    return !canSendInvoice(previous)||previous.tracking!==order.tracking||previous.carrier!==order.carrier;
  }) : [];
  busy=true;
  renderBusiness();
  try {
    if(demo){
      demoStores[business]=next;
    }else{
      const response=await fetch("/api/state?business="+business,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({rev,data:next,deletion,login})});
      if(response.status===409){await load();throw Error("다른 기기에서 내용이 바뀌었습니다. 새로 불러온 목록을 확인한 뒤 다시 저장해 주세요.");}
      if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||"저장에 실패했습니다.");}
      rev=(await response.json()).rev;
    }
    store=next;
    if(next.businessName)names[business]=next.businessName;
    render();
    if(invoices.length)return await sendRegisteredInvoices(invoices);
  } finally {busy=false;renderBusiness();}
}
async function sendRegisteredInvoices(invoices) {
  let sent=0;
  const failures=[];
  for(const invoice of invoices){
    const current=store.orders.find(order=>order.id===invoice.id);
    if(!canSendInvoice(current)||current.tracking!==invoice.tracking||current.carrier!==invoice.carrier){
      failures.push("주문 정보가 변경되었습니다.");
      continue;
    }
    try{
      await marketCall({market:"naver",action:"dispatch",id:current.id,rev});
      sent++;
    }catch(error){
      failures.push(error.message);
    }
    try{await load();}
    catch{
      return "송장번호 저장 완료 · 네이버 "+sent+"건 전송 · 목록을 새로고침해 전송 상태를 확인해 주세요.";
    }
  }
  return "송장번호 저장 완료 · 네이버 "+sent+"건 전송"+
    (failures.length ? " · "+failures.length+"건 미확인: "+failures[0]+" 송장번호 전송 화면에서 상태를 확인해 주세요." : "");
}
function canSendInvoice(o) {
  return !demo&&o?.market==="naver"&&o.line&&o.carrier&&o.tracking&&["신규","포장중"].includes(o.status);
}
function orderTable(rows, shipping=false) {
  const view=page();
  const selecting=["export","shippingWork","deduct","restore"].includes(view);
  const labels=shipping?["주문번호","판매처","상품","상태","택배사·송장번호","작업"]:["주문일·주문번호","판매처","상품·SKU","!수량","!판매금액","상태","작업"];
  if(view==="notes")labels.splice(3,0,"배송메모");
  if(selecting)labels.unshift("선택");
  const hidden=view==="results"&&store.collectionColumns?
    labels.flatMap((label,i)=>collectionColumns.includes(label)&&!store.collectionColumns.includes(label)?[i+1]:[]):[];
  return '<div class="table-wrap"><table class="order-grid">'+(hidden.length?'<colgroup>'+labels.map((_,i)=>'<col'+(hidden.includes(i+1)?' class="hidden-column"':'')+'>').join("")+'</colgroup>':'')+'<thead><tr>'+th(labels)+'</tr></thead><tbody>'+
  (rows.map(o=>'<tr>'+(selecting?'<td>'+(view==="shippingWork"&&o.market==="naver"?"—":'<input type="checkbox" name="workflow-order" value="'+esc(o.id)+'" aria-label="'+esc(o.number)+' 선택"'+'>')+'</td>':"")+'<td><b>'+esc(o.number)+'</b><span class="sub">'+esc(o.date)+(o.line?' · '+esc(o.line):'')+'</span></td><td>'+esc(o.channel)+(o.market?'<span class="sub">API 수집</span>':'')+'</td><td>'+esc(o.name)+'<span class="sub">'+esc(o.sku||(o.market?(o.marketSku?o.marketSku+" · SKU 미연결":"SKU 미연결"):""))+(costsReady(o)?"":" · 비용 확인 필요")+'</span></td>'+
    (view==="notes"?'<td>'+esc(o.deliveryMemo)+'</td>':"")+
    (shipping?'<td>'+tag(o.status)+'</td><td>'+esc(o.carrier||"미등록")+'<span class="sub">'+esc(o.tracking)+'</span></td>':'<td class="money">'+fmt.format(o.qty)+'</td>'+money(info(o).gross)+'<td>'+tag(o.status)+'</td>')+
    '<td><button class="short" data-action="order" data-id="'+esc(o.id)+'">'+(shipping?"송장·상태":"상세·수정")+'</button>'+((view==="dispatch"&&canSendInvoice(o))?' <button class="short primary" data-action="send-invoice" data-id="'+esc(o.id)+'">송장 전송</button>':'')+(view==="matching"&&store.products.length?' <button class="short primary" data-action="match-order" data-id="'+esc(o.id)+'">SKU 연결</button>':"")+'</td></tr>').join("")||'<tr><td class="empty" colspan="'+labels.length+'">표시할 주문이 없습니다.</td></tr>')+'</tbody></table></div>';
}
let productRankingMetric="gross";
function productSalesRanking(orders) {
  const namesBySku=new Map(store.products.map(product=>[product.sku,product.name]));
  const products=new Map();
  for(const order of orders){
    const key=JSON.stringify(order.sku?["sku",order.sku]:["name",order.name]);
    if(!products.has(key)){
      products.set(key,{name:namesBySku.get(order.sku)||order.name,sku:order.sku||"",qty:0,gross:0});
    }
    const product=products.get(key);
    product.qty+=order.qty;
    product.gross+=info(order).gross;
  }
  const metric=productRankingMetric;
  const secondary=metric==="gross"?"qty":"gross";
  const rows=[...products.values()].sort((a,b)=>
    b[metric]-a[metric]||b[secondary]-a[secondary]||a.name.localeCompare(b.name,"ko")||a.sku.localeCompare(b.sku)
  ).slice(0,10);
  if(!rows.length)return '<p class="empty">선택한 기간에 판매 내역이 없습니다.</p>';
  const peak=Math.max(1,rows[0][metric]);
  return '<ol class="chart product-ranking">'+rows.map((product,index)=>{
    const value=metric==="gross"?won(product.gross):fmt.format(product.qty)+"개";
    return '<li><div class="product-ranking-label"><b>'+(index+1)+'위 · '+esc(product.name)+'</b>'+
      (product.sku?'<span class="sub">'+esc(product.sku)+'</span>':'')+
      '</div><div class="bar" aria-hidden="true"><span style="width:'+Math.max(0,product[metric]/peak*100)+'%"></span></div>'+
      '<b class="product-ranking-value">'+value+'</b></li>';
  }).join("")+'</ol>';
}
function dashboard() {
  const period=periodOrders("home");
  const current=period.filter(o=>!["취소","반품"].includes(o.status));
  const totals=current.reduce((a,o)=>{const i=info(o);return [a[0]+i.gross,a[1]+(costsReady(o)?i.profit:0)];},[0,0]);
  const pending=current.filter(o=>!costsReady(o)).length;
  const sales=[...new Set([...businessChannels(),...current.map(o=>o.channel)])].map(c=>[c,current.filter(o=>o.channel===c).reduce((t,o)=>t+info(o).gross,0)]);
  const peak=Math.max(1,...sales.map(x=>x[1]));
  const counts=Object.fromEntries(states.map(s=>[s,period.filter(o=>o.status===s).length]));
  return head("주문 운영 대시보드","판매처별 주문, 출고 현황과 판매 손익을 확인합니다.",btn(bfile+" CSV·엑셀 가져오기","import")+btn(bplus+" 주문 등록","order",true))+
  '<div class="cards">'+card("기간 판매금액",won(totals[0]),"취소·반품 제외")+card("기간 판매이익",pending&&pending===current.length?"—":won(totals[1]),pending?"비용 확인 전 "+pending+"건 제외":"원가·수수료·배송비 등 차감")+card("발송 대기",fmt.format(counts.신규+counts.포장중)+"건","신규 + 포장중")+card("현재 재고 부족",store.products.filter(p=>p.units-stockUsed(store,p.sku)<=p.limit).length+"개","안전재고 이하 상품")+'</div>'+
  '<section class="panel">'+panelHead("기간 제품별 판매 랭킹",
    '<select id="product-ranking-metric" aria-label="제품별 랭킹 기준">'+
    options([["gross","판매금액"],["qty","판매수량"]],productRankingMetric)+'</select>')+
  '<div id="product-ranking-chart" aria-live="polite">'+productSalesRanking(current)+'</div></section>'+
  '<div class="cols"><section class="panel">'+panelHead("기간 채널별 판매금액")+'<div class="chart">'+sales.map(([c,n])=>'<div class="bar-row"><span>'+esc(c)+'</span><div class="bar"><span style="width:'+(n/peak*100)+'%"></span></div><b>'+won(n)+'</b></div>').join("")+'</div></section>'+
  '<section class="panel">'+panelHead("기간 처리 현황")+'<div class="workflow">'+["신규","포장중","발송완료","반품"].map(s=>'<a href="#orders" data-action="jump" data-status="'+s+'">'+s+'<b>'+counts[s]+'건</b></a>').join("")+'</div></section></div>'+
  '<section class="panel">'+panelHead("최근 주문",'<a class="button short" href="#orders" data-action="jump" data-status="">전체 보기</a>')+orderTable(sorted(period).slice(0,5))+'</section>';
}
function filtered() {
  const query=filter.q.toLowerCase().trim();
  const view=page();
  return sorted(periodOrders(view)).filter(o=>(view!=="dispatch"||hasActiveInvoice(o))&&(view!=="export"||queues.waitingPrint[1](o))&&(!filter.channel||o.channel===filter.channel)&&(!filter.status||o.status===filter.status)&&[o.number,o.line,o.sku,o.name,o.tracking].some(v=>v.toLowerCase().includes(query)));
}
function hasActiveInvoice(order) {
  return !!order.tracking&&!["취소","반품"].includes(order.status);
}
const printRuleFields={name:"상품명",deliveryMemo:"배송메모"};
function printText(value,field) {
  let text=String(value??"");
  for(const rule of store.printRules??[]){
    if(rule.field!==field)continue;
    const parts=text.split(rule.find);
    if(text.length+(parts.length-1)*(rule.replacement.length-rule.find.length)>2000){
      throw Error("변환한 "+printRuleFields[field]+"이 2,000자를 넘습니다. 바꾸기 규칙을 확인해 주세요.");
    }
    text=parts.join(rule.replacement);
  }
  return text;
}
function printRulesPanel(){
  const rules=store.printRules??[];
  const rows=rules.map((rule,index)=>{
    const data=' data-index="'+index+'"';
    return '<tr><td>'+(index+1)+'</td><td>'+esc(printRuleFields[rule.field])+'</td><td>'+esc(rule.find)+'</td><td>'+(rule.replacement?esc(rule.replacement):"삭제")+'</td><td>'+
      '<button class="short" data-action="print-rule-edit"'+data+'>수정</button> '+
      '<button class="short" data-action="print-rule-up"'+data+(index===0?' disabled':'')+'>위로</button> '+
      '<button class="short" data-action="print-rule-delete"'+data+'>삭제</button></td></tr>';
  }).join("");
  return '<section class="panel">'+panelHead("인쇄파일 규칙",btn("규칙 추가","print-rule-add",true))+
    '<div class="table-wrap"><table><thead><tr>'+th(["순서","적용 항목","찾을 내용","바꿀 내용","작업"])+'</tr></thead><tbody>'+
    (rows||'<tr><td class="empty" colspan="5">저장된 규칙이 없습니다.</td></tr>')+'</tbody></table></div></section>'+
    '<section class="panel">'+panelHead("적용 미리보기")+'<div class="filters">'+
    select("적용 항목","previewField",Object.entries(printRuleFields),"name")+
    '<input id="print-preview-value" maxlength="2000" aria-label="원본 텍스트" placeholder="원본 텍스트를 입력하세요"></div>'+
    '<div class="filters"><output id="print-preview-result" aria-live="polite">변경 후 텍스트가 여기에 표시됩니다.</output></div></section>';
}
function openPrintRule(index) {
  const rules=store.printRules??[];
  const original=rules[index];
  if(!original&&rules.length>=50){notify("규칙은 최대 50개까지 등록할 수 있습니다.");return;}
  formDialog(original?"인쇄파일 규칙 수정":"인쇄파일 규칙 추가",
    select("적용 항목","field",Object.entries(printRuleFields),original?.field||"name")+
    field("찾을 내용","find",original?.find,false,0,true)+field("바꿀 내용 (비워서 삭제)","replacement",original?.replacement),
    async rule=>{
      if(!rule.find.trim())throw Error("찾을 내용을 입력해 주세요.");
      const next=[...rules];
      if(original)next[index]=rule;
      else next.push(rule);
      await commit({...store,printRules:next});
    });
}
function movePrintRuleUp(index) {
  const rules=[...(store.printRules??[])];
  if(index<1||index>=rules.length)return;
  [rules[index-1],rules[index]]=[rules[index],rules[index-1]];
  return commit({...store,printRules:rules});
}
function removePrintRule(index) {
  const rules=store.printRules??[];
  if(!rules[index])return;
  formDialog("인쇄파일 규칙 삭제",'<p class="wide">이 규칙을 삭제할까요?</p>',async ()=>{
    await commit({...store,printRules:rules.filter((_,i)=>i!==index)});
  },"규칙 삭제","규칙을 삭제했습니다.");
}
function invoiceSummary() {
  const groups=new Map();
  for(const order of periodOrders("dispatch").filter(hasActiveInvoice)){
    if(!groups.has(order.channel))groups.set(order.channel,{orders:0,ready:0,invoices:new Set()});
    const group=groups.get(order.channel);
    group.orders++;
    group.ready+=Number(Boolean(canSendInvoice(order)));
    group.invoices.add(JSON.stringify([order.carrier,order.tracking]));
  }
  const rows=[...groups].map(([channel,group])=>{
    const attrs=' data-channel="'+esc(channel)+'"';
    return '<tr><td><button class="short" data-action="invoice-channel"'+attrs+'>'+esc(channel)+'</button></td><td class="money">'+fmt.format(group.orders)+'</td><td class="money">'+fmt.format(group.invoices.size)+'</td><td class="money">'+fmt.format(group.ready)+'</td><td><button class="short" data-action="invoice-channel-csv"'+attrs+'>CSV 다운로드</button> <button class="short" data-action="invoice-channel-csv-xlsx-file"'+attrs+'>엑셀 다운로드</button></td></tr>';
  });
  return '<section class="panel">'+panelHead("판매처별 송장 현황")+'<div class="table-wrap"><table><thead><tr>'+th(["판매처","!주문상품","!등록 송장","!API 전송 가능","작업"])+'</tr></thead><tbody>'+
    (rows.join("")||'<tr><td class="empty" colspan="5">등록된 송장이 없습니다.</td></tr>')+'</tbody></table></div></section>';
}
function orders(shipping) {
  const exporting=page()==="export", dispatching=page()==="dispatch";
  return head(exporting||dispatching?tasks[page()][0]:shipping?"전체송장 목록":"통합 주문",exporting?"인쇄대기 주문을 선택해 CSV 또는 엑셀로 내려받습니다.":dispatching?"네이버 API 주문은 송장 등록 시 자동 전송됩니다. 다른 판매처는 송장 파일을 내려받아 판매자센터에서 처리하세요.":shipping?"택배사·송장번호를 등록하고 출고 상태를 관리합니다.":"여러 판매처의 주문을 등록하고 처리 상태를 관리합니다.",
  exporting?officeLink("printFolder","폴더 설정")+formatButtons("상품집계표","export-pick-list")+formatButtons("선택 인쇄파일","export-orders"):shipping?formatButtons("송장 내보내기","tracking"):'<a class="button" href="#collect">API 주문 가져오기</a>'+formatButtons("주문 양식","template")+btn(bfile+" CSV·엑셀 가져오기","import")+btn(bplus+" 주문 등록","order",true))+
  (exporting?'<div id="print-folder" class="panel" aria-live="polite"></div>':"")+
  (dispatching?invoiceSummary():"")+
  '<section class="panel">'+panelHead(exporting?"인쇄 대상":dispatching?"송장 목록":shipping?"배송 목록":"주문 목록",exporting?selectionActions():"")+
  '<div class="filters"><input id="query" type="search" placeholder="주문번호, 상품명, SKU, 송장번호 검색" aria-label="주문 검색" value="'+esc(filter.q)+'"><select id="channel" aria-label="판매처">'+options([["","전체 판매처"],...new Set([...businessChannels(),...store.orders.map(o=>o.channel)])],filter.channel)+'</select><select id="status" aria-label="상태">'+options([["","전체 상태"],...states],filter.status)+'</select></div><div id="result">'+orderTable(filtered(),shipping)+'</div></section>';
}
function stock() {
  const selected={orders:periodOrders("stock")};
  const rows=store.products.map(p=>{
    const used=stockUsed(store,p.sku), left=p.units-used;
    return '<tr><td><b>'+esc(p.name)+'</b><span class="sub">'+esc(p.sku)+'</span></td>'+money(p.cost)+'<td class="money">'+fmt.format(p.units)+'</td><td class="money">'+fmt.format(stockUsed(selected,p.sku))+'</td><td class="money">'+(left<=p.limit?tag(String(left)):fmt.format(left))+'</td><td class="money">'+p.limit+'</td><td><button class="short" data-action="product" data-id="'+esc(p.sku)+'">수정</button></td></tr>';
  }).join("");
  return pageHeading("상품·재고","판매 SKU별 단위원가와 출고 가능 수량을 관리합니다.",btn("상품별 원가 구성","show-product-costs")+officeLink("costSheet","원물·레시피 원가")+btn("엑셀 양식 다운로드","product-template")+btn("상품 엑셀 업로드","product-import")+btn(bplus+" 상품 등록","product",true))+
  '<div id="product-costs" tabindex="-1">'+standardCostPanel()+'</div>'+rangeControl("stock")+
  '<div class="note">상품 SKU가 연결된 API 주문은 결제 완료부터 판매 가능 재고에 반영합니다. 직접 등록한 주문은 포장중·발송완료 상태부터 차감합니다. 입고나 조정은 누적 입고 기준수량에 기록하세요.</div>'+
  '<section class="panel">'+panelHead("상품 목록")+'<div class="table-wrap"><table><thead><tr>'+th(["상품명·SKU","!단위원가","!누적 입고 기준수량","!기간 출고 반영","!현재 판매 가능","!안전재고","작업"])+'</tr></thead><tbody>'+(rows||'<tr><td colspan="7" class="empty">상품을 등록하면 신규 주문에 단위원가를 불러옵니다.</td></tr>')+'</tbody></table></div></section>'+
  productCostBreakdown(selected.orders);
}

const orderExpenseFields=[["shipping","택배비"],["pack","포장비"],["fee","판매수수료"],["discount","판매자 부담 할인"]];
const standardSellingCosts={shipping:1909,pack:300,supplies:300,feePermille:116};
function estimateProductProfit(unitCost,price,taxStatus){
  const vat=taxStatus==="면세"?0:taxStatus==="과세"&&price!==null?Math.round(price/10):null;
  if(price===null||vat===null)return {vat:vat===null?"—":won(vat),total:"—",profit:"—",lowProfit:false};
  const {shipping,pack,supplies,feePermille}=standardSellingCosts;
  const total=unitCost+shipping+pack+supplies+Math.round(price*feePermille/1000)+vat;
  const profit=price-total;
  return {vat:won(vat),total:won(total),profit:won(profit),lowProfit:profit<=1000};
}
function standardTaxBySku(){
  const sheet=store.costSheet;
  if(!sheet)return new Map();
  const materials=new Map(sheet.materials.map(item=>[item.name,item.tax]));
  const recipes=new Map(sheet.recipes.map(recipe=>{
    const flags=new Set(recipe.offers.filter(offer=>offer.sale>0).map(offer=>offer.vat>0));
    return [recipe.name,flags.size===1?(flags.has(true)?"과세":"면세"):null];
  }));
  const catalog=costSheetModel(sheet).products;
  return new Map(store.products.map(product=>{
    const statuses=new Set(catalogProductMatches(product,catalog).map(row=>
      (row.material?materials.get(row.material):recipes.get(row.recipe))??null));
    return [product.sku,statuses.size===1?[...statuses][0]:null];
  }));
}
function standardCostPanel(){
  const {shipping,pack,supplies,feePermille}=standardSellingCosts;
  const taxBySku=standardTaxBySku();
  const rows=store.products.map(product=>{
    const price=product.estimatedSalePrice??null;
    const taxStatus=product.estimatedTaxStatus===undefined?taxBySku.get(product.sku)??null:product.estimatedTaxStatus;
    const {vat,total,profit,lowProfit}=estimateProductProfit(product.cost,price,taxStatus);
    const input='<input type="number" min="0" max="1000000000" step="1" inputmode="numeric" name="estimate-price" '+
      'data-sku="'+esc(product.sku)+'" data-unit-cost="'+product.cost+'" value="'+(price??"")+
      '" aria-label="'+esc(product.name+' ('+product.sku+') 판매가')+'">';
    const tax='<select name="estimate-tax" data-sku="'+esc(product.sku)+'" data-initial="'+esc(taxStatus??"")+
      '" aria-label="'+esc(product.name+' ('+product.sku+') 과세 여부')+'">'+options([["","미설정"],"과세","면세"],taxStatus??"")+'</select>';
    return [esc(product.name),esc(product.sku),won(product.cost),won(shipping),won(pack),won(supplies),input,feePermille/10+"%",tax,
      '<span data-estimate-vat>'+vat+'</span>',
      '<span data-estimate-total>'+total+'</span>','<output data-estimate-profit class="amount-estimate'+(lowProfit?' danger':'')+'">'+profit+'</output>'];
  });
  return '<form id="standard-cost-form">'+officePanel("상품별 기준 원가",
    '<p class="totals">상품 1개를 1건으로 발송하는 예상치입니다. 판매수수료는 판매가의 11.6%, 부가세는 과세 상품에 한해 판매가의 10%를 차감합니다. 과세 여부가 미설정이면 순익 계산에 앞서 선택해 주세요.</p>'+
    officeTable(["상품명","SKU","등록 단위원가","기준 택배비","기준 포장비","기준 부자재비","판매가 (원)","기준 수수료율","과세 여부","부가세","예상 총비용","예상 순익"],rows),
    rows.length?'<button type="submit" class="primary">기준값 저장</button>':"")+'</form>';
}
async function saveStandardCostInputs(form){
  const prices=new Map([...form.querySelectorAll('[name="estimate-price"]')].map(input=>[
    input.dataset.sku,input.value===""?null:input.valueAsNumber
  ]));
  const taxes=new Map([...form.querySelectorAll('[name="estimate-tax"]')].filter(input=>input.value!==input.dataset.initial)
    .map(input=>[input.dataset.sku,input.value||null]));
  if([...prices.values()].some(price=>price!==null&&(!Number.isInteger(price)||price<0||price>1e9))){
    throw Error("판매가는 0~1,000,000,000원 사이의 정수로 입력해 주세요.");
  }
  const products=store.products.map(product=>{
    const {sku}=product;
    const priceChanged=prices.has(sku)&&prices.get(sku)!==(product.estimatedSalePrice??null);
    return priceChanged||taxes.has(sku)?{...product,
      ...(priceChanged?{estimatedSalePrice:prices.get(sku)}:{}),
      ...(taxes.has(sku)?{estimatedTaxStatus:taxes.get(sku)}:{})}:product;
  });
  if(products.some((product,i)=>product!==store.products[i]))await commit({...store,products});
  notify("기준 판매가와 과세 여부를 저장했습니다.");
}
function productCostBreakdown(orders){
  const catalog=store.costSheet?costSheetModel(store.costSheet).products:new Map();
  const expenses=new Map();
  for(const order of orders){
    if(!order.sku||["취소","반품"].includes(order.status)||!costsReady(order))continue;
    const totals=expenses.get(order.sku)||{qty:0,cogs:0,shipping:0,pack:0,fee:0,discount:0};
    totals.qty+=order.qty;
    totals.cogs+=info(order).cogs;
    for(const [key] of orderExpenseFields)totals[key]+=order[key];
    expenses.set(order.sku,totals);
  }
  const rows=store.products.map(product=>{
    const rawCost=catalogProductCost(product,catalog);
    const stats=expenses.get(product.sku);
    const perUnit=value=>stats?.qty?won(Math.round(value/stats.qty)):"—";
    const total=stats?orderExpenseFields.reduce((sum,[key])=>sum+stats[key],stats.cogs):0;
    return [esc(product.name),esc(product.sku),rawCost===null?"—":won(rawCost),won(product.cost),
      perUnit(stats?.cogs),...orderExpenseFields.map(([key])=>perUnit(stats?.[key])),perUnit(total)];
  });
  return officePanel("상품별 원가 구성 · 주문 실적",
    '<p class="totals">원물비는 현재 원가시트 기준입니다. 주문 비용은 조회 기간 내 비용 확인 주문의 판매 1개당 평균이며, 취소·반품은 제외합니다. 자료가 없는 항목은 —로 표시합니다.</p>'+
    officeTable(["상품명","SKU","원물비","등록 단위원가","주문 상품원가",...orderExpenseFields.map(([,label])=>label),"주문 총비용"],rows));
}

function profit() {
  const active=periodOrders("profit").filter(o=>!["취소","반품"].includes(o.status));
  const groups=new Map();
  for(const o of active){
    const id=JSON.stringify([o.channel,o.sku||o.name]);
    const item=groups.get(id)||{name:o.name,sku:o.sku,channel:o.channel,gross:0,cogs:0,profit:0,qty:0,shipping:0,pack:0,fee:0,discount:0,reviewedGross:0,pending:0,reviewed:0};
    const result=info(o);
    item.qty+=o.qty;item.gross+=result.gross;
    if(costsReady(o)){
      item.cogs+=result.cogs;item.profit+=result.profit;
      for(const [key] of orderExpenseFields)item[key]+=o[key];
      item.reviewedGross+=result.gross;item.reviewed++;
    }else item.pending++;
    groups.set(id,item);
  }
  const rows=[...groups.values()].sort((a,b)=>b.gross-a.gross);
  const totals=rows.reduce((s,x)=>({gross:s.gross+x.gross,cogs:s.cogs+x.cogs,profit:s.profit+x.profit,reviewedGross:s.reviewedGross+x.reviewedGross,pending:s.pending+x.pending,reviewed:s.reviewed+x.reviewed}),{gross:0,cogs:0,profit:0,reviewedGross:0,pending:0,reviewed:0});
  const pct=(part,total)=>total?(100*part/total).toFixed(1)+"%":"—";
  const pendingValue=(n,x)=>x.pending&&!x.reviewed?"—":won(n);
  const pendingCell=(n,x)=>'<td class="money">'+pendingValue(n,x)+'</td>';
  return head("판매 손익","제품·판매처별 원가율과 판매이익을 비교합니다.")+
  '<div class="cards">'+card("판매금액",won(totals.gross),"취소·반품 제외")+card("상품 원가",pendingValue(totals.cogs,totals),"확인된 주문 기준")+card("판매이익",pendingValue(totals.profit,totals),totals.pending?"비용 확인 전 "+totals.pending+"건 제외":"직접비 차감 후")+card("이익률",pct(totals.profit,totals.reviewedGross),"비용 확인 주문의 판매금액 기준")+'</div>'+
  '<div class="note">판매이익 = 판매금액 − 상품원가 − 판매수수료 − 배송비 − 포장비 − 판매자 부담 할인. 취소·반품 주문은 제외하며, 금액은 입력값 기준입니다.</div>'+
  '<section class="panel">'+panelHead("상품별·채널별 손익")+'<div class="table-wrap"><table><thead><tr>'+th(["판매처","상품","!수량","!판매금액","!상품원가","!원가율",...orderExpenseFields.map(([,label])=>"!"+label),"!판매이익","!이익률"])+'</tr></thead><tbody>'+
  (rows.map(x=>'<tr><td>'+esc(x.channel)+'</td><td><b>'+esc(x.name)+'</b><span class="sub">'+esc(x.sku)+(x.pending?" · 비용 확인 전 "+x.pending+"건":"")+'</span></td><td class="money">'+x.qty+'</td>'+money(x.gross)+pendingCell(x.cogs,x)+'<td class="money">'+pct(x.cogs,x.reviewedGross)+'</td>'+orderExpenseFields.map(([key])=>pendingCell(x[key],x)).join("")+pendingCell(x.profit,x)+'<td class="money">'+pct(x.profit,x.reviewedGross)+'</td></tr>').join("")||'<tr><td colspan="12" class="empty">선택한 기간에 집계할 주문이 없습니다.</td></tr>')+'</tbody></table></div></section>';
}
function businessChannels(){
  return [...channels,...(store.customChannels||[])].filter(name=>!store.deletedChannels?.includes(name));
}
function addChannel(){
  const form=formDialog("판매처 추가",field("판매처 이름","name","",false,0,true),async values=>{
    const name=values.name.trim();
    if(!name||name.length>40)throw Error("판매처 이름은 1~40자로 입력해 주세요.");
    if(businessChannels().some(c=>c.toLowerCase()===name.toLowerCase()))throw Error("이미 등록된 판매처입니다.");
    const archived=(store.deletedChannels||[]).find(c=>c.toLowerCase()===name.toLowerCase());
    if(archived)await commit({...store,deletedChannels:store.deletedChannels.filter(c=>c!==archived)});
    else await commit({...store,customChannels:[...(store.customChannels||[]),name]});
  });
  form.elements.name.maxLength=40;
}
function openSellerLogin(channel){
  if(!businessChannels().includes(channel))return;
  if(demo){notify("실제 사업자 화면에서 로그인 정보를 등록해 주세요.");return;}
  const saved=store.loginChannels?.includes(channel);
  const form=formDialog(esc(channel)+" 로그인 정보 "+(saved?"수정":"등록"),
    '<label class="wide">판매자센터 아이디<input name="username" maxlength="200" autocomplete="off" required></label>'+
    '<label class="wide">판매자센터 비밀번호<input type="password" name="password" maxlength="512" autocomplete="new-password" required></label>'+
    (saved?'<p class="muted wide">저장할 아이디와 비밀번호를 함께 입력해 주세요.</p>':''),
    async ({username,password})=>{
      const loginChannels=[...new Set([...(store.loginChannels||[]),channel])];
      await commit({...store,loginChannels},undefined,{channel,username,password});
    },"저장","판매처 로그인 정보를 저장했습니다.");
  $("dialog").addEventListener("close",()=>form.reset(),{once:true});
  form.elements.username.focus();
}
function deleteChannel(name){
  if(!businessChannels().includes(name))return;
  const form=formDialog("판매처 삭제",'<p class="wide">'+esc(names[business])+'에서 <strong>'+esc(name)+'</strong> 판매처와 등록된 로그인 정보, API 키를 삭제합니다. 기존 주문과 손익 기록은 유지됩니다.</p><label>삭제 비밀번호<input type="password" name="pin" inputmode="numeric" maxlength="4" required autocomplete="off"></label>',async ({pin})=>{
    if(demo && pin!=="0000")throw Error("삭제 비밀번호가 일치하지 않습니다.");
    await commit({...store,loginChannels:(store.loginChannels||[]).filter(c=>c!==name),deletedChannels:[...(store.deletedChannels||[]),name]}, {name,pin});
    marketLoaded=false;
    if(!demo)await loadMarkets();
  },"삭제","판매처를 삭제했습니다.");
  form.elements.pin.focus();
}
function settings() {
  const added=store.customChannels||[];
  const listed=[...added].reverse().concat(channels).filter(name=>businessChannels().includes(name));
  return head("판매처 설정",esc(names[business])+"의 API 키와 판매처를 관리합니다.",btn(bplus+" 판매처 추가","add-channel",true))+
  '<section class="panel"><div class="settings"><h2>판매처 목록 <small class="muted">'+listed.length+'곳</small></h2><ul class="channel-list">'+
  listed.map(name=>'<li><div class="channel-name"><strong>'+esc(name)+'</strong><small class="muted">'+(added.includes(name)?"직접 추가":"기본")+'</small></div><div class="buttons"><button type="button" class="short" data-action="seller-login" data-channel="'+esc(name)+'">'+(store.loginChannels?.includes(name)?"로그인 정보 수정":"로그인 정보 등록")+'</button><button type="button" class="short" data-action="delete-channel" data-channel="'+esc(name)+'" aria-label="'+esc(name)+' 판매처 삭제">삭제</button></div></li>').join("")+'</ul></div></section>'+
  marketSettings()+
  '<section class="panel"><div class="settings"><h2>사업자 관리</h2><p class="muted">상단에서 사업자를 선택하면 해당 사업자의 주문·배송·재고·손익이 표시됩니다.</p><div class="business-list">'+
  Object.entries(names).map(([slot,name])=>'<div class="business-row"><div><small class="muted">사업자 '+slot+'</small><strong>'+esc(name)+'</strong></div>'+
    (slot===business?btn("이름 수정","business-name"):'<button type="button" data-action="business-switch" data-business="'+slot+'">이 사업자로 전환</button>')+'</div>').join("")+
  '</div></div></section>'+
  '<section class="panel"><div class="settings"><h2>CSV·엑셀 주문 가져오기</h2><p class="muted">올웨이즈는 공개 주문 API 규격 확인 전까지 CSV·엑셀로 가져옵니다.</p><div class="buttons">'+formatButtons("주문 양식","template")+btn("CSV·엑셀 가져오기","import",true)+'</div></div></section>'+
  '<section class="panel"><div class="settings"><h2>샘플 주문 체험</h2><p class="muted">샘플 주문과 재고로 화면을 확인할 수 있습니다. 체험 중 변경한 데이터는 브라우저를 새로 열면 사라집니다.</p><div>'+btn(demo?"실제 데이터로 돌아가기":"샘플 화면 보기","demo")+'</div></div></section>';
}
function marketSettings(){
  const title='<h2>오픈마켓 API · '+esc(names[business])+'</h2>';
  const wrap=content=>'<section class="panel"><div class="settings">'+title+content+'</div></section>';
  if(demo)return wrap('<p class="muted">샘플 모드를 종료하면 실제 API 설정을 사용할 수 있습니다.</p>');
  if(!marketLoaded)return wrap('<p class="muted">판매처 설정을 확인하는 중입니다.</p>');
  if(marketError)return wrap('<p class="muted">'+esc(marketError)+'</p><div>'+btn("다시 시도","market-retry")+'</div>');
  return wrap('<p class="muted">판매자 API 키를 저장한 뒤 연결을 확인하세요. 주문 가져오기는 한국시간 기준 오늘 자료를 조회합니다.</p>'+

    '<p class="muted">쿠팡은 발주서, 네이버는 변경 주문, 11번가는 결제완료·배송준비 주문, 옥션·지마켓은 주문일 기준 일반 주문을 조회합니다. 취소·반품은 별도로 확인하세요.</p><div class="market-grid">'+
      Object.entries(marketNames).filter(([id])=>businessChannels().includes(({coupang:"쿠팡",naver:"네이버",eleven:"11번가",auction:"옥션",gmarket:"지마켓"})[id])).map(([market,name])=>{
        const connection=marketConnections[market];
        const last=connection?.last_sync?new Date(connection.last_sync).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"";
        const docs=market==="eleven"?"https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall":["auction","gmarket"].includes(market)?"https://etapi.gmarket.com/67":market==="coupang"?"https://developers.coupang.com/ko/api/shipments/po-list-query-paging-by-day":"https://apicenter.commerce.naver.com/docs/auth";
        const controls=connection?'<button type="button" data-action="market-test" data-market="'+market+'">연결 확인</button><button type="button" class="primary" data-action="market-sync" data-market="'+market+'">주문 가져오기</button>':"";
        return '<article class="market-card"><h3>'+name+'</h3><p class="muted">'+
          (connection?"API 키 저장됨":"API 키 등록 필요")+(last?" · 마지막 수집 "+esc(last):"")+'</p>'+
          '<a class="market-doc" href="'+docs+'" target="_blank" rel="noopener">공식 API 안내</a>'+
          '<div class="buttons"><button type="button" data-action="market-key" data-market="'+market+'">'+(connection?"API 키 변경":"API 키 등록")+'</button>'+controls+'</div></article>';
      }).join("")+'</div><p class="muted">판매처에 등록한 허용 IP와 API를 호출하는 서버의 외부 IP가 일치해야 합니다. 쿠팡 반품 완료는 발주서 조회에 포함되지 않아 주문 상태를 직접 확인해 주세요.</p>');
}
const collectionResults=new Map();
const collectionSelections=new Map();
const channelProvider={"쿠팡":"coupang","네이버":"naver","11번가":"eleven","옥션":"auction","지마켓":"gmarket"};
const collectionKey=(slot,channel)=>JSON.stringify([slot,channel]);
const collectionProvider=channel=>Object.hasOwn(channelProvider,channel)?channelProvider[channel]:null;
const collectionLinked=market=>!!(market&&marketConnections[market]&&!demo);
const selectedCollectionChannels=()=>[...$("content").querySelectorAll('[name="collect-market"]:checked')].map(input=>input.value);
function collectionSummary(){
  const rows=businessChannels().map(channel=>{
    const result=collectionResults.get(collectionKey(business,channel));
    return result?'<tr><td>'+esc(channel)+'</td><td>'+esc(result)+'</td></tr>':"";
  }).join("");
  return '<section class="panel">'+panelHead("이번 세션 수집 결과")+'<div class="table-wrap"><table><thead><tr>'+th(["판매처","결과"])+'</tr></thead><tbody>'+(rows||'<tr><td colspan="2" class="empty">이 세션에서 실행한 자동수집이 없습니다.</td></tr>')+'</tbody></table></div></section>';
}
function collectionPage(){
  const selected=collectionSelections.get(business);
  const rows=businessChannels().map(name=>{
    const market=collectionProvider(name),linked=collectionLinked(market);
    const checked=(selected?.has(name)??linked)?" checked":"";
    return '<tr><td><input type="checkbox" aria-label="'+esc(name)+' 수집 선택" name="collect-market" value="'+esc(name)+'"'+checked+
      '></td><td><b>'+esc(name)+'</b></td><td>'+(linked?"API 연결":market?"API 키 필요":"파일 수집")+'</td><td>'+btn("파일 열기","import")+'</td><td>'+
      (linked?'<button data-action="collect-one" data-channel="'+esc(name)+'">자동수집</button>':'—')+
      '</td><td>'+esc(collectionResults.get(collectionKey(business,name))||"—")+'</td></tr>';
  }).join("");
  return head("주문수집","선택한 판매처의 한국시간 기준 오늘 주문을 가져옵니다.",'<a class="button" href="#setup">판매처 관리</a>')+'<section class="panel">'+panelHead("판매처별 수집",btn("모두 선택","collect-all")+btn("모두 해제","collect-none")+btn("선택 자동수집","collect-selected",true))+(marketError?'<div class="note">'+esc(marketError)+' '+btn("다시 시도","market-retry")+'</div>':'')+'<div class="table-wrap"><table><thead><tr>'+th(["선택","판매처","연결 상태","수동 입력","자동 수집","수집 결과"])+'</tr></thead><tbody>'+rows+'</tbody></table></div></section>';
}
async function collectSelected(channels){
  if(!channels.length){notify("수집할 판매처를 선택해 주세요.");return;}
  const target=business;
  const connected=[];
  for(const channel of channels){
    const market=collectionProvider(channel);
    if(collectionLinked(market))connected.push([channel,market]);
    else collectionResults.set(collectionKey(target,channel),market?"API 연결 필요 · 판매처 관리에서 설정":"파일 열기로 주문 가져오기");
  }
  if(!connected.length){
    render();
    notify("자동수집 가능한 판매처가 없습니다. 판매처별 수집 결과를 확인해 주세요.");
    return;
  }
  busy=true;renderBusiness();
  const date=day();
  try{
    for(const [channel,market] of connected){
      const key=collectionKey(target,channel);
      collectionResults.set(key,"수집 중…");render();
      try{const r=await marketCall({market,action:"sync",date},target);collectionResults.set(key,"신규 "+r.added+" · 갱신 "+r.updated+" · 확인 필요 "+(r.skipped||0));}
      catch(error){collectionResults.set(key,error.message);}
    }
    await load(target);
  }finally{busy=false;render();}
}
function invoiceImportPage(){return head(tasks.invoices[0],"판매처·주문번호·주문상품번호로 주문을 찾아 택배사와 송장번호를 등록합니다.",formatButtons("송장 양식","invoice-template")+btn("송장 CSV·엑셀 가져오기","import-invoices",true))+'<section class="panel">'+panelHead("등록된 송장")+orderTable(periodOrders("invoices").filter(o=>o.tracking),true)+'</section>';}
async function importInvoices(file){
  const source=store;
  const [header,...rows]=await readTable(file);
  if(store!==source||switching)throw Error("사업자가 변경되었습니다. 파일을 다시 선택해 주세요.");
  const columns=["판매처","주문번호","주문상품번호","택배사","송장번호"].map(h=>header?.findIndex(value=>value.trim()===h)??-1);
  if(columns.some(i=>i<0)||!rows.length)throw Error("판매처, 주문번호, 주문상품번호, 택배사, 송장번호 열과 데이터가 필요합니다.");
  const byKey=new Map(store.orders.map(o=>[key(o),o])),changes=new Map();
  for(const [index,row] of rows.entries()){
    const [channel,number,line,carrier,tracking]=columns.map(i=>(row[i]||"").trim());
    const order=byKey.get(key({channel,number,line}));
    if(!order||!tracking||!carrier||tracking.length>120||carrier.length>120||["취소","반품"].includes(order.status)||changes.has(order.id)||(order.tracking&&order.tracking!==tracking))throw Error((index+2)+"행의 주문, 중복 또는 기존 송장번호를 확인해 주세요.");
    changes.set(order.id,{...order,tracking,carrier});
  }
  const result=await commit({...store,orders:store.orders.map(o=>changes.get(o.id)||o)},undefined,undefined,true);
  notify(result||changes.size+"건의 송장번호를 가져왔습니다.");
}
const purchasePaymentStatuses={unpaid:"미결제",partial:"일부 결제",paid:"결제 완료"};
const purchaseTypes={bulk:"벌크 원물",special:"특이 제품"};
const purchaseSupply=row=>Math.round(Math.round(row.qty*1000)*row.price/1000);
function purchases(){
  const {start,end}=dateRange("purchases");
  const rows=sorted((store.purchases||[]).filter(row=>(!start||row.date>=start)&&(!end||row.date<=end)));
  const supply=rows.reduce((sum,row)=>sum+purchaseSupply(row),0);
  const vat=rows.reduce((sum,row)=>sum+(row.vat??0),0);
  const body=rows.map(row=>{
    const amount=purchaseSupply(row), total=amount+(row.vat??0);
    const paid=row.paidAmount??(row.paymentStatus==="paid"?total:row.paymentStatus==="unpaid"?0:null);
    return '<tr><td>'+esc(row.date)+'</td><td>'+esc(row.supplier)+'</td><td>'+esc(purchaseTypes[row.type]||"미분류")+'</td>'+
      '<td><b>'+esc(row.name)+'</b></td><td class="money">'+fmt.format(row.qty)+' '+esc(row.unit)+'</td>'+
      '<td class="money">'+(row.totalWeightKg==null?"—":fmt.format(row.totalWeightKg)+" kg")+'</td>'+
      '<td class="money">'+(row.packsPerBox==null?"—":fmt.format(row.packsPerBox)+"개")+'</td>'+
      money(row.price)+money(amount)+(row.vat==null?'<td class="money">—</td>':money(row.vat))+
      money(total)+'<td>'+esc(purchasePaymentStatuses[row.paymentStatus]||"미확인")+'</td>'+
      (paid===null?'<td class="money">—</td><td class="money">—</td>':money(paid)+money(total-paid))+
      '<td>'+esc(row.paymentDueDate||"—")+'</td><td>'+esc(row.memo)+'</td><td><button class="short" data-action="purchase-entry" data-id="'+esc(row.id)+'">수정·원본</button></td></tr>';
  }).join("");
  return head("사입관리","벌크 원물과 특이 제품의 매입 내역을 관리합니다.",officeLink("bulkMaterials","벌크 원물 목록")+btn(bplus+" 사입 등록","purchase-entry",true))+
    '<section class="panel">'+panelHead("매입 내역 · "+rows.length+"건",
      '<strong>공급가액 '+won(supply)+' · 부가세 '+won(vat)+' · 합계 '+won(supply+vat)+'</strong>')+
    '<div class="table-wrap"><table><thead><tr>'+th(["매입일","매입처","구분","품목","!수량","!총 중량","!박스당 포장 수","!공급 단가","!공급가액","!부가세","!합계","결제 여부","!누적 결제액","!남은 잔액","결제 예정일","메모","작업"])+'</tr></thead><tbody>'+
    (body||'<tr><td class="empty" colspan="17">선택한 기간에 매입 내역이 없습니다.</td></tr>')+'</tbody></table></div></section>';
}
let statementDraft=null,statementOperation=null,statementScanner={frame:null,ready:false};
const statementUnitsList=["kg","봉","개","박스"];
function statementEmpty(){return {date:day(),supplier:"",rows:[],status:"",text:""};}
function statementRowHtml(row,index){
  const products=store.products||[];
  const attrs='data-statement-row="'+index+'" data-statement-field=';
  return '<tr><td><input type="checkbox" '+attrs+'"use"'+(row.use?' checked':'')+' aria-label="재고에 반영"></td>'+
    '<td><input '+attrs+'"name" list="statement-materials" value="'+esc(row.name)+'" maxlength="120" aria-label="품목명"></td>'+
    '<td><select '+attrs+'"target" aria-label="반영 대상">'+
      '<option value="">반영 안 함</option><option value="m"'+(row.target==="m"?' selected':'')+'>벌크 원물 재고 (kg)</option>'+
      '<optgroup label="상품 재고">'+products.map(p=>'<option value="p:'+esc(p.sku)+'"'+(row.target==="p:"+p.sku?' selected':'')+'>'+esc(p.name+" ("+p.sku+")")+'</option>').join("")+'</optgroup></select></td>'+
    '<td><input type="number" min="0" step="any" '+attrs+'"qty" value="'+esc(row.qty)+'" aria-label="수량"></td>'+
    '<td><select '+attrs+'"unit" aria-label="단위">'+options(statementUnitsList,row.unit)+'</select></td>'+
    '<td><input type="number" min="0" step="any" '+attrs+'"specKg" value="'+esc(row.specKg)+'" aria-label="박스당 kg"></td>'+
    '<td><input type="number" min="0" step="1" '+attrs+'"price" value="'+esc(row.price)+'" aria-label="공급 단가"></td>'+
    '<td><input type="number" min="0" step="1" '+attrs+'"vat" value="'+esc(row.vat)+'" aria-label="부가세"></td></tr>';
}
function purchaseStatement(){
  const draft=statementDraft??=statementEmpty();
  const history=(store.purchases||[]).filter(row=>row.sku||row.statement).sort((a,b)=>b.date.localeCompare(a.date));
  const names=new Map((store.products||[]).map(p=>[p.sku,p.name]));
  const rows=draft.rows;
  const summary=rows.filter(r=>r.use&&r.target).length;
  return officeHeading("매입관리",officeLink("purchases","사입 목록")+officeLink("stock","상품·재고 확인"))+
    '<section class="panel">'+panelHead("1. 거래명세서 올리기")+'<div class="settings">'+
    '<label>PDF·JPG 거래명세서<input type="file" id="statement-file" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"></label>'+
    '<div class="buttons"><button type="button" class="short" id="statement-cancel" data-action="statement-cancel" hidden>읽기 중지</button></div>'+
    '<p class="muted" id="statement-status" role="status">'+esc(draft.status||"앞 5쪽까지 읽어 품목, 수량, 단가를 표로 만듭니다. 스캔 이미지는 글자 인식으로 읽어 시간이 걸릴 수 있습니다.")+'</p>'+
    '<details'+(draft.text&&!rows.length?' open':'')+'><summary>'+(draft.text?'문서에서 읽은 내용 (품목이 잘못 잡히면 여기서 고쳐 다시 분석)':'문서가 읽히지 않으면 내용을 붙여넣어 분석')+'</summary>'+
    '<textarea id="statement-text" rows="6" style="width:100%;margin:8px 0" placeholder="품목 수량 단가 공급가액 순서의 줄을 붙여넣어 주세요.">'+esc(draft.text)+'</textarea>'+
    btn("붙여넣은 내용 분석","statement-parse")+'</details></div></section>'+
    '<section class="panel">'+panelHead("2. 읽은 내용 확인 · "+rows.length+"개 품목",
      rows.length?btn("초기화","statement-reset"):"")+
    '<form id="statement-form" class="fields">'+
    '<label>매입일<input type="date" id="statement-date" value="'+esc(draft.date)+'"></label>'+
    '<label>매입처<input id="statement-supplier" list="office-suppliers" value="'+esc(draft.supplier)+'" maxlength="120"><datalist id="office-suppliers">'+
      officeRows("suppliers").map(item=>'<option value="'+esc(item.name)+'"></option>').join("")+'</datalist></label></form>'+
    '<datalist id="statement-materials">'+activeBulkMaterials().map(item=>'<option value="'+esc(item.name)+'"></option>').join("")+'</datalist><div class="table-wrap"><table class="statement-table"><thead><tr>'+th(["반영","품목명","반영 대상","!수량","단위","!박스당 kg","!공급 단가","!부가세"])+'</tr></thead><tbody>'+
    (rows.length?rows.map(statementRowHtml).join(""):'<tr><td class="empty" colspan="8">거래명세서를 올리면 품목이 여기에 표시됩니다.</td></tr>')+'</tbody></table></div>'+
    '<div class="settings"><p class="muted">상품에 연결한 품목은 “누적 입고 기준수량”에 수량이 더해지고, 벌크 원물은 박스 수 × 박스당 kg 만큼 원물 재고가 늘어납니다. 두 경우 모두 사입 목록에 기록됩니다. 값을 확인한 뒤 반영하세요.</p>'+
    '<div class="form-error" id="statement-error" role="alert"></div>'+
    '<div><button type="button" class="primary" data-action="statement-apply"'+(summary?'':' disabled')+'>재고에 반영 ('+summary+'건)</button></div></div></section>'+
    '<section class="panel">'+panelHead("재고 반영 내역 · "+history.length+"건")+
    officeTable(["매입일","매입처","품목","반영 대상","!반영 수량","!공급가액"],history.map(row=>[
      esc(row.date),esc(row.supplier),esc(row.name),esc(row.sku?(names.get(row.sku)||row.sku):"벌크 원물 "+(row.totalWeightKg!=null?fmt.format(row.totalWeightKg)+"kg":"")),
      fmt.format(row.qty)+" "+esc(row.unit),won(purchaseSupply(row))]))+'</section>';
}
function statementApplyRows(draft){
  const picked=draft.rows.filter(row=>row.use&&row.target);
  if(!picked.length)throw Error("재고에 반영할 품목을 선택해 주세요.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.date))throw Error("매입일을 입력해 주세요.");
  if(!draft.supplier.trim())throw Error("매입처를 입력해 주세요.");
  const skuTotals=new Map();
  const records=picked.map(row=>{
    const name=row.name.trim(),qty=Number(row.qty),price=Number(row.price),vat=row.vat===""||row.vat==null?0:Number(row.vat);
    if(!name)throw Error("품목명을 입력해 주세요.");
    if(!Number.isFinite(qty)||qty<=0)throw Error(name+": 수량을 확인해 주세요.");
    if(!Number.isSafeInteger(price)||price<0||!Number.isSafeInteger(vat)||vat<0)throw Error(name+": 단가와 부가세는 0 이상의 정수로 입력해 주세요.");
    const base={id:crypto.randomUUID(),date:draft.date,supplier:draft.supplier.trim(),name,memo:"거래명세서 재고 반영",statement:true,price,vat,paymentStatus:"unpaid"};
    if(row.target==="m"){
      const specKg=Number(row.specKg);
      if(!Number.isInteger(qty))throw Error(name+": 박스 수는 정수여야 합니다.");
      if(!(specKg>0))throw Error(name+": 박스당 kg을 입력해 주세요.");
      const totalWeightKg=Math.round(specKg*qty*1000)/1000;
      if(totalWeightKg<0.001||totalWeightKg>1000000)throw Error(name+": 총 중량을 확인해 주세요.");
      return {...base,type:"bulk",unit:"박스",qty,totalWeightKg,packsPerBox:1};
    }
    const sku=row.target.slice(2);
    if(!Number.isInteger(qty))throw Error(name+": 상품 재고는 정수 수량으로 반영됩니다. 수량을 정수로 고쳐 주세요.");
    skuTotals.set(sku,(skuTotals.get(sku)||0)+qty);
    return {...base,type:"special",unit:row.unit,qty,sku};
  });
  return {records,skuTotals};
}
async function applyStatement(){
  const draft=statementDraft;
  const {records,skuTotals}=statementApplyRows(draft);
  const products=store.products.map(p=>skuTotals.has(p.sku)?{...p,units:p.units+skuTotals.get(p.sku)}:p);
  await commit({...store,products,purchases:[...records,...(store.purchases||[])]});
  const count=records.length;
  statementDraft=statementEmpty();
  render();
  notify("거래명세서 "+count+"개 품목을 재고에 반영했습니다.");
}
function fillStatement(text,statusText){
  const draft=statementDraft??=statementEmpty();
  const parsed=parseStatement(text);
  if(parsed.date)draft.date=parsed.date;
  if(parsed.supplier)draft.supplier=parsed.supplier;
  const materials=activeBulkMaterials().map(item=>({sku:item.name,name:item.name}));
  draft.rows=parsed.items.map(item=>{
    const sku=matchStatementProduct(item.name,store.products||[]);
    const material=item.specKg?matchStatementProduct(item.name,materials):"";
    const target=sku?"p:"+sku:item.specKg?"m":"";
    // 같은 이름의 원물이 이미 있으면 그 이름으로 맞춰 재고가 합산되게 합니다.
    const name=!sku&&material?material:item.name;
    const price=Math.round(item.supply/item.qty);
    // 합계가 명세서와 정확히 맞도록 부가세는 합계에서 공급가액을 뺀 값으로 둡니다.
    return {name,qty:item.qty,unit:item.unit,specKg:item.specKg??"",price,vat:item.total-Math.round(price*item.qty),target,use:Boolean(target)};
  });
  const unmatched=draft.rows.filter(r=>!r.target).length;
  const check=parsed.totalMatches===false?" 명세서 합계 "+won(parsed.totals.total)+"와 품목 합계 "+won(parsed.items.reduce((t,i)=>t+i.total,0))+"가 다릅니다. 빠진 품목이 없는지 확인해 주세요.":parsed.totalMatches?" 명세서 합계와 일치합니다.":"";
  draft.status=statusText+" · "+(parsed.items.length?parsed.items.length+"개 품목을 찾았습니다."+(unmatched?" 반영 대상을 정하지 못한 "+unmatched+"개는 직접 선택해 주세요.":"")+check:"품목 줄을 찾지 못했습니다. 아래에 문서에서 읽은 내용을 표시했습니다. 이 내용을 알려주시면 양식에 맞게 인식 규칙을 추가할 수 있습니다.");
  render();
}
async function readStatementFile(file){
  const error=purchaseDocumentError(file);
  const status=$("statement-status");
  if(error){status.textContent=error;return;}
  statementOperation?.abort();
  const controller=new AbortController();
  statementOperation=controller;
  $("statement-cancel").hidden=false;
  status.textContent=file.name+" 읽는 중입니다…";
  try{
    const {text,pagesRead,totalPages}=await scanPurchaseFile(statementScanner,file,/\.pdf$/i.test(file.name)?5:1,controller.signal,
      message=>{if(!controller.signal.aborted&&$("statement-status"))$("statement-status").textContent=message;});
    if(controller.signal.aborted)return;
    (statementDraft??=statementEmpty()).text=text.trim();
    fillStatement(text,file.name+(totalPages>pagesRead?" · "+totalPages+"쪽 중 앞 "+pagesRead+"쪽":""));
  }catch(error){
    if(!controller.signal.aborted&&$("statement-status"))$("statement-status").textContent=error.message;
  }finally{
    if(statementOperation===controller){statementOperation=null;if($("statement-cancel"))$("statement-cancel").hidden=true;}
  }
}

function openPurchase(id){
  const rows=store.purchases||[];
  const row=rows.find(record=>record.id===id)||{id:crypto.randomUUID(),date:day(),supplier:"",name:"",qty:"",price:"",unit:"kg",memo:""};
  let originalFile;
  const target=business;
  const documentUrl="/api/purchase-document?"+new URLSearchParams({business:target,purchase:row.id});
  const form=formDialog(id?"사입 내역 수정":"사입 등록",
    (id?'<div class="wide purchase-attachment-status" role="status">클라우드 원본 확인 중…</div>'+
      '<label class="wide">PDF·JPG 원본 첨부<input type="file" name="attachmentFile" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"></label>':
      select("PDF 읽을 범위","documentPages",[["1","첫 페이지"],["5","앞 5페이지"]],"1")+
      '<label class="wide">PDF·JPG에서 읽기<input type="file" name="documentFile" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"></label>'+
      '<button class="purchase-scan-cancel" type="button" hidden>읽기 중지</button>'+
      '<p class="wide muted purchase-scan-status" role="status">선택한 원본은 사입 내역을 저장할 때 클라우드에 보관합니다.</p>'+
      '<label class="wide purchase-scan-excerpt" hidden>문서에서 읽은 내용<textarea class="purchase-scan-text" readonly rows="5"></textarea></label>')+
    '<label>매입일<input type="date" name="date" value="'+esc(row.date)+'" required></label>'+
    '<label>매입처<input name="supplier" list="office-suppliers" value="'+esc(row.supplier)+'" maxlength="120" required><datalist id="office-suppliers">'+
    officeRows("suppliers").map(item=>'<option value="'+esc(item.name)+'"></option>').join("")+'</datalist></label>'+
    '<label>품목명<input name="name" list="cost-materials" maxlength="120" value="'+esc(row.name)+'" required><datalist id="cost-materials">'+
    activeBulkMaterials().map(item=>'<option value="'+esc(item.name)+'"></option>').join("")+'</datalist></label>'+
    select("사입 구분","type",[["",id?"미분류":"구분 선택"],...Object.entries(purchaseTypes)],row.type||"")+
    select("단위","unit",["kg","봉","개","박스"],row.unit)+
    '<label><span class="purchase-quantity-label">수량</span><input type="number" name="qty" min="0.001" max="1000000" step="0.001" value="'+esc(row.qty)+'" required></label>'+
    '<label class="purchase-detail">총 중량 (kg)<input type="number" name="totalWeightKg" min="0.001" max="1000000" step="0.001" value="'+esc(row.totalWeightKg??"")+'"></label>'+
    field("박스당 포장 수 (개)","packsPerBox",row.packsPerBox??"",true,1)+
    field("공급 단가 (원, 부가세 제외)","price",row.price,true,0,true)+
    field("부가세 (원, 품목 전체)","vat",row.vat??"",true,0)+
    select("결제 여부","paymentStatus",[["","미확인"],...Object.entries(purchasePaymentStatuses)],row.paymentStatus||(id?"":"unpaid"))+
    '<label>누적 결제액 (원)<input type="number" name="paidAmount" min="0" step="1" value="'+esc(row.paidAmount??"")+
    '" aria-describedby="purchase-paid-help"><small id="purchase-paid-help">입력하면 부가세 포함 합계에서 잔액과 결제 상태를 계산합니다.</small></label>'+
    '<label>결제 예정일<input type="date" name="paymentDueDate" value="'+esc(row.paymentDueDate??"")+'"></label>'+
    field("메모","memo",row.memo),async values=>{
      const {documentFile,documentPages,attachmentFile,type,vat,totalWeightKg,packsPerBox,paymentStatus,paymentDueDate,paidAmount,...fields}=values;
      const record={...fields,unit:type==="bulk"?"박스":fields.unit,id:row.id,supplier:values.supplier.trim(),name:values.name.trim(),memo:values.memo.trim(),qty:Number(values.qty),price:Number(values.price)};
      if(type)record.type=type;
      if(paidAmount===""){
        if(paymentStatus==="partial")throw Error("일부 결제 건은 누적 결제액을 입력해 주세요.");
        if(paymentStatus)record.paymentStatus=paymentStatus;
      }else{
        const paid=Number(paidAmount), total=purchaseSupply(record)+(type?Number(vat):0);
        if(!Number.isSafeInteger(paid)||paid<0||paid>total)throw Error("누적 결제액은 0원부터 부가세 포함 합계까지 입력할 수 있습니다.");
        record.paidAmount=paid;
        record.paymentStatus=paid===total?"paid":paid===0?"unpaid":"partial";
      }
      if(paymentDueDate)record.paymentDueDate=paymentDueDate;
      if(type==="bulk"){
        record.totalWeightKg=Number(totalWeightKg);
        record.packsPerBox=Number(packsPerBox);
      }
      if(type){
        if(vat==="")throw Error("부가세 금액을 입력해 주세요. 해당 금액이 없으면 0을 입력하세요.");
        record.vat=Number(vat);
      }
      if(!record.supplier||!record.name)throw Error("매입처와 품목명을 입력해 주세요.");
      if(record.unit!=="kg"&&!Number.isInteger(record.qty))throw Error("봉·개·박스 수량은 정수로 입력해 주세요.");
      const file=attachmentFile?.name?attachmentFile:originalFile;
      if(file){const error=purchaseDocumentError(file);if(error)throw Error(error);}
      if(business!==target)throw Error("사업자가 변경되었습니다. 사입 내역을 다시 열어 주세요.");
      await commit({...store,purchases:[record,...(store.purchases||[]).filter(x=>x.id!==row.id)]});
      if(!file)return;
      if(demo)return "샘플 사입을 저장했습니다.";
      try{await uploadPurchaseDocument(documentUrl,file);}
      catch(error){throw Error("사입 내역은 저장됐습니다. 원본 저장 실패 · "+error.message);}
      return "사입 내역과 원본을 클라우드에 저장했습니다.";
    });
  const {type,unit,qty,vat,totalWeightKg,packsPerBox}=form.elements;
  type.required=!id;
  function updatePurchaseType(){
    const bulk=type.value==="bulk", classified=Boolean(type.value);
    if(bulk)unit.value="박스";
    unit.disabled=bulk;
    qty.step=bulk?"1":"0.001";
    qty.min=bulk?"1":"0.001";
    form.querySelector(".purchase-quantity-label").textContent=bulk?"박스 수":"수량";
    for(const [input,enabled] of [[totalWeightKg,bulk],[packsPerBox,bulk],[vat,classified]]){
      input.disabled=!enabled;
      input.required=enabled;
      const label=input.closest("label");
      label.classList.add("purchase-detail");
      label.hidden=!enabled;
    }
  }
  type.addEventListener("change",updatePurchaseType);
  updatePurchaseType();
  if(id)void showPurchaseAttachment(form,documentUrl);
  else bindPurchaseScan(form,file=>{originalFile=file;});
}
async function showPurchaseAttachment(form,url){
  const status=form.querySelector(".purchase-attachment-status");
  const input=form.elements.attachmentFile;
  if(demo){status.textContent="샘플 화면";input.disabled=true;return;}
  input.disabled=true;
  try{
    const response=await fetch(url,{method:"HEAD",cache:"no-store"});
    if(response.ok){
      status.innerHTML='<a class="button" href="'+esc(url)+'" download>클라우드 원본 다운로드</a>';
      input.closest("label").hidden=true;
      return;
    }
    status.textContent=response.status===404?"첨부된 클라우드 원본이 없습니다.":"원본 저장소 상태를 확인해 주세요.";
  }catch{status.textContent="원본 저장소에 연결하지 못했습니다.";}
  input.disabled=false;
}
async function uploadPurchaseDocument(url,file){
  const filename=Array.from(file.name).slice(-120).join("");
  const encoded=encodeURIComponent(filename).replace(/['()*]/g,ch=>"%"+ch.charCodeAt(0).toString(16));
  const response=await fetch(url,{method:"PUT",body:file,headers:{
    "Content-Type":/\.pdf$/i.test(filename)?"application/pdf":"image/jpeg",
    "X-Document-Filename":encoded,
    "X-Document-Size":String(file.size)
  }});
  if(!response.ok){
    const result=await response.json().catch(()=>({}));
    throw Error(result.error||"연결 상태를 확인한 뒤 다시 시도해 주세요.");
  }
}
function purchaseFields(text) {
  const lines=text.normalize("NFKC").split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const lookup=pattern=>{
    for(const line of lines){
      const match=line.match(pattern);
      if(match?.[1])return match[1].trim();
    }
    return "";
  };
  const datePattern=/((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/;
  const match=(lookup(/(?:매입일|거래일(?:자)?|작성일(?:자)?|발행일(?:자)?)\s*[:：]?\s*(.+)/)||lines.join(" ")).match(datePattern);
  const date=match?match.slice(1).map(value=>value.padStart(2,"0")).join("-"):"";
  const validDate=date&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  const supplier=lookup(/(?:매입처|공급자\s*상호|판매처|공급처|상호(?:명)?)\s*[:：]?\s*(\S.*)/);
  const item=lookup(/^\s*(?:품목명|상품명|품\s*목|품\s*명)\s*[:：]?\s*(\S.*)/);
  const quantity=lookup(/^\s*수\s*량\s*[:：]?\s*([\d,.]+\s*(?:kg|봉|개|박스)?)/i);
  const price=lookup(/^\s*단\s*가\s*(?:\(원\))?\s*[:：]?\s*([\d,]+)/);
  const table=lines.filter(line=>!/(?:합계|총액|공급가액|세액|수량|단가)/.test(line))
    .map(line=>line.match(/^(.*?\S)\s+(\d[\d,]*(?:\.\d+)?)\s*(kg|봉|개|박스)\s+([\d,]+)(?:\s*원)?(?:\s+[\d,]+(?:\s*원)?)?$/i))
    .filter(Boolean);
  const row=table.length===1?table[0]:null;
  const count=(quantity||row?.[2]||"").match(/^([\d,.]+)\s*(kg|봉|개|박스)?/i);
  return {
    date:validDate?date:"",
    supplier:supplier.slice(0,120),
    name:(item||row?.[1]||"").slice(0,120),
    qty:count?.[1].replaceAll(",","")||"",
    unit:(count?.[2]||row?.[3]||"").toLowerCase(),
    price:(price||row?.[4]||"").replaceAll(",",""),
    totalWeightKg:lookup(/^총\s*중량\s*[:：]?\s*([\d,.]+)\s*kg/i).replaceAll(",",""),
    packsPerBox:lookup(/^박스\s*당\s*(?:포장\s*수|패킹\s*수)\s*[:：]?\s*([\d,]+)/).replaceAll(",",""),
    vat:lookup(/^부가(?:가치)?세\s*(?:\(원\))?\s*[:：]?\s*([\d,]+)/).replaceAll(",",""),
  };
}
function purchaseDocumentError(file){
  if(!/\.(pdf|jpe?g)$/i.test(file.name))return "PDF 또는 JPG 파일을 선택해 주세요.";
  const maxMb=/\.pdf$/i.test(file.name)?50:15;
  if(file.size===0||file.size>maxMb*1_000_000)return "비어 있지 않은 "+maxMb+"MB 이하의 파일을 선택해 주세요.";
  return "";
}
function scanPurchaseFile(scanner,file,pageLimit,signal,onProgress) {
  return new Promise((resolve,reject)=>{
    const frame=scanner.frame||document.createElement("iframe");
    const channel=new MessageChannel();
    let started=false;
    const send=()=>{
      started=true;
      scanner.ready=true;
      frame.contentWindow.postMessage({file,pageLimit},"*",[channel.port2]);
    };
    const start=event=>{
      if(started||event.source!==frame.contentWindow||event.data!=="purchase-scan-ready")return;
      send();
    };
    const finish=(error,result)=>{
      clearTimeout(timer);
      signal.removeEventListener("abort",abort);
      window.removeEventListener("message",start);
      channel.port1.close();
      if(!started)channel.port2.close();
      if(error){
        frame.remove();
        scanner.frame=null;
        scanner.ready=false;
      }
      if(error)reject(error);
      else resolve(result);
    };
    const abort=()=>finish(new DOMException("문서 읽기가 취소되었습니다.","AbortError"));
    const timer=setTimeout(()=>finish(Error(started?"문서 읽기 시간이 초과됐습니다. 사입 내역을 직접 입력할 수 있습니다."
      :"문서 읽기 도구가 응답하지 않습니다. 사입 내역을 직접 입력할 수 있습니다.")),pageLimit===5?90000:45000);
    signal.addEventListener("abort",abort,{once:true});
    channel.port1.onmessage=({data})=>{
      if(data.status){onProgress(data.status);return;}
      finish(data.error?Error(data.error):null,data);
    };
    if(scanner.ready)send();
    else{
      window.addEventListener("message",start);
      frame.hidden=true;
      frame.setAttribute("sandbox","allow-scripts");
      frame.src="/purchase-scan.html";
      scanner.frame=frame;
      document.body.append(frame);
    }
  });
}
function bindPurchaseScan(form, setOriginal) {
  const input=form.elements.documentFile;
  const status=form.querySelector(".purchase-scan-status");
  const excerpt=form.querySelector(".purchase-scan-text");
  const submit=form.querySelector('[type="submit"]');
  const cancel=form.querySelector(".purchase-scan-cancel");
  const scanner={frame:null,ready:false};
  let operation;
  const dialog=$("dialog");
  dialog.addEventListener("close",()=>{
    operation?.abort();
    scanner.frame?.remove();
  },{once:true});
  cancel.addEventListener("click",()=>{
    operation?.abort();
    status.textContent="문서 읽기를 중지했습니다. 사입 내역을 직접 입력할 수 있습니다.";
  });
  input.addEventListener("change",async ()=>{
    const file=input.files[0];
    input.value="";
    if(!file)return;
    operation?.abort();
    const error=purchaseDocumentError(file);
    setOriginal(error?null:file);
    if(error){status.textContent=error;return;}
    const controller=new AbortController();
    operation=controller;
    submit.disabled=true;
    cancel.hidden=false;
    excerpt.parentElement.hidden=true;
    status.textContent=file.name+" 읽는 중입니다…";
    const original=new FormData(form);
    try {
      const pageLimit=/\.pdf$/i.test(file.name)?Number(form.elements.documentPages.value):1;
      const {text,pagesRead,totalPages}=await scanPurchaseFile(scanner,file,pageLimit,controller.signal,
        message=>{if(!controller.signal.aborted)status.textContent=message;});
      if(controller.signal.aborted||!form.isConnected||!dialog.open)return;
      let filled=0;
      const values=purchaseFields(text);
      for(const [field,value] of Object.entries(values)){
        const control=form.elements[field];
        if(!value||control.disabled||control.value!==original.get(field))continue;
        if(form.elements.type.value==="bulk"&&values.unit&&values.unit!=="박스"&&["qty","price"].includes(field))continue;
        const previous=control.value;
        control.value=value;
        if(!control.value||!control.validity.valid)control.value=previous;
        else filled++;
      }
      excerpt.value=text.trim();
      excerpt.parentElement.hidden=!excerpt.value;
      const scope=totalPages>pagesRead?" · "+totalPages+"쪽 중 앞 "+pagesRead+"쪽":"";
      status.textContent=file.name+scope+" · "+(filled?"읽은 항목 "+filled+"개를 입력했습니다. 값이 맞는지 확인하고 저장해 주세요."
        :"자동 입력할 항목을 찾지 못했습니다. 읽은 내용이 있으면 참고해 직접 입력해 주세요.");
    } catch(error) {
      if(!controller.signal.aborted)status.textContent=error.message;
    } finally {
      if(operation===controller){operation=null;submit.disabled=false;cancel.hidden=true;}
    }
  });
}
const statsFilters=new Map();
function shiftDate(iso,days,months=0){
  const d=new Date(iso+"T00:00:00Z");
  if(months){
    const n=d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth()+months+1,0);
    d.setUTCDate(Math.min(n,d.getUTCDate()));
  }
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function statsPeriod(preset){
  const end=day();
  if(preset==="어제"){const start=shiftDate(end,-1);return {start,end:start};}
  const start=preset==="1주"?shiftDate(end,-6):preset==="1개월"?shiftDate(end,0,-1):preset==="3개월"?shiftDate(end,0,-3):end;
  return {start,end};
}
function statsFilter(){
  const id=(demo?"demo":"live")+business;
  if(!statsFilters.has(id))statsFilters.set(id,{...statsPeriod("1개월"),preset:"1개월",channels:null,basis:"date",sent:false});
  return statsFilters.get(id);
}
const statsColumns=["일자","요일","송장수","주문수","총판매수량","총판매금액","실판매수량","실판매금액","정산예정금액","배송비결제금액","교환수량","교환금액","취소수량","취소금액","반품수량","반품금액"];
function dailySales(orders,f){
  const daily=new Map();
  let missingDate=0;
  for(const o of orders){
    if(f.channels&&!f.channels.includes(o.channel))continue;
    if(f.sent&&!(o.shipDate||o.status==="발송완료"))continue;
    const date=o[f.basis];
    if(!date){if(o.status==="발송완료"||o.status==="반품")missingDate++;continue;}
    if(date<f.start||date>f.end)continue;
    if(!daily.has(date))daily.set(date,{orders:new Set(),invoices:new Set(),values:Array(12).fill(0)});
    const group=daily.get(date),v=group.values,gross=info(o).gross;
    group.orders.add(JSON.stringify([o.channel,o.number]));
    if(o.tracking)group.invoices.add(JSON.stringify([o.carrier,o.tracking]));
    v[0]+=o.qty;v[1]+=gross;
    if(o.status==="취소"){v[8]+=o.qty;v[9]+=gross;}
    else if(o.status==="반품"){v[10]+=o.qty;v[11]+=gross;}
    else {
      v[2]+=o.qty;v[3]+=gross;
      for(const [index,field] of [[4,"settlement"],[5,"shippingPaid"]]){
        if(o[field]==null)v[index]=null;else if(v[index]!==null)v[index]+=o[field];
      }
    }
    if(o.exchanged){v[6]+=o.qty;v[7]+=gross;}
  }
  const rows=[...daily].sort(([a],[b])=>a.localeCompare(b)).map(([date,g])=>[date,"일월화수목금토"[new Date(date+"T00:00:00Z").getUTCDay()],g.invoices.size,g.orders.size,...g.values]);
  return {rows,missingDate};
}
function statistics(){
  const f=statsFilter(),{rows,missingDate}=dailySales(store.orders,f);
  const channels=[...new Set([...businessChannels(),...store.orders.map(o=>o.channel)])];
  const check=(yes)=>yes?" checked":"";
  const radios=(name,choices,value)=>choices.map(([id,label])=>'<label><input type="radio" name="'+name+'" value="'+id+'"'+check(value===id)+'>'+label+'</label>').join("");
  const peak=Math.max(1,...rows.map(r=>r[5]));
  const heading=statsColumns.map((title,i)=>'<th scope="col">'+(i===0?(f.basis==="date"?"주문일자":"발송일자"):title)+'</th>'+(i===5?'<th scope="col">판매금액 그래프</th>':'')).join("");
  const body=rows.map(r=>'<tr>'+r.map((v,i)=>'<td class="'+(i<2?'':'money')+'">'+(i<2?esc(v):v==null?'—':fmt.format(v))+'</td>'+(i===5?'<td><div class="bar"><span style="width:'+100*v/peak+'%"></span></div></td>':'')).join("")+'</tr>').join("");
  return head("통계관리","선택한 사업자의 일자별 판매 현황을 조회합니다.",btn("엑셀 다운로드","stats-xlsx"))+
    '<form id="stats-form" class="panel stats-form"><fieldset><legend>판매처</legend><label><input type="checkbox" id="stats-all"'+check(f.channels===null||channels.every(c=>f.channels.includes(c)))+'>전체</label>'+channels.map(c=>'<label><input type="checkbox" name="market" value="'+esc(c)+'"'+check(!f.channels||f.channels.includes(c))+'>'+esc(c)+'</label>').join("")+'</fieldset>'+
    '<fieldset><legend>기간</legend>'+radios("preset",["오늘","어제","1주","1개월","3개월","지정"].map(x=>[x,x]),f.preset)+'<label><input type="date" name="start" aria-label="시작일" value="'+f.start+'" required></label><label><input type="date" name="end" aria-label="종료일" value="'+f.end+'" required></label></fieldset>'+
    '<fieldset><legend>일자 기준</legend>'+radios("basis",[["date","주문일"],["shipDate","발송일"]],f.basis)+'<label><input type="checkbox" name="sent"'+check(f.sent)+'>발송된 건만 표시</label><button type="submit" class="primary">조회</button></fieldset></form>'+
    '<section class="panel">'+panelHead("일자별 판매 현황",'<span>총판매 '+won(rows.reduce((a,r)=>a+r[5],0))+' · 실판매 '+won(rows.reduce((a,r)=>a+r[7],0))+'</span>')+
    '<div class="table-wrap stats-table"><table><thead><tr>'+heading+'</tr></thead><tbody>'+(body||'<tr><td colspan="17" class="empty">조회 조건에 해당하는 판매 내역이 없습니다.</td></tr>')+'</tbody></table></div>'+
    '<p class="totals">금액 단위는 원입니다. 실판매는 취소·반품을 제외합니다. 정산예정금액과 구매자 결제 배송비는 실판매 주문 중 미입력 건이 있으면 —로 표시합니다.'+(missingDate?' 발송일 미기록 '+missingDate+'개 주문상품은 발송일 집계에서 제외했습니다.':'')+'</p></section>';
}
function applyStats(form){
  if(!form.reportValidity())return false;
  const data=new FormData(form),start=data.get("start"),end=data.get("end");
  if(start>end||end>shiftDate(start,0,12)){notify("조회 기간은 시작일부터 최대 1년까지 선택해 주세요.");return false;}
  const selected=data.getAll("market");
  Object.assign(statsFilter(),{start,end,preset:data.get("preset"),basis:data.get("basis"),sent:data.has("sent"),channels:form.querySelectorAll('[name="market"]').length===selected.length?null:selected});
  return true;
}
// Small, uncompressed Office Open XML workbook for the daily sales table.
function workbookBlob(rows) {
  const xml = value => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const sheet = rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>{
    const ref=String.fromCharCode(65+j)+(i+1);
    if(value==null)return '<c r="'+ref+'"/>';
    if(typeof value==="number")return '<c r="'+ref+'"><v>'+value+'</v></c>';
    return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
  }).join("")+'</row>').join("");
  const office="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const main="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel=(type,path)=>'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+office+'/'+type+'" Target="'+path+'"/></Relationships>';
  const files={
    "[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":rel("officeDocument","xl/workbook.xml"),
    "xl/workbook.xml":'<workbook xmlns="'+main+'" xmlns:r="'+office+'"><sheets><sheet name="마켓데스크" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":rel("worksheet","worksheets/sheet1.xml"),
    "xl/worksheets/sheet1.xml":'<worksheet xmlns="'+main+'"><cols><col min="1" max="16" width="17" customWidth="1"/></cols><sheetData>'+sheet+'</sheetData></worksheet>'
  };
  const encoder=new TextEncoder(), local=[], directory=[];
  function header(size, fields){
    const bytes=new Uint8Array(size), view=new DataView(bytes.buffer);
    for(const [offset,width,value] of fields)view[width===4?"setUint32":"setUint16"](offset,value,true);
    return bytes;
  }
  let offset=0,dirSize=0;
  for(const [path,content] of Object.entries(files)){
    const name=encoder.encode(path), data=encoder.encode(content);
    let crc=-1;
    for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(~crc)>>>0;
    local.push(header(30,[[0,4,0x04034b50],[4,2,20],[12,2,33],[14,4,crc],[18,4,data.length],[22,4,data.length],[26,2,name.length]]),name,data);
    directory.push(header(46,[[0,4,0x02014b50],[4,2,20],[6,2,20],[14,2,33],[16,4,crc],[20,4,data.length],[24,4,data.length],[28,2,name.length],[42,4,offset]]),name);
    offset+=30+name.length+data.length;dirSize+=46+name.length;
  }
  const count=Object.keys(files).length;
  return new Blob([...local,...directory,header(22,[[0,4,0x06054b50],[8,2,count],[10,2,count],[12,4,dirSize],[16,4,offset]])],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
const productionUnits=["봉","kg","개","박스"];
const rawKg=grams=>fmt.format(grams/1000)+" kg";

function production(){
  const {start,end}=dateRange("production");
  const rows=sorted((store.production||[]).filter(row=>(!start||row.date>=start)&&(!end||row.date<=end)));
  const body=rows.map(row=>'<tr><td>'+esc(row.date)+'</td><td><b>'+esc(row.name)+'</b></td><td>'+esc(row.method)+'</td><td class="money">'+fmt.format(row.qty)+' '+esc(row.unit)+'</td>'+
    '<td>'+(row.recipe?row.recipe.materials.map(item=>esc(item.name)+' '+rawKg(rawStockUse(item,row.qty))).join('<br>'):'—')+'</td>'+
    '<td>'+esc(row.memo)+'</td><td><button class="short" data-action="production-entry" data-id="'+esc(row.id)+'">수정</button></td></tr>').join("");
  const balances=[...rawStockBalances(store.purchases,store.production).values()].sort((a,b)=>a.name.localeCompare(b.name,"ko"));
  return head("생산관리","생산량에 맞춰 레시피의 원물 사용량을 재고에 반영합니다.",
    officeLink("recipes","제품 레시피")+btn(bplus+" 생산 등록","production-entry",true))+
    officePanel("현재 원물 재고",officeTable(["원물","입고 중량","생산 사용량","남은 재고"],
      balances.map(row=>[esc(row.name),rawKg(row.received),rawKg(row.used),rawKg(row.received-row.used)])))+
    '<section class="panel">'+panelHead("생산 기록 · "+rows.length+"건")+'<div class="table-wrap"><table><thead><tr>'+
    th(["생산일","제품명","포장 방식","!생산량","원물 사용량","메모","작업"])+'</tr></thead><tbody>'+
    (body||'<tr><td class="empty" colspan="7">선택한 기간에 생산 기록이 없습니다.</td></tr>')+'</tbody></table></div></section>';
}
function openProduction(id){
  const rows=store.production||[];
  const existing=rows.find(record=>record.id===id);
  const row=existing||{id:crypto.randomUUID(),date:day(),name:"",method:"자동 포장",qty:"",unit:"봉",memo:""};
  const recipes=existing?[]:officeRows("recipes").filter(item=>item.materials?.length);
  if(!existing&&!recipes.length){
    notify("제품 레시피에서 원물 차감 기준을 먼저 등록해 주세요.");
    location.hash="recipes";
    return;
  }
  const otherRows=rows.filter(item=>item.id!==row.id);
  const stock=rawStockBalances(store.purchases,otherRows);
  const form=formDialog(existing?"생산 기록 수정":"생산 등록",
    '<label>생산일<input type="date" name="date" value="'+esc(row.date)+'" required></label>'+
    (existing?field("제품명","name",row.name,false,0,true):
      select("제품 레시피","recipeId",[["","레시피 선택"],...recipes.map(item=>[item.id,item.name])],""))+
    select("포장 방식","method",["자동 포장","수동 포장"],row.method)+
    '<label>생산량<input type="number" name="qty" min="0.001" max="1000000000" step="0.001" value="'+esc(row.qty)+'" required></label>'+
    select("단위","unit",productionUnits,row.unit)+field("메모","memo",row.memo)+
    '<p class="wide muted" id="raw-production-preview" aria-live="polite"></p>',async values=>{
      const {recipeId,name,unit,...fields}=values;
      const chosen=recipes.find(item=>item.id===recipeId);
      if(!existing&&!chosen)throw Error("제품 레시피를 선택해 주세요.");
      const recipe=row.recipe||(chosen?{id:chosen.id,unit:chosen.unit,materials:chosen.materials}:undefined);
      const record={...fields,id:row.id,name:row.recipe?row.name:(chosen?.name||name.trim()),
        unit:recipe?.unit||unit,qty:Number(values.qty),memo:values.memo.trim()};
      if(!record.name)throw Error("제품명을 입력해 주세요.");
      if(record.unit!=="kg"&&!Number.isInteger(record.qty))throw Error("봉·개·박스 수량은 정수로 입력해 주세요.");
      if(recipe)record.recipe=recipe;
      const production=[record,...otherRows];
      const shortage=rawStockShortage(store.purchases,production);
      if(shortage)throw Error(shortage.name+" 재고가 "+rawKg(shortage.used-shortage.received)+" 부족합니다.");
      await commit({...store,production});
    });
  if(row.recipe)form.elements.name.readOnly=true;
  const picker=form.elements.recipeId;
  if(picker)picker.required=true;
  const quantity=form.elements.qty, unit=form.elements.unit;
  function update(){
    const recipe=row.recipe||recipes.find(item=>item.id===picker?.value);
    const preview=form.querySelector("#raw-production-preview");
    if(recipe)unit.value=recipe.unit;
    unit.disabled=Boolean(recipe);
    quantity.min=unit.value==="kg"?"0.001":"1";
    quantity.step=unit.value==="kg"?"0.001":"1";
    const value=quantity.valueAsNumber;
    if(recipe&&quantity.validity.valid&&value>0){
      preview.textContent=recipe.materials.map(item=>{
        const balance=stock.get(rawStockKey(item.name));
        const available=balance?balance.received-balance.used:0;
        const needed=rawStockUse(item,value);
        return item.name+" · 필요 "+rawKg(needed)+" / 보유 "+rawKg(available)+
          (needed>available?" · "+rawKg(needed-available)+" 부족":" · 차감 후 "+rawKg(available-needed));
      }).join(" | ");
    }else{
      preview.textContent=existing&&!row.recipe?"기존 생산 기록에는 원물 차감이 연결되어 있지 않습니다.":"";
    }
  }
  form.addEventListener("input",update);
  update();
}
function renderBusiness(){
  const picker=$("business");
  picker.innerHTML=options(Object.entries(names).map(([slot,name])=>[slot,name===defaultNames[slot]?name:slot+" · "+name]),business);
  picker.disabled=!ready||busy||switching;
  $("share-work").disabled=picker.disabled;
  $("share-work").hidden=demo;
  if(ready){
    const label=$("active-business");
    const text=(demo?"샘플 사업자":"현재 사업자")+" · "+names[business];
    if(label.textContent!==text)label.textContent=text;
  }
}
async function shareWork(){
  if(!ready||demo)return;
  const url=new URL(location.origin+"/");
  url.searchParams.set("business",business);
  url.hash=page();
  if(navigator.share){
    try {await navigator.share({title:"마켓데스크 작업 이어가기",url:url.href});return;}
    catch(error){if(error.name==="AbortError")return;}
  }
  try {
    await navigator.clipboard.writeText(url.href);
    notify("작업 링크를 복사했습니다.");
  } catch {
    $("dialog-body").innerHTML='<div class="dialog-head"><h2>작업 링크 공유</h2>'+btn("닫기","close")+
      '</div><div class="fields"><label class="wide">링크 복사<input readonly value="'+esc(url.href)+'"></label></div>';
    $("dialog").showModal();
    $("dialog-body").querySelector("input").select();
  }
}
function render() {
  const p=page();
  renderOfficeMenu(p);
  $("tasks").innerHTML=sidebarTasks.map(id=>{
    const [label,symbol]=tasks[id];
    return '<a href="#'+id+'"'+(p===id?' class="active" aria-current="page"':'')+'>'+icon(symbol)+label+'</a>';
  }).join("");
  $("today").textContent=day().replaceAll("-",".")+" KST";
  renderBusiness();
  if(!ready)return;
  const output=Object.hasOwn(queues,p)?queueView(p):Object.hasOwn(officeViews,p)?officeViews[p]():{home:dashboard,orders:()=>orders(false),ship:()=>orders(true),stock,profit,purchases,production,statistics,setup:settings,collect:collectionPage,export:()=>orders(false),dispatch:()=>orders(true),invoices:invoiceImportPage}[p]();
  $("content").innerHTML=officeWorkspace()+(demo?'<div class="note">샘플 화면 · '+btn("체험 종료","demo")+'</div>':'')+output;
  if(p==="export"||p==="printFolder")renderPrintFolder();
  if(["setup","collect","marketAdmin"].includes(p)&&!demo&&!marketLoaded&&!marketLoading)void loadMarkets();
}
const field=(label,name,value="",isNumber=false,min=0,required=false)=>'<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" '+(isNumber?'type="number" step="1" min="'+min+'" max="1000000000"':'maxlength="120"')+(required?' required':'')+'></label>';
const select=(label,name,rows,value)=>'<label>'+label+'<select name="'+name+'">'+options(rows,value)+'</select></label>';
function formDialog(title,fields,save,submitLabel="저장",success="저장했습니다.") {
  $("dialog-body").innerHTML='<form><div class="dialog-head"><div><span class="sub">'+esc(names[business])+'</span><h2>'+title+'</h2></div><button type="button" data-action="close" aria-label="닫기">닫기</button></div><div class="fields">'+fields+'</div><p class="form-error" role="alert"></p><div class="dialog-foot"><button class="primary" type="submit">'+submitLabel+'</button></div></form>';
  const form=$("dialog-body").querySelector("form");
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const submit=form.querySelector('[type="submit"]');
    submit.disabled=true;
    try {
      const result=await save(Object.fromEntries(new FormData(form)));
      $("dialog").close();
      notify(typeof result==="string"?result:success);
    } catch(error){form.querySelector(".form-error").textContent=error.message;}
    finally{submit.disabled=false;}
  });
  $("dialog").showModal();
  return form;
}
function openBusinessName() {
  const form=formDialog("사업자명 수정",field("사업자명","businessName",names[business],false,0,true),async values=>{
    const name=values.businessName.trim();
    if(!name||name.length>40)throw Error("사업자명은 1~40자로 입력해 주세요.");
    await commit({...store,businessName:name});
  });
  form.elements.businessName.maxLength=40;
}
function openMarketKey(market){
  if(demo||!Object.hasOwn(marketNames,market))return;
  const coupang=market==="coupang", esm=["auction","gmarket"].includes(market);
  const form=formDialog(marketNames[market]+" API 키",
    '<p class="muted wide">주문 조회용 키를 입력해 주세요. 저장한 키는 화면에서 다시 표시되지 않습니다.</p>'+
    field(coupang?"판매자 ID (Vendor ID)":market==="naver"?"애플리케이션 ID":"판매자 ID","id","",false,0,true)+
    (esm?field("ESM+ 마스터 ID","access","",false,0,true)+field("발급자 도메인 (iss)","issuer","www.esmplus.com",false,0,true):coupang?field("Access Key","access","",false,0,true):"")+
    '<label class="wide">'+(coupang||esm?"Secret Key":market==="eleven"?"Open API 인증키":"애플리케이션 시크릿")+'<input type="password" name="secret" required maxlength="160" autocomplete="new-password" spellcheck="false"></label>',
    async values=>{
      const target=business;
      busy=true;
      renderBusiness();
      try{
        await marketCall({...values,market,action:"save"},target);
        marketLoaded=false;
        await loadMarkets();
      }finally{busy=false;renderBusiness();}
    });
  form.autocomplete="off";
  for(const input of form.querySelectorAll("input")){input.spellcheck=false;input.maxLength=160;}
}
function openProduct(sku) {
  const existing=store.products.find(p=>p.sku===sku);
  const p=existing||{sku:"",name:"",cost:0,units:0,limit:0};
  const form=formDialog(existing?"상품 수정":"상품 등록",
    field("상품 SKU","sku",p.sku,false,0,true)+field("상품명","name",p.name,false,0,true)+field("단위원가 (원)","cost",p.cost,true,0,true)+field("누적 입고 기준수량","units",p.units,true,0,true)+field("안전재고","limit",p.limit,true,0,true),
    async values=>{
      const cleaned={...existing,sku:values.sku.trim(),name:values.name.trim(),cost:Number(values.cost),units:Number(values.units),limit:Number(values.limit)};
      if(!cleaned.sku||!cleaned.name)throw Error("SKU와 상품명을 입력해 주세요.");
      if(!existing&&store.products.some(x=>x.sku===cleaned.sku))throw Error("이미 등록한 SKU입니다.");
      await commit({...store,products:[...store.products.filter(x=>x.sku!==sku),cleaned]});
    });
  if(existing)form.elements.sku.readOnly=true;
}
const productColumns=[
  ["sku","상품 SKU"],["name","상품명"],["cost","단위원가 (원)"],
  ["units","누적 입고 기준수량"],["limit","안전재고"]
];
async function importProducts(file) {
  if(!/\.xlsx$/i.test(file.name))throw Error("상품 등록은 엑셀(.xlsx) 파일을 선택해 주세요.");
  const source=store, target=business;
  const [header,...rows]=await readTable(file);
  if(switching||store!==source||business!==target)throw Error("사업자 또는 자료가 변경되었습니다. 파일을 다시 선택해 주세요.");
  if(!rows.length)throw Error("엑셀 파일에 등록할 상품이 없습니다.");
  const headers=header.map(value=>value.trim());
  const columns=productColumns.map(([key,label])=>headers.findIndex(value=>value===label||value===key||(key==="sku"&&value==="SKU")||(key==="cost"&&value==="단위원가")));
  if(columns.some(index=>index<0)||new Set(columns).size!==columns.length){
    throw Error("엑셀 양식의 상품 SKU, 상품명, 단위원가 (원), 누적 입고 기준수량, 안전재고 열을 확인해 주세요.");
  }
  const existing=new Set(source.products.map(product=>product.sku));
  const added=[];
  let duplicates=0;
  for(const [index,row] of rows.entries()){
    const [sku,name,cost,units,limit]=columns.map(column=>(row[column]||"").trim());
    if(![sku,name,cost,units,limit].some(Boolean))continue;
    if(existing.has(sku)){
      duplicates++;
      continue;
    }
    const numbers=[cost,units,limit].map(value=>{
      if(!value)return 0;
      return /^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(value)?Number(value.replaceAll(",","")):NaN;
    });
    if(!sku||!name||sku.length>120||name.length>120||numbers.some(value=>!Number.isInteger(value)||value>1000000000)){
      throw Error((row.sheetRow||index+2)+"행의 SKU, 상품명과 0 이상의 정수 항목을 확인해 주세요. 상품은 등록되지 않았습니다.");
    }
    existing.add(sku);
    added.push({sku,name,cost:numbers[0],units:numbers[1],limit:numbers[2]});
  }
  if(!added.length&&!duplicates)throw Error("엑셀 파일에 등록할 상품이 없습니다.");
  if(source.products.length+added.length>3000)throw Error("사업자당 상품은 최대 3,000개까지 등록할 수 있습니다.");
  if(added.length)await commit({...source,products:[...source.products,...added]});
  notify("상품 "+added.length+"개 등록"+(duplicates?" · 중복 SKU "+duplicates+"개 건너뜀":""));
}
function matchOrder(id) {
  const order=store.orders.find(o=>o.id===id);
  if(!order||order.sku)return;
  formDialog("관리 상품 연결",'<p class="wide">'+esc(order.channel)+' · '+esc(order.name)+'</p>'+
    select("관리 상품 SKU","sku",[["","상품 선택"],...store.products.map(p=>[p.sku,p.name+" ("+p.sku+")"])],""),async ({sku})=>{
      const product=store.products.find(p=>p.sku===sku);
      if(!product)throw Error("연결할 관리 상품을 선택해 주세요.");
      await commit({...store,orders:store.orders.map(o=>o.id===id?{...o,sku,cost:product.cost}:o)});
    },"연결","관리 상품을 연결했습니다.");
}
function selectedWorkflowIds() {
  return new Set([...$("content").querySelectorAll('[name="workflow-order"]:checked')].map(input=>input.value));
}
function selectionActions() {
  return btn("모두 선택","workflow-all")+btn("모두 해제","workflow-none");
}
function completeSelected() {
  const ids=selectedWorkflowIds();
  const eligible=o=>ids.has(o.id)&&queues.shippingWork[1](o)&&o.market!=="naver";
  const count=store.orders.filter(eligible).length;
  if(!count){notify("발송처리할 주문을 선택해 주세요.");return;}
  formDialog("선택 주문 발송처리",'<p class="wide">'+fmt.format(count)+'건을 발송완료로 기록합니다.</p>'+
    '<label>발송일<input type="date" name="shipDate" value="'+day()+'" required></label>',async ({shipDate})=>{
      await commit({...store,orders:store.orders.map(o=>eligible(o)?{...o,status:"발송완료",shipDate}:o)});
    },"발송완료로 저장","발송처리를 저장했습니다.");
}
function openOrder(id) {
  const existing=store.orders.find(o=>o.id===id);
  const o=existing||{date:day(),channel:"쿠팡",qty:1,price:0,cost:0,fee:0,shipping:0,pack:0,discount:0,status:"신규"};
  const known=store.products.map(p=>[p.sku,p.name+" ("+p.sku+")"]);
  if(o.sku&&!known.some(([sku])=>sku===o.sku))known.push([o.sku,o.sku]);
  const form=formDialog(existing?"주문·송장 수정":"주문 등록",
    '<label>주문일<input type="date" name="date" value="'+esc(o.date)+'" required></label>'+
    select("판매처","channel",[...new Set([...businessChannels(),...(existing?[existing.channel]:[])])],o.channel)+field("주문번호","number",o.number,false,0,true)+field("주문상품번호 (선택)","line",o.line)+
    select("관리 상품 SKU","sku",[["","직접 입력 상품"],...known],o.sku||"")+field("상품명","name",o.name,false,0,true)+
    field("수량","qty",o.qty,true,1,true)+field("판매단가 (원)","price",o.price,true,0,true)+field("단위원가 (원)","cost",o.cost,true,0,true)+field("판매수수료 합계","fee",o.fee,true)+field("배송비 합계","shipping",o.shipping,true)+field("포장비 합계","pack",o.pack,true)+field("할인 부담금 합계","discount",o.discount,true)+
    '<label>발송일<input type="date" name="shipDate" value="'+esc(o.shipDate||"")+'"></label>'+
    field("정산예정금액 (선택)","settlement",o.settlement??"",true)+field("구매자 결제 배송비 (선택)","shippingPaid",o.shippingPaid??"",true)+
    '<label class="check"><input type="checkbox" name="exchanged"'+(o.exchanged?" checked":"")+'> 교환 처리된 주문상품</label>'+
    field("고객명","customer",o.customer||"")+field("배송메모","deliveryMemo",o.deliveryMemo||"")+select("처리 상태","status",states,o.status)+
    '<label>택배사<input name="carrier" list="office-carriers" value="'+esc(o.carrier||"")+'" maxlength="120"><datalist id="office-carriers">'+officeRows("carriers").map(row=>'<option value="'+esc(row.name)+'"></option>').join("")+'</datalist></label>'+field("송장번호","tracking",o.tracking)+
    (o.market?'<p class="muted wide">API 주문의 재고는 관리 상품 SKU를 연결하면 반영됩니다. 단위원가·수수료·배송비·포장비·할인을 확인한 뒤 비용 확인 완료를 선택하세요.</p>'+
      field("판매금액 합계 (원)","marketGross",o.marketGross,true,0,true)+
      '<label class="check"><input type="checkbox" name="costsReviewed"'+(o.costsReviewed?" checked":"")+'> 비용 확인 완료</label>':""),
    async values=>{
      const cleaned=normalize(o.market?{...values,channel:o.channel}:values,existing?.id);
      if(o.stockOverride!==undefined)cleaned.stockOverride=o.stockOverride;
      if(values.deliveryMemo)cleaned.deliveryMemo=values.deliveryMemo.trim();
      if(values.customer.trim())cleaned.customer=values.customer.trim();
      if(values.shipDate)cleaned.shipDate=values.shipDate;
      if(values.exchanged==="on")cleaned.exchanged=true;
      for(const field of ["settlement","shippingPaid"])if(values[field]!=="")cleaned[field]=Number(values[field]);
      if(o.market)Object.assign(cleaned,{market:o.market,marketSku:o.marketSku,marketGross:Number(values.marketGross),costsReviewed:values.costsReviewed==="on"});
      if(store.orders.some(x=>x.id!==id&&key(x)===key(cleaned)))throw Error("같은 판매처·주문번호·주문상품번호가 이미 있습니다.");
      return commit({...store,orders:[...store.orders.filter(x=>x.id!==id),cleaned]},undefined,undefined,true);
    });
  form.elements.sku.addEventListener("change",()=>{
    const item=store.products.find(p=>p.sku===form.elements.sku.value);
    if(item){form.elements.name.value=item.name;form.elements.cost.value=item.cost;}
  });
  if(o.market){
    form.elements.channel.disabled=true;
    form.elements.number.readOnly=true;
    form.elements.line.readOnly=true;
  }
}
function normalize(raw,id=crypto.randomUUID()) {
  const o={id};
  for(const k of ["date","channel","number","line","sku","name","status","carrier","tracking"]){
    o[k]=String(raw[k]??"").trim();
    if(o[k].length>120)throw Error("문자 입력은 120자까지 가능합니다.");
  }
  o.status ||= "신규";
  const product=store.products.find(p=>p.sku===o.sku);
  o.name ||= product?.name||"";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(o.date)||!Number.isFinite(Date.parse(o.date))||new Date(o.date).toISOString().slice(0,10)!==o.date||(!businessChannels().includes(o.channel)&&!store.orders.some(old=>old.id===id&&old.channel===o.channel))||!states.includes(o.status)||!o.number||!o.name)throw Error("주문일, 지원 판매처, 주문번호, 상품명과 상태를 확인해 주세요.");
  for(const k of ["qty","price","cost","fee","shipping","pack","discount"]){
    let v=String(raw[k]??"").trim();
    if(!v&&k==="cost")v=String(product?.cost??"");
    if(!v&&["qty","price","cost"].includes(k))throw Error("수량, 판매단가와 단위원가가 필요합니다.");
    v=v.replaceAll(",","");
    if(v&&!/^\d+$/.test(v))throw Error("금액과 수량은 정수로 입력해 주세요.");
    o[k]=Number(v);
    if(o[k]<(k==="qty"?1:0)||o[k]>1e9)throw Error("금액 또는 수량 범위를 확인해 주세요.");
  }
  if(o.qty>100000)throw Error("주문당 수량은 100,000개까지 입력할 수 있습니다.");
  return o;
}
const csvFields=[["date","주문일"],["channel","판매처"],["number","주문번호"],["line","주문상품번호"],["sku","SKU"],["name","상품명"],["qty","수량"],["price","판매단가"],["cost","단위원가"],["fee","판매수수료"],["shipping","배송비"],["pack","포장비"],["discount","할인부담금"],["status","상태"],["carrier","택배사"],["tracking","송장번호"]];
function csvParse(text) {
  const rows=[];let row=[],value="",quoted=false,closed=false;
  const endCell=()=>{row.push(value);value="";closed=false;};
  const endRow=()=>{endCell();if(row.some(v=>v.trim()))rows.push(row);row=[];};
  const clean=text.replace(/^\uFEFF/,"");
  for(let i=0;i<clean.length;i++){
    const c=clean[i];
    if(quoted){
      if(c==='"'&&clean[i+1]==='"'){value+='"';i++;}
      else if(c==='"'){quoted=false;closed=true;}else value+=c;
    }else if(c===","){endCell();}
    else if(c==="\r"||c==="\n"){if(c==="\r"&&clean[i+1]==="\n")i++;endRow();}
    else if(c==='"'&&!value&&!closed){quoted=true;}
    else if(closed||c==='"'){throw Error("CSV의 따옴표 형식을 확인해 주세요.");}
    else value+=c;
  }
  if(quoted)throw Error("닫히지 않은 CSV 따옴표가 있습니다.");
  endRow();return rows;
}
async function readTable(file) {
  const excel=/\.xlsx$/i.test(file.name);
  if(file.size>(excel?8000000:2000000))throw Error(excel?"엑셀 파일을 8MB 이하로 나누어 주세요.":"CSV 파일을 2MB 이하로 나누어 주세요.");
  const bytes=await file.arrayBuffer();
  if(excel)return readWorkbook(bytes);
  let decoded;
  try{decoded=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{decoded=new TextDecoder("euc-kr").decode(bytes);}
  return csvParse(decoded);
}
async function readWorkbook(buffer,sheetName) {
  const bytes=new Uint8Array(buffer), zip=new DataView(buffer), decoder=new TextDecoder();
  const invalid=()=>Error("엑셀 파일을 읽을 수 없습니다. .xlsx 형식으로 다시 저장해 주세요.");
  const u16=offset=>zip.getUint16(offset,true), u32=offset=>zip.getUint32(offset,true);
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557);end--){
    if(u32(end)===0x06054b50&&end+22+u16(end+20)===bytes.length)break;
  }
  if(end<Math.max(0,bytes.length-65557)||u16(end+4)||u16(end+6))throw invalid();
  const entries=new Map();
  for(let offset=u32(end+16),i=0;i<u16(end+10);i++){
    if(offset+46>end||u32(offset)!==0x02014b50)throw invalid();
    const length=u16(offset+28);
    entries.set(decoder.decode(bytes.subarray(offset+46,offset+46+length)),offset);
    offset+=46+length+u16(offset+30)+u16(offset+32);
  }
  const elements=(xml,name)=>Array.from(xml.getElementsByTagNameNS("*",name));
  async function xml(path) {
    const entry=entries.get(path);
    if(entry===undefined)throw invalid();
    const local=u32(entry+42), size=u32(entry+24), packed=u32(entry+20), method=u16(entry+10);
    if(size>16000000||u16(entry+8)&1||local+30>end||u32(local)!==0x04034b50)throw invalid();
    const start=local+30+u16(local+26)+u16(local+28);
    if(start+packed>end||![0,8].includes(method))throw invalid();
    let data=bytes.subarray(start,start+packed);
    if(method===8){
      const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      data=new Uint8Array(size);
      let written=0;
      try {
        for(let part=await reader.read();!part.done;part=await reader.read()){
          if(written+part.value.length>size)throw invalid();
          data.set(part.value,written);
          written+=part.value.length;
        }
      } finally {await reader.cancel();}
      if(written!==size)throw invalid();
    }
    if(data.length!==size)throw invalid();
    const text=decoder.decode(data);
    if(/<!DOCTYPE/i.test(text))throw invalid();
    const doc=new DOMParser().parseFromString(text,"application/xml");
    if(elements(doc,"parsererror").length)throw invalid();
    return doc;
  }
  const book=await xml("xl/workbook.xml");
  const sheets=elements(book,"sheet");
  const sheet=sheetName?sheets.find(item=>item.getAttribute("name")===sheetName):sheets[0];
  if(sheetName&&!sheet)throw Error(sheetName+" 시트가 필요합니다.");
  const id=Array.from(sheet?.attributes||[]).find(attr=>attr.localName==="id")?.value;
  const rels=elements(await xml("xl/_rels/workbook.xml.rels"),"Relationship");
  const relation=rels.find(rel=>rel.getAttribute("Id")===id&&rel.getAttribute("Type")?.endsWith("/worksheet"));
  const target=relation?.getAttribute("Target");
  if(!target||relation.getAttribute("TargetMode")==="External")throw invalid();
  const path=new URL(target,"https://workbook.invalid/xl/workbook.xml");
  if(path.origin!=="https://workbook.invalid"||!path.pathname.startsWith("/xl/"))throw invalid();
  const readText=node=>elements(node,"t").filter(t=>t.parentNode.localName!=="rPh").map(t=>t.textContent).join("");
  const strings=entries.has("xl/sharedStrings.xml")?elements(await xml("xl/sharedStrings.xml"),"si").map(readText):[];
  const date1904=["1","true"].includes(elements(book,"workbookPr")[0]?.getAttribute("date1904"));
  const rows=[];
  for(const row of elements(await xml(path.pathname.slice(1)),"row")){
    const values=[];
    for(const cell of elements(row,"c")){
      const letters=/^[A-Z]+/.exec(cell.getAttribute("r")||"")?.[0];
      const column=letters?[...letters].reduce((n,c)=>26*n+c.charCodeAt(0)-64,0)-1:values.length;
      if(column>=128)continue;
      const type=cell.getAttribute("t"), value=elements(cell,"v")[0]?.textContent??"";
      let text=type==="inlineStr"?readText(cell):type==="s"?strings[Number(value)]??"":value;
      if(rows.length&&["주문일","date"].includes(rows[0][column]?.trim())&&(!type||type==="n")&&/^\d+(?:\.\d+)?$/.test(text)){
        const serial=Math.floor(Number(text));
        const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,serial<60?31:30);
        if(serial<=2957003)text=new Date(epoch+serial*86400000).toISOString().slice(0,10);
      }
      values[column]=text;
    }
    if(values.some(value=>value!=="")){
      if(rows.length>=10001)throw Error("엑셀 파일을 10,000행 이하로 나누어 주세요.");
      const cells=Array.from(values,value=>value??"");
      Object.defineProperty(cells,"sheetRow",{value:Number(row.getAttribute("r"))||rows.length+1});
      rows.push(cells);
    }
  }
  return rows;
}
function csvBlob(rows) {
  const csv=rows.map(row=>row.map(v=>{
    const s=String(v??"");
    return '"'+(/^\s*[=+\-@\t\r\n]/.test(s)?"'":"")+s.replaceAll('"','""')+'"';
  }).join(",")).join("\r\n");
  return new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"});
}
function formatButtons(label,action) {
  return btn(label+" CSV",action)+btn(label+" 엑셀",action+"-xlsx-file");
}
function tabularBlob(filename,rows) {
  return filename.endsWith(".xlsx") ? workbookBlob(rows) : csvBlob(rows);
}
function download(filename,rows) {
  downloadBlob(filename,tabularBlob(filename,rows));
}
function downloadBlob(filename,blob) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}
const printFolders=new Map();
const printFolderKey=()=> (demo?"demo:":"business:")+business;
const printFolderSupported=()=>typeof window.showDirectoryPicker==="function"&&typeof indexedDB!=="undefined";

async function printFolderStorage(key, handle) {
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open("marketdesk-print-folders",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("folders");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const read=handle===undefined;
      const tx=db.transaction("folders",read?"readonly":"readwrite");
      const folders=tx.objectStore("folders");
      const request=read?folders.get(key):handle?folders.put(handle,key):folders.delete(key);
      tx.oncomplete=()=>resolve(request.result);
      tx.onabort=()=>reject(tx.error||request.error);
    });
  } finally {db.close();}
}
function renderPrintFolder() {
  const panel=$("print-folder");
  if(!panel)return;
  if(!printFolderSupported()){
    panel.innerHTML=panelHead("저장 위치 · 브라우저 다운로드 폴더")+
      '<p class="totals">현재 브라우저에서는 앱에서 폴더를 지정할 수 없습니다. 브라우저 다운로드 설정에서 위치를 변경할 수 있습니다.</p>';
    return;
  }
  const key=printFolderKey();
  if(!printFolders.has(key)){
    printFolders.set(key,undefined);
    void printFolderStorage(key).then(handle=>printFolders.set(key,handle||null))
      .catch(()=>printFolders.set(key,null)).finally(renderPrintFolder);
  }
  const handle=printFolders.get(key);
  panel.innerHTML=panelHead("저장 위치 · "+(handle?esc(handle.name):handle===null?"브라우저 다운로드 폴더":"확인 중"),
    handle===undefined?"":btn(handle?"폴더 변경":"폴더 설정","print-folder-pick")+(handle?btn("기본 다운로드 사용","print-folder-clear"):""));
}
async function changePrintFolder(clear, button) {
  if(!printFolderSupported())return;
  const key=printFolderKey();
  button.disabled=true;
  try {
    const handle=clear?null:await window.showDirectoryPicker({id:"marketdesk-print-"+business,mode:"readwrite"});
    await printFolderStorage(key,handle);
    printFolders.set(key,handle);
    renderPrintFolder();
  } catch(error) {
    if(error.name==="AbortError")return;
    throw Error("폴더 설정을 저장하지 못했습니다. 브라우저의 폴더 접근 권한을 확인해 주세요.");
  } finally {button.disabled=false;}
}
async function exportPrintFile(filename, rows) {
  if(!printFolderSupported())return download(filename,rows);
  const handle=printFolders.get(printFolderKey());
  if(handle===undefined)throw Error("저장 위치를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.");
  if(!handle)return download(filename,rows);
  if(await handle.requestPermission({mode:"readwrite"})!=="granted"){
    throw Error("폴더에 저장할 권한이 없습니다. 폴더를 다시 설정하거나 기본 다운로드를 선택해 주세요.");
  }
  const uniqueName=filename.replace(/(\.(?:csv|xlsx))$/,"-"+crypto.randomUUID().slice(0,12)+"$1");
  try {
    await writeFolderFile(handle,uniqueName,tabularBlob(filename,rows));
  } catch {
    throw Error("선택한 폴더에 파일을 저장하지 못했습니다. 폴더 위치와 권한을 확인해 주세요.");
  }
  notify(handle.name+"에 "+uniqueName+"을 저장했습니다.");
}
async function writeFolderFile(folder,filename,blob) {
  const writer=await (await folder.getFileHandle(filename,{create:true})).createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch(error) {
    await writer.abort().catch(()=>{});
    throw error;
  }
}
async function importOrders(file) {
  const source=store;
  const [header,...rows]=await readTable(file);
  if(switching||store!==source)throw Error("현재 사업자의 자료가 변경되었습니다. 사업자를 확인한 뒤 파일을 다시 가져와 주세요.");
  if(!rows.length) throw Error("파일에 주문 행이 없습니다.");
  const columns=Object.fromEntries(csvFields.map(([k,v])=>[k,header.findIndex(h=>[k,v].includes(h.trim()))]));
  if(["date","channel","number","qty","price"].some(k=>columns[k]<0))throw Error("가져오기 양식에서 주문일, 판매처, 주문번호, 수량, 판매단가 열을 확인해 주세요.");
  const seen=new Set(store.orders.map(key)), accepted=[];
  let duplicates=0;
  for(const [i,row] of rows.entries()){
    try{
      const raw=Object.fromEntries(Object.entries(columns).map(([k,c])=>[k,row[c]??""]));
      if(seen.has(key({channel:raw.channel.trim(),number:raw.number.trim(),line:raw.line.trim()}))){duplicates++;continue;}
      const o=normalize(raw);
      seen.add(key(o));accepted.push(o);
    }catch(error){throw Error((i+2)+"번째 줄 · "+error.message);}
  }
  if(accepted.length)await commit({...store,orders:[...store.orders,...accepted]});
  notify(accepted.length+"건 가져옴 · 중복 "+duplicates+"건 제외");
}
function demoData() {
  const products=[["AL500","구운 아몬드 500g",4400,120],["MX500","오리지날 믹스넛 500g",3800,3],["WN500","호두 500g",5200,60],["CN500","캐슈넛 500g",5200,40]].map(([sku,name,cost,units])=>({sku,name,cost,units,limit:5}));
  const samples=[[0,"쿠팡","신규",3,10400],[1,"네이버","포장중",2,9900],[2,"쿠팡","발송완료",4,11900],[3,"올레즈","신규",1,12900],[1,"쿠팡","발송완료",1,10800],[0,"네이버","취소",2,10400]];
  return {products,orders:samples.map(([i,channel,status,qty,price],j)=>({id:"sample-"+j,number:"예시-"+(10001+j),line:"",date:day(),sku:products[i].sku,name:products[i].name,status,channel,qty,price,cost:products[i].cost,fee:Math.round(price*qty*.1),shipping:2900,pack:350,discount:500,carrier:status==="발송완료"?"CJ대한통운":"",tracking:status==="발송완료"?"0000000000":""}))};
}
document.addEventListener("click",async event=>{
  const item=event.target.closest("[data-action]");
  if(!item)return;
  const excel=item.dataset.action.endsWith("-xlsx-file");
  const action=excel?item.dataset.action.slice(0,-10):item.dataset.action;
  const extension=excel?".xlsx":".csv";
  try{
    if((switching||busy)&&action!=="close")return;
    if(action==="share-work"){await shareWork();return;}
    if(action.startsWith("office-")){await officeAction(action.slice(7),item);return;}
    if(action==="all-dates"){rangeByPage[page()]={start:"",end:""};render();}
    if(action==="business-name")openBusinessName();
    if(action==="business-switch")await changeBusiness(item.dataset.business);
    if(action==="seller-login")openSellerLogin(item.dataset.channel);
    if(action==="delete-channel")deleteChannel(item.dataset.channel);
    if(action==="add-channel")addChannel();
    if(action==="market-retry"){marketLoaded=false;await loadMarkets();}
    if(action==="market-key")openMarketKey(item.dataset.market);
    if(action==="market-test"||action==="market-sync")await runMarket(item.dataset.market,action==="market-test"?"test":"sync",item);
    if(action==="order")openOrder(item.dataset.id);
    if(action==="match-order")matchOrder(item.dataset.id);
    if(action==="complete-selected")completeSelected();
    if(action==="print-rule-add")openPrintRule();
    if(action==="print-rule-edit")openPrintRule(Number(item.dataset.index));
    if(action==="print-rule-up")await movePrintRuleUp(Number(item.dataset.index));
    if(action==="print-rule-delete")removePrintRule(Number(item.dataset.index));
    if(action==="workflow-all"||action==="workflow-none"){
      $("content").querySelectorAll('[name="workflow-order"]').forEach(input=>input.checked=action==="workflow-all");
    }
    if(action==="purchase-entry")openPurchase(item.dataset.id);
    if(action==="statement-cancel"){statementOperation?.abort();$("statement-status").textContent="문서 읽기를 중지했습니다.";$("statement-cancel").hidden=true;}
    if(action==="statement-reset"){statementDraft=statementEmpty();render();}
    if(action==="statement-parse"){
      const text=$("statement-text").value;
      (statementDraft??=statementEmpty()).text=text;
      fillStatement(text,"붙여넣은 내용");
    }
    if(action==="statement-apply"){
      try{await applyStatement();}
      catch(error){$("statement-error").textContent=error.message;}
    }
    if(action==="production-entry")openProduction(item.dataset.id);
    if(action==="product")openProduct(item.dataset.id);
    if(action==="product-template")download("product-import-template.xlsx",[productColumns.map(([,label])=>label)]);
    if(action==="product-import")$("product-file").click();
    if(action==="show-product-costs")$("product-costs").focus();
    if(action==="cost-import")$("cost-file").click();
    if(action==="bulk-material-edit"||action==="bulk-material-delete")editBulkMaterial(item.dataset.name,action==="bulk-material-delete");
    if(action==="bulk-material-fill-date")await fillBulkPriceDates();
    if(action==="bulk-material-xlsx")download("벌크원물_"+day()+".xlsx",[bulkMaterialColumns,...activeBulkMaterials().map(bulkMaterialValues)]);
    if(action==="close")$("dialog").close();
    if(action==="retry")await load();
    if(action==="jump"){rangeByPage.orders={...dateRange("home")};filter={q:"",channel:"",status:item.dataset.status};}
    if(action==="import")$("file").click();
    if(action==="template")download("order-import-template"+extension,[csvFields.map(x=>x[1])]);
    if(action==="collect-all"||action==="collect-none"){
      $("content").querySelectorAll('[name="collect-market"]').forEach(input=>input.checked=action==="collect-all");
      collectionSelections.set(business,new Set(selectedCollectionChannels()));
    }
    if(action==="collect-one")await collectSelected([item.dataset.channel]);
    if(action==="collect-selected")await collectSelected(selectedCollectionChannels());
    if(action==="invoice-template")download("invoice-import-template"+extension,[["판매처","주문번호","주문상품번호","택배사","송장번호"]]);
    if(action==="import-invoices")$("invoices").click();
    if(action==="print-folder-pick"||action==="print-folder-clear")await changePrintFolder(action==="print-folder-clear",item);
    if(action==="export-orders"||action==="export-pick-list"){
      const ids=selectedWorkflowIds();
      const rows=filtered().filter(o=>ids.has(o.id));
      if(!rows.length){notify("내보낼 주문이 없습니다.");return;}
      if(action==="export-orders"){
        await exportPrintFile("orders-"+business+"-"+day()+extension,[csvFields.map(x=>x[1]).concat("판매금액","배송메모"),...rows.map(o=>csvFields.map(([k])=>k==="name"?printText(o.name,k):o[k]).concat(info(o).gross,printText(o.deliveryMemo,"deliveryMemo")))]);
      }else{
        const products=new Map();
        for(const o of rows){
          const product=store.products.find(p=>p.sku===o.sku);
          const name=product?.name||o.name;
          const key=JSON.stringify([o.sku,name]);
          products.set(key,(products.get(key)||0)+o.qty);
        }
        await exportPrintFile("pick-list-"+business+"-"+day()+extension,[["SKU","상품명","출고수량"],...[...products].map(([key,qty])=>[...JSON.parse(key),qty])]);
      }
    }
    if(action==="send-invoice"){
      const order=store.orders.find(o=>o.id===item.dataset.id);
      formDialog("네이버 송장 전송",'<p class="wide">상품주문 '+esc(order.line)+' · '+esc(order.carrier)+' · '+esc(order.tracking)+'</p>',async ()=>{
        if(busy||switching)throw Error("진행 중인 작업이 있습니다.");
        busy=true;renderBusiness();
        try{await marketCall({market:"naver",action:"dispatch",id:order.id,rev});await load();}
        finally{busy=false;renderBusiness();}
      },"네이버에 전송","송장을 전송했습니다.");
    }
    if(action==="stats-xlsx"){
      const form=$("stats-form");
      if(!applyStats(form))return;
      const f=statsFilter(),{rows}=dailySales(store.orders,f);
      render();
      if(!rows.length){notify("내려받을 판매 내역이 없습니다.");return;}
      download("일자별판매_"+names[business]+"_"+f.start+"_"+f.end+".xlsx",[[f.basis==="date"?"주문일자":"발송일자",...statsColumns.slice(1)],...rows]);
    }
    if(action==="invoice-channel"){
      filter.q="";
      filter.status="";
      filter.channel=item.dataset.channel;
      render();
      $("channel").focus();
    }
    if(action==="tracking"||action==="invoice-channel-csv"){
      const rows=action==="invoice-channel-csv"
        ?sorted(periodOrders("dispatch").filter(o=>hasActiveInvoice(o)&&o.channel===item.dataset.channel))
        :filtered().filter(o=>o.tracking);
      if(!rows.length){notify("선택한 목록에 등록된 송장번호가 없습니다.");return;}
      download("shipments-business-"+business+extension,[["판매처","주문번호","주문상품번호","택배사","송장번호","상태"],...rows.map(o=>[o.channel,o.number,o.line,o.carrier,o.tracking,o.status])]);
    }
    if(action==="demo"){
      const wasDemo=demo;
      if(!wasDemo)demoStores=makeDemoStores();
      let target="1";
      if(wasDemo)try{target=sessionStorage.getItem("market-business")==="2"?"2":"1";}catch{}
      switching=true;
      renderBusiness();
      demo=!wasDemo;
      marketLoaded=false;
      marketConnections={};
      marketError="";
      try{await load(target);location.hash=demo?"home":"setup";}
      catch(error){demo=wasDemo;throw error;}
      finally{switching=false;render();}
    }
  }catch(error){notify(error.message);}
});
$("content").addEventListener("submit",event=>{
  if(event.target.matches(".bulk-price-form")){
    event.preventDefault();
    if(!busy&&!switching)void updateBulkPrice(event.target).catch(error=>notify(error.message));
    return;
  }
  if(event.target.id==="standard-cost-form"){
    event.preventDefault();
    if(!busy&&!switching)void saveStandardCostInputs(event.target).catch(error=>notify(error.message));
    return;
  }
  if(event.target.id==="stats-form"){
    event.preventDefault();if(applyStats(event.target))render();return;
  }
  if(event.target.id!=="period-form")return;
  event.preventDefault();
  const range=readPeriod(event.target);
  if(range){rangeByPage[page()]=range;render();}
});
$("business").addEventListener("change",event=>{void changeBusiness(event.target.value);});
$("invoices").addEventListener("change",async event=>{
  const file=event.target.files[0];event.target.value="";
  if(file)try{await importInvoices(file);}catch(error){notify(error.message);}
});
$("cost-file").addEventListener("change",async event=>{
  const file=event.target.files[0];event.target.value="";
  if(file)try{await importCostWorkbook(file);}catch(error){notify(error.message);}
});
$("product-file").addEventListener("change",async event=>{
  const file=event.target.files[0];event.target.value="";
  if(file)try{await importProducts(file);}catch(error){notify(error.message);}
});
$("file").addEventListener("change",async event=>{
  const file=event.target.files[0];event.target.value="";
  if(file)try{await importOrders(file);}catch(error){notify(error.message);}
});
$("content").addEventListener("input",event=>{
  if(["estimate-price","estimate-tax"].includes(event.target.name)){
    const row=event.target.closest("tr"),input=row.querySelector('[name="estimate-price"]');
    const taxStatus=row.querySelector('[name="estimate-tax"]').value;
    const price=input.value!==""&&input.validity.valid?input.valueAsNumber:null;
    const {vat,total,profit,lowProfit}=estimateProductProfit(Number(input.dataset.unitCost),price,taxStatus);
    row.querySelector("[data-estimate-vat]").textContent=vat;
    row.querySelector("[data-estimate-total]").textContent=total;
    const profitOutput=row.querySelector("[data-estimate-profit]");
    profitOutput.textContent=profit;
    profitOutput.classList.toggle("danger",lowProfit);
    return;
  }
  const id=event.target.id;
  if(id==="print-preview-value"||event.target.name==="previewField"){
    const value=$("print-preview-value").value;
    const field=$("content").querySelector('[name="previewField"]').value;
    const result=$("print-preview-result");
    try{result.textContent=value?(printText(value,field)||"(빈 값)"):"변경 후 텍스트가 여기에 표시됩니다.";}
    catch(error){result.textContent=error.message;}
    return;
  }
  if(id==="queue-search"){const q=event.target.value.trim().toLowerCase();$("queue-result").innerHTML=orderTable(sorted(periodOrders(page()).filter(queues[page()][1]).filter(o=>[o.number,o.name,o.channel,o.tracking,o.sku,o.deliveryMemo].some(v=>String(v||"").toLowerCase().includes(q)))),true);return;}
  const field={query:"q",channel:"channel",status:"status"}[id];
  if(field){filter[field]=event.target.value;$("result").innerHTML=orderTable(filtered(),["ship","dispatch"].includes(page()));}
});
$("content").addEventListener("change",event=>{
  const input=event.target,form=input.form;
  if(input.id==="product-ranking-metric"){
    productRankingMetric=input.value;
    const orders=periodOrders("home").filter(order=>!["취소","반품"].includes(order.status));
    $("product-ranking-chart").innerHTML=productSalesRanking(orders);
    return;
  }
  if(input.name==="collect-market")collectionSelections.set(business,new Set(selectedCollectionChannels()));
  if(form?.id!=="stats-form")return;
  if(input.id==="stats-all"){for(const box of form.querySelectorAll('[name="market"]'))box.checked=input.checked;}
  if(input.name==="market")form.querySelector("#stats-all").checked=[...form.querySelectorAll('[name="market"]')].every(box=>box.checked);
  if(input.name==="preset"){
    if(input.value==="지정"){form.elements.start.focus();return;}
    const range=statsPeriod(input.value);form.elements.start.value=range.start;form.elements.end.value=range.end;
  }
  if(["start","end"].includes(input.name))form.elements.preset.value="지정";
});
window.addEventListener("hashchange",()=>{
  if(page()!=="orders")filter={q:"",channel:"",status:""};
  render();
  window.scrollTo(0,0);
});
function makeDemoStores(){
  return {"1":{...demoData(),businessName:"샘플 판매처 1"},"2":{orders:[],products:[],businessName:"샘플 판매처 2"}};
}
const officeGroups = [
  ["설정", [["collectionSetup","주문수집 열설정"],["setup","판매처 관리"],["carriers","택배사 관리"],["profile","내정보 관리"],["preferences","환경설정"],["printFolder","폴더 설정"]]],
  ["상품업무", [["stock","상품관리"],["costSheet","원물·레시피 원가"],["matches","매칭규칙관리"],["deduct","재고차감"],["restore","재고차감 취소"]]],
  ["배송업무", [["?order","신규 주문송장 만들기"],["orders","통합 주문"],["collect","주문수집"],["results","수집 결과확인"],["bundles","묶음누락 점검"],["notes","배송메모 점검"],["matching","상품매칭"],["searchOrders","찾아 바꾸기"],["export","인쇄파일 내보내기"],["invoices","송장번호 가져오기"],["cancelled","취소주문체크"],["shippingWork","발송처리"],["dispatch","송장번호 전송"]]],
  ["송장목록", [["ship","전체송장 목록"],["waitingPrint","인쇄대기 목록"],["waitingShip","발송대기 목록"],["completed","발송완료 목록"],["voidInvoices","취소송장 목록"],["returned","반품송장 목록"],["exchanged","교환송장 목록"]]],
  ["C/S업무", [["support","C/S목록"],["returned","반품관리"],["customers","고객관리"]]],
  ["사입업무", [["purchaseStatement","매입관리 (거래명세서 입고)"],["purchases","사입 목록"],["bulkMaterials","벌크 원물 목록"],["suppliers","사입처 관리"]]],
  ["통계", [["statistics","일자별 판매 현황"],["dailyFreight","일자별 배송비 현황"],["marketSales","판매처별 매출 현황"],["skuSales","상품별 매출 현황"],["marketSkuSales","판매처별 상품매출 현황"],["profit","판매 손익"]]],
  ["도구", [["home","시작페이지"],["privacy","개인정보 폐기"],["?clear-export","엑셀 캐시 삭제"],["invoiceSearch","송장 검색"]]],
  ["마켓관리자", [["marketAdmin","판매자센터 바로가기"],["setup","판매처 연결 관리"]]],
  ["창", [["?sidebar","좌측메뉴 보이기"],["?workspace-layout-stacked","계단식배열"],["?workspace-layout-vertical","수직 배열"],["?workspace-layout-horizontal","수평 배열"],["?workspace-close","모든창 닫기"]]],
  ["도움말", [["home","홈페이지"],["guide","사용설명서"],["?support","내부 문의 기록"],["about","마켓데스크 정보"]]]
];
const officeLabels = Object.fromEntries(officeGroups.flatMap(([, rows]) => rows));
const collectionColumns = ["판매처","상품","상태","택배사·송장번호"];
const officeOrderViews = {
  voidInvoices: o=>o.status==="취소",
  returned: o=>o.status==="반품",
  exchanged: o=>!!o.exchanged,
  invoiceSearch: o=>!!o.tracking,
  deduct: o=>!!o.sku&&!usesStock(o)&&!["취소","반품"].includes(o.status),
  restore: usesStock
};
const officeRecordFields = {
  carriers: ["택배사명","택배사 코드","메모"],
  suppliers: ["사입처명","연락처","메모"],
  matches: ["판매처 상품코드","관리 상품 SKU","메모"],
  support: ["주문번호","처리 상태","문의·처리 내용"],
  recipes: ["제품명","재료·배합","작업 방법"]
};
const officeReports = {
  dailyFreight: ["일자",o=>[o.date]],
  marketSales: ["판매처",o=>[o.channel]],
  skuSales: ["SKU·상품명",o=>[officeProductLabel(o)]],
  marketSkuSales: ["판매처 · SKU·상품명",o=>[o.channel,officeProductLabel(o)]]
};
const openOfficePages = new Set();
let workspaceLayout = "";
let compactSidebar = false;
try {compactSidebar=sessionStorage.getItem("office-sidebar")==="hidden";} catch {}

function renderOfficeMenu(current) {
  document.querySelector(".shell").classList.toggle("compact-sidebar",compactSidebar);
  openOfficePages.add(current);
  const workflowGroups=taskGroups.map(([label,ids,status])=>[label,[...ids,status].map(id=>[id,tasks[id][0]])]);
  const groups = [...workflowGroups,...officeGroups].map(([label, rows]) => {
    const entries = label==="창" ? [...rows,...[...openOfficePages].map(id=>[id,officeLabels[id]||tabs[id]?.[0]||tasks[id]?.[0]])] : rows;
    return '<details><summary'+(entries.some(([id])=>id===current)?' class="active"':'')+'>'+label+'</summary><div class="office-dropdown">'+
      entries.map(([id,name])=>id.startsWith("?")
        ? btn(esc(name),id==="?order"?"order":"office-"+id.slice(1))
        : '<a href="#'+id+'"'+(id===current?' aria-current="page" class="active"':'')+'>'+esc(name)+'</a>').join("")+'</div></details>';
  });
  const [overviewId,overviewLabel]=taskOverview;
  const primaryLinks=[[overviewId,overviewLabel],...["salesManagement","purchaseOrders","production","recipes"].map(id=>[id,tabs[id][0]])];
  $("nav").innerHTML=primaryLinks.map(([id,label])=>
    '<a href="#'+id+'"'+(id===current?' aria-current="page" class="active"':'')+'>'+esc(label)+'</a>'
  ).join("")+groups.join("");
}
function officeRows(type) {
  return (store.officeRecords||[]).filter(row=>row.type===type);
}
function officeTable(labels, rows) {
  return '<div class="table-wrap"><table><thead><tr>'+th(labels)+'</tr></thead><tbody>'+
    (rows.length?rows.map(cells=>'<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join("")+'</tr>').join("")
      : '<tr><td class="empty" colspan="'+labels.length+'">표시할 내역이 없습니다.</td></tr>')+'</tbody></table></div>';
}
function officePanel(title, body, actions="") {
  return '<section class="panel">'+panelHead(title,actions)+body+'</section>';
}
function officeLink(id,label) {
  return '<a class="button" href="#'+id+'">'+esc(label)+'</a>';
}
function officeHeading(title, actions="") {
  return '<div class="hero"><h1>'+title+'</h1><div class="buttons">'+actions+'</div></div>';
}
function officeOrderRows(id, query="") {
  const q=query.trim().toLowerCase();
  return sorted(periodOrders(id).filter(officeOrderViews[id]).filter(o=>[o.number,o.line,o.tracking,o.channel,o.name,o.sku].some(value=>String(value||"").toLowerCase().includes(q))));
}
function officeOrderView(id) {
  const title=id==="returned"?"반품관리 · 반품송장 목록":officeLabels[id];
  const stockWork=id==="deduct"||id==="restore";
  const actions=stockWork?btn("선택 주문 "+title,"office-stock",true):id==="returned"?officeLink("orders","통합 주문"):"";
  return officeHeading(title,actions)+rangeControl(id)+officePanel(title,
    '<div class="filters"><input type="search" id="office-order-query" aria-label="주문·송장 검색" placeholder="주문번호, 송장번호 또는 상품"></div>'+
    '<div id="office-order-results">'+orderTable(officeOrderRows(id),true)+'</div>',stockWork?selectionActions():"");
}
function officeRecordsView(type) {
  const labels=officeRecordFields[type];
  const title=officeLabels[type]||tabs[type][0];
  const recipe=type==="recipes";
  const cells=value=>recipe?'<div class="recipe-text">'+esc(value)+'</div>':esc(value);
  const rows=officeRows(type).map(row=>[
    esc(row.name),cells(row.detail),cells(row.note),
    '<button class="short" data-action="office-edit" data-type="'+type+'" data-id="'+esc(row.id)+'">수정</button> '+
    '<button class="short danger" data-action="office-remove" data-type="'+type+'" data-id="'+esc(row.id)+'">삭제</button>'
  ]);
  const actions='<button type="button" class="primary" data-action="office-edit" data-type="'+type+'">'+(recipe?"레시피 등록":"등록")+'</button>'+
    (type==="matches"?btn("미매칭 주문에 규칙 적용","office-apply-matches"):"");
  return officeHeading(title,actions)+officePanel(title,officeTable([...labels,"작업"],rows));
}
function editOfficeRecord(type,id) {
  const row=officeRows(type).find(item=>item.id===id);
  const [nameLabel,detailLabel,noteLabel]=officeRecordFields[type];
  const recipe=type==="recipes";
  const recipeField=(label,name,value="")=>'<label class="wide">'+label+
    '<textarea name="'+name+'" rows="5" maxlength="2000" required>'+esc(value)+'</textarea></label>';
  const detail=recipe?recipeField(detailLabel,"detail",row?.detail)
    : type==="matches"?select(detailLabel,"detail",[["","상품 선택"],...store.products.map(p=>[p.sku,p.name+" ("+p.sku+")"])],row?.detail)
    : type==="support"?select(detailLabel,"detail",["접수","처리중","완료"],row?.detail)
    : field(detailLabel,"detail",row?.detail);
  const note=recipe?recipeField(noteLabel,"note",row?.note):field(noteLabel,"note",row?.note,false,0,type==="support");
  const stockFields=recipe?select("원물 차감 기준 단위","recipeUnit",productionUnits,row?.unit||"봉")+
    '<label class="wide">원물 차감 기준 (g)<textarea name="recipeMaterials" rows="4" maxlength="4000">'+
    esc((row?.materials||[]).map(item=>item.name+" | "+item.grams).join("\n"))+'</textarea></label>':"";
  formDialog(recipe?(row?"레시피 수정":"레시피 등록"):(row?"기록 수정":"기록 등록"),
    field(nameLabel,"name",row?.name,false,0,true)+detail+note+stockFields,async values=>{
      const record={id:row?.id||crypto.randomUUID(),type,name:values.name.trim(),detail:values.detail.trim(),note:values.note.trim()};
      if(!record.name||(recipe&&(!record.detail||!record.note))||(type==="support"&&!record.note))throw Error("필수 항목을 입력해 주세요.");
      if(recipe&&values.recipeMaterials.trim()){
        const lines=values.recipeMaterials.split(/\r?\n/).filter(line=>line.trim());
        const materials=lines.map(line=>{
          const fields=line.split("|");
          if(fields.length!==2)throw Error("원물 차감 기준은 ‘사입 품목명 | 사용량(g)’ 형식으로 입력해 주세요.");
          const name=rawStockKey(fields[0]), amount=fields[1].trim();
          const grams=Number(amount);
          if(!name||name.length>120||!/^\d+(?:\.\d{1,3})?$/.test(amount)||grams<=0||grams>1000000){
            throw Error("원물 품목명과 사용량(g, 소수점 세 자리까지)을 확인해 주세요.");
          }
          return {name,grams};
        });
        if(materials.length>20||new Set(materials.map(item=>item.name)).size!==materials.length){
          throw Error("원물은 중복 없이 최대 20가지까지 입력할 수 있습니다.");
        }
        record.unit=values.recipeUnit;
        record.materials=materials;
      }
      if(type==="support"&&!store.orders.some(o=>o.number===record.name))throw Error("통합 주문에 등록된 주문번호를 입력해 주세요.");
      if(type==="matches"&&!store.products.some(p=>p.sku===record.detail))throw Error("관리 상품을 선택해 주세요.");
      if(type!=="support"&&officeRows(type).some(item=>item.id!==id&&item.name===record.name))throw Error("이미 등록되어 있습니다.");
      await commit({...store,officeRecords:[...(store.officeRecords||[]).filter(item=>item.id!==id),record]});
    });
}
function officeProductLabel(o) {
  const product=store.products.find(p=>p.sku===o.sku);
  return o.sku ? o.sku+" · "+(product?.name||o.name) : o.name;
}
function officeReport(id) {
  const [groupLabel,group]=officeReports[id];
  const dateReport=id==="dailyFreight";
  const labels=groupLabel.split(" · ").concat(dateReport?["주문 수","구매자 결제 배송비","배송비 합계","차액"]:["주문 수","판매 수량","판매금액"]);
  const groups=new Map();
  for(const o of periodOrders(id).filter(o=>!["취소","반품"].includes(o.status))) {
    const parts=group(o),key=JSON.stringify(parts);
    if(!groups.has(key))groups.set(key,{parts,orders:new Set(),qty:0,gross:0,expense:0,paid:0});
    const row=groups.get(key);
    row.orders.add(JSON.stringify([o.channel,o.number]));
    row.qty+=o.qty;
    row.gross+=info(o).gross;
    row.expense+=o.shipping;
    row.paid+=o.shippingPaid||0;
  }
  const rows=[...groups.values()].sort((a,b)=>a.parts.join(" ").localeCompare(b.parts.join(" "),"ko")).map(row=>
    [...row.parts,row.orders.size,...(dateReport?[row.paid,row.expense,row.paid-row.expense]:[row.qty,row.gross])]);
  return {labels,rows};
}
function officeReportView(id) {
  const {labels,rows}=officeReport(id);
  return officeHeading(officeLabels[id],btn("엑셀 다운로드","office-download",true))+rangeControl(id)+
    officePanel(officeLabels[id],officeTable(labels,rows.map(row=>row.map(cell=>typeof cell==="number"?fmt.format(cell):esc(cell)))));
}
const sellerSites = {
  "쿠팡":"https://wing.coupang.com/","네이버":"https://sell.smartstore.naver.com/",
  "11번가":"https://soffice.11st.co.kr/","옥션":"https://www.esmplus.com/","지마켓":"https://www.esmplus.com/"
};
const costName=value=>String(value??"").trim().normalize("NFC").replace(/\s/g,"");
function parseCostSheet(source, raw, mix, products){
  const numeric=value=>value!==""&&value!==undefined&&Number.isFinite(Number(value));
  if(!raw.some(row=>row[1]==="품목"&&row[4]==="도매가")||
    !products.some(row=>row[2]==="코드"&&row[4]==="더팜스"))throw Error("원물원가·전체상품 시트의 열 이름을 확인해 주세요.");
  const materials=raw.filter(row=>["과세","면세"].includes(row[2])&&numeric(row[3])&&numeric(row[4]))
    .map(row=>({name:costName(row[1]),tax:row[2],boxKg:Number(row[3]),price:Number(row[4])}));
  const materialNames=new Set(materials.map(item=>item.name));
  const aliases={"구운캐슈넛":"구운캐슈너트","스톤초코락":"스톤초코볼","해바라기씨":"해바라기씨(불가리아)","땅콩분태":"볶음땅콩분태"};
  const recipes=[];
  let recipe;
  for(const row of mix){
    if(numeric(row[1])&&row[2]&&numeric(row[6])){
      recipe={name:costName(row[2]),grams:Number(row[6]),lines:[],offers:[]};
      recipes.push(recipe);
    }
    if(!recipe)continue;
    if(row[2]&&[row[3],row[4],row[5],row[6]].every(numeric)){
      const rawName=costName(row[2]), name=aliases[rawName]||rawName;
      if(!materialNames.has(name))throw Error("믹스넛제품 "+row.sheetRow+"행 원물 '"+rawName+"'의 단가를 찾을 수 없습니다.");
      recipe.lines.push({name,grams:Number(row[5])});
    }
    const offer=/[xX](\d+)$/.exec(row[30]||"");
    if(offer&&row.slice(31,36).length===5&&row.slice(31,36).every(numeric)){
      const [sale,cost,fee,vat,production]=row.slice(31,36).map(Number);
      recipe.offers.push({name:row[30],packs:Number(offer[1]),sale,cost,fee,vat,production});
    }
  }
  for(const row of recipes){
    if(!row.lines.length||Math.abs(row.lines.reduce((sum,line)=>sum+line.grams,0)-row.grams)>0.00001){
      throw Error(row.name+"의 표시 중량과 원물 배합 합계가 다릅니다.");
    }
  }
  const catalog=products.filter(row=>row[2]&&row[4]&&row[2]!=="코드").map(row=>{
    const name=row[4].trim(), normalized=costName(name);
    const weights=[...normalized.matchAll(/(\d+(?:\.\d+)?)(kg|g)/gi)];
    const grams=weights.reduce((total,[,value,unit])=>total+Number(value)*(unit.toLowerCase()==="kg"?1000:1),0);
    const item=normalized.replace(/^(?:더팜스|그린마켓|오메가넛츠|에브리데이넛츠)/,"").split(/\d/)[0];
    const blend=item==="씨드믹스"?"씨앗믹스":item;
    const recipe=recipes.some(row=>row.name===blend)?blend:"";
    const single=({생아몬드:"아몬드",볶음알땅콩:"볶음땅콩"})[item]||aliases[item]||item;
    const material=!recipe&&materialNames.has(single)?single:"";
    return {sku:row[2].trim(),name,grams,recipe,material};
  });
  if(!materials.length||!recipes.length||!catalog.length||catalog.some(row=>!row.grams))throw Error("원물·레시피·상품 중량 자료를 확인해 주세요.");
  return {source,materials,recipes,catalog};
}
function costSheetModel(sheet){
  const prices=new Map(sheet.materials.map(row=>[row.name,row.price]));
  const recipeCosts=new Map(sheet.recipes.map(row=>[row.name,row.lines.reduce((sum,line)=>sum+prices.get(line.name)*line.grams/1000,0)]));
  const recipes=new Map(sheet.recipes.map(row=>[row.name,row]));
  const products=new Map();
  const catalog=sheet.catalog.map(row=>{
    const cost=row.recipe?recipeCosts.get(row.recipe)*row.grams/recipes.get(row.recipe).grams:
      row.material?prices.get(row.material)*row.grams/1000:null;
    const entry={...row,cost};
    if(!products.has(row.sku))products.set(row.sku,[]);
    products.get(row.sku).push(entry);
    return entry;
  });
  return {prices,recipeCosts,products,catalog};
}
function catalogProductMatches(product,products){
  const rows=products.get(product.sku)||[];
  return rows.length===1?rows:rows.filter(row=>costName(row.name)===costName(product.name));
}
function catalogProductCost(product,products){
  const candidates=catalogProductMatches(product,products);
  const costs=new Set(candidates.map(row=>row.cost===null?null:Math.round(row.cost)));
  return costs.size===1?[...costs][0]:null;
}
function planCostImport(source,sheet){
  const {products}=costSheetModel(sheet);
  const existing=new Set(source.products.map(p=>p.sku));
  let updated=0,added=0;
  const nextProducts=source.products.map(product=>{
    const cost=catalogProductCost(product,products);
    if(cost===null||product.cost===cost)return product;
    updated++;
    return {...product,cost};
  });
  for(const [sku,rows] of products){
    if(existing.has(sku)||rows.length!==1||rows[0].cost===null)continue;
    nextProducts.push({sku,name:rows[0].name,cost:Math.round(rows[0].cost),units:0,limit:0});
    added++;
  }
  const records=source.officeRecords||[];
  const knownRecipes=new Set(records.filter(row=>row.type==="recipes").map(row=>costName(row.name)));
  const nextRecipes=sheet.recipes.filter(row=>!knownRecipes.has(row.name)).map(row=>({
    id:crypto.randomUUID(),type:"recipes",name:row.name,unit:"봉",
    detail:row.lines.map(line=>line.name+" "+line.grams+"g").join(" · "),
    note:sheet.source+" · "+row.grams+"g 기준",
    materials:row.lines
  }));
  return {data:{...source,costSheet:sheet,products:nextProducts,officeRecords:[...records,...nextRecipes]},
    updated,added,recipes:nextRecipes.length};
}
async function importCostWorkbook(file){
  if(!/\.xlsx$/i.test(file.name)||file.size>8000000)throw Error("8MB 이하의 원가시트(.xlsx)를 선택해 주세요.");
  const source=store,target=business;
  const bytes=await file.arrayBuffer();
  const sheets=await Promise.all(["원물원가","믹스넛제품","전체상품"].map(name=>readWorkbook(bytes,name)));
  if(switching||store!==source||business!==target)throw Error("사업자 자료가 바뀌었습니다. 파일을 다시 선택해 주세요.");
  const sheet=parseCostSheet(file.name,...sheets);
  const previousMaterials=new Map((source.costSheet?.materials||[]).map(item=>[item.name,item]));
  for(const material of sheet.materials){
    const previous=previousMaterials.get(material.name);
    if(!previous)continue;
    if(previous.archived)material.archived=true;
    const date=previous.price===material.price?previous.priceUpdatedOn:day();
    if(date)material.priceUpdatedOn=date;
  }
  const plan=planCostImport(source,sheet);
  if(plan.data.products.length>3000)throw Error("사업자당 상품은 최대 3,000개까지 등록할 수 있습니다.");
  formDialog("원가시트 적용",'<p class="wide">'+sheet.materials.length+'개 원물 · '+sheet.recipes.length+
    '개 레시피 · 카탈로그 '+sheet.catalog.length+'행</p><p class="wide">상품 '+plan.added+'개 등록 (기준재고 0), '+plan.updated+
    '개 원가 수정, 레시피 '+plan.recipes+'개 등록</p><p class="wide muted">중복 코드의 신규 상품, 배합 미연결 상품과 기존 주문의 원가는 그대로 둡니다.</p>',
    async ()=>{
      if(store!==source||business!==target)throw Error("사업자 자료가 바뀌었습니다. 파일을 다시 선택해 주세요.");
      await commit(plan.data);
    },"현재 사업자에 적용","원가시트를 적용했습니다.");
}
function costSheetView(){
  const sheet=store.costSheet;
  const heading=officeHeading("원물·레시피 원가",btn("원가시트 (.xlsx) 가져오기","cost-import",true)+officeLink("recipes","제품 레시피")+officeLink("profit","판매 손익"));
  if(!sheet)return heading+'<div class="note">원물원가, 믹스넛제품, 전체상품 시트가 들어 있는 엑셀 파일을 선택하세요.</div>';
  const {prices,recipeCosts,products,catalog}=costSheetModel(sheet);
  const price=value=>fmt.format(Math.round(value))+"원";
  const percent=(part,total)=>total?(100*part/total).toFixed(1)+"%":"—";
  return heading+'<p class="note">'+esc(sheet.source)+' · 원물 단가(원/kg) × 배합 중량(g) ÷ 1,000. 판매 시나리오의 원본 원가는 비교용입니다.</p>'+
    officePanel("원물 기준정보",officeTable(["원물명","과세 여부","박스 kg","도매가 / kg"],sheet.materials.map(row=>[esc(row.name),esc(row.tax),fmt.format(row.boxKg),price(row.price)])))+
    officePanel("제품 레시피",officeTable(["제품명","기준 중량","배합","계산 원물비"],sheet.recipes.map(row=>[
      esc(row.name),fmt.format(row.grams)+"g",esc(row.lines.map(line=>line.name+" "+fmt.format(line.grams)+"g ("+percent(line.grams,row.grams)+")").join(" · ")),
      price(recipeCosts.get(row.name))
    ])))+
    officePanel("판매 시나리오 원가율",officeTable(["옵션","판매가","원본 원가","계산 원물비","원물 원가율","판매수수료","부가세","생산비"],
      sheet.recipes.flatMap(row=>row.offers.map(offer=>{
        const cost=recipeCosts.get(row.name)*offer.packs;
        return [esc(offer.name),price(offer.sale),price(offer.cost),price(cost),percent(cost,offer.sale),price(offer.fee),price(offer.vat),price(offer.production)];
      }))))+
    officePanel("카탈로그 단위원가",officeTable(["SKU","상품명","중량","계산 원물비","연결 확인"],catalog.map(row=>[
      esc(row.sku),esc(row.name),fmt.format(row.grams)+"g",row.cost===null?"—":price(row.cost),
      [products.get(row.sku).length>1?"중복 코드":"",row.cost===null?"배합 확인 필요":""].filter(Boolean).join(" · ")||"—"
    ])));
}
const bulkMaterialColumns=["원물명","과세 여부","박스 중량(kg)","도매가(원/kg, 부가세 제외)","가격 변경일 (KST)"];
const bulkMaterialValues=item=>[item.name,item.tax,item.boxKg,item.price,item.priceUpdatedOn??""];
function activeBulkMaterials(){
  return (store.costSheet?.materials||[]).filter(item=>!item.archived);
}
async function fillBulkPriceDates(){
  const costSheet=store.costSheet;
  const missing=activeBulkMaterials().filter(item=>!item.priceUpdatedOn).length;
  if(!missing)return;
  const priceUpdatedOn=day();
  const materials=costSheet.materials.map(item=>item.archived||item.priceUpdatedOn?item:{...item,priceUpdatedOn});
  await commit({...store,costSheet:{...costSheet,materials}});
  notify(missing+"개 원물의 가격 변경일을 "+priceUpdatedOn+"로 기록했습니다.");
}
function bulkMaterialsView(){
  const materials=activeBulkMaterials();
  return officeHeading("벌크 원물 목록",officeLink("purchases","사입 목록")+
    (materials.some(item=>!item.priceUpdatedOn)?btn("빈 변경일 오늘로 입력","bulk-material-fill-date"):"")+
    (materials.length?btn("엑셀 다운로드","bulk-material-xlsx"):""))+
    officePanel("벌크 원물 · "+fmt.format(materials.length)+"개",officeTable([...bulkMaterialColumns,"가격 업데이트","작업"],materials.map(item=>{
      const name=esc(item.name);
      return [name,esc(item.tax),fmt.format(item.boxKg),won(item.price),esc(item.priceUpdatedOn??"—"),
        '<form class="bulk-price-form" data-material="'+name+'"><input type="number" name="price" min="0" max="1000000000" step="1" required inputmode="numeric" placeholder="새 도매가" aria-label="'+name+' 새 도매가 (원/kg)">'+
        '<button class="short" type="submit">업데이트</button></form>',
        '<button class="short" data-action="bulk-material-edit" data-name="'+name+'">수정</button> '+
        '<button class="short danger" data-action="bulk-material-delete" data-name="'+name+'">삭제</button>'];
    })));
}
async function saveBulkMaterial(source,target,item,replacement){
  if(store!==source||business!==target)throw Error("사업자 자료가 바뀌었습니다. 목록을 다시 열어 주세요.");
  const sheet=source.costSheet;
  const priceChanged=replacement.price!==item.price;
  const material=priceChanged?{...replacement,priceUpdatedOn:day()}:replacement;
  const costSheet={...sheet,materials:sheet.materials.map(row=>row===item?material:row)};
  let products=source.products;
  if(priceChanged){
    const previousCatalog=costSheetModel(sheet).products;
    const nextCatalog=costSheetModel(costSheet).products;
    products=source.products.map(product=>{
      const before=catalogProductCost(product,previousCatalog);
      const after=catalogProductCost(product,nextCatalog);
      return before!==null&&after!==null&&before!==after&&after!==product.cost
        ?{...product,cost:after}:product;
    });
  }
  await commit({...source,costSheet,products});
}
async function updateBulkPrice(form){
  const item=activeBulkMaterials().find(row=>row.name===form.dataset.material);
  if(!item)throw Error("원물 목록을 다시 열어 주세요.");
  const price=form.elements.price.valueAsNumber;
  if(!Number.isInteger(price)||price<0||price>1e9)throw Error("도매가는 0~1,000,000,000원 사이의 정수로 입력해 주세요.");
  if(price===item.price){notify("현재 도매가와 같습니다.");return;}
  await saveBulkMaterial(store,business,item,{...item,price});
  notify("도매가와 변경일을 저장했습니다.");
}
function editBulkMaterial(name,remove){
  const item=activeBulkMaterials().find(row=>row.name===name);
  if(!item)return;
  const source=store,target=business,sheet=source.costSheet;
  const save=replacement=>saveBulkMaterial(source,target,item,replacement);
  if(remove){
    formDialog("벌크 원물 삭제",'<p class="wide">'+esc(name)+'을(를) 벌크 원물 목록과 사입 등록의 품목 후보에서 제외합니다. 기존 사입·레시피 기록은 유지됩니다.</p>',
      ()=>save({...item,archived:true}),"삭제","벌크 원물 목록에서 삭제했습니다.");
    return;
  }
  const refersToItem=materials=>materials?.some(row=>costName(row.name)===costName(name));
  const nameInUse=sheet.recipes.some(row=>refersToItem(row.lines))||sheet.catalog.some(row=>row.material===name)||
    source.officeRecords?.some(row=>row.type==="recipes"&&refersToItem(row.materials))||
    source.purchases?.some(row=>costName(row.name)===costName(name))||
    source.production?.some(row=>refersToItem(row.recipe?.materials));
  const form=formDialog("벌크 원물 수정",field("원물명","name",name,false,0,true)+
    select("과세 여부","tax",["과세","면세"],item.tax)+
    '<label>박스 중량 (kg)<input type="number" name="boxKg" min="0.001" max="1000000" step="0.001" required value="'+item.boxKg+'"></label>'+
    field("도매가 (원/kg, 부가세 제외)","price",item.price,true,0,true)+
    '<p class="wide muted">도매가를 저장하면 연결된 상품의 등록 단위원가와 예상 순익이 다시 계산됩니다.</p>'+
    (nameInUse?'<p class="wide muted">기존 기록에 연결된 원물은 이름으로 연결을 유지합니다.</p>':""),
    async values=>{
      const nextName=nameInUse?name:costName(values.name);
      const boxKg=Number(values.boxKg),price=Number(values.price);
      if(!nextName||sheet.materials.some(row=>row!==item&&costName(row.name)===nextName))throw Error("원물명이 비어 있거나 중복됩니다.");
      if(!Number.isFinite(boxKg)||boxKg<=0||!Number.isInteger(price)||price<0)throw Error("박스 중량과 도매가를 확인해 주세요.");
      await save({...item,name:nextName,tax:values.tax,boxKg,price});
    });
  form.elements.name.readOnly=!!nameInUse;
}
const officeViews = {
  purchaseStatement,
  bulkMaterials:bulkMaterialsView,
  costSheet:costSheetView,
  salesManagement:()=>officeHeading(tabs.salesManagement[0])+
    officePanel("매출 조회",'<div class="buttons">'+officeLink("statistics","일자별 판매 현황")+
      officeLink("marketSales","판매처별 매출 현황")+officeLink("skuSales","상품별 매출 현황")+
      officeLink("marketSkuSales","판매처별 상품매출 현황")+officeLink("profit","판매 손익")+'</div>'),
  purchaseOrders:()=>officeHeading(tabs.purchaseOrders[0])+
    officePanel("발주 준비",'<div class="buttons">'+officeLink("stock","상품·재고 확인")+
      officeLink("suppliers","사입처 관리")+officeLink("purchases","사입 목록")+'</div>'),

  ...Object.fromEntries(Object.keys(officeOrderViews).map(id=>[id,()=>officeOrderView(id)])),
  ...Object.fromEntries(Object.keys(officeRecordFields).map(id=>[id,()=>officeRecordsView(id)])),
  ...Object.fromEntries(Object.keys(officeReports).map(id=>[id,()=>officeReportView(id)])),
  printFolder:()=>head("폴더 설정","인쇄파일과 상품집계표를 저장할 폴더를 사업자별로 지정합니다.",officeLink("export","인쇄파일 내보내기"))+
    '<div id="print-folder" class="panel" aria-live="polite"></div>',
  collectionSetup:()=>officeHeading("주문수집 열설정",btn("표시 열 변경","office-columns",true))+
    officePanel("수집 결과에 표시할 열",officeTable(["열 이름"],(store.collectionColumns||collectionColumns).map(label=>[esc(label)])),officeLink("results","수집 결과확인")),
  profile:()=>officeHeading("내정보 관리",btn("사업자명 수정","business-name",true))+
    officePanel("현재 사업자",officeTable(["사업자명"],[[esc(names[business])]])),
  preferences:()=>officeHeading("환경설정",btn("좌측 메뉴 표시 전환","office-sidebar"))+
    officePanel("화면 설정",officeTable(["설정","값"],[["좌측 메뉴",compactSidebar?"숨김":"표시"]])),
  marketAdmin:()=>officeHeading("마켓관리자",officeLink("setup","판매처 연결 관리"))+
    officePanel("현재 사업자의 판매처",officeTable(["판매처","판매자센터"],businessChannels().map(channel=>[
      esc(channel),Object.hasOwn(sellerSites,channel)?'<a class="button" href="'+esc(sellerSites[channel])+'" target="_blank" rel="noopener noreferrer">판매자센터 열기</a>':officeLink("setup","연결 설정")
    ]))),
  customers:()=>{
    const customers=new Map();
    for(const o of store.orders) {
      if(!o.customer)continue;
      const orders=customers.get(o.customer)||new Set();
      orders.add(JSON.stringify([o.channel,o.number]));
      customers.set(o.customer,orders);
    }
    return officeHeading("고객관리",officeLink("orders","통합 주문"))+
      officePanel("주문에 등록한 고객명",officeTable(["고객명","주문 수"],[...customers].map(([name,orders])=>[esc(name),fmt.format(orders.size)])));
  },
  privacy:()=>officeHeading("개인정보 폐기",btn("배송 완료 기록의 개인정보 폐기","office-privacy"))+
    '<div class="note">종료일을 지정해 발송완료·취소·반품 주문의 고객명과 배송메모를 폐기하고 주문·정산 자료를 보관합니다.</div>',
  guide:()=>officeHeading("사용설명서")+
    officePanel("주문 처리",'<div class="settings">'+officeLink("collect","1. 판매처 주문 수집")+officeLink("export","2. 인쇄파일 내보내기")+officeLink("invoices","3. 송장번호 가져오기")+officeLink("shippingWork","4. 발송처리")+officeLink("dispatch","5. 송장번호 전송")+'</div>')+
    officePanel("운영 관리",'<div class="settings">'+officeLink("stock","상품과 재고 관리")+officeLink("purchases","사입 기록")+officeLink("statistics","통계 조회와 엑셀 다운로드")+'</div>'),
  about:()=>officeHeading("마켓데스크 정보")+
    '<div class="note">마켓데스크는 사업자별 주문·배송·재고·사입·판매 통계를 관리하는 웹 도구입니다.</div>'
};
async function officeAction(action,item) {
  if(action==="edit")return editOfficeRecord(item.dataset.type,item.dataset.id);
  if(action==="remove"){
    const id=item.dataset.id;
    const row=officeRows(item.dataset.type).find(entry=>entry.id===id);
    if(row)formDialog("기록 삭제",'<p class="wide">'+esc(row.name)+' 기록을 삭제합니다.</p>',
      ()=>commit({...store,officeRecords:store.officeRecords.filter(entry=>entry.id!==id)}),"삭제","기록을 삭제했습니다.");
    return;
  }
  if(action==="apply-matches"){
    const rules=new Map(officeRows("matches").map(row=>[row.name,row.detail]));
    const products=new Map(store.products.map(product=>[product.sku,product]));
    const orders=store.orders.map(o=>{
      const product=!o.sku&&products.get(rules.get(o.marketSku));
      return product?{...o,sku:product.sku,cost:product.cost}:o;
    });
    const count=orders.filter((o,i)=>o!==store.orders[i]).length;
    if(!count)return notify("적용할 미매칭 주문이 없습니다.");
    await commit({...store,orders});
    notify(count+"건에 상품을 연결했습니다.");
    return;
  }
  if(action==="stock"){
    const id=page(),ids=selectedWorkflowIds();
    const eligible=o=>ids.has(o.id)&&officeOrderViews[id](o);
    const count=store.orders.filter(eligible).length;
    if(!count)return notify("주문을 선택해 주세요.");
    formDialog(officeLabels[id],'<p class="wide">'+count+'건의 재고 반영 상태를 변경합니다.</p>',
      ()=>commit({...store,orders:store.orders.map(o=>eligible(o)?{...o,stockOverride:id==="deduct"}:o)}),"변경");
    return;
  }
  if(action==="columns"){
    formDialog("주문수집 열설정",collectionColumns.map((label,i)=>'<label class="check"><input type="checkbox" name="col'+i+'"'+
      ((store.collectionColumns||collectionColumns).includes(label)?" checked":"")+'> '+label+'</label>').join(""),
      values=>commit({...store,collectionColumns:collectionColumns.filter((_,i)=>values["col"+i]==="on")}));
    return;
  }
  if(action==="download"){
    const id=page(),data=officeReport(id);
    if(!data.rows.length)return notify("내려받을 내역이 없습니다.");
    download(officeLabels[id]+"_"+day()+".xlsx",[data.labels,...data.rows]);
    return;
  }
  if(action==="privacy"){
    formDialog("고객명·배송메모 폐기",
      '<label>종료일<input name="end" type="date" max="'+day()+'" required></label>'+field("확인 문구 ‘폐기’","confirm","",false,0,true),
      async values=>{
        if(values.confirm!=="폐기")throw Error("확인 문구를 입력해 주세요.");
        await commit({...store,orders:store.orders.map(o=>{
          if(o.date>values.end||!["발송완료","취소","반품"].includes(o.status))return o;
          const {customer,deliveryMemo,...order}=o;
          return order;
        })});
      },"폐기","선택 기간의 고객명과 배송메모를 폐기했습니다.");
    return;
  }
  if(action==="support"){location.hash="support";return editOfficeRecord("support");}
  if(action==="sidebar"){
    compactSidebar=!compactSidebar;
    try {sessionStorage.setItem("office-sidebar",compactSidebar?"hidden":"shown");} catch {}
    render();
    return;
  }
  if(action==="workspace-close"){
    openOfficePages.clear();
    workspaceLayout="";
    location.hash="home";
    render();
    return;
  }
  if(action.startsWith("workspace-layout-")){
    workspaceLayout=action.substring("workspace-layout-".length);
    render();
    return;
  }
  if(action==="clear-export"){
    notify("엑셀 파일은 조회할 때 생성되며 저장된 임시 파일이 없습니다.");
    return;
  }
}
function officeWorkspace() {
  if(!workspaceLayout)return "";
  return '<nav class="office-workspace '+workspaceLayout+'" aria-label="열린 작업">'+
    [...openOfficePages].map(id=>officeLink(id,officeLabels[id]||tabs[id]?.[0]||tasks[id]?.[0])).join("")+'</nav>';
}
$("nav").addEventListener("click",event=>{
  const selected=event.target.closest("details");
  if(event.target.closest("summary"))for(const details of $("nav").querySelectorAll("details[open]")){
    if(details!==selected)details.open=false;
  }
  if(event.target.closest("a,button")&&selected)selected.open=false;
});
document.addEventListener("click",event=>{
  if(!event.target.closest("#nav"))for(const details of $("nav").querySelectorAll("details[open]"))details.open=false;
});
$("nav").addEventListener("keydown",event=>{
  if(event.key!=="Escape")return;
  const details=event.target.closest("details");
  if(details){details.open=false;details.querySelector("summary").focus();}
});
$("content").addEventListener("input",event=>{
  if(event.target.id==="office-order-query")$("office-order-results").innerHTML=orderTable(officeOrderRows(page(),event.target.value),true);
});
$("content").addEventListener("change",event=>{
  const target=event.target;
  if(target.id==="statement-file"){const file=target.files[0];target.value="";if(file)void readStatementFile(file);}
});
function updateStatementDraft(event){
  const target=event.target,draft=statementDraft;
  if(!draft)return;
  if(target.id==="statement-date")draft.date=target.value;
  else if(target.id==="statement-supplier")draft.supplier=target.value;
  else if(target.id==="statement-text")draft.text=target.value;
  else if(target.dataset.statementRow!==undefined){
    const row=draft.rows[Number(target.dataset.statementRow)],field=target.dataset.statementField;
    if(!row)return;
    row[field]=field==="use"?target.checked:target.value;
    if(field==="target"&&event.type==="change"){row.use=Boolean(row.target);render();return;}
    if(field==="use"||field==="target"){const button=$("content").querySelector('[data-action="statement-apply"]');
      const n=draft.rows.filter(r=>r.use&&r.target).length;button.disabled=!n;button.textContent="재고에 반영 ("+n+"건)";}
  }
}
$("content").addEventListener("input",updateStatementDraft);
$("content").addEventListener("change",updateStatementDraft);
if(location.hostname==="127.0.0.1"||location.hostname==="localhost"){demo=true;demoStores=makeDemoStores();}
render();
load().catch(error=>{
  $("content").innerHTML='<div class="note">'+esc(error.message)+' '+btn("다시 시도","retry")+'</div>';
  $("connection").textContent="연결 확인 필요";
  $("active-business").textContent="사업자 확인 필요";
});
