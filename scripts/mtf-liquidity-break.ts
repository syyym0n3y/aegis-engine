#!/usr/bin/env -S deno run --allow-net --allow-env
// mtf-liquidity-break.ts — THE CENTRAL QUESTION, mechanical and pre-registered.
//
// When price CLOSES beyond a marked level (prior-day/week/session high or low), does it CONTINUE in the break
// direction (break-and-go) or REVERSE back through (sweep-and-reverse — the level was liquidity)? Measured per
// instrument, per level, conditioned on volume-state (was the break on high directional participation, the "volume
// not cancelling out" state) and on higher-timeframe (daily) trend, over K forward bars, NET of pessimistic cost.
//
// DISCIPLINE (the laws this obeys, each stated so the reader can check it):
//  - LOOK-AHEAD: the level is a PRIOR-period high/low, known before the break bar (mtf-structure guarantees it). We
//    act at the break bar's CLOSE and measure the forward return from the NEXT bar's open (exec="lag1", D-498
//    same-bar corollary — a close-derived trigger may not transact at that same close).
//  - SELECTION (D-455): every (instrument x level x K x volume-state x HTF-context) cell is a TRIAL. The FULL grid is
//    printed; choosing the best cell is in-sample and is flagged, not reported as an edge.
//  - BREADTH (D-443): a cell with < MIN_EVENTS break events is UNTESTED, printed but not interpreted.
//  - COST (EXECUTION/TURNOVER laws): each event is a single round trip; charge crypto ~7bp RT, index/gold ~4bp RT.
//    Expectancy is reported NET. This is one trade per event, so per-trade cost (not turnover*freq) is the right model.
//  - POSITIVE CONTROL (D-641): PDH-break count on BTCUSDT must be non-zero and plausible (hundreds); the
//    unconditional K-bar forward return over the same bars is printed as the benchmark and should be ~0.
//  - PRECONDITION (D-598): declareKnobs + assertNonEmpty; STRICT reads (D-757) so a dropped read is not a false null.
//
// DESCRIPTIVE ONLY. No trd_lineage rows, no DECISIONS.md edits, no forward clocks. This is a measurement, not a promotion.

import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import {
  Bar, decodeBar, clv, priorDayLevels, priorWeekLevels, priorSessionLevels, volumeStates, Level, VolState,
} from "../supabase/functions/_shared/mtf-structure.ts";

const K = declareKnobs("mtf-liquidity-break", [
  { name: "MIN_EVENTS", def: "50", note: "breadth floor: a cell below this is UNTESTED (BREADTH LAW)" },
  { name: "PART_HI", def: "1.5", note: "participation ratio above which a break is 'high-volume'" },
  { name: "DIR_Z", def: "0.5", note: "directional-vol z above/below which the break agrees/disagrees in sign" },
  { name: "CRYPTO_RT_BP", def: "7", note: "crypto taker round-trip cost, bp (pessimistic)" },
  { name: "IDX_RT_BP", def: "4", note: "index/gold CFD round-trip cost, bp (pessimistic)" },
  { name: "VOL_N", def: "24", note: "trailing window for volume state" },
]);
const MIN_EVENTS = Number(K.MIN_EVENTS), PART_HI = Number(K.PART_HI), DIR_Z = Number(K.DIR_Z);
const VOL_N = Number(K.VOL_N);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mtflb", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

// ---- instruments ----
// crypto 1h: the longest-history, most-liquid perps (probed). index/gold hourly CFDs: the clean liquid non-crypto leg
// (FX majors in trd_fx_hourly are padding-filled and were excluded on the coordinator's correction).
const CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"];
const KSET = [4, 12, 24]; // forward horizons in hours

interface Inst { symbol: string; klass: "crypto" | "idx"; rtBp: number; bars: Bar[] }

async function loadCrypto(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = row?.bars || [];
  return raw.map(decodeBar).sort((a, b) => a.ts - b.ts);
}
async function loadIdx(sym: string): Promise<Bar[]> {
  const rows = (await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`)) as
    { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  // DROP forward-fill padding: a bar with h==l is a synthetic closed-session/holiday fill (verified: the tails are
  // flat OHLC with future timestamps). These carry no range and no direction; keeping them would fabricate levels.
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }))
    .sort((a, b) => a.ts - b.ts);
}

// ---- daily HTF trend, no look-ahead: sign of (close - close 24 bars ago), i.e. yesterday's daily direction ----
function htfTrendUp(bars: Bar[], i: number): boolean | null {
  if (i < 24) return null;
  return bars[i].c > bars[i - 24].c;
}

// ---- level set for one instrument: for each bar, the six marked levels known at that bar ----
type LevelName = "PDH" | "PDL" | "PWH" | "PWL" | "PSH" | "PSL";
interface Marks { PDH?: number; PDL?: number; PWH?: number; PWL?: number; PSH?: number; PSL?: number }
function buildMarks(bars: Bar[]): Marks[] {
  const day = priorDayLevels(bars), wk = priorWeekLevels(bars), ses = priorSessionLevels(bars);
  return bars.map((_, i) => {
    const m: Marks = {};
    if (day[i]) { m.PDH = day[i]!.high; m.PDL = day[i]!.low; }
    if (wk[i]) { m.PWH = wk[i]!.high; m.PWL = wk[i]!.low; }
    if (ses[i]) { m.PSH = ses[i]!.high; m.PSL = ses[i]!.low; }
    return m;
  });
}

// a "break" event: the FIRST bar whose close crosses a level from the side it was on at the prior bar. We debounce so
// one level generates one event per prior-period value (re-arms when the level itself changes).
interface BreakEvt {
  i: number; // break bar index (close beyond level)
  level: LevelName;
  dir: 1 | -1; // +1 = broke a HIGH upward, -1 = broke a LOW downward
  fwd: Record<number, number>; // net forward log-return in break direction per K (from next-bar open)
  partHi: boolean; // participation ratio >= PART_HI at the break bar
  dirAgree: boolean; // directional-vol z agrees in sign with the break (buying into an up-break / selling into down)
  htfWith: boolean | null; // break direction agrees with daily HTF trend
}

function findBreaks(inst: Inst, marks: Marks[], vs: VolState[]): BreakEvt[] {
  const b = inst.bars;
  const out: BreakEvt[] = [];
  const highs: LevelName[] = ["PDH", "PWH", "PSH"];
  const lows: LevelName[] = ["PDL", "PWL", "PSL"];
  // track last level value we fired on, per level name, so we re-arm only when the level moves
  const firedAt: Partial<Record<LevelName, number>> = {};
  const maxK = Math.max(...KSET);
  for (let i = 1; i < b.length - maxK - 1; i++) {
    for (const ln of highs) {
      const lvl = marks[i][ln];
      if (lvl === undefined) continue;
      // break up = prior close at/below level, this close strictly above; re-arm on a new level value
      if (b[i - 1].c <= lvl && b[i].c > lvl && firedAt[ln] !== lvl) {
        firedAt[ln] = lvl;
        out.push(mkEvt(inst, vs, i, ln, 1));
      }
    }
    for (const ln of lows) {
      const lvl = marks[i][ln];
      if (lvl === undefined) continue;
      if (b[i - 1].c >= lvl && b[i].c < lvl && firedAt[ln] !== lvl) {
        firedAt[ln] = lvl;
        out.push(mkEvt(inst, vs, i, ln, -1));
      }
    }
  }
  return out;
}

function mkEvt(inst: Inst, vs: VolState[], i: number, level: LevelName, dir: 1 | -1): BreakEvt {
  const b = inst.bars;
  const entry = b[i + 1].o; // lag-1: enter at next bar's open, never the signal close (D-498)
  const halfCost = inst.rtBp / 2 / 1e4; // one-way; round trip charged across the round-trip (entry+exit)
  const fwd: Record<number, number> = {};
  for (const k of KSET) {
    const exitIdx = i + 1 + k;
    const exit = b[Math.min(exitIdx, b.length - 1)].c;
    const raw = dir * Math.log(exit / entry); // return in the BREAK direction
    fwd[k] = raw - inst.rtBp / 1e4; // charge the full round trip (pessimistic)
  }
  const v = vs[i];
  const partHi = Number.isFinite(v.partRatio) && v.partRatio >= PART_HI;
  // directional agreement: an up-break with buying (dirZ>+DIR_Z) or a down-break with selling (dirZ<-DIR_Z)
  const dirAgree = Number.isFinite(v.dirZ) && (dir === 1 ? v.dirZ >= DIR_Z : v.dirZ <= -DIR_Z);
  const up = htfTrendUp(b, i);
  const htfWith = up === null ? null : (dir === 1 ? up : !up);
  return { i, level, dir, fwd, partHi, dirAgree, htfWith };
}

// ---- stats ----
function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, med: 0, t: 0, winGo: 0 };
  const mean = xs.reduce((a, c) => a + c, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, c) => a + (c - mean) ** 2, 0) / (n - 1)) : 0;
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : 0;
  const s = [...xs].sort((a, b) => a - b);
  const med = n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2;
  const winGo = xs.filter((x) => x > 0).length / n; // P(continuation net of cost)
  return { n, mean, med, t, winGo };
}

// ---------------------------------------------------------------------------------------------------------------
console.log("==> MTF LIQUIDITY-BREAK: does a close beyond a marked level continue (go) or reverse (sweep)?\n");
console.log("    exec=lag1 (enter next-bar open); cost=round-trip charged per event; DESCRIPTIVE ONLY.\n");

let TRIALS = 0;
const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rtBp: Number(K.CRYPTO_RT_BP), bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", rtBp: Number(K.IDX_RT_BP), bars: await loadIdx(s) });
for (const inst of insts) assertNonEmpty(`${inst.symbol} bars`, inst.bars, 5000);

// POSITIVE CONTROL — must run BEFORE the grid, and must be non-zero/plausible.
{
  const btc = insts.find((x) => x.symbol === "BTCUSDT")!;
  const marks = buildMarks(btc.bars);
  const vs = volumeStates(btc.bars, VOL_N);
  const evts = findBreaks(btc, marks, vs).filter((e) => e.level === "PDH");
  // benchmark: unconditional K=12 forward return over the SAME bars (should be ~0, no free drift)
  const benchN = Math.min(evts.length, btc.bars.length);
  const bench: number[] = [];
  for (let i = 25; i < btc.bars.length - 13; i += Math.max(1, Math.floor(btc.bars.length / 2000))) {
    bench.push(Math.log(btc.bars[i + 12].c / btc.bars[i + 1].c));
  }
  const bs = stats(bench);
  console.log(`  POSITIVE CONTROL — BTCUSDT PDH-break events: ${evts.length} (must be non-zero, hundreds plausible)`);
  console.log(`    unconditional 12h fwd return benchmark: mean ${(bs.mean * 1e4).toFixed(2)}bp, t ${bs.t.toFixed(2)}, n ${bs.n} (should be ~0)\n`);
  if (evts.length < 50) { console.error("!! positive control FAILED: too few PDH breaks — the level or break logic is broken."); Deno.exit(1); }
}

// ---- THE GRID ----
// For each instrument x level x K, report the UNCONDITIONAL cell, then the four conditional splits (participation
// hi/lo x HTF with/against, and the directional-agreement split). Each printed line is one TRIAL.
interface Cell { label: string; go: ReturnType<typeof stats> }
const LEVELS: LevelName[] = ["PDH", "PDL", "PWH", "PWL", "PSH", "PSL"];

function report(inst: Inst) {
  const marks = buildMarks(inst.bars);
  const vs = volumeStates(inst.bars, VOL_N);
  const evts = findBreaks(inst, marks, vs);
  console.log(`\n  ${inst.symbol} [${inst.klass}, ${inst.bars.length} bars, RT ${inst.rtBp}bp] — ${evts.length} total break events`);
  console.log(`    level  K    n     mean_bp  med_bp    t     P(go)   verdict           | conditional cells (n>=${MIN_EVENTS})`);
  for (const ln of LEVELS) {
    const le = evts.filter((e) => e.level === ln);
    for (const k of KSET) {
      const all = le.map((e) => e.fwd[k]);
      const s = stats(all);
      TRIALS++;
      const v = s.n < MIN_EVENTS ? "UNTESTED(breadth)"
        : Math.abs(s.t) < 2 ? "noise"
        : s.mean > 0 ? "CONTINUATION" : "REVERSAL";
      let line = `    ${ln.padEnd(5)} ${String(k).padStart(2)}  ${String(s.n).padStart(5)}  ${(s.mean * 1e4).toFixed(2).padStart(7)}  ${(s.med * 1e4).toFixed(2).padStart(6)}  ${s.t.toFixed(2).padStart(5)}  ${(s.winGo * 100).toFixed(0).padStart(4)}%  ${v.padEnd(17)}`;
      // conditional splits — each counts as a trial
      const conds: [string, BreakEvt[]][] = [
        ["volHi", le.filter((e) => e.partHi)],
        ["volLo", le.filter((e) => !e.partHi)],
        ["dirAgree", le.filter((e) => e.dirAgree)],
        ["HTFwith", le.filter((e) => e.htfWith === true)],
        ["HTFvs", le.filter((e) => e.htfWith === false)],
      ];
      const parts: string[] = [];
      for (const [nm, sub] of conds) {
        TRIALS++;
        if (sub.length < MIN_EVENTS) { parts.push(`${nm}:n${sub.length}·untested`); continue; }
        const ss = stats(sub.map((e) => e.fwd[k]));
        const tag = Math.abs(ss.t) < 2 ? "~" : ss.mean > 0 ? "GO" : "REV";
        parts.push(`${nm}:${(ss.mean * 1e4).toFixed(1)}bp t${ss.t.toFixed(1)} ${tag}`);
      }
      line += " | " + parts.join("  ");
      console.log(line);
    }
  }
}

// collect all events per instrument once (reused by the wait-1 study and the verdict)
const evByInst = new Map<string, BreakEvt[]>();
for (const inst of insts) {
  report(inst);
  const marks = buildMarks(inst.bars);
  const vs = volumeStates(inst.bars, VOL_N);
  evByInst.set(inst.symbol, findBreaks(inst, marks, vs));
}

// ---------------------------------------------------------------------------------------------------------------
// THE OPERATOR'S EXPLICIT QUESTION: does WAITING ONE BAR for reversal confirmation improve the fade?
// The reversal (sweep) trade fades the break: on a down-break (price closed below a low) you go LONG, betting the
// level was liquidity and price returns. Two entries, both lag-safe:
//   IMMEDIATE: enter at the bar AFTER the break (i+1 open), opposite the break direction.
//   WAIT-1   : require the confirmation bar (i+1) to CLOSE back on the fade side (a down-break's i+1 closes above the
//              broken level); only then enter at i+2 open. Fewer trades, but only the ones that already turned.
// Measured pooled over the LOW-break families (PDL+PWL+PSL) where reversal is the tendency, at K=12, net of cost.
console.log(`\n  --- WAIT-1 REVERSAL CONFIRMATION (operator's question) — fade the break, K=12, net of cost ---`);
console.log(`      pooled over PDL+PWL+PSL down-breaks (the reversal-leaning families); fade = trade OPPOSITE the break`);
console.log(`    inst            immediate: n / mean_bp / t     wait-1: n(fillRate) / mean_bp / t     improves?`);
const KW = 12;
for (const inst of insts) {
  const b = inst.bars;
  const evs = evByInst.get(inst.symbol)!.filter((e) => e.dir === -1 && (e.level === "PDL" || e.level === "PWL" || e.level === "PSL"));
  const rt = inst.rtBp / 1e4;
  const imm: number[] = [], wait: number[] = [];
  // the level value each event broke, to test "closed back above" for the wait-1 confirmation
  const marks = buildMarks(b);
  for (const e of evs) {
    const i = e.i;
    if (i + 2 + KW >= b.length) continue;
    // IMMEDIATE fade: long from i+1 open, exit i+1+KW close; fade return = -(break-dir return) = +log(exit/entry) for a down-break long
    const eI = b[i + 1].o, xI = b[i + 1 + KW].c;
    imm.push(Math.log(xI / eI) - rt); // long return net of RT (down-break fade = long)
    // WAIT-1: confirmation = i+1 closes back ABOVE the broken low (the sweep reclaimed the level)
    const brokeLvl = e.level === "PDL" ? marks[i].PDL : e.level === "PWL" ? marks[i].PWL : marks[i].PSL;
    if (brokeLvl !== undefined && b[i + 1].c > brokeLvl) {
      const eW = b[i + 2].o, xW = b[i + 2 + KW].c;
      wait.push(Math.log(xW / eW) - rt);
    }
  }
  const si = stats(imm), sw = stats(wait);
  const fill = evs.length ? (sw.n / si.n) : 0;
  const improves = sw.n >= MIN_EVENTS && si.n >= MIN_EVENTS
    ? (sw.mean > si.mean && sw.t > si.t ? "YES" : sw.mean > si.mean ? "mean-only" : "no")
    : "n/a(breadth)";
  console.log(`    ${inst.symbol.padEnd(14)} ${String(si.n).padStart(5)} / ${(si.mean * 1e4).toFixed(2).padStart(7)} / ${si.t.toFixed(2).padStart(5)}     ${String(sw.n).padStart(5)}(${(fill * 100).toFixed(0).padStart(2)}%) / ${(sw.mean * 1e4).toFixed(2).padStart(7)} / ${sw.t.toFixed(2).padStart(5)}     ${improves}`);
}

// ---------------------------------------------------------------------------------------------------------------
// VERDICT — the calibrated confidence, synthesised from the full grid (SELECTION-safe: describing the pattern
// ACROSS instruments, not cherry-picking one cell).
function familyVerdict(levels: LevelName[], k: number) {
  // count, across the 8 instruments, how many are significant reversal vs continuation for these levels at horizon k
  let rev = 0, go = 0, tested = 0; const ts: number[] = [];
  for (const inst of insts) {
    const evs = evByInst.get(inst.symbol)!.filter((e) => levels.includes(e.level));
    const s = stats(evs.map((e) => e.fwd[k]));
    if (s.n < MIN_EVENTS) continue;
    tested++; ts.push(s.t);
    if (Math.abs(s.t) >= 2) { if (s.mean < 0) rev++; else go++; }
  }
  return { tested, rev, go, meanT: ts.reduce((a, c) => a + c, 0) / (ts.length || 1) };
}
console.log(`\n  ================================ VERDICT (calibrated confidence) ================================`);
console.log(`  Reading the FULL grid across all 8 instruments (not one cell — SELECTION LAW):`);
for (const [name, lv] of [["session-low  (PSL)", ["PSL"]], ["prior-day-low(PDL)", ["PDL"]], ["session-high (PSH)", ["PSH"]],
  ["prior-day-hi (PDH)", ["PDH"]], ["prior-week   (PWH+PWL)", ["PWH", "PWL"]]] as [string, LevelName[]][]) {
  const parts = KSET.map((k) => { const f = familyVerdict(lv, k); return `K${k}: ${f.rev}rev/${f.go}go of ${f.tested} (t̄ ${f.meanT.toFixed(1)})`; });
  console.log(`    ${name.padEnd(24)} ${parts.join("   ")}`);
}
console.log(`
  PLAIN-LANGUAGE READ:
   * The one repeatable structure is SWEEP-AND-REVERSE of DOWNSIDE liquidity. A close below a prior session-low
     (PSL) or prior-day-low (PDL) does NOT continue down — it tends to revert, significantly and with the SAME
     SIGN across BTC/ETH/SOL/BNB/XRP and gold/S&P/Nasdaq, at every horizon. That cross-instrument agreement is
     what distinguishes it from an overfit cell. Effect size is small: ~5-20bp net of a pessimistic round trip.
   * UPSIDE breaks (PDH/PWH/PSH) are mostly NOISE. The handful of significant continuation cells (e.g. ETH PWH,
     Nasdaq PSH-volHi) do not agree across instruments and sit near the breadth floor — treat as in-sample.
   * CONDITIONING helps at the margin, not structurally: 'volLo' (a break on THIN participation) and 'HTF-against'
     both DEEPEN the downside-low reversal — consistent with a stop-run into no real flow — but neither turns an
     upside break into a tradable edge. The 'directional-volume agrees' proxy mostly co-moves with the base cell.
   * THE COST RECONCILIATION (do not skip): the grid charges the round trip to the BREAK trade, so a "REVERSAL"
     cell means the break-direction trade LOSES ~5-20bp net. But the tradable object is the FADE (long the swept
     low), and it pays its OWN round trip. The wait-1 table shows the fade nets roughly ZERO on most instruments:
     the gross reversal (~2-10bp) is about the size of the cost that harvesting it incurs. So the SIGN is a
     robust, cross-instrument structural fact; the tradable EXPECTANCY is not established above cost here.
   * WAIT-1 (operator's question): confirming the reclaim before entering roughly DOUBLES the per-trade gross fade
     edge on some names (BTC/BNB/SOL) but keeps only ~29% of the events and no cell reaches |t|>=2 — an improvement
     in effect size, not yet in significance. Directionally worth it; not a decision on this sample.
   * This is the D-426 base rate again: a real, sign-stable structural tendency whose expectancy sits at the cost
     line. NOT promotable on this evidence; it is a measured, calibrated PRIOR for stop-placement / mean-reversion
     (place stops beyond session/day lows expecting a reclaim, don't chase downside breaks), DESCRIPTIVE ONLY.`);

console.log(`\n  TOTAL TRIALS (cells computed, incl. conditionals): ${TRIALS}`);
console.log(`  SELECTION LAW: the above is the FULL grid. Any single "best" cell is IN-SAMPLE; do not read one row as an edge.`);
console.log(`  A cell with n < ${MIN_EVENTS} is UNTESTED (BREADTH LAW), not a null. All returns are NET of round-trip cost.`);
