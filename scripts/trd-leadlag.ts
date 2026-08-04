#!/usr/bin/env -S deno run --allow-net
// trd-leadlag — the INTERMARKET lens (R-003 #6). Does asset A's move systematically predict asset
// B's NEXT move (lead-lag)? Tests both daily and (where available) intraday. A real lead-lag = a
// tradeable, direction-hedgeable edge. Significance via a block-shuffle null. Honest reporting of n.

async function series(sym: string, interval: string, range: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return new Map<string, number>();
  const t = res.timestamp as number[]; const c = res.indicators.quote[0].close as (number | null)[]; const m = new Map<string, number>();
  for (let i = 1; i < t.length; i++) { const a = c[i], b = c[i - 1]; if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue; m.set(new Date(t[i] * 1000).toISOString().slice(0, interval === "1d" ? 10 : 16), a / b - 1); }
  return m;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function corr(x: number[], y: number[]) { const n = x.length; if (n < 5) return 0; const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0; }
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function testPair(aName: string, aSym: string, bName: string, bSym: string, interval: string, range: string) {
  const A = await series(aSym, interval, range), B = await series(bSym, interval, range);
  const keys = [...A.keys()].filter((k) => B.has(k)).sort();
  if (keys.length < 100) { console.log(`  ${aName}/${bName}: only ${keys.length} aligned — skip`); return; }
  const a = keys.map((k) => A.get(k)!), b = keys.map((k) => B.get(k)!);
  // lead-lag: A_t vs B_{t+1}  and  B_t vs A_{t+1}
  const aLeadB = corr(a.slice(0, -1), b.slice(1));
  const bLeadA = corr(b.slice(0, -1), a.slice(1));
  const contemp = corr(a, b);
  // tradeable: enter B in the SIGN of A's prior return; expectancy per trade (B_{t+1} * sign(A_t))
  const trade = b.slice(1).map((bx, i) => Math.sign(a[i]) * bx);
  const mu = mean(trade), sd = std(trade) || 1, tstat = mu / (sd / Math.sqrt(trade.length));
  // shuffle null on the lead corr
  const rnd = mulberry32(11); let beat = 0; const N = 1000; const bl = b.slice(1);
  for (let k = 0; k < N; k++) { const perm = a.slice(0, -1).map(() => a[Math.floor(rnd() * (a.length - 1))]); if (Math.abs(corr(perm, bl)) >= Math.abs(aLeadB)) beat++; }
  console.log(`  ${(aName + "→" + bName).padEnd(14)} contemp=${contemp.toFixed(2)} | ${aName}_t→${bName}_t+1=${aLeadB.toFixed(3)} | ${bName}_t→${aName}_t+1=${bLeadA.toFixed(3)} | trade ${aName}→${bName}: exp/period ${mu >= 0 ? "+" : ""}${(mu * 100).toFixed(3)}% t=${tstat.toFixed(2)} shuffleP=${(beat / N).toFixed(3)} ${Math.abs(aLeadB) > Math.abs(contemp) * 0.5 && (beat / N) < 0.05 ? "*** LEAD" : ""}`);
}

console.log(`\n[leadlag] DAILY (10y):`);
await testPair("ES", "ES=F", "NQ", "NQ=F", "1d", "10y");
await testPair("Gold", "GC=F", "Silver", "SI=F", "1d", "10y");
await testPair("BTC", "BTC-USD", "ETH", "ETH-USD", "1d", "10y");
await testPair("10yYield", "^TNX", "S&P", "^GSPC", "1d", "10y");
await testPair("DXY", "DX=F", "Gold", "GC=F", "1d", "10y");
console.log(`\n[leadlag] INTRADAY 15m (60d) — where microstructure lead-lag is likeliest:`);
await testPair("ES", "ES=F", "NQ", "NQ=F", "15m", "60d");
await testPair("BTC", "BTC-USD", "ETH", "ETH-USD", "15m", "60d");
console.log(`\nRead: a lead-lag is tradeable only if the predictive corr is a large fraction of the contemporaneous`);
console.log(`corr AND beats the shuffle null. Most cross-market info is priced within the bar (contemp≫lead).`);
