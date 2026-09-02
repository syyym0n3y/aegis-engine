#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// vix-roll.ts — THE EQUITY VARIANCE PREMIUM, MEASURED IN THE INSTRUMENT THAT WOULD HOLD IT (VX futures).
//
// WHY THIS SCRIPT EXISTS (INSTRUMENT LAW, D-575). The equity VRP has been "verified" in research space repeatedly and
// then died the moment a placeable wrapper was measured: D-574 took a crypto variance premium at t 3.76 down to
// t 1.18 naked / 0.42 delta-hedged in a straddle. The equity VRP has never been measured in ITS OWN placeable
// instrument. That instrument is the VIX future — CFE-listed, retail-accessible, /VXM micro for small accounts —
// and short-front-VX-in-contango is the most documented retail vol-premium trade there is. It also blew a
// $1.9bn ETP (XIV) to zero in one afternoon on 2018-02-05. So: measure it IN the instrument, WITH the tail.
//
// INSTRUMENT: PLACEABLE (CFE VX futures; /VXM micro = 1/10 notional). Not a proxy. No conversion assumed.
//
// DATA: data/vx-contracts.json, one file per expiry from the CBOE CDN (scripts/ingest-vx-curve.ts). Price =
// Settle where present, else Close (pre-2016 files carry Settle=0 on every row — measured, not assumed).
//
// CURVE / ROLL RULE (stated, D-742 discipline): on each trade date the MONTHLY contracts with expiry > that date are
// ordered by expiry; c1 = nearest, c2 = next. A contract stops being c1 the day AFTER its expiry (we hold through
// the settlement print, as SVXY/XIV did). Weekly contracts are ingested and MARKED but are EXCLUDED from the curve:
// mixing weeklies into the c1/c2 ordering silently shortens the constant-maturity tenor.
//
// P&L: futures are unfunded. Daily gross P&L in VIX POINTS per contract = -(px[t] - px[t-1]) for a short. Notional
// per contract = px * $1000 ($100 multiplier on VX... CFE VX multiplier is $1000 per index point). Return is
// expressed as % of the FULLY-COLLATERALISED notional (= px_{t-1} * 1000), i.e. 1 contract backed by its full
// notional in cash. Margin is ASSUMED, not measured: CFE initial margin on VX has run ~20-40% of notional; the ruin
// check uses 25%.
//
// LAWS OBSERVED: EXECUTION (B is lag-1: signal at close t, position from close t+1; A and C are held positions with
// no timing signal, so no lag applies and this is stated rather than assumed). COST-INFLATION (gross t printed beside
// every net t; these books MAKE money gross, so cost REDUCES |t| — conservative, but reported both ways regardless).
// TURNOVER (drag = turnover x periods x round-trip cost, stated in $ per contract, not bp-without-frequency).
// HOLDABILITY (longest time underwater, incl. the 2018 and 2020 recoveries). BENCHMARK (SPY over the same span).
// BREADTH/UNIVERSE: N/A — a SINGLE-INSTRUMENT time-series test, one curve. No cross-section is claimed.
// POSITIVE-CONTROL: the data is checked against two facts known independently of this script before anything is
// computed, and the script exits RED if either fails.
//
// DESCRIPTIVE ONLY — no mechanism pre-registered, no lineage row, no gate clearance, no forward clock.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("vix-roll", [
  { name: "VX_TICKS_RT", def: "2", note: "ticks charged per round trip (1 tick spread + 1 tick slippage); VX tick = $50" },
  { name: "VX_MARGIN", def: "0.25", note: "ASSUMED initial margin as fraction of notional (CFE VX ~20-40%)" },
  { name: "VX_MULT", def: "1000", note: "CFE VX contract multiplier, $ per index point" },
]);
const TICKS_RT = Number(Deno.env.get("VX_TICKS_RT") || "2");
const MARGIN = Number(Deno.env.get("VX_MARGIN") || "0.25");
const MULT = Number(Deno.env.get("VX_MULT") || "1000");
const TICK_$ = 50; // CFE VX minimum tick 0.05 index points x $1000 = $50
const COST_RT_$ = TICKS_RT * TICK_$;

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET") || "";
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "vxroll", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

// ---------------------------------------------------------------- load contracts
type Row = { d: string; px: number; vol: number; oi: number };
type Contract = { expiry: string; monthly: boolean; label: string; rows: Row[] };
const path = new URL("../data/vx-contracts.json", import.meta.url).pathname;
const raw = JSON.parse(await Deno.readTextFile(path)) as { fetched: string; contracts: Contract[] };
const st = await Deno.stat(path);
const ageH = (Date.now() - (st.mtime?.getTime() ?? 0)) / 3.6e6;
const all = raw.contracts;
assertNonEmpty("vx contracts", all, 100);
const mon = all.filter((c) => c.monthly);
assertNonEmpty("vx MONTHLY contracts", mon, 100);

console.log(`==> SHORT VIX FUTURES — the equity variance premium in its PLACEABLE instrument (CFE VX; /VXM micro exists)`);
console.log(`    data/vx-contracts.json fetched ${raw.fetched} (${ageH.toFixed(1)}h old)`);
console.log(`    contracts ${all.length} total: MONTHLY ${mon.length} used for the curve, WEEKLY/other ${all.length - mon.length} ingested and EXCLUDED\n`);

// per trade date, the ordered monthly curve
const byDate = new Map<string, { expiry: string; px: number; vol: number; oi: number }[]>();
for (const c of mon) {
  for (const r of c.rows) {
    if (r.d > c.expiry) continue; // a quote after its own expiry is a data artifact; dropped
    const a = byDate.get(r.d) || []; a.push({ expiry: c.expiry, px: r.px, vol: r.vol, oi: r.oi }); byDate.set(r.d, a);
  }
}
const dates = [...byDate.keys()].sort();
for (const d of dates) byDate.get(d)!.sort((a, b) => a.expiry < b.expiry ? -1 : 1);
// ROLL RULE: c1 = nearest monthly whose expiry >= trade date (held THROUGH the settlement print); c2 = the next.
type Day = { d: string; e1: string; c1: number; e2: string; c2: number; dte1: number; dte2: number };
const curve: Day[] = [];
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
for (const d of dates) {
  const ord = byDate.get(d)!.filter((x) => x.expiry >= d);
  if (ord.length < 2) continue;
  curve.push({ d, e1: ord[0].expiry, c1: ord[0].px, e2: ord[1].expiry, c2: ord[1].px, dte1: dayDiff(d, ord[0].expiry), dte2: dayDiff(d, ord[1].expiry) });
}
assertNonEmpty("daily curve", curve, 1000);

// ---------------------------------------------------------------- POSITIVE CONTROLS (must pass or exit RED)
// (facts known independently of this script: VX front settled far above 40 in the 2020-03 crash with the curve
//  BACKWARDATED; and the curve was in CONTANGO on a quiet 2017 day. A control that can only pass is worthless, so
//  each is a two-sided numeric check on a specific date.)
const at = (d: string) => curve.find((x) => x.d === d);
const pc1 = at("2020-03-16"), pc2 = at("2017-06-15");
let redFail = "";
if (!pc1) redFail = "POSITIVE CONTROL FAILED: no curve row for 2020-03-16";
else if (!(pc1.c1 > 40)) redFail = `POSITIVE CONTROL FAILED: 2020-03-16 front settle ${pc1.c1} is not > 40`;
else if (!(pc1.c1 > pc1.c2)) redFail = `POSITIVE CONTROL FAILED: 2020-03-16 not backwardated (c1 ${pc1.c1} <= c2 ${pc1.c2})`;
else if (!pc2) redFail = "POSITIVE CONTROL FAILED: no curve row for 2017-06-15";
else if (!(pc2.c2 > pc2.c1)) redFail = `POSITIVE CONTROL FAILED: 2017-06-15 not in contango (c1 ${pc2.c1} >= c2 ${pc2.c2})`;
if (redFail) { console.log(`\n  RED — ${redFail}`); Deno.exit(1); }
console.log(`  POSITIVE CONTROL PASS:  2020-03-16 c1 ${pc1!.c1.toFixed(2)} > 40 and BACKWARDATED (c2 ${pc1!.c2.toFixed(2)})  |  2017-06-15 CONTANGO (c1 ${pc2!.c1.toFixed(2)} < c2 ${pc2!.c2.toFixed(2)})`);
const pctContango = curve.filter((x) => x.c2 > x.c1).length / curve.length * 100;
console.log(`  CURVE  ${curve.length} trading days  ${curve[0].d} .. ${curve[curve.length - 1].d}   in contango ${pctContango.toFixed(1)}% of days\n`);

// ---------------------------------------------------------------- stats helpers
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
function stats(x: number[]) {
  const n = x.length, m = mean(x);
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return { n, mean: m, sd, t: m / (sd / Math.sqrt(n)), sr: (m / sd) * Math.sqrt(252), ann: m * 252 * 100 };
}
function drawdown(rets: number[], ds: string[]) {
  // compounded equity from daily simple returns on collateral
  let eq = 1, peak = 1, worst = 0, longest = 0, cur = 0, worstDay = 0, worstDayD = "", peakD = ds[0] || "", uwStart = "", worstUwStart = "", worstUwEnd = "";
  let ruinedOn = "";
  for (let i = 0; i < rets.length; i++) {
    if (rets[i] < worstDay) { worstDay = rets[i]; worstDayD = ds[i]; }
    // RUIN IS ABSORBING. A daily return past -100% on a 1x fully-collateralised short takes equity to zero or below;
    // compounding through it produces a negative "equity" and a nonsense drawdown past -100% (the exact defect
    // agent-output-guard exists to catch). Stop the curve at ruin and report it.
    if (!ruinedOn && (1 + rets[i]) <= 0) { ruinedOn = ds[i]; worst = -1; eq = 0; break; }
    eq *= (1 + rets[i]);
    if (eq >= peak) { peak = eq; peakD = ds[i]; cur = 0; uwStart = ""; }
    else {
      if (!uwStart) uwStart = peakD;
      cur++;
      if (cur > longest) { longest = cur; worstUwStart = uwStart; worstUwEnd = ds[i]; }
      const dd = eq / peak - 1; if (dd < worst) worst = dd;
    }
  }
  return { eq, worst, longest, worstDay, worstDayD, worstUwStart, worstUwEnd, underwaterAtEnd: cur, ruinedOn };
}
const fmtY = (n: number) => `${(n / 252).toFixed(1)}y`;

// ---------------------------------------------------------------- SPY benchmark over the same span
let spyLine = "  BENCHMARK SPY: UNAVAILABLE (trd_bars_deep unreachable) — stated, not silently skipped";
try {
  const t = await jwt();
  const hdr = { Authorization: `Bearer ${t}`, apikey: t };
  const row = (await fetch(`${OWNED}/trd_bars_deep?symbol=eq.SPY&select=bars`, { headers: hdr }).then((r) => r.json()))[0] as { bars: number[][] } | undefined;
  const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const b = (row?.bars || []).filter((x) => x[4] > 0 && iso(x[0]) >= curve[0].d && iso(x[0]) <= curve[curve.length - 1].d);
  if (b.length > 500) {
    const r: number[] = [], ds: string[] = [];
    for (let i = 1; i < b.length; i++) { r.push(b[i][4] / b[i - 1][4] - 1); ds.push(iso(b[i][0])); }
    const s = stats(r), dd = drawdown(r, ds);
    spyLine = `  BENCHMARK SPY same span (${ds[0]} .. ${ds[ds.length - 1]}, N ${s.n}): ${s.ann.toFixed(2)}%/yr  SR ${s.sr.toFixed(2)}  t ${s.t.toFixed(2)}  worst day ${(dd.worstDay * 100).toFixed(1)}%  maxDD ${(dd.worst * 100).toFixed(1)}%  longest underwater ${dd.longest}d (${fmtY(dd.longest)})`;
  } else spyLine = `  BENCHMARK SPY: only ${b.length} bars in span — UNTESTED, not skipped`;
} catch (_e) { /* spyLine already states unavailable */ }

// ---------------------------------------------------------------- strategies
type Strat = { name: string; desc: string; rets: number[]; ds: string[]; turnoverContracts: number; costPerDay$: number[]; notional: number[] };

// (A) short constant-maturity 1-month VX — the SVXY/XIV construction. Weights w1 = dte1/(dte1_at_roll), i.e. the
// standard S&P 500 VIX Short-Term Futures Index weighting: w1 = dr/dt, w2 = 1 - w1 where dr = business days
// remaining to c1 expiry and dt = business days in the roll period. Daily rebalanced -> daily turnover = |dw|.
function constantMaturity(): Strat {
  const rets: number[] = [], ds: string[] = [], cost: number[] = [], notl: number[] = [];
  let turn = 0;
  const bdays = (a: string, b: string) => { let n = 0; const d = new Date(a + "T00:00:00Z"); while (iso2(d) < b) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; } return n; };
  const iso2 = (d: Date) => d.toISOString().slice(0, 10);
  let prevW1 = 0;
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i - 1], c = curve[i];
    // weights set at close of day i-1, P&L earned day i (a held position, no signal -> no lag question; stated)
    const dr = bdays(p.d, p.e1), dt = bdays(prevRollStart(i - 1), p.e1) || 1;
    const w1 = Math.max(0, Math.min(1, dt > 0 ? dr / dt : 0)), w2 = 1 - w1;
    // the two legs must be the SAME contracts on both days, else the return is a roll jump, not a P&L
    const c1n = sameContract(c, p.e1), c2n = sameContract(c, p.e2);
    // On the expiry day the constant-maturity weight on c1 is exactly 0, so c1 having vanished the next day is not a
    // missing observation — the position is entirely in c2 and its P&L is fully measurable. Dropping those ~165 days
    // (one per roll) would silently delete a day of held return per month.
    if (c2n == null || (c1n == null && w1 > 0)) { prevW1 = w1; continue; }
    const notional = (w1 * p.c1 + w2 * p.c2) * MULT;
    const pnl$ = -MULT * ((c1n == null ? 0 : w1 * (c1n - p.c1)) + w2 * (c2n - p.c2)); // SHORT
    rets.push(pnl$ / notional); ds.push(c.d); notl.push(notional);
    const dw = Math.abs(w1 - prevW1); turn += dw; cost.push(dw * COST_RT_$);
    prevW1 = w1;
  }
  return { name: "A", desc: "short constant-maturity 1-month VX (SVXY/XIV construction, daily rebalanced)", rets, ds, turnoverContracts: turn, costPerDay$: cost, notional: notl };
}
function prevRollStart(i: number): string {
  // start of the current roll period = the day after the previous monthly expiry (= the day c1 became c1)
  const e1 = curve[i].e1;
  for (let j = i; j >= 1; j--) if (curve[j - 1].e1 !== e1) return curve[j].d;
  return curve[0].d;
}
function sameContract(day: Day, expiry: string): number | null {
  const ord = byDate.get(day.d) || [];
  const f = ord.find((x) => x.expiry === expiry);
  return f ? f.px : null;
}

// (B) short c1 ONLY when contango (c2 > c1) at close t, position held from close t+1 -> t+2. LAG-1, explicit.
function timedFront(): Strat {
  const rets: number[] = [], ds: string[] = [], cost: number[] = [], notl: number[] = [];
  let turn = 0, prevPos = 0;
  for (let i = 2; i < curve.length; i++) {
    const sig = curve[i - 2];                     // signal observed at close t
    const p = curve[i - 1], c = curve[i];         // position entered at close t+1, P&L over t+1 -> t+2
    const pos = sig.c2 > sig.c1 ? -1 : 0;         // short when contango, else FLAT
    const px = sameContract(c, p.e1);
    const notional = p.c1 * MULT;
    if (px == null) { rets.push(0); ds.push(c.d); notl.push(notional); cost.push(0); continue; }
    rets.push(pos * MULT * (px - p.c1) / notional);
    ds.push(c.d); notl.push(notional);
    const dq = Math.abs(pos - prevPos); turn += dq; cost.push(dq * COST_RT_$ / 2); // half a round trip per unit changed
    prevPos = pos;
  }
  return { name: "B", desc: "short front VX only when contango (c2>c1), else flat — LAG-1 (signal close t, position from close t+1)", rets, ds, turnoverContracts: turn, costPerDay$: cost, notional: notl };
}

// (C) short the c1-c2 calendar spread: short c1 / long c2, one contract each, held (rolled at expiry).
function calendar(): Strat {
  const rets: number[] = [], ds: string[] = [], cost: number[] = [], notl: number[] = [];
  let turn = 0, pending$ = 0;
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i - 1], c = curve[i];
    const a = sameContract(c, p.e1), b = sameContract(c, p.e2);
    // A roll day is exactly the day the front contract stops quoting, so its same-contract return is unmeasurable —
    // but the ROLL COST is incurred there and must not vanish with the day. It is accrued and charged on the next
    // measurable day. (Charging zero because the return was skipped is how a cost model quietly becomes free.)
    if (a == null || b == null) { turn += 2; pending$ += 2 * COST_RT_$; continue; }
    const notional = (p.c1 + p.c2) * MULT;  // fully collateralised on BOTH legs (pessimistic)
    rets.push(MULT * (-(a - p.c1) + (b - p.c2)) / notional);
    ds.push(c.d); notl.push(notional);
    if (p.e1 !== c.e1) { turn += 2; pending$ += 2 * COST_RT_$; }
    cost.push(pending$); pending$ = 0;
  }
  return { name: "C", desc: "short the c1-c2 calendar spread (short front / long second), rolled at expiry", rets, ds, turnoverContracts: turn, costPerDay$: cost, notional: notl };
}

// ---------------------------------------------------------------- report
const XIV_DAY = "2018-02-05";
const strategies = [constantMaturity(), timedFront(), calendar()];
const TRIALS = strategies.length;
const verdicts: string[] = [];

for (const s of strategies) {
  assertNonEmpty(`strategy ${s.name} returns`, s.rets, 500);
  const g = stats(s.rets);
  const dd = drawdown(s.rets, s.ds);
  // cost drag: $ per contract per day / notional -> daily return drag; annualised
  const dragDaily = s.costPerDay$.map((c, i) => c / s.notional[i]);
  const dragAnn = mean(dragDaily) * 252 * 100;
  const net = s.rets.map((r, i) => r - dragDaily[i]);
  const nst = stats(net);
  const ndd = drawdown(net, s.ds);
  const turnPerYear = s.turnoverContracts / s.rets.length * 252;

  // XIV day
  const xi = s.ds.indexOf(XIV_DAY);
  const xivRet = xi >= 0 ? s.rets[xi] : NaN;
  // RUIN check at assumed margin
  const marginRets = s.rets.map((r) => r / MARGIN);
  const worstMargin = Math.min(...marginRets);
  const ruinDays = s.ds.filter((_, i) => marginRets[i] <= -1);
  // eras: pre / post the XIV event
  const preI = s.ds.map((d, i) => d < XIV_DAY ? i : -1).filter((i) => i >= 0);
  const postI = s.ds.map((d, i) => d >= XIV_DAY ? i : -1).filter((i) => i >= 0);
  const pre = preI.length > 60 ? stats(preI.map((i) => s.rets[i])) : null;
  const post = postI.length > 60 ? stats(postI.map((i) => s.rets[i])) : null;

  console.log(`  ── STRATEGY ${s.name}: ${s.desc}`);
  console.log(`     INSTRUMENT: PLACEABLE (CFE VX futures; /VXM micro = 1/10 notional). Not a research proxy; no conversion assumed.`);
  console.log(`     N ${g.n} days  ${s.ds[0]} .. ${s.ds[s.ds.length - 1]}`);
  console.log(`     GROSS  ${g.ann.toFixed(2)}%/yr on full collateral   SR ${g.sr.toFixed(2)}   gross t ${g.t.toFixed(2)}`);
  console.log(`     TURNOVER ${turnPerYear.toFixed(1)} contract-units/yr  @ ${TICKS_RT} ticks RT ($${COST_RT_$}/RT; VX tick $50 = 0.05 pts x $1000)`);
  console.log(`     COST DRAG ${dragAnn.toFixed(2)}%/yr  ->  NET ${nst.ann.toFixed(2)}%/yr  SR ${nst.sr.toFixed(2)}  net t ${nst.t.toFixed(2)}   [COST-INFLATION: gross t ${g.t.toFixed(2)} printed beside it; this book is ${g.ann > 0 ? "POSITIVE gross, so cost REDUCES |t| — conservative" : "NEGATIVE gross, so the cost is NOT manufacturing the loss"}]`);
  console.log(`     WORST SINGLE DAY  ${(dd.worstDay * 100).toFixed(2)}% on ${dd.worstDayD}    2018-02-05 (the XIV day): ${xi >= 0 ? `${(xivRet * 100).toFixed(2)}%` : "NOT IN SAMPLE"}`);
  if (dd.ruinedOn) console.log(`     !! RUINED (1x, FULLY COLLATERALISED, NO LEVERAGE AT ALL) on ${dd.ruinedOn} — a single day's loss exceeded 100% of the collateral. Equity reached zero; every statistic above describes a book that ceased to exist on that date.`);
  console.log(`     HOLDABILITY  maxDD ${(dd.worst * 100).toFixed(1)}% (net ${(ndd.worst * 100).toFixed(1)}%)   longest underwater ${dd.longest}d (${fmtY(dd.longest)}) ${dd.worstUwStart ? `${dd.worstUwStart} -> ${dd.worstUwEnd}` : ""}${dd.ruinedOn ? `   (curve terminated at ruin ${dd.ruinedOn})` : dd.underwaterAtEnd ? `   still underwater ${dd.underwaterAtEnd}d at the end of sample` : ""}`);
  console.log(`     RUIN CHECK @ ASSUMED ${(MARGIN * 100).toFixed(0)}% margin: worst single day = ${(worstMargin * 100).toFixed(1)}% of margin  -> ${ruinDays.length ? `RUINED on ${ruinDays.join(", ")}` : "no single day exceeded 100% of margin"}   (margin is an ASSUMPTION; CFE VX has run ~20-40% of notional)`);
  console.log(`     ERA HALVES (gross):  pre-2018-02-05 ${pre ? `${pre.ann.toFixed(2)}%/yr t ${pre.t.toFixed(2)} n ${pre.n}` : "n/a"}   |   post-2018-02-05 ${post ? `${post.ann.toFixed(2)}%/yr t ${post.t.toFixed(2)} n ${post.n}` : "n/a"}`);
  const prior = "contango roll is POSITIVE carry for a short";
  const matched = g.ann > 0;
  console.log(`     SIGN vs prior ("${prior}"): ${matched ? "MATCHED" : "MISSED"} (gross ${g.ann.toFixed(2)}%/yr)`);

  const v = dd.ruinedOn
    ? `RUINED UNLEVERED on ${dd.ruinedOn} — a single day lost ${(dd.worstDay * 100).toFixed(2)}% of FULL collateral. Gross ${g.ann.toFixed(2)}%/yr / SR ${g.sr.toFixed(2)} / t ${g.t.toFixed(2)} are statistics on a dead equity curve and are not a return`
    : ruinDays.length
    ? `RUINED at the assumed 25% margin (${ruinDays.join(", ")}) — gross ${g.ann.toFixed(2)}%/yr, SR ${g.sr.toFixed(2)}, worst day ${(dd.worstDay * 100).toFixed(2)}%; the collateralised number describes a book that a margined holder would not have survived`
    : Math.abs(nst.t) < 2
    ? `NULL — net |t| ${Math.abs(nst.t).toFixed(2)} < 2 on N ${nst.n} (gross t ${g.t.toFixed(2)}); N=${TRIALS} trials this run`
    : post && Math.abs(post.t) < 2
    ? `NOT STABLE — full-sample net t ${nst.t.toFixed(2)} but post-2018-02-05 gross t ${post.t.toFixed(2)} on n ${post.n} does not clear 2`
    : `SURVIVES THIS RUN — net ${nst.ann.toFixed(2)}%/yr SR ${nst.sr.toFixed(2)} net t ${nst.t.toFixed(2)}, both eras same sign; longest underwater ${fmtY(dd.longest)}, maxDD ${(dd.worst * 100).toFixed(1)}%; NOT a promotion (N=${TRIALS} trials, no deflation ceiling applied, DESCRIPTIVE ONLY)`;
  verdicts.push(`${s.name}: ${v}`);
  console.log(`     VERDICT ${s.name}: ${v}\n`);
}

console.log(spyLine);
console.log(`\n  TRIALS THIS RUN: ${TRIALS} (three constructions, no parameter search).`);
console.log(`  COVERAGE: ${mon.length} monthly VX contracts, ${curve.length} curve-days ${curve[0].d}..${curve[curve.length - 1].d}. Weeklies ingested and excluded (marked).`);
console.log(`  BREADTH/UNIVERSE: single-instrument time-series test on ONE curve — no cross-section, no universe sensitivity; a cross-sectional claim would be UNTESTED.`);
console.log(`  MARGIN/RUIN is an ASSUMPTION (${(MARGIN * 100).toFixed(0)}% of notional), stated as such. Costs ${TICKS_RT} ticks RT, stated with their frequency (TURNOVER LAW).`);
console.log(`\n  VERDICT: ${verdicts.join("  |  ")}`);
console.log(`  DESCRIPTIVE ONLY — no mechanism registered, no lineage row written, no gate cleared, no forward clock started.`);
