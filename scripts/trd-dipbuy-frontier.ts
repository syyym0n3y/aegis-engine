#!/usr/bin/env -S deno run --allow-net
// trd-dipbuy-frontier — the survivor (dip-buy RSI14<30 in uptrend) fires only ~14×/yr across 45 instruments,
// too thin to compound. Question: what makes it fire MORE without trading the edge away? Sweep the parameter
// space — RSI period, oversold threshold, trend filter, and alternative oversold measures — and for EVERY
// variant report BOTH frequency (fires/yr) AND the Rule-7 gate (edge vs matched random control). The output
// is a FRONTIER: which relaxations keep the edge, which dissolve it into drift.
// Free Yahoo daily, full history, 45 instruments. Per ANALYSIS_CONTRACT rules 1-7.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14, NCTRL = 3;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 31337; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

// ── variant grid ──
interface V { name: string; rsiN: number; thr: number; trendMA: number | null; group: string }
const VARIANTS: V[] = [];
// (a) threshold relaxation on RSI14 (the survivor's family) — the direct frequency lever
for (const thr of [25, 30, 35, 40, 45]) VARIANTS.push({ name: `RSI14<${thr} >200MA`, rsiN: 14, thr, trendMA: 200, group: "threshold" });
// (b) faster RSI — fires far more often, same idea
for (const [n, thr] of [[2, 5], [2, 10], [2, 20], [5, 10], [5, 20], [5, 30]] as [number, number][]) VARIANTS.push({ name: `RSI${n}<${thr} >200MA`, rsiN: n, thr, trendMA: 200, group: "fast-rsi" });
// (c) looser / tighter trend filter
for (const ma of [50, 100, 200]) VARIANTS.push({ name: `RSI14<35 >${ma}MA`, rsiN: 14, thr: 35, trendMA: ma, group: "trend-filter" });
VARIANTS.push({ name: `RSI14<35 no-trend`, rsiN: 14, thr: 35, trendMA: null, group: "trend-filter" });
// (d) the two best frequency levers combined
for (const [n, thr] of [[2, 20], [5, 30]] as [number, number][]) for (const ma of [50, 100]) VARIANTS.push({ name: `RSI${n}<${thr} >${ma}MA`, rsiN: n, thr, trendMA: ma, group: "combined" });

const S: Record<string, number[]> = {}, C: Record<string, number[]> = {}, FIRES: Record<string, number> = {};
for (const v of VARIANTS) { S[v.name] = []; C[v.name] = []; FIRES[v.name] = 0; }
let totalYears = 0;
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  totalYears += b.length / 252;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN);
  const rs: Record<number, number[]> = { 2: rsi(cl, 2), 5: rsi(cl, 5), 14: rsi(cl, 14) };
  const sma = (i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += cl[k]; return s / n; };
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - H - 1; i++) { const v = vix.get(b[i].d) ?? 15; byReg[v < 15 ? "calm" : v < 25 ? "norm" : "stress"].push(i); }
  const price = (i: number, reg: string): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) if (b[k].l <= stop) { r = -1; break; } if (r === null) r = (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[reg]; };
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0)) continue;
    const v = vix.get(b[i].d) ?? 15; const reg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    let cached: number | null | undefined;
    for (const va of VARIANTS) {
      const rv = rs[va.rsiN][i]; if (!Number.isFinite(rv) || rv >= va.thr) continue;
      if (va.trendMA !== null) { const m = sma(i, va.trendMA); if (!(m > 0) || !(cl[i] > m)) continue; }
      if (cached === undefined) cached = price(i, reg);
      const r = cached; if (r === null) continue;
      S[va.name].push(r); FIRES[va.name]++;
      const pool = byReg[reg]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = price(j, reg); if (rc !== null) C[va.name].push(rc); }
    }
  }
}
console.log(`DIP-BUY FREQUENCY FRONTIER — ${UNIVERSE.length} instruments, ~${Math.round(totalYears)} instrument-years. Baseline survivor = RSI14<30 >200MA.\n`);
console.log(`${"variant".padEnd(22)} ${"fires".padStart(7)} ${"/yr".padStart(6)} ${"setup R".padStart(8)} ${"rand R".padStart(8)} ${"edge".padStart(7)} ${"t".padStart(7)}  verdict`);
interface Row { name: string; group: string; fires: number; perYr: number; sm: number; edge: number; t: number; ok: boolean }
const rows: Row[] = [];
for (const g of ["threshold", "fast-rsi", "trend-filter", "combined"]) {
  console.log(`── ${g} ──`);
  for (const va of VARIANTS.filter((x) => x.group === g)) {
    const gate = edgeVsRandom(S[va.name], C[va.name]);
    const perYr = FIRES[va.name] / (totalYears / UNIVERSE.length * UNIVERSE.length) * UNIVERSE.length / UNIVERSE.length; // fires per instrument-year
    const py = FIRES[va.name] / totalYears * 45; // fires/yr across the 45-instrument book
    const ok = gate.passes && gate.setupMean > 0;
    rows.push({ name: va.name, group: g, fires: FIRES[va.name], perYr: py, sm: gate.setupMean, edge: gate.edge, t: gate.tStat, ok });
    console.log(`${va.name.padEnd(22)} ${String(FIRES[va.name]).padStart(7)} ${py.toFixed(1).padStart(6)} ${((gate.setupMean >= 0 ? "+" : "") + gate.setupMean.toFixed(3)).padStart(8)} ${((gate.controlMean >= 0 ? "+" : "") + gate.controlMean.toFixed(3)).padStart(8)} ${((gate.edge >= 0 ? "+" : "") + gate.edge.toFixed(3)).padStart(7)} ${gate.tStat.toFixed(2).padStart(7)}  ${ok ? "✓✓ KEEPS EDGE + PROFITABLE" : gate.passes ? "✓ beats random but loses money" : "✗ edge dissolved"}`);
  }
}
const keep = rows.filter((r) => r.ok).sort((a, b) => b.perYr - a.perYr);
console.log(`\n════ FRONTIER: variants that KEEP the edge (beat random AND profitable), by frequency ════`);
for (const r of keep) console.log(`   ${r.name.padEnd(22)} ${r.perYr.toFixed(1).padStart(6)} fires/yr   ${(r.sm >= 0 ? "+" : "") + r.sm.toFixed(3)}R   t=${r.t}   ${(r.perYr / (rows.find((x) => x.name === "RSI14<30 >200MA")?.perYr ?? 1)).toFixed(1)}× baseline frequency`);
if (!keep.length) console.log(`   none — every relaxation dissolved the edge.`);
