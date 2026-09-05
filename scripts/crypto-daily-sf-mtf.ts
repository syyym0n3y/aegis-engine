#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// crypto-daily-sf-mtf.ts (D-788) — 510-symbol survivorship-free crypto perp DAILY panel test of the
// D-785 belowPML LIQUID cell. Same protocol: close < prior 20-day low → LONG at close, exit K=5 days,
// cost 7bp RT crypto. Liquidity stratified. Day-clustered t. Cross-symbol sign map. Era decomposition.
// If it replicates: cross-asset-class evidence for the equity finding.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("crypto-daily-sf-mtf", [
  { name: "MIN_BARS", def: "300" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "K_DAYS", def: "5" }, { name: "N_LEVEL", def: "20" },
  { name: "RT_BP", def: "7" }, { name: "MIN_INST", def: "20" },
]);
const KK = Number(K.K_DAYS), MIN_BARS = Number(K.MIN_BARS), NLEVEL = Number(K.N_LEVEL);
const RT = Number(K.RT_BP) / 1e4, MIN_INST = Number(K.MIN_INST);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cdm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const meta = await q(`trd_bars_intraday?tf=eq.1dSF&n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as
  { symbol: string; n_bars: number }[];
console.log(`==> D-788 CRYPTO DAILY SF — ${meta.length} symbols with n_bars>=${MIN_BARS}`);
assertNonEmpty("meta", meta, 50);

interface Bar { ts: number; o: number; h: number; l: number; c: number; v: number }
async function load(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1dSF&select=bars`))[0];
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
const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

// pass 1: MDV + events per symbol per day
interface SymData { mdv: number; events: Array<{ dayKey: string; net: number; year: number }>; posN: number; totN: number }
const symData = new Map<string, SymData>();
let loaded = 0;
for (const m of meta) {
  let bars: Bar[]; try { bars = await load(m.symbol); } catch { continue; }
  if (bars.length < MIN_BARS) continue;
  const dv: number[] = [];
  for (const b of bars) { if (b.ts >= SPLIT_TS) break; dv.push(b.c * b.v); }
  const mdv = dv.length ? dv.sort((a, b) => a - b)[Math.floor(dv.length / 2)] : 0;
  const lo = rollingLo(bars, NLEVEL);
  const events: Array<{ dayKey: string; net: number; year: number }> = [];
  let posN = 0, totN = 0;
  for (let i = NLEVEL; i < bars.length - KK - 1; i++) {
    const b = bars[i]; if (b.ts < SPLIT_TS) continue;
    if (!isFinite(lo[i]) || !(b.c < lo[i])) continue;
    const net = Math.log(bars[i + KK].c / b.c) - RT;
    events.push({ dayKey: dayKey(b.ts), net, year: new Date(b.ts * 1000).getUTCFullYear() });
    totN++; if (net > 0) posN++;
  }
  symData.set(m.symbol, { mdv, events, posN, totN });
  loaded++;
  if (loaded % 100 === 0) console.error(`  loaded ${loaded}/${meta.length}`);
}
console.log(`  loaded ${loaded} symbols`);

// liquid decile
const sorted = [...symData.entries()].sort((a, b) => b[1].mdv - a[1].mdv);
const liqN = Math.floor(sorted.length * 0.1);
const liqSyms = new Set(sorted.slice(0, liqN).map(([s]) => s));
console.log(`  liquid decile: ${liqSyms.size} symbols, MDV cutoff $${(sorted[liqN][1].mdv / 1e6).toFixed(2)}M`);

// pooled + day-cluster + per-symbol on LIQUID
const allNet: number[] = [];
const byDay = new Map<string, number[]>();
const byYear = new Map<number, number[]>();
for (const sym of liqSyms) {
  const d = symData.get(sym)!;
  for (const e of d.events) {
    allNet.push(e.net);
    if (!byDay.has(e.dayKey)) byDay.set(e.dayKey, []);
    byDay.get(e.dayKey)!.push(e.net);
    if (!byYear.has(e.year)) byYear.set(e.year, []);
    byYear.get(e.year)!.push(e.net);
  }
}
const sPool = stats(allNet);
console.log(`\n  BASELINE (LIQUID pooled, net of ${(RT * 1e4).toFixed(0)}bp): n ${sPool.n} / mean ${bp(sPool.mean)}bp / t ${sPool.t.toFixed(2)}`);

// T1 per-symbol sign
let pos = 0, tested = 0;
for (const sym of liqSyms) {
  const d = symData.get(sym)!;
  const xs = d.events.map((e) => e.net);
  const s = stats(xs);
  if (s.n < MIN_INST) continue; tested++; if (s.mean > 0) pos++;
}
console.log(`  T1 per-symbol sign: ${pos}/${tested} = ${(pos / tested * 100).toFixed(1)}%`);

// T2 day-cluster
const dayMeans: number[] = [];
for (const [_, xs] of byDay) if (xs.length >= 1) dayMeans.push(xs.reduce((a, c) => a + c, 0) / xs.length);
const sDay = stats(dayMeans);
console.log(`  T2 day-clustered: ${dayMeans.length} distinct days, mean ${bp(sDay.mean)}bp t ${sDay.t.toFixed(2)}`);

// T3 era
console.log(`\n  ERA STABILITY (LIQUID day-clustered by year):`);
for (const yr of [2023, 2024, 2025, 2026]) {
  const yrByDay = new Map<string, number[]>();
  for (const sym of liqSyms) {
    for (const e of symData.get(sym)!.events) if (e.year === yr) {
      if (!yrByDay.has(e.dayKey)) yrByDay.set(e.dayKey, []);
      yrByDay.get(e.dayKey)!.push(e.net);
    }
  }
  const yrDayMeans: number[] = [];
  for (const [_, xs] of yrByDay) yrDayMeans.push(xs.reduce((a, c) => a + c, 0) / xs.length);
  const s = stats(yrDayMeans);
  console.log(`    ${yr}   event-days ${String(yrDayMeans.length).padStart(4)}  day-cluster mean ${bp(s.mean).padStart(7)}bp  t ${s.t.toFixed(2).padStart(6)}`);
}
console.log(`\n  Comparison to D-785 equity belowPML LIQUID: n_evts ~62k, day-cluster t 2.47, sign 68.6%.`);
console.log(`  If crypto SF panel shows similar t and sign, the mechanism is cross-asset-class.`);
