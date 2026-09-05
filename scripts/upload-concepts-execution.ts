#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// upload-concepts-execution.ts (D-794 d/g) — the EXECUTION / TRADE-MANAGEMENT concepts from the uploads, which are
// about HOW to enter and exit rather than WHEN. Measured on the registered clock cell so the comparison is against a
// baseline the programme already tracks.
//   (d) CONSEQUENT ENCROACHMENT (steel.nq "C.E of 1m SIBI"): a LIMIT entry at the FVG MIDPOINT vs at the FVG EDGE.
//       EXECUTION LAW: a limit is a hypothesis about fills — report FILL RATE and RETURN ON FILLED, never all-days.
//   (g) TRADE MANAGEMENT (steel.nq B.E / partials / runners / pyramiding; "Trade_Assistant" .ex5): exit-policy
//       variants on the registered `fwd-utc01-sweepPDL-reclaim-long-K6-panel17` events (17-panel, LONG, K=6):
//         fixed K6 (the clock)  |  break-even after +1 ATR  |  50% partial at +1 ATR, rest K6  |  trail 1 ATR after +1 ATR
//         |  pyramid +1 unit at +0.5 ATR (both exit K6)  |  symmetric ATR stop/target (the D-769 #8 shape, for reference)
//       Cost per UNIT per class. Reports mean / sd / t / win% per policy on OOS events — "how long to hold and when to exit".
// DESCRIPTIVE ONLY. Every policy x cell is a counted trial.
import { Bar, decodeBar, fvgs, priorPeriodLevels, utcDayKey } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("upload-concepts-execution", [
  { name: "SPLIT", def: "2023-01-01" }, { name: "MIN_INST", def: "20" },
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "IDX_RT_BP", def: "4" }, { name: "FX_RT_BP", def: "2" },
  { name: "FVG_MIN_BP", def: "5", note: "ignore gaps smaller than this (bp of mid) — a 0.5bp gap is noise" },
  { name: "FVG_WAIT", def: "24", note: "bars after the gap is known during which a limit may fill" },
  { name: "FVG_HOLD", def: "12", note: "bars held after fill" },
  { name: "ATR_N", def: "48" },
]);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const MIN_INST = Number(K.MIN_INST), FVG_MIN = Number(K.FVG_MIN_BP), FVG_WAIT = Number(K.FVG_WAIT), FVG_HOLD = Number(K.FVG_HOLD), ATR_N = Number(K.ATR_N);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "uce", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
type Klass = "crypto" | "idx" | "fx";
interface Inst { symbol: string; klass: Klass; rt: number; bars: Bar[]; atr: number[] }
const CRYPTO = ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"], FX = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"];
async function loadCrypto(sym: string): Promise<Bar[]> { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0]; return ((row?.bars || []) as number[][]).filter((b) => b[5] > 0).map(decodeBar).sort((a, b) => a.ts - b.ts); }
async function loadFx(sym: string): Promise<Bar[]> { const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })); }
function atrOf(b: Bar[]): number[] { const tr = b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l); const out = new Array(b.length).fill(NaN); for (let i = ATR_N; i < b.length; i++) { let s = 0; for (let j = i - ATR_N; j < i; j++) s += tr[j]; out[i] = s / ATR_N; } return out; }
const insts: Inst[] = [];
for (const s of CRYPTO) { const bars = await loadCrypto(s); insts.push({ symbol: s, klass: "crypto", rt: Number(K.CRYPTO_RT_BP) / 1e4, bars, atr: atrOf(bars) }); }
for (const s of IDX) { const bars = await loadFx(s); insts.push({ symbol: s, klass: "idx", rt: Number(K.IDX_RT_BP) / 1e4, bars, atr: atrOf(bars) }); }
for (const s of FX) { const bars = await loadFx(s); insts.push({ symbol: s, klass: "fx", rt: Number(K.FX_RT_BP) / 1e4, bars, atr: atrOf(bars) }); }
for (const i of insts) assertNonEmpty(`bars ${i.symbol}`, i.bars, 3000);
function stats(xs: number[]) { const n = xs.length; if (!n) return { n: 0, mean: 0, t: 0, sd: 0, win: 0 }; const m = xs.reduce((a, c) => a + c, 0) / n; const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0; const sd = Math.sqrt(s2); return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, sd, win: xs.filter((x) => x > 0).length / n }; }
const bp = (x: number) => (x * 1e4).toFixed(2);
let TRIALS = 0;

// ---------- (d) CONSEQUENT ENCROACHMENT: limit at FVG midpoint vs edge, fill-conditional ----------
console.log(`==> UPLOAD CONCEPTS — EXECUTION (D-794 d/g)`);
console.log(`\n  (d) C.E. vs EDGE limit entries on FVGs (gap >= ${FVG_MIN}bp, fill window ${FVG_WAIT} bars, hold ${FVG_HOLD} after fill). EXECUTION LAW: fill rate + return ON FILLED.`);
console.log(`    entry level        dir    gaps    fill%   filled n   net-on-filled bp    t      sign +/tested`);
for (const [label, atMid] of [["EDGE (near side)", false], ["C.E. (midpoint)", true]] as const) {
  for (const dir of ["bull", "bear"] as const) {
    TRIALS++;
    let gaps = 0, filled = 0; const nets: number[] = []; const perSym = new Map<string, number[]>();
    for (const inst of insts) {
      const b = inst.bars;
      for (const g of fvgs(b)) {
        if (g.dir !== dir || g.sizeBp < FVG_MIN || b[g.knownAt].ts < SPLIT_TS) continue;
        gaps++;
        // bullish gap = support zone [bottom, top]; price falls back INTO it: edge = top, C.E. = mid. bearish mirror.
        const lvl = atMid ? (g.top + g.bottom) / 2 : (dir === "bull" ? g.top : g.bottom);
        let fillAt = -1;
        for (let j = g.knownAt + 1; j <= g.knownAt + FVG_WAIT && j < b.length - FVG_HOLD - 1; j++) { if (dir === "bull" ? b[j].l <= lvl : b[j].h >= lvl) { fillAt = j; break; } }
        if (fillAt < 0) continue;
        filled++;
        const exit = b[fillAt + FVG_HOLD].c; const net = (dir === "bull" ? 1 : -1) * Math.log(exit / lvl) - inst.rt;
        nets.push(net); if (!perSym.has(inst.symbol)) perSym.set(inst.symbol, []); perSym.get(inst.symbol)!.push(net);
      }
    }
    const s = stats(nets); let pos = 0, tested = 0; for (const xs of perSym.values()) { if (xs.length < MIN_INST) continue; tested++; if (stats(xs).mean > 0) pos++; }
    console.log(`    ${label.padEnd(18)} ${dir.padEnd(5)} ${String(gaps).padStart(6)}   ${(100 * filled / Math.max(gaps, 1)).toFixed(0).padStart(4)}%   ${String(s.n).padStart(7)}   ${bp(s.mean).padStart(12)}   ${s.t.toFixed(2).padStart(6)}   ${pos}/${tested}`);
  }
}
console.log(`    (net measured from the LIMIT price; a deeper C.E. fill buys lower but fills less often — the fill-conditional column is the honest comparison)`);

// ---------- (g) TRADE MANAGEMENT on the registered UTC-01 sweep-PDL-reclaim LONG cell ----------
interface Trade { sym: string; entry: number; atr: number; path: Bar[]; rt: number }
const trades: Trade[] = [];
for (const inst of insts) {
  const b = inst.bars, pd = priorPeriodLevels(b, utcDayKey);
  for (let i = 30; i < b.length - 8; i++) {
    if (new Date(b[i].ts * 1000).getUTCHours() !== 1) continue; if (b[i].ts < SPLIT_TS) continue;
    const lvl = pd[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(b[i].l < lvl.low && b[i].c >= lvl.low)) continue;                              // sweep-and-reclaim of PDL
    const atr = inst.atr[i]; if (!(atr > 0)) continue;
    trades.push({ sym: inst.symbol, entry: b[i].c, atr, path: b.slice(i + 1, i + 7), rt: inst.rt }); // clock enters at close, K=6
  }
}
console.log(`\n  (g) TRADE MANAGEMENT on the registered UTC-01 sweep-PDL-reclaim LONG cell — ${trades.length} OOS trades, 17 instruments, ATR(${ATR_N}) at entry`);
type Policy = (t: Trade) => number;   // returns net log return per unit of initial size
const POL: [string, Policy][] = [
  ["fixed K6 close (the clock)", (t) => Math.log(t.path[5].c / t.entry) - t.rt],
  ["break-even after +1 ATR", (t) => { let armed = false; for (const b of t.path) { if (!armed && b.h >= t.entry + t.atr) armed = true; else if (armed && b.l <= t.entry) return 0 - t.rt; } return Math.log(t.path[5].c / t.entry) - t.rt; }],
  ["50% partial at +1 ATR, rest K6", (t) => { let part = false; for (const b of t.path) if (b.h >= t.entry + t.atr) { part = true; break; } const rest = Math.log(t.path[5].c / t.entry); return (part ? 0.5 * Math.log((t.entry + t.atr) / t.entry) + 0.5 * rest : rest) - t.rt; }],
  ["trail 1 ATR after +1 ATR", (t) => { let armed = false, peak = t.entry; for (const b of t.path) { peak = Math.max(peak, b.h); if (!armed && b.h >= t.entry + t.atr) armed = true; if (armed && b.l <= peak - t.atr) return Math.log((peak - t.atr) / t.entry) - t.rt; } return Math.log(t.path[5].c / t.entry) - t.rt; }],
  ["pyramid +1 unit at +0.5 ATR, both K6", (t) => { let added = false; for (const b of t.path) if (b.h >= t.entry + 0.5 * t.atr) { added = true; break; } const r1 = Math.log(t.path[5].c / t.entry); if (!added) return r1 - t.rt; const r2 = Math.log(t.path[5].c / (t.entry + 0.5 * t.atr)); return (r1 + r2) / 2 - t.rt; }],
  ["symmetric 1 ATR stop / 2 ATR target (D-769 #8 shape)", (t) => { for (const b of t.path) { if (b.l <= t.entry - t.atr) return Math.log((t.entry - t.atr) / t.entry) - t.rt; if (b.h >= t.entry + 2 * t.atr) return Math.log((t.entry + 2 * t.atr) / t.entry) - t.rt; } return Math.log(t.path[5].c / t.entry) - t.rt; }],
];
console.log(`    policy                                        n      mean bp    sd bp     t      win%   sign +/tested`);
for (const [name, fn] of POL) {
  TRIALS++;
  const xs = trades.map(fn); const s = stats(xs);
  const perSym = new Map<string, number[]>(); trades.forEach((t, i) => { if (!perSym.has(t.sym)) perSym.set(t.sym, []); perSym.get(t.sym)!.push(xs[i]); });
  let pos = 0, tested = 0; for (const v of perSym.values()) { if (v.length < MIN_INST) continue; tested++; if (stats(v).mean > 0) pos++; }
  console.log(`    ${name.padEnd(44)} ${String(s.n).padStart(5)}   ${bp(s.mean).padStart(8)}   ${bp(s.sd).padStart(7)}   ${s.t.toFixed(2).padStart(5)}   ${(100 * s.win).toFixed(0).padStart(3)}%   ${pos}/${tested}`);
}
console.log(`    (pyramid returns are per unit of AVERAGE size — total exposure was 2x when added; partial is per unit of initial size)`);
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "upload-concepts-execution", runId: `uce|${K.SPLIT}`, spent: TRIALS });
console.log(`\n  TRIALS ${TRIALS} | program ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(2)}`);
console.log(`  DESCRIPTIVE ONLY — the clock's registered exit (fixed K6) is unchanged; this maps what each management policy would have done to it.`);
