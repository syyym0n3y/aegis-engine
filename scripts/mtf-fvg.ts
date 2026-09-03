#!/usr/bin/env -S deno run --allow-net --allow-env
// mtf-fvg.ts — DOES PRICE RESPECT FAIR VALUE GAPS, AND DO FVG / INVERSE-FVG PREDICT DIRECTION?  (operator's
// explicit "check inverse fair value gaps"). Companion to mtf-liquidity-break.ts; same discipline, new structure.
//
// TWO MECHANICAL QUESTIONS, measured net of pessimistic cost, lag-1, over K in {4,12,24} hours:
//  (1) FVG RESPECT. An FVG is a 3-bar imbalance (mtf-structure.fvgs). A BULLISH FVG below price is meant to act as
//      SUPPORT: when price returns into the zone, does it BOUNCE (continue UP, the gap's direction) or pass through?
//      A BEARISH FVG above price is meant to act as RESISTANCE (bounce DOWN). We take the FIRST re-test of each gap
//      (first bar whose range re-enters the zone), enter at the NEXT bar's open (lag-1), and measure the forward
//      return in the gap's "respect" direction. P(respect) = P(that return > 0 net of cost). A number > 0 with |t|>=2
//      = price respects the gap; ~0 = the gap is a line drawn after the fact.
//  (2) IFVG PREDICTION (the operator's specific ask). An INVERSE FVG is an FVG that price CLOSES THROUGH: a bullish
//      support gap that price closes BELOW has failed as support and is meant to flip to RESISTANCE, predicting
//      CONTINUATION in the new (down) direction; a bearish gap closed ABOVE flips to support (up). mtf-structure marks
//      that close as `invertedAt`. We enter the NEXT bar's open after the inversion and measure the forward return in
//      the inverted direction. P(continuation) net of cost.
//
// DISCIPLINE (stated so the reader can check it — the SMC/ICT domain is the most overfit in retail, MTF_METHOD.md):
//  - LOOK-AHEAD: the FVG is known only at its third bar (`knownAt`); a re-test / inversion is detected at a bar's
//    CLOSE and we transact at the NEXT bar's open (exec="lag1", D-498 same-bar corollary). No structure is read
//    before mtf-structure says it is KNOWN.
//  - SELECTION (D-455): every (instrument x setup x K x conditioning cell) is a TRIAL; the FULL grid is printed; the
//    best cell is IN-SAMPLE and flagged. A train(pre-2023)/test(2023+) split is reported — the size threshold used to
//    split is taken on TRAIN only, never the full sample.
//  - BREADTH (D-443): a cell with < MIN_EVENTS events is UNTESTED, printed but not interpreted.
//  - COST (EXECUTION/COST-INFLATION laws): one round trip per event, charged pessimistically — crypto 7bp, index/gold
//    4bp, FX 2bp. Returns are reported NET. This is one held trade per event, so per-event cost is the right model.
//  - POSITIVE CONTROL (D-641): BTCUSDT FVG count over ~61k bars must be plausible (thousands); the unconditional
//    K-forward return over the same bars is printed as the ~0 benchmark. A zero here would mean broken detection.
//  - PRECONDITION (D-598): declareKnobs + assertNonEmpty; STRICT reads (mkStrictRead, D-757) so a dropped read is not
//    a false null — FX was silently truncated by a non-paged fetch once (D-764); here FX/idx use the strict pager.
//
// DESCRIPTIVE ONLY. No trd_lineage rows, no DECISIONS.md edits, no forward clock — that decision waits for the operator.

import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { Bar, decodeBar, fvgs, Fvg, volumeStates, VolState } from "../supabase/functions/_shared/mtf-structure.ts";

const K = declareKnobs("mtf-fvg", [
  { name: "MIN_EVENTS", def: "50", note: "breadth floor: a cell below this is UNTESTED (BREADTH LAW)" },
  { name: "PART_HI", def: "1.5", note: "participation ratio above which the re-test/inversion bar is 'high-volume'" },
  { name: "CRYPTO_RT_BP", def: "7", note: "crypto taker round-trip cost, bp (pessimistic)" },
  { name: "IDX_RT_BP", def: "4", note: "index/gold CFD round-trip cost, bp (pessimistic)" },
  { name: "FX_RT_BP", def: "2", note: "FX major round-trip cost, bp (pessimistic)" },
  { name: "VOL_N", def: "24", note: "trailing window for volume state" },
  { name: "TEST_FROM", def: "2023-01-01", note: "train = strictly before this date; test = on/after (SELECTION LAW)" },
]);
const MIN_EVENTS = Number(K.MIN_EVENTS), PART_HI = Number(K.PART_HI), VOL_N = Number(K.VOL_N);
const TEST_TS = Math.floor(new Date(K.TEST_FROM + "T00:00:00Z").getTime() / 1000);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mtffvg", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q, qAll } = mkStrictRead(OWNED, hdr);

// ---- instruments: 5 crypto perps + gold/S&P/Nasdaq CFDs + the 4 FX majors = 12, all liquid ----
const CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"]; // gold, S&P, Nasdaq CFDs
const FX = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"];
const KSET = [4, 12, 24];

type Klass = "crypto" | "idx" | "fx";
interface Inst { symbol: string; klass: Klass; rtBp: number; bars: Bar[] }

async function loadCrypto(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = row?.bars || [];
  // drop synthetic flat (h==l) seed/gap bars — they carry no range and would fabricate structure.
  return raw.map(decodeBar).filter((b) => b.h > b.l).sort((a, b) => a.ts - b.ts);
}
async function loadHourly(sym: string, rtBp: number, klass: Klass): Promise<Inst> {
  // STRICT PAGER (qAll asserts completeness against Content-Range) — the fix for the D-764 silent FX truncation.
  const rows = (await qAll(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`)) as
    { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  // DROP forward-fill padding: a bar with h==l is a synthetic closed-session/weekend fill (verified: early tails are
  // flat OHLC). Keeping them would fabricate gaps and levels.
  const bars = rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }))
    .sort((a, b) => a.ts - b.ts);
  return { symbol: sym, klass, rtBp, bars };
}

// ---- daily HTF trend, no look-ahead: sign of (close - close 24 bars ago) ----
function htfTrendUp(bars: Bar[], i: number): boolean | null {
  if (i < 24) return null;
  return bars[i].c > bars[i - 24].c;
}

// ---- an FVG RESPECT event: the first re-test of a gap, with forward return in the gap's respect direction ----
// respect direction: bull gap = support -> expect price to continue UP (dir +1); bear gap = resistance -> DOWN (-1).
interface Evt {
  ts: number;
  sizeBp: number;
  dir: 1 | -1; // the direction we bet on (respect dir for FVG; inverted dir for IFVG)
  fwd: Record<number, number>; // net forward return in `dir` per K, entered lag-1
  partHi: boolean; // participation ratio >= PART_HI at the trigger bar
  htfWith: boolean | null; // `dir` agrees with daily HTF trend at the trigger bar
}

function mkFwd(inst: Inst, i: number, dir: 1 | -1): Record<number, number> | null {
  const b = inst.bars;
  if (i + 1 >= b.length) return null;
  const entry = b[i + 1].o; // lag-1: enter next bar's open, never the trigger close (D-498)
  const fwd: Record<number, number> = {};
  for (const k of KSET) {
    const exitIdx = Math.min(i + 1 + k, b.length - 1);
    const raw = dir * Math.log(b[exitIdx].c / entry);
    fwd[k] = raw - inst.rtBp / 1e4; // full round trip charged (pessimistic)
  }
  return fwd;
}

// FVG RESPECT events for one instrument.
function respectEvents(inst: Inst, gaps: Fvg[], vs: VolState[]): Evt[] {
  const b = inst.bars;
  const maxK = Math.max(...KSET);
  const out: Evt[] = [];
  for (const g of gaps) {
    // first re-test: first bar j after the gap is known whose range re-enters the zone [bottom, top].
    // (bar low <= top && bar high >= bottom = intrabar overlap with the zone). No same-bar action: we enter at j+1.
    let j = -1;
    for (let x = g.knownAt + 1; x < b.length - maxK - 1; x++) {
      if (b[x].l <= g.top && b[x].h >= g.bottom) { j = x; break; }
    }
    if (j < 0) continue;
    const dir: 1 | -1 = g.dir === "bull" ? 1 : -1; // support -> up ; resistance -> down
    const fwd = mkFwd(inst, j, dir);
    if (!fwd) continue;
    const v = vs[j];
    out.push({
      ts: b[j].ts, sizeBp: g.sizeBp, dir, fwd,
      partHi: Number.isFinite(v.partRatio) && v.partRatio >= PART_HI,
      htfWith: htfTrendUp(b, j) === null ? null : (dir === 1 ? htfTrendUp(b, j)! : !htfTrendUp(b, j)!),
    });
  }
  return out;
}

// IFVG events: the inversion close flips the gap; predict CONTINUATION in the new direction.
// bull gap closed-through-DOWN -> resistance -> predict DOWN (dir -1). bear gap closed-through-UP -> predict UP (+1).
function ifvgEvents(inst: Inst, gaps: Fvg[], vs: VolState[]): Evt[] {
  const b = inst.bars;
  const maxK = Math.max(...KSET);
  const out: Evt[] = [];
  for (const g of gaps) {
    if (g.invertedAt === null) continue;
    const j = g.invertedAt;
    if (j >= b.length - maxK - 1) continue;
    const dir: 1 | -1 = g.dir === "bull" ? -1 : 1; // inverted direction
    const fwd = mkFwd(inst, j, dir);
    if (!fwd) continue;
    const v = vs[j];
    out.push({
      ts: b[j].ts, sizeBp: g.sizeBp, dir, fwd,
      partHi: Number.isFinite(v.partRatio) && v.partRatio >= PART_HI,
      htfWith: htfTrendUp(b, j) === null ? null : (dir === 1 ? htfTrendUp(b, j)! : !htfTrendUp(b, j)!),
    });
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
  const win = xs.filter((x) => x > 0).length / n;
  return { n, mean, med, t, win };
}

// ---------------------------------------------------------------------------------------------------------------
console.log("==> MTF FVG / INVERSE-FVG: does price RESPECT fair value gaps, and do FVG/IFVG PREDICT direction?\n");
console.log("    exec=lag1 (enter next-bar open); one round trip charged per event; DESCRIPTIVE ONLY.");
console.log(`    train < ${K.TEST_FROM} ; test >= ${K.TEST_FROM} (SELECTION LAW). breadth floor n>=${MIN_EVENTS}.\n`);

let TRIALS = 0;
const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rtBp: Number(K.CRYPTO_RT_BP), bars: await loadCrypto(s) });
for (const s of IDX) insts.push(await loadHourly(s, Number(K.IDX_RT_BP), "idx"));
for (const s of FX) insts.push(await loadHourly(s, Number(K.FX_RT_BP), "fx"));
for (const inst of insts) assertNonEmpty(`${inst.symbol} bars`, inst.bars, 5000);

// precompute gaps + volume state + the two event sets per instrument (once).
interface Pack { inst: Inst; gaps: Fvg[]; respect: Evt[]; ifvg: Evt[] }
const packs: Pack[] = [];
for (const inst of insts) {
  const gaps = fvgs(inst.bars);
  const vs = volumeStates(inst.bars, VOL_N);
  packs.push({ inst, gaps, respect: respectEvents(inst, gaps, vs), ifvg: ifvgEvents(inst, gaps, vs) });
}

// POSITIVE CONTROL — BTCUSDT gap count must be plausible (thousands); unconditional K-fwd return ~0.
{
  const p = packs.find((x) => x.inst.symbol === "BTCUSDT")!;
  const b = p.inst.bars;
  const bench: number[] = [];
  for (let i = 25; i < b.length - 13; i += Math.max(1, Math.floor(b.length / 3000))) bench.push(Math.log(b[i + 12].c / b[i + 1].c));
  const bs = stats(bench);
  console.log(`  POSITIVE CONTROL — BTCUSDT: ${p.gaps.length} FVGs detected over ${b.length} bars (thousands plausible)`);
  console.log(`    of which re-tested: ${p.respect.length}   inverted (IFVG): ${p.ifvg.length}`);
  console.log(`    unconditional 12h fwd return benchmark: mean ${(bs.mean * 1e4).toFixed(2)}bp, t ${bs.t.toFixed(2)}, n ${bs.n} (should be ~0)\n`);
  if (p.gaps.length < 1000) { console.error("!! positive control FAILED: too few FVGs — detection is broken."); Deno.exit(1); }
  if (p.respect.length < 50 || p.ifvg.length < 50) { console.error("!! positive control FAILED: too few re-tests/inversions."); Deno.exit(1); }
}

// ---- THE GRID: per instrument, per setup, per K — unconditional + conditional cells (each line a trial) ----
function gridFor(setup: "RESPECT" | "IFVG", pick: (p: Pack) => Evt[]) {
  const verdictWord = setup === "RESPECT" ? ["RESPECTED", "rejected"] : ["CONTINUES", "fades"];
  console.log(`\n================ ${setup} ${setup === "RESPECT" ? "(bull FVG=support/up, bear FVG=resistance/down; +=respected)" : "(IFVG predicts continuation in inverted dir; +=continues)"} ================`);
  for (const p of packs) {
    const evAll = pick(p);
    // size threshold from TRAIN only (SELECTION LAW): median gap size of train events.
    const trainSizes = evAll.filter((e) => e.ts < TEST_TS).map((e) => e.sizeBp).sort((a, b) => a - b);
    const sizeThr = trainSizes.length ? trainSizes[trainSizes.length >> 1] : 0;
    console.log(`\n  ${p.inst.symbol} [${p.inst.klass}, ${p.inst.bars.length} bars, RT ${p.inst.rtBp}bp] — ${evAll.length} ${setup} events  (train size-median ${sizeThr.toFixed(1)}bp)`);
    console.log(`    K    n     mean_bp  med_bp    t    P(+)   verdict       | sizeHi            volHi             HTFwith           test(>=${K.TEST_FROM})`);
    for (const k of KSET) {
      const all = evAll.map((e) => e.fwd[k]);
      const s = stats(all);
      TRIALS++;
      const v = s.n < MIN_EVENTS ? "UNTESTED"
        : Math.abs(s.t) < 2 ? "noise"
        : s.mean > 0 ? verdictWord[0] : verdictWord[1];
      const conds: [string, Evt[]][] = [
        ["sizeHi", evAll.filter((e) => e.sizeBp >= sizeThr)],
        ["volHi", evAll.filter((e) => e.partHi)],
        ["HTFwith", evAll.filter((e) => e.htfWith === true)],
        ["test", evAll.filter((e) => e.ts >= TEST_TS)],
      ];
      const parts: string[] = [];
      for (const [nm, sub] of conds) {
        TRIALS++;
        if (sub.length < MIN_EVENTS) { parts.push(`${nm}:n${sub.length}·untd`.padEnd(17)); continue; }
        const ss = stats(sub.map((e) => e.fwd[k]));
        const tag = Math.abs(ss.t) < 2 ? "~" : ss.mean > 0 ? "+" : "-";
        parts.push(`${nm}:${(ss.mean * 1e4).toFixed(1)}bp t${ss.t.toFixed(1)}${tag}`.padEnd(17));
      }
      console.log(`    ${String(k).padStart(2)}  ${String(s.n).padStart(5)}  ${(s.mean * 1e4).toFixed(2).padStart(7)}  ${(s.med * 1e4).toFixed(2).padStart(6)}  ${s.t.toFixed(2).padStart(5)}  ${(s.win * 100).toFixed(0).padStart(3)}%  ${v.padEnd(12)} | ${parts.join(" ")}`);
    }
  }
}
gridFor("RESPECT", (p) => p.respect);
gridFor("IFVG", (p) => p.ifvg);

// ---------------------------------------------------------------------------------------------------------------
// VERDICT — cross-instrument agreement (SELECTION-safe: the pattern ACROSS the 12 instruments, not one cell), and a
// train/test check per setup. A setup is a candidate only if a MAJORITY of instruments agree in SIGN and it survives
// on TEST (2023+) with the sign intact.
function crossInstrument(setup: "RESPECT" | "IFVG", pick: (p: Pack) => Evt[], k: number, from?: number, to?: number) {
  let pos = 0, neg = 0, tested = 0; const ts: number[] = [];
  for (const p of packs) {
    const ev = pick(p).filter((e) => (from === undefined || e.ts >= from) && (to === undefined || e.ts < to));
    const s = stats(ev.map((e) => e.fwd[k]));
    if (s.n < MIN_EVENTS) continue;
    tested++; ts.push(s.t);
    if (Math.abs(s.t) >= 2) { if (s.mean > 0) pos++; else neg++; }
  }
  return { tested, pos, neg, meanT: ts.reduce((a, c) => a + c, 0) / (ts.length || 1) };
}
console.log(`\n  ================================ VERDICT (calibrated confidence) ================================`);
for (const [name, pick] of [["FVG RESPECT", (p: Pack) => p.respect], ["IFVG CONTINUATION", (p: Pack) => p.ifvg]] as [string, (p: Pack) => Evt[]][]) {
  console.log(`\n  ${name} — sig instruments (|t|>=2) of tested, at each K:`);
  for (const k of KSET) {
    const full = crossInstrument(name.startsWith("FVG") ? "RESPECT" : "IFVG", pick, k);
    const tr = crossInstrument(name.startsWith("FVG") ? "RESPECT" : "IFVG", pick, k, undefined, TEST_TS);
    const te = crossInstrument(name.startsWith("FVG") ? "RESPECT" : "IFVG", pick, k, TEST_TS, undefined);
    console.log(`    K${String(k).padStart(2)}  FULL: ${full.pos}+ / ${full.neg}- of ${full.tested} (t̄ ${full.meanT.toFixed(2)})   TRAIN: ${tr.pos}+/${tr.neg}- of ${tr.tested}   TEST: ${te.pos}+/${te.neg}- of ${te.tested} (t̄ ${te.meanT.toFixed(2)})`);
  }
}

console.log(`\n  TOTAL TRIALS (cells computed, incl. conditionals + train/test splits): ${TRIALS}`);
console.log(`  SELECTION LAW: the above is the FULL grid. Any single "best" cell is IN-SAMPLE; do not read one row as an edge.`);
console.log(`  BREADTH: a cell with n < ${MIN_EVENTS} is UNTESTED, not a null. All returns are NET of round-trip cost.`);
console.log(`  DESCRIPTIVE ONLY — no lineage/DECISIONS writes, no forward clock (that decision waits for the operator).`);
