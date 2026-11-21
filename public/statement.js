// 거래명세서 텍스트에서 매입일, 매입처, 품목 줄을 읽고 상품과 연결합니다.
const statementUnits = {kg:"kg", 봉:"봉", 개:"개", 박스:"박스", box:"박스", ea:"개", pcs:"개", 팩:"개", 포:"봉"};
const statementNumber = token => /^\d[\d,]*(?:\.\d+)?$/.test(token) ? Number(token.replaceAll(",","")) : NaN;

function statementClean(text) {
  return text.normalize("NFKC")
    .replace(/(\d),[ \t]+(?=\d)/g, "$1,")
    .replace(/\([ \t]+/g, "(").replace(/[ \t]+\)/g, ")").replace(/\/[ \t]+/g, "/");
}

function statementHeader(lines) {
  const lookup = pattern => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };
  const labeled = lookup(/(?:납품\s*년\s*월\s*일|거래일(?:자)?|작성일(?:자)?|발행일(?:자)?|매입일|일\s*자)\s*[:：]?\s*(.+)/);
  const found = (labeled || lines.join(" ")).match(/((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  const date = found ? found.slice(1).map(value => value.padStart(2,"0")).join("-") : "";
  const validDate = date && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  // 한 줄에 상호가 둘이면 왼쪽이 공급받는자, 오른쪽이 공급자입니다.
  let supplier = "";
  for (const line of lines) {
    const names = [...line.matchAll(/상\s*호\s*[:：]?\s*(.+?)(?=\s+(?:성\s*명|대표)|\s+상\s*호|$)/g)].map(m => m[1].trim());
    if (names.length) { supplier = names[names.length - 1]; break; }
  }
  if (!supplier) supplier = lookup(/(?:매입처|공급처|판매처)\s*[:：]?\s*(\S.*)/);
  const totalLine = lines.find(line => /공급가액\s*계/.test(line));
  const totals = totalLine ? [...totalLine.matchAll(/\d[\d,]*/g)].map(m => Number(m[0].replaceAll(",",""))) : [];
  return {date: validDate ? date : "", supplier: supplier.slice(0,120),
    totals: totals.length >= 3 ? {supply: totals[0], vat: totals[1], total: totals[2]} : null};
}

const statementClose = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.003);
const statementUnitToken = /^(box|ea|pcs|kg|박스|봉|개|팩|포)$/i;

// 순번 품명 규격 단위 수량 단가 금액 세액 합계 [비고] 형태의 줄을 읽습니다.
function statementTableLine(tokens) {
  for (let u = 1; u < tokens.length - 4; u++) {
    if (!statementUnitToken.test(tokens[u])) continue;
    const nums = tokens.slice(u + 1, u + 6).map(statementNumber);
    const [qty, price, amount, vat, total] = nums;
    if (!(qty > 0) || [price, amount, vat, total].some(n => !(n >= 0))) continue;
    if (!statementClose(amount + vat, total) || !(statementClose(qty * price, total) || statementClose(qty * price, amount))) continue;
    let name = tokens.slice(0, u), seq = null;
    if (name.length > 1 && /^\d{1,3}$/.test(name[0])) seq = Number(name.shift());
    let specKg = null;
    const spec = name[name.length - 1]?.match(/^(\d+(?:\.\d+)?)(kg|g)$/i);
    if (spec && name.length > 1) {
      specKg = Number(spec[1]) / (spec[2].toLowerCase() === "g" ? 1000 : 1);
      name.pop();
    }
    return {name: name.join(" "), seq, qty, unit: statementUnits[tokens[u].toLowerCase()] || "개", specKg, price, supply: amount, vat, total};
  }
  return null;
}

// 수량 × 단가 = 공급가액이 맞는 연속된 세 숫자를 품목 줄의 기준으로 삼습니다.
function statementSimpleLine(tokens) {
  for (let i = 1; i < tokens.length - 2; i++) {
    const unitInside = tokens[i].match(/^(\d[\d,]*(?:\.\d+)?)(kg|봉|개|박스|box|ea|pcs|팩|포)$/i);
    const qty = unitInside ? statementNumber(unitInside[1]) : statementNumber(tokens[i]);
    if (!(qty > 0)) continue;
    let next = i + 1, unit = unitInside ? statementUnits[unitInside[2].toLowerCase()] : "";
    if (!unit && statementUnits[tokens[next]?.toLowerCase()]) unit = statementUnits[tokens[next++].toLowerCase()];
    const price = statementNumber(tokens[next]?.replace(/원$/, ""));
    const supply = statementNumber(tokens[next + 1]?.replace(/원$/, ""));
    if (!(price > 0) || !(supply > 0)) continue;
    if (Math.abs(qty * price - supply) > Math.max(1, supply * 0.002)) continue;
    const vat = statementNumber(tokens[next + 2]?.replace(/원$/, ""));
    let name = tokens.slice(0, i), seq = null;
    if (name.length > 1 && /^\d{1,3}$/.test(name[0])) seq = Number(name.shift());
    if (name.length > 1 && /^\d{1,2}[\/.\-]\d{1,2}$/.test(name[0])) name.shift();
    return {name: name.join(" "), seq, qty, unit: unit || "개", specKg: null, price, supply, vat: Number.isFinite(vat) ? vat : 0, total: supply + (Number.isFinite(vat) ? vat : 0)};
  }
  return null;
}

function statementLine(line) {
  const tokens = line.split(/\s+/).filter(Boolean);
  const item = statementTableLine(tokens) || statementSimpleLine(tokens);
  if (!item || !/[가-힣A-Za-z]/.test(item.name) || /합\s*계|총\s*액|공급가액|세\s*액/.test(item.name)) return null;
  item.name = item.name.slice(0,120);
  return item;
}

function parseStatement(text) {
  const lines = statementClean(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const items = [];
  let lastSeq = null;
  for (const line of lines) {
    const item = statementLine(line);
    if (!item) continue;
    // 공급자용·공급받는자용 두 부가 한 파일에 있으면 순번이 다시 1로 돌아옵니다. 첫 부만 읽습니다.
    if (item.seq !== null && lastSeq !== null && item.seq <= lastSeq) break;
    if (item.seq !== null) lastSeq = item.seq;
    items.push(item);
  }
  const header = statementHeader(lines);
  const sum = items.reduce((total, item) => total + item.total, 0);
  return {...header, items, totalMatches: header.totals ? statementClose(sum, header.totals.total) : null};
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
