#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// eq-cost-frontier.ts (D-784) — the direct measurement of the D-783 "cost is the binding constraint" claim.
// Re-scan the 12,300-symbol equity universe with the six MTF cells, at four cost levels (2/5/10/20bp RT),
// and stratified by liquidity (top-decile by median dollar volume vs the rest). This says explicitly what
// edge is unlocked at what broker-tier — the operational answer to "10^7× lever needs capital access".
//
// Cells inherited from D-783: abovePWH, belowPWL, abovePMH, belowPML, abovePYH, belowPYL.
// Cost tiers:
//   2bp   institutional prime-broker (Interactive Brokers Pro on volume, Alpaca $0 + spread-only)
//   5bp   sophisticated retail / algorithmic (IBKR retail)
//   10bp  standard retail broker
//   20bp  D-783 default (spread + commission on a mid-cap)
// Liquidity split: median dollar-volume in each symbol's TRAIN window (pre-2023). Top decile ~1230 symbols,
// bottom-9-decile ~11070. Cost realistically LOWER on liquid names (less spread) so the top-decile at 2-5bp
// is what matters for a scalable strategy.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("eq-cost-frontier", [
  { name: "MIN_BARS", def: "500" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "K_DAYS", def: "5" }, { name: "MIN_INST", def: "20" },
]);
const KK = Number(K.K_DAYS), MIN_BARS = Number(K.MIN_BARS), MIN_INST = Number(K.MIN_INST);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "ecf", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const meta = await q(`trd_bars_deep?n_bars=gte.${MIN_BARS}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
console.log(`==> EQ COST FRONTIER — ${meta.length} symbols, four cost tiers (2/5/10/20bp), liquidity-stratified`);
assertNonEmpty("meta", meta, 100);

interface Bar { ts: number; o: number; h: number; l: number; c: number; v: number }
async function load(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`))[0];
  return ((row?.bars || []) as number[][])
    .filter((b) => Array.isArray(b) && b.length >= 5 && b[4] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
}
function rollingHiLo(bars: Bar[], N: number): { hi: number[]; lo: number[] } {
  const hi = new Array(bars.length).fill(NaN);
  const lo = new Array(bars.length).fill(NaN);
  for (let i = N; i < bars.length; i++) {
    let mx = -Infinity, mn = Infinity;
    for (let j = i - N; j < i; j++) { if (bars[j].h > mx) mx = bars[j].h; if (bars[j].l < mn) mn = bars[j].l; }
    hi[i] = mx; lo[i] = mn;
  }
  return { hi, lo };
}
const CELLS = [
  { name: "abovePWH", N: 5, dir: 1, lvl: (b: Bar, hi: number) => b.c > hi, mode: "hi" as const },
  { name: "belowPWL", N: 5, dir: 1, lvl: (b: Bar, lo: number) => b.c < lo, mode: "lo" as const },
  { name: "abovePMH", N: 20, dir: 1, lvl: (b: Bar, hi: number) => b.c > hi, mode: "hi" as const },
  { name: "belowPML", N: 20, dir: 1, lvl: (b: Bar, lo: number) => b.c < lo, mode: "lo" as const },
  { name: "abovePYH", N: 252, dir: 1, lvl: (b: Bar, hi: number) => b.c > hi, mode: "hi" as const },
  { name: "belowPYL", N: 252, dir: 1, lvl: (b: Bar, lo: number) => b.c < lo, mode: "lo" as const },
];

// pools: cell -> { liqBucket("liquid"|"illiquid") -> gross fwd returns }
const pools = new Map<string, { liquid: number[]; illiquid: number[] }>();
for (const c of CELLS) pools.set(c.name, { liquid: [], illiquid: [] });

// Two-pass approach: pass1 computes symbol's median dollar-volume on TRAIN, assigns bucket.
// pass2 computes events per symbol into the assigned bucket. To avoid a full reload, do it in one pass.

const symMDV: Array<{ sym: string; mdv: number }> = [];
const events: Array<{ cell: string; sym: string; grossFwd: number; year: number }> = [];
let loaded = 0;
for (let mi = 0; mi < meta.length; mi++) {
  const m = meta[mi];
  let bars: Bar[]; try { bars = await load(m.symbol); } catch { continue; }
  if (bars.length < MIN_BARS) continue;
  // median dollar-volume on train window (pre-SPLIT)
  const dv: number[] = [];
  for (const b of bars) { if (b.ts >= SPLIT_TS) break; dv.push(b.c * b.v); }
  const mdv = dv.length ? dv.sort((a, b) => a - b)[Math.floor(dv.length / 2)] : 0;
  symMDV.push({ sym: m.symbol, mdv });
  const w = rollingHiLo(bars, 5), mo = rollingHiLo(bars, 20), yr_ = rollingHiLo(bars, 252);
  for (let i = 252; i < bars.length - KK - 1; i++) {
    const b = bars[i]; if (b.ts < SPLIT_TS) continue;
    const grossFwd = Math.log(bars[i + KK].c / b.c);
    const year = new Date(b.ts * 1000).getUTCFullYear();
    for (const c of CELLS) {
      const lvls = c.N === 5 ? w : c.N === 20 ? mo : yr_;
      const v = c.mode === "hi" ? lvls.hi[i] : lvls.lo[i];
      if (!isFinite(v)) continue;
      if (!c.lvl(b, v)) continue;
      events.push({ cell: c.name, sym: m.symbol, grossFwd, year });
    }
  }
  loaded++;
  if (loaded % 1000 === 0) console.error(`  loaded ${loaded}/${meta.length}  events ${events.length.toLocaleString()}`);
}
console.log(`  loaded ${loaded}, events ${events.length.toLocaleString()}`);

// liquidity bucket assignment: top decile by MDV = liquid
const sortedByMdv = [...symMDV].sort((a, b) => b.mdv - a.mdv);
const liqCutoff = sortedByMdv[Math.floor(sortedByMdv.length * 0.1)]?.mdv ?? 0;
const liqSet = new Set(sortedByMdv.filter((x) => x.mdv >= liqCutoff).map((x) => x.sym));
console.log(`  liquidity split: cutoff MDV=$${(liqCutoff / 1e6).toFixed(1)}M, ${liqSet.size} symbols in top decile`);

function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(1);

const COSTS = [0.0002, 0.0005, 0.0010, 0.0020];   // 2bp, 5bp, 10bp, 20bp RT
const COST_LABELS = ["2bp inst", "5bp prime", "10bp retail+", "20bp retail"];

console.log(`\n  === POOLED OOS NET (bp) BY CELL x COST x LIQUIDITY (liquid = top MDV decile) ===`);
console.log(`    cell       liquidity   n           gross     ${COST_LABELS.map((l) => l.padStart(10)).join(" ")}`);
const grossByCellLiq = new Map<string, number>();
for (const c of CELLS) {
  for (const liq of ["liquid", "illiquid"] as const) {
    const cellEvts = events.filter((e) => e.cell === c.name && (liq === "liquid") === liqSet.has(e.sym));
    const gross = cellEvts.map((e) => c.dir * e.grossFwd);
    const sG = stats(gross);
    grossByCellLiq.set(`${c.name}|${liq}`, sG.mean);
    const netStr = COSTS.map((rt) => {
      if (sG.n < 100) return "     ---   ";
      const nets = gross.map((x) => x - rt);
      const s = stats(nets);
      return `${bp(s.mean).padStart(6)}(t${s.t.toFixed(1).padStart(4)})`;
    }).join(" ");
    console.log(`    ${c.name.padEnd(10)} ${liq.padEnd(10)}  ${String(sG.n).padStart(9)}   ${bp(sG.mean).padStart(6)}    ${netStr}`);
  }
}

// era stability on the most-promising cell (belowPWL at low cost, liquid)
console.log(`\n  === ERA STABILITY — belowPWL LIQUID at 2bp/5bp cost, by year ===`);
const belowPWLLiq = events.filter((e) => e.cell === "belowPWL" && liqSet.has(e.sym));
console.log(`    year     n          gross bp   2bp net    5bp net`);
for (const yr of [2023, 2024, 2025, 2026]) {
  const yrEvts = belowPWLLiq.filter((e) => e.year === yr);
  const gross = yrEvts.map((e) => e.grossFwd);
  const s = stats(gross);
  const s2bp = stats(gross.map((x) => x - 0.0002));
  const s5bp = stats(gross.map((x) => x - 0.0005));
  console.log(`    ${yr}   ${String(s.n).padStart(8)}   ${bp(s.mean).padStart(7)}    ${bp(s2bp.mean).padStart(6)}(t${s2bp.t.toFixed(1).padStart(4)})   ${bp(s5bp.mean).padStart(6)}(t${s5bp.t.toFixed(1).padStart(4)})`);
}

console.log(`\n  ================================ VERDICT ================================`);
console.log(`  Any cell whose 2bp column is POSITIVE with |t|>=2 across 3+ years is a REAL edge unlocked by capital access.`);
console.log(`  D-783 said "cost is binding" — this run measures at what cost level which cells actually clear.`);
