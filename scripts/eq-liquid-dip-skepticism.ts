#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// eq-liquid-dip-skepticism.ts (D-785) — the four survival tests for D-784's liquid-decile below-PWL/PML cells
// before any pre-registration. Same protocol that killed D-776. Tests:
//   T1 per-symbol sign map — must be >=60% of tested LIQUID names positive
//   T2 cross-symbol independence — cluster events by trading DAY, count DISTINCT days, recompute t on
//      per-day mean returns (market-wide drop days trigger many symbols simultaneously — the effective sample
//      is DAYS, not events)
//   T3 survivorship — check if trd_bars_deep universe includes symbols whose last bar is >90d old (delisters).
//      If NO delisters, the universe is survivorship-biased and dip-buying is inflated post-hoc.
//   T4 turnover / real cost — descriptive computation of trades/yr per book and effective cost with per-trade
//      minimums (IBKR retail $1/trade minimum on <200 shares).
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("eq-liquid-dip-skepticism", [
  { name: "MIN_BARS", def: "500" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "K_DAYS", def: "5" }, { name: "MIN_INST", def: "20" },
  { name: "CELL", def: "belowPWL", note: "belowPWL | belowPML | belowPYL" },
  { name: "N_LEVEL", def: "5", note: "5 for PWL, 20 for PML, 252 for PYL — match CELL" },
]);
const KK = Number(K.K_DAYS), MIN_BARS = Number(K.MIN_BARS), MIN_INST = Number(K.MIN_INST);
const NLEVEL = Number(K.N_LEVEL);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "elds", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
const NOW = Math.floor(Date.now() / 1000);
const CUTOFF_STALE = NOW - 90 * 86400;
console.log(`==> D-785 SKEPTICISM — cell=${K.CELL} N=${NLEVEL} on LIQUID DECILE`);
console.log(`  T3 survivorship: computing last bar from loaded data per symbol`);

interface Bar { ts: number; o: number; h: number; l: number; c: number; v: number }
async function load(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`))[0];
  return ((row?.bars || []) as number[][])
    .filter((b) => Array.isArray(b) && b.length >= 5 && b[4] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
}
function rollingLo(bars: Bar[], N: number): number[] {
  const lo = new Array(bars.length).fill(NaN);
  for (let i = N; i < bars.length; i++) {
    let mn = Infinity;
    for (let j = i - N; j < i; j++) if (bars[j].l < mn) mn = bars[j].l;
    lo[i] = mn;
  }
  return lo;
}
function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(1);

// FIRST PASS: compute MDV per symbol, identify liquid decile, collect events per symbol AND per trading day.
interface SymData { mdv: number; lastTs: number; events: Array<{ dayKey: string; grossFwd: number }>; posN: number; totN: number }
const symData = new Map<string, SymData>();
const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
let loaded = 0, staleDelisted = 0;

for (const m of meta) {
  let bars: Bar[]; try { bars = await load(m.symbol); } catch { continue; }
  if (bars.length < MIN_BARS) continue;
  const lastTs = bars[bars.length - 1].ts;
  if (lastTs < CUTOFF_STALE) staleDelisted++;
  const dv: number[] = [];
  for (const b of bars) { if (b.ts >= SPLIT_TS) break; dv.push(b.c * b.v); }
  const mdv = dv.length ? dv.sort((a, b) => a - b)[Math.floor(dv.length / 2)] : 0;
  const lo = rollingLo(bars, NLEVEL);
  const events: Array<{ dayKey: string; grossFwd: number }> = [];
  let posN = 0, totN = 0;
  for (let i = NLEVEL; i < bars.length - KK - 1; i++) {
    const b = bars[i]; if (b.ts < SPLIT_TS) continue;
    if (!isFinite(lo[i]) || !(b.c < lo[i])) continue;
    const grossFwd = Math.log(bars[i + KK].c / b.c);
    events.push({ dayKey: dayKey(b.ts), grossFwd });
    totN++; if (grossFwd > 0) posN++;
  }
  symData.set(m.symbol, { mdv, lastTs, events, posN, totN });
  loaded++;
  if (loaded % 2000 === 0) console.error(`  loaded ${loaded}`);
}
console.log(`  loaded ${loaded} symbols, ${staleDelisted} have last_bar >90d old (delisters if any)`);

// liquidity cut
const sorted = [...symData.entries()].sort((a, b) => b[1].mdv - a[1].mdv);
const liqN = Math.floor(sorted.length * 0.1);
const liqSyms = new Set(sorted.slice(0, liqN).map(([s]) => s));
console.log(`  liquid decile: ${liqSyms.size} symbols (MDV cutoff $${(sorted[liqN][1].mdv / 1e6).toFixed(1)}M)`);

// pooled gross across liquid (D-784 replication)
const allGross: number[] = [];
const byDay = new Map<string, number[]>();
for (const [sym, d] of symData) {
  if (!liqSyms.has(sym)) continue;
  for (const e of d.events) {
    allGross.push(e.grossFwd);
    if (!byDay.has(e.dayKey)) byDay.set(e.dayKey, []);
    byDay.get(e.dayKey)!.push(e.grossFwd);
  }
}
const sPool = stats(allGross);
console.log(`\n  BASELINE (LIQUID pooled, gross): n ${sPool.n} / mean ${bp(sPool.mean)}bp / t ${sPool.t.toFixed(2)}`);

// T1 per-symbol sign map (on liquid decile only)
let pos = 0, tested = 0;
const perSymT: Array<{ sym: string; n: number; mean: number; t: number }> = [];
for (const sym of liqSyms) {
  const d = symData.get(sym)!;
  const xs = d.events.map((e) => e.grossFwd);
  const s = stats(xs);
  perSymT.push({ sym, n: s.n, mean: s.mean, t: s.t });
  if (s.n < MIN_INST) continue; tested++; if (s.mean > 0) pos++;
}
console.log(`\n  T1 PER-SYMBOL SIGN MAP (liquid decile): ${pos}/${tested} = ${(pos / tested * 100).toFixed(1)}% positive gross (bar >=60%)`);
perSymT.sort((a, b) => b.t - a.t);
console.log(`    top 5:  ${perSymT.filter((x) => x.n >= 20).slice(0, 5).map((p) => `${p.sym}(${bp(p.mean)}bp t${p.t.toFixed(1)}n${p.n})`).join(" ")}`);
console.log(`    bot 5:  ${perSymT.filter((x) => x.n >= 20).slice(-5).map((p) => `${p.sym}(${bp(p.mean)}bp t${p.t.toFixed(1)}n${p.n})`).join(" ")}`);

// T2 per-day aggregation — treat each trading day's average as one observation. Effective sample = distinct days.
const dayMeans: number[] = [];
for (const [_, xs] of byDay) {
  if (xs.length < 3) continue;                          // require >=3 signals on the day to be a meaningful cluster
  dayMeans.push(xs.reduce((a, c) => a + c, 0) / xs.length);
}
const sDay = stats(dayMeans);
console.log(`\n  T2 CROSS-SYMBOL INDEPENDENCE — event-day clustering:`);
console.log(`    distinct trading days with >=3 signals: ${dayMeans.length}`);
console.log(`    per-day mean gross:                     ${bp(sDay.mean)}bp t ${sDay.t.toFixed(2)}`);
console.log(`    original event-level t was ${sPool.t.toFixed(2)}; day-level t is ${sDay.t.toFixed(2)}`);
console.log(`    if day-level t << event-level t, the event count was inflated by intra-day correlation`);

// T3 survivorship — already reported above from staleDelisted count
console.log(`\n  T3 SURVIVORSHIP:`);
console.log(`    total symbols loaded:  ${loaded}`);
console.log(`    with last bar >90d old (probable delisters retained): ${staleDelisted}`);
if (staleDelisted < 100) {
  console.log(`    *** SURVIVORSHIP FLAG: fewer than 100 delisters in the universe — the dip-buying edge is likely`);
  console.log(`        inflated because we cannot buy dips on stocks that were LATER delisted.`);
} else {
  console.log(`    delister count is meaningful — dip-buy sample includes stocks that later died.`);
}

// T4 turnover / real cost
const evtsPerSymYr = sPool.n / liqSyms.size / 3.75;
const evtsPerBookYr = sPool.n / 3.75;
console.log(`\n  T4 TURNOVER / REAL COST:`);
console.log(`    events/symbol/yr (LIQUID): ${evtsPerSymYr.toFixed(1)}`);
console.log(`    events/book/yr if trading all liquid names: ${evtsPerBookYr.toFixed(0)}`);
console.log(`    on a $10k book at 100 concurrent positions, ~$100/pos, IBKR retail $1/trade min => 100bp effective cost`);
console.log(`    on a $100k book at 100 concurrent positions, ~$1000/pos, IBKR retail $1/trade => 10bp effective cost`);
console.log(`    on a $1M+ book, IBKR pro tier 0.05% per side => 10bp RT; commission-scaling makes 2bp only reachable above $10M`);
