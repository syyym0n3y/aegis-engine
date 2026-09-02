#!/usr/bin/env -S deno run --allow-net --allow-env
// commodity-roll.ts (D-742) — the commodity ROLL-YIELD / backwardation test, unblocked by ingest-eia-curve.ts. The
// defining commodity edge in the literature (Gorton-Rouwenhorst 2006; Erb-Harvey 2006): a BACKWARDATED curve
// (front > second) predicts positive futures returns; contango predicts negative. Roll yield = ln(c1/c2) × 12 for the
// monthly-spaced CL and NG curves.
//
// CONSTRUCTION that does not fake the roll: a continuous front series jumps at every expiry, so its month-on-month
// change is NOT a holding return. With monthly-spaced contracts, the contract that is c2 at month-end t IS c1 at
// month-end t+1 (CL expires ~20th, NG ~3 days before month start — both before month-end). So the honest one-month
// return of holding the second contract is ln(c1[t+1] / c2[t]). The roll yield is embedded in it, as it is in life.
//
// HONESTY: (1) BREADTH = 2 commodities — no cross-section exists here; each is a SINGLE-INSTRUMENT time-series test
// (universe sensitivity does not apply; a cross-sectional claim is UNTESTED). (2) Signal at month-end t, position
// held t -> t+1 (lag-1 by construction). (3) Coverage ends 2024-04 (EIA XLS mirror), stated. (4) Turnover, cost drag,
// time underwater and worst DD beside every return. (5) Pre-stated SIGN prior: backwardation -> positive return.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("commodity-roll", [{ name: "RT_BP", def: "10", note: "round-trip futures cost in bp (CL/NG ~5-15bp incl. slippage)" }]);
const RT_BP = Number(Deno.env.get("RT_BP") || "10");

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "roll", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// D-757: STRICT read. A transport failure now RETRIES and then THROWS with the path and status, instead of
// returning [] — which was indistinguishable from "the market has nothing here" (D-756: a PostgREST OOM
// restart silently shrank a 15,502-symbol universe to 8,600 and the run finished, printing a wrong number).
const { q } = mkStrictRead(OWNED, hdr);

// month-end value of a daily series (last obs in each calendar month)
async function monthEnd(series: string): Promise<Map<string, number>> {
  const rows = (await q(`trd_macro_series?series=eq.${series}&select=d,v&order=d.asc`)) as { d: string; v: number }[]; // plumbing-ok: ordered, single series
  const m = new Map<string, number>(); for (const r of rows) if (r.v > 0) m.set(r.d.slice(0, 7), r.v); return m;
}
const stats = (x: number[]) => { const n = x.length, mean = x.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)); return { n, mean, sd, t: mean / (sd / Math.sqrt(n)), sr: (mean / sd) * Math.sqrt(12) }; };
const underwater = (x: number[]) => { let peak = 0, cum = 0, longest = 0, cur = 0, worst = 0; for (const r of x) { cum += r; if (cum > peak) { peak = cum; cur = 0; } else { cur++; if (cur > longest) longest = cur; } if (cum - peak < worst) worst = cum - peak; } return { longest, worst }; };

console.log(`==> COMMODITY ROLL YIELD / BACKWARDATION (D-742) — CL (WTI) and NG (Henry Hub), EIA curve, monthly\n`);
console.log(`  *** BREADTH = 2. No cross-section exists; each line below is a SINGLE-INSTRUMENT time-series test. ***`);
console.log(`  SIGN PRIOR (stated before the numbers): backwardation (c1 > c2) -> POSITIVE next-month return; contango -> negative.\n`);

let trials = 0; const verdicts: string[] = [];
for (const [name, c1s, c2s] of [["CL", "eia_cl_c1", "eia_cl_c2"], ["NG", "eia_ng_c1", "eia_ng_c2"]] as const) {
  const c1 = await monthEnd(c1s), c2 = await monthEnd(c2s);
  const months = [...c1.keys()].filter((m) => c2.has(m)).sort();
  const rows: { m: string; roll: number; ret: number }[] = [];
  for (let i = 0; i < months.length - 1; i++) {
    const m0 = months[i], m1 = months[i + 1];
    const f1 = c1.get(m0)!, f2 = c2.get(m0)!, f1n = c1.get(m1)!;
    if (!(f1 > 0 && f2 > 0 && f1n > 0)) continue;             // (the 2020-04 negative WTI print is excluded from log-space; stated)
    rows.push({ m: m0, roll: Math.log(f1 / f2) * 12, ret: Math.log(f1n / f2) });   // hold the 2nd contract for a month
  }
  assertNonEmpty(`${name} roll panel`, rows, 200);
  trials++;
  const uncond = stats(rows.map((r) => r.ret));
  // (a) SIGN-CONDITIONED: long when backwardated, short when contango (a timing rule), lag-1 by construction
  const signed = rows.map((r) => (r.roll > 0 ? 1 : -1) * r.ret);
  const sg = stats(signed), uw = underwater(signed);
  let flips = 0; for (let i = 1; i < rows.length; i++) if ((rows[i].roll > 0) !== (rows[i - 1].roll > 0)) flips++;
  const turnover = flips / rows.length * 2;                      // one-way per month (a flip is a 2-unit trade)
  const drag = turnover * 12 * (RT_BP / 1e4) * 100;
  // (b) the two regimes separately — is the premium in backwardation, contango, or both (BENCHMARK: vs unconditional)
  const back = stats(rows.filter((r) => r.roll > 0).map((r) => r.ret)), cont = stats(rows.filter((r) => r.roll <= 0).map((r) => r.ret));
  const pctBack = rows.filter((r) => r.roll > 0).length / rows.length * 100;
  // (c) predictive regression ret ~ roll (roll is a fairly persistent LEVEL — reported, flagged, D-730)
  const xs = rows.map((r) => r.roll), ys = rows.map((r) => r.ret);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxy / sxx; const res = ys.map((y, i) => y - my - slope * (xs[i] - mx)); const se = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / (xs.length - 2) / sxx);

  console.log(`  ${name}  ${rows.length} months  ${rows[0].m} .. ${rows[rows.length - 1].m}   backwardated ${pctBack.toFixed(0)}% of months`);
  console.log(`    UNCONDITIONAL long (the benchmark)  ${(uncond.mean * 12 * 100).toFixed(2)}%/yr  SR ${uncond.sr.toFixed(2)}  t ${uncond.t.toFixed(2)}`);
  console.log(`    in BACKWARDATION months  n=${back.n}  ${(back.mean * 12 * 100).toFixed(2)}%/yr  t ${back.t.toFixed(2)}   | in CONTANGO months  n=${cont.n}  ${(cont.mean * 12 * 100).toFixed(2)}%/yr  t ${cont.t.toFixed(2)}`);
  console.log(`    SIGN-CONDITIONED long/short (gross)  ${(sg.mean * 12 * 100).toFixed(2)}%/yr  SR ${sg.sr.toFixed(2)}  gross t ${sg.t.toFixed(2)}  N=${sg.n}`);
  console.log(`      turnover ${turnover.toFixed(2)} one-way/mo -> drag @${RT_BP}bp ${drag.toFixed(2)}%/yr -> NET ${(sg.mean * 12 * 100 - drag).toFixed(2)}%/yr`);
  console.log(`      HOLDABILITY  longest underwater ${uw.longest} months (${(uw.longest / 12).toFixed(1)}y)  worst DD ${(uw.worst * 100).toFixed(1)}%`);
  console.log(`    predictive slope ret~roll ${slope.toFixed(3)}  gross t ${(slope / se).toFixed(2)}  (LEVEL regressor, D-730 suspect)`);
  // (d) ERA / OOS split (D-455 discipline): the rule has no fitted parameter, so a split is a pure stability check —
  // does the sign rule earn in EVERY era, or is the t carried by one? Decade blocks + a pre/post-2005 halves split.
  const era = (from: string, to: string) => { const s = rows.filter((r) => r.m >= from && r.m < to).map((r) => (r.roll > 0 ? 1 : -1) * r.ret); return s.length > 24 ? stats(s) : null; };
  const eras: [string, string, string][] = [["1985", "1985-01", "1995-01"], ["1995", "1995-01", "2005-01"], ["2005", "2005-01", "2015-01"], ["2015", "2015-01", "2025-01"]];
  console.log(`    ERA SPLIT (sign-conditioned, gross %/yr, t):  ${eras.map(([l, a, b]) => { const e = era(a, b); return e ? `${l}s ${(e.mean * 12 * 100).toFixed(1)} (t ${e.t.toFixed(2)}, n ${e.n})` : `${l}s n/a`; }).join("  |  ")}`);
  const h1 = era("1900-01", "2005-01"), h2 = era("2005-01", "2100-01");
  console.log(`    HALVES pre-2005: ${h1 ? `${(h1.mean * 12 * 100).toFixed(2)}%/yr t ${h1.t.toFixed(2)} n ${h1.n}` : "n/a"}  |  post-2005 (OOS-style): ${h2 ? `${(h2.mean * 12 * 100).toFixed(2)}%/yr t ${h2.t.toFixed(2)} n ${h2.n}` : "n/a"}`);
  if (uw.worst < -1) console.log(`    !! RUINED — cumulative log drawdown past -100%: this book was wiped out; the Sharpe/t above describe a dead equity curve.`);
  const matched = back.mean > cont.mean;
  console.log(`    SIGN vs prior: ${matched ? "MATCHED" : "MISSED"} (backwardation months ${matched ? ">" : "<="} contango months)`);
  const v = uw.worst < -1 ? `RUINED — equity curve wiped out (log DD ${(uw.worst * 100).toFixed(0)}%); sign-conditioned gross t ${sg.t.toFixed(2)} describes a dead book`
    : Math.abs(sg.t) < 2 ? `NULL — sign-conditioned |t| ${Math.abs(sg.t).toFixed(2)} < 2`
    : (sg.mean * 12 * 100 - drag) <= 0 ? `SUB-COST — gross t ${sg.t.toFixed(2)} but net <= 0`
    : !h2 || Math.abs(h2.t) < 2 ? `NULL OUT-OF-SAMPLE — full-sample gross t ${sg.t.toFixed(2)} is carried by pre-2005 (t ${h1?.t.toFixed(2)}); post-2005 gross t ${h2?.t.toFixed(2)} on n ${h2?.n} does not clear 2. Under the 5.46 ceiling either way`
    : `CANDIDATE — gross t ${sg.t.toFixed(2)} full, ${h2.t.toFixed(2)} post-2005; net ${(sg.mean * 12 * 100 - drag).toFixed(2)}%/yr; single instrument, under the 5.46 ceiling`;
  verdicts.push(`${name}: ${v}`); console.log(`    VERDICT ${name}: ${v}\n`);
}
console.log(`  TRIALS THIS RUN: ${trials} (one per commodity; no parameter search — the rule is the sign of the curve).`);
console.log(`  COVERAGE: EIA XLS mirror ends 2024-04; CL and NG only (GC/ZC/ZW/ZS/HG/SI have no free curve source — UNTESTED there).`);
console.log(`\n  VERDICT: ${verdicts.join(" | ")}`);
console.log(`  DESCRIPTIVE ONLY — no mechanism registered; not a gate clearance; not on a forward clock.`);
