const rawStockKey = name => name.trim().normalize("NFC");

function rawStockUse(item, quantity) {
  return Number((BigInt(Math.round(item.grams*1000))*BigInt(Math.round(quantity*1000))+999999n)/1000000n);
}

function rawStockBalances(purchases = [], production = []) {
  const balances = new Map();
  const add = (name, received, used) => {
    const key = rawStockKey(name);
    const balance = balances.get(key) || { name:key, received:0, used:0 };
    balance.received += received;
    balance.used += used;
    balances.set(key,balance);
  };
  for (const row of purchases) {
    if (row.type === "bulk" && row.totalWeightKg !== undefined) {
      add(row.name,Math.round(row.totalWeightKg*1000),0);
    }
  }
  for (const row of production) {
    for (const item of row.recipe?.materials || []) {
      add(item.name,0,rawStockUse(item,row.qty));
    }
  }
  return balances;
}

function rawStockShortage(purchases, production) {
  return [...rawStockBalances(purchases,production).values()].find(row=>row.used>row.received);
}
