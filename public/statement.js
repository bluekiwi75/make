// 거래명세서 텍스트에서 매입일, 매입처, 품목 줄을 읽고 상품과 연결합니다.
const statementUnits = {kg:"kg", 봉:"봉", 개:"개", 박스:"박스", box:"박스", ea:"개", pcs:"개", 팩:"개", 포:"봉"};
const statementNumber = token => /^\d[\d,]*(?:\.\d+)?$/.test(token) ? Number(token.replaceAll(",","")) : NaN;

function statementHeader(lines) {
  const lookup = pattern => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };
  const labeled = lookup(/(?:거래일(?:자)?|작성일(?:자)?|발행일(?:자)?|매입일|일\s*자)\s*[:：]?\s*(.+)/);
  const found = (labeled || lines.join(" ")).match(/((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  const date = found ? found.slice(1).map(value => value.padStart(2,"0")).join("-") : "";
  const validDate = date && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  const supplier = lookup(/(?:공급자\s*상호|공급자\s*\(?상호\)?|매입처|공급처|판매처|상\s*호(?:\s*\(법인명\))?)\s*[:：]?\s*([^\s:：][^:：]*)/)
    .replace(/\s*(?:성\s*명|대표자|등록번호|사업자).*$/, "");
  return {date: validDate ? date : "", supplier: supplier.slice(0,120)};
}

// 수량 × 단가 = 공급가액이 맞는 연속된 세 숫자를 품목 줄의 기준으로 삼습니다.
function statementLine(line) {
  const tokens = line.split(/\s+/).filter(Boolean);
  for (let i = 1; i < tokens.length - 2; i++) {
    const unitInside = tokens[i].match(/^(\d[\d,]*(?:\.\d+)?)(kg|봉|개|박스|box|ea|pcs|팩|포)$/i);
    const qty = unitInside ? statementNumber(unitInside[1]) : statementNumber(tokens[i]);
    if (!(qty > 0)) continue;
    let next = i + 1, unit = unitInside ? statementUnits[unitInside[2].toLowerCase()] : "";
    if (!unit && statementUnits[tokens[next]?.toLowerCase()]) unit = statementUnits[tokens[next++].toLowerCase()];
    const price = statementNumber(tokens[next]?.replace(/원$/, ""));
    const supply = statementNumber(tokens[next + 1]?.replace(/원$/, ""));
    if (!(price >= 0) || !(supply >= 0)) continue;
    if (Math.abs(qty * price - supply) > Math.max(1, supply * 0.002)) continue;
    const vat = statementNumber(tokens[next + 2]?.replace(/원$/, ""));
    let name = tokens.slice(0, i);
    if (name.length > 1 && /^\d{1,3}$/.test(name[0])) name = name.slice(1);
    if (name.length > 1 && /^\d{1,2}[\/.\-]\d{1,2}$/.test(name[0])) name = name.slice(1);
    const text = name.join(" ");
    if (!/[가-힣A-Za-z]/.test(text) || /합\s*계|총\s*액|공급가액|세\s*액/.test(text)) continue;
    return {name:text.slice(0,120), qty, unit: unit || "개", price, supply, vat: Number.isFinite(vat) ? vat : null};
  }
  return null;
}

function parseStatement(text) {
  const lines = text.normalize("NFKC").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const items = lines.map(statementLine).filter(Boolean);
  return {...statementHeader(lines), items};
}

const statementKey = value => value.normalize("NFKC").toLowerCase().replace(/[\s\-_()\[\]/.,]/g, "");
function statementGrams(value) {
  const match = value.normalize("NFKC").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/);
  return match ? Math.round(Number(match[1]) * (match[2] === "kg" ? 1000 : 1)) : null;
}
function statementBigrams(value) {
  const set = new Set();
  for (let i = 0; i < value.length - 1; i++) set.add(value.slice(i, i + 2));
  return set;
}

// 가장 알맞은 상품의 SKU를 돌려줍니다. 확신이 없으면 빈 문자열입니다.
function matchStatementProduct(name, products) {
  const key = statementKey(name);
  if (!key) return "";
  const bySku = products.find(p => key.includes(statementKey(p.sku)));
  if (bySku) return bySku.sku;
  const exact = products.find(p => statementKey(p.name) === key);
  if (exact) return exact.sku;
  const grams = statementGrams(name);
  let best = "", bestScore = 0;
  const left = statementBigrams(key);
  for (const product of products) {
    const other = statementKey(product.name);
    if (!other) continue;
    const productGrams = statementGrams(product.name);
    if (grams !== null && productGrams !== null && grams !== productGrams) continue;
    const right = statementBigrams(other);
    const shared = [...left].filter(item => right.has(item)).length;
    const score = shared * 2 / Math.max(1, left.size + right.size);
    if (score > bestScore) { best = product.sku; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : "";
}
