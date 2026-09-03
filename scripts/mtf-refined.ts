#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-refined.ts (D-772) — the unified refinement across the 10 factors, on the D-768/771 carrier
// (downside PSL sweep + persist(real) → fade LONG at K24, on the 5-crypto panel with real Binance taker delta).
//
// Refined joint cell built from the honest findings, each with its DECISION reference:
//   D-768 real taker delta + 3-bar |dz|>=1.0 same-sign persistence           (the signal that survived proxy replacement)
//   D-769 #4 EXCLUDE PWL-confluence (pwl-confluent PSL sweeps HURT: t 0.26)
//   D-769 #5 REQUIRE vwapDist < -20bp (entries far below session VWAP: 3.20t)
//   D-770 REQUIRE contango (fundRate >= 0: 5/5 crypto positive)              (funding regime; Q5 lifts further, thin)
//   D-771 DOWNSIDE ONLY (upside mirror LOSES: K4 t -3.02, K12 t -2.74)
//   D-769 #8 FIXED K24 close exit (symmetric ATR stop/target flips sign)      (baseline exit; VWAP-touch tested here)
//   D-769 #6/#9/#10 not conditioned — US-hour/asia-early/sun-early carry no material weight for this cell
//
// FIVE MEASUREMENTS printed:
//   R1  baseline reproduction (D-768 cell)                                    unchanged from D-768: 57.51bp t 2.59 5/5
//   R2  joint refined cell (all four conditioners AND'd)                       the operator's "refine" ask
//   R3  R2 minus each conditioner (one-out ablation) — attribution
//   R4  VWAP-touch exit on R2 (exit at session VWAP touch or K24 close, whichever first)
//   R5  sizing on R2 — Kelly and vol-target leverage; ruin/drawdown at those leverages
//
// SELECTION LAW: R2 was defined ex post from the ten-factor sweep — treat it as DESCRIPTIVE. Every trial the ten-factor
// pass added is already counted. No new forward clocks (piling one on the same event is inflation, D-769 doctrine).
import { Bar, priorPeriodLevels, priorSessionLevels, utcWeekKey } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-refined", [
  { name: "MIN_EVENTS", def: "50" }, { name: "CLIMAX_N", def: "200" }, { name: "PERSIST", def: "3" },
  { name: "DELTA_Z_HI", def: "1.0" }, { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "VWAP_BP", def: "-20", note: "require entry >= VWAP + VWAP_BP bp (so -20 = entry at least 20bp below VWAP)" },
]);
const KK = 24, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const CLIMAX_N = Number(K.CLIMAX_N), DZ_HI = Number(K.DELTA_Z_HI);
const MIN_EVENTS = Number(K.MIN_EVENTS), VWAP_BP = Number(K.VWAP_BP);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mrf", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
interface RichBar extends Bar { taker: number; delta: number; deltaZ: number }
async function loadCrypto(sym: string): Promise<RichBar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = (row?.bars || []);
  const arr = raw.filter((b) => Array.isArray(b) && b.length >= 8 && b[5] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], taker: b[7], delta: b[7] - 0.5 * b[5], deltaZ: 0 } as RichBar))
    .sort((a, b) => a.ts - b.ts);
  for (let i = CLIMAX_N; i < arr.length; i++) {
    let m = 0; for (let j = i - CLIMAX_N; j < i; j++) m += arr[j].delta; m /= CLIMAX_N;
    let s2 = 0; for (let j = i - CLIMAX_N; j < i; j++) s2 += (arr[j].delta - m) ** 2;
    const sd = Math.sqrt(s2 / (CLIMAX_N - 1));
    arr[i].deltaZ = sd > 0 ? (arr[i].delta - m) / sd : 0;
  }
  return arr;
}
async function loadFunding(sym: string): Promise<{ ts: number; rate: number }[]> {
  const rows = await q(`trd_perp_oi?symbol=eq.${sym}&venue=eq.binance&interval=eq.funding&select=ts,open_interest&order=ts.asc`) as { ts: number; open_interest: number }[];
  return rows.map((r) => ({ ts: r.ts, rate: r.open_interest }));
}
function sessionVWAP(bars: Bar[]): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  let sk = "", cpv = 0, cv = 0;
  for (let i = 0; i < bars.length; i++) {
    const h = new Date(bars[i].ts * 1000).getUTCHours();
    const day = new Date(bars[i].ts * 1000).toISOString().slice(0, 10);
    const s = h < 8 ? "asia" : h < 16 ? "london" : "ny";
    const key = `${day}|${s}`;
    if (key !== sk) { sk = key; cpv = 0; cv = 0; }
    cpv += bars[i].c * bars[i].v; cv += bars[i].v;
    out[i] = cv > 0 ? cpv / cv : NaN;
  }
  return out;
}

const CBARS = new Map<string, RichBar[]>();
const FUND = new Map<string, { ts: number; rate: number }[]>();
for (const s of CRYPTO) { CBARS.set(s, await loadCrypto(s)); FUND.set(s, await loadFunding(s)); }
for (const s of CRYPTO) { assertNonEmpty(`bars ${s}`, CBARS.get(s)!, 5000); assertNonEmpty(`funding ${s}`, FUND.get(s)!, 500); }
function fundRateAsof(sym: string, evTs: number): number | null {
  const arr = FUND.get(sym)!; let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].ts <= evTs) { best = m; lo = m + 1; } else hi = m - 1; }
  return best < 0 ? null : arr[best].rate;
}

interface Evt {
  symbol: string; ts: number; train: boolean; entryPx: number; sesVwap: number;
  netK24: number; netVwapTouch: number;
  hasFund: boolean; fundRate: number; noPwl: boolean; vwapFar: boolean;
}
const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const [sym, bars] of CBARS) {
  const psl = priorSessionLevels(bars);
  const pwl = priorPeriodLevels(bars, utcWeekKey);
  const vwap = sessionVWAP(bars);
  for (let i = CLIMAX_N; i < bars.length - KK - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(bars[i].c < lvl.low)) continue;                                      // D-771: downside only
    const win = [bars[i - 2].deltaZ, bars[i - 1].deltaZ, bars[i].deltaZ];
    const persist = win.every((z) => z >= DZ_HI) || win.every((z) => z <= -DZ_HI);
    if (!persist) continue;                                                    // D-768: persist(real)
    const entry = bars[i + 1].o; if (!(entry > 0)) continue;
    const sesV = vwap[i]; if (!(sesV > 0)) continue;

    // exits
    const netK24 = Math.log(bars[i + 1 + KK].c / entry) - rt;
    // VWAP-touch exit: exit LONG when bar's high touches session VWAP (whichever session it is at that time), or at
    // K24 close. Session VWAP recomputed per bar (already time-varying).
    let exitPx = bars[i + 1 + KK].c, hitVwap = false;
    for (let j = i + 1; j <= i + KK && j < bars.length; j++) {
      if (bars[j].h >= vwap[j]) { exitPx = vwap[j]; hitVwap = true; break; }
    }
    const netVwapTouch = Math.log(exitPx / entry) - rt;

    const pw = pwl[i]; const noPwl = !(pw !== null && bars[i].c < pw.low);      // D-769 #4
    const vwapFar = (entry - sesV) / sesV * 1e4 < VWAP_BP;                      // D-769 #5 (entry ~20bp below vwap)
    const fRate = fundRateAsof(sym, bars[i].ts);
    events.push({
      symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, entryPx: entry, sesVwap: sesV,
      netK24, netVwapTouch,
      hasFund: fRate !== null, fundRate: fRate ?? 0,
      noPwl, vwapFar,
    });
  }
}

console.log(`==> MTF REFINED — the unified refinement across the 10 factors, on the D-768/771 carrier`);
console.log(`  events: ${events.length}  (D-768 cell size 835; funding restricts a subset to 2021+)`);

function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0, sd: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, sd };
}
function signMap(evs: Evt[], metric: (e: Evt) => number): { pos: number; tested: number } {
  let pos = 0, tested = 0;
  for (const s of CRYPTO) {
    const xs = evs.filter((e) => e.symbol === s).map(metric);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  return { pos, tested };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

// ---- R1: baseline reproduction ----
{
  const te = events.filter((e) => !e.train);
  const s = stats(te.map((e) => e.netK24));
  const sm = signMap(te, (e) => e.netK24);
  console.log(`\n  R1 BASELINE (D-768 cell reproduction)  OOS n ${s.n} / ${bp(s.mean)}bp / t ${s.t.toFixed(2)}   sign ${sm.pos}/${sm.tested}`);
}

// ---- R2: joint refined cell ----
const R2 = (e: Evt) => e.noPwl && e.vwapFar && e.hasFund && e.fundRate >= 0;
{
  const te = events.filter((e) => !e.train && R2(e));
  const s = stats(te.map((e) => e.netK24));
  const sm = signMap(te, (e) => e.netK24);
  console.log(`  R2 JOINT REFINED (no-pwl AND vwapFar AND contango) OOS n ${s.n} / ${bp(s.mean)}bp / t ${s.t.toFixed(2)}   sign ${sm.pos}/${sm.tested}`);
}

// ---- R3: one-out ablation on R2 ----
console.log(`\n  R3 ONE-OUT ABLATION (drop each conditioner from R2 and remeasure OOS) — shows attribution`);
console.log(`     dropped                       n / mean / t     sign`);
for (const drop of ["none", "no-pwl", "vwapFar", "contango"] as const) {
  const R2ab = (e: Evt) =>
    (drop === "no-pwl" || e.noPwl) &&
    (drop === "vwapFar" || e.vwapFar) &&
    (drop === "contango" || (e.hasFund && e.fundRate >= 0));
  const te = events.filter((e) => !e.train && R2ab(e));
  const s = stats(te.map((e) => e.netK24));
  const sm = signMap(te, (e) => e.netK24);
  console.log(`     -${drop.padEnd(28)} ${String(s.n).padStart(5)} / ${bp(s.mean).padStart(7)} / ${s.t.toFixed(2).padStart(6)}     ${sm.pos}/${sm.tested}`);
}

// ---- R4: VWAP-touch exit on R2 ----
{
  const te = events.filter((e) => !e.train && R2(e));
  const s = stats(te.map((e) => e.netVwapTouch));
  const sm = signMap(te, (e) => e.netVwapTouch);
  const teBase = stats(te.map((e) => e.netK24));
  console.log(`\n  R4 VWAP-TOUCH EXIT on R2 cell  OOS n ${s.n} / ${bp(s.mean)}bp / t ${s.t.toFixed(2)}   sign ${sm.pos}/${sm.tested}`);
  console.log(`     comparison, K24-close exit on same events:      ${bp(teBase.mean)}bp / t ${teBase.t.toFixed(2)}`);
}

// ---- R5: sizing (Kelly, vol-target); ruin/drawdown at each ----
{
  const te = events.filter((e) => !e.train && R2(e));
  const xs = te.map((e) => e.netK24);
  const s = stats(xs);
  if (s.n < 30 || s.sd <= 0) {
    console.log(`\n  R5 SIZING — too few events (${s.n}) or degenerate sd; skip.`);
  } else {
    const kellyFrac = s.mean / (s.sd * s.sd);                                  // Kelly = mean/var for log-returns
    // vol-target: choose leverage L such that per-event stdev * L ≈ target-per-event
    // events per year ≈ n_test / (2.75 yr window from 2023-01 to ~2026-09), so per-event vol scales
    const yrs = ((events[events.length - 1].ts - SPLIT_TS) / 86400 / 365);
    const nPerYr = s.n / yrs;
    const annVol = s.sd * Math.sqrt(nPerYr);
    const targetAnnVol = 0.20;                                                 // 20%/yr target
    const volTargetL = targetAnnVol / annVol;
    // simulate compounded equity path at leverage L (rebalance per event); worst DD, terminal
    function simulate(L: number) {
      let eq = 1, peak = 1, ddMax = 0;
      for (const x of xs) {
        eq *= Math.exp(L * x);
        peak = Math.max(peak, eq);
        ddMax = Math.max(ddMax, 1 - eq / peak);
        if (eq <= 1e-6) { return { final: 0, ddMax: 1 }; }                     // ruin
      }
      return { final: eq, ddMax };
    }
    // bootstrap ruin probability at leverage L (5000 resamples with replacement)
    function ruinProb(L: number, target = 0.5): number {
      const trials = 5000; let ruined = 0;
      for (let t = 0; t < trials; t++) {
        let eq = 1, peak = 1;
        for (let i = 0; i < xs.length; i++) {
          const x = xs[Math.floor(Math.random() * xs.length)];
          eq *= Math.exp(L * x);
          peak = Math.max(peak, eq);
          if (1 - eq / peak >= target) { ruined++; break; }
        }
      }
      return ruined / trials;
    }
    console.log(`\n  R5 SIZING on R2 cell — OOS n ${s.n}, per-event mean ${bp(s.mean)}bp sd ${bp(s.sd)}bp; ${nPerYr.toFixed(1)} events/yr; annualised vol ${(annVol * 100).toFixed(1)}%`);
    console.log(`     Kelly fraction (mean/var): ${kellyFrac.toFixed(2)}   (full-Kelly leverage — historically ~3x too aggressive)`);
    console.log(`     Vol-target L for 20%/yr:   ${volTargetL.toFixed(2)}`);
    for (const [tag, L] of [["Kelly/4", kellyFrac / 4], ["Kelly/2", kellyFrac / 2], ["full-Kelly", kellyFrac], ["vol-target 20%", volTargetL]] as const) {
      const sim = simulate(L);
      const r = ruinProb(L, 0.5);
      console.log(`     L=${L.toFixed(2).padStart(6)} (${tag.padEnd(15)}) OOS terminal ${sim.final.toFixed(2)}x  worst DD ${(sim.ddMax * 100).toFixed(0)}%  P(DD>=50%)~${(r * 100).toFixed(1)}%`);
    }
  }
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-refined", runId: `mrf|${K.SPLIT}`, spent: 6 });
console.log(`\n  ================================ VERDICT ================================`);
console.log(`  R2/R3/R4/R5 characterise WHERE the D-768 signal is strongest, its ATTRIBUTION, exit choice, and sizing.`);
console.log(`  DESCRIPTIVE — R2 is ex-post joint over conditioners already tested; the D-768 forward clock is the only`);
console.log(`  registered wager. Ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()}.`);
