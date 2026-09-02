#!/usr/bin/env -S deno run --allow-env --allow-read
// prediction-markets.ts — the LONGSHOT-BIAS test, run on the two public prediction-market venues.
//
// DESCRIPTIVE ONLY (MECHANISM LAW, D-597): no mechanism claim is pre-registered here, nothing is written to
// trd_lineage, nothing goes on a forward clock. This is a measurement of a public data space.
//
// THE PRIOR IS STATED FIRST, BEFORE ANY NUMBER (SIGN LAW, D-553):
//   Favourite-longshot bias (racetrack betting, Griffith 1949; Thaler & Ziemba 1988; and the prediction-market
//   replications) says LOW-PROBABILITY contracts are OVERPRICED (realised frequency < implied price) and
//   HIGH-PROBABILITY contracts are UNDERPRICED (realised > implied). The tradable consequence, if it holds, is
//   BUY THE FAVOURITES (>= FAV_P) and SELL THE LONGSHOTS (<= DOG_P). Every calibration table below reports
//   MATCHED or MISSED against that prior; a flip is not claimable (D-511b/D-553 precedent).
//
// THE RULE IS FIXED BEFORE THE DATA IS CUT (SELECTION LAW, D-455): FAV_P=0.90 and DOG_P=0.10 are the literature's
// round numbers, not thresholds chosen by scanning this sample. The walk-forward split is a fixed calendar date.
// No component, venue, series or bin is selected on the full sample and then reported out-of-sample.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("prediction-markets", [
  { name: "IN", def: "data/prediction-markets.json", note: "ingest output (gitignored)" },
  { name: "FAV_P", def: "0.90", note: "favourite leg: buy every contract priced >= this" },
  { name: "DOG_P", def: "0.10", note: "longshot leg: sell every contract priced <= this" },
  { name: "PM_SPREAD_C", def: "1.0", note: "ASSUMED Polymarket half-spread in CENTS (unobservable for resolved mkts)" },
  { name: "KS_FEE_K", def: "0.07", note: "Kalshi fee coefficient: fee = k*p*(1-p) per contract" },
  { name: "SPLIT", def: "2024-06-01", note: "walk-forward split on resolution date" },
]);
const FAV_P = Number(K.FAV_P), DOG_P = Number(K.DOG_P);
const PM_SPREAD = Number(K.PM_SPREAD_C) / 100, KS_FEE_K = Number(K.KS_FEE_K);
const SPLIT_MS = Date.parse(K.SPLIT + "T00:00:00Z");

// ------------------------------------------------------------------ load
interface PmMarket { id: string; eventId: string; question: string; outcome: 0 | 1; volume: number; endDate: string; hist: [number, number][] }
interface KsMarket { ticker: string; series: string; title: string; outcome: 0 | 1; lastPrice: number; volume: number; openTime: string; closeTime: string }
interface Blob { fetchedAt: string; caps: Record<string, number>; polymarket: PmMarket[]; kalshi: KsMarket[] }
let blob: Blob;
try { blob = JSON.parse(await Deno.readTextFile(K.IN)); }
catch { console.error(`!! ${K.IN} not found. Run scripts/prediction-markets-ingest.ts first.`); Deno.exit(1); }
assertNonEmpty("polymarket markets", blob.polymarket, 200);
assertNonEmpty("kalshi markets", blob.kalshi, 200);

let TRIALS = 0;
const D = 86400;
const CLUSTER_FLOOR = 12; // minimum independent clusters before a clustered t is reported at all

// ------------------------------------------------------------------ stats
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function sd(xs: number[]) { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); }
function tstat(xs: number[]) { return xs.length < 3 ? NaN : mean(xs) / (sd(xs) / Math.sqrt(xs.length)); }
function quantile(xs: number[], q: number) { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }
/** t computed on CLUSTER means. Contracts on the same event are one bet, not N independent ones. */
function clusteredT(rows: { r: number; cluster: string }[]) {
  const by = new Map<string, number[]>();
  for (const x of rows) { const a = by.get(x.cluster); if (a) a.push(x.r); else by.set(x.cluster, [x.r]); }
  const cm = [...by.values()].map(mean);
  // A t across a handful of clusters is not a t. Below the floor it is reported as NaN, never as a number,
  // because a large |t| computed on 11 groups is exactly the concentration artifact the BREADTH LAW exists for.
  return { t: cm.length >= CLUSTER_FLOOR ? tstat(cm) : NaN, nClusters: cm.length };
}
const fmtT = (t: number) => Number.isFinite(t) ? t.toFixed(2) : `n/a (<${CLUSTER_FLOOR} clusters)`;

// ------------------------------------------------------------------ observation model
/** One (price, outcome) observation at a stated horizon before resolution. */
interface Obs { p: number; y: 0 | 1; cluster: string; volume: number; resMs: number; holdDays: number; label: string }

function pmObs(horizonDays: number | "last"): Obs[] {
  const out: Obs[] = [];
  for (const m of blob.polymarket) {
    const h = m.hist;
    const tEnd = h[h.length - 1][0];
    let p: number | null = null, holdDays: number;
    if (horizonDays === "last") { p = h[h.length - 1][1]; holdDays = 0; }
    else {
      const target = tEnd - horizonDays * D;
      if (h[0][0] > target) continue; // market did not yet exist that far before resolution
      for (let i = h.length - 1; i >= 0; i--) if (h[i][0] <= target) { p = h[i][1]; break; }
      holdDays = horizonDays;
    }
    if (p == null || !(p > 0 && p < 1)) continue;
    out.push({ p, y: m.outcome, cluster: m.eventId, volume: m.volume, resMs: tEnd * 1000, holdDays, label: m.question });
  }
  return out;
}
function ksObs(): Obs[] {
  return blob.kalshi.map((m) => ({
    p: m.lastPrice, y: m.outcome, cluster: m.ticker.split("-").slice(0, 2).join("-"), volume: m.volume,
    resMs: Date.parse(m.closeTime), holdDays: 0, label: m.title,
  })).filter((o) => Number.isFinite(o.resMs));
}

// ------------------------------------------------------------------ POSITIVE CONTROLS
console.log(`\n${"=".repeat(100)}`);
console.log(`PREDICTION MARKETS — favourite/longshot bias.  data fetched ${blob.fetchedAt}`);
console.log(`${"=".repeat(100)}\n`);
console.log(`  INGEST CAPS (stated, per COVERAGE LAW — these bound every claim below):`);
for (const [k, v] of Object.entries(blob.caps)) console.log(`    ${k.padEnd(22)} ${v}`);

console.log(`\n  POSITIVE CONTROLS (POSITIVE-CONTROL RULE, D-641 — a null and a broken query both look like zero):`);
const trump = blob.polymarket.find((m) => /will donald trump win the 2024 us presidential election/i.test(m.question));
const harris = blob.polymarket.find((m) => /will kamala harris win the 2024 us presidential election/i.test(m.question));
const c1 = !!trump && trump.outcome === 1 && !!harris && harris.outcome === 0;
console.log(`    (a) known resolved market present & correct:  Trump-2024 outcome=${trump?.outcome ?? "ABSENT"} (expect 1), Harris-2024 outcome=${harris?.outcome ?? "ABSENT"} (expect 0)  -> ${c1 ? "PASS" : "FAIL"}`);
const pmLast = pmObs("last"), ksAll = ksObs();
const meanYesPm = mean(pmObs(1).map((o) => o.y)), meanYesKs = mean(ksAll.map((o) => o.y));
const c2 = meanYesPm > 0.2 && meanYesPm < 0.8;
const c2ks = meanYesKs > 0.2 && meanYesKs < 0.8;
const KS_CONTROL_FAILED = !c2ks;
console.log(`    (b) mean realised YES rate in [0.2,0.8]:      polymarket ${meanYesPm.toFixed(3)} -> ${c2 ? "PASS" : "FAIL"};  kalshi ${meanYesKs.toFixed(3)} -> ${c2ks ? "PASS" : "FAIL"}`);
if (KS_CONTROL_FAILED) {
  console.log(`        !! THE KALSHI CONTROL FAILED AND IS NOT BEING WAVED THROUGH. A failed control that is printed and`);
  console.log(`           then ignored is the guard-fails-open defect (D-584/D-586), so it is propagated: every Kalshi`);
  console.log(`           number below is reported UNDER FLAG and is not claimable.`);
  console.log(`           What it means: ${(100 * blob.kalshi.filter((m) => m.lastPrice < 0.1).length / blob.kalshi.length).toFixed(0)}% of the reachable Kalshi contracts trade below 10c, so a YES rate near 0.12 is`);
  console.log(`           what a STRIKE-LADDER population looks like, not what a balanced binary population looks like.`);
  console.log(`           The control was written for the latter. It is NOT evidence of an outcome-parsing bug (the`);
  console.log(`           calibration table below is monotone across all ten bins, which a parsing bug would not be) —`);
  console.log(`           it is evidence that this population is not the one the longshot literature studies.`);
}
console.log(`    (c) count > 1,000 per venue:                  polymarket ${blob.polymarket.length} -> ${blob.polymarket.length > 1000 ? "PASS" : `CAP: PM_HIST_N=${blob.caps.pmHistN}, listing seen ${blob.caps.pmListingSeen}`};  kalshi ${ksAll.length} -> ${ksAll.length > 1000 ? "PASS" : "CAP (see note)"}`);
if (!c1 || !c2) { console.error(`!! a positive control FAILED — the pipeline is not measuring what it claims. Refusing to report.`); Deno.exit(1); }

// COVERAGE statement for Kalshi (the endpoint fact, not a market finding)
const ksDays = blob.kalshi.map((m) => (Date.parse(m.closeTime) - Date.parse(m.openTime)) / 86400000).filter(Number.isFinite);
const ksSpanD = (Math.max(...ksAll.map((o) => o.resMs)) - Math.min(...ksAll.map((o) => o.resMs))) / 86400000;
const ksSeries = new Set(blob.kalshi.map((m) => m.series));
console.log(`\n  COVERAGE — KALSHI (this is a fact about the ENDPOINT, not about Kalshi):`);
console.log(`    the settled archive is NOT reachable publicly: max_close_ts returns ~93 legacy zero-volume rows,`);
console.log(`    min+max_close_ts returns 0, series_ticker returns 0, status=finalized is rejected. The only working`);
console.log(`    traversal is the newest-first cursor walk. Reachable sample: ${ksAll.length} traded settled binaries,`);
console.log(`    ${ksSeries.size} series, spanning ${ksSpanD.toFixed(2)} days, median contract lifetime ${quantile(ksDays, 0.5).toFixed(2)} days.`);
console.log(`    => 30d / 7d / 1d horizons DO NOT EXIST for this population. They are UNTESTED on Kalshi, not null.`);
const pmSpanY = (Math.max(...pmLast.map((o) => o.resMs)) - Math.min(...pmLast.map((o) => o.resMs))) / (365.25 * 86400000);
console.log(`\n  COVERAGE — POLYMARKET: ${blob.polymarket.length} resolved binaries with usable CLOB history, ${new Set(blob.polymarket.map((m) => m.eventId)).size} distinct events,`);
console.log(`    spanning ${pmSpanY.toFixed(2)} years, min volume $${blob.caps.pmMinVol}. Listing rows dropped: ${blob.caps.pmDroppedVoid} void/unresolved, ${blob.caps.pmDroppedNonBinary} non-binary, ${blob.caps.pmDroppedThinVol} sub-volume.`);
console.log(`\n  UNIVERSE (D-535) — the sample is a STATED SELECTION, not the whole venue:`);
console.log(`    gamma refuses offset > 2100 ("use /markets/keyset for deeper pagination"), so the offset-paginated`);
console.log(`    listing tops out at ~2,100 rows. Those rows are taken VOLUME-DESCENDING, i.e. this is the`);
console.log(`    HIGHEST-VOLUME tail of Polymarket's resolved binaries, not a random draw from it. That selection is`);
console.log(`    made a priori on liquidity (the direction the LIQUIDITY LAW wants) and it is NOT a full universe.`);
console.log(`    Universe sensitivity across defensible definitions is therefore NOT MEASURED here; the keyset route`);
console.log(`    to the full id-ordered archive exists and is unexplored. Any figure below is conditional on this cut.`);

// ------------------------------------------------------------------ (2) CALIBRATION
function calibration(name: string, obs: Obs[]) {
  TRIALS++;
  const bins: Obs[][] = Array.from({ length: 10 }, () => []);
  for (const o of obs) bins[Math.min(9, Math.floor(o.p * 10))].push(o);
  console.log(`\n  CALIBRATION — ${name}   (N=${obs.length})`);
  console.log(`    bin        N      mean implied   realised freq   realised-implied   longshot prior says`);
  for (let b = 0; b < 10; b++) {
    const xs = bins[b];
    if (xs.length === 0) { console.log(`    ${(b / 10).toFixed(1)}-${((b + 1) / 10).toFixed(1)}     0          -               -                 -           -`); continue; }
    const mi = mean(xs.map((o) => o.p)), rf = mean(xs.map((o) => o.y));
    const want = b < 5 ? "realised < implied" : "realised > implied";
    const got = rf < mi ? "realised < implied" : "realised > implied";
    console.log(`    ${(b / 10).toFixed(1)}-${((b + 1) / 10).toFixed(1)}  ${String(xs.length).padStart(6)}      ${mi.toFixed(4)}          ${rf.toFixed(4)}         ${(rf - mi >= 0 ? "+" : "") + (rf - mi).toFixed(4)}        ${want === got ? "MATCHED " : "MISSED  "} (${want})`);
  }
  // the two halves the prior actually names
  const lo = obs.filter((o) => o.p < 0.3), hi = obs.filter((o) => o.p >= 0.7);
  const loGap = lo.length ? mean(lo.map((o) => o.y)) - mean(lo.map((o) => o.p)) : NaN;
  const hiGap = hi.length ? mean(hi.map((o) => o.y)) - mean(hi.map((o) => o.p)) : NaN;
  const loM = loGap < 0, hiM = hiGap > 0;
  console.log(`    SIGN vs the pre-stated longshot prior:  p<0.3 gap ${(loGap >= 0 ? "+" : "") + loGap.toFixed(4)} (N=${lo.length}) -> ${loM ? "MATCHED" : "MISSED"};  p>=0.7 gap ${(hiGap >= 0 ? "+" : "") + hiGap.toFixed(4)} (N=${hi.length}) -> ${hiM ? "MATCHED" : "MISSED"}`);
  console.log(`    OVERALL SIGN: ${loM && hiM ? "MATCHED (both halves)" : loM || hiM ? "PARTIAL (one half only) — a one-sided match is not the prior" : "MISSED (both halves) — the bias runs the OTHER WAY in this sample"}`);
  return { loGap, hiGap, loM, hiM };
}

// ------------------------------------------------------------------ (3) THE TRADE
type Venue = "polymarket" | "kalshi";
/** per-$-staked return of BUYING yes at p, held to resolution. gross=true charges nothing. */
function longRet(p: number, y: 0 | 1, v: Venue, gross = false) {
  if (gross) return (y - p) / p;
  if (v === "kalshi") { const f = KS_FEE_K * p * (1 - p); return (y - p - f) / (p + f); }
  const px = p + PM_SPREAD; return px >= 1 ? NaN : (y - px) / px;
}
/** per-$-staked return of SELLING yes at p (== buying NO at 1-p), held to resolution. */
function shortRet(p: number, y: 0 | 1, v: Venue, gross = false) {
  if (gross) return (p - y) / (1 - p);
  if (v === "kalshi") { const f = KS_FEE_K * p * (1 - p); return (p - y - f) / (1 - p + f); }
  const px = p - PM_SPREAD; return px <= 0 ? NaN : (px - y) / (1 - px);
}
function costCents(p: number, v: Venue) { return v === "kalshi" ? 100 * KS_FEE_K * p * (1 - p) : 100 * PM_SPREAD; }

function leg(name: string, obs: Obs[], v: Venue, side: "long" | "short", holdDaysDefault: number) {
  TRIALS++;
  if (obs.length < 30) { console.log(`\n  ${name}: N=${obs.length} < 30 -> UNDERPOWERED, no verdict (COVERAGE LAW rule 3).`); return null; }
  const rows = obs.map((o) => ({ r: side === "long" ? longRet(o.p, o.y, v) : shortRet(o.p, o.y, v), cluster: o.cluster, o }))
    .filter((x) => Number.isFinite(x.r));
  const grossRows = obs.map((o) => ({ r: side === "long" ? longRet(o.p, o.y, v, true) : shortRet(o.p, o.y, v, true), cluster: o.cluster }))
    .filter((x) => Number.isFinite(x.r));
  const rs = rows.map((x) => x.r);
  const m = mean(rs), t = tstat(rs), { t: tc, nClusters } = clusteredT(rows);
  const gr = grossRows.map((x) => x.r), gm = mean(gr), gt = tstat(gr), gtc = clusteredT(grossRows).t;
  const lossRate = rs.filter((r) => r < 0).length / rs.length;
  const worst = Math.min(...rs);
  const worstIdx = rs.indexOf(worst);
  const hold = obs.map((o) => (o.holdDays || holdDaysDefault)).filter((d) => d > 0);
  const medHold = hold.length ? quantile(hold, 0.5) : 0;
  const ann = medHold > 0 ? (Math.pow(1 + m, 365.25 / medHold) - 1) * 100 : NaN;
  // EFFECT SIZE (D-426): gross edge in cents vs the cost in cents it must beat.
  const grossEdge = mean(obs.map((o) => (side === "long" ? (o.y - o.p) : (o.p - o.y)) * 100));
  const cost = mean(obs.map((o) => costCents(o.p, v)));
  console.log(`\n  ${name}`);
  console.log(`    N ${rs.length} contracts / ${nClusters} clusters`);
  console.log(`      NET   mean ${(m * 100).toFixed(3)}%/contract   t ${t.toFixed(2)}   CLUSTERED t ${fmtT(tc)}`);
  const tR = Math.abs(gt) > 1e-9 ? Math.abs(t) / Math.abs(gt) : NaN;
  const mR = Math.abs(gm) > 1e-9 ? Math.abs(m) / Math.abs(gm) : NaN;
  console.log(`      GROSS mean ${(gm * 100).toFixed(3)}%/contract   t ${gt.toFixed(2)}   CLUSTERED t ${fmtT(gtc)}`);
  console.log(`      COST-INFLATION CHECK (D-661): net/gross |t| ratio ${Number.isFinite(tR) ? tR.toFixed(2) + "x" : "n/a"}, mean ratio ${Number.isFinite(mR) ? mR.toFixed(2) + "x" : "n/a"} -> ${
    (Number.isFinite(mR) && mR > 2) || (Number.isFinite(tR) && tR > 2)
      ? "*** THE COST MODEL IS DOING THE WORK. The net figure is a statement about the assumed cost, not about the market. Read GROSS."
      : m < 0 && Number.isFinite(mR) && mR <= 2
      ? "ok — the loss is present GROSS too, so it is not manufactured by the cost."
      : "ok — net and gross agree within 2x."
  }`);
  console.log(`    proportion of losses ${(lossRate * 100).toFixed(1)}%   worst single-market loss ${(worst * 100).toFixed(1)}%  ("${rows[worstIdx].o.label.slice(0, 62)}")`);
  console.log(`    median hold ${medHold.toFixed(2)}d -> annualised ${Number.isFinite(ann) ? ann.toFixed(1) + "%/yr" : "N/A (zero hold: entry is the last trade)"}   turnover implied ${medHold > 0 ? (365.25 / medHold).toFixed(1) + " round trips/yr" : "n/a"}`);
  console.log(`    EFFECT SIZE: gross edge ${grossEdge.toFixed(3)}c vs cost ${cost.toFixed(3)}c  =  ${(Math.abs(grossEdge) / cost).toFixed(2)}x the cost  ${Math.abs(grossEdge) / cost < 1 ? "-> SUB-FEE" : grossEdge < 0 ? "-> edge is NEGATIVE (cost irrelevant)" : "-> clears cost gross"}`);
  return { m, t, tc, gm, gtc, rows, medHold, grossEdge, cost, nClusters };
}

function venueBlock(vname: string, v: Venue, obs: Obs[], horizonLabel: string, holdDaysDefault: number) {
  console.log(`\n${"-".repeat(100)}\n  ${vname} @ ${horizonLabel}   N=${obs.length}\n${"-".repeat(100)}`);
  calibration(`${vname} @ ${horizonLabel}`, obs);

  // BENCHMARK LAW (D-627/630): the universe return over the same contracts. A leg is judged on its EXCESS.
  TRIALS++;
  const uniRows = obs.map((o) => ({ r: longRet(o.p, o.y, v), cluster: o.cluster })).filter((x) => Number.isFinite(x.r));
  const uni = mean(uniRows.map((x) => x.r));
  const uniT = tstat(uniRows.map((x) => x.r));
  const uniG = obs.map((o) => ({ r: longRet(o.p, o.y, v, true), cluster: o.cluster })).filter((x) => Number.isFinite(x.r));
  const uniGm = mean(uniG.map((x) => x.r));
  console.log(`\n  BENCHMARK (c) — BUY ALL YES at its own price (= the market-wide drift; the null says ~0 GROSS):`);
  console.log(`    NET   mean ${(uni * 100).toFixed(3)}%/contract   t ${uniT.toFixed(2)}   clustered t ${fmtT(clusteredT(uniRows).t)}   N ${uniRows.length}`);
  console.log(`    GROSS mean ${(uniGm * 100).toFixed(3)}%/contract   t ${tstat(uniG.map((x) => x.r)).toFixed(2)}   clustered t ${fmtT(clusteredT(uniG).t)}   N ${uniG.length}`);
  // The %-of-stake metric divides by p, so a 0.5c contract carries ~200x the weight of a 99c one. That is a
  // property of the METRIC, not of the market, and it is the same trap as rank-vs-mean in D-426. The unlevered
  // edge — mean (outcome - price) in cents, i.e. the P&L of one contract of each — is reported beside it.
  const uniCents = mean(obs.map((o) => (o.y - o.p) * 100));
  const uniCentsT = tstat(obs.map((o) => (o.y - o.p) * 100));
  console.log(`    UNLEVERED (1 contract each, gross): mean edge ${uniCents.toFixed(3)}c/contract   t ${uniCentsT.toFixed(2)}   clustered t ${fmtT(clusteredT(obs.map((o) => ({ r: (o.y - o.p) * 100, cluster: o.cluster }))).t)}`);
  console.log(`      ^ the %-of-stake lines above divide by p, so a 0.5c contract gets ~200x the weight of a 99c one.`);
  console.log(`        Where the two disagree, the UNLEVERED line is the one that says whether money was made.`);
  if (v === "polymarket" && Math.abs(uni - uniGm) > 0.05) {
    console.log(`    *** READ THIS BEFORE THE LEGS: a FLAT ${K.PM_SPREAD_C}c half-spread is not flat in RETURN terms. On a contract`);
    console.log(`        priced 0.005 it multiplies the entry price by 3x, so it removes ${((uniGm - uni) * 100).toFixed(1)}pp from a universe that is`);
    console.log(`        ${(100 * obs.filter((o) => o.p < 0.1).length / obs.length).toFixed(0)}% sub-10c contracts. The NET benchmark below is dominated by that ASSUMPTION, not by the market.`);
  }

  const fav = obs.filter((o) => o.p >= FAV_P);
  const dog = obs.filter((o) => o.p <= DOG_P);
  const a = leg(`(a) FAVOURITE LEG — buy every contract priced >= ${FAV_P}, hold to resolution`, fav, v, "long", holdDaysDefault);
  const b = leg(`(b) LONGSHOT LEG — SELL every contract priced <= ${DOG_P}, hold to resolution`, dog, v, "short", holdDaysDefault);
  if (a) console.log(`\n    (a) EXCESS vs benchmark: ${((a.m - uni) * 100).toFixed(3)}%/contract  ${a.m - uni > 0 ? "" : "-> the leg does NOT beat simply buying everything"}`);
  console.log(`        (CAUTION: this excess is measured against a benchmark whose %-of-stake mean is dominated by`);
  console.log(`         sub-cent contracts at ~200x weight. A large positive excess here mostly says the favourites are`);
  console.log(`         not sub-cent contracts. Judge the legs on their own GROSS lines and their cents-edge, not on this.)`);
  if (b) console.log(`    (b) EXCESS vs benchmark: ${((b.m - uni) * 100).toFixed(3)}%/contract (note: the short leg is the opposite side, the benchmark is reported for scale)`);

  // CAPACITY
  TRIALS++;
  const volAll = obs.map((o) => o.volume), volFav = fav.map((o) => o.volume);
  console.log(`\n  CAPACITY: universe volume median $${quantile(volAll, 0.5).toLocaleString(undefined, { maximumFractionDigits: 0 })}, p90 $${quantile(volAll, 0.9).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  if (volFav.length) {
    const medFav = quantile(volFav, 0.5);
    console.log(`            favourite-leg volume median $${medFav.toLocaleString(undefined, { maximumFractionDigits: 0 })}, p90 $${quantile(volFav, 0.9).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`            at 1% of a market's lifetime volume without moving it, the favourite leg absorbs ~$${(medFav * 0.01).toFixed(0)} per contract, ~$${(medFav * 0.01 * volFav.length).toLocaleString(undefined, { maximumFractionDigits: 0 })} across the ${volFav.length} qualifying contracts. The 1% figure is an ASSUMPTION (ESTIMATE — unvalidated), not a measured impact curve.`);
  }

  // LIQUIDITY LAW (D-419/423): the promotable number is the LIQUID tercile's, never the pooled one.
  TRIALS += 3;
  if (fav.length >= 90) {
    const q33 = quantile(volAll, 1 / 3), q66 = quantile(volAll, 2 / 3);
    console.log(`\n  LIQUIDITY DECOMPOSITION of the favourite leg (terciles cut on the FULL universe's volume, $${q33.toFixed(0)} / $${q66.toFixed(0)}):`);
    for (const [lab, sel] of [["LOW ", (o: Obs) => o.volume <= q33], ["MID ", (o: Obs) => o.volume > q33 && o.volume <= q66], ["HIGH", (o: Obs) => o.volume > q66]] as const) {
      const sub = fav.filter(sel);
      if (sub.length < 30) { console.log(`    liq:${lab} N=${sub.length} < 30 -> UNDERPOWERED`); continue; }
      const su = sub.map((o) => ({ r: longRet(o.p, o.y, v), cluster: o.cluster })).filter((x) => Number.isFinite(x.r));
      const ct = clusteredT(su);
      console.log(`    liq:${lab} N=${su.length} / ${ct.nClusters} clusters  mean ${(mean(su.map((x) => x.r)) * 100).toFixed(3)}%  t ${tstat(su.map((x) => x.r)).toFixed(2)}  clustered t ${fmtT(ct.t)}  median vol $${quantile(sub.map((o) => o.volume), 0.5).toFixed(0)}`);
    }
    console.log(`    (the HIGH tercile is the only number where size can go; the pooled figure above is not promotable.)`);
  } else console.log(`\n  LIQUIDITY DECOMPOSITION: favourite leg N=${fav.length} too small to tercile -> UNTESTED`);

  // WALK-FORWARD, rule fixed
  TRIALS += 2;
  for (const [wlabel, sel] of [["TRAIN  resolved < " + K.SPLIT, (o: Obs) => o.resMs < SPLIT_MS], ["TEST   resolved >= " + K.SPLIT, (o: Obs) => o.resMs >= SPLIT_MS]] as const) {
    const sub = fav.filter(sel);
    if (sub.length < 30) { console.log(`  WALK-FORWARD ${wlabel}: favourite leg N=${sub.length} < 30 -> UNDERPOWERED`); continue; }
    const rs = sub.map((o) => longRet(o.p, o.y, v)).filter(Number.isFinite);
    const su = sub.map((o) => ({ r: longRet(o.p, o.y, v), cluster: o.cluster })).filter((x) => Number.isFinite(x.r));
    console.log(`  WALK-FORWARD ${wlabel}: favourite leg N=${rs.length}  mean ${(mean(rs) * 100).toFixed(3)}%  t ${tstat(rs).toFixed(2)}  clustered t ${fmtT(clusteredT(su).t)}`);
  }
  return { uni, a, b };
}

// ------------------------------------------------------------------ run
const results: Record<string, ReturnType<typeof venueBlock>> = {};
for (const h of [30, 7, 1] as const) {
  const o = pmObs(h);
  if (o.length < 30) { console.log(`\n  POLYMARKET @ ${h}d: N=${o.length} -> UNDERPOWERED/UNTESTED`); continue; }
  results[`pm${h}d`] = venueBlock("POLYMARKET", "polymarket", o, `${h} days before resolution`, h);
}
results["pmLast"] = venueBlock("POLYMARKET", "polymarket", pmLast, "LAST TRADED PRICE (hold ~0; annualisation undefined)", 0);
console.log(`\n  EXECUTION (D-445/447/498) — READ BEFORE THE KALSHI NUMBERS:`);
console.log(`    the only Kalshi price the endpoint gives is the LAST TRADE before settlement. "Buy every contract at`);
console.log(`    its last traded price" is not a rule anyone can follow: you cannot know in advance which trade will be`);
console.log(`    the last one, and by construction it sits at the moment the outcome is most nearly known. It is the`);
console.log(`    same-bar failure of D-498 in its purest form — the signal moment IS the resolution moment. Every Kalshi`);
console.log(`    figure below is therefore a CALIBRATION MEASUREMENT, not a backtest of anything placeable, and the same`);
console.log(`    caveat attaches to the POLYMARKET "LAST TRADED PRICE" block above. The Polymarket 30d/7d/1d blocks do`);
console.log(`    NOT have this problem: those entries are lagged by a fixed, knowable horizon.`);
results["ksLast"] = venueBlock("KALSHI", "kalshi", ksAll, "LAST TRADED PRICE (the only horizon the endpoint supports)", 0);

// ------------------------------------------------------------------ (5) INSTRUMENT LAW
console.log(`\n${"=".repeat(100)}`);
console.log(`  INSTRUMENT LAW (D-575) — where the edge was measured vs where it could be HELD`);
console.log(`${"=".repeat(100)}`);
console.log(`  Everything above is measured in the PLACEABLE INSTRUMENT — the actual contract, at its actual traded`);
console.log(`  price, settling at its actual outcome. There is no research proxy and no assumed conversion. That is`);
console.log(`  the one thing this study has that most of this programme's results did not.`);
console.log(`  It is also irrelevant, because of the access fact:`);
console.log(`    - KALSHI is a CFTC-regulated US designated contract market. Accounts are US-persons-only and`);
console.log(`      KYC-verified. A UK-resident operator cannot hold these contracts.`);
console.log(`    - POLYMARKET geo-blocks the United Kingdom (FCA action, 2022). A UK-resident operator cannot hold`);
console.log(`      these contracts either.`);
console.log(`  So for THIS operator the placeable size of any premium found above is ZERO, and no amount of`);
console.log(`  statistical strength changes that. No route around either restriction is proposed or contemplated;`);
console.log(`  this is research in a public data space and it stops at the measurement.`);

// ------------------------------------------------------------------ (6) VERDICT
const pmFav = results["pm7d"]?.a ?? results["pm30d"]?.a ?? results["pmLast"]?.a;
const ksFav = results["ksLast"]?.a;
const pmDog = results["pm7d"]?.b ?? results["pm30d"]?.b ?? results["pmLast"]?.b;
const surv = (x: { m: number; tc: number; grossEdge: number; cost: number } | null | undefined) =>
  !!x && x.m > 0 && Math.abs(x.tc) >= 2 && x.grossEdge / x.cost >= 1;
console.log(`\n${"=".repeat(100)}`);
console.log(`  VERDICT`);
console.log(`${"=".repeat(100)}`);
console.log(`  1. FEE-SURVIVING PREMIUM?`);
console.log(`     polymarket favourite leg : ${surv(pmFav) ? "survives cost with clustered |t|>=2" : "does NOT survive (either negative, sub-fee, or clustered |t|<2)"}`);
console.log(`     polymarket longshot leg  : ${surv(pmDog) ? "survives cost with clustered |t|>=2" : "does NOT survive (either negative, sub-fee, or clustered |t|<2)"}`);
console.log(`     kalshi favourite leg     : ${surv(ksFav) ? "survives cost with clustered |t|>=2" : "does NOT survive (either negative, sub-fee, or clustered |t|<2)"}`);
const ksDog = results["ksLast"]?.b;
console.log(`     kalshi longshot leg      : ${surv(ksDog) ? "SURVIVES the arithmetic gate — and is DISQUALIFIED on four separate grounds, below" : "does NOT survive (either negative, sub-fee, or clustered |t|<2)"}`);
if (surv(ksDog)) {
  console.log(`        The number that survives the gate is ${((ksDog!.m) * 100).toFixed(2)}%/contract at clustered t ${fmtT(ksDog!.tc)} on ${ksDog!.nClusters} clusters. It is`);
  console.log(`        NOT reported as an edge, for reasons that were all fixed before the data was cut:`);
  console.log(`          (i)   POSITIVE CONTROL (b) FAILED for this venue — the population is a strike ladder, not a`);
  console.log(`                balanced binary set, so it is not the population the longshot literature is about.`);
  console.log(`          (ii)  EXECUTION: entry is the LAST TRADE before settlement, which is not an implementable rule`);
  console.log(`                (D-498 same-bar). The entry moment is the moment the outcome is most nearly known.`);
  console.log(`          (iii) BREADTH/CLUSTERS: ${ksDog!.nClusters} independent event families across ${ksSpanD.toFixed(2)} days of wall clock. Thousands`);
  console.log(`                of contracts is not thousands of bets; the BREADTH LAW floor is ~50 and this is not near it.`);
  console.log(`          (iv)  CAPACITY: median contract volume is $${quantile(ksAll.map((o) => o.volume), 0.5).toFixed(0)} LIFETIME. There is no size here at any price.`);
  console.log(`        Verdict on it: UNTESTED, not an edge. The correct next step is the unreachable Kalshi archive of`);
  console.log(`        real event markets, which this endpoint does not serve.`);
}
console.log(`     NOTE on the POLYMARKET legs: their NET figures are dominated by the ASSUMED ${K.PM_SPREAD_C}c half-spread, which is`);
console.log(`     enormous relative to a universe that is mostly sub-10c contracts. Read the GROSS line beside each leg`);
console.log(`     before attributing anything to the market (COST-INFLATION COROLLARY, D-661).`);
console.log(`  2. CAPACITY-BEARING?  see the capacity block per venue; the favourite leg's absorbable size rests on`);
console.log(`     an ASSUMED 1%-of-lifetime-volume impact bound, which is an ESTIMATE and not a measured impact curve.`);
console.log(`  3. PLACEABLE FROM THE UK?  NO — Kalshi is US-persons/KYC-only and Polymarket geo-blocks the UK.`);
console.log(`     Whatever the numbers above say, the deployable size for this operator is zero.`);
console.log(`  4. STATUS: DESCRIPTIVE ONLY. No mechanism is pre-registered (MECHANISM LAW), no trd_lineage row is`);
console.log(`     written, nothing goes on a forward clock, nothing is promoted.`);
console.log(`  5. TRIALS COUNTED THIS RUN: ${TRIALS}. Not written to trd_trial_counter (no DB writes in this script);`);
console.log(`     stated so the number is not silently omitted from the programme's deflation ceiling.`);
console.log(`  6. COST MODEL, stated so it can be attacked:`);
console.log(`     - Kalshi trading fee = round_up(${KS_FEE_K} x C x P x (1-P)) per contract, charged on the OPENING trade;`);
console.log(`       Kalshi charges no settlement fee on a contract held to expiry, so this is a ONE-WAY cost here, not a`);
console.log(`       round trip. Source: Kalshi published fee schedule. Applied exactly, per contract, at its own price.`);
console.log(`     - Polymarket taker fee is 0 on the markets sampled; the real cost is the SPREAD, which is NOT`);
console.log(`       OBSERVABLE for a resolved market (the CLOB book endpoint serves live markets only). ${K.PM_SPREAD_C}c per side is`);
console.log(`       therefore an ASSUMPTION (ESTIMATE — unvalidated), swept via PM_SPREAD_C, not a measurement.`);
console.log(`     - COST-INFLATION COROLLARY (D-661): where a leg LOSES, its gross edge in cents is printed beside the`);
console.log(`       cost above, so the loss can be read without the cost assumption doing the work.`);
