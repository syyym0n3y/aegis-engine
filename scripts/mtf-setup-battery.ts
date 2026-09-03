#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// mtf-setup-battery.ts (D-766) — the broad MTF setup battery the operator asked for: five ADDITIONAL mechanical
// setups beyond D-763/764/765, each measured per-instrument across the 12-instrument panel, lag-1, net of a
// pessimistic round-trip cost, train(<2023)/test(>=2023), with a RISK PROFILE per cell (sd, median adverse
// excursion, worst decile) so scripts/mtf-sizer.ts can size any survivor without re-deriving anything.
//
// Setups (direction convention: returns are SIGNED IN THE HYPOTHESIS DIRECTION, so mean>0 = hypothesis holds,
// mean<0 = the market does the OPPOSITE at that horizon — the D-763 lesson is that the opposite is the norm):
//   1. bos-cont      up/down break of structure -> CONTINUATION in the break direction
//   2. eqhl-break    close beyond an EQUAL-HIGHS/LOWS pool (2+ swings within EQ_TOL bp) -> CONTINUATION
//   3. retest-hold   after a BOS, first return to the broken swing price within RETEST_M bars -> HOLD (continue)
//   4. dayopen-rev   close >= DO_BP beyond today's open -> REVERSION toward the open (mean>0 = reverts)
//   5. sess-drive    direction of the first 3 bars of London/NY -> PERSISTS for the next K bars
// Conditions per setup: base | volHi (participation>=1.5) | killzone (London 07-10 / NY 13-16 UTC) |
//   htfWith / htfAgainst (24-bar trend agrees/disagrees with the trade direction).
// LAWS: SELECTION (grid printed in full, every cell a counted trial, no post-hoc pick); BREADTH (floor 50);
// EXECUTION same-bar corollary (entry at NEXT bar open, D-498); COVERAGE (per-instrument event counts printed);
// POSITIVE-CONTROL (unconditional forward return ~0; event counts non-zero); PRECONDITION (declareKnobs +
// mkStrictRead, D-757). All t-stats are on net-of-cost per-event returns. DESCRIPTIVE ONLY — no lineage writes.
import {
  Bar, breaksOfStructure, clv, fvgs as _fvgs, priorDayLevels, sessionOf, swings, utcDayKey, volumeStates,
} from "../supabase/functions/_shared/mtf-structure.ts";
import { decodeBar } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-setup-battery", [
  { name: "MIN_EVENTS", def: "50", note: "breadth floor (BREADTH LAW)" },
  { name: "PART_HI", def: "1.5", note: "participation ratio for the volHi condition" },
  { name: "EQ_TOL_BP", def: "10", note: "two swing highs/lows within this many bp = an equal-highs/lows pool" },
  { name: "RETEST_M", def: "24", note: "bars after a BOS within which a return to the broken price counts as a retest" },
  { name: "DO_BP", def: "30", note: "distance from day open (bp) that arms the day-open reversion event" },
  { name: "CRYPTO_RT_BP", def: "7", note: "crypto taker round-trip, bp" },
  { name: "IDX_RT_BP", def: "4", note: "index/gold CFD round-trip, bp" },
  { name: "FX_RT_BP", def: "2", note: "FX major round-trip, bp" },
  { name: "VOL_N", def: "24", note: "trailing window for volume state" },
  { name: "SPLIT", def: "2023-01-01", note: "train/test boundary — frozen, D-455" },
  { name: "DUMP", def: "", note: "if set, write per-event nets for mtf-sizer.ts to this JSON path" },
]);
const MIN_EVENTS = Number(K.MIN_EVENTS), PART_HI = Number(K.PART_HI), EQ_TOL = Number(K.EQ_TOL_BP);
const RETEST_M = Number(K.RETEST_M), DO_BP = Number(K.DO_BP), VOL_N = Number(K.VOL_N);
const SPLIT_TS = Math.floor(new Date(K.SPLIT + "T00:00:00Z").getTime() / 1000);
const KSET = [4, 12, 24];

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "msb", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"];
const FX = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"];
interface Inst { symbol: string; klass: "crypto" | "idx" | "fx"; rt: number; bars: Bar[] }

async function loadCrypto(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  return ((row?.bars || []) as number[][]).map(decodeBar).sort((a, b) => a.ts - b.ts);
}
async function loadFxTable(sym: string): Promise<Bar[]> {
  const rows = (await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`)) as
    { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  // drop forward-fill padding (h==l synthetic closed-session bars — no range, no direction; D-764 verified ~17-28%)
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })).sort((a, b) => a.ts - b.ts);
}

// ---- one event = a signed hypothesis trade. net[k] = sign*(log fwd return from NEXT-bar open, K bars) - rt. ----
interface Evt {
  setup: string; symbol: string; klass: string; ts: number; train: boolean;
  dir: 1 | -1;                        // hypothesis direction (+1 long, -1 short)
  net: Record<number, number>;        // signed net log return per K
  mae: Record<number, number>;        // median-able adverse excursion per K (worst against-position move, >=0)
  volHi: boolean; killzone: boolean; htfWith: boolean | null;
}
function kz(ts: number): boolean { const h = new Date(ts * 1000).getUTCHours(); return (h >= 7 && h < 10) || (h >= 13 && h < 16); }
function htfUp(bars: Bar[], i: number): boolean | null { return i < 24 ? null : bars[i].c > bars[i - 24].c; }

function mkEvt(setup: string, inst: Inst, vs: ReturnType<typeof volumeStates>, i: number, dir: 1 | -1): Evt | null {
  const b = inst.bars;
  if (i + 1 + Math.max(...KSET) >= b.length) return null;
  const entry = b[i + 1].o;                                  // lag-1: NEXT bar's open (D-498)
  if (!(entry > 0)) return null;
  const net: Record<number, number> = {}, mae: Record<number, number> = {};
  const rt = inst.rt / 1e4;
  for (const k of KSET) {
    const exit = b[i + 1 + k].c;                             // exit at close of bar i+1+k (held k bars from entry bar)
    net[k] = dir * Math.log(exit / entry) - rt;
    let worst = 0;
    for (let j = i + 1; j <= i + 1 + k; j++) {
      const adverse = dir === 1 ? Math.log(b[j].l / entry) : -Math.log(b[j].h / entry);
      worst = Math.min(worst, adverse);
    }
    mae[k] = -worst;                                          // positive bp of pain
  }
  const trend = htfUp(b, i);
  return {
    setup, symbol: inst.symbol, klass: inst.klass, ts: b[i].ts, train: b[i].ts < SPLIT_TS, dir, net, mae,
    volHi: (vs[i]?.partRatio ?? NaN) >= PART_HI, killzone: kz(b[i].ts),
    htfWith: trend === null ? null : (trend === (dir === 1)),
  };
}

// ---- setup detectors -------------------------------------------------------------------------------------------
function detectAll(inst: Inst): Evt[] {
  const b = inst.bars, out: Evt[] = [];
  const vs = volumeStates(b, VOL_N);

  // 1. bos-cont: continuation in the break direction
  for (const bos of breaksOfStructure(b, 2)) {
    const e = mkEvt("bos-cont", inst, vs, bos.index, bos.dir === "up" ? 1 : -1);
    if (e) out.push(e);
  }

  // 2. eqhl-break: pool = 2 consecutive same-kind swings within EQ_TOL bp; event = first CLOSE beyond the pool.
  const sw = swings(b, 2);
  for (const kind of ["high", "low"] as const) {
    const ss = sw.filter((s) => s.kind === kind);
    for (let a = 1; a < ss.length; a++) {
      const p1 = ss[a - 1].price, p2 = ss[a].price;
      const mid = (p1 + p2) / 2;
      if (Math.abs(p1 - p2) / mid * 1e4 > EQ_TOL) continue;
      const lvl = kind === "high" ? Math.max(p1, p2) : Math.min(p1, p2);
      const from = ss[a].confirmedAt;
      for (let j = from; j < Math.min(b.length, from + 24 * 14); j++) {   // pool lives max 2 weeks
        if (kind === "high" ? b[j].c > lvl : b[j].c < lvl) {
          const e = mkEvt("eqhl-break", inst, vs, j, kind === "high" ? 1 : -1);
          if (e) out.push(e);
          break;                                                            // one break per pool
        }
        if (kind === "high" ? b[j].c < mid * (1 - 30 / 1e4) : b[j].c > mid * (1 + 30 / 1e4)) break; // walked away
      }
    }
  }

  // 3. retest-hold: after a BOS at swingPrice, first bar within RETEST_M whose range touches the broken price ->
  //    HOLD hypothesis (long after up-BOS retest, short after down-BOS retest).
  for (const bos of breaksOfStructure(b, 2)) {
    for (let j = bos.index + 1; j < Math.min(b.length, bos.index + 1 + RETEST_M); j++) {
      const touched = bos.dir === "up" ? b[j].l <= bos.swingPrice : b[j].h >= bos.swingPrice;
      if (!touched) continue;
      const e = mkEvt("retest-hold", inst, vs, j, bos.dir === "up" ? 1 : -1);
      if (e) out.push(e);
      break;
    }
  }

  // 4. dayopen-rev: close >= DO_BP beyond TODAY's open -> trade TOWARD the open. Day open = open of the first bar
  //    of the UTC day (known at that bar; no look-ahead). Debounced: one event per day per side.
  {
    let dayKey = "", dayOpen = 0, firedUp = false, firedDn = false;
    for (let i = 0; i < b.length; i++) {
      const dk = utcDayKey(b[i].ts);
      if (dk !== dayKey) { dayKey = dk; dayOpen = b[i].o; firedUp = false; firedDn = false; }
      if (!(dayOpen > 0)) continue;
      const distBp = Math.log(b[i].c / dayOpen) * 1e4;
      if (distBp >= DO_BP && !firedUp) { firedUp = true; const e = mkEvt("dayopen-rev", inst, vs, i, -1); if (e) out.push(e); }
      if (distBp <= -DO_BP && !firedDn) { firedDn = true; const e = mkEvt("dayopen-rev", inst, vs, i, 1); if (e) out.push(e); }
    }
  }

  // 5. sess-drive: at the 3rd bar of a London/NY session, hypothesis = the drive direction persists.
  {
    let sess = ""; let startIdx = -1;
    for (let i = 0; i < b.length; i++) {
      const s = sessionOf(b[i].ts);
      const key = `${utcDayKey(b[i].ts)}|${s}`;
      if (key !== sess) { sess = key; startIdx = i; }
      if ((s === "london" || s === "ny") && i === startIdx + 2) {
        const drive = b[i].c - b[startIdx].o;
        if (drive === 0) continue;
        const e = mkEvt("sess-drive", inst, vs, i, drive > 0 ? 1 : -1);
        if (e) out.push(e);
      }
    }
  }
  return out;
}

// ---- stats ------------------------------------------------------------------------------------------------------
function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, med: 0, t: 0, win: 0, sd: 0, p10: 0 };
  const mean = xs.reduce((a, c) => a + c, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, c) => a + (c - mean) ** 2, 0) / (n - 1)) : 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    n, mean, med: sorted[Math.floor(n / 2)], t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0,
    win: xs.filter((x) => x > 0).length / n, sd, p10: sorted[Math.floor(n * 0.1)],
  };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

// ---- load + detect ----------------------------------------------------------------------------------------------
const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rt: Number(K.CRYPTO_RT_BP), bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", rt: Number(K.IDX_RT_BP), bars: await loadFxTable(s) });
for (const s of FX) insts.push({ symbol: s, klass: "fx", rt: Number(K.FX_RT_BP), bars: await loadFxTable(s) });
for (const inst of insts) assertNonEmpty(`bars ${inst.symbol}`, inst.bars, 5000);

const allEvts: Evt[] = [];
for (const inst of insts) allEvts.push(...detectAll(inst));

const SETUPS = ["bos-cont", "eqhl-break", "retest-hold", "dayopen-rev", "sess-drive"];
type Cell = "base" | "volHi" | "killzone" | "htfWith" | "htfAgainst";
const CELLS: Cell[] = ["base", "volHi", "killzone", "htfWith", "htfAgainst"];
function inCell(e: Evt, c: Cell): boolean {
  switch (c) {
    case "base": return true;
    case "volHi": return e.volHi;
    case "killzone": return e.killzone;
    case "htfWith": return e.htfWith === true;
    case "htfAgainst": return e.htfWith === false;
  }
}

// ---- POSITIVE CONTROLS (D-641) ----
{
  const btc = insts[0];
  const bench: number[] = [];
  for (let i = 30; i < btc.bars.length - 13; i += Math.max(1, Math.floor(btc.bars.length / 2000))) {
    bench.push(Math.log(btc.bars[i + 12].c / btc.bars[i + 1].c));
  }
  const bs = stats(bench);
  console.log(`==> MTF SETUP BATTERY — 5 setups x 5 cells x K{4,12,24}, 12 instruments, lag-1, net of cost, signed in hypothesis dir`);
  console.log(`  POSITIVE CONTROL — unconditional BTC 12h fwd: mean ${bp(bs.mean)}bp t ${bs.t.toFixed(2)} n ${bs.n} (~0 expected)`);
  for (const s of SETUPS) {
    const n = allEvts.filter((e) => e.setup === s).length;
    console.log(`  POSITIVE CONTROL — ${s.padEnd(12)} events across panel: ${n} (must be non-zero)`);
    if (n === 0) { console.error(`!! positive control FAILED: ${s} produced 0 events — detector broken.`); Deno.exit(1); }
  }
  console.log("");
}

// ---- TABLE 1: full pooled grid, train vs test — every row a trial ----
let TRIALS = 0;
console.log("  === TABLE 1 — POOLED NET (bp, signed in hypothesis dir), TRAIN vs TEST — the FULL grid ===");
console.log("    setup        cell        K    train: n / mean / t         test:  n / mean / t");
for (const s of SETUPS) {
  for (const c of CELLS) {
    for (const k of KSET) {
      TRIALS += 2;
      const evs = allEvts.filter((e) => e.setup === s && inCell(e, c));
      const tr = stats(evs.filter((e) => e.train).map((e) => e.net[k]));
      const te = stats(evs.filter((e) => !e.train).map((e) => e.net[k]));
      const flag = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 ? "  <= +OOS" : (te.n >= MIN_EVENTS && te.mean < 0 && te.t <= -2 ? "  <= -OOS (opposite)" : "");
      console.log(`    ${s.padEnd(12)} ${c.padEnd(10)} ${String(k).padStart(2)}  ${String(tr.n).padStart(7)} / ${bp(tr.mean).padStart(7)} / ${tr.t.toFixed(2).padStart(6)}     ${String(te.n).padStart(7)} / ${bp(te.mean).padStart(7)} / ${te.t.toFixed(2).padStart(6)}${flag}`);
    }
  }
}

// ---- cross-instrument sign map on TEST, base cell (the anti-overfit filter) ----
console.log("\n  === TABLE 2 — CROSS-INSTRUMENT SIGN (TEST, base cell): count of instruments with n>=20 whose mean net is positive ===");
console.log("    setup        " + KSET.map((k) => `K${k}: +/tested`).join("    "));
const signMap = new Map<string, Record<number, { pos: number; tested: number }>>();
for (const s of SETUPS) {
  const rec: Record<number, { pos: number; tested: number }> = {};
  for (const k of KSET) {
    let pos = 0, tested = 0;
    for (const inst of insts) {
      const xs = allEvts.filter((e) => e.setup === s && e.symbol === inst.symbol && !e.train).map((e) => e.net[k]);
      if (xs.length < 20) continue;
      tested++;
      if (stats(xs).mean > 0) pos++;
    }
    rec[k] = { pos, tested };
  }
  signMap.set(s, rec);
  console.log(`    ${s.padEnd(12)} ` + KSET.map((k) => `${String(rec[k].pos).padStart(4)}/${rec[k].tested}`.padStart(9)).join("      "));
}

// ---- TABLE 3: risk profile per (setup, K) on TEST base — for the sizing layer ----
console.log("\n  === TABLE 3 — RISK PROFILE (TEST, base): per-event sd / median MAE / worst-decile net, bp ===");
console.log("    setup        K     sd_bp   medMAE_bp   p10_net_bp");
for (const s of SETUPS) {
  for (const k of KSET) {
    const evs = allEvts.filter((e) => e.setup === s && !e.train);
    const st = stats(evs.map((e) => e.net[k]));
    const maes = evs.map((e) => e.mae[k]).sort((a, b) => a - b);
    const medMae = maes.length ? maes[Math.floor(maes.length / 2)] : 0;
    console.log(`    ${s.padEnd(12)} ${String(k).padStart(2)}   ${bp(st.sd).padStart(7)}   ${bp(medMae).padStart(8)}   ${bp(st.p10).padStart(9)}`);
  }
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-setup-battery", runId: `msb|${K.SPLIT}|${KSET.join(",")}`, spent: TRIALS });

// ---- VERDICT ----
console.log(`\n  ================================ VERDICT ================================`);
let survivors = 0;
for (const s of SETUPS) for (const c of CELLS) for (const k of KSET) {
  const evs = allEvts.filter((e) => e.setup === s && inCell(e, c) && !e.train);
  const st = stats(evs.map((e) => e.net[k]));
  const rec = signMap.get(s)![k];
  if (st.n >= MIN_EVENTS && st.mean > 0 && st.t >= 2 && rec.pos >= Math.ceil(rec.tested * 0.5) && rec.tested >= 6) {
    survivors++;
    console.log(`  SURVIVOR: ${s} / ${c} / K${k} — OOS n ${st.n}, ${bp(st.mean)}bp, t ${st.t.toFixed(2)}, sign ${rec.pos}/${rec.tested} (base-cell sign map)`);
  }
}
if (survivors === 0) console.log(`  NO cell clears cost OOS with cross-instrument sign agreement. With ${TRIALS} trials on this grid, a lone
  significant cell would in any case be a trial artifact — the bar is the JOINT condition, and nothing met it.`);
console.log(`  TOTAL TRIALS this grid: ${TRIALS} | program trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`  All means are NET of pessimistic RT cost and SIGNED in the hypothesis direction; a strongly negative`);
console.log(`  mean is the market doing the OPPOSITE (the recurring D-763 reversion sign), which is a finding, not a strategy.`);

// ---- DUMP for mtf-sizer.ts ----
if (K.DUMP) {
  const cells = SETUPS.flatMap((s) => CELLS.map((c) => ({
    cell: `${s}/${c}`, rt_bp_by_class: { crypto: Number(K.CRYPTO_RT_BP), idx: Number(K.IDX_RT_BP), fx: Number(K.FX_RT_BP) },
    K: KSET, frozen: null,
    events: allEvts.filter((e) => e.setup === s && inCell(e, c)).map((e) => ({ symbol: e.symbol, klass: e.klass, ts: e.ts, train: e.train, net: e.net })),
  })));
  await Deno.writeTextFile(K.DUMP, JSON.stringify({ source: "mtf-setup-battery.ts", written: new Date().toISOString(), split: K.SPLIT, cells }));
  console.log(`  DUMP -> ${K.DUMP}`);
}
