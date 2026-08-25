#!/usr/bin/env -S deno run --allow-net --allow-env
// grammar-search-deep.ts (D-588) — the component grammar run over OUR OWN data instead of a 60-day Yahoo window.
//
// WHY: scripts/trd-strategy-search.ts enumerates 91,800 composed strategies (34 chart-pattern triggers x EMA x trend
// mode x stop lookback x RR x session x stop geometry) — the machine form of the operator's own method: read the
// chart, take many small favourable positions across many markets. But it has only ever run on Yahoo 15m bars with
// range=60d: roughly 2,500 bars per market on 4 markets. We hold 1,926,324 HOURLY perp bars across 94 symbols with
// a median of 23,922 bars each (~3 years). Searching a huge grammar on a tiny sample is the false-edge factory the
// deflation gate exists to catch; searching it on ~190x the data is the honest version of the same question.
// An acquired dataset the research never touches is a RESEARCH failure, not a market finding (COVERAGE LAW).
//
// TWO METHOD FIXES over the original search, both of which make the test HARDER, not easier:
//
// 1. COST IS CONVERTED PER TRADE, NOT ASSUMED FLAT. The original charges a fixed 0.05R per side. But cost in R
//    depends entirely on how wide the stop is: the runner already records riskFrac = |entry-stop|/entry, so a
//    9bp round-trip perp fee costs 0.09R against a 1% stop and 0.45R against a 0.2% stop — 5x more. A flat R-cost
//    therefore systematically FLATTERS tight-stop specs, and the grammar contains stop geometries (atr2, lookback 3)
//    that are routinely tight. Here every trade is charged its own fee in R units. This is the EFFECT-SIZE LAW
//    applied at the trade level: the number that matters is the edge measured in multiples of what it costs to act.
//
// 2. TRIALS ARE COUNTED HONESTLY AND THE CEILING MOVES WITH THEM. Every (spec, symbol) pair is one trial. The
//    deflation ceiling sqrt(2*ln N) is computed from the REAL total, including this run's contribution, not from a
//    hardcoded N (the defect that had aegis-autopilot surfacing momentum as "clearing" for nine cycles).
//
// PRE-REGISTERED EXPECTATION, stated before the run: almost nothing survives, and a survivor at this trial count
// needs |t| beyond ~5.5. That is the point of the gate, not a disappointment.
import { type Bar, enumerate, runComponentTrades, specKey } from "../supabase/functions/_shared/trd-grammar.ts";
import { deflatedSharpe, kurtosis, mean, sampleStd, skewness } from "../supabase/functions/_shared/trd-stats.ts";
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

// D-598: declare every knob. This prints what ACTUALLY took effect and refuses to run on a near-miss variable name.
// Both failures it prevents happened today: a run launched without PERP_FEE_RT_BP=0 whose output I then labelled
// "gross", and a self-test that silently did nothing because the script read SELFTEST while I set GUARD_SELFTEST.
declareKnobs("grammar-search-deep", [
  { name: "SRC", def: "perp", note: "perp | fx" },
  { name: "TF", def: "1hSF" },
  { name: "NSYM", def: "8" },
  { name: "PERP_FEE_RT_BP", def: "9", note: "round-trip bp; 0 = GROSS" },
  { name: "MAXSPECS", def: "0", note: "0 = whole grammar" },
  { name: "MIN_TRADES", def: "30" },
  { name: "STOPMODE", def: "" },
  { name: "SIDESPLIT", def: "" },
  { name: "DRIFTADJ", def: "" },
  { name: "TRIAL_BASE", def: "1531193" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gsd", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

const TF = Deno.env.get("TF") || "1hSF";
const NSYM = Number(Deno.env.get("NSYM") || 8);
const FEE_BP = Number(Deno.env.get("PERP_FEE_RT_BP") || 9);          // round-trip taker, in bp of notional
const MAXSPECS = Number(Deno.env.get("MAXSPECS") || 0);               // 0 = the whole grammar
const MIN_TRADES = Number(Deno.env.get("MIN_TRADES") || 30);

// ---- load bars from our own store ----
// D-594: SRC selects the market family. "perp" is the crypto panel (3y, 9bp taker); "fx" is the Dukascopy
// hourly set — FX majors, gold, S&P, Nasdaq, Brent — 639,168 bars over 10.6 YEARS at a fraction of the crypto cost.
// The generalisation question the crypto result cannot answer on its own: is "no gross edge, sub-fee" a property of
// this grammar, or a property of crypto perps at these horizons?
const SRC = Deno.env.get("SRC") || "perp";
const markets: [string, Bar[]][] = [];
if (SRC === "fx") {
  const syms = await fetch(`${OWNED}/trd_fx_hourly?select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
  const uniq = [...new Set((Array.isArray(syms) ? syms : []).map((x) => x.symbol))].slice(0, NSYM);
  for (const sym of uniq) {
    const bars: Bar[] = [];
    for (let off = 0;; off += 50000) {
      const rows = await fetch(`${OWNED}/trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c&order=ts&offset=${off}&limit=50000`, { headers: hdr })
        .then((r) => r.json()).catch(() => []) as { ts: number; o: number; h: number; l: number; c: number }[];
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) if ([r.o, r.h, r.l, r.c].every((x) => Number.isFinite(x) && x > 0))
        bars.push({ ts: new Date(r.ts * 1000).toISOString(), open: r.o, high: r.h, low: r.l, close: r.c });
      if (rows.length < 50000) break;
    }
    if (bars.length >= 2000) markets.push([sym, bars]);
  }
} else {
  const meta = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&select=symbol,n_bars&order=n_bars.desc&limit=${NSYM}`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; n_bars: number }[];
  if (!Array.isArray(meta) || !meta.length) { console.error("!! no bars available — cannot search. RED."); Deno.exit(1); }
  for (const m of meta) {
    const rows = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&symbol=eq.${m.symbol}&select=bars`, { headers: hdr })
      .then((r) => r.json()).catch(() => []) as { bars: number[][] }[];
    const raw = rows?.[0]?.bars; if (!raw?.length) continue;
    const bars: Bar[] = [];
    for (const b of raw) {
      const [ts, o, h, l, c] = b;
      if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue;
      bars.push({ ts: new Date(ts * 1000).toISOString(), open: o, high: h, low: l, close: c });
    }
    if (bars.length >= 2000) markets.push([m.symbol, bars]);
  }
}
assertNonEmpty("markets with >=2000 usable bars", markets);

let specs = enumerate();
// D-589: stratify by stop GEOMETRY. Cost in R scales as fee/stop-width, so if the gross effect is constant in R the
// wide geometries should be where net survives. The competing possibility — that gross R falls with stop width just
// as fast as cost does — is exactly what this stratification measures rather than assumes.
const STOPMODE_FILTER = Deno.env.get("STOPMODE") || "";
if (STOPMODE_FILTER) specs = specs.filter((x) => (x.stopMode ?? "swing") === STOPMODE_FILTER);
if (MAXSPECS > 0) specs = specs.slice(0, MAXSPECS);
assertNonEmpty("specs after STOPMODE/MAXSPECS filtering", specs);   // D-598: a filter matching nothing is UNTESTED

const totalPlanned = specs.length * markets.length;
console.log(`==> GRAMMAR SEARCH (deep) — ${specs.length.toLocaleString()} composed strategies x ${markets.length} symbols = ${totalPlanned.toLocaleString()} trials`);
console.log(`    data: src=${SRC} tf=${TF}, ${markets.map(([s, b]) => `${s} ${b.length}`).join(", ")}`);
console.log(`    cost: ${FEE_BP}bp round trip converted PER TRADE via riskFrac (not a flat R assumption)`);
console.log(`    gate: OOS net>0 AND deflated-Sharpe prob>0.95 AND |t| over the live ceiling; >=${MIN_TRADES} trades\n`);

// ---- honest cost conversion ----
// The runner charges gross r minus 2*costRPerSide. We pass 0 and re-charge each trade with its OWN fee:
//   fee_in_R = (FEE_BP/10000) / riskFrac      [riskFrac = |entry-stop|/entry]
// so a tight stop pays proportionally more, which is what actually happens.
// D-588b: the gross persistence (71.7% of train-positive specs repeating OOS) is suspicious — crypto ROSE across both
// halves, so a long-biased spec wins twice without any skill. SIDESPLIT reports the long/short composition of the
// train-positive set: if persistence is beta, the winners will be overwhelmingly long and their short legs will not
// persist. Testing the confound is cheaper than arguing about it.
const SIDESPLIT = Deno.env.get("SIDESPLIT") === "1";
// D-591 THE BENCHMARK LAW, applied to this result. D-590 showed the grammar's gross persistence is a LONG TILT in a
// market that tripled. The decisive test is not another decomposition — it is asking what the trades earned ABOVE
// simply holding the same directional exposure for the same duration. For a trade entered at i and exited at j:
//   benchmark_R = dir * (close_j/close_i - 1) / riskFrac      [riskFrac = risk/entry, so move_frac/riskFrac = R]
// excess = trade_R - benchmark_R. If the effect is drift, excess collapses to ~0 or below.
const DRIFTADJ = Deno.env.get("DRIFTADJ") === "1";
const netR = (t: { r: number; riskFrac: number }): number =>
  t.riskFrac > 0 ? t.r - (FEE_BP / 1e4) / t.riskFrac : t.r - 1;

interface Row { sym: string; key: string; n: number; shTest: number; tTest: number; expTest: number; expTrain: number; medRiskFrac: number; skew: number; kurt: number }
const rows: Row[] = [];
// Deflation needs the VARIANCE OF TRIAL SHARPES across the search itself (Lopez de Prado): the wider the spread of
// what the search produced, the higher the max a random search would have thrown up. Collecting it is the difference
// between deflating by the real search and deflating by an assumed one. Convention (same as the original search): a
// trial too thin to evaluate contributes 0, so the variance reflects every trial spent, not only the good ones.
const allSharpes: number[] = [];
const sideAgg = { longN: 0, longSum: 0, shortN: 0, shortSum: 0 };
let trials = 0, isPos = 0, oosPos = 0, thin = 0;

for (const [sym, bars] of markets) {
  const tsIdx = new Map<string, number>();
  if (DRIFTADJ) bars.forEach((b, i) => tsIdx.set(b.ts, i));
  const benchR = (t: { entryTs: string; exitIdx: number; side: "long" | "short"; riskFrac: number }, arr: Bar[], off: number): number => {
    const ei = tsIdx.get(t.entryTs); if (ei === undefined || t.riskFrac <= 0) return 0;
    const a = arr[ei - off]?.close, b = arr[t.exitIdx]?.close;
    if (!(a > 0) || !(b > 0)) return 0;
    return (t.side === "long" ? 1 : -1) * (b / a - 1) / t.riskFrac;
  };
  const mid = Math.floor(bars.length * 0.6);
  const train = bars.slice(0, mid), test = bars.slice(mid);
  for (const s of specs) {
    trials++;
    const trRaw = runComponentTrades(train, s, { costRPerSide: 0 });
    const trTr = trRaw.map((t) => ({ r: DRIFTADJ ? t.r - benchR(t, train, 0) : t.r, riskFrac: t.riskFrac }));
    if (trTr.length < MIN_TRADES) { thin++; allSharpes.push(0); continue; }
    const trainNet = trTr.map(netR);
    const eTr = mean(trainNet);
    allSharpes.push(eTr / (sampleStd(trainNet) || 1e-9));
    if (eTr <= 0) continue;                                  // selection made on TRAIN ONLY (SELECTION LAW)
    isPos++;
    const teRaw = runComponentTrades(test, s, { costRPerSide: 0 });
    const teTr = teRaw.map((t) => ({ r: DRIFTADJ ? t.r - benchR(t, test, mid) : t.r, riskFrac: t.riskFrac }));
    if (SIDESPLIT) {
      const adj = (t: typeof teRaw[number]) => DRIFTADJ ? t.r - benchR(t, test, mid) : t.r;
      const lo = teRaw.filter((t) => t.side === "long"), sh = teRaw.filter((t) => t.side === "short");
      if (lo.length >= 10) { sideAgg.longN += lo.length; sideAgg.longSum += lo.map((t) => netR({ r: adj(t), riskFrac: t.riskFrac })).reduce((a, b) => a + b, 0); }
      if (sh.length >= 10) { sideAgg.shortN += sh.length; sideAgg.shortSum += sh.map((t) => netR({ r: adj(t), riskFrac: t.riskFrac })).reduce((a, b) => a + b, 0); }
    }
    if (teTr.length < MIN_TRADES) { thin++; continue; }
    const testNet = teTr.map(netR);
    const eTe = mean(testNet), sd = sampleStd(testNet) || 1e-9;
    if (eTe <= 0) continue;
    oosPos++;
    const rf = teTr.map((t) => t.riskFrac).sort((a, b) => a - b);
    rows.push({
      sym, key: specKey(s), n: testNet.length, shTest: eTe / sd, tTest: eTe / (sd / Math.sqrt(testNet.length)),
      expTest: eTe, expTrain: eTr, medRiskFrac: rf[Math.floor(rf.length / 2)] ?? 0,
      skew: skewness(testNet), kurt: kurtosis(testNet),
    });
  }
  console.log(`    ${sym.padEnd(12)} done — running totals: ${isPos.toLocaleString()} train-positive, ${oosPos.toLocaleString()} also OOS-positive`);
}

// ---- the ceiling moves with the trials we just spent ----
const prev = await fetch(`${OWNED}/trd_trial_counter?select=id`, { headers: { ...hdr, Prefer: "count=exact", Range: "0-0" } })
  .then((r) => Number(r.headers.get("content-range")?.split("/")[1] ?? 0)).catch(() => 0);
const BASE = Number(Deno.env.get("TRIAL_BASE") || 1531193);
const N = BASE + prev + trials;
const CEIL = Math.sqrt(2 * Math.log(N));

console.log(`\n    trials this run ${trials.toLocaleString()} | thin (<${MIN_TRADES} trades) ${thin.toLocaleString()} | train-positive ${isPos.toLocaleString()} | OOS-positive ${oosPos.toLocaleString()}`);
console.log(`    live trial count N = ${N.toLocaleString()}  ->  noise ceiling sqrt(2 ln N) = ${CEIL.toFixed(3)}`);

if (SIDESPLIT) {
  console.log(`\n    SIDE SPLIT of the train-selected set, out-of-sample:`);
  console.log(`      LONG  trades ${sideAgg.longN.toLocaleString()}  mean R ${(sideAgg.longSum / Math.max(1, sideAgg.longN)).toFixed(4)}`);
  console.log(`      SHORT trades ${sideAgg.shortN.toLocaleString()}  mean R ${(sideAgg.shortSum / Math.max(1, sideAgg.shortN)).toFixed(4)}`);
  console.log(`      If persistence were skill both sides pay; if it is market beta only LONG pays.`);
}
rows.sort((a, b) => b.tTest - a.tTest);
console.log(`\n    top OOS by t (all costed per-trade, all train-selected):`);
console.log(`    ${"symbol".padEnd(11)}${"t".padEnd(8)}${"SR/trade".padEnd(10)}${"E[R]".padEnd(9)}${"n".padEnd(7)}${"medStop%".padEnd(10)}spec`);
for (const r of rows.slice(0, 12)) {
  console.log(`    ${r.sym.padEnd(11)}${r.tTest.toFixed(2).padEnd(8)}${r.shTest.toFixed(3).padEnd(10)}${r.expTest.toFixed(4).padEnd(9)}${String(r.n).padEnd(7)}${(r.medRiskFrac * 100).toFixed(2).padEnd(10)}${r.key}`);
}

const mSh = mean(allSharpes), varSh = allSharpes.reduce((a, x) => a + (x - mSh) ** 2, 0) / Math.max(1, allSharpes.length - 1);
console.log(`    trial-Sharpe dispersion across this search: mean ${mSh.toFixed(3)}, sd ${Math.sqrt(varSh).toFixed(3)} (n=${allSharpes.length.toLocaleString()})`);
const survivors = rows.filter((r) => {
  const p = deflatedSharpe(r.shTest, r.n, r.skew, r.kurt, N, varSh);
  return r.tTest > CEIL && p > 0.95;
});
console.log(`\n    SURVIVORS past the live ceiling (${CEIL.toFixed(2)}) AND deflated-prob>0.95: ${survivors.length}`);
for (const s of survivors) console.log(`      ${s.sym} ${s.key} t=${s.tTest.toFixed(2)} n=${s.n}`);
if (!survivors.length) console.log(`      none — which is the expected and correct outcome at ${N.toLocaleString()} trials.`);
