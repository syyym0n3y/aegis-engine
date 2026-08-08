#!/usr/bin/env -S deno run --allow-net
// trd-orderflow — the ORDER-FLOW / CVD lens (R-003 #5), via the FREE path around the tick-data paywall:
// Binance klines carry takerBuyBaseVolume, so per-bar DELTA = 2*takerBuy − volume, and CVD = Σdelta —
// real order-flow WITHOUT paid tick data (crypto only; ES/NQ tick is still paid). Tests the R-002 CVD
// confidence lever: (1) does delta LEAD price? (2) delta-price DIVERGENCE (fade), (3) delta CONFIRMATION.
// Honest: cost, OOS split, shuffle null, report n. If CVD shows edge on free crypto, paying for futures
// tick becomes justified; if not, we save the money.

async function klines(sym: string, interval: string, pages: number) {
  const all: any[] = []; let endTime = Date.now();
  for (let p = 0; p < pages; p++) {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=1500&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const j = await r.json() as any[]; if (!Array.isArray(j) || !j.length) break;
    all.unshift(...j); endTime = j[0][0] - 1;
  }
  // dedup by openTime, sort
  const seen = new Set<number>(); const rows = all.filter((k) => (seen.has(k[0]) ? false : (seen.add(k[0]), true))).sort((a, b) => a[0] - b[0]);
  return rows.map((k) => { const vol = +k[5], takerBuy = +k[9], close = +k[4], open = +k[1]; return { close, ret: open > 0 ? close / open - 1 : 0, delta: 2 * takerBuy - vol, vol }; }).filter((x) => Number.isFinite(x.delta) && x.vol > 0);
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function corr(x: number[], y: number[]) { const n = Math.min(x.length, y.length); if (n < 5) return 0; const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0; }
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const COST = 0.0004;

function evalTrades(trade: number[], ppy: number, label: string) {
  if (trade.length < 30) { console.log(`     ${label}: n=${trade.length} (thin)`); return; }
  const mu = mean(trade), sd = std(trade) || 1, sh = (mu / sd) * Math.sqrt(ppy), t = mu / (sd / Math.sqrt(trade.length));
  const mid = Math.floor(trade.length * 0.6); const shf = (a: number[]) => (mean(a) / (std(a) || 1)) * Math.sqrt(ppy);
  const rnd = mulberry32(5); let beat = 0; const N = 1000; for (let k = 0; k < N; k++) { const rr = trade.map((x) => (rnd() < 0.5 ? x : -x)); if (shf(rr) >= sh) beat++; }
  console.log(`     ${label}: n=${trade.length} exp/bar ${mu >= 0 ? "+" : ""}${(mu * 100).toFixed(3)}% annSharpe ${sh.toFixed(2)} t=${t.toFixed(2)} | OOS ${shf(trade.slice(0, mid)).toFixed(2)}/${shf(trade.slice(mid)).toFixed(2)} | shuffleP ${(beat / N).toFixed(3)} ${mu > 0 && t > 2 && shf(trade.slice(0, mid)) > 0 && shf(trade.slice(mid)) > 0 ? "*** REAL" : ""}`);
}

for (const sym of ["BTCUSDT", "ETHUSDT"]) {
  const interval = "15m";
  const d = await klines(sym, interval, 3); // ~4500 bars ≈ 47 days
  if (d.length < 500) { console.log(`\n${sym}: only ${d.length} bars`); continue; }
  const days = d.length * 15 / 1440; const ppy = 96 * 365;
  console.log(`\n══ ${sym} ${interval} — ${d.length} bars (~${days.toFixed(0)}d) — order-flow / CVD (FREE, no tick data) ══`);
  const delta = d.map((x) => x.delta), ret = d.map((x) => x.ret);
  // normalize delta by rolling scale
  const dn = delta.map((x, i) => { const w = delta.slice(Math.max(0, i - 96), i).map(Math.abs); const s = mean(w) || 1; return x / s; });
  // 1. does delta LEAD price? corr(delta_t, ret_{t+1})
  console.log(`  1. corr(delta_t, ret_t)=${corr(delta, ret).toFixed(3)} (contemporaneous) | corr(delta_t, ret_t+1)=${corr(delta.slice(0, -1), ret.slice(1)).toFixed(3)} (predictive)`);
  // 2. CONFIRMATION: enter in direction of strong delta (|dn|>1), hold 1 bar
  const conf: number[] = []; for (let i = 1; i < d.length - 1; i++) if (Math.abs(dn[i]) > 1) conf.push(Math.sign(dn[i]) * ret[i + 1] - COST);
  // 3. DIVERGENCE: price up but delta down (or vice versa) → fade next bar
  const div: number[] = []; for (let i = 1; i < d.length - 1; i++) { if (ret[i] > 0 && dn[i] < -0.5) div.push(-1 * ret[i + 1] - COST); else if (ret[i] < 0 && dn[i] > 0.5) div.push(1 * ret[i + 1] - COST); }
  evalTrades(conf, ppy, "2. delta CONFIRMATION (trade with flow)");
  evalTrades(div, ppy, "3. delta DIVERGENCE (fade flow vs price)");
}
console.log(`\nRead: CVD from free klines IS the tick-data signal for crypto. If neither confirmation nor divergence`);
console.log(`beats the null + OOS after cost, the order-flow LENS is dead on crypto and paying for ES/NQ tick is NOT`);
console.log(`justified. If it survives, paying to extend it to futures becomes a warranted capital decision.`);
