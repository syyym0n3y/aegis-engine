#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// eq-belowPML-k-sweep.ts (D-789) — K-horizon sensitivity on the belowPML LIQUID cell. Tests K in {1,3,5,10,20}
// trading days. Same universe, same signal, same 20bp/10bp/2bp cost tiers, same day-cluster T2 protocol.
// If K=5 (the registered clock horizon) is a local optimum, the clock is aligned. If K=10 or K=20 is
// substantially stronger, the clock is on a sub-optimal horizon (analogous to D-774 K12 vs K24 finding for
// the crypto D-768 clock).
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("eq-belowPML-k-sweep", [
  { name: "MIN_BARS", def: "500" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "N_LEVEL", def: "20" }, { name: "MIN_INST", def: "20" },
]);
const MIN_BARS = Number(K.MIN_BARS), NLEVEL = Number(K.N_LEVEL);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const KSET = [1, 3, 5, 10, 20];

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "eks", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
console.log(`==> D-789 K-SWEEP on belowPML LIQUID — K in {${KSET.join(",")}} trading days`);
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

// pass 1: MDV + events per symbol at each K
interface SymData { mdv: number; events: Map<number, Array<{ dayKey: string; gross: number }>>; }
const symData = new Map<string, SymData>();
let loaded = 0;
for (const m of meta) {
  let bars: Bar[]; try { bars = await load(m.symbol); } catch { continue; }
  if (bars.length < MIN_BARS + Math.max(...KSET)) continue;
  const dv: number[] = [];
  for (const b of bars) { if (b.ts >= SPLIT_TS) break; dv.push(b.c * b.v); }
  const mdv = dv.length ? dv.sort((a, b) => a - b)[Math.floor(dv.length / 2)] : 0;
  const lo = rollingLo(bars, NLEVEL);
  const events = new Map<number, Array<{ dayKey: string; gross: number }>>();
  for (const k of KSET) events.set(k, []);
  for (let i = NLEVEL; i < bars.length - Math.max(...KSET) - 1; i++) {
    const b = bars[i]; if (b.ts < SPLIT_TS) continue;
    if (!isFinite(lo[i]) || !(b.c < lo[i])) continue;
    const dk = dayKey(b.ts);
    for (const k of KSET) {
      const gross = Math.log(bars[i + k].c / b.c);
      events.get(k)!.push({ dayKey: dk, gross });
    }
  }
  symData.set(m.symbol, { mdv, events });
  loaded++;
  if (loaded % 2000 === 0) console.error(`  loaded ${loaded}`);
}
console.log(`  loaded ${loaded}`);

// liquid decile
const sorted = [...symData.entries()].sort((a, b) => b[1].mdv - a[1].mdv);
const liqN = Math.floor(sorted.length * 0.1);
const liqSyms = new Set(sorted.slice(0, liqN).map(([s]) => s));
console.log(`  liquid decile: ${liqSyms.size}`);

console.log(`\n  === K-SWEEP: pooled + day-clustered + sign on LIQUID, gross bp and net at 10bp/20bp RT ===`);
console.log(`    K     n_evts    n_days   gross_bp  gross_t   dayCl_t   10bp_net  20bp_net   sign +/tested`);
for (const k of KSET) {
  const rt = 10 / 1e4, rt20 = 20 / 1e4;
  const all: number[] = []; const byDay = new Map<string, number[]>();
  let pos = 0, tested = 0;
  for (const sym of liqSyms) {
    const xs = (symData.get(sym)!.events.get(k) ?? []).map((e) => e.gross);
    const sSym = stats(xs);
    if (xs.length >= 20) { tested++; if (sSym.mean > 0) pos++; }
    for (const e of symData.get(sym)!.events.get(k) ?? []) {
      all.push(e.gross);
      if (!byDay.has(e.dayKey)) byDay.set(e.dayKey, []);
      byDay.get(e.dayKey)!.push(e.gross);
    }
  }
  const sPool = stats(all);
  const dayMeans: number[] = [];
  for (const [_, xs] of byDay) dayMeans.push(xs.reduce((a, c) => a + c, 0) / xs.length);
  const sDay = stats(dayMeans);
  const s10 = stats(all.map((x) => x - rt));
  const s20 = stats(all.map((x) => x - rt20));
  console.log(`    K${String(k).padStart(2)}  ${String(sPool.n).padStart(6)}   ${String(dayMeans.length).padStart(5)}   ${bp(sPool.mean).padStart(7)}   ${sPool.t.toFixed(2).padStart(6)}   ${sDay.t.toFixed(2).padStart(6)}   ${bp(s10.mean).padStart(7)}   ${bp(s20.mean).padStart(7)}    ${pos}/${tested} (${(pos / tested * 100).toFixed(0)}%)`);
}
console.log(`\n  Registered clock: fwd-eq-belowPML-liquid-K5-day-clustered (K=5). If another K substantially stronger,`);
console.log(`  the clock horizon may be sub-optimal — analogous to the D-774 K12/K24 finding for the crypto D-768 clock.`);
