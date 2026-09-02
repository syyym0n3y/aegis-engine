#!/usr/bin/env -S deno run --allow-net --allow-env
// options-regime.ts — does INDEX-LEVEL OPTIONS/VOL-REGIME EXTREMITY condition forward equity returns?
//
// Three signals, three trials, no parameter search (the tercile split is fixed a priori at 33/67 and CUT ON TRAIN ONLY):
//   S1  cboe_skew   rolling-z(252d)   — tail-risk pricing extremity
//   S2  cboe_vvix   rolling-z(252d)   — vol-of-vol extremity
//   S3  VIX3M/VIX   term-structure ratio, rolling-z(252d) — <1 raw = backwardation = stress
// Target: SPY forward 21-trading-day LOG return.
//
// DISCIPLINE, stated up front because each of these is a law this repo paid for:
//  * LAG-1 (D-498 SAME-BAR COROLLARY): every one of these is a CLOSE-DERIVED signal. Signal at close t is acted on at
//    close t+1; the forward 21d window runs close[t+1] -> close[t+22]. The signal day is never inside the return.
//  * STATIONARITY (D-730): rolling-z of a trailing 252-obs window, NOT raw levels. SKEW/VVIX levels drift and a
//    level-conditioned result is a statement about the sample's calendar, not about the regime.
//  * BENCHMARK LAW (D-627/630): the top-vs-bottom tercile difference is reported BESIDE the UNCONDITIONAL SPY mean
//    over the same periods, and each bucket's EXCESS against it. A bucket mean alone is drift, not a signal.
//  * SELECTION LAW (D-455): the tercile CUT POINTS are computed on TRAIN ONLY (< 2015-01-01), frozen, applied to test.
//  * OVERLAP: 21d windows on daily data overlap ~21x. The naive Welch t is over-stated by roughly sqrt(21). Both are
//    printed and the CONSERVATIVE (overlap-adjusted) one decides the verdict.
//  * HOLDABILITY LAW (D-565): time-underwater is N/A here and that is stated explicitly — this is a CONDITIONING
//    STUDY of forward returns, not a book. No equity curve is constructed, so no drawdown duration exists to report.
//  * TURNOVER LAW (D-654) / cost: no return is claimed net, because no rebalanced construction exists. The reported
//    quantity is a conditional mean difference, GROSS. Any move to a book would owe a turnover*cost figure.
//  * POSITIVE-CONTROL RULE (D-641): every input series is asserted non-empty before use; a zero here would otherwise
//    be indistinguishable from a null.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("options-regime", [
  { name: "HORIZON_D", def: "21", note: "forward horizon in trading days" },
  { name: "Z_WIN", def: "252", note: "rolling-z lookback in observations" },
  { name: "SPLIT_D", def: "2015-01-01", note: "train/test split; tercile cuts are chosen on TRAIN ONLY" },
]);
const HORIZON_D = Number(Deno.env.get("HORIZON_D") || "21");
const Z_WIN = Number(Deno.env.get("Z_WIN") || "252");
const SPLIT_D = Deno.env.get("SPLIT_D") || "2015-01-01";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "optregime", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// D-757: STRICT read. A transport failure now RETRIES and then THROWS with the path and status, instead of
// returning [] — which was indistinguishable from "the market has nothing here" (D-756: a PostgREST OOM
// restart silently shrank a 15,502-symbol universe to 8,600 and the run finished, printing a wrong number).
const { q } = mkStrictRead(OWNED, hdr);

type Bar = [number, number, number, number, number, number];
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

// ---- inputs ----
const spyRow = (await q(`trd_bars_deep?asset_class=eq.etf&symbol=eq.SPY&select=bars`))[0];
const spyBars: Bar[] = spyRow?.bars || [];
assertNonEmpty("SPY bars", spyBars, 2000);
const spy = new Map<string, number>();
for (const b of spyBars) if (b[4] > 0) spy.set(day(b[0]), b[4]);
const dates = [...spy.keys()].sort();

const vixRow = (await q(`trd_bars_deep?asset_class=eq.index&symbol=eq.%5EVIX&select=bars`))[0];
const vixBars: Bar[] = vixRow?.bars || [];
assertNonEmpty("^VIX bars", vixBars, 2000);
const vix = new Map<string, number>();
for (const b of vixBars) if (b[4] > 0) vix.set(day(b[0]), b[4]);

async function macro(series: string): Promise<Map<string, number>> {
  const rows = (await q(`trd_macro_series?series=eq.${series}&select=d,v&order=d.asc`)) as { d: string; v: number }[];
  assertNonEmpty(`trd_macro_series ${series}`, rows, 500);
  const m = new Map<string, number>();
  for (const r of rows) if (Number.isFinite(r.v) && r.v > 0) m.set(r.d.slice(0, 10), r.v);
  return m;
}
const skew = await macro("cboe_skew");
const vvix = await macro("cboe_vvix");
const vix3m = await macro("cboe_vix3m");

// term structure ratio VIX3M / VIX (raw <1 = backwardation)
const ts = new Map<string, number>();
for (const [d, v3] of vix3m) { const v1 = vix.get(d); if (v1 && v1 > 0) ts.set(d, v3 / v1); }
assertNonEmpty("VIX3M/VIX ratio", [...ts.keys()], 500);

// ---- forward 21d LAG-1 log return, keyed by SIGNAL DAY t ----
// signal at close t -> enter close t+1 -> exit close t+1+HORIZON. Signal day t is OUTSIDE the return window.
const fwd = new Map<string, number>();
for (let i = 0; i + 1 + HORIZON_D < dates.length; i++) {
  const p0 = spy.get(dates[i + 1])!, p1 = spy.get(dates[i + 1 + HORIZON_D])!;
  if (p0 > 0 && p1 > 0) fwd.set(dates[i], Math.log(p1 / p0));
}
assertNonEmpty("SPY forward returns", [...fwd.keys()], 2000);

// ---- rolling z on the SIGNAL'S OWN observation history (trailing Z_WIN incl. current; no future data) ----
function rollingZ(src: Map<string, number>): Map<string, number> {
  const ds = [...src.keys()].sort();
  const out = new Map<string, number>();
  const buf: number[] = [];
  for (const d of ds) {
    buf.push(src.get(d)!);
    if (buf.length > Z_WIN) buf.shift();
    if (buf.length < Z_WIN) continue;
    const m = buf.reduce((a, b) => a + b, 0) / buf.length;
    const sd = Math.sqrt(buf.reduce((a, b) => a + (b - m) ** 2, 0) / (buf.length - 1));
    if (sd > 0) out.set(d, (src.get(d)! - m) / sd);
  }
  return out;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
function welch(a: number[], b: number[]) {
  const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
  return (mean(a) - mean(b)) / Math.sqrt(va + vb);
}
const quantile = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
const ann = (x: number) => `${(x * (252 / HORIZON_D) * 100).toFixed(2)}%/yr`;

interface Res { name: string; note: string; z: Map<string, number> }
const SIGNALS: Res[] = [
  { name: "S1 SKEW z252", note: "high z = expensive tail hedging", z: rollingZ(skew) },
  { name: "S2 VVIX z252", note: "high z = vol-of-vol extremity", z: rollingZ(vvix) },
  { name: "S3 VIX3M/VIX z252", note: "LOW z = backwardation/stress; HIGH z = steep contango", z: rollingZ(ts) },
];

console.log(`==> OPTIONS / VOL-REGIME CONDITIONING STUDY — does index options-regime extremity condition SPY forward ${HORIZON_D}d returns?`);
console.log(`    LAG-1 enforced (D-498): signal close[t] -> entry close[t+1] -> exit close[t+1+${HORIZON_D}]. Signal day excluded from the window.`);
console.log(`    Rolling-z(${Z_WIN}) construction, not raw levels (D-730). Tercile cuts chosen on TRAIN ONLY (< ${SPLIT_D}), frozen, applied to test (D-455).`);
console.log(`    HOLDABILITY: N/A — this is a conditioning study of forward returns, NOT a book. No equity curve, therefore no time-underwater exists to report.`);
console.log(`    COST: no net return is claimed; the reported quantity is a GROSS conditional mean difference (no rebalanced construction -> no turnover figure owed).`);
console.log(`    TRIALS THIS RUN: 3 (one per signal). No parameter search: horizon, z-window and the 33/67 split were fixed before running.\n`);

const verdicts: { name: string; verdict: string; detail: string }[] = [];

for (const s of SIGNALS) {
  // aligned observations: signal day must have a z AND a forward return
  const obs = [...s.z.keys()].filter((d) => fwd.has(d)).sort();
  console.log(`--- ${s.name}  (${s.note})`);
  if (obs.length < 500) {
    console.log(`    UNTESTED — only ${obs.length} aligned signal-days after the ${Z_WIN}-obs z warm-up. Coverage inadequate.\n`);
    verdicts.push({ name: s.name, verdict: "UNTESTED", detail: `only ${obs.length} aligned days` });
    continue;
  }
  const train = obs.filter((d) => d < SPLIT_D), test = obs.filter((d) => d >= SPLIT_D);
  console.log(`    coverage: ${obs.length} signal-days, ${obs[0]} .. ${obs[obs.length - 1]}   (train ${train.length}, test ${test.length})`);
  if (train.length < 250 || test.length < 250) {
    console.log(`    UNTESTED — train or test side under 250 days; the split cannot be honoured.\n`);
    verdicts.push({ name: s.name, verdict: "UNTESTED", detail: `train ${train.length} / test ${test.length}` });
    continue;
  }
  // SELECTION LAW: cuts from TRAIN ONLY
  const trainZ = train.map((d) => s.z.get(d)!);
  const cutLo = quantile(trainZ, 1 / 3), cutHi = quantile(trainZ, 2 / 3);
  console.log(`    tercile cuts (TRAIN ONLY): lo<${cutLo.toFixed(3)}  hi>${cutHi.toFixed(3)}`);

  for (const [label, ds] of [["TRAIN (in-sample)", train], ["TEST  (out-of-sample)", test], ["FULL  (both)", obs]] as [string, string[]][]) {
    const hi: number[] = [], lo: number[] = [], all: number[] = [];
    for (const d of ds) { const z = s.z.get(d)!, r = fwd.get(d)!; all.push(r); if (z > cutHi) hi.push(r); else if (z < cutLo) lo.push(r); }
    if (hi.length < 30 || lo.length < 30) { console.log(`    ${label}: UNTESTED — tercile n too small (hi ${hi.length}, lo ${lo.length})`); continue; }
    const uncond = mean(all);                       // BENCHMARK LAW: the number every bucket must beat
    const tNaive = welch(hi, lo);
    const tAdj = tNaive / Math.sqrt(HORIZON_D);     // conservative overlap adjustment (21d windows overlap ~21x)
    console.log(`    ${label}:  N=${all.length}  UNCONDITIONAL SPY mean ${pct(uncond)} (${ann(uncond)})  <- the benchmark`);
    console.log(`        HIGH-z tercile  n=${hi.length}  mean ${pct(mean(hi))} (${ann(mean(hi))})   EXCESS vs uncond ${pct(mean(hi) - uncond)}   %periods negative ${(100 * hi.filter((x) => x < 0).length / hi.length).toFixed(1)}%`);
    console.log(`        LOW-z  tercile  n=${lo.length}  mean ${pct(mean(lo))} (${ann(mean(lo))})   EXCESS vs uncond ${pct(mean(lo) - uncond)}   %periods negative ${(100 * lo.filter((x) => x < 0).length / lo.length).toFixed(1)}%`);
    console.log(`        HIGH - LOW      ${pct(mean(hi) - mean(lo))} (${ann(mean(hi) - mean(lo))})   Welch t ${tNaive.toFixed(2)} (naive, overlapping)  ->  ${tAdj.toFixed(2)} OVERLAP-ADJUSTED (this is the one that counts)`);
  }
  // verdict on the TEST window, overlap-adjusted
  const hiT: number[] = [], loT: number[] = [];
  for (const d of test) { const z = s.z.get(d)!, r = fwd.get(d)!; if (z > cutHi) hiT.push(r); else if (z < cutLo) loT.push(r); }
  if (hiT.length < 30 || loT.length < 30) {
    verdicts.push({ name: s.name, verdict: "UNTESTED", detail: `OOS tercile n too small (hi ${hiT.length}, lo ${loT.length}) under train-frozen cuts` });
  } else {
    const tAdj = welch(hiT, loT) / Math.sqrt(HORIZON_D);
    verdicts.push({
      name: s.name,
      verdict: Math.abs(tAdj) >= 2 ? "CANDIDATE" : "NULL",
      detail: `OOS overlap-adjusted |t| ${Math.abs(tAdj).toFixed(2)} ${Math.abs(tAdj) >= 2 ? ">=" : "<"} 2 on n=${hiT.length}/${loT.length}`,
    });
  }
  console.log("");
}

console.log(`==> VERDICTS (decided on the OUT-OF-SAMPLE window with TRAIN-frozen cuts, overlap-adjusted t):`);
for (const v of verdicts) console.log(`    VERDICT ${v.name}: ${v.verdict} — ${v.detail}`);
const anyC = verdicts.some((v) => v.verdict === "CANDIDATE");
const anyU = verdicts.some((v) => v.verdict === "UNTESTED");
console.log(`\n    VERDICT (overall): ${
  anyC
    ? "CANDIDATE on at least one signal — but a conditioning study is not a book; before any promotion it owes a placeable instrument (INSTRUMENT LAW), turnover*cost, and a pre-registered forward rule."
    : anyU && !verdicts.some((v) => v.verdict === "NULL")
    ? "UNTESTED — coverage did not support the test on any signal. This is evidence about our DATA, not about the market (COVERAGE LAW)."
    : "NULL — index options/vol-regime extremity does not condition SPY forward returns at a level distinguishable from the unconditional mean, out-of-sample, once the 21d window overlap is accounted for. Coverage was adequate, so this is a market statement, not a data statement."
}`);
console.log(`    DESCRIPTIVE ONLY — no mechanism claim is registered here (MECHANISM LAW). Not written to trd_lineage; no forward clock started.`);
