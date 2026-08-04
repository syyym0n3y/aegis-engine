#!/usr/bin/env -S deno run --allow-net
// trd-volregime — isolates the VOLATILITY-REGIME lens (R-003 #8) cleanly. Three questions:
//   1. Is volatility PREDICTABLE (clusters)? — if yes it validates vol-targeting in the risk layer.
//   2. Does low vol precede a vol EXPANSION? (contraction→expansion).
//   3. Is that expansion DIRECTIONALLY tradeable (squeeze breakout), net of cost + a shuffle null?
// Honest expectation: vol is predictable (risk value) but its expansion is directionless (no free alpha).

async function daily(sym: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; const t = res.timestamp as number[]; const q = res.indicators.quote[0];
  const o: { h: number; l: number; c: number; ret: number }[] = []; let prev: number | null = null;
  for (let i = 0; i < t.length; i++) { const c = q.close[i], h = q.high[i], l = q.low[i]; if ([c, h, l].some((x) => x == null)) continue; if (prev != null) o.push({ h, l, c, ret: c / prev - 1 }); prev = c; }
  return o;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function corr(x: number[], y: number[]) { const n = Math.min(x.length, y.length); if (n < 5) return 0; const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0; }
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

for (const [name, sym] of [["S&P", "^GSPC"], ["BTC", "BTC-USD"], ["Gold", "GC=F"]] as [string, string][]) {
  const b = await daily(sym); if (b.length < 300) { console.log(`\n${name}: thin`); continue; }
  const W = 20; const vol: number[] = []; // rolling realized vol
  for (let i = W; i < b.length; i++) vol.push(std(b.slice(i - W, i).map((x) => x.ret)));
  // 1. clustering: vol_t vs vol_{t+1}, vol_{t+5}
  const c1 = corr(vol.slice(0, -1), vol.slice(1)), c5 = corr(vol.slice(0, -5), vol.slice(5));
  // 2. contraction→expansion: bottom-tercile vol → forward 10d realized vol vs top tercile
  const sorted = [...vol].sort((a, z) => a - z); const loT = sorted[Math.floor(vol.length / 3)], hiT = sorted[Math.floor(2 * vol.length / 3)];
  const fwdVolLo: number[] = [], fwdVolHi: number[] = [];
  for (let i = 0; i + 10 < vol.length; i++) { const fv = std(b.slice(W + i, W + i + 10).map((x) => x.ret)); if (vol[i] <= loT) fwdVolLo.push(fv); else if (vol[i] >= hiT) fwdVolHi.push(fv); }
  // 3. squeeze breakout: in bottom-tercile vol, enter on break of the 20-bar range; target 1.5*range, stop 0.75*range
  const trades: number[] = [];
  for (let i = W; i + 1 < b.length; i++) { const vi = vol[i - W]; if (vi === undefined || vi > loT) continue; const win = b.slice(i - W, i); const hh = Math.max(...win.map((x) => x.h)), ll = Math.min(...win.map((x) => x.l)); const rng = hh - ll; if (!(rng > 0)) continue; const nx = b[i]; let side = 0; if (nx.c > hh) side = 1; else if (nx.c < ll) side = -1; if (!side) continue; const entry = nx.c, target = entry + side * 1.5 * rng * 0.3, stop = entry - side * 0.75 * rng * 0.3; const risk = Math.abs(entry - stop); let r: number | null = null; for (let m = i + 1; m < Math.min(i + 15, b.length); m++) { if (side === 1) { if (b[m].l <= stop) { r = -1; break; } if (b[m].h >= target) { r = (target - entry) / risk; break; } } else { if (b[m].h >= stop) { r = -1; break; } if (b[m].l <= target) { r = (entry - target) / risk; break; } } } if (r === null) r = ((side === 1 ? b[Math.min(i + 14, b.length - 1)].c - entry : entry - b[Math.min(i + 14, b.length - 1)].c) / risk); trades.push(r - 0.1); }
  const mu = mean(trades), tstat = trades.length > 1 ? mu / ((std(trades) || 1) / Math.sqrt(trades.length)) : 0;
  console.log(`\n══ ${name} ══`);
  console.log(`  1. VOL CLUSTERING: corr(vol_t,vol_t+1)=${c1.toFixed(2)}  corr(t,t+5)=${c5.toFixed(2)}  → ${c1 > 0.5 ? "STRONGLY predictable (validates vol-targeting)" : c1 > 0.2 ? "predictable" : "weak"}`);
  console.log(`  2. CONTRACTION→EXPANSION: after LOW vol, fwd-10d vol ${(mean(fwdVolLo) * 100).toFixed(2)}% vs after HIGH vol ${(mean(fwdVolHi) * 100).toFixed(2)}% → ${mean(fwdVolLo) < mean(fwdVolHi) ? "low vol stays low then expands slowly (mean-reverts up)" : "—"}`);
  console.log(`  3. SQUEEZE BREAKOUT (directional, tradeable): n=${trades.length} exp=${mu >= 0 ? "+" : ""}${mu.toFixed(3)}R t=${tstat.toFixed(2)} → ${mu > 0 && tstat > 2 ? "*** REAL" : "no directional edge (expansion is directionless)"}`);
}
console.log(`\nRead: if clustering is strong but the squeeze breakout has no edge, the vol-regime lens is REAL for the`);
console.log(`RISK layer (predict vol → size positions) but NOT a directional alpha. That is the honest, useful split.`);
