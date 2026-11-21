const marketProviders = {coupang:"쿠팡",naver:"네이버",eleven:"11번가",auction:"옥션",gmarket:"지마켓"};
const marketDay = time => new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul"}).format(time);
const marketEncoder = new TextEncoder();

class MarketError extends Error {
  constructor(message, status=400) {
    super(message);
    this.status=status;
  }
}

const marketHex = bytes => Array.from(new Uint8Array(bytes), n=>n.toString(16).padStart(2,"0")).join("");
const marketBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const marketBytes = value => Uint8Array.from(atob(value), c=>c.charCodeAt(0));
const marketAad = (owner,business,market) => marketEncoder.encode(JSON.stringify([owner,business,market]));

async function vaultKey(env) {
  if(!env.MARKET_CONNECTION_KEY)throw new MarketError("API 키 저장소를 연결할 수 없습니다.",503);
  return crypto.subtle.importKey("raw",marketBytes(env.MARKET_CONNECTION_KEY),"AES-GCM",false,["encrypt","decrypt"]);
}

async function sealMarket(env, aad, credentials) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const sealed=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},await vaultKey(env),marketEncoder.encode(JSON.stringify(credentials)));
  return marketBase64(iv)+"."+marketBase64(sealed);
}

async function openMarket(env, aad, encoded) {
  const [iv, ciphertext]=encoded.split(".").map(marketBytes);
  const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:aad},await vaultKey(env),ciphertext);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validatedCredentials(market, data) {
  const value = key => typeof data[key]==="string" ? data[key].trim() : "";
  const id=value("id"), secret=value("secret");
  const restricted=s=>/^[A-Za-z0-9_-]{3,160}$/.test(s);
  if(["eleven","auction","gmarket"].includes(market)){
    const access=value("access"),issuer=value("issuer")||"www.esmplus.com";
    if(!id||id.length>120||!secret||secret.length>160||/[\s,\x00-\x1f]/.test(id)|| (market!=="eleven"&&(!access||access.length>120||issuer.length>120)))throw new MarketError("판매자 ID와 발급받은 인증 정보를 확인해 주세요.");
    return {id,secret,access,issuer};
  }
  if(market==="coupang"){
    const access=value("access");
    if(!restricted(id)||!restricted(access)||!/^[\x21-\x7E]{3,160}$/.test(secret))throw new MarketError("쿠팡 판매자 ID(Vendor ID), Access Key, Secret Key를 확인해 주세요.");
    return {id,access,secret};
  }
  if(!restricted(id)||!(/^\$2[aby]\$(0[4-9]|1[0-2])\$[.\/A-Za-z0-9]{22}([.\/A-Za-z0-9]{31})?$/.test(secret)))throw new MarketError("네이버 애플리케이션 ID와 bcrypt 형식의 시크릿을 확인해 주세요.");
  return {id,secret};
}

async function marketFetch(market, url, options={}) {
  let response;
  try{response=await fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(12000)});}
  catch{throw new MarketError(marketProviders[market]+" API에 접속하지 못했습니다. 잠시 후 다시 시도해 주세요.",502);}
  if(!response.ok){
    const reason=[401,403].includes(response.status)?"API 키, 주문 조회 권한 및 허용 IP 설정을 확인해 주세요.":
      response.status===429?"호출 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.":"판매처의 조회 조건 또는 연결 상태를 확인해 주세요.";
    throw new MarketError(marketProviders[market]+" API 응답 "+response.status+" · "+reason,502);
  }
  try{return JSON.parse(await response.text(),(_key,value,context)=>(
    typeof value==="number"&&Number.isInteger(value)&&!Number.isSafeInteger(value)&&context?.source ? context.source : value
  ));}
  catch{throw new MarketError(marketProviders[market]+" API 응답 형식을 확인할 수 없습니다.",502);}
}

async function coupangSigned(credentials, path, query, now=new Date()) {
  const date=now.toISOString().slice(2,19).replace(/[-:]/g,"")+"Z";
  const hmac=await crypto.subtle.importKey("raw",marketEncoder.encode(credentials.secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=marketHex(await crypto.subtle.sign("HMAC",hmac,marketEncoder.encode(date+"GET"+path+query)));
  return "CEA algorithm=HmacSHA256, access-key="+credentials.access+", signed-date="+date+", signature="+signature;
}

async function coupangPage(credentials, date, status, nextToken) {
  const path="/v2/providers/openapi/apis/api/v5/vendors/"+encodeURIComponent(credentials.id)+"/ordersheets";
  const query=new URLSearchParams({createdAtFrom:date+"+09:00",createdAtTo:date+"+09:00",status,maxPerPage:"50"});
  if(nextToken)query.set("nextToken",nextToken);
  const headers={Authorization:await coupangSigned(credentials,path,query.toString()),Accept:"application/json"};
  const response=await marketFetch("coupang","https://api-gateway.coupang.com"+path+"?"+query, {headers});
  if(String(response.code)!=="200"||!Array.isArray(response.data))throw new MarketError("쿠팡 발주서 조회가 거절되었습니다. 주문 조회 권한과 판매자 ID를 확인해 주세요.",502);
  return response;
}

async function naverToken(credentials) {
  const timestamp=Date.now();
  const hashed=await bcrypt.hash(credentials.id+"_"+timestamp,credentials.secret.slice(0,29));
  const body=new URLSearchParams({client_id:credentials.id,timestamp:String(timestamp),grant_type:"client_credentials",client_secret_sign:btoa(hashed),type:"SELF"});
  const result=await marketFetch("naver","https://api.commerce.naver.com/external/v1/oauth2/token",{method:"POST",body});
  if(!result.access_token)throw new MarketError("네이버 인증 토큰 발급에 실패했습니다.",502);
  return {Authorization:"Bearer "+result.access_token};
}

const naverOrdersUrl="https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders";

function naverChanged(headers, date, cursor, limitCount="300") {
  const loc=date+"T00:00:00.000+09:00";
  const query=new URLSearchParams({lastChangedFrom:cursor?.moreFrom||loc,limitCount});
  if(cursor)query.set("moreSequence",String(cursor.moreSequence));
  // Keep the end of the original KST date fixed when following a page cursor.
  const end=new Date(date+"T23:59:59.999+09:00");
  const now=new Date();
  query.set("lastChangedTo",(end>now?now:end).toISOString());
  return marketFetch("naver",naverOrdersUrl+"/last-changed-statuses?"+query,{headers});
}

const wonNumber = value => {
  if(value&&typeof value==="object"){
    if(value.currencyCode&&value.currencyCode!=="KRW")return undefined;
    value=value.units;
  }
  if(typeof value!=="number"&&(typeof value!=="string"||!/^\d+$/.test(value)))return undefined;
  const n=Number(value);
  return amount(n) ? n : undefined;
};
const marketText = value => (typeof value==="number"||typeof value==="string" ? String(value).trim().slice(0,120) : "");
const marketOrderDate = (value, fallback) => {
  if(!value)return fallback;
  const timestamp=String(value).replace(" ","T");
  const zoned=/Z$|[+-]\d\d:\d\d$/.test(timestamp)?timestamp:timestamp+"+09:00";
  return Number.isFinite(Date.parse(zoned))?marketDay(new Date(zoned)):fallback;
};

function importedItem(market, item) {
  return {
    market, channel:marketProviders[market], id:crypto.randomUUID(),
    number:marketText(item.number), line:marketText(item.line), date:item.date,
    ...(item.shipDate?{shipDate:item.shipDate}:{}),...(item.exchanged?{exchanged:true}:{}),
    name:marketText(item.name), marketSku:marketText(item.sku),sku:"",
    qty:item.qty, price:item.price, marketGross:item.gross, cost:0, costsReviewed:false,
    fee:item.fee??0, shipping:0, pack:0, discount:item.discount??0,
    status:item.status, carrier:marketText(item.carrier), tracking:marketText(item.tracking)
  };
}

function coupangItem(sheet,item,date) {
  if(item.salesPrice?.currencyCode&&item.salesPrice.currencyCode!=="KRW")return null;
  const initial=wonNumber(item.shippingCount);
  const remaining=initial-(wonNumber(item.cancelCount)??0);
  const canceled=item.canceled===true||remaining<=0;
  const qty=canceled?initial:remaining;
  const price=wonNumber(item.salesPrice)??(wonNumber(item.orderPrice)!==undefined&&initial?Math.round(wonNumber(item.orderPrice)/initial):undefined);
  const status=canceled?"취소":sheet.status==="ACCEPT"?"신규":["INSTRUCT","DEPARTURE"].includes(sheet.status)?"포장중":"발송완료";
  const line=marketText(sheet.shipmentBoxId)&&marketText(item.vendorItemId)?marketText(sheet.shipmentBoxId)+"/"+marketText(item.vendorItemId):"";
  return importedItem("coupang",{
    number:sheet.orderId, line,shipDate:marketOrderDate(sheet.shippedDate,""),
    date:marketOrderDate(sheet.paidAt||sheet.orderedAt,date), name:item.vendorItemName||item.sellerProductName,
    sku:item.externalVendorSkuCode??item.externalVendorSku,
    qty,price,gross:qty*price,status,carrier:sheet.deliveryCompanyName??sheet.deliveryCompanyCode,
    tracking:sheet.invoiceNumber
  });
}

function naverItem(detail,date) {
  const {order,productOrder:p,delivery}=detail;
  if(!p||!order||["PAYMENT_WAITING","CANCELED_BY_NOPAYMENT"].includes(p.productOrderStatus))return null;
  const status=({
    PAYED:p.placeOrderStatus==="OK"?"포장중":"신규",DELIVERING:"발송완료",DELIVERED:"발송완료",
    PURCHASE_DECIDED:"발송완료",EXCHANGED:"발송완료",CANCELED:"취소",RETURNED:"반품"
  })[p.productOrderStatus];
  if(!status)return null;
  const qty=(wonNumber(p.remainQuantity)||wonNumber(p.quantity)||wonNumber(p.initialQuantity));
  const gross=wonNumber(p.remainProductAmount)??wonNumber(p.totalProductAmount)??qty*wonNumber(p.unitPrice);
  const price=wonNumber(p.unitPrice)??Math.round(gross/qty);
  const sku=p.optionManageCode||p.sellerProductCode;
  const fee=["paymentCommission","saleCommission","channelCommission"].reduce((sum,k)=>sum+(wonNumber(p[k])??0),0);
  return importedItem("naver",{
    number:order.orderId, line:p.productOrderId,shipDate:marketOrderDate(delivery?.sendDate,""),exchanged:p.productOrderStatus==="EXCHANGED",
    date:marketOrderDate(order.orderDate||order.paymentDate,date), name:p.productName, sku, qty, price, gross, fee,
    discount:wonNumber(p.remainSellerBurdenDiscountAmount)??wonNumber(p.sellerBurdenDiscountAmount),
    status,carrier:delivery?.deliveryCompany,tracking:delivery?.trackingNumber
  });
}

const coupangStatuses=["ACCEPT","INSTRUCT","DEPARTURE","DELIVERING","FINAL_DELIVERY","NONE_TRACKING"];
async function collectCoupang(credentials,date,test) {
  if(test){await coupangPage(credentials,date,"ACCEPT");return [];}
  const work=await Promise.all(coupangStatuses.map(async status=>{
    const output=[];
    let token;
    for(let page=0;page<6;page++){
      const response=await coupangPage(credentials,date,status,token);
      for(const sheet of response.data){
        for(const item of sheet.orderItems||[])output.push(coupangItem({...sheet,status:sheet.status||status},item,date));
      }
      token=response.nextToken;
      if(!token||token==="0")return output;
    }
    throw new MarketError("쿠팡의 하루 조회 건수가 너무 많습니다. 일부만 저장하는 것을 방지하기 위해 수집을 중단했습니다.",422);
  }));
  return work.flat();
}

async function collectNaver(credentials,date,test) {
  const headers=await naverToken(credentials);
  const ids=new Set();
  let cursor;
  for(let page=0;page<8;page++){
    const r=await naverChanged(headers,date,cursor,test?"1":"300");
    if(!r.data||!Array.isArray(r.data.lastChangeStatuses??[]))throw new MarketError("네이버 주문 조회 권한을 확인해 주세요.",502);
    if(test)return [];
    for(const row of r.data.lastChangeStatuses||[])if(row.productOrderId)ids.add(String(row.productOrderId));
    cursor=r.data.more;
    if(!cursor?.moreFrom)break;
    if(page===7)throw new MarketError("네이버의 하루 조회 건수가 너무 많습니다. 일부만 저장하는 것을 방지하기 위해 수집을 중단했습니다.",422);
  }
  const list=[...ids], output=[];
  for(let i=0;i<list.length;i+=100){
    const r=await marketFetch("naver",naverOrdersUrl+"/query",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({productOrderIds:list.slice(i,i+100),quantityClaimCompatibility:true})});
    if(!Array.isArray(r.data))throw new MarketError("네이버 주문 상세 형식을 확인할 수 없습니다.",502);
    output.push(...r.data.map(item=>naverItem(item,date)));
  }
  return output;
}

const collectors={coupang:collectCoupang,naver:collectNaver,eleven:collectEleven,auction:collectEsm,gmarket:collectEsm};
const marketLineKey = o => JSON.stringify([o.channel,o.number,o.line]);

function mergeMarketOrders(data, imported) {
  const orders=new Map(data.orders.map(o=>[marketLineKey(o),o]));
  const products=new Map(data.products.map(p=>[p.sku,p]));
  const matches=new Map((data.officeRecords||[]).filter(row=>row.type==="matches"&&products.has(row.detail)).map(row=>[row.name,row.detail]));
  let added=0,updated=0,skipped=0;
  const incoming=new Map();
  for(const item of imported){
    if(!item)continue;
    if(!item.number||!item.line||!item.name||!amount(item.qty,1,100000)||!amount(item.price)||!amount(item.marketGross)){
      skipped++;continue;
    }
    const key=marketLineKey(item);
    const prior=incoming.get(key);
    if(!prior||statuses.indexOf(item.status)>=statuses.indexOf(prior.status))incoming.set(key,item);
  }
  for(const [key,item] of incoming){
    const previous=orders.get(key);
    const sku=previous?.sku||matches.get(item.marketSku)||products.get(item.marketSku)?.sku||"";
    if(previous){
      const {qty,price,marketGross,status,carrier,tracking,fee,discount}=item;
      const next={...previous,market:item.market,marketSku:item.marketSku,qty,price,marketGross,status,
        sku,carrier:carrier||previous.carrier,tracking:tracking||previous.tracking,
        cost:previous.sku||previous.cost?previous.cost:(products.get(sku)?.cost??previous.cost),
        costsReviewed:!!previous.costsReviewed&&qty===previous.qty&&marketGross===previous.marketGross};
      if(item.shipDate)next.shipDate=item.shipDate;
      if(item.exchanged)next.exchanged=true;
      if(previous.market&&previous.costsReviewed!==true){
        next.fee=fee;
        next.discount=discount;
      }
      if(JSON.stringify(previous)!==JSON.stringify(next)){orders.set(key,next);updated++;}
    }else{
      orders.set(key,{...item,sku,cost:products.get(sku)?.cost??0});
      added++;
    }
  }
  return {data:{...data,orders:[...orders.values()]},added,updated,skipped};
}

async function storeMarketOrders(env,owner,business,market,sealed,items) {
  const key=businessKey(owner,business);
  const matchingConnection="EXISTS (SELECT 1 FROM "+newMarketTable(market)+" WHERE owner_id = ? AND business = ? AND market = ? AND sealed = ?)";
  const binding=[owner,business,market,sealed];
  for(let attempt=0;attempt<3;attempt++){
    const row=await env.DB.prepare("SELECT revision,payload FROM market_state WHERE owner_id = ?").bind(key).first();
    const {data,added,updated,skipped}=mergeMarketOrders(row?JSON.parse(row.payload):empty,items);
    if(!added&&!updated)return {added,updated,skipped};
    const payload=JSON.stringify(data);
    if(marketEncoder.encode(payload).length>1750000||!validData(data))throw new MarketError("주문 저장 한도에 도달했거나 일부 주문 정보가 지원 범위를 벗어났습니다.",422);
    const statement=row
      ? env.DB.prepare("UPDATE market_state SET revision = revision + 1, payload = ? WHERE owner_id = ? AND revision = ? AND "+matchingConnection).bind(payload,key,row.revision,...binding)
      : env.DB.prepare("INSERT INTO market_state (owner_id,revision,payload) SELECT ?,1,? WHERE "+matchingConnection+" ON CONFLICT(owner_id) DO NOTHING").bind(key,payload,...binding);
    if((await statement.run()).meta.changes===1)return {added,updated,skipped};
  }
  throw new MarketError("사업자 자료 또는 API 연결이 변경되었습니다. 다시 가져와 주세요.",409);
}

async function marketRoute(request,env,url) {
  const owner=request.headers.get("oai-authenticated-user-id");
  if(!owner)throw new MarketError("ChatGPT 로그인이 필요합니다.",401);
  if(!env.DB)throw new MarketError("온라인 저장소를 연결할 수 없습니다.",503);
  const business=url.searchParams.get("business");
  if(!Object.hasOwn(businessDefaults,business))throw new MarketError("사업자를 선택해 주세요.");
  if(request.method==="GET"){
    const result=await env.DB.prepare("SELECT market,last_sync FROM market_connection WHERE owner_id = ? AND business = ? UNION ALL SELECT market,last_sync FROM market_connection_extra WHERE owner_id = ? AND business = ?").bind(owner,business,owner,business).all();
    return json({connections:result.results});
  }
  if(request.method!=="POST")throw new MarketError("지원하지 않는 요청입니다.",405);
  if(request.headers.get("origin")!==url.origin)throw new MarketError("요청 출처를 확인해 주세요.",403);
  if((request.headers.get("content-type")||"").split(";")[0]!=="application/json")throw new MarketError("JSON 요청이 필요합니다.",415);
  if(Number(request.headers.get("content-length"))>4000)throw new MarketError("입력이 너무 깁니다.",413);
  const body=await request.text();
  if(body.length>4000)throw new MarketError("입력이 너무 깁니다.",413);
  let input;
  try{input=JSON.parse(body);}catch{throw new MarketError("입력 내용을 확인해 주세요.");}
  if(!input||!Object.hasOwn(marketProviders,input.market))throw new MarketError("지원 판매처를 선택해 주세요.");
  const {market,action}=input;
  const aad=marketAad(owner,business,market);
  const today=marketDay(new Date());
  if(action==="save"){
    const credentials=validatedCredentials(market,input);
    const sellerHash=marketHex(await crypto.subtle.digest("SHA-256",marketEncoder.encode(JSON.stringify([owner,market,market==="eleven"?credentials.secret:credentials.id.toLowerCase()]))));
    const exists=await env.DB.prepare("SELECT business FROM "+newMarketTable(market)+" WHERE owner_id = ? AND market = ? AND seller_hash = ? AND business <> ?").bind(owner,market,sellerHash,business).first();
    if(exists)throw new MarketError("이 판매자 계정은 다른 사업자에 이미 등록되어 있습니다.",409);
    const sealed=await sealMarket(env,aad,credentials);
    const saved=await env.DB.prepare("INSERT INTO "+newMarketTable(market)+" (owner_id,business,market,seller_hash,sealed) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM market_state,json_each(market_state.payload,'$.deletedChannels') AS deleted WHERE market_state.owner_id=? AND deleted.value=?) ON CONFLICT(owner_id,business,market) DO UPDATE SET seller_hash=excluded.seller_hash,sealed=excluded.sealed,last_sync=CASE WHEN "+newMarketTable(market)+".seller_hash=excluded.seller_hash THEN "+newMarketTable(market)+".last_sync END").bind(owner,business,market,sellerHash,sealed,businessKey(owner,business),marketProviders[market]).run().catch(error=>{
      if(String(error.message).includes("UNIQUE constraint"))throw new MarketError("이 판매자 계정은 다른 사업자에 이미 등록되어 있습니다.",409);
      throw error;
    });
    if(!saved.meta.changes)throw new MarketError("삭제된 판매처입니다. 판매처를 다시 추가해 주세요.",409);
    return json({saved:true});
  }
  if(!["test","sync","dispatch"].includes(action)||action==="dispatch"&&market!=="naver")throw new MarketError("지원하지 않는 작업입니다.");
  const saved=await env.DB.prepare("SELECT sealed FROM "+newMarketTable(market)+" WHERE owner_id = ? AND business = ? AND market = ?").bind(owner,business,market).first();
  if(!saved)throw new MarketError("이 사업자의 API 키를 먼저 저장해 주세요.",409);
  const date=action==="sync"?input.date:today;
  if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>today)throw new MarketError("조회 날짜를 확인해 주세요.");
  const credentials=await openMarket(env,aad,saved.sealed);
  if(action==="dispatch"){
    const ownerKey=businessKey(owner,business);
    const row=await env.DB.prepare("SELECT revision,payload FROM market_state WHERE owner_id = ?").bind(ownerKey).first();
    if(!row||row.revision!==input.rev)throw new MarketError("주문 목록을 새로고침해 주세요.",409);
    const {orders,officeRecords=[]}=JSON.parse(row.payload);
    const index=orders.findIndex(o=>o.id===input.id);
    const order=orders[index];
    if(order?.market!=="naver"||!["신규","포장중"].includes(order.status)||!order.line||!order.tracking||!order.carrier)throw new MarketError("전송할 주문과 송장 정보를 확인해 주세요.");
    const codes={"CJ대한통운":"CJGLS","대한통운":"CJGLS","우체국택배":"EPOST","한진택배":"HANJIN","롯데택배":"HYUNDAI","로젠택배":"KGB"};
    const carrier=order.carrier.replace(/\s/g,"");
    const configured=officeRecords.find(item=>
      item.type==="carriers"&&item.name.replace(/\s/g,"")===carrier);
    const code=(configured?.detail||codes[carrier]||carrier).toUpperCase();
    if(!/^[A-Z0-9_]+$/.test(code))throw new MarketError("택배사에 네이버 택배사 코드를 입력해 주세요.");
    const headers={...await naverToken(credentials),"Content-Type":"application/json"};
    const r=await marketFetch("naver",naverOrdersUrl+"/dispatch",{method:"POST",headers,body:JSON.stringify({dispatchProductOrders:[{productOrderId:order.line,deliveryMethod:"DELIVERY",deliveryCompanyCode:code,trackingNumber:order.tracking,dispatchDate:new Date().toISOString()}]})});
    if(!r.data?.successProductOrderIds?.map(String).includes(order.line))throw new MarketError(r.data?.failProductOrderInfos?.[0]?.message||"전송 결과를 판매자센터에서 확인해 주세요.",422);
    const path="$.orders["+index+"]";
    const changed=await env.DB.prepare("UPDATE market_state SET revision=revision+1,payload=json_set(payload,?,'발송완료',?,?) WHERE owner_id=? AND json_extract(payload,?)=? AND json_extract(payload,?)=? AND json_extract(payload,?)=? AND json_extract(payload,?) IN ('신규','포장중')").bind(path+".status",path+".shipDate",today,ownerKey,path+".id",order.id,path+".tracking",order.tracking,path+".carrier",order.carrier,path+".status").run();
    if(!changed.meta.changes)throw new MarketError("네이버 전송 완료. 목록이 변경되어 주문 상태를 다시 수집해 주세요.",409);
    return json({sent:true});
  }
  const items=await collectors[market](credentials,date,action==="test",market);
  if(action==="test")return json({connected:true});
  const result=await storeMarketOrders(env,owner,business,market,saved.sealed,items);
  await env.DB.prepare("UPDATE "+newMarketTable(market)+" SET last_sync = ? WHERE owner_id = ? AND business = ? AND market = ? AND sealed = ?").bind(new Date().toISOString(),owner,business,market,saved.sealed).run();
  return json(result);
}
