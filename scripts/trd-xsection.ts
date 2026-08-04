#!/usr/bin/env -S deno run --allow-net
// trd-xsection — a NEW lens the engine has never used: CROSS-SECTIONAL relative value. Everything
// before was single-instrument/directional. This ranks a BASKET by trailing relative strength and
// goes long the leaders / short the laggards (dollar-neutral) — the dimension where real, hard-to-
// arbitrage edges live (it IS the momentum factor, WML, that cleared our gate). Tests both momentum
// (long strong) and reversal (long weak), honestly: Sharpe, OOS split, and a shuffle null.

async function daily(sym: string): Promise<{ d: string; c: number }[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const c = res.indicators.quote[0].close as (number | null)[]; const out: { d: string; c: number }[] = [];
  for (let i = 0; i < t.length; i++) if (c[i] != null && Number.isFinite(c[i])) out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), c: c[i]! });
  return out;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function run(name: string, syms: string[], lookback: number, hold: number, topK: number) {
  const series = new Map<string, Map<string, number>>();
  let dates: string[] | null = null;
  for (const s of syms) { const b = await daily(s); const m = new Map(b.map((x) => [x.d, x.c])); series.set(s, m); const ds = b.map((x) => x.d); dates = dates ? dates.filter((d) => m.has(d)) : ds; }
  dates = (dates ?? []).sort();
  if (dates.length < lookback + hold + 60) { console.log(`\n${name}: too little aligned history (${dates.length})`); return; }
  // at each rebalance i, rank by trailing `lookback` return, hold `hold` days
  const momR: number[] = [], revR: number[] = [];
  for (let i = lookback; i + hold < dates.length; i += hold) {
    const now = dates[i], past = dates[i - lookback], fut = dates[i + hold];
    const rank: { s: string; ret: number }[] = [];
    for (const s of syms) { const m = series.get(s)!; const pn = m.get(now), pp = m.get(past), pf = m.get(fut); if (pn && pp && pf) rank.push({ s, ret: pn / pp - 1 }); }
    if (rank.length < 2 * topK) continue;
    rank.sort((a, b) => b.ret - a.ret);
    const strong = rank.slice(0, topK), weak = rank.slice(-topK);
    const fwd = (s: string) => { const m = series.get(s)!; return m.get(dates![i + hold])! / m.get(dates![i])! - 1; };
    const longStrong = mean(strong.map((x) => fwd(x.s))), longWeak = mean(weak.map((x) => fwd(x.s)));
    momR.push(longStrong - longWeak);  // momentum: long leaders, short laggards
    revR.push(longWeak - longStrong);  // reversal: the opposite
  }
  const ppy = 252 / hold;
  const rep = (label: string, r: number[]) => {
    const mu = mean(r), sd = std(r) || 1, sh = (mu / sd) * Math.sqrt(ppy), t = mu / (sd / Math.sqrt(r.length));
    const mid = Math.floor(r.length * 0.6);
    const sh2 = (rr: number[]) => (mean(rr) / (std(rr) || 1)) * Math.sqrt(ppy);
    // shuffle null: random long/short each period → distribution of Sharpe
    const rnd = mulberry32(7); let beat = 0; const N = 500;
    for (let k = 0; k < N; k++) { const rs = r.map((x) => (rnd() < 0.5 ? x : -x)); if (sh2(rs) >= sh) beat++; }
    console.log(`   ${label.padEnd(9)} n=${r.length} annSharpe=${sh.toFixed(2)} t=${t.toFixed(2)} | OOS Sharpe ${sh2(r.slice(0, mid)).toFixed(2)}/${sh2(r.slice(mid)).toFixed(2)} | shuffle p=${(beat / N).toFixed(3)}`);
  };
  console.log(`\n══ ${name} — ${syms.length} names, rank by ${lookback}d, hold ${hold}d, top/bottom ${topK} (dollar-neutral) ══`);
  rep("momentum", momR); rep("reversal", revR);
}

const SECTORS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"];
const CRYPTO = ["BTC-USD", "ETH-USD", "SOL-USD", "LTC-USD", "BNB-USD", "XRP-USD", "ADA-USD", "DOGE-USD"];
const INDEX = ["ES=F", "NQ=F", "YM=F", "RTY=F"];
await run("US Sectors", SECTORS, 63, 21, 3);   // classic 3m-momentum, monthly hold
await run("Crypto majors", CRYPTO, 30, 7, 2);  // faster crypto
await run("Index futures (ES/NQ/YM/RTY)", INDEX, 21, 5, 1);
console.log(`\nRead: annSharpe beating the shuffle null (p<0.05) AND positive in BOTH OOS halves = a real cross-sectional`);
console.log(`edge. This lens is dollar-neutral (market-direction-hedged) — an uncontrollable turned into an instrument.`);
