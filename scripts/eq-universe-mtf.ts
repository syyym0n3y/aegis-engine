#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// eq-universe-mtf.ts (D-783) — the operator's ask: analyse every held instrument's chart from IPO to today
// through MTF, then compose the bigger picture. Actual scope: 12,300 US equities with n_bars >= 500 (≈2y),
// daily bars, MTF via prior-WEEK / prior-MONTH / prior-YEAR high/low as levels. Forward K=5 days close return
// (one-trading-week hold). Cost 20bp RT for retail equity execution. OOS 2023+ (rest of 2016+ is train).
//
// Cells per bar:
//   above PWH  (close > prior 5-day high)                 - breakout continuation hypothesis
//   below PWL  (close < prior 5-day low)                  - breakdown continuation
//   above PMH  (close > prior 20-day high)                - stronger breakout
//   below PML  (close < prior 20-day low)                 - stronger breakdown
//   above PYH  (close > prior 252-day high = 52w breakout) - the well-documented 52w-high anomaly
//   below PYL  (close < prior 252-day low)                - the "falling knife" test
//
// Every cell reports cross-instrument sign (fraction of tested symbols positive), pooled OOS net, era
// decomposition (2023, 2024, 2025, 2026). SELECTION LAW: every cell is a counted trial. BREADTH LAW:
// 12,300 symbols is enormously broad — cross-instrument sign is very demanding here.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("eq-universe-mtf", [
  { name: "MIN_BARS", def: "500", note: "symbol history floor (~2y daily)" },
  { name: "SYMS_CAP", def: "20000", note: "max symbols to load; 20000 = full universe" },
  { name: "RT_BP", def: "20", note: "equity retail round-trip in bp (spread + commission)" },
  { name: "SPLIT", def: "2023-01-01", note: "train/test boundary" },
  { name: "K_DAYS", def: "5", note: "forward hold horizon in trading days" },
  { name: "MIN_INST", def: "20", note: "per-instrument event floor for sign map" },
]);
const KK = Number(K.K_DAYS), MIN_BARS = Number(K.MIN_BARS), SYMS_CAP = Number(K.SYMS_CAP);
const RT = Number(K.RT_BP) / 1e4, MIN_INST = Number(K.MIN_INST);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "eqm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

// meta list, sorted by n_bars desc
const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
console.log(`==> EQ UNIVERSE MTF — ${meta.length} symbols with n_bars >= ${MIN_BARS} (cap ${SYMS_CAP})`);
assertNonEmpty("meta symbols", meta, 100);

interface Bar { ts: number; o: number; h: number; l: number; c: number; v: number }
async function load(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`))[0];
  return ((row?.bars || []) as number[][])
    .filter((b) => Array.isArray(b) && b.length >= 5 && b[4] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
}

// rolling max/min over trailing N bars ENDING AT i-1 (strictly past — no look-ahead)
function rollingMaxMinPast(bars: Bar[], N: number): { hi: number[]; lo: number[] } {
  const hi = new Array(bars.length).fill(NaN);
  const lo = new Array(bars.length).fill(NaN);
  // simple O(n*N) — N is small (5/20/252), universe is per-symbol so overall linear per bar per level
  for (let i = N; i < bars.length; i++) {
    let mx = -Infinity, mn = Infinity;
    for (let j = i - N; j < i; j++) { if (bars[j].h > mx) mx = bars[j].h; if (bars[j].l < mn) mn = bars[j].l; }
    hi[i] = mx; lo[i] = mn;
  }
  return { hi, lo };
}

const CELLS = [
  { name: "abovePWH", N: 5, dir: 1, level: (b: Bar, hi: number, _lo: number) => b.c > hi },
  { name: "belowPWL", N: 5, dir: 1, level: (b: Bar, _hi: number, lo: number) => b.c < lo },     // long-into-drop = mean-revert hypothesis
  { name: "abovePMH", N: 20, dir: 1, level: (b: Bar, hi: number, _lo: number) => b.c > hi },
  { name: "belowPML", N: 20, dir: 1, level: (b: Bar, _hi: number, lo: number) => b.c < lo },
  { name: "abovePYH", N: 252, dir: 1, level: (b: Bar, hi: number, _lo: number) => b.c > hi },    // 52w high breakout
  { name: "belowPYL", N: 252, dir: 1, level: (b: Bar, _hi: number, lo: number) => b.c < lo },
] as const;

// pools: cellname -> year -> pool of nets; and cellname -> sym -> pool for sign map
const yearPool = new Map<string, Map<number, number[]>>();
const symPool = new Map<string, Map<string, number[]>>();
for (const c of CELLS) { yearPool.set(c.name, new Map()); symPool.set(c.name, new Map()); }

let loaded = 0, skipped = 0, totalEvents = 0;
const cap = Math.min(SYMS_CAP, meta.length);
for (let mi = 0; mi < cap; mi++) {
  const m = meta[mi];
  let bars: Bar[];
  try { bars = await load(m.symbol); } catch { skipped++; continue; }
  if (bars.length < MIN_BARS) { skipped++; continue; }
  // rolling levels
  const w = rollingMaxMinPast(bars, 5);
  const mo = rollingMaxMinPast(bars, 20);
  const yr_ = rollingMaxMinPast(bars, 252);
  for (let i = 252; i < bars.length - KK - 1; i++) {
    const b = bars[i];
    if (b.ts < SPLIT_TS) continue;
    const fwd = Math.log(bars[i + KK].c / b.c);
    const year = new Date(b.ts * 1000).getUTCFullYear();
    for (const c of CELLS) {
      const lvls = c.N === 5 ? w : c.N === 20 ? mo : yr_;
      if (!isFinite(lvls.hi[i]) || !isFinite(lvls.lo[i])) continue;
      if (!c.level(b, lvls.hi[i], lvls.lo[i])) continue;
      const net = c.dir * fwd - RT;
      totalEvents++;
      const yp = yearPool.get(c.name)!;
      if (!yp.has(year)) yp.set(year, []);
      yp.get(year)!.push(net);
      const sp = symPool.get(c.name)!;
      if (!sp.has(m.symbol)) sp.set(m.symbol, []);
      sp.get(m.symbol)!.push(net);
    }
  }
  loaded++;
  if (loaded % 500 === 0) console.error(`  loaded ${loaded}/${cap}  events so far ${totalEvents.toLocaleString()}`);
}
console.log(`  loaded ${loaded} / skipped ${skipped} / total events ${totalEvents.toLocaleString()}`);

function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(1);

console.log(`\n  === POOLED OOS (2023+) NET (bp) BY CELL, WITH ERA DECOMPOSITION ===`);
console.log(`    cell        year   n           mean bp     t         sign +/tested`);
for (const c of CELLS) {
  const yp = yearPool.get(c.name)!;
  const sp = symPool.get(c.name)!;
  // pooled ALL years
  const all: number[] = [];
  for (const xs of yp.values()) for (const x of xs) all.push(x);
  const sAll = stats(all);
  let pos = 0, tested = 0;
  for (const xs of sp.values()) { if (xs.length < MIN_INST) continue; tested++; if (stats(xs).mean > 0) pos++; }
  console.log(`    ${c.name.padEnd(10)}  ALL   ${String(sAll.n).padStart(9)}   ${bp(sAll.mean).padStart(8)}   ${sAll.t.toFixed(2).padStart(6)}     ${pos}/${tested} (${(pos / tested * 100).toFixed(0)}%)`);
  for (const yr of [2023, 2024, 2025, 2026]) {
    const xs = yp.get(yr) ?? [];
    const s = stats(xs);
    const flag = s.n >= 1000 ? (s.t >= 2 ? " +" : (s.t <= -2 ? " ** NEG" : "")) : "";
    console.log(`    ${"".padEnd(10)}  ${yr}  ${String(s.n).padStart(9)}   ${bp(s.mean).padStart(8)}   ${s.t.toFixed(2).padStart(6)}${flag}`);
  }
  console.log("");
}
console.log(`  ================================ VERDICT ================================`);
console.log(`  Cells: cross-instrument sign shows what fraction of the equity universe follows the pattern.`);
console.log(`  Era rows show whether the 2026 sign-flip that hit crypto (D-777/778/782) also hit equities.`);
console.log(`  All numbers are NET of ${(RT * 1e4).toFixed(0)}bp RT retail cost.`);
