#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// forced-selling.ts — "PAID FOR ABSORBING FORCED SELLING": two mechanisms, measured, DESCRIPTIVE ONLY.
//
// The frontier row this closes says: a liquidity provider is compensated for taking the other side of selling that is
// NOT information-driven. Two places that selling is legally/mechanically forced and dated in advance:
//   (A) S&P 500 DELETIONS for "market capitalization changes" — index funds MUST sell at the effective close,
//       regardless of price. The name is demoted, not dead: it keeps trading in the small/mid universe.
//   (B) TAX-LOSS SELLING — US taxable holders realise losses before 31 Dec; the pressure concentrates in the names
//       that are already down, and the deadline is a calendar fact, not an opinion about value.
//
// SIGN PRIORS, STATED BEFORE ANY NUMBER (SIGN LAW, D-553/554):
//   (A) "demotions REBOUND after the forced selling: positive excess at 21-63d."
//   (B) "December losers REBOUND in January: positive excess Dec-15 -> Jan-31."
// Both are two-sided: a measured NEGATIVE excess is a MISS and is reported as such. Neither may be flipped post hoc.
//
// LAWS APPLIED
//  EXECUTION LAW, SAME-BAR COROLLARY (D-498): entry is the first close STRICTLY AFTER the event date. For (A) the
//    effective-date close IS the index funds' selling print and is not a price this strategy could take. For (B) the
//    Dec-15 close is the ranking bar.
//  BENCHMARK LAW (D-627/630/633/636): (A) excess vs IWM (the demoted name's NEW peer set) and vs SPY. (B) excess vs
//    the UNIVERSE MEAN of the same eligible names over the same window, and vs IWM. A raw return here is market drift.
//  LIQUIDITY LAW (D-419/423) + D-634: liquidity terciles/halves reported on BOTH sides, never one.
//  TURNOVER LAW (D-654/656): each construction is exactly ONE round trip per event; drag = 30bp, stated in %/yr terms
//    only where a holding period makes that meaningful.
//  COST-INFLATION COROLLARY (D-661/662): every t below is computed GROSS. Cost is subtracted from the MEAN afterwards
//    and never from the series before the t — charging a losing book manufactures its significance.
//  COVERAGE LAW (D-641/645/646): present/intended stated with the missing cohort's SELECTION MECHANISM named.
//  POSITIVE-CONTROL RULE (D-641): every zero-shaped query carries a control that must return non-zero.
//  BREADTH LAW (D-443): a thin cross-section is UNTESTED, not evidence.
//  MECHANISM LAW (D-597): DESCRIPTIVE ONLY. No pre-registration exists for either mechanism; no causal claim is made.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("forced-selling", [
  { name: "FS_SRC", def: "data/sp500-changes.json", note: "S&P 500 change list (ingest-sp500-changes.ts)" },
  { name: "FS_WINDOWS", def: "5,21,63,250", note: "(A) forward horizons, trading days" },
  { name: "FS_RT_BP", def: "30", note: "round-trip cost in bp, charged ONCE per event" },
  { name: "FS_Y0", def: "2000", note: "(B) first tax-loss year" },
  { name: "FS_Y1", def: "2025", note: "(B) last tax-loss year (needs the following Jan/Feb)" },
  { name: "FS_MIN_DV", def: "1000000", note: "(B) 60d median dollar volume floor" },
  { name: "FS_MIN_PX", def: "5", note: "(B) price floor, kills the sub-$5 microcap rebound artifact" },
  { name: "FS_BATCH", def: "40", note: "symbols per panel request" },
]);
const WINS = K.FS_WINDOWS.split(",").map(Number);
const RT = Number(K.FS_RT_BP) / 100;            // bp -> %
const Y0 = Number(K.FS_Y0), Y1 = Number(K.FS_Y1);
const MIN_DV = Number(K.FS_MIN_DV), MIN_PX = Number(K.FS_MIN_PX), BATCH = Number(K.FS_BATCH);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fs", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => (a.length < 2 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length)));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const pctPos = (a: number[]) => (100 * a.filter((x) => x > 0).length) / a.length;
const f = (x: number, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : "  n/a");

type Bar = number[];
// D-757: strict reads throughout — the hand-rolled retry below was written for exactly this failure (D-756) and is
// now the shared helper, so every read in this file inherits it rather than only the one that got caught.
const { q: sq, qAll } = mkStrictRead(OWNED, hdr);
async function bars(sym: string): Promise<Bar[]> {
  const raw = await sq(`trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`);
  return (raw?.[0]?.bars || []).filter((b: Bar) => b[4] > 0);
}
/** last index whose date <= d, or -1 */
function idxAtOrBefore(dt: string[], d: string): number {
  let lo = 0, hi = dt.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dt[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
/** first index whose date > d (LAG-1 entry), or -1 */
function idxStrictlyAfter(dt: string[], d: string): number {
  let lo = 0, hi = dt.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dt[m] > d) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans;
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

// ---------------------------------------------------------------- benchmarks
const spyB = await bars("SPY"), iwmB = await bars("IWM");
assertNonEmpty("SPY bars", spyB, 1000);
assertNonEmpty("IWM bars", iwmB, 1000);
const spyD = spyB.map((b) => iso(b[0])), iwmD = iwmB.map((b) => iso(b[0]));
const bmAt = (D: string[], B: Bar[]) => (d: string) => { const i = idxAtOrBefore(D, d); return i >= 0 ? B[i][4] : null; };
const spyAt = bmAt(spyD, spyB), iwmAt = bmAt(iwmD, iwmB);
const IWM_START = iwmD[0], SPY_START = spyD[0];

let TRIALS = 0;

// ================================================================= PART A
console.log(`\n${"=".repeat(112)}`);
console.log(`(A)  S&P 500 DELETION REBOUND — forced index-fund selling at the effective close, bought the NEXT close`);
console.log(`${"=".repeat(112)}\n`);
console.log(`  SIGN PRIOR (stated before the numbers): demotions REBOUND after forced selling — POSITIVE excess at 21-63d.`);
console.log(`  This is DESCRIPTIVE ONLY (MECHANISM LAW D-597): no pre-registration exists, so no causal claim is made.\n`);

interface Chg { date: string; added: string | null; removed: string | null; reason: string | null }
const src = JSON.parse(await Deno.readTextFile(K.FS_SRC)) as { source: string; date_span: string[]; changes: Chg[] };
const allRem = src.changes.filter((c) => c.removed && /^[A-Z][A-Z.\-]{0,5}$/.test(c.removed));
// KEEP only the forced-selling case: demotion on size. EXCLUDE acquisition / merger / bankruptcy / redomicile —
// those names stop existing or stop being tradable, and their "excess" would be a delisting artifact, not a rebound.
const isDemotion = (r: string | null) => !!r && /capitali[sz]ation/i.test(r);
const demos = allRem.filter((c) => isDemotion(c.reason));
assertNonEmpty("S&P500 market-cap deletions", demos, 50);
// POSITIVE CONTROL: the complement must be non-empty too, or the reason filter is silently matching everything.
const nonDemos = allRem.filter((c) => !isDemotion(c.reason));
if (nonDemos.length === 0) throw new Error("POSITIVE CONTROL FAILED: reason filter matched every removal — filter is broken");

interface ObsA { sym: string; d0: string; exSpy: number; exIwm: number | null; dv: number }
const resA: ObsA[][] = WINS.map(() => []);
let usedA = 0, noBars = 0, noPost = 0, truncated = 0;
const missing: string[] = [];
for (const ev of demos) {
  const sym = ev.removed!;
  const b = await bars(sym);
  if (!b.length) { noBars++; missing.push(`${sym}@${ev.date.slice(0, 7)}`); continue; }
  const dt = b.map((x) => iso(x[0]));
  const i0 = idxStrictlyAfter(dt, ev.date);                       // LAG-1
  if (i0 < 0) { noPost++; continue; }
  if (dayDiff(ev.date, dt[i0]) > 30) { truncated++; missing.push(`${sym}@${ev.date.slice(0, 7)}`); continue; }
  const p0 = b[i0][4], s0 = spyAt(dt[i0]);
  if (!(p0 > 0) || !s0) { noPost++; continue; }
  const w0 = dt[i0] >= IWM_START ? iwmAt(dt[i0]) : null;
  const pre = b.slice(Math.max(0, i0 - 60), i0).map((x) => x[4] * x[5]).sort((a, z) => a - z);
  const dv = pre.length ? pre[Math.floor(pre.length / 2)] : b[i0][4] * b[i0][5];
  let any = false;
  for (let wi = 0; wi < WINS.length; wi++) {
    const iT = i0 + WINS[wi];
    if (iT >= b.length) continue;                                  // right-censored: neutral, not a zero
    const p1 = b[iT][4], s1 = spyAt(dt[iT]);
    if (!(p1 > 0) || !s1) continue;
    const w1 = w0 && dt[iT] >= IWM_START ? iwmAt(dt[iT]) : null;
    resA[wi].push({
      sym, d0: dt[i0],
      exSpy: ((p1 / p0 - 1) - (s1 / s0 - 1)) * 100,
      exIwm: (w0 && w1) ? ((p1 / p0 - 1) - (w1 / w0 - 1)) * 100 : null,
      dv,
    });
    any = true;
  }
  if (any) usedA++;
}
TRIALS += WINS.length * 2 * 3;   // 4 horizons x {SPY,IWM} x {pooled, liquid tercile, illiquid tercile}
TRIALS += WINS.length * 2;       // era halves

console.log(`  COVERAGE (COVERAGE LAW D-645/646 — present / intended, with the missing cohort's mechanism named)`);
console.log(`    removals in source                     ${allRem.length}   (span ${src.date_span[0]}..${src.date_span[1]})`);
console.log(`    of which "market capitalization" demotions (KEPT)      ${demos.length}`);
console.log(`    of which acquisition/merger/bankruptcy/other (EXCLUDED) ${nonDemos.length}   <- positive control: non-zero`);
console.log(`    demotions with usable panel bars       ${usedA} / ${demos.length}  (${f(100 * usedA / demos.length, 1)}%)`);
console.log(`    no bars at all in trd_bars_deep        ${noBars}`);
console.log(`    panel history starts >30d after event ${truncated}`);
console.log(`    no post-event bar / no benchmark       ${noPost}`);
console.log(`    SELECTION MECHANISM of the missing: a demoted name that later went bankrupt, was taken private, or was`);
console.log(`    acquired out of the small-cap universe leaves no (or a truncated) history in the delisted backfill,`);
console.log(`    which only reaches back to ~2020. The missing cohort is therefore tilted toward the WORST outcomes, so`);
console.log(`    the measured set is biased in FAVOUR of the rebound prior, not against it. This is the single largest`);
console.log(`    caveat on part (A) and it is not repairable with the data held.`);
console.log(`    missing (first 20): ${missing.slice(0, 20).join(" ")}\n`);

function tercileReport(rows: ObsA[], pick: (o: ObsA) => number | null) {
  const ok = rows.filter((r) => pick(r) !== null);
  if (ok.length < 10) return null;
  const s = [...ok].sort((a, b) => a.dv - b.dv);
  const ill = s.slice(0, Math.floor(s.length / 3)).map((x) => pick(x)!);
  const liq = s.slice(Math.floor(s.length * 2 / 3)).map((x) => pick(x)!);
  const all = ok.map((x) => pick(x)!);
  return { all, liq, ill };
}
for (const [label, pick] of [["vs IWM (the demoted name's NEW peer set — the correct benchmark)", (o: ObsA) => o.exIwm],
                             ["vs SPY (the index it LEFT — reported for continuity with the additions study)", (o: ObsA) => o.exSpy]] as const) {
  console.log(`  EXCESS RETURN ${label}   [%; GROSS — cost subtracted separately below, per D-661]`);
  console.log(`    ${"win".padStart(5)} ${"n".padStart(4)} ${"mean%".padStart(8)} ${"med%".padStart(8)} ${"t".padStart(7)} ${"pos%".padStart(6)}  | LIQUID tercile (top 1/3 pre-event $vol)        | ILLIQUID tercile`);
  for (let wi = 0; wi < WINS.length; wi++) {
    const r = tercileReport(resA[wi], pick);
    if (!r) { console.log(`    ${String(WINS[wi]).padStart(5)} ${String(resA[wi].filter((x) => pick(x) !== null).length).padStart(4)}  UNTESTED — n<10`); continue; }
    console.log(
      `    ${String(WINS[wi]).padStart(5)} ${String(r.all.length).padStart(4)} ${f(mean(r.all)).padStart(8)} ${f(med(r.all)).padStart(8)} ${f(tstat(r.all)).padStart(7)} ${f(pctPos(r.all), 0).padStart(6)}  | n=${String(r.liq.length).padStart(3)} mean ${f(mean(r.liq)).padStart(7)} med ${f(med(r.liq)).padStart(7)} t ${f(tstat(r.liq)).padStart(6)} | n=${String(r.ill.length).padStart(3)} mean ${f(mean(r.ill)).padStart(7)} t ${f(tstat(r.ill)).padStart(6)}`,
    );
  }
  console.log("");
}

// era halves (median event date)
const allD0 = resA.flat().map((x) => x.d0).sort();
const split = allD0.length ? allD0[Math.floor(allD0.length / 2)] : "2015-01-01";
console.log(`  ERA HALVES, split at the median event date ${split} (vs IWM where available, else the row says n<10)`);
console.log(`    ${"win".padStart(5)}  ${"EARLY n".padStart(8)} ${"mean%".padStart(8)} ${"t".padStart(7)}   ${"LATE n".padStart(8)} ${"mean%".padStart(8)} ${"t".padStart(7)}`);
for (let wi = 0; wi < WINS.length; wi++) {
  const ok = resA[wi].filter((x) => x.exIwm !== null);
  const e = ok.filter((x) => x.d0 < split).map((x) => x.exIwm!), l = ok.filter((x) => x.d0 >= split).map((x) => x.exIwm!);
  const cell = (a: number[]) => a.length < 10 ? `${String(a.length).padStart(8)} ${"UNTESTED".padStart(8)} ${"".padStart(7)}` : `${String(a.length).padStart(8)} ${f(mean(a)).padStart(8)} ${f(tstat(a)).padStart(7)}`;
  console.log(`    ${String(WINS[wi]).padStart(5)}  ${cell(e)}   ${cell(l)}`);
}

// TURNOVER LAW: exactly one round trip per event.
console.log(`\n  TURNOVER (D-654): this construction is ONE round trip per event — buy at the lag-1 close, sell at the`);
console.log(`  horizon. Drag = ${K.FS_RT_BP}bp = ${f(RT)}% subtracted from every mean above, once, regardless of horizon.`);
console.log(`    ${"win".padStart(5)}  ${"liquid mean vs IWM".padStart(20)} ${"NET of 30bp".padStart(12)}   verdict-relevant?`);
let aBest = { t: 0, w: 0, m: 0 };
for (let wi = 0; wi < WINS.length; wi++) {
  const r = tercileReport(resA[wi], (o) => o.exIwm);
  if (!r) { console.log(`    ${String(WINS[wi]).padStart(5)}  ${"UNTESTED".padStart(20)}`); continue; }
  const m = mean(r.liq), t = tstat(r.liq);
  console.log(`    ${String(WINS[wi]).padStart(5)}  ${f(m).padStart(20)} ${f(m - RT).padStart(12)}   t=${f(t)}  ${Math.abs(t) > 2.5 ? "|t|>2.5" : "|t|<=2.5 -> not significant"}`);
  if (Math.abs(t) > Math.abs(aBest.t)) aBest = { t, w: WINS[wi], m };
}

// SIGN LAW outcome for (A)
const sig2163 = [21, 63].map((w) => { const r = tercileReport(resA[WINS.indexOf(w)] ?? [], (o) => o.exIwm); return r ? { m: mean(r.liq), t: tstat(r.liq) } : null; }).filter((x): x is { m: number; t: number } => !!x);
const aMatched = sig2163.some((x) => x.m > 0 && x.t > 2);
const aMissed = sig2163.some((x) => x.m < 0 && x.t < -2);
console.log(`\n  SIGN LAW OUTCOME (A): prior was "positive excess at 21-63d".`);
console.log(`    ${aMatched ? "MATCHED — a 21/63d liquid-tercile excess is significantly POSITIVE." : aMissed ? "MISSED — a 21/63d liquid-tercile excess is significantly NEGATIVE, the opposite of the prior. A post-hoc flip to a short is NOT claimable (D-511b/D-553)." : "NEITHER — no 21/63d liquid-tercile excess reaches |t|>2, so the prior is neither confirmed nor refuted. Recorded as UNDECIDED, never as support."}`);

console.log(`\n  VERDICT (A): ${(() => {
  const r21 = tercileReport(resA[WINS.indexOf(21)] ?? [], (o) => o.exIwm);
  const r63 = tercileReport(resA[WINS.indexOf(63)] ?? [], (o) => o.exIwm);
  if (!r21 && !r63) return `UNTESTED — fewer than 10 usable demotion events at 21/63d (coverage ${usedA}/${demos.length}). This is a DATA verdict, not a market one (COVERAGE LAW).`;
  const best = [r21, r63].filter(Boolean).map((r) => ({ m: mean(r!.liq), t: tstat(r!.liq), n: r!.liq.length }));
  const win = best.reduce((a, b) => Math.abs(b.t) > Math.abs(a.t) ? b : a);
  if (Math.abs(win.t) <= 2.5) return `NULL / DRIFT — no liquid-tercile horizon clears |t|>2.5 (best |t|=${f(Math.abs(win.t))} on n=${win.n}). Excess over IWM is indistinguishable from small-cap drift; a ${K.FS_RT_BP}bp round trip is charged on top. Coverage is ${usedA}/${demos.length} demotions and the missing cohort is tilted toward the worst outcomes, so this null is if anything OPTIMISTIC.`;
  return `CANDIDATE-SHAPED but NOT promotable — liquid-tercile |t|=${f(Math.abs(win.t))} on n=${win.n} events. Breadth is ${win.n} EVENTS, not names; a single-decade event count this small is UNTESTED as a cross-section (BREADTH LAW), the trial ceiling below is not cleared by an event-study t, and no pre-registration exists. DESCRIPTIVE ONLY.`;
})()}`);

// ================================================================= PART B
console.log(`\n${"=".repeat(112)}`);
console.log(`(B)  TAX-LOSS REBOUND — the Nov-1 -> Dec-15 losers, bought the first close AFTER Dec-15, held to Jan-31 / Feb-28`);
console.log(`${"=".repeat(112)}\n`);
console.log(`  SIGN PRIOR (stated before the numbers): December losers REBOUND in January — POSITIVE excess Dec-15 -> Jan-31.`);
console.log(`  DESCRIPTIVE ONLY (D-597). The unit of observation is the YEAR, not the name: 26 Decembers are 26 draws of the`);
console.log(`  same seasonal event, and pooling name-level returns would count one January as thousands of observations.\n`);

// universe
// D-757: qAll checks its own walk against the server's Content-Range total, so a page that fails mid-walk is an
// exception rather than a short universe. This is the exact read that returned 8,600 of 15,502 (D-756).
const esyms: string[] = (await qAll(`trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol.asc`) as { symbol: string }[]).map((r) => r.symbol);
assertNonEmpty("equity panel symbols", esyms, 1000);
// drop warrants / units / rights / preferreds by suffix convention. This is a HEURISTIC and is stated as one: the
// panel's `equity` class also contains ETFs, which no suffix rule removes. The $vol and price floors reduce but do
// not eliminate them, so (B)'s universe is "liquid US listed instruments", not "liquid US common stocks".
const SUFFIX_JUNK = /(?:^.{3,}(?:W|WS|R|RT|U|P)$)|\.(?:W|U|R)$|-(?:W|U|R)$/;
const cand = esyms.filter((s) => !SUFFIX_JUNK.test(s));

interface YearRec { form: number; hold1: number; hold2: number | null; dv: number }
const perYear = new Map<number, { sym: string; r: YearRec }[]>();
for (let y = Y0; y <= Y1; y++) perYear.set(y, []);
let scanned = 0, withAny = 0;
for (let i = 0; i < cand.length; i += BATCH) {
  const chunk = cand.slice(i, i + BATCH);
  // PRECONDITION LAW (D-598): a swallowed fetch error here silently SHRINKS the universe and changes every number
  // downstream, with no error and no missing-row count. This was observed: one run scanned 15,502 symbols and another
  // 8,600, because the local PostgREST dropped mid-scan and `.catch(() => [])` turned that into an empty batch. Batches
  // now retry and then THROW — a partial panel is UNTESTED, never a quietly different answer.
  const rows = await sq(`trd_bars_deep?symbol=in.(${chunk.map((s) => `"${s}"`).join(",")})&select=symbol,bars`) as { symbol: string; bars: Bar[] }[];
  for (const row of rows) {
    scanned++;
    const b = (row.bars || []).filter((x) => x[4] > 0);
    if (b.length < 120) continue;
    const dt = b.map((x) => iso(x[0]));
    let hit = false;
    for (let y = Y0; y <= Y1; y++) {
      const iNov = idxAtOrBefore(dt, `${y}-11-01`);
      const iDec = idxAtOrBefore(dt, `${y}-12-15`);
      if (iNov < 0 || iDec <= iNov) continue;
      if (dayDiff(dt[iNov], `${y}-11-01`) > 7) continue;      // panel must actually cover Nov-1
      if (dayDiff(dt[iDec], `${y}-12-15`) > 7) continue;
      if (iDec < 60) continue;
      const iE = idxStrictlyAfter(dt, `${y}-12-15`);          // LAG-1 entry
      if (iE < 0 || dayDiff(`${y}-12-15`, dt[iE]) > 7) continue;
      const iJ = idxAtOrBefore(dt, `${y + 1}-01-31`);
      if (iJ <= iE || dayDiff(dt[iJ], `${y + 1}-01-31`) > 7) continue;
      const iF = idxAtOrBefore(dt, `${y + 1}-02-28`);
      const px = b[iDec][4];
      if (!(px >= MIN_PX)) continue;
      const dvs = b.slice(iDec - 59, iDec + 1).map((x) => x[4] * x[5]).sort((a, z) => a - z);
      const dv = dvs[Math.floor(dvs.length / 2)];
      if (!(dv >= MIN_DV)) continue;
      const form = b[iDec][4] / b[iNov][4] - 1;
      const hold1 = b[iJ][4] / b[iE][4] - 1;
      const hold2 = (iF > iE && dayDiff(dt[iF], `${y + 1}-02-28`) <= 7) ? b[iF][4] / b[iE][4] - 1 : null;
      if (!Number.isFinite(form) || !Number.isFinite(hold1)) continue;
      perYear.get(y)!.push({ sym: row.symbol, r: { form, hold1, hold2, dv } });
      hit = true;
    }
    if (hit) withAny++;
  }
}
// POSITIVE CONTROL (D-641): a known-liquid mega cap must be eligible in a mid-panel year, or the filter chain is broken.
const ctrlYear = 2015;
const ctrl = perYear.get(ctrlYear)!.some((x) => x.sym === "AAPL");
if (!ctrl) throw new Error(`POSITIVE CONTROL FAILED: AAPL is not eligible in ${ctrlYear} — the (B) filter chain returns a false zero`);

// IWM benchmark for the same windows
function iwmWin(y: number, to: "jan" | "feb"): number | null {
  const iE = idxStrictlyAfter(iwmD, `${y}-12-15`);
  const iX = idxAtOrBefore(iwmD, to === "jan" ? `${y + 1}-01-31` : `${y + 1}-02-28`);
  if (iE < 0 || iX <= iE) return null;
  return iwmB[iX][4] / iwmB[iE][4] - 1;
}

interface YRow { y: number; n: number; dec: number; uni: number; ex: number; exF: number | null; uniF: number | null; decF: number | null; iwmEx: number | null; exBig: number | null; exSml: number | null }
const yrows: YRow[] = [];
for (let y = Y0; y <= Y1; y++) {
  const xs = perYear.get(y)!;
  if (xs.length < 100) continue;                 // BREADTH LAW: a thin December is UNTESTED, not a data point
  const sorted = [...xs].sort((a, b) => a.r.form - b.r.form);
  const kD = Math.max(5, Math.floor(sorted.length / 10));
  const dec = sorted.slice(0, kD);
  const uni = mean(xs.map((x) => x.r.hold1));
  const decM = mean(dec.map((x) => x.r.hold1));
  const withF = xs.filter((x) => x.r.hold2 !== null);
  const decWithF = dec.filter((x) => x.r.hold2 !== null);
  const uniF = withF.length > 50 ? mean(withF.map((x) => x.r.hold2!)) : null;
  const decF = decWithF.length > 5 ? mean(decWithF.map((x) => x.r.hold2!)) : null;
  // size halves — proxied by DOLLAR VOLUME (no market cap in the panel; stated as a proxy, not as size)
  const bySz = [...xs].sort((a, b) => a.r.dv - b.r.dv);
  const half = Math.floor(bySz.length / 2);
  const halves = [bySz.slice(0, half), bySz.slice(half)];
  const halfEx = halves.map((h) => {
    if (h.length < 60) return null;
    const hs = [...h].sort((a, b) => a.r.form - b.r.form);
    const hd = hs.slice(0, Math.max(5, Math.floor(hs.length / 10)));
    return (mean(hd.map((x) => x.r.hold1)) - mean(h.map((x) => x.r.hold1))) * 100;
  });
  const iw = iwmWin(y, "jan");
  yrows.push({
    y, n: xs.length, dec: decM * 100, uni: uni * 100, ex: (decM - uni) * 100,
    exF: (decF !== null && uniF !== null) ? (decF - uniF) * 100 : null,
    uniF: uniF === null ? null : uniF * 100, decF: decF === null ? null : decF * 100,
    iwmEx: iw === null ? null : (decM - iw) * 100,
    exSml: halfEx[0], exBig: halfEx[1],
  });
}
TRIALS += 2 * 2 + 2 * 2;  // {Jan,Feb} x {universe-mean, IWM} + {Jan} x {small,large} halves + pooled
assertNonEmpty("(B) usable tax-loss years", yrows, 5);
// the scan must have returned a row for (nearly) every requested symbol; a shortfall means silent truncation
if (scanned < cand.length * 0.98) {
  throw new Error(`panel scan returned ${scanned} of ${cand.length} requested symbols — UNTESTED, not a result (PRECONDITION LAW)`);
}

console.log(`  COVERAGE (COVERAGE LAW)`);
console.log(`    equity symbols in panel                     ${esyms.length}`);
console.log(`    after suffix filter (warrants/units/rights) ${cand.length}   (HEURISTIC — ETFs are NOT removed)`);
console.log(`    symbols returned by the panel scan          ${scanned}`);
console.log(`    symbols eligible in >=1 year                ${withAny}`);
console.log(`    years with >=100 eligible names             ${yrows.length} of ${Y1 - Y0 + 1}   (${yrows.length ? `${yrows[0].y}..${yrows[yrows.length - 1].y}` : "none"})`);
console.log(`    positive control: AAPL eligible in ${ctrlYear}        PASS`);
console.log(`    SURVIVORSHIP CAVEAT: the delisted backfill reaches back only to ~2020. Before that, the panel contains`);
console.log(`    (with few exceptions) names that SURVIVED to the present. A December-loser portfolio is precisely the`);
console.log(`    cohort most likely to have died, so the pre-2020 excess is measured on the winners among the losers and`);
console.log(`    is biased UPWARD. Treat any positive pre-2020 number as an upper bound, not a measurement.\n`);

console.log(`  PER-YEAR (bottom decile by Nov-1 -> Dec-15 return; entry = first close after Dec-15, LAG-1; GROSS)`);
console.log(`    ${"year".padStart(5)} ${"n".padStart(5)} ${"decile%".padStart(9)} ${"univ%".padStart(8)} ${"EXCESS%".padStart(9)} ${"vsIWM%".padStart(8)} | ${"Feb ex%".padStart(8)} | ${"lowDV ex%".padStart(10)} ${"hiDV ex%".padStart(9)}`);
for (const r of yrows) {
  console.log(`    ${String(r.y).padStart(5)} ${String(r.n).padStart(5)} ${f(r.dec).padStart(9)} ${f(r.uni).padStart(8)} ${f(r.ex).padStart(9)} ${(r.iwmEx === null ? "n/a" : f(r.iwmEx)).padStart(8)} | ${(r.exF === null ? "n/a" : f(r.exF)).padStart(8)} | ${(r.exSml === null ? "n/a" : f(r.exSml)).padStart(10)} ${(r.exBig === null ? "n/a" : f(r.exBig)).padStart(9)}`);
}

const exs = yrows.map((r) => r.ex);
const exFs = yrows.filter((r) => r.exF !== null).map((r) => r.exF!);
const iwmExs = yrows.filter((r) => r.iwmEx !== null).map((r) => r.iwmEx!);
const smls = yrows.filter((r) => r.exSml !== null).map((r) => r.exSml!);
const bigs = yrows.filter((r) => r.exBig !== null).map((r) => r.exBig!);
console.log(`\n  POOLED, CLUSTERED BY YEAR (the honest unit — N is YEARS, not name-years; GROSS, per D-661)`);
const line = (lbl: string, a: number[]) => a.length < 3
  ? `    ${lbl.padEnd(44)} UNTESTED — fewer than 3 years`
  : `    ${lbl.padEnd(44)} mean ${f(mean(a)).padStart(7)}%  med ${f(med(a)).padStart(7)}%  t ${f(tstat(a)).padStart(6)}  N=${String(a.length).padStart(2)} years  pos ${f(pctPos(a), 0).padStart(3)}%`;
console.log(line("excess vs UNIVERSE MEAN, Dec15->Jan31", exs));
console.log(line("excess vs UNIVERSE MEAN, Dec15->Feb28", exFs));
console.log(line("excess vs IWM,            Dec15->Jan31", iwmExs));
console.log(line("excess, LOW-$vol half (small proxy)", smls));
console.log(line("excess, HIGH-$vol half (large proxy)", bigs));
// D-590 shape: a pooled mean must state its disaggregation. One December (2000) can carry this whole statistic.
{
  const worst = exs.reduce((a, b, i) => Math.abs(b - mean(exs)) > Math.abs(exs[a] - mean(exs)) ? i : a, 0);
  const drop = exs.filter((_, i) => i !== worst);
  console.log(`\n  POOLED-STATISTIC DISAGGREGATION (the D-590 shape — a pooled number must say what carries it):`);
  console.log(`    single most influential year: ${yrows[worst].y} at ${f(exs[worst])}% excess.`);
  console.log(`    leave-that-year-out: mean ${f(mean(drop))}%  t ${f(tstat(drop))}  N=${drop.length} years  <- if this collapses, the`);
  console.log(`    headline was one December, not a seasonal effect. The MEDIAN (${f(med(exs))}%) is the outlier-robust reading.`);
}
console.log(`\n  BENCHMARK LAW note: the universe mean over the SAME window is printed per year above (column "univ%"), so`);
console.log(`  the excess column is not January drift. Mean universe Jan return over the ${yrows.length} years: ${f(mean(yrows.map((r) => r.uni)))}%.`);
console.log(`  LIQUIDITY LAW / D-634: BOTH halves are measured and printed — the low-$vol half is not inferred from the`);
console.log(`  pooled number, which is the specific error D-634 exists to stop.`);
console.log(`\n  TURNOVER + COST (D-654): one round trip per year, ${K.FS_RT_BP}bp. Held ~31 trading days, so the drag is`);
console.log(`  ${f(RT)}% per event = ${f(RT * (252 / 31))}%/yr if the capital were recycled at this frequency, but it is not —`);
console.log(`  the trade exists once a year, so the honest statement is ${f(RT)}% off the annual excess:`);
console.log(`    NET excess vs universe, Jan31: ${f(mean(exs) - RT)}%  (gross ${f(mean(exs))}%)`);
console.log(`    NET excess vs universe, Feb28: ${exFs.length ? f(mean(exFs) - RT) : "n/a"}%  (gross ${exFs.length ? f(mean(exFs)) : "n/a"}%)`);
console.log(`  A once-a-year 1-month trade also has an OPPORTUNITY-COST shape no cost model captures: 11/12 of the year`);
console.log(`  the capital is idle, so an annualised Sharpe on it would be a fiction and is deliberately not computed.`);

const bT = tstat(exs), bM = mean(exs);
console.log(`\n  SIGN LAW OUTCOME (B): prior was "December losers rebound in January" (positive excess).`);
console.log(`    ${bM > 0 && bT > 2 ? "MATCHED — the year-clustered excess is significantly POSITIVE." : bM < 0 && bT < -2 ? "MISSED — the year-clustered excess is significantly NEGATIVE. A post-hoc flip to shorting December losers is NOT claimable." : `NEITHER — |t|=${f(Math.abs(bT))} on N=${exs.length} years does not reach 2. Prior neither confirmed nor refuted; recorded UNDECIDED.`}`);

console.log(`\n  VERDICT (B): ${
  exs.length < 10
    ? `UNTESTED — only ${exs.length} usable years. With a year-clustered t, N is the number of Decembers; fewer than 10 cannot resolve a 1-2%/event effect.`
    : Math.abs(bT) <= 2
    ? `NULL / UNDECIDED — year-clustered excess ${f(bM)}%/event, t ${f(bT)} on N=${exs.length} years, positive in ${f(pctPos(exs), 0)}% of them. Net of ${K.FS_RT_BP}bp: ${f(bM - RT)}%. Not distinguishable from zero at the only unit of observation that is not pseudo-replicated, and the pre-2020 half of the sample is survivorship-inflated upward.`
    : bM > 0
    ? `POSITIVE at the year level — ${f(bM)}%/event, t ${f(bT)}, N=${exs.length} years, positive in ${f(pctPos(exs), 0)}%. NOT promotable: (i) survivorship inflates every pre-2020 year and the effect must be re-measured on the 2020+ delisting-complete subsample before it means anything; (ii) N=${exs.length} years is a small sample for a t; (iii) DESCRIPTIVE ONLY — no pre-registration. Record as a LEAD requiring a survivorship-clean re-test, not as an edge.`
    : `NEGATIVE at the year level — ${f(bM)}%/event, t ${f(bT)}, N=${exs.length} years. December losers UNDERPERFORM the universe into January in this panel. The prior MISSED; the flip is not claimable.`
}`);

// 2020+ survivorship-clean subsample, printed regardless of the verdict above
const post = yrows.filter((r) => r.y >= 2020).map((r) => r.ex);
console.log(`\n  SURVIVORSHIP-CLEAN SUBSAMPLE (2020+, where the delisted backfill exists):`);
console.log(post.length < 3 ? `    UNTESTED — ${post.length} years` : `    mean ${f(mean(post))}%  t ${f(tstat(post))}  N=${post.length} years  pos ${f(pctPos(post), 0)}%   <- this is the number to believe, and it is underpowered`);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "forced-selling", runId: `fs|${WINS.join(",")}|${Y0}-${Y1}|${K.FS_MIN_DV}`, spent: TRIALS });
console.log(`\n  TRIALS: this run spent ${TRIALS} (A: ${WINS.length * 2 * 3 + WINS.length * 2}, B: 8). Counter ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`  Neither part clears that ceiling and neither is claimed to. BOTH VERDICTS ARE DESCRIPTIVE ONLY.\n`);
