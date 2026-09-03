#!/usr/bin/env -S deno run --allow-net --allow-env
// activist-13d.ts (FRONTIER) — the Schedule 13D activist event study. DESCRIPTIVE ONLY.
//
// SIGN PRIOR, STATED FIRST (THE SIGN LAW): "a 13D filing -> POSITIVE abnormal drift over +21/+63 days." This is the
// Brav/Jiang/Partnoy/Thomas (2008) direction (~7% abnormal around the filing). Every horizon below is measured against
// THIS pre-stated sign; a positive median that MATCHED, a negative one that MISSED, reported as such.
//
// WHAT A 13D IS AS A TRADE. An investor crossing 5% WITH INTENT to influence must file within 10 days (the passive
// 13G does not carry the catalyst). The filing is legally disclosed and retail-observable on EDGAR the day it lands.
// The question this script answers, and ONLY this: after the filing is public, is there a CAPTURABLE positive drift in
// the LIQUID tercile, net of a round-trip cost, above the base rate (the universe/benchmark over the same window)?
//
// DISCIPLINES BOLTED IN, each because a law demands it:
//   - EXECUTION / SAME-BAR (D-498): entry is the first close STRICTLY AFTER the filing date (lag-1). A 13D can hit
//     intraday; acting at the filing-day close would assume information we could not have traded on.
//   - BENCHMARK LAW: excess is measured against BOTH IWM (size-matched — 13D targets skew small) and SPY. A drift that
//     is just small-cap beta shows up as excess-vs-IWM near zero.
//   - LIQUIDITY LAW: the promotable number is the LIQUID tercile's (by pre-event median dollar volume), never pooled —
//     13D targets are often microcaps that cannot absorb size.
//   - SELECTION (population): a 13D on an already-liquid large cap and one on a microcap are different populations;
//     ALL / LIQUID / ILLIQUID terciles are all reported rather than a single pooled headline.
//   - TURNOVER LAW: one round trip at 30bp (enter once, exit once) is subtracted; the NET median is what decides.
//   - COVERAGE LAW: N-with-bars / N-total is reported, and the panel's delisted backfill only begins ~2020, so
//     pre-2020 filings on names that later delisted are structurally under-captured — stated, not hidden.
//   - DEDUP: the base test is the FIRST 13D per SUBJECT (earliest filing) — a later 13D by a second activist on the
//     same subject is not a fresh entry. Multi-activist subjects are reported separately, descriptively.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("activist-13d", [
  { name: "WINDOWS", def: "5,21,63,250", note: "forward horizons (trading days)" },
  { name: "COST_BP", def: "30", note: "one round trip, basis points (enter+exit)" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "a13d", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q, qAll } = mkStrictRead(OWNED, hdr);

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const winRate = (a: number[]) => a.length ? 100 * a.filter((x) => x > 0).length / a.length : 0;
async function bars(sym: string): Promise<number[][]> {
  // No .catch here: a symbol absent from the panel already returns 200 [] (raw?.[0] undefined -> []), so swallowing a
  // throw would only mask a real transport failure as an empty series — the D-756 silent-read defect this study must
  // not commit. mkStrictRead retries transients and THROWS on a genuine failure; that throw must propagate.
  const raw = await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`);
  return (raw?.[0]?.bars || []).filter((b: number[]) => b[4] > 0);
}

const WINS = K.WINDOWS.split(",").map(Number);
const COST = Number(K.COST_BP) / 100; // bp -> percent, one round trip

// ---- events: FIRST sc-13d per SUBJECT ticker (base test). Read only originals; amendments never enter. ----
const rows = (await qAll("trd_raw_filings?filing_type=eq.sc-13d&ticker=not.is.null&select=ticker,disclosed_date,raw&order=disclosed_date"))
  .map((r) => ({ ticker: String(r.ticker), d: String(r.disclosed_date), filer: String((r.raw?.filer_names ?? [""])[0] ?? "") }))
  .filter((e) => /^[A-Z]{1,5}$/.test(e.ticker) && /^\d{4}-\d\d-\d\d$/.test(e.d));
assertNonEmpty("sc-13d events with a subject ticker", rows, 100);

// Multi-activist descriptive: distinct filers per subject (across all originals, before first-per-subject dedup).
const filersBySubject = new Map<string, Set<string>>();
for (const r of rows) { const f = r.filer.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24); if (!f) continue; (filersBySubject.get(r.ticker) ?? filersBySubject.set(r.ticker, new Set()).get(r.ticker)!).add(f); }
const multiActivist = [...filersBySubject.values()].filter((s) => s.size >= 2).length;

// FIRST 13D per subject (earliest filing). rows are ordered by disclosed_date, so the first seen per ticker is earliest.
const firstBySubject = new Map<string, string>();
for (const r of rows) if (!firstBySubject.has(r.ticker)) firstBySubject.set(r.ticker, r.d);
console.log(`==> ACTIVIST 13D EVENT STUDY — DESCRIPTIVE ONLY`);
console.log(`    SIGN PRIOR (stated first): 13D filing -> POSITIVE abnormal drift +21/+63d (Brav/Jiang/Partnoy/Thomas 2008).`);
console.log(`    ${rows.length.toLocaleString()} sc-13d originals with a ticker | ${firstBySubject.size.toLocaleString()} distinct subjects (base test = first 13D per subject)`);
console.log(`    multi-activist subjects (>=2 distinct filers over the period): ${multiActivist.toLocaleString()} (descriptive)\n`);

const benchIWM = new Map((await bars("IWM")).map((b) => [iso(b[0]), b[4]]));
const benchSPY = new Map((await bars("SPY")).map((b) => [iso(b[0]), b[4]]));
const bAt = (m: Map<string, number>, d: string, dir: 1 | -1): number | undefined =>
  m.get(d) ?? (dir === 1 ? [...m.entries()].find(([sd]) => sd >= d)?.[1] : [...m.entries()].reverse().find(([sd]) => sd <= d)?.[1]);

interface Row { exIWM: number; exSPY: number; dollarVol: number; date: string; }
const res: Row[][] = WINS.map(() => []);
let captured = 0, noBars = 0, noEntry = 0;
for (const [tk, d] of firstBySubject) {
  const b = await bars(tk);
  if (b.length < 30) { noBars++; continue; }
  const dt = b.map((x) => iso(x[0]));
  const dv = b.map((x) => x[4] * x[5]);
  const medDV = [...dv].sort((a, z) => a - z)[Math.floor(dv.length / 2)];
  // ENTRY = first close STRICTLY AFTER the filing date (lag-1). Strict `>` so a filing-day close is never the entry.
  const ci = dt.findIndex((x) => x > d);
  if (ci < 0) { noEntry++; continue; }
  const lastDt = dt[dt.length - 1];
  let any = false;
  for (let wi = 0; wi < WINS.length; wi++) {
    const w = WINS[wi]; let iT = ci + w;
    if (iT >= b.length) {
      const delisted = lastDt < "2026-06-01"; // stopped trading -> real terminal (captures failure); else right-censored
      if (!delisted) continue;
      iT = b.length - 1;
    }
    if (iT <= ci) continue;
    const p0 = b[ci][4], p1 = b[iT][4];
    const iwm0 = bAt(benchIWM, dt[ci], 1), iwm1 = bAt(benchIWM, dt[iT], -1);
    const spy0 = bAt(benchSPY, dt[ci], 1), spy1 = bAt(benchSPY, dt[iT], -1);
    if (!(p0 > 0 && p1 > 0 && iwm0 && iwm1 && spy0 && spy1)) continue;
    const stk = (p1 / p0 - 1) * 100;
    res[wi].push({
      exIWM: stk - (iwm1 / iwm0 - 1) * 100,
      exSPY: stk - (spy1 / spy0 - 1) * 100,
      dollarVol: medDV,
      date: d,
    });
    any = true;
  }
  if (any) captured++;
}

// COVERAGE (COVERAGE LAW): how much of the subject set actually joined to price bars.
console.log(`    COVERAGE: ${captured.toLocaleString()} subjects with a usable entry / ${firstBySubject.size.toLocaleString()} total`
  + ` (${noBars.toLocaleString()} no/short bars, ${noEntry.toLocaleString()} no post-filing bar).`);
console.log(`    The delisted backfill begins ~2020, so pre-2020 filings on names that later delisted are UNDER-captured —`);
console.log(`    a survivorship tilt AGAINST failures, i.e. the true drift is if anything WORSE than measured for that era.\n`);

// POSITIVE CONTROL on a zero (THE POSITIVE-CONTROL RULE): if nothing captured, prove the plumbing works before
// calling it a market fact.
if (captured === 0) {
  const ctl = await bars("AAPL");
  console.error(`!! ZERO events captured. Positive control AAPL bars = ${ctl.length}. If AAPL has bars, the join is`);
  console.error(`   broken (a DATA finding), not a market null. RED.`);
  Deno.exit(1);
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "activist-13d", runId: `a13d|${WINS.join(",")}`, spent: WINS.length * 3 });

const report = (label: string, arr: Row[], pick: (r: Row) => number, bench: string) => {
  if (arr.length < 20) { console.log(`      ${label.padEnd(20)} n=${String(arr.length).padStart(4)}  (too few)`); return; }
  const gross = arr.map(pick);
  const net = gross.map((x) => x - COST); // one round trip
  console.log(`      ${label.padEnd(20)} n=${String(arr.length).padStart(4)}  vs ${bench}  GROSS med ${med(gross).toFixed(2)}% (mean ${mean(gross).toFixed(2)}%, t ${tstat(gross).toFixed(2)}, win ${winRate(gross).toFixed(0)}%)  NET med ${med(net).toFixed(2)}% (mean ${mean(net).toFixed(2)}%)`);
};

let anyEdge = false;
for (let wi = 0; wi < WINS.length; wi++) {
  const all = res[wi];
  if (all.length < 20) { console.log(`    ${WINS[wi]}d: n=${all.length} (too few)`); continue; }
  const sorted = [...all].sort((a, b) => a.dollarVol - b.dollarVol);
  const third = Math.floor(sorted.length / 3);
  const illiq = sorted.slice(0, third);
  const liq = sorted.slice(sorted.length - third);
  console.log(`    +${WINS[wi]}d:`);
  report("ALL", all, (r) => r.exIWM, "IWM");
  report("ALL", all, (r) => r.exSPY, "SPY");
  report("LIQUID (top 1/3)", liq, (r) => r.exIWM, "IWM");
  report("ILLIQUID (bot 1/3)", illiq, (r) => r.exIWM, "IWM");
  // era halves on the LIQUID tercile (the promotable population)
  const liqSorted = [...liq].sort((a, b) => a.date.localeCompare(b.date));
  const mid = liqSorted[Math.floor(liqSorted.length / 2)]?.date ?? "";
  const e1 = liqSorted.filter((r) => r.date < mid), e2 = liqSorted.filter((r) => r.date >= mid);
  report(`LIQ era<${mid.slice(0, 7)}`, e1, (r) => r.exIWM, "IWM");
  report(`LIQ era>=${mid.slice(0, 7)}`, e2, (r) => r.exIWM, "IWM");
  // EDGE test on the promotable number: LIQUID tercile, NET of cost, vs IWM, median positive AND |t|>2.5, MATCHING the
  // pre-stated positive sign, at the catalyst horizons (21/63d).
  if (WINS[wi] === 21 || WINS[wi] === 63) {
    const liqNetIWM = liq.map((r) => r.exIWM - COST);
    if (med(liqNetIWM) > 0 && tstat(liq.map((r) => r.exIWM)) > 2.5) anyEdge = true;
  }
  console.log("");
}

console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
const sign = anyEdge ? "MATCHED the positive prior" : "did NOT clear the bar for the positive prior";
console.log(`\n    VERDICT (DESCRIPTIVE ONLY, THE SIGN LAW): the liquid-tercile net drift at +21/+63d ${sign}.`);
console.log(`    ${anyEdge
  ? "A liquid-tercile net-of-cost positive drift clears |t|>2.5 at a catalyst horizon — a CANDIDATE. Deflate against the\n    ceiling above, forward-register a two-sided rule, and confirm before any claim; this run asserts nothing tradable."
  : "No liquid-tercile net-of-cost positive drift clears |t|>2.5 at +21/+63d. The Brav-et-al. filing drift, measured on\n    THIS panel with size-matched benchmark, liquidity screen and a round-trip cost, is not capturable here — consistent\n    with a crowded, capacity-bound, well-known catalyst (the programme's base-rate prior)."}`);
console.log(`    Every number above is a MEASUREMENT, not a promotion; nothing is written to lineage.`);
