#!/usr/bin/env -S deno run --allow-net --allow-env
// mtf-psl-fade.ts (D-764) — THE FADE, measured directly, out-of-sample, across ~12 instruments.
//
// D-763 established, mechanically and across 8 instruments, ONE sign-stable structural fact: a close below the
// PRIOR-SESSION LOW (PSL) does NOT continue down — it REVERSES (PSL K4 break-trade t -4.80, 8/8 instruments agree).
// But D-763 charged the round trip to the BREAK trade; the TRADABLE object is the FADE (go LONG the swept low), and
// it pays its OWN round trip, so the tradable expectancy sat AT the cost line at K4. This script answers the single
// make-or-break question: does ANY defensible cell clear cost OUT-OF-SAMPLE across a majority of instruments?
//
// DISCIPLINE (each law named so the reader can check it):
//  - DIRECTION IS FIXED, NOT RE-DERIVED (SELECTION LAW, D-455): the fade of downside PSL sweeps is frozen from
//    D-763's 8/8 cross-instrument sign. What is CHOSEN here (K, the volume/HTF conditioning cell, any threshold) is
//    chosen on TRAIN (< 2023-01-01) and evaluated FROZEN on TEST (>= 2023-01-01). Train and test printed side by side.
//  - LOOK-AHEAD (D-498 same-bar corollary): the sweep is a CLOSE below a PRIOR-session low (mtf-structure guarantees
//    the level predates the bar). We enter LONG at the NEXT bar's OPEN (exec="lag1") and exit K bars later at close.
//  - COST (EXECUTION/COST-INFLATION LAW): each event is one round trip; the FADE pays its OWN pessimistic RT —
//    crypto 7bp, index/gold 4bp, FX 2bp. Every return reported is NET. A positive net cell is one that clears cost.
//  - BREADTH (D-443) + cross-instrument agreement: a cell that works POOLED but on < a majority of the 12
//    instruments is an artifact. We report per-instrument OOS expectancy and count how many agree in sign & clear cost.
//  - PRECONDITION (D-598): declareKnobs + assertNonEmpty; STRICT reads (D-757) so a dropped read is not a false null.
//  - POSITIVE CONTROL (D-641): BTCUSDT PSL downside-sweep count must be non-zero/hundreds, printed before the grid.
//
// DESCRIPTIVE ONLY unless a cell clears cost OOS. No trd_lineage rows, no DECISIONS.md edits. The forward rule +
// scorer are registered by the SEPARATE writer path at the bottom ONLY if the numeric gate in (5) is met.

import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import {
  Bar, decodeBar, priorSessionLevels, volumeStates, VolState,
} from "../supabase/functions/_shared/mtf-structure.ts";

const K = declareKnobs("mtf-psl-fade", [
  { name: "MIN_EVENTS", def: "50", note: "breadth floor: a cell below this is UNTESTED (BREADTH LAW)" },
  { name: "PART_HI", def: "1.5", note: "participation ratio above which a sweep is 'high-volume' (liquid state)" },
  { name: "CRYPTO_RT_BP", def: "7", note: "crypto taker round-trip cost, bp (pessimistic)" },
  { name: "IDX_RT_BP", def: "4", note: "index/gold CFD round-trip cost, bp (pessimistic)" },
  { name: "FX_RT_BP", def: "2", note: "FX major round-trip cost, bp (pessimistic)" },
  { name: "VOL_N", def: "24", note: "trailing window for volume state" },
  { name: "SPLIT", def: "2023-01-01", note: "train (before) / test (on-or-after) boundary — frozen, D-455" },
  { name: "DUMP", def: "", note: "if set, write every event's per-K net return (symbol, ts, train, cells) to this JSON path for mtf-sizer.ts" },
]);
const MIN_EVENTS = Number(K.MIN_EVENTS), PART_HI = Number(K.PART_HI), VOL_N = Number(K.VOL_N);
const SPLIT_TS = Math.floor(new Date(K.SPLIT + "T00:00:00Z").getTime() / 1000);
const KSET = [4, 12, 24];

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "psl", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

// ---- instruments: 5 crypto (7bp) + 3 index/gold CFD (4bp) + 4 FX majors (2bp) = 12 ----
const CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"];
const FX = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"]; // 80,088 hourly bars each (verified), cleanest sessions
interface Inst { symbol: string; klass: "crypto" | "idx" | "fx"; rtBp: number; bars: Bar[] }

async function loadCrypto(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = row?.bars || [];
  return raw.map(decodeBar).sort((a, b) => a.ts - b.ts);
}
// index/gold AND FX both live in trd_fx_hourly; DROP forward-fill padding (h==l is a synthetic closed-session bar:
// no range, no direction — keeping it would fabricate levels). Verified: ~17% of FX bars, ~22-28% of idx bars.
async function loadFxTable(sym: string): Promise<Bar[]> {
  const rows = (await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`)) as
    { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }))
    .sort((a, b) => a.ts - b.ts);
}

// daily HTF trend, no look-ahead: sign of (close - close 24 bars ago). A downside sweep in an UPTREND is the
// operator's "bullish stop-run" cell.
function htfUp(bars: Bar[], i: number): boolean | null {
  if (i < 24) return null;
  return bars[i].c > bars[i - 24].c;
}

// ---- fade events: a bar that CLOSES below the prior-session low. Enter LONG at next-bar open, exit K bars later. ----
interface FadeEvt {
  i: number; ts: number; train: boolean; era: string;
  net: Record<number, number>; // fade (long) net-of-RT log return per K, from next-bar open
  partHi: boolean;             // sweep on high participation (partRatio >= PART_HI)
  htfUp: boolean | null;       // daily trend up at the sweep bar (bullish stop-run cell)
}
function eraOf(ts: number): string {
  const y = new Date(ts * 1000).getUTCFullYear();
  if (y <= 2020) return "<=2020";
  if (y <= 2022) return "2021-22";
  if (y <= 2024) return "2023-24";
  return "2025+";
}
function findFades(inst: Inst, vs: VolState[]): FadeEvt[] {
  const b = inst.bars;
  const psl = priorSessionLevels(b); // {high, low} of most-recent CLOSED prior session, known at bar i
  const out: FadeEvt[] = [];
  const rt = inst.rtBp / 1e4;
  const maxK = Math.max(...KSET);
  let firedAt: number | undefined; // last PSL value we fired on; re-arm only when the level moves (debounce)
  for (let i = 1; i < b.length - maxK - 1; i++) {
    const lvl = psl[i]?.low;
    if (lvl === undefined) continue;
    // downside sweep: prior close at/above the session low, this close strictly below it
    if (b[i - 1].c >= lvl && b[i].c < lvl && firedAt !== lvl) {
      firedAt = lvl;
      const entry = b[i + 1].o; // lag-1
      const net: Record<number, number> = {};
      for (const k of KSET) {
        const exit = b[Math.min(i + 1 + k, b.length - 1)].c;
        net[k] = Math.log(exit / entry) - rt; // LONG fade, full round trip charged (pessimistic)
      }
      const v = vs[i];
      out.push({
        i, ts: b[i].ts, train: b[i].ts < SPLIT_TS, era: eraOf(b[i].ts),
        net, partHi: Number.isFinite(v.partRatio) && v.partRatio >= PART_HI, htfUp: htfUp(b, i),
      });
    }
  }
  return out;
}

// ---- stats ----
function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, med: 0, t: 0, win: 0 };
  const mean = xs.reduce((a, c) => a + c, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, c) => a + (c - mean) ** 2, 0) / (n - 1)) : 0;
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : 0;
  const s = [...xs].sort((a, b) => a - b);
  const med = n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2;
  return { n, mean, med, t, win: xs.filter((x) => x > 0).length / n };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

// ---------------------------------------------------------------------------------------------------------------
console.log("==> MTF PSL-FADE (D-764): fade downside prior-session-low sweeps — direct, OOS, 12 instruments.\n");
console.log("    DIRECTION FROZEN from D-763 (8/8 sign). exec=lag1 (long at next-bar open). Every return NET of RT.");
console.log(`    train < ${K.SPLIT} | test >= ${K.SPLIT} (SELECTION LAW: K + cell chosen on TRAIN, evaluated frozen on TEST).\n`);

let TRIALS = 0;
const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rtBp: Number(K.CRYPTO_RT_BP), bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", rtBp: Number(K.IDX_RT_BP), bars: await loadFxTable(s) });
for (const s of FX) insts.push({ symbol: s, klass: "fx", rtBp: Number(K.FX_RT_BP), bars: await loadFxTable(s) });
for (const inst of insts) assertNonEmpty(`${inst.symbol} bars`, inst.bars, 5000);

const evByInst = new Map<string, FadeEvt[]>();
for (const inst of insts) {
  const vs = volumeStates(inst.bars, VOL_N);
  evByInst.set(inst.symbol, findFades(inst, vs));
}

// POSITIVE CONTROL (D-641): BTC PSL downside-sweep count non-zero/hundreds; unconditional 12h fwd ~0.
{
  const btc = insts.find((x) => x.symbol === "BTCUSDT")!;
  const evs = evByInst.get("BTCUSDT")!;
  const bench: number[] = [];
  for (let i = 25; i < btc.bars.length - 13; i += Math.max(1, Math.floor(btc.bars.length / 2000))) {
    bench.push(Math.log(btc.bars[i + 12].c / btc.bars[i + 1].c));
  }
  const bs = stats(bench);
  console.log(`  POSITIVE CONTROL — BTCUSDT PSL downside-sweep events: ${evs.length} (must be non-zero, hundreds plausible)`);
  console.log(`    unconditional 12h fwd benchmark: mean ${bp(bs.mean)}bp, t ${bs.t.toFixed(2)}, n ${bs.n} (should be ~0)\n`);
  if (evs.length < 50) { console.error("!! positive control FAILED: too few PSL sweeps — the level or sweep logic is broken."); Deno.exit(1); }
}

// ---- cells: the conditioning states to test. base + volHi + htfUp + volHi&htfUp (the operator's liquid+justified) ----
type CellName = "base" | "volHi" | "htfUp" | "volHi+htfUp";
const CELLS: CellName[] = ["base", "volHi", "htfUp", "volHi+htfUp"];
function inCell(e: FadeEvt, c: CellName): boolean {
  switch (c) {
    case "base": return true;
    case "volHi": return e.partHi;
    case "htfUp": return e.htfUp === true;
    case "volHi+htfUp": return e.partHi && e.htfUp === true;
  }
}
function poolNet(cell: CellName, k: number, which: "train" | "test" | "all"): number[] {
  const out: number[] = [];
  for (const inst of insts) {
    for (const e of evByInst.get(inst.symbol)!) {
      if (which !== "all" && (which === "train") !== e.train) continue;
      if (inCell(e, cell)) out.push(e.net[k]);
    }
  }
  return out;
}

// ---- TABLE 1: OOS train vs test, pooled across the 12 instruments, every (cell x K). Each line is a TRIAL. ----
console.log("  === TABLE 1 — POOLED FADE NET (bp), TRAIN vs TEST (each row a trial; net of RT) ===");
console.log("    cell          K    train: n / mean / t        test:  n / mean / t");
for (const c of CELLS) {
  for (const k of KSET) {
    TRIALS += 2;
    const tr = stats(poolNet(c, k, "train")), te = stats(poolNet(c, k, "test"));
    const flag = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 ? "  <= clears cost OOS" : "";
    console.log(`    ${c.padEnd(12)} ${String(k).padStart(2)}   ${String(tr.n).padStart(6)} / ${bp(tr.mean).padStart(7)} / ${tr.t.toFixed(2).padStart(5)}      ${String(te.n).padStart(6)} / ${bp(te.mean).padStart(7)} / ${te.t.toFixed(2).padStart(5)}${flag}`);
  }
}

// ---- pick the FROZEN cell on TRAIN only (SELECTION LAW): the (cell,K) with the best train t among breadth-passing,
//      requiring a positive train mean. This choice is made WITHOUT looking at test. ----
let best: { c: CellName; k: number; t: number } | null = null;
for (const c of CELLS) for (const k of KSET) {
  const s = stats(poolNet(c, k, "train"));
  if (s.n < MIN_EVENTS || s.mean <= 0) continue;
  if (!best || s.t > best.t) best = { c, k, t: s.t };
}
console.log(`\n  FROZEN CHOICE (train-only, D-455): ${best ? `cell=${best.c}, K=${best.k} (train t ${best.t.toFixed(2)})` : "NONE — no positive breadth-passing cell on train"}`);

// ---- TABLE 2: per-era pooled base fade (stability), for each K ----
console.log("\n  === TABLE 2 — PER-ERA POOLED FADE NET (bp), base cell (stability) ===");
console.log("    era        " + KSET.map((k) => `K${k}: n / mean / t`).join("      "));
for (const era of ["<=2020", "2021-22", "2023-24", "2025+"]) {
  const cols = KSET.map((k) => {
    const xs: number[] = [];
    for (const inst of insts) for (const e of evByInst.get(inst.symbol)!) if (e.era === era) xs.push(e.net[k]);
    const s = stats(xs);
    return `${String(s.n).padStart(5)}/${bp(s.mean).padStart(6)}/${s.t.toFixed(1).padStart(4)}`;
  });
  console.log(`    ${era.padEnd(9)}  ${cols.join("   ")}`);
}

// ---- TABLE 3: per-instrument OOS (test) breadth, at the frozen choice ----
const CH = best ?? { c: "base" as CellName, k: 24 };
console.log(`\n  === TABLE 3 — PER-INSTRUMENT OOS (TEST) at frozen cell=${CH.c}, K=${CH.k} (BREADTH) ===`);
console.log("    instrument     class   n     mean_bp   med_bp     t     win%   clears?");
let agreeSign = 0, clearCost = 0, tested12 = 0;
for (const inst of insts) {
  const xs = evByInst.get(inst.symbol)!.filter((e) => !e.train && inCell(e, CH.c)).map((e) => e.net[CH.k]);
  const s = stats(xs);
  TRIALS++;
  const testedOk = s.n >= 20; // per-instrument breadth is thinner than pooled; 20 test events to have any read
  if (testedOk) { tested12++; if (s.mean > 0) agreeSign++; if (s.mean > 0 && s.t >= 1) clearCost++; }
  const verdict = s.n < 20 ? "thin" : s.mean > 0 ? "positive" : "negative";
  console.log(`    ${inst.symbol.padEnd(14)} ${inst.klass.padEnd(6)} ${String(s.n).padStart(4)}  ${bp(s.mean).padStart(8)}  ${bp(s.med).padStart(7)}  ${s.t.toFixed(2).padStart(5)}  ${(s.win * 100).toFixed(0).padStart(4)}%   ${verdict}`);
}
console.log(`    -> of ${tested12} instruments with >=20 test events: ${agreeSign} positive-net, ${clearCost} positive with |t|>=1`);

// ---- TABLE 4: the conditioned cell (operator's liquid+justified) OOS, pooled ----
console.log(`\n  === TABLE 4 — CONDITIONED CELL 'volHi+htfUp' (liquid sweep WITH daily uptrend = bullish stop-run), OOS ===`);
for (const k of KSET) {
  const te = stats(poolNet("volHi+htfUp", k, "test"));
  const base = stats(poolNet("base", k, "test"));
  console.log(`    K${String(k).padStart(2)}  cond: n ${String(te.n).padStart(5)} / ${bp(te.mean).padStart(7)}bp / t ${te.t.toFixed(2).padStart(5)}    vs base: ${bp(base.mean).padStart(7)}bp / t ${base.t.toFixed(2)}`);
}

// ---- VERDICT: does any defensible cell clear cost OOS across a majority of instruments? ----
// Gate (5): OOS pooled net > 0 with t>=2 at the FROZEN choice, >=6 of 12 instruments positive-net, >=50 test events.
const frozenTest = stats(poolNet(CH.c, CH.k, "test"));
const CLEARS = best !== null && frozenTest.n >= MIN_EVENTS && frozenTest.mean > 0 && frozenTest.t >= 2 && agreeSign >= 6;
console.log(`\n  ================================ VERDICT ================================`);
console.log(`  Frozen cell=${CH.c}, K=${CH.k}: OOS pooled net ${bp(frozenTest.mean)}bp, t ${frozenTest.t.toFixed(2)}, n ${frozenTest.n}; ${agreeSign}/${tested12} instruments positive.`);
console.log(`  Gate (net>0 & t>=2 & >=6/12 instruments & >=50 events): ${CLEARS ? "MET — clears cost OOS" : "NOT MET"}`);
console.log(`  TOTAL TRIALS (cells computed): ${TRIALS}`);
console.log(`  SELECTION LAW: the frozen choice was made on TRAIN only; TABLE 1 is the full grid — any single best cell is in-sample.`);

// ---- DUMP (for mtf-sizer.ts): every event, every K, with its cell membership. The sizer never re-derives the signal;
//      it sizes exactly what this script measured, so a sizing number can always be traced to a printed cell. ----
if (K.DUMP) {
  const cells = CELLS.map((c) => ({
    cell: `psl-fade/${c}`, rt_bp_by_class: { crypto: Number(K.CRYPTO_RT_BP), idx: Number(K.IDX_RT_BP), fx: Number(K.FX_RT_BP) },
    K: KSET, frozen: best ? { cell: `psl-fade/${best.c}`, K: best.k } : null,
    events: insts.flatMap((inst) => evByInst.get(inst.symbol)!.filter((e) => inCell(e, c))
      .map((e) => ({ symbol: inst.symbol, klass: inst.klass, ts: e.ts, train: e.train, net: e.net }))),
  }));
  await Deno.writeTextFile(K.DUMP, JSON.stringify({ source: "mtf-psl-fade.ts", written: new Date().toISOString(), split: K.SPLIT, cells }));
  console.log(`  DUMP -> ${K.DUMP} (${cells.map((c) => `${c.cell}:${c.events.length}`).join(", ")})`);
}

// Emit a machine-readable verdict line the writer path / operator can grep.
console.log(`\nVERDICT_JSON ${JSON.stringify({ clears: CLEARS, cell: CH.c, k: CH.k, oos_net_bp: Number(bp(frozenTest.mean)), oos_t: Number(frozenTest.t.toFixed(2)), oos_n: frozenTest.n, instruments_positive: agreeSign, instruments_tested: tested12 })}`);
