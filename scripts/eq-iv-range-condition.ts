#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// eq-iv-range-condition.ts (D-791) — the FREE version of the "IV walls" pitch, tested as a conditioner on
// clock #18 (belowPML LIQUID K5). Expected 5-day 1σ move from VIX3M (held daily in trd_macro_series as
// cboe_vix3m): sigma5 = (VIX3M/100) * sqrt(5/252). Each event's realised drop-from-prior-20d-low is measured
// in units of that sigma. Hypothesis (the operator's screenshot, made falsifiable): drops that EXCEED the
// IV-implied range are "excess" and revert harder than drops inside it. Also conditions on SKEW percentile
// (cboe_skew) as a free proxy for dealer short-put positioning. Day-clustered t per D-785 protocol.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("eq-iv-range-condition", [
  { name: "MIN_BARS", def: "500" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "K_DAYS", def: "5" }, { name: "N_LEVEL", def: "20" }, { name: "MIN_INST", def: "20" },
  { name: "RT_BP", def: "10", note: "cost tier assumed by clock #18 ($100k+ book)" },
]);
const KK = Number(K.K_DAYS), MIN_BARS = Number(K.MIN_BARS), NLEVEL = Number(K.N_LEVEL);
const MIN_INST = Number(K.MIN_INST), RT = Number(K.RT_BP) / 1e4;
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "eiv", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

// --- macro series: VIX3M and SKEW, daily, asof lookup (strictly past: use previous day's close) ---
async function series(name: string): Promise<Array<[string, number]>> {
  const rows = await q(`trd_macro_series?series=eq.${name}&select=d,v&order=d.asc`) as { d: string; v: number }[];
  return rows.map((r) => [r.d, r.v]);
}
const vix3m = await series("cboe_vix3m");
const skew = await series("cboe_skew");
assertNonEmpty("cboe_vix3m", vix3m, 1000);
assertNonEmpty("cboe_skew", skew, 1000);
function asofPrev(arr: Array<[string, number]>, d: string): number | null {
  // greatest date STRICTLY LESS than d (yesterday's close is what you know at today's close)
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] < d) { best = m; lo = m + 1; } else hi = m - 1; }
  return best < 0 ? null : arr[best][1];
}
// SKEW percentile within trailing 252 obs
const skewPct = new Map<string, number>();
for (let i = 252; i < skew.length; i++) {
  const cur = skew[i][1]; let rk = 0;
  for (let j = i - 252; j < i; j++) if (skew[j][1] < cur) rk++;
  skewPct.set(skew[i][0], rk / 252);
}
// POSITIVE CONTROL: VIX3M must vary (2020-03 should be far above median)
{
  const vals = vix3m.map((x) => x[1]).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  const mar20 = vix3m.find((x) => x[0] >= "2020-03-16")?.[1] ?? 0;
  console.log(`==> D-791 IV-RANGE CONDITION on clock #18 — VIX3M median ${med.toFixed(1)}, 2020-03-16 ${mar20.toFixed(1)} (positive control: must be >> median)`);
  if (!(mar20 > med * 1.5)) { console.error("!! VIX3M positive control failed"); Deno.exit(1); }
}

const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
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
  for (let i = N; i < bars.length; i++) { let mn = Infinity; for (let j = i - N; j < i; j++) if (bars[j].l < mn) mn = bars[j].l; lo[i] = mn; }
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

interface Ev { sym: string; day: string; net: number; dropSig: number; skewP: number | null }
interface SymData { mdv: number; events: Ev[] }
const symData = new Map<string, SymData>();
let loaded = 0, noIv = 0;
for (const m of meta) {
  let bars: Bar[]; try { bars = await load(m.symbol); } catch { continue; }
  if (bars.length < MIN_BARS + KK) continue;
  const dv: number[] = [];
  for (const b of bars) { if (b.ts >= SPLIT_TS) break; dv.push(b.c * b.v); }
  const mdv = dv.length ? dv.sort((a, b) => a - b)[Math.floor(dv.length / 2)] : 0;
  const lo = rollingLo(bars, NLEVEL);
  const events: Ev[] = [];
  for (let i = NLEVEL; i < bars.length - KK - 1; i++) {
    const b = bars[i]; if (b.ts < SPLIT_TS) continue;
    if (!isFinite(lo[i]) || !(b.c < lo[i])) continue;
    const d = dayKey(b.ts);
    const iv = asofPrev(vix3m, d); if (iv === null) { noIv++; continue; }
    const sigma5 = (iv / 100) * Math.sqrt(KK / 252);           // IV-implied 1σ move over the hold horizon
    const drop = Math.log(lo[i] / b.c);                          // how far below the prior 20d low, in log
    const dropSig = drop / sigma5;                               // drop in units of IV-implied σ
    const net = Math.log(bars[i + KK].c / b.c) - RT;
    const sp = skewPct.get(d) ?? null;
    events.push({ sym: m.symbol, day: d, net, dropSig, skewP: sp });
  }
  symData.set(m.symbol, { mdv, events });
  loaded++;
  if (loaded % 2000 === 0) console.error(`  loaded ${loaded}`);
}
console.log(`  loaded ${loaded} symbols (${noIv} events dropped for no IV asof)`);
const sorted = [...symData.entries()].sort((a, b) => b[1].mdv - a[1].mdv);
const liqSyms = new Set(sorted.slice(0, Math.floor(sorted.length * 0.1)).map(([s]) => s));
const liqEv: Ev[] = [];
for (const s of liqSyms) liqEv.push(...symData.get(s)!.events);
console.log(`  liquid decile: ${liqSyms.size} symbols, ${liqEv.length} events`);

function cell(name: string, evs: Ev[]) {
  const pooled = stats(evs.map((e) => e.net));
  const byDay = new Map<string, number[]>();
  const bySym = new Map<string, number[]>();
  for (const e of evs) {
    if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day)!.push(e.net);
    if (!bySym.has(e.sym)) bySym.set(e.sym, []); bySym.get(e.sym)!.push(e.net);
  }
  const dayMeans: number[] = []; for (const xs of byDay.values()) dayMeans.push(xs.reduce((a, c) => a + c, 0) / xs.length);
  const dc = stats(dayMeans);
  let pos = 0, tested = 0; for (const xs of bySym.values()) { if (xs.length < MIN_INST) continue; tested++; if (stats(xs).mean > 0) pos++; }
  console.log(`    ${name.padEnd(34)} n ${String(pooled.n).padStart(6)}  net ${bp(pooled.mean).padStart(7)}bp  ev-t ${pooled.t.toFixed(2).padStart(6)}  day-t ${dc.t.toFixed(2).padStart(6)} (days ${dayMeans.length})  sign ${pos}/${tested} ${tested ? `(${(pos / tested * 100).toFixed(0)}%)` : ""}`);
}

console.log(`\n  === BASELINE (clock #18 cell, LIQUID, net of ${(RT * 1e4).toFixed(0)}bp) ===`);
cell("all events", liqEv);

console.log(`\n  === CONDITION A — drop below prior-20d-low in units of IV-implied 5-day σ (VIX3M) ===`);
console.log(`    (the "IV wall" idea, falsifiable: does an EXCESS drop revert harder?)`);
cell("dropSig < 0.25 (barely through)", liqEv.filter((e) => e.dropSig < 0.25));
cell("0.25 <= dropSig < 0.5", liqEv.filter((e) => e.dropSig >= 0.25 && e.dropSig < 0.5));
cell("0.5 <= dropSig < 1.0", liqEv.filter((e) => e.dropSig >= 0.5 && e.dropSig < 1.0));
cell("dropSig >= 1.0 (outside IV range)", liqEv.filter((e) => e.dropSig >= 1.0));
cell("dropSig >= 1.65 (outside 90% band)", liqEv.filter((e) => e.dropSig >= 1.65));

console.log(`\n  === CONDITION B — SKEW percentile (trailing 252d) as free dealer-short-put proxy ===`);
cell("skew pct < 0.33 (low put demand)", liqEv.filter((e) => e.skewP !== null && e.skewP < 0.33));
cell("0.33 <= skew pct < 0.67", liqEv.filter((e) => e.skewP !== null && e.skewP >= 0.33 && e.skewP < 0.67));
cell("skew pct >= 0.67 (high put demand)", liqEv.filter((e) => e.skewP !== null && e.skewP >= 0.67));

console.log(`\n  === CONDITION C — VIX3M level itself (regime) ===`);
const withIv = liqEv.map((e) => ({ e, iv: asofPrev(vix3m, e.day)! }));
cell("VIX3M < 15", withIv.filter((x) => x.iv < 15).map((x) => x.e));
cell("15 <= VIX3M < 20", withIv.filter((x) => x.iv >= 15 && x.iv < 20).map((x) => x.e));
cell("20 <= VIX3M < 25", withIv.filter((x) => x.iv >= 20 && x.iv < 25).map((x) => x.e));
cell("VIX3M >= 25", withIv.filter((x) => x.iv >= 25).map((x) => x.e));

console.log(`\n  VERDICT rule: a condition is a real refinement only if its day-t beats the baseline day-t AND keeps sign >= 60%.`);
console.log(`  All IV inputs are held daily for free (cboe_vix3m, cboe_skew). Nothing here needed a $100/mo product.`);
