#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-shortvol-signal — the first genuinely NON-PRICE signal test: FINRA daily short-sale volume.
// LITERATURE: Boehmer/Jones/Zhang (2008) "Which Shorts Are Informed?" — heavily shorted stocks underperform
// by 1.16% over 20 days (15.6% ann.); short volume ratio is a significant NEGATIVE return predictor.
// CAVEATS I must respect (stated up front, not after the result):
//   1. McLean & Pontiff: anomalies decay 26-58% POST-publication. Our data starts 2018 — entirely
//      post-publication — so we are testing the DECAYED version. That is the honest, tradable version.
//   2. FINRA short volume includes MARKET-MAKER HEDGING, not only directional bets → noisier than the
//      institutional short-sale data the original paper used.
// METHOD: SVR = shortVol/totalVol per symbol-day, converted to a trailing-60d PERCENTILE per symbol (SVR
// has a strong symbol-specific mean). Test forward 1/5/20d returns at SVR extremes, BOTH directions,
// Rule-7 random-controlled, IS/OOS split. Per ANALYSIS_CONTRACT.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const RCOST = 0.05; // R-units; SVR trades are daily-horizon, liquid names
const STOP_ATR = 2, ATRN = 14, NCTRL = 3;
let seed = 987654; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// ── load FINRA short volume ──
const svr = new Map<string, Map<string, number>>(); // sym -> date -> ratio
let rows = 0;
try {
  const txt = await Deno.readTextFile("data/finra/shortvol.csv");
  for (const l of txt.split("\n")) {
    const p = l.split(","); if (p.length < 4) continue;
    const d = `${p[0].slice(0, 4)}-${p[0].slice(4, 6)}-${p[0].slice(6, 8)}`, sym = p[1], sv = +p[2], tv = +p[3];
    if (!(tv > 0) || !Number.isFinite(sv)) continue;
    (svr.get(sym) ?? svr.set(sym, new Map()).get(sym)!).set(d, sv / tv); rows++;
  }
} catch { console.log("no data/finra/shortvol.csv — run scripts/fetch-finra-shortvol.ts first"); Deno.exit(1); }
const syms = [...svr.keys()];
console.log(`FINRA SHORT-VOLUME SIGNAL — ${rows.toLocaleString()} symbol-days across ${syms.length} instruments\n`);
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=1483228800&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; } catch { return []; } }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
interface T { r: number; is: boolean; ctrl: number[]; sym: string; pct: number; h: number }
const HZ = [1, 5, 20];
const store: Record<string, T[]> = {}; // key = `${dir}|h${h}|${bucket}`
const K = (dir: string, h: number, b: string) => `${dir}|h${h}|${b}`;
for (const dir of ["short", "long"]) for (const h of HZ) for (const b of ["top10", "top25", "bot25", "bot10"]) store[K(dir, h, b)] = [];

for (const sym of syms) {
  const bars = await daily(sym); if (bars.length < 300) continue;
  const m = svr.get(sym)!; const at = atr(bars, ATRN);
  const idx = new Map<string, number>(); bars.forEach((b, i) => idx.set(b.d, i));
  // build the SVR series aligned to bars, then trailing-60d percentile
  const series: (number | null)[] = bars.map((b) => m.get(b.d) ?? null);
  const cut = Math.floor(bars.length * 0.6);
  const pool: number[] = []; for (let i = 80; i < bars.length - 21; i++) pool.push(i);
  const priceR = (i: number, dir: 1 | -1, h: number): number | null => {
    const sd = STOP_ATR * at[i]; if (!(sd > bars[i].c * 1e-4) || i + h + 1 >= bars.length) return null;
    const entry = bars[i + 1].o, stop = entry - dir * sd; let r: number | null = null;
    for (let k = i + 1; k <= i + h; k++) { if (dir === 1 ? bars[k].l <= stop : bars[k].h >= stop) { r = -1; break; } }
    if (r === null) r = dir * (bars[i + h].c - entry) / sd;
    return Math.max(-1.5, Math.min(r, 15)) - RCOST;
  };
  for (let i = 80; i < bars.length - 21; i++) {
    const cur = series[i]; if (cur == null || !(at[i] > 0)) continue;
    const win: number[] = []; for (let k = i - 60; k < i; k++) { const v = series[k]; if (v != null) win.push(v); }
    if (win.length < 40) continue;
    const sorted = [...win].sort((a, b) => a - b); let rank = 0; while (rank < sorted.length && sorted[rank] < cur) rank++;
    const pct = rank / sorted.length;
    let bucket: string | null = null;
    if (pct >= 0.90) bucket = "top10"; else if (pct >= 0.75) bucket = "top25"; else if (pct <= 0.10) bucket = "bot10"; else if (pct <= 0.25) bucket = "bot25";
    if (!bucket) continue;
    for (const h of HZ) for (const [dname, dv] of [["short", -1], ["long", 1]] as [string, 1 | -1][]) {
      const r = priceR(i, dv, h); if (r === null) continue;
      const ctrl: number[] = []; for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; if (!(at[j] > 0)) continue; const rc = priceR(j, dv, h); if (rc !== null) ctrl.push(rc); }
      store[K(dname, h, bucket)].push({ r, is: i < cut, ctrl, sym, pct, h });
    }
  }
}
const rep = (t: T[], lbl: string) => { if (t.length < 100) { console.log(`  ${lbl.padEnd(30)} thin (n=${t.length})`); return null; } const g = edgeVsRandom(t.map((x) => x.r), t.flatMap((x) => x.ctrl)); const win = t.filter((x) => x.r > 0).length / t.length * 100; console.log(`  ${lbl.padEnd(30)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(7)}R win ${win.toFixed(0).padStart(2)}% vs-rand ${((g.edge >= 0 ? "+" : "") + g.edge.toFixed(3)).padStart(7)} t=${g.tStat.toFixed(2).padStart(6)} n=${String(t.length).padStart(6)} ${g.passes && g.setupMean > 0 ? "✓✓" : g.passes ? "✓(loses)" : "✗"}`); return g; };
console.log(`THE LITERATURE'S PREDICTION: HIGH short-volume → LOW future returns, i.e. SHORT at top-decile SVR should pay.\n`);
for (const h of HZ) {
  console.log(`══ horizon ${h}d ══`);
  for (const b of ["top10", "top25", "bot25", "bot10"]) rep(store[K("short", h, b)], `SHORT @ SVR ${b}`);
  for (const b of ["top10", "bot10"]) rep(store[K("long", h, b)], `LONG  @ SVR ${b}`);
}
console.log(`\n════ OUT-OF-SAMPLE ONLY (the decisive test) ════`);
for (const h of HZ) { console.log(`══ horizon ${h}d (OOS) ══`); for (const b of ["top10", "bot10"]) { rep(store[K("short", h, b)].filter((x) => !x.is), `SHORT @ SVR ${b} [OOS]`); rep(store[K("long", h, b)].filter((x) => !x.is), `LONG  @ SVR ${b} [OOS]`); } }
console.log(`\nNOTE: data is 2018+ = entirely POST-publication of Boehmer et al. Per McLean & Pontiff (26-58% decay)`);
console.log(`we expect an attenuated effect; what survives here is the TRADABLE remainder, not the paper's headline.`);
