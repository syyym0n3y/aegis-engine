#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// mtf-volume-conditions.ts (D-767) — the operator's "volume conditions" deep dive. The reversion signs found by
// D-763 (session-low sweep fade) sit at/around the cost line pooled. Question: does a specific VOLUME condition
// lift the fade CLEARLY above cost OOS across instruments — or is volume-conditioning marginal?
//
// ALL "directional volume" here is the CLV x volume PROXY (close location in the bar's range times size). It is
// NOT a true taker buy/sell split — none is held intraday. Stated once here, binding every number below.
//
// Volume conditions tested, each on the PSL-sweep fade (close below prior-session low -> long next open) AND
// standalone (condition alone -> trade the implied direction):
//   rvol-hi      bar volume / median volume FOR THAT HOUR-OF-DAY >= RVOL_HI (controls intraday seasonality)
//   climax       bar volume in the trailing-N top 5% -> exhaustion hypothesis
//   dryup-break  volume into the sweep bar below trailing median (thin break -> fails more, the D-763 volLo hint)
//   dv-persist   3 consecutive same-sign CLV x vol bars before the event (standalone: trade WITH the persistence)
//   absorption   high volume + bottom-quartile range (standalone: fade the last bar's direction — absorption)
// Grid: condition x {fade, standalone} x K{4,12,24}, pooled train/test + cross-instrument sign, every cell a trial.
// LAWS: SELECTION (full grid), BREADTH (floor 50), EXECUTION lag-1 (D-498), POSITIVE-CONTROL (hour-of-day volume
// seasonality must actually EXIST or rvol is broken), PRECONDITION (declareKnobs + mkStrictRead). DESCRIPTIVE ONLY.
import { Bar, clv, decodeBar, priorSessionLevels, volumeStates } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-volume-conditions", [
  { name: "MIN_EVENTS", def: "50", note: "breadth floor (BREADTH LAW)" },
  { name: "RVOL_HI", def: "1.5", note: "hour-of-day relative volume threshold" },
  { name: "CLIMAX_N", def: "200", note: "trailing window for the climax (top-5%) test" },
  { name: "PERSIST", def: "3", note: "consecutive same-sign CLVxvol bars for dv-persist" },
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "IDX_RT_BP", def: "4" }, { name: "FX_RT_BP", def: "2" },
  { name: "VOL_N", def: "24", note: "trailing window for volume state" },
  { name: "SPLIT", def: "2023-01-01", note: "train/test boundary — frozen, D-455" },
  { name: "DUMP", def: "", note: "if set, write per-event nets for mtf-sizer.ts to this JSON path" },
]);
const MIN_EVENTS = Number(K.MIN_EVENTS), RVOL_HI = Number(K.RVOL_HI), CLIMAX_N = Number(K.CLIMAX_N);
const PERSIST = Number(K.PERSIST), VOL_N = Number(K.VOL_N);
const SPLIT_TS = Math.floor(new Date(K.SPLIT + "T00:00:00Z").getTime() / 1000);
const KSET = [4, 12, 24];

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mvc", exp: 4102444800 });
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
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })).sort((a, b) => a.ts - b.ts);
}

// hour-of-day relative volume: v[i] / trailing median of volume at the SAME UTC hour (last 30 same-hour bars,
// strictly past). NaN until 10 same-hour observations exist.
function hourRelVol(bars: Bar[]): number[] {
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  const out = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const h = new Date(bars[i].ts * 1000).getUTCHours();
    const win = byHour[h];
    if (win.length >= 10) {
      const s = [...win.slice(-30)].sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)];
      if (med > 0) out[i] = bars[i].v / med;
    }
    win.push(bars[i].v);
  }
  return out;
}

interface Evt {
  cond: string; mode: "fade" | "alone"; symbol: string; klass: string; ts: number; train: boolean;
  net: Record<number, number>;
}
function mkNet(inst: Inst, i: number, dir: 1 | -1): Record<number, number> | null {
  const b = inst.bars;
  if (i + 1 + Math.max(...KSET) >= b.length) return null;
  const entry = b[i + 1].o;
  if (!(entry > 0)) return null;
  const rt = inst.rt / 1e4, net: Record<number, number> = {};
  for (const k of KSET) net[k] = dir * Math.log(b[i + 1 + k].c / entry) - rt;
  return net;
}

const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rt: Number(K.CRYPTO_RT_BP), bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", rt: Number(K.IDX_RT_BP), bars: await loadFxTable(s) });
for (const s of FX) insts.push({ symbol: s, klass: "fx", rt: Number(K.FX_RT_BP), bars: await loadFxTable(s) });
for (const inst of insts) assertNonEmpty(`bars ${inst.symbol}`, inst.bars, 5000);

// ---- POSITIVE CONTROL 1: hour-of-day volume seasonality must EXIST (else rvol measures nothing) ----
{
  const btc = insts[0];
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  for (const b of btc.bars) byHour[new Date(b.ts * 1000).getUTCHours()].push(b.v);
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const meds = byHour.map(med);
  const hi = Math.max(...meds), lo = Math.min(...meds);
  console.log(`==> MTF VOLUME CONDITIONS — 5 conditions x {fade, standalone} x K{4,12,24}, 12 instruments`);
  console.log(`  ALL directional volume below is the CLVxvolume PROXY, not a taker buy/sell split (none held).`);
  console.log(`  POSITIVE CONTROL — BTC hour-of-day median volume: max/min ratio ${(hi / lo).toFixed(2)} (must be >1.3 or rvol is measuring nothing)`);
  if (hi / lo < 1.3) { console.error("!! positive control FAILED: no hour-of-day volume seasonality — rvol condition is broken."); Deno.exit(1); }
}

// ---- detect events per instrument ----
const allEvts: Evt[] = [];
for (const inst of insts) {
  const b = inst.bars;
  const vs = volumeStates(b, VOL_N);
  const rvol = hourRelVol(b);
  const psl = priorSessionLevels(b);
  const dv = b.map((x) => clv(x) * x.v);

  // trailing top-5% climax + bottom-quartile range thresholds, computed on strictly-past windows
  const rng = b.map((x) => (x.h - x.l) / (x.c || 1));
  for (let i = CLIMAX_N; i < b.length; i++) {
    const ts = b[i].ts, train = ts < SPLIT_TS;
    const lvl = psl[i];
    const isSweep = lvl !== null && i > lvl.fromLastIndex && b[i].c < lvl.low;   // D-763 downside sweep, fade = long

    // trailing distributions (past CLIMAX_N bars)
    let volRank = 0, rngRank = 0;
    for (let j = i - CLIMAX_N; j < i; j++) { if (b[j].v < b[i].v) volRank++; if (rng[j] < rng[i]) rngRank++; }
    const volPct = volRank / CLIMAX_N, rngPct = rngRank / CLIMAX_N;

    const conds: { cond: string; on: boolean; aloneDir: 1 | -1 | 0 }[] = [
      { cond: "rvol-hi", on: rvol[i] >= RVOL_HI, aloneDir: 0 },
      { cond: "climax", on: volPct >= 0.95, aloneDir: (clv(b[i]) > 0 ? -1 : 1) },            // exhaustion: fade the climax bar
      { cond: "dryup-break", on: (vs[i]?.partRatio ?? NaN) < 1 && isSweep, aloneDir: 0 },    // only meaningful at a break
      (() => {
        const win = Array.from({ length: PERSIST }, (_, m) => dv[i - m]);
        const persist = i >= PERSIST && (win.every((x) => x > 0) || win.every((x) => x < 0));
        return { cond: "dv-persist", on: persist, aloneDir: (dv[i] > 0 ? 1 : -1) as 1 | -1 }; // trade WITH persistence
      })(),
      { cond: "absorption", on: volPct >= 0.75 && rngPct <= 0.25, aloneDir: (clv(b[i]) > 0 ? -1 : 1) }, // fade absorbed push
    ];
    for (const c of conds) {
      if (!c.on) continue;
      if (isSweep) { const net = mkNet(inst, i, 1); if (net) allEvts.push({ cond: c.cond, mode: "fade", symbol: inst.symbol, klass: inst.klass, ts, train, net }); }
      if (c.aloneDir !== 0) { const net = mkNet(inst, i, c.aloneDir); if (net) allEvts.push({ cond: c.cond, mode: "alone", symbol: inst.symbol, klass: inst.klass, ts, train, net }); }
    }
    // the UNCONDITIONED fade baseline, for comparison inside the same script
    if (isSweep) { const net = mkNet(inst, i, 1); if (net) allEvts.push({ cond: "none", mode: "fade", symbol: inst.symbol, klass: inst.klass, ts, train, net }); }
  }
}

// ---- POSITIVE CONTROL 2: event counts ----
const CONDS = ["none", "rvol-hi", "climax", "dryup-break", "dv-persist", "absorption"];
for (const c of CONDS) {
  const n = allEvts.filter((e) => e.cond === c).length;
  console.log(`  POSITIVE CONTROL — ${c.padEnd(12)} events: ${n}`);
  if (n === 0 && c !== "dryup-break") { console.error(`!! ${c} produced 0 events — detector broken.`); Deno.exit(1); }
}
console.log("");

function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, t: 0, win: 0, sd: 0 };
  const mean = xs.reduce((a, c) => a + c, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, c) => a + (c - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0, win: xs.filter((x) => x > 0).length / n, sd };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

let TRIALS = 0;
console.log("  === TABLE 1 — POOLED NET (bp), TRAIN vs TEST — full grid (fade rows = PSL-sweep fade under that condition) ===");
console.log("    cond         mode   K    train: n / mean / t         test:  n / mean / t");
for (const c of CONDS) {
  for (const mode of ["fade", "alone"] as const) {
    if (c === "none" && mode === "alone") continue;
    if (c === "rvol-hi" && mode === "alone") continue;
    if (c === "dryup-break" && mode === "alone") continue;
    for (const k of KSET) {
      TRIALS += 2;
      const evs = allEvts.filter((e) => e.cond === c && e.mode === mode);
      const tr = stats(evs.filter((e) => e.train).map((e) => e.net[k]));
      const te = stats(evs.filter((e) => !e.train).map((e) => e.net[k]));
      const flag = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 ? "  <= +OOS" : (te.n >= MIN_EVENTS && te.mean < 0 && te.t <= -2 ? "  <= -OOS (opposite)" : "");
      console.log(`    ${c.padEnd(12)} ${mode.padEnd(5)} ${String(k).padStart(2)}  ${String(tr.n).padStart(7)} / ${bp(tr.mean).padStart(7)} / ${tr.t.toFixed(2).padStart(6)}     ${String(te.n).padStart(7)} / ${bp(te.mean).padStart(7)} / ${te.t.toFixed(2).padStart(6)}${flag}`);
    }
  }
}

console.log("\n  === TABLE 2 — CROSS-INSTRUMENT SIGN (TEST): instruments with n>=20 positive / tested ===");
console.log("    cond         mode   " + KSET.map((k) => `K${k}`).join("        "));
const signMap = new Map<string, Record<number, { pos: number; tested: number }>>();
for (const c of CONDS) {
  for (const mode of ["fade", "alone"] as const) {
    const key = `${c}/${mode}`;
    const rec: Record<number, { pos: number; tested: number }> = {};
    let any = false;
    for (const k of KSET) {
      let pos = 0, tested = 0;
      for (const inst of insts) {
        const xs = allEvts.filter((e) => e.cond === c && e.mode === mode && e.symbol === inst.symbol && !e.train).map((e) => e.net[k]);
        if (xs.length < 20) continue;
        tested++; any = true;
        if (stats(xs).mean > 0) pos++;
      }
      rec[k] = { pos, tested };
    }
    if (!any) continue;
    signMap.set(key, rec);
    console.log(`    ${c.padEnd(12)} ${mode.padEnd(5)} ` + KSET.map((k) => `${String(rec[k].pos).padStart(3)}/${rec[k].tested}`.padStart(7)).join("    "));
  }
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-volume-conditions", runId: `mvc|${K.SPLIT}`, spent: TRIALS });

console.log(`\n  ================================ VERDICT ================================`);
let lifted = 0;
const baseTest: Record<number, ReturnType<typeof stats>> = {};
for (const k of KSET) baseTest[k] = stats(allEvts.filter((e) => e.cond === "none" && !e.train).map((e) => e.net[k]));
for (const [key, rec] of signMap) {
  const [c, mode] = key.split("/");
  if (c === "none") continue;
  for (const k of KSET) {
    const te = stats(allEvts.filter((e) => e.cond === c && e.mode === mode && !e.train).map((e) => e.net[k]));
    const ok = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 && rec[k].tested >= 6 && rec[k].pos >= Math.ceil(rec[k].tested * 0.5);
    if (ok) {
      lifted++;
      const vsBase = mode === "fade" ? ` (unconditioned fade same-K: ${bp(baseTest[k].mean)}bp t ${baseTest[k].t.toFixed(2)})` : "";
      console.log(`  SURVIVOR: ${key} K${k} — OOS n ${te.n}, ${bp(te.mean)}bp, t ${te.t.toFixed(2)}, sign ${rec[k].pos}/${rec[k].tested}${vsBase}`);
    }
  }
}
if (lifted === 0) {
  console.log(`  NO volume condition lifts the fade (or stands alone) above cost OOS with cross-instrument sign`);
  console.log(`  agreement. Volume conditioning on this panel is MARGINAL — the D-763 conclusion stands.`);
}
console.log(`  Unconditioned fade OOS baseline: ` + KSET.map((k) => `K${k} ${bp(baseTest[k].mean)}bp t ${baseTest[k].t.toFixed(2)} n ${baseTest[k].n}`).join(" | "));
console.log(`  TOTAL TRIALS: ${TRIALS} | program ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);

if (K.DUMP) {
  const cells = [...signMap.keys()].map((key) => {
    const [c, mode] = key.split("/");
    return {
      cell: `vol-${key}`, rt_bp_by_class: { crypto: Number(K.CRYPTO_RT_BP), idx: Number(K.IDX_RT_BP), fx: Number(K.FX_RT_BP) },
      K: KSET, frozen: null,
      events: allEvts.filter((e) => e.cond === c && e.mode === mode).map((e) => ({ symbol: e.symbol, klass: e.klass, ts: e.ts, train: e.train, net: e.net })),
    };
  });
  await Deno.writeTextFile(K.DUMP, JSON.stringify({ source: "mtf-volume-conditions.ts", written: new Date().toISOString(), split: K.SPLIT, cells }));
  console.log(`  DUMP -> ${K.DUMP}`);
}
