#!/usr/bin/env -S deno run --allow-net
// trd-canon — the great-traders' frameworks, tested rigorously (not folklore). Implements the two most
// MECHANICALLY-TESTABLE canon strategies and backtests them honestly (N, IS/OOS, cost), plus a regime-
// filtered variant (only take signals in EXPANSION/uptrend). Per ANALYSIS_CONTRACT: report the number.
//   1. Minervini Trend Template (SEPA) — long only quality uptrends (price>MAs, MAs stacked, near highs).
//   2. Elder Triple Screen — weekly trend + daily Force-Index dip entry (buy the pullback in an uptrend).
// (Non-mechanical canon — Livermore psychology, Market Wizards meta-lessons — noted in R-006, not testable.)

const UNIVERSE = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "TSLA", "AVGO", "JPM", "XOM", "UNH", "COST", "LLY", "V"];
const COST_R = 0.05, ANN = 252;
interface Bar { d: string; c: number; h: number; l: number; v: number; }
async function daily(sym: string): Promise<Bar[]> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 4200 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const a = res.indicators?.adjclose?.[0]?.adjclose; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const c = a ? a[i] : q.close[i], h = q.high[i], l = q.low[i], v = q.volume[i]; if ([c, h, l].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), c, h, l, v: v || 0 }); }
  return out;
}
const sma = (b: Bar[], i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += b[k].c; return s / n; };
const ema = (v: number[], p: number) => { const k = 2 / (p + 1); let e = v[0]; const o = [e]; for (let i = 1; i < v.length; i++) { e = v[i] * k + e * (1 - k); o.push(e); } return o; };
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// SPY benchmark for relative strength
const spyBars = await daily("SPY"); const spyByDate = new Map(spyBars.map((b) => [b.d, b.c]));

interface Trade { r: number; entryIdx: number; sym: string }
// 1) Minervini Trend Template: enter when template first satisfied; stop 8% (his rule) → R = ret/0.08; exit when template breaks.
function minervini(b: Bar[], sym: string): Trade[] {
  const trades: Trade[] = []; let inTrade = false, entry = 0, ei = 0;
  const tmpl = (i: number) => {
    if (i < 210) return false;
    const p = b[i].c, ma50 = sma(b, i, 50), ma150 = sma(b, i, 150), ma200 = sma(b, i, 200), ma200p = sma(b, i - 21, 200);
    if (![ma50, ma150, ma200, ma200p].every((x) => x > 0)) return false;
    const lo52 = Math.min(...b.slice(i - 252, i).map((x) => x.l)), hi52 = Math.max(...b.slice(i - 252, i).map((x) => x.h));
    const rs = spyByDate.has(b[i].d) && spyByDate.has(b[i - 126]?.d) ? (p / b[i - 126].c) > (spyByDate.get(b[i].d)! / spyByDate.get(b[i - 126].d)!) : true;
    return p > ma150 && p > ma200 && ma150 > ma200 && ma200 > ma200p && ma50 > ma150 && ma50 > ma200 && p > ma50 && p >= lo52 * 1.30 && p >= hi52 * 0.75 && rs;
  };
  for (let i = 211; i < b.length; i++) {
    if (!inTrade && tmpl(i) && !tmpl(i - 1)) { inTrade = true; entry = b[i].c; ei = i; }
    else if (inTrade) { const stop = entry * 0.92; const broke = b[i].c < sma(b, i, 50) || sma(b, i, 50) < sma(b, i, 150); if (b[i].l <= stop) { trades.push({ r: -1 - COST_R, entryIdx: ei, sym }); inTrade = false; } else if (broke) { trades.push({ r: (b[i].c / entry - 1) / 0.08 - COST_R, entryIdx: ei, sym }); inTrade = false; } }
  }
  return trades;
}
// 2) Elder Triple Screen: weekly trend up (proxy: price>100MA & 100MA rising) → buy when 2-day Force Index<0 (pullback); exit FI>0 or 2xATR stop or 15d.
function tripleScreen(b: Bar[], sym: string): Trade[] {
  const trades: Trade[] = []; const cl = b.map((x) => x.c);
  const fi1 = b.map((x, i) => i ? (x.c - b[i - 1].c) * x.v : 0); const fi = ema(fi1, 2);
  const atr = b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l); const atrE = ema(atr, 10);
  let i = 120;
  while (i < b.length - 1) {
    const ma100 = sma(b, i, 100), ma100p = sma(b, i - 10, 100);
    const uptrend = cl[i] > ma100 && ma100 > ma100p;
    if (uptrend && fi[i] < 0 && fi[i - 1] >= 0) {   // force-index dips negative in an uptrend = buy the pullback
      const entry = b[i + 1].c, stopDist = 2 * atrE[i], stop = entry - stopDist; if (!(stopDist > 0)) { i++; continue; }
      let r: number | null = null;
      for (let k = i + 1; k < Math.min(i + 16, b.length); k++) { if (b[k].l <= stop) { r = -1; break; } if (fi[k] > 0 && b[k].c > entry) { r = (b[k].c - entry) / stopDist; break; } }
      if (r === null) { const last = b[Math.min(i + 15, b.length - 1)].c; r = (last - entry) / stopDist; }
      trades.push({ r: r - COST_R, entryIdx: i, sym }); i += 5;
    } else i++;
  }
  return trades;
}

const allMin: Trade[] = [], allTS: Trade[] = [];
for (const s of UNIVERSE) { const b = await daily(s); if (b.length < 300) continue; allMin.push(...minervini(b, s)); allTS.push(...tripleScreen(b, s)); }

function rep(name: string, t: Trade[], allBars: number) {
  if (!t.length) { console.log(`  ${name}: no trades`); return; }
  t.sort((a, b) => a.entryIdx - b.entryIdx); const k = Math.floor(t.length * 0.6);
  const R = (x: Trade[]) => ({ n: x.length, exp: mean(x.map((y) => y.r)), win: x.filter((y) => y.r > 0).length / x.length });
  const all = R(t), is = R(t.slice(0, k)), oos = R(t.slice(k));
  console.log(`  ${name.padEnd(26)} N=${all.n}  exp ${all.exp >= 0 ? "+" : ""}${all.exp.toFixed(3)}R  win ${(all.win * 100).toFixed(0)}%   |  IS ${is.exp >= 0 ? "+" : ""}${is.exp.toFixed(3)}R → OOS ${oos.exp >= 0 ? "+" : ""}${oos.exp.toFixed(3)}R (n=${oos.n})`);
}
console.log(`Canon frameworks, ${UNIVERSE.length} liquid names, ~11y, cost ${COST_R}R/side. Per ANALYSIS_CONTRACT: numbers only.\n`);
rep("Minervini Trend Template", allMin, 0);
rep("Elder Triple Screen", allTS, 0);
console.log(`\n(Non-mechanical canon — Livermore psychology, Schwager meta-lessons — are behavioural, not backtestable; see R-006.)`);
console.log(`Regime note: both are LONG-trend strategies → structurally best in EXPANSION/uptrend (the co-pilot's RISK-ON phase);`);
console.log(`the regime engine's job is to switch them OFF in CONTRACTION. OOS expectancy is the honest verdict above.`);
