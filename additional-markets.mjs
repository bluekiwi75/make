function newMarketTable(market){
  return ["eleven","auction","gmarket"].includes(market)?"market_connection_extra":"market_connection";
}
async function collectEsm(credentials,date,test,market){
  const auction=market==="auction";
  const end=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  const encode=bytes=>marketBase64(bytes).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
  const part=obj=>encode(marketEncoder.encode(JSON.stringify(obj)));
  const signingKey=await crypto.subtle.importKey("raw",marketEncoder.encode(credentials.secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const rows=[];
  let calls=0;
  for(const status of (test?[1]:[1,2,3,4,5])){
    let total=0;
    for(let page=1;;page++){
      if(++calls>40)throw new MarketError("하루 조회 한도를 초과했습니다. CSV 가져오기를 이용해 주세요.",422);
      if(calls>1)await new Promise(resolve=>setTimeout(resolve,5100));
      const unsigned=part({alg:"HS256",typ:"JWT",kid:credentials.access})+"."+part({iss:credentials.issuer,sub:"sell",aud:"sa.esmplus.com",iat:Math.floor(Date.now()/1000),ssi:(auction?"A:":"G:")+credentials.id});
      const jwt=unsigned+"."+encode(await crypto.subtle.sign("HMAC",signingKey,marketEncoder.encode(unsigned)));
      const r=await marketFetch(market,"https://sa2.esmplus.com/shipping/v1/Order/RequestOrders",{method:"POST",headers:{Authorization:"Bearer "+jwt,"Content-Type":"application/json"},body:JSON.stringify({siteType:auction?1:2,orderStatus:status,requestDateType:1,requestDateFrom:date,requestDateTo:end,pageSize:100,pageIndex:page})});
      if(r.ResultCode!==0||!r.Data||!Array.isArray(r.Data.RequestOrders??[]))throw new MarketError("ESM 주문 조회에 실패했습니다. 주문 권한과 호출 제한을 확인해 주세요.",502);
      if(r.Data.SellerId&&r.Data.SellerId.toLowerCase()!==credentials.id.toLowerCase())throw new MarketError("응답의 판매자 ID가 등록한 ID와 다릅니다.",409);
      if(test)return [];
      const list=r.Data.RequestOrders||[];
      for(const o of list){
        const orderDate=marketOrderDate(o.OrderDate,date);
        if(orderDate!==date)continue;
        const opt=o.ItemOptionSelectList||[];
        const gross=Number(o.OrderAmount)+Number(o.OptSelPrice||0)+Number(o.OptAddPrice||0);
        rows.push(importedItem(market,{number:o.OrderNo,line:o.OrderNo,date:orderDate,name:o.GoodsName,sku:(opt.length===1&&opt[0].ItemOptionCode)||o.OutGoodsNo,qty:Number(o.ContrAmount),price:Number(o.SalePrice),gross,status:status===1?"신규":status===2?"포장중":"발송완료",discount:wonNumber(o.SellerDiscountPrice),fee:wonNumber(o.ServiceFee),tracking:o.InvoiceNo,carrier:o.TransCorpName}));
      }
      total+=list.length;
      if(total>=Number(r.Data.TotalCount??list.length))break;
      if(!list.length)throw new MarketError("ESM 주문 페이지가 누락되었습니다.",502);
    }
  }
  return rows;
}

function elevenRows(xml){
  const parser=sax.parser(true,{trim:true});
  const stack=[],rows=[];
  let code,root;
  parser.ondoctype=()=>{throw new MarketError("지원하지 않는 11번가 XML입니다.",502);};
  parser.onopentag=tag=>{root??=tag.name;stack.push({name:tag.name,text:"",fields:{}});};
  parser.ontext=parser.oncdata=text=>{if(stack.length)stack.at(-1).text+=text;};
  parser.onclosetag=()=>{
    const node=stack.pop(),parent=stack.at(-1);
    if(node.name==="result_code")code=node.text.trim();
    if(node.fields.ordNo)rows.push(node.fields);
    if(parent&&!Object.keys(node.fields).length)parent.fields[node.name]=node.text.trim();
  };
  parser.write(xml).close();
  if(code!==undefined&&code!=="0"&&code!=="200")throw new MarketError("11번가 주문 조회가 거절되었습니다. 인증키와 허용 IP를 확인해 주세요.",502);
  if(!rows.length&&code!=="0"&&!/order|ord|list/i.test(root||""))throw new MarketError("11번가 주문 응답을 확인할 수 없습니다.",502);
  return rows;
}
async function collectEleven(credentials,date,test){
  const stamp=date.replaceAll("-","");
  const result=[];
  for(const [path,status] of (test?[["complete","신규"]]:[["complete","신규"],["packaging","포장중"]])){
    const res=await fetch("https://api.11st.co.kr/rest/ordservices/"+path+"/"+stamp+"0000/"+stamp+"2359",{headers:{openapikey:credentials.secret,Accept:"application/xml"},redirect:"error",signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw new MarketError("11번가 API 응답 "+res.status+" · 인증키와 호출 IP를 확인해 주세요.",502);
    const bytes=await res.arrayBuffer();
    const prefix=new TextDecoder().decode(bytes.slice(0,200));
    const xml=new TextDecoder(/euc-kr|ks_c_5601|cp949/i.test(prefix)?"euc-kr":"utf-8").decode(bytes);
    const rows=elevenRows(xml);
    if(test)return [];
    if(rows.length>=3000)throw new MarketError("11번가 일일 결과가 조회 상한에 도달했습니다.",422);
    for(const o of rows){
      const qty=wonNumber(o.ordQty);
      const price=wonNumber(o.selPrc??o.prdSelPrc);
      const gross=wonNumber(o.ordPrdAmt??o.ordAmt)??qty*price;
      result.push(importedItem("eleven",{number:o.ordNo,line:o.ordPrdSeq,date:marketOrderDate(o.ordDt,date),name:o.prdNm,sku:o.sellerStockCd||o.sellerPrdCd,qty,price:price??Math.round(gross/qty),gross,status}));
    }
  }
  return result;
}
