#!/usr/bin/env -S deno run --allow-net
// trd-onchain — the ON-CHAIN FLOW lens (the honest "track the whales / cash into markets" test).
// Free data: stablecoin supply (USDT+USDC market cap = dry powder entering crypto) via CoinGecko,
// and BTC on-chain activity (active addresses, tx-USD) via Blockchain.com. Tests whether these FLOWS
// predict forward BTC returns — with a shuffle null + OOS. Guards against the survivorship trap
// ("kimchi made $40M") by requiring the signal to beat chance and hold out-of-sample, not anecdote.

async function cg(id: string): Promise<Map<string, number>> {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const m = new Map<string, number>();
  for (const [ms, v] of (j.market_caps ?? j.prices ?? [])) m.set(new Date(ms).toISOString().slice(0, 10), v);
  return m;
}
async function cgPrice(id: string): Promise<Map<string, number>> {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const m = new Map<string, number>();
  for (const [ms, v] of (j.prices ?? [])) m.set(new Date(ms).toISOString().slice(0, 10), v);
  return m;
}
async function bc(chart: string): Promise<Map<string, number>> {
  const r = await fetch(`https://api.blockchain.info/charts/${chart}?timespan=1year&format=json&cors=true`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const m = new Map<string, number>();
  for (const p of (j.values ?? [])) m.set(new Date(p.x * 1000).toISOString().slice(0, 10), p.y);
  return m;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function corr(x: number[], y: number[]) { const n = Math.min(x.length, y.length); if (n < 5) return 0; const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0; }
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const btc = await cgPrice("bitcoin");
const usdt = await cg("tether"); const usdc = await cg("usd-coin");
const active = await bc("n-unique-addresses"); const txusd = await bc("estimated-transaction-volume-usd");
const dates = [...btc.keys()].filter((d) => usdt.has(d) && usdc.has(d)).sort();
console.log(`\n[on-chain] ${dates.length} aligned days. Testing FLOW signals → BTC forward 7d return.\n`);

const H = 7; // forward horizon (days)
function testSignal(name: string, sigAt: (d: string, i: number) => number | null) {
  const rows: { sig: number; fwd: number }[] = [];
  for (let i = 7; i + H < dates.length; i++) {
    const s = sigAt(dates[i], i); if (s === null || !Number.isFinite(s)) continue;
    const p0 = btc.get(dates[i])!, p1 = btc.get(dates[i + H])!; if (!p0 || !p1) continue;
    rows.push({ sig: s, fwd: p1 / p0 - 1 });
  }
  if (rows.length < 40) { console.log(`  ${name}: ${rows.length} obs (thin)`); return; }
  const sg = rows.map((r) => r.sig), fw = rows.map((r) => r.fwd);
  const c = corr(sg, fw);
  const med = [...sg].sort((a, b) => a - b)[sg.length >> 1];
  const trade = rows.map((r) => Math.sign(r.sig - med) * r.fwd); // long BTC when signal above median
  const mu = mean(trade), t = mu / ((std(trade) || 1) / Math.sqrt(trade.length)), sh = (mu / (std(trade) || 1)) * Math.sqrt(52 / H * 7);
  const mid = Math.floor(trade.length * 0.6); const sh2 = (a: number[]) => (mean(a) / (std(a) || 1)) * Math.sqrt(52);
  const rnd = mulberry32(4); let beat = 0; const N = 1000; for (let k = 0; k < N; k++) { const rr = trade.map((x) => (rnd() < 0.5 ? x : -x)); if (sh2(rr) >= sh2(trade)) beat++; }
  console.log(`  ${name.padEnd(26)} n=${rows.length} corr(sig,fwd7d)=${c.toFixed(3)} | trade exp ${mu >= 0 ? "+" : ""}${(mu * 100).toFixed(2)}% t=${t.toFixed(2)} OOS ${sh2(trade.slice(0, mid)).toFixed(2)}/${sh2(trade.slice(mid)).toFixed(2)} shuffleP ${(beat / N).toFixed(3)} ${mu > 0 && t > 2 && sh2(trade.slice(0, mid)) > 0 && sh2(trade.slice(mid)) > 0 ? "*** REAL" : ""}`);
}
// 1. stablecoin supply 7d growth (dry powder entering)
const stable = (d: string) => (usdt.get(d) ?? 0) + (usdc.get(d) ?? 0);
testSignal("stablecoin-supply-7d-growth", (d, i) => { const prev = dates[i - 7]; const a = stable(d), b = stable(prev); return b > 0 ? a / b - 1 : null; });
// 2. active-address 7d growth (network demand)
testSignal("active-addr-7d-growth", (d, i) => { const prev = dates[i - 7]; const a = active.get(d), b = active.get(prev); return a && b ? a / b - 1 : null; });
// 3. on-chain tx-USD 7d growth (settlement flow)
testSignal("txvol-usd-7d-growth", (d, i) => { const prev = dates[i - 7]; const a = txusd.get(d), b = txusd.get(prev); return a && b ? a / b - 1 : null; });
console.log(`\nRead: an on-chain flow is tradeable only if it beats the shuffle null AND holds out-of-sample. Most`);
console.log(`whale/flow "signals" are already front-run by bots; the anecdotes (kimchi) are survivorship, not edge.`);
