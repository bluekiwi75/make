const empty = { orders: [], products: [] };
const businessDefaults = { "1": "사업자 1", "2": "사업자 2" };
const channels = ["쿠팡", "네이버", "11번가", "옥션", "지마켓", "올웨이즈", "올레즈", "기타"];
const statuses = ["신규", "포장중", "발송완료", "취소", "반품"];
const expiry = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body, status = 200) => Response.json(body, { status, headers: expiry });
const string = (value, required = false) => typeof value === "string" &&
  value.length <= 120 && (!required || !!value.trim());
const amount = (value, min = 0, max = 1e9) => Number.isInteger(value) && value >= min && value <= max;
const unique = (rows, getKey) => new Set(rows.map(getKey)).size === rows.length;
const businessKey = (owner, business) => business === "1" ? owner : JSON.stringify(["business", owner, 2]);

const recipeText=value=>typeof value==="string"&&value.length<=2000&&Boolean(value.trim());

function validPurchasePayment(row) {
  if(row.paidAmount===undefined)return row.paymentStatus===undefined||["unpaid","paid"].includes(row.paymentStatus);
  const total=Math.round(Math.round(row.qty*1000)*row.price/1000)+(row.vat??0);
  if(!amount(row.paidAmount,0,total))return false;
  const status=row.paidAmount===total?"paid":row.paidAmount===0?"unpaid":"partial";
  return row.paymentStatus===status;
}

function validRecipeMaterials(row) {
  if(row.materials===undefined)return row.unit===undefined;
  return ["봉","kg","개","박스"].includes(row.unit)&&Array.isArray(row.materials)&&
    row.materials.length>0&&row.materials.length<=20&&
    row.materials.every(item=>item&&string(item.name,true)&&item.name===rawStockKey(item.name)&&
      item.grams>0&&item.grams<=1000000&&Math.round(item.grams*1000)/1000===item.grams)&&
    unique(row.materials,item=>item.name);
}

function validData(data) {
  if (!data || !Array.isArray(data.orders) || !Array.isArray(data.products) ||
      data.orders.length > 200000 || data.products.length > 3000) return false;
  const rules=data.printRules??[];
  const records=data.officeRecords??[];
  if(data.costSheet!==undefined&&!validCostSheet(data.costSheet))return false;
  if(!Array.isArray(records)||records.length>5000||!records.every(row=>row&&
    ["carriers","suppliers","matches","support","recipes"].includes(row.type)&&
    string(row.id,true)&&string(row.name,true)&&
    (row.type==="recipes"?recipeText(row.detail)&&(row.note===undefined||(typeof row.note==="string"&&row.note.length<=2000))&&validRecipeMaterials(row)&&["autoPack","manualPack"].every(key=>row[key]===undefined||(typeof row[key]==="string"&&row[key].length<=200))&&["autoNeeds","manualNeeds"].every(key=>row[key]===undefined||(typeof row[key]==="string"&&row[key].length<=2000)):string(row.detail)&&string(row.note))
  )||!unique(records,row=>row.id))return false;
  if(!Array.isArray(rules)||rules.length>50||!rules.every(rule=>rule&&
    ["name","deliveryMemo"].includes(rule.field)&&string(rule.find,true)&&string(rule.replacement)))return false;
  const custom=data.customChannels??[];
  if(!Array.isArray(custom)||!custom.every(name=>typeof name==="string"&&name.trim()===name&&name.length>0&&name.length<=40))return false;
  const available=[...channels,...custom];
  if(new Set(available.map(name=>name.toLowerCase())).size!==available.length)return false;
  const validProducts = data.products.every(p => p && string(p.sku, true) &&
    string(p.name, true) && ["cost", "units", "limit"].every(k => amount(p[k])) &&
    (p.estimatedSalePrice==null||amount(p.estimatedSalePrice))&&
    (p.estimatedTaxStatus==null||["과세","면세"].includes(p.estimatedTaxStatus)));
  const validOrders = data.orders.every(o => o &&
    ["id","number","name"].every(k => string(o[k], true)) &&
    ["line","sku","carrier","tracking"].every(k => string(o[k])) &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Number.isFinite(Date.parse(o.date)) &&
    new Date(o.date).toISOString().slice(0, 10) === o.date &&
    (o.shipDate===undefined||(typeof o.shipDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(o.shipDate)&&Number.isFinite(Date.parse(o.shipDate))&&new Date(o.shipDate).toISOString().slice(0,10)===o.shipDate)) &&
    (o.exchanged===undefined||typeof o.exchanged==="boolean") &&
    (o.stockOverride===undefined||typeof o.stockOverride==="boolean") &&
    (o.customer===undefined||string(o.customer)) &&
    ["settlement","shippingPaid"].every(k=>o[k]===undefined||amount(o[k])) &&
    available.includes(o.channel) && statuses.includes(o.status) &&
    amount(o.qty, 1, 100000) &&
    ["price","cost","fee","shipping","pack","discount"].every(k => amount(o[k])) &&
    (o.market === undefined || (Object.hasOwn(marketProviders, o.market) &&
      string(o.marketSku) && amount(o.marketGross) && typeof o.costsReviewed === "boolean")));
  return validProducts && validOrders && unique(data.products, p => p.sku) &&
    unique(data.orders, o => o.id) &&
    unique(data.orders, o => JSON.stringify([o.channel, o.number, o.line]));
}

function validCostSheet(sheet){
  const number=value=>Number.isFinite(value)&&value>=0&&value<=1e9;
  const rows=(value,max,check)=>Array.isArray(value)&&value.length>0&&value.length<=max&&value.every(check);
  if(!sheet||!string(sheet.source,true)||!rows(sheet.materials,300,m=>m&&string(m.name,true)&&
    ["과세","면세"].includes(m.tax)&&number(m.boxKg)&&m.boxKg>0&&number(m.price)&&
    (m.archived===undefined||typeof m.archived==="boolean")&&
    (m.vat===undefined||(Number.isInteger(m.vat)&&number(m.vat)))&&
    (m.priceUpdatedOn===undefined||(typeof m.priceUpdatedOn==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(m.priceUpdatedOn)&&
      Number.isFinite(Date.parse(m.priceUpdatedOn))&&new Date(m.priceUpdatedOn).toISOString().slice(0,10)===m.priceUpdatedOn)))||
    !unique(sheet.materials,m=>m.name))return false;
  const materials=new Set(sheet.materials.map(m=>m.name));
  if(!rows(sheet.recipes,150,r=>r&&string(r.name,true)&&number(r.grams)&&r.grams>0&&
    rows(r.lines,20,m=>m&&materials.has(m.name)&&number(m.grams)&&m.grams>0)&&unique(r.lines,m=>m.name)&&
    Math.abs(r.lines.reduce((sum,m)=>sum+m.grams,0)-r.grams)<0.00001&&(r.actualLines===undefined||(rows(r.actualLines,20,m=>m&&materials.has(m.name)&&number(m.grams)&&m.grams>0)&&unique(r.actualLines,m=>m.name)))&&(r.actualCost===undefined||(number(r.actualCost)&&r.actualCost>=0&&r.actualCost<=1e9))&&Array.isArray(r.offers)&&r.offers.length<=100&&r.offers.every(o=>
      o&&string(o.name,true)&&amount(o.packs,1,1000)&&["sale","cost","fee","vat","production"].every(k=>number(o[k]))))||
    !unique(sheet.recipes,r=>r.name))return false;
  const recipes=new Set(sheet.recipes.map(r=>r.name));
  return rows(sheet.catalog,3000,p=>p&&string(p.sku,true)&&string(p.name,true)&&number(p.grams)&&p.grams>0&&
    (p.recipe===""||recipes.has(p.recipe))&&(p.material===""||materials.has(p.material))&&!(p.recipe&&p.material));
}

async function state(request, env, url) {
  const owner = request.headers.get("oai-authenticated-user-id");
  if (!owner) return json({error: "ChatGPT 로그인이 필요합니다."}, 401);
  if (!env.DB) return json({error: "온라인 저장소를 연결할 수 없습니다."}, 503);
  const business = url.searchParams.get("business") ?? "1";
  if (!Object.hasOwn(businessDefaults, business)) return json({error: "사업자를 선택해 주세요."}, 400);
  // Keep the original owner key so existing records belong to the first business.
  const keys = { "1": businessKey(owner, "1"), "2": businessKey(owner, "2") };
  const currentKey = keys[business];
  const readCurrent = () => env.DB.prepare("SELECT revision, payload FROM market_state WHERE owner_id = ?").bind(currentKey).first();
  if (request.method === "GET") {
    const other = business === "1" ? "2" : "1";
    const [row, otherRow] = await Promise.all([
      readCurrent(),
      env.DB.prepare("SELECT json_extract(payload, '$.businessName') AS name FROM market_state WHERE owner_id = ?").bind(keys[other]).first()
    ]);
    const {sellerLogins=[], ...data} = row ? JSON.parse(row.payload) : empty;
    if(sellerLogins.length)data.loginChannels=sellerLogins.map(entry=>entry.channel);
    const names = {
      [business]: data.businessName || businessDefaults[business],
      [other]: otherRow?.name || businessDefaults[other]
    };
    return json({ rev: row?.revision ?? 0, data: {...data, businessName: names[business]}, names });
  }
  if (request.method !== "PUT") return json({error: "지원하지 않는 요청입니다."}, 405);
  if (request.headers.get("origin") !== url.origin) return json({error: "요청 출처를 확인해 주세요."}, 403);
  if ((request.headers.get("content-type") || "").split(";")[0] !== "application/json") return json({error: "JSON 요청이 필요합니다."}, 415);
  if (Number(request.headers.get("content-length")) > 60000000) return json({error: "저장 용량을 초과했습니다."}, 413);
  let input;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 60000000) return json({error: "저장 용량을 초과했습니다."}, 413);
  try { input = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return json({error: "저장 형식을 확인해 주세요."}, 400); }
  if(!input?.data||typeof input.data!=="object")return json({error:"저장 형식을 확인해 주세요."},400);
  const current=await readCurrent();
  if((current?.revision??0)!==input.rev)return json({error:"다른 기기에서 내용이 변경되었습니다."},409);
  const previous=current?JSON.parse(current.payload):empty;
  if(input.data.officeRecords===undefined)input.data.officeRecords=previous.officeRecords;
  if(input.data.costSheet===undefined)input.data.costSheet=previous.costSheet;
  if(input.data.collectionColumns===undefined)input.data.collectionColumns=previous.collectionColumns;
  if(input.data.collectionColumns!==undefined&&(!Array.isArray(input.data.collectionColumns)||
    !unique(input.data.collectionColumns,x=>x)||input.data.collectionColumns.some(x=>!["판매처","상품","상태","택배사·송장번호"].includes(x))))return json({error:"표시 열을 확인해 주세요."},400);
  if(input.data.purchases===undefined)input.data.purchases=previous.purchases;
  const purchases=input.data.purchases??[];
  if(!Array.isArray(purchases)||purchases.length>10000||!purchases.every(row=>
    row&&string(row.id,true)&&string(row.supplier,true)&&string(row.name,true)&&string(row.memo)&&
    typeof row.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&Number.isFinite(Date.parse(row.date))&&
    new Date(row.date).toISOString().slice(0,10)===row.date&&["kg","봉","개","박스"].includes(row.unit)&&
    Number.isFinite(row.qty)&&row.qty>=0.001&&row.qty<=1000000&&
    (row.unit==="kg"?Math.round(row.qty*1000)/1000===row.qty:Number.isInteger(row.qty))&&amount(row.price)&&
    (row.type===undefined||row.type==="special"||(row.type==="bulk"&&row.unit==="박스"))&&
    (row.type==="special"||(row.type==="bulk"&&row.vat!==undefined)?amount(row.vat):row.vat===undefined)&&
    validPurchasePayment(row)&&
    (row.paymentDueDate===undefined||(typeof row.paymentDueDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(row.paymentDueDate)&&
      Number.isFinite(Date.parse(row.paymentDueDate))&&new Date(row.paymentDueDate).toISOString().slice(0,10)===row.paymentDueDate))&&
    ((row.totalWeightKg===undefined&&row.packsPerBox===undefined)||
      (row.type==="bulk"&&amount(row.vat)&&Number.isFinite(row.totalWeightKg)&&row.totalWeightKg>=0.001&&row.totalWeightKg<=1000000&&
        Math.round(row.totalWeightKg*1000)/1000===row.totalWeightKg&&amount(row.packsPerBox,1)))
  )||!unique(purchases,row=>row.id))return json({error:"매입일, 매입처, 품목, 사입 구분, 수량, 포장 정보, 단가, 부가세와 결제 정보를 확인해 주세요."},400);
  if(input.data.production===undefined)input.data.production=previous.production;
  const production=input.data.production??[];
  if(!Array.isArray(production)||production.length>10000||!production.every(row=>
    row&&string(row.id,true)&&string(row.name,true)&&string(row.memo)&&
    typeof row.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&
    Number.isFinite(Date.parse(row.date))&&new Date(row.date).toISOString().slice(0,10)===row.date&&
    ["자동 포장","수동 포장"].includes(row.method)&&["봉","kg","개","박스"].includes(row.unit)&&
    Number.isFinite(row.qty)&&row.qty>=0.001&&row.qty<=1e9&&
    (row.unit==="kg"?Math.round(row.qty*1000)/1000===row.qty:Number.isInteger(row.qty))
  )||!unique(production,row=>row.id))return json({error:"생산일, 제품명과 생산량을 확인해 주세요."},400);
  if(input.data.scheduleTypes===undefined)input.data.scheduleTypes=previous.scheduleTypes;
  const scheduleTypes=input.data.scheduleTypes;
  const typeShapes=["●","■","▲","◆","★","▼","✚","♥"];
  if(scheduleTypes!==undefined&&!(Array.isArray(scheduleTypes)&&scheduleTypes.length>=1&&scheduleTypes.length<=typeShapes.length&&
    scheduleTypes.every(type=>type&&string(type.id,true)&&typeof type.name==="string"&&Boolean(type.name.trim())&&type.name.length<=20&&
      typeof type.color==="string"&&/^#[0-9a-f]{6}$/i.test(type.color)&&typeShapes.includes(type.shape))&&
    unique(scheduleTypes,type=>type.id)&&unique(scheduleTypes,type=>type.name)&&unique(scheduleTypes,type=>type.color.toLowerCase())&&unique(scheduleTypes,type=>type.shape)))
    return json({error:"스케줄 타입의 이름, 색, 모양은 서로 달라야 합니다."},400);
  const scheduleKinds=scheduleTypes?scheduleTypes.map(type=>type.name):["발주","입고","생산","발송","결제","기타"];
  if(input.data.schedules===undefined)input.data.schedules=previous.schedules;
  const schedules=input.data.schedules??[];
  const validDay=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!Array.isArray(schedules)||schedules.length>5000||!schedules.every(row=>
    row&&string(row.id,true)&&validDay(row.date)&&string(row.title,true)&&scheduleKinds.includes(row.kind)&&
    typeof row.memo==="string"&&row.memo.length<=1000&&(row.done===undefined||typeof row.done==="boolean")
  )||!unique(schedules,row=>row.id))return json({error:"스케줄의 날짜, 구분, 제목을 확인해 주세요."},400);
  if(input.data.customChannels===undefined)input.data.customChannels=previous.customChannels;
  if(input.data.deletedChannels===undefined)input.data.deletedChannels=previous.deletedChannels;
  const custom=input.data.customChannels??[];
  if(!Array.isArray(custom)||(previous.customChannels||[]).some(name=>!custom.includes(name)))return json({error:"판매처 삭제 메뉴를 이용해 주세요."},400);
  const archived=input.data.deletedChannels??[];
  if(!Array.isArray(archived)||!unique(archived,n=>n)||archived.some(n=>![...channels,...custom].includes(n)))return json({error:"판매처를 확인해 주세요."},400);
  const removed=archived.filter(n=>!previous.deletedChannels?.includes(n));
  if(removed.length && (removed.length!==1 || input.deletion?.name!==removed[0] || input.deletion?.pin!=="0000"))return json({error:"삭제 비밀번호가 일치하지 않습니다."},403);
  if (!input || !amount(input.rev, 0, Number.MAX_SAFE_INTEGER - 1) || !validData(input.data)) return json({error: "주문·상품의 필수 항목, 중복과 저장 용량을 확인해 주세요."}, 400);
  const oldProduction=new Map((previous.production||[]).map(row=>[row.id,row]));
  const currentRecipes=new Map((input.data.officeRecords||[]).filter(row=>row.type==="recipes").map(row=>[row.id,row]));
  for(const row of production){
    const old=oldProduction.get(row.id), snapshot=row.recipe;
    if(!snapshot){
      if(snapshot!==undefined||!old||old.recipe)return json({error:"원물 차감 기준이 설정된 제품 레시피를 선택해 주세요."},400);
      continue;
    }
    const recipe=old?.recipe||currentRecipes.get(snapshot.id);
    if(!recipe?.materials||snapshot.id!==recipe.id||snapshot.unit!==recipe.unit||row.unit!==recipe.unit||
      row.name!==(old?.recipe?old.name:recipe.name)||!Array.isArray(snapshot.materials)||
      snapshot.materials.length!==recipe.materials.length||snapshot.materials.some((item,index)=>
        item?.name!==recipe.materials[index].name||item?.grams!==recipe.materials[index].grams)){
      return json({error:"생산에 사용한 레시피와 배합을 확인해 주세요."},400);
    }
    row.recipe={id:recipe.id,unit:recipe.unit,materials:recipe.materials};
  }
  const shortage=rawStockShortage(purchases,production);
  if(shortage)return json({error:shortage.name+" 원물 재고가 부족합니다. 사입 중량과 생산량을 확인해 주세요."},422);
  let businessName = input.data.businessName;
  if (businessName !== undefined && (!string(businessName, true) || businessName.trim().length > 40)) {
    return json({error: "사업자명은 1~40자로 입력해 주세요."}, 400);
  }
  if (businessName === undefined && input.rev > 0) {
    const row = await readCurrent();
    businessName = row ? JSON.parse(row.payload).businessName : undefined;
  }
  let sellerLogins=(previous.sellerLogins||[]).filter(entry=>!archived.includes(entry.channel));
  if(input.login!==undefined){
    const {channel,username,password}=input.login||{};
    if(![...channels,...custom].includes(channel)||archived.includes(channel))return json({error:"등록된 판매처를 선택해 주세요."},400);
    if(typeof username!=="string"||!username.trim()||username.length>200||typeof password!=="string"||!password||password.length>512)return json({error:"판매자센터 아이디와 비밀번호를 확인해 주세요."},400);
    if(!env.MARKET_CONNECTION_KEY)return json({error:"로그인 정보 암호화 키를 사용할 수 없습니다."},503);
    const aad=marketEncoder.encode(JSON.stringify(["seller-login",owner,business,channel]));
    const sealed=await sealMarket(env,aad,{username:username.trim(),password});
    sellerLogins=sellerLogins.filter(entry=>entry.channel!==channel).concat({channel,sealed});
  }
  const output = JSON.stringify({costSheet:input.data.costSheet,officeRecords:input.data.officeRecords,collectionColumns:input.data.collectionColumns,purchases:input.data.purchases,production:input.data.production,schedules:input.data.schedules,scheduleTypes:input.data.scheduleTypes,sellerLogins:sellerLogins.length?sellerLogins:undefined,orders: input.data.orders, products: input.data.products, customChannels:input.data.customChannels, deletedChannels:input.data.deletedChannels, printRules:input.data.printRules, businessName: businessName?.trim()});
  const write = input.rev === 0
    ? env.DB.prepare("INSERT INTO market_state (owner_id, revision, payload) VALUES (?, 1, ?) ON CONFLICT(owner_id) DO NOTHING").bind(currentKey, output)
    : env.DB.prepare("UPDATE market_state SET revision = revision + 1, payload = ? WHERE owner_id = ? AND revision = ?").bind(output, currentKey, input.rev);
  const provider=Object.keys(marketProviders).find(id=>marketProviders[id]===removed[0]);
  let result;
  if(provider){
    const erase=env.DB.prepare("DELETE FROM "+newMarketTable(provider)+" WHERE owner_id=? AND business=? AND market=? AND COALESCE((SELECT revision FROM market_state WHERE owner_id=?),0)=?").bind(owner,business,provider,currentKey,input.rev);
    [,result]=await env.DB.batch([erase,write]);
  }else result=await write.run();
  return result.meta.changes === 1 ? json({rev: input.rev + 1}) : json({error:"다른 기기에서 내용이 변경되었습니다."}, 409);
}

async function purchaseDocument(request,env,url){
  const owner=request.headers.get("oai-authenticated-user-id");
  if(!owner)return json({error:"ChatGPT 로그인이 필요합니다."},401);
  if(!env.DB||!env.BUCKET)return json({error:"원본 저장소에 연결하지 못했습니다."},503);
  const business=url.searchParams.get("business"),id=url.searchParams.get("purchase");
  if(!Object.hasOwn(businessDefaults,business)||!string(id,true))return json({error:"사입 내역을 선택해 주세요."},400);
  if(!["GET","HEAD","PUT"].includes(request.method))return json({error:"지원하지 않는 요청입니다."},405);
  if(request.method==="PUT"&&request.headers.get("origin")!==url.origin)return json({error:"요청 출처를 확인해 주세요."},403);
  const record=await env.DB.prepare("SELECT 1 AS found FROM market_state,json_each(payload,'$.purchases') AS purchase WHERE owner_id = ? AND json_extract(purchase.value,'$.id') = ? LIMIT 1")
    .bind(businessKey(owner,business),id).first();
  if(!record)return json({error:"해당 사업자에 사입 내역이 없습니다."},404);
  const key="purchase/"+encodeURIComponent(owner)+"/"+business+"/"+encodeURIComponent(id);
  if(request.method==="HEAD"){
    const file=await env.BUCKET.head(key);
    return new Response(null,{status:file?200:404,headers:expiry});
  }
  if(request.method==="GET"){
    const file=await env.BUCKET.get(key);
    if(!file)return json({error:"첨부된 사입 원본이 없습니다."},404);
    return new Response(file.body,{headers:{...expiry,
      "Content-Type":file.httpMetadata.contentType,
      "Content-Disposition":"attachment; filename*=UTF-8''"+file.customMetadata.filename,
      "Content-Length":String(file.size)
    }});
  }
  const type=request.headers.get("Content-Type"),filename=request.headers.get("X-Document-Filename");
  const size=Number(request.headers.get("X-Document-Size"));
  if(!filename||filename.length>1800||!/^(?:[A-Za-z0-9_.!~*()-]|%[\da-f]{2})+$/i.test(filename)||
    !["application/pdf","image/jpeg"].includes(type))return json({error:"PDF 또는 JPG 파일을 선택해 주세요."},400);
  if(!amount(size,1,type==="application/pdf"?50_000_000:15_000_000)||!request.body)
    return json({error:"파일 용량을 확인해 주세요."},413);
  const reader=request.body.getReader();
  const bytes=new Uint8Array(size);
  let offset=0;
  try{
    for(let part=await reader.read();!part.done;part=await reader.read()){
      if(offset+part.value.length>size)return json({error:"파일 용량이 일치하지 않습니다."},400);
      bytes.set(part.value,offset);
      offset+=part.value.length;
    }
  }finally{await reader.cancel().catch(()=>{});}
  const matches=type==="application/pdf"
    ?new TextDecoder().decode(bytes.subarray(0,1024)).includes("%PDF-")
    :bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(offset!==size||!matches)return json({error:"파일 형식 또는 용량이 일치하지 않습니다."},400);
  const saved=await env.BUCKET.put(key,bytes,{
    onlyIf:new Headers({"If-None-Match":"*"}),
    httpMetadata:{contentType:type},
    customMetadata:{filename}
  });
  if(!saved)return json({error:"이 사입 내역에 원본이 이미 보관되어 있습니다."},409);
  return json({saved:true},201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/markets") {
      try { return await marketRoute(request, env, url); }
      catch (error) {
        if (error instanceof MarketError) return json({error:error.message}, error.status);
        console.error("Market integration request failed", error.name);
        return json({error:"판매처 연결을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."},500);
      }
    }
    if (url.pathname === "/api/state") {
      try { return await state(request, env, url); }
      catch (error) {
        console.error("Market state request failed", error.name);
        return json({error: "온라인 데이터 처리에 실패했습니다."}, 500);
      }
    }
    if(url.pathname==="/api/purchase-document"){
      try{return await purchaseDocument(request,env,url);}
      catch(error){
        console.error("Purchase document request failed",error.name);
        return json({error:"클라우드 원본을 처리하지 못했습니다."},500);
      }
    }
    const asset = assets[url.pathname === "/" ? "/index.html" : url.pathname];
    if (!Object.hasOwn(assets, url.pathname === "/" ? "/index.html" : url.pathname)) return new Response("Not found", {status:404});
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, {status:405});
    return new Response(request.method === "HEAD" ? null : asset.body, {headers:{
      ...expiry,
      "Content-Type": asset.type + "; charset=utf-8",
      "Content-Security-Policy": url.pathname === "/purchase-scan.html"
        ? "sandbox allow-scripts; default-src 'none'; script-src 'sha256-"+scannerHash+"' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; connect-src https://cdn.jsdelivr.net; worker-src blob:; img-src blob: data:; frame-ancestors 'self'"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'",
      "Referrer-Policy": "same-origin"
    }});
  }
};
