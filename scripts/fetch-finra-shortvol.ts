#!/usr/bin/env -S deno run --allow-net --allow-write --allow-read
// fetch-finra-shortvol — FREE daily per-symbol SHORT-SALE VOLUME from FINRA (cdn.finra.org RegSHO daily).
// This is genuine NON-PRICE ORDER FLOW: how much of each day's volume was executed as short sales.
// Literature: Boehmer/Jones/Zhang "Which Shorts Are Informed?" — shorting is informed, so an extreme
// short-volume ratio is a documented candidate predictor. Everything so far has been price-derived; this
// is not. Extracts only our book (keeps the file tiny) → data/finra/shortvol.csv (date,sym,short,total).
const BOOK = new Set(["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"]);
await Deno.mkdir("data/finra", { recursive: true });
const OUT = "data/finra/shortvol.csv";
let have = new Set<string>();
try { const ex = await Deno.readTextFile(OUT); for (const l of ex.split("\n")) { const d = l.split(",")[0]; if (d) have.add(d); } } catch { /* first run */ }
const f = await Deno.open(OUT, { create: true, append: true });
const enc = new TextEncoder();
const start = new Date("2018-01-01"), end = new Date();
let days = 0, rows = 0, misses = 0;
for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
  const dow = dt.getUTCDay(); if (dow === 0 || dow === 6) continue;
  const ds = dt.toISOString().slice(0, 10).replace(/-/g, "");
  if (have.has(ds)) continue;
  try {
    const r = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ds}.txt`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) { misses++; continue; }
    const txt = await r.text(); let batch = "";
    for (const line of txt.split("\n")) {
      const p = line.split("|"); if (p.length < 5 || !BOOK.has(p[1])) continue;
      const sv = +p[2], tv = +p[4]; if (!(tv > 0)) continue;
      batch += `${p[0]},${p[1]},${sv},${tv}\n`; rows++;
    }
    if (batch) await f.write(enc.encode(batch));
    days++;
    if (days % 100 === 0) console.log(`  ${days} days, ${rows} rows (at ${ds})`);
  } catch { misses++; }
}
f.close();
console.log(`DONE: ${days} new trading days, ${rows} rows → ${OUT} (misses/holidays: ${misses})`);
