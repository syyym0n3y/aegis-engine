#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// eq-liq-cutoff-sweep.ts (D-790) — UNIVERSE LAW check on the registered clock #18. The "top 10% MDV" cutoff
// was a reasonable-but-arbitrary choice. Testing at top 3%, 5%, 10%, 15%, 20%, 30%, 50% shows whether the
// finding is a cliff (fragile) or a smooth continuum (robust). Same universe (12,300 equities, n_bars>=500),
// same cell (belowPML close < prior 20-day low → LONG K=5), same day-cluster t protocol per D-785.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("eq-liq-cutoff-sweep", [
  { name: "MIN_BARS", def: "500" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "K_DAYS", def: "5" }, { name: "N_LEVEL", def: "20" },
  { name: "MIN_INST", def: "20" }, { name: "MIN_DAY_SIGNALS", def: "3", note: "D-785 uses ≥3, scorer uses ≥1; test both" },
]);
const KK = Number(K.K_DAYS), MIN_BARS = Number(K.MIN_BARS), NLEVEL = Number(K.N_LEVEL);
const MIN_INST = Number(K.MIN_INST), MIN_DAY = Number(K.MIN_DAY_SIGNALS);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "elc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
console.log(`==> D-790 LIQ CUTOFF SWEEP on belowPML K5 — ${meta.length} symbols`);
assertNonEmpty("meta", meta, 100);

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
const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

interface SymData { mdv: number; events: Array<{ dayKey: string; gross: number }> }
const symData = new Map<string, SymData>();
let loaded = 0;
for (const m of meta) {
  let bars: Bar[]; try { bars = await load(m.symbol); } catch { continue; }
  if (bars.length < MIN_BARS + KK) continue;
  const dv: number[] = [];
  for (const b of bars) { if (b.ts >= SPLIT_TS) break; dv.push(b.c * b.v); }
  const mdv = dv.length ? dv.sort((a, b) => a - b)[Math.floor(dv.length / 2)] : 0;
  const lo = rollingLo(bars, NLEVEL);
  const events: Array<{ dayKey: string; gross: number }> = [];
  for (let i = NLEVEL; i < bars.length - KK - 1; i++) {
    const b = bars[i]; if (b.ts < SPLIT_TS) continue;
    if (!isFinite(lo[i]) || !(b.c < lo[i])) continue;
    events.push({ dayKey: dayKey(b.ts), gross: Math.log(bars[i + KK].c / b.c) });
  }
  symData.set(m.symbol, { mdv, events });
  loaded++;
  if (loaded % 2000 === 0) console.error(`  loaded ${loaded}`);
}
console.log(`  loaded ${loaded}`);

// sort symbols by MDV desc
const sorted = [...symData.entries()].sort((a, b) => b[1].mdv - a[1].mdv);
console.log(`\n  === LIQUIDITY CUTOFF SENSITIVITY (day-clustered t, ≥1 signal/day AND ≥3 signals/day) ===`);
console.log(`    top %    n_syms   MDV cutoff    events    days   d-cluster t (≥1)   d-cluster t (≥3)   sign%`);
for (const pct of [3, 5, 10, 15, 20, 30, 50, 100]) {
  const cutN = Math.floor(sorted.length * pct / 100);
  const liqSyms = new Set(sorted.slice(0, cutN).map(([s]) => s));
  const mdvCut = sorted[cutN - 1]?.[1].mdv ?? 0;
  const allGross: number[] = [];
  const byDay = new Map<string, number[]>();
  let pos = 0, tested = 0;
  for (const sym of liqSyms) {
    const d = symData.get(sym)!;
    const xs = d.events.map((e) => e.gross);
    if (xs.length >= MIN_INST) { tested++; if (stats(xs).mean > 0) pos++; }
    for (const e of d.events) {
      allGross.push(e.gross);
      if (!byDay.has(e.dayKey)) byDay.set(e.dayKey, []);
      byDay.get(e.dayKey)!.push(e.gross);
    }
  }
  // day-cluster means (≥1 and ≥3 filters)
  const dayMeans1: number[] = [], dayMeans3: number[] = [];
  for (const [_, xs] of byDay) {
    const m = xs.reduce((a, c) => a + c, 0) / xs.length;
    if (xs.length >= 1) dayMeans1.push(m);
    if (xs.length >= 3) dayMeans3.push(m);
  }
  const t1 = stats(dayMeans1), t3 = stats(dayMeans3);
  console.log(`    ${String(pct).padStart(4)}%   ${String(liqSyms.size).padStart(5)}   $${(mdvCut / 1e6).toFixed(2).padStart(8)}M   ${String(allGross.length).padStart(6)}   ${String(dayMeans1.length).padStart(5)}   ${t1.t.toFixed(2).padStart(6)} (n${dayMeans1.length})   ${t3.t.toFixed(2).padStart(6)} (n${dayMeans3.length})    ${(pos / tested * 100).toFixed(0)}%`);
}
console.log(`\n  Registered clock uses top 10% (cutoff $7.5M). If the ≥1 day-cluster t is smooth around 10%, robust.`);
console.log(`  If it CLIFFS between two adjacent cutoffs, the choice was fragile — flag for follow-up refinement.`);
