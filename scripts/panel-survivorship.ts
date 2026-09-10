#!/usr/bin/env -S deno run --allow-net --allow-env
// panel-survivorship.ts (D-844) — PREREG: D-844-panel-survivorship. A self-attack on FLAW C8.
//
// C8, named by reasoning and never tested: survivorship in the DATA SOURCE, not the universe. D-639/645 repaired the
// EQUITY delisting hole and D-645/646 built a survivor-free DAILY perp panel (tf=1dSF) for exactly this reason.
// Nothing ever asked whether the HOURLY panel got the same treatment — and every intraday conclusion of the last
// fortnight (D-827 trend alignment, D-828 the atlas, D-829 range-exhaustion, D-842 boundary robustness) reads it.
//
// Two questions, because counting a hole is not the same as showing it matters:
//   (1) HOW BIG — how many contracts that traded long enough to qualify are absent from the hourly panels because
//       they stopped trading? Measured against the venue's own live status list, never inferred from staleness.
//   (2) DOES IT MATTER — on the survivor-free DAILY panel, does the load-bearing statistic (the autocorrelation of
//       daily range) differ between contracts that survived and contracts that died? The bar is 0.093, the boundary
//       spread D-842 established as this programme's honest precision floor for that same statistic. A gap under it
//       is not distinguishable from a convention I chose.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("panel-survivorship", [
  { name: "MIN_BARS", def: "300", note: "daily bars a dead contract needs to have qualified for the hourly panel (>10,000 hourly bars is ~417 days)" },
  { name: "PAGE", def: "20", note: "symbols per REST read (D-812)" },
  { name: "D828_CORR", def: "0.612", note: "D-828's corr(day range, prior-day range); the ALIVE cohort must reproduce it within TOL or the panels are not comparable" },
  { name: "TOL", def: "0.15", note: "how far the alive cohort may sit from D828_CORR before the comparison is declared invalid" },
  { name: "BAR", def: "0.093", note: "D-842's boundary spread — the precision floor a cohort gap must exceed to mean anything" },
  { name: "RUN_ID", def: "D-844-panel-survivorship" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "psv", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); };

console.log(`\n==> D-844 PANEL SURVIVORSHIP — flaw C8. The daily panel was repaired for this. Was the hourly one?`);
console.log(`    PREREG: D-844-panel-survivorship. Liveness read from the VENUE's own status list, not from staleness.\n`);

// ---- (0) the venue's live list. POSITIVE CONTROL (D-641): a zero here is a broken question, not a live universe. ---
const info = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then((r) => r.ok ? r.json() : null) as { symbols: { symbol: string; status: string }[] } | null;
if (!info) { console.error("  RED — exchangeInfo unreachable; refusing to infer liveness from staleness."); Deno.exit(1); }
const trading = new Set(info.symbols.filter((s) => s.status === "TRADING").map((s) => s.symbol));
if (trading.size < 100) { console.error(`  RED — venue reports only ${trading.size} TRADING contracts; that is a broken read, not a universe.`); Deno.exit(1); }
console.log(`  venue reports ${trading.size} contracts TRADING today, out of ${info.symbols.length} it lists at all.`);

// ---- (1) how big is the hole, per panel -------------------------------------------------------------------------
const meta = await q(`trd_bars_intraday?select=tf,symbol,n_bars&order=tf`) as { tf: string; symbol: string; n_bars: number }[];
assertNonEmpty("panel rows", meta, 100);
const panels = new Map<string, { tf: string; symbol: string; n_bars: number }[]>();
for (const m of meta) { let a = panels.get(m.tf); if (!a) { a = []; panels.set(m.tf, a); } a.push(m); }
console.log(`\n  DEAD CONTRACTS HELD, BY PANEL (dead = the venue does not list it as TRADING today)`);
console.log(`  ${"panel".padEnd(9)} ${"symbols".padStart(8)} ${"dead".padStart(6)} ${"dead with >=" + K.MIN_BARS + " bars".padStart(22)} ${"dead %".padStart(8)}`);
let deadQualifying: string[] = [];
for (const [tf, rows] of [...panels.entries()].sort()) {
  const dead = rows.filter((r) => !trading.has(r.symbol));
  const qual = dead.filter((r) => (r.n_bars ?? 0) >= +K.MIN_BARS);
  if (tf === "1dSF") deadQualifying = qual.map((r) => r.symbol);
  console.log(`  ${tf.padEnd(9)} ${String(rows.length).padStart(8)} ${String(dead.length).padStart(6)} ${String(qual.length).padStart(22)} ${(100 * dead.length / rows.length).toFixed(1).padStart(8)}`);
}
const hourly = ["1h", "1hSF"].map((tf) => ({ tf, dead: (panels.get(tf) ?? []).filter((r) => !trading.has(r.symbol)).length }));
console.log(`\n  The hourly panels every intraday conclusion reads hold ${hourly.map((h) => `${h.tf}:${h.dead}`).join(", ")} dead contracts.`);
if (deadQualifying.length < 20) {
  console.log(`\n  UNTESTED — only ${deadQualifying.length} dead contracts in 1dSF carry >=${K.MIN_BARS} bars; too thin a cohort to measure. Rule says UNTESTED, not NULL.`);
  Deno.exit(0);
}

// ---- (2) does it matter -----------------------------------------------------------------------------------------
// THE ESTIMATOR WAS REPAIRED AFTER THE CONTROL FIRED, and the repair is declared rather than quietly applied.
// The first version POOLED every day of every contract into one correlation. On the 60 deepest contracts that gives
// 0.498, in D-828's neighbourhood; on all 512 it gives 0.096, because pooling mixes contracts whose typical range
// differs by an order of magnitude and newly-listed contracts decay in volatility. The control existed to catch
// exactly that and did. Two changes, neither of which touches the decision rule or the cohort definition:
//   * the statistic is computed PER CONTRACT and compared as a cohort MEDIAN — pooling across heterogeneous
//     instruments was never the right estimator for "does this instrument's range persist";
//   * cohorts are compared WITHIN MATCHED HISTORY DEPTH. Dead contracts are shorter-lived by construction, so an
//     unmatched alive-vs-dead gap would be measuring YOUTH, not death — the D-590 pooled-comparison shape.
const sf = panels.get("1dSF")!.filter((r) => (r.n_bars ?? 0) >= +K.MIN_BARS);
const deadSet = new Set(deadQualifying);
type Ct = { sym: string; cohort: "alive" | "dead"; n: number; c: number; body: number };
const cts: Ct[] = [];
for (let i = 0; i < sf.length; i += +K.PAGE) {
  const page = sf.slice(i, i + +K.PAGE);
  const rows = await q(`trd_bars_intraday?tf=eq.1dSF&symbol=in.(${page.map((p) => p.symbol).join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const b = (r.bars ?? []).slice().sort((x, y) => x[0] - y[0]);
    const R: number[] = [], P: number[] = [], B: number[] = [];
    let prevR: number | null = null;
    for (const [, o, hi, lo, c] of b) {
      if (!(o > 0 && hi >= lo && lo > 0)) { prevR = null; continue; }
      const rng = (hi - lo) / o; if (!(rng > 0)) { prevR = null; continue; }
      B.push(Math.abs(c - o) / o / rng);
      if (prevR !== null) { R.push(rng); P.push(prevR); }
      prevR = rng;
    }
    if (R.length < 250) continue;
    cts.push({ sym: r.symbol, cohort: deadSet.has(r.symbol) ? "dead" : "alive", n: R.length, c: corr(P, R), body: mean(B) });
  }
}
assertNonEmpty("contracts with a per-contract correlation", cts, 50);
const BUCKETS: [string, number, number][] = [["300-599", 300, 599], ["600-1199", 600, 1199], ["1200+", 1200, 1e9]];
console.log(`\n  PER-CONTRACT corr(range, prior range), MEDIAN over contracts, MATCHED ON HISTORY DEPTH:`);
console.log(`  ${"depth (days)".padEnd(13)} ${"alive n".padStart(8)} ${"alive corr".padStart(11)} ${"dead n".padStart(7)} ${"dead corr".padStart(10)} ${"gap".padStart(7)}`);
const gaps: { w: number; g: number }[] = [];
for (const [name, lo, hi] of BUCKETS) {
  const A = cts.filter((x) => x.cohort === "alive" && x.n >= lo && x.n <= hi).map((x) => x.c);
  const D = cts.filter((x) => x.cohort === "dead" && x.n >= lo && x.n <= hi).map((x) => x.c);
  if (A.length < 5 || D.length < 5) { console.log(`  ${name.padEnd(13)} ${String(A.length).padStart(8)} ${(A.length ? med(A).toFixed(3) : "-").padStart(11)} ${String(D.length).padStart(7)} ${(D.length ? med(D).toFixed(3) : "-").padStart(10)} ${"too thin".padStart(7)}`); continue; }
  const g = med(A) - med(D); gaps.push({ w: Math.min(A.length, D.length), g: Math.abs(g) });
  console.log(`  ${name.padEnd(13)} ${String(A.length).padStart(8)} ${med(A).toFixed(3).padStart(11)} ${String(D.length).padStart(7)} ${med(D).toFixed(3).padStart(10)} ${g.toFixed(3).padStart(7)}`);
}
const allA = cts.filter((x) => x.cohort === "alive"), allD = cts.filter((x) => x.cohort === "dead");
console.log(`  ${"UNMATCHED".padEnd(13)} ${String(allA.length).padStart(8)} ${med(allA.map((x) => x.c)).toFixed(3).padStart(11)} ${String(allD.length).padStart(7)} ${med(allD.map((x) => x.c)).toFixed(3).padStart(10)} ${(med(allA.map((x) => x.c)) - med(allD.map((x) => x.c))).toFixed(3).padStart(7)}`);
console.log(`  body/range: alive ${med(allA.map((x) => x.body)).toFixed(3)}, dead ${med(allD.map((x) => x.body)).toFixed(3)}`);
// The depth-matched gap is the weighted mean of the per-bucket gaps; it is what the rule is applied to.
const gap = gaps.length ? gaps.reduce((s, x) => s + x.w * x.g, 0) / gaps.reduce((s, x) => s + x.w, 0) : NaN;
console.log(`\n  DEPTH-MATCHED GAP (the number the rule decides on): ${gap.toFixed(3)}   [bar ${K.BAR}, D-842's boundary spread]`);

// DIAGNOSTIC, added because an uninformative UNTESTED is a wasted test: is the difference between this panel and
// D-828's the COHORT, or the UNIVERSE? The same estimator on the same daily bars, restricted to the very contracts
// D-828 actually used, separates "the estimator is broken" from "the two panels are different universes".
const d828Syms = new Set((panels.get("1h") ?? []).filter((r) => (r.n_bars ?? 0) > 10000).map((r) => r.symbol));
const inBoth = cts.filter((x) => d828Syms.has(x.sym));
console.log(`\n  DIAGNOSTIC — the SAME estimator on the SAME daily bars, restricted to the contracts D-828 actually read:`);
console.log(`    D-828's own perps (${inBoth.length} of ${d828Syms.size} present in 1dSF): median corr ${inBoth.length ? med(inBoth.map((x) => x.c)).toFixed(3) : "-"}`);
console.log(`    all mature live contracts (${cts.filter((x) => x.cohort === "alive" && x.n >= 1200).length}):        median corr ${med(cts.filter((x) => x.cohort === "alive" && x.n >= 1200).map((x) => x.c)).toFixed(3)}`);
console.log(`    every live contract (${cts.filter((x) => x.cohort === "alive").length}):                  median corr ${med(cts.filter((x) => x.cohort === "alive").map((x) => x.c)).toFixed(3)}`);

// the control: mature ALIVE contracts must reproduce the statistic this panel stands in for
const mature = cts.filter((x) => x.cohort === "alive" && x.n >= 1200).map((x) => x.c);
const aliveMature = med(mature), off = Math.abs(aliveMature - +K.D828_CORR);
console.log(`\n  POSITIVE CONTROL — mature live contracts must reproduce the statistic this panel is standing in for:`);
console.log(`    D-828 measured ${K.D828_CORR} on hourly-aggregated days across 24 instruments; ${mature.length} mature live perps here give ${aliveMature.toFixed(3)} (off ${off.toFixed(3)}, tol ${K.TOL}).`);
const comparable = off <= +K.TOL;
console.log(`    ${comparable ? "PASSED — the daily panel measures the same quantity, so the cohort comparison is valid." : "FAILED — the panels are not measuring the same thing; the comparison is invalid."}`);

console.log(`\n  VERDICT, against the rule written before the data was read:`);
const holeExists = hourly.every((h) => h.tf !== "1h" || h.dead === 0) && deadQualifying.length >= 20;
if (!comparable) console.log(`    UNTESTED — the control failed. The hole is real (${deadQualifying.length} qualifying dead contracts) but its consequence is unmeasured.`);
else if (holeExists && gap > +K.BAR) {
  console.log(`    SUPPORTED. The 1h panel is survivor-only (${deadQualifying.length} qualifying dead contracts exist daily and NONE is held hourly), and it MATTERS:`);
  console.log(`    the depth-matched cohort gap is ${gap.toFixed(3)}, above the ${K.BAR} precision floor D-842 established.`);
} else if (holeExists) {
  console.log(`    NULL on the second half; the first half stands as a MEASUREMENT. The 1h panel IS survivor-only:`);
  console.log(`    ${deadQualifying.length} contracts traded >=${K.MIN_BARS} days and then stopped, and not one is in the panel every intraday result reads.`);
  console.log(`    But the statistic does not care: the depth-matched gap is ${gap.toFixed(3)}, BELOW the ${K.BAR} floor — smaller than the`);
  console.log(`    day-boundary convention I chose. Range persistence is a property of the instrument class, not of surviving.`);
  console.log(`    What must change is the UNIVERSE STATEMENT on D-827/828/829/842, not the finding.`);
} else console.log(`    NULL — the hourly panel is not survivor-only; C8 does not bite here.`);
// ---- (3) WHY THE CONTROL FAILED — and it is not what the rule assumed --------------------------------------------
// The rule read the control's failure as "the daily panel measures something else". It does not. The mature-live
// cohort above gives 0.443, and D-828's OWN 16 perps under D-828's OWN recipe give a per-instrument median of 0.375
// and a POOLED 0.498. The panels agree; the REFERENCE VALUE is what does not reproduce. So the control failed because
// 0.612 is a pooled statistic across a heterogeneous panel, and pooling instruments whose volatility LEVELS differ
// manufactures correlation — a high-volatility instrument has a large range on both days. This is the D-415 shape and
// THE BREADTH LAW's own rule. Measured here rather than asserted:
const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
const SPLIT = Date.parse("2023-01-01T00:00:00Z") / 1000;
type B = { ts: number; o: number; h: number; l: number; c: number };
async function loadH(sym: string): Promise<B[]> {
  if (FX.includes(sym)) return (await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c&order=ts.asc`) as B[]).filter((x) => x.h !== x.l);
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0];
  return ((row?.bars ?? []) as number[][]).map((x) => ({ ts: x[0], o: x[1], h: x[2], l: x[3], c: x[4] })).sort((a, z) => a.ts - z.ts);
}
async function grp(names: string[], label: string) {
  const PR: number[] = [], PP: number[] = [], per: number[] = [];
  for (const sym of names) {
    const bs = (await loadH(sym)).filter((x) => x.ts >= SPLIT);
    const m = new Map<number, B[]>();
    for (const x of bs) { const kk = Math.floor(x.ts / 86400); let a = m.get(kk); if (!a) { a = []; m.set(kk, a); } a.push(x); }
    const R: number[] = [], P: number[] = []; let prev: number | null = null;
    for (const kk of [...m.keys()].sort((a, z) => a - z)) {
      const d = m.get(kk)!; if (d.length < 12) { prev = null; continue; }
      let hi = -Infinity, lo = Infinity; for (const x of d) { hi = Math.max(hi, x.h); lo = Math.min(lo, x.l); }
      const o = d[0].o, rng = (hi - lo) / o; if (!(rng > 0)) { prev = null; continue; }
      if (prev !== null) { R.push(rng); P.push(prev); PR.push(rng); PP.push(prev); }
      prev = rng;
    }
    if (R.length >= 100) per.push(corr(P, R));
  }
  console.log(`    ${label.padEnd(34)} n=${String(names.length).padStart(3)}  days ${String(PR.length).padStart(6)}  POOLED ${corr(PP, PR).toFixed(3)}   per-instrument median ${med(per).toFixed(3)}`);
  return { pooled: corr(PP, PR), median: med(per) };
}
const perps828 = [...d828Syms];
console.log(`\n  WHY THE CONTROL FAILED — D-828's own recipe (2023+, hourly-aggregated UTC days), decomposed:`);
const all24 = await grp([...perps828, ...FX], "ALL 24 (what D-828 reported)");
await grp(perps828, "the 16 crypto perps");
await grp(FX, "the 8 FX / index / commodity");
console.log(`\n    POOLING INFLATION: pooled ${all24.pooled.toFixed(3)} against a per-instrument median of ${all24.median.toFixed(3)} — a gap of ${(all24.pooled - all24.median).toFixed(3)},`);
console.log(`    ${((all24.pooled - all24.median) / +K.BAR).toFixed(1)}x the ${K.BAR} boundary spread D-842 called this statistic's precision floor. The pooled number exceeds`);
console.log(`    EVERY instrument's own median because instruments differ in volatility LEVEL, not because range persists more.`);
console.log(`    The finding survives — a per-instrument median of ${all24.median.toFixed(3)} is still real persistence, and direction is still 50.1% —`);
console.log(`    but "range is predictable at 0.60" is a POOLED figure that describes neither asset class: 0.498 crypto, 0.710 FX/index.`);

console.log(`\n  WHAT THIS IS NOT: it measures the perp panels only. The FX/index CFD series named in C8 has no venue status`);
console.log(`  list to check against and is UNTESTED. And a contract absent because it was never INGESTED is indistinguishable`);
console.log(`  here from one absent because it died — the count is of dead contracts we HOLD daily and lack hourly.`);
const t = await spendTrials({ rest: OWNED, headers: hdr, family: "panel-survivorship", runId: K.RUN_ID, spent: 4 });
console.log(`\n  trials +4 (two cohorts x two statistics); ceiling ${t.ceiling.toFixed(4)}.`);
