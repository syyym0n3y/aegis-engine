#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// borrow-fee-conditioning.ts — does a HIGH borrow fee predict LOW subsequent returns?
//
// THE PRIOR, STATED FIRST (SIGN LAW, D-553): the literature says YES, negatively. Drechsler & Drechsler ("The
// Shorting Premium and Asset Pricing Anomalies") find that expensive-to-short stocks underperform, and that most
// of the cross-sectional anomaly spread lives in the high-fee names; Engelberg, Reed & Ringgenberg ("Short-Selling
// Risk") find that loan-fee level and volatility both forecast low returns. So the pre-stated sign is
// **NEGATIVE: Q5 (highest fee) underperforms Q1 (cheapest) and underperforms the universe.**
// Whether the measurement MATCHES or MISSES that prior is reported explicitly below, before any interpretation.
//
// WHY THIS IS UNDERPOWERED BY CONSTRUCTION, SAID BEFORE THE NUMBER. iBorrowDesk serves ~ONE YEAR of daily history.
// A monthly cross-sectional test therefore has ~12 observations. The published effect is a few tens of bp/month;
// at the monthly dispersion this panel actually shows, the months needed for |t| = 2 are COMPUTED below and printed
// beside the months held. This is a SHORT-SAMPLE test whose purpose is to check that the machinery agrees with a
// well-documented sign, not to establish anything. It cannot promote and it cannot kill.
//
// BENCHMARK LAW (D-627/630): a Q5-Q1 spread says nothing about whether either leg earned anything, so the universe
// mean over the same months and each quintile's EXCESS against it are the primary numbers. For the retail long-only
// reading — the only one an unlevered account can act on — Q5's excess ALONE is the "avoid" signal; the spread is
// not placeable without a borrow (and the borrow on Q5 is, by construction, the most expensive in the market).
// LIQUIDITY LAW (D-634): both halves measured, never one.  TURNOVER LAW (D-654): stated, not omitted.
// DESCRIPTIVE ONLY (MECHANISM LAW, D-597). No pre-registration, no lineage row, no promotion.

import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("borrow-fee-conditioning", [
  { name: "BFC_DVOL", def: "1000000", note: "liquid-universe floor: 60-day MEDIAN dollar volume, USD" },
  { name: "BFC_QUINT", def: "5", note: "number of fee-sorted buckets" },
  { name: "BFC_MINN", def: "100", note: "minimum names in a month for that month to be usable" },
]);
const DVOL_FLOOR = Number(K.BFC_DVOL), NQ = Number(K.BFC_QUINT), MIN_N = Number(K.BFC_MINN);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bfc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// D-757: STRICT read. A transport failure now RETRIES and then THROWS with the path and status, instead of
// returning [] — which was indistinguishable from "the market has nothing here" (D-756: a PostgREST OOM
// restart silently shrank a 15,502-symbol universe to 8,600 and the run finished, printing a wrong number).
const { q } = mkStrictRead(OWNED, hdr);
const pct = (x: number) => `${(100 * x).toFixed(3)}%`;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const tstat = (a: number[]) => a.length < 2 ? NaN : mean(a) / (sd(a) / Math.sqrt(a.length));
const quant = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
function spearman(x: number[], y: number[]): number {
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, r) => p[0] - r[0]); const out = new Array(a.length).fill(0); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) out[idx[k][1]] = r; i = j + 1; } return out; };
  const rx = rank(x), ry = rank(y), n = x.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

console.log(`\n${"=".repeat(114)}\n  BORROW FEE AS A RETURN CONDITIONER — SHORT-SAMPLE (~1y of fee history)   (DESCRIPTIVE ONLY)\n${"=".repeat(114)}`);
console.log(`  PRE-STATED SIGN (SIGN LAW): NEGATIVE. High fee -> low subsequent return (Drechsler & Drechsler; Engelberg et al.).`);

// ── 1. FEE PANEL, full history ───────────────────────────────────────────────────────────────────────────────
type Row = { series: string; d: string; v: number };
const feeBy = new Map<string, { d: string; v: number }[]>();
let nFeeRows = 0;
for (let off = 0;; off += 20000) {
  const p = (await q(`trd_macro_series?series=like.borrow_fee:*&select=series,d,v&order=series.asc,d.asc&offset=${off}&limit=20000`)) as Row[];
  if (!p.length) break;
  for (const r of p) { if (!Number.isFinite(r.v)) continue; const s = r.series.slice(11); (feeBy.get(s) ?? feeBy.set(s, []).get(s)!).push({ d: r.d, v: r.v / 100 }); nFeeRows++; }
  if (p.length < 20000) break;
}
assertNonEmpty("borrow_fee rows", [...feeBy.keys()], 500);
const allD = [...feeBy.values()].flatMap((a) => [a[0].d, a[a.length - 1].d]).sort();
console.log(`\n  1. FEE PANEL: ${nFeeRows.toLocaleString()} rows | ${feeBy.size.toLocaleString()} symbols | span ${allD[0]} .. ${allD[allD.length - 1]}`);
console.log(`     POSITIVE CONTROL — AAPL must carry a multi-month fee series: ${(feeBy.get("AAPL")?.length ?? 0)} daily rows (must be > 100): ${(feeBy.get("AAPL")?.length ?? 0) > 100 ? "PASS" : "FAIL"}`);
if ((feeBy.get("AAPL")?.length ?? 0) <= 100) Deno.exit(2);

// ── 2. LIQUID UNIVERSE + PRICES ──────────────────────────────────────────────────────────────────────────────
type Meta = { symbol: string; n_bars: number; last_date: string };
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars,last_date&limit=100000`)) as Meta[];
const cutoff = iso(Date.now() - 90 * 864e5);
const live = meta.filter((m) => m.n_bars >= 60 && m.last_date >= cutoff && feeBy.has(m.symbol));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const dvol = new Map<string, number>();
const px = new Map<string, { d: string; c: number }[]>();
for (let i = 0; i < live.length; i += 50) {
  const part = live.slice(i, i + 50).map((m) => `"${m.symbol}"`).join(",");
  const rows = (await q(`trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`)) as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const b = r.bars ?? []; if (b.length < 60) continue;
    const tail = b.slice(-60);
    const dv = median(tail.map((x) => x[4] * x[5]).filter(Number.isFinite));
    if (dv < DVOL_FLOOR) continue;
    dvol.set(r.symbol, dv);
    px.set(r.symbol, b.slice(-400).map((x) => ({ d: iso(x[0] * 1000), c: x[4] })).filter((x) => Number.isFinite(x.c) && x.c > 0));
  }
}
console.log(`\n  2. UNIVERSE: ${px.size.toLocaleString()} liquid names (60d median $vol >= $${(DVOL_FLOOR / 1e6).toFixed(1)}M) that also carry a fee series`);

// ── 3. MONTHLY PANEL, lag-1 (SAME-BAR COROLLARY, D-498) ──────────────────────────────────────────────────────
// Signal: the last fee observation ON OR BEFORE the last trading day of month m.
// Formation: the close of the FIRST trading day of month m+1 (one day after the signal is knowable).
// Return: from that close to the close of the first trading day of month m+2. No same-bar action anywhere.
const monthsOf = (arr: { d: string; c: number }[]) => { const first = new Map<string, number>(); arr.forEach((r, i) => { const m = r.d.slice(0, 7); if (!first.has(m)) first.set(m, i); }); return first; };
const allMonths = [...new Set([...px.values()].flatMap((a) => a.map((r) => r.d.slice(0, 7))))].sort();
type Obs = { sym: string; fee: number; ret: number; dv: number };
const panel = new Map<string, Obs[]>();
for (const [sym, arr] of px) {
  const firstIdx = monthsOf(arr);
  const fs = feeBy.get(sym)!;
  for (let i = 0; i + 2 < allMonths.length; i++) {
    const mSig = allMonths[i], mForm = allMonths[i + 1], mEnd = allMonths[i + 2];
    const iForm = firstIdx.get(mForm), iEnd = firstIdx.get(mEnd);
    if (iForm === undefined || iEnd === undefined) continue;
    const asOf = `${mSig}-31`;                                          // last fee on or before month-end of mSig
    let f: number | undefined;
    for (const r of fs) { if (r.d <= asOf) f = r.v; else break; }
    if (f === undefined) continue;
    const r0 = arr[iForm].c, r1 = arr[iEnd].c;
    if (!(r0 > 0 && r1 > 0)) continue;
    (panel.get(mForm) ?? panel.set(mForm, []).get(mForm)!).push({ sym, fee: f, ret: r1 / r0 - 1, dv: dvol.get(sym)! });
  }
}
const months = [...panel.keys()].filter((m) => panel.get(m)!.length >= MIN_N).sort();
assertNonEmpty("usable months", months, 3);
console.log(`\n  3. MONTHLY PANEL (lag-1): ${months.length} usable months ${months[0]} .. ${months[months.length - 1]} | mean breadth ${Math.round(mean(months.map((m) => panel.get(m)!.length))).toLocaleString()} names/month`);
console.log(`     POSITIVE CONTROL — a month must contain BOTH cheap and expensive names, or the sort is degenerate:`);
{
  const last = panel.get(months[months.length - 1])!.map((o) => o.fee);
  console.log(`       ${months[months.length - 1]}: fee median ${pct(quant(last, 0.5))} | 90th ${pct(quant(last, 0.90))} | max ${pct(Math.max(...last))} -> ${quant(last, 0.90) > quant(last, 0.5) ? "PASS" : "FAIL"}`);
}

// ── 4. QUINTILES, EXCESS vs THE UNIVERSE MEAN (BENCHMARK LAW) ────────────────────────────────────────────────
function run(sel: (o: Obs[]) => Obs[], label: string) {
  const qExc: number[][] = Array.from({ length: NQ }, () => []);
  const uni: number[] = [];
  const spread: number[] = [];
  const q5neg: number[] = [];
  const turn: number[] = [];
  let prevQ5: Set<string> | null = null;
  for (const m of months) {
    const obs = sel(panel.get(m)!);
    if (obs.length < MIN_N) continue;
    const sorted = [...obs].sort((a, b) => a.fee - b.fee);
    const u = mean(sorted.map((o) => o.ret));
    uni.push(u);
    const per = Math.floor(sorted.length / NQ);
    const buckets = Array.from({ length: NQ }, (_, i) => sorted.slice(i * per, i === NQ - 1 ? sorted.length : (i + 1) * per));
    buckets.forEach((b, i) => qExc[i].push(mean(b.map((o) => o.ret)) - u));
    spread.push(mean(buckets[NQ - 1].map((o) => o.ret)) - mean(buckets[0].map((o) => o.ret)));
    q5neg.push(mean(buckets[NQ - 1].map((o) => o.ret)) < 0 ? 1 : 0);
    const cur = new Set(buckets[NQ - 1].map((o) => o.sym));
    if (prevQ5) turn.push([...cur].filter((s) => !prevQ5!.has(s)).length / cur.size);
    prevQ5 = cur;
  }
  const n = uni.length;
  console.log(`\n     ${label}   n=${n} months`);
  console.log(`       universe mean return, monthly: ${pct(mean(uni))}  (annualised ${pct(mean(uni) * 12)})`);
  console.log(`       ${"quintile".padEnd(12)}${"excess/mo".padEnd(14)}${"excess/yr".padEnd(14)}t`);
  qExc.forEach((e, i) => console.log(`       ${("Q" + (i + 1) + (i === 0 ? " cheapest" : i === NQ - 1 ? " dearest" : "")).padEnd(12)}${pct(mean(e)).padEnd(14)}${pct(mean(e) * 12).padEnd(14)}${tstat(e).toFixed(2)}`));
  console.log(`       Q5-Q1 spread:  ${pct(mean(spread))}/mo  (${pct(mean(spread) * 12)}/yr)  t ${tstat(spread).toFixed(2)}`);
  console.log(`       Q5 excess ALONE (the retail long-only "avoid" reading): ${pct(mean(qExc[NQ - 1]))}/mo (${pct(mean(qExc[NQ - 1]) * 12)}/yr) t ${tstat(qExc[NQ - 1]).toFixed(2)}`);
  console.log(`       months Q5's RAW return was negative: ${q5neg.reduce((s, x) => s + x, 0)}/${n}  (a bucket that mostly rises is not a short)`);
  console.log(`       Q5 one-way turnover: ${turn.length ? pct(mean(turn)) : "n/a"} one-way/month -> TURNOVER LAW drag (2 x one-way x 12/yr x 40bp round trip): ${turn.length ? pct(2 * mean(turn) * 12 * 0.004) : "n/a"}/yr`);
  return { n, spread, q5: qExc[NQ - 1], uni, turn };
}
console.log(`\n  4. QUINTILE RESULTS — excess against the universe mean over the SAME months (BENCHMARK LAW)`);
const all = run((o) => o, "ALL LIQUID NAMES");
const byDvSplit = (o: Obs[], hi: boolean) => { const s = [...o].sort((a, b) => b.dv - a.dv); const h = Math.floor(s.length / 2); return hi ? s.slice(0, h) : s.slice(h); };
const liqHi = run((o) => byDvSplit(o, true), "liq:HIGH half");
const liqLo = run((o) => byDvSplit(o, false), "liq:LOW half");

// ── 5. POWER: how many months would be needed? ───────────────────────────────────────────────────────────────
const needN = (a: number[]) => { const m = Math.abs(mean(a)), s = sd(a); return m > 0 ? Math.ceil((2 * s / m) ** 2) : Infinity; };
console.log(`\n  5. POWER — this test is UNDERPOWERED and the required n is stated, not hand-waved\n`);
console.log(`     ${"series".padEnd(26)}${"n held".padEnd(10)}${"monthly sd".padEnd(14)}${"n needed for |t|=2"}`);
for (const [l, a] of [["Q5-Q1 spread", all.spread], ["Q5 excess alone", all.q5]] as [string, number[]][]) {
  const nn = needN(a);
  console.log(`     ${l.padEnd(26)}${String(all.n).padEnd(10)}${pct(sd(a)).padEnd(14)}${Number.isFinite(nn) ? `${nn} months (${(nn / 12).toFixed(1)} years)` : "unbounded (observed mean ~ 0)"}`);
}
console.log(`     At the observed dispersion, ${all.n} months cannot separate the documented effect from zero. Any verdict here`);
console.log(`     is about the MACHINERY agreeing with a known sign, never about the market.`);

// ── 6. SIGN vs THE PRIOR (SIGN LAW) ──────────────────────────────────────────────────────────────────────────
const sgn = (x: number) => x < 0 ? "NEGATIVE" : x > 0 ? "POSITIVE" : "ZERO";
console.log(`\n  6. SIGN vs THE PRE-STATED PRIOR (NEGATIVE)\n`);
console.log(`     Q5-Q1 spread measured ${sgn(mean(all.spread))} (${pct(mean(all.spread) * 12)}/yr, t ${tstat(all.spread).toFixed(2)}) -> prior ${mean(all.spread) < 0 ? "MATCHED" : "MISSED"}`);
console.log(`     Q5 excess  measured ${sgn(mean(all.q5))} (${pct(mean(all.q5) * 12)}/yr, t ${tstat(all.q5).toFixed(2)}) -> prior ${mean(all.q5) < 0 ? "MATCHED" : "MISSED"}`);
console.log(`     liq:HIGH Q5 excess ${pct(mean(liqHi.q5) * 12)}/yr (t ${tstat(liqHi.q5).toFixed(2)}) | liq:LOW Q5 excess ${pct(mean(liqLo.q5) * 12)}/yr (t ${tstat(liqLo.q5).toFixed(2)})`);
console.log(`     Neither reading is claimable in either direction at this n. A MATCH here is not confirmation and a`);
console.log(`     MISS here is not a refutation — that is what "underpowered" means, and it cuts both ways.`);

// ── 7. DOES THE FEE VALIDATE D-721's DAYS-TO-COVER PROXY? ────────────────────────────────────────────────────
// D-721 tested BORROW STRESS using days-to-cover from trd_short_interest, because no borrow price was held. If the
// proxy is good, fee and days-to-cover should rank names similarly in the cross-section. If they do not, D-721's
// null was a null about days-to-cover and NOT about borrow cost — a materially different statement.
console.log(`\n  7. D-721 PROXY VALIDATION — cross-sectional rank correlation, borrow FEE vs DAYS-TO-COVER\n`);
const lastSet = (await q(`trd_short_interest?select=settlement&order=settlement.desc&limit=1`))[0]?.settlement as string | undefined;
if (!lastSet) console.log(`     UNTESTED — trd_short_interest unreadable.`);
else {
  type SI = { symbol: string; days_cover: number; short_qty: number };
  const si: SI[] = [];
  for (let off = 0;; off += 10000) {
    const p = (await q(`trd_short_interest?settlement=eq.${lastSet}&select=symbol,days_cover,short_qty&offset=${off}&limit=10000`)) as SI[];
    if (!p.length) break; si.push(...p); if (p.length < 10000) break;
  }
  const latestFee = new Map<string, number>();
  for (const [s, a] of feeBy) latestFee.set(s, a[a.length - 1].v);
  const pairs = si.filter((r) => latestFee.has(r.symbol) && Number.isFinite(r.days_cover) && r.days_cover > 0 && px.has(r.symbol));
  console.log(`     settlement ${lastSet} | ${si.length.toLocaleString()} filed | ${pairs.length.toLocaleString()} liquid names carry BOTH a fee and a days-to-cover`);
  console.log(`     POSITIVE CONTROL — the overlap must be non-zero and both columns must vary: ${pairs.length > 100 && new Set(pairs.map((p) => p.days_cover)).size > 10 ? "PASS" : "FAIL — the correlation below is meaningless"}`);
  if (pairs.length > 100) {
    const rho = spearman(pairs.map((p) => latestFee.get(p.symbol)!), pairs.map((p) => p.days_cover));
    console.log(`     Spearman rho(fee, days_to_cover) = ${rho.toFixed(3)}  on n=${pairs.length.toLocaleString()}`);
    const verdict = Math.abs(rho) >= 0.5 ? "the proxy TRACKS the price" : Math.abs(rho) >= 0.25 ? "the proxy is WEAKLY related to the price" : "the proxy DOES NOT track the price";
    console.log(`     -> ${verdict}.`);
    if (Math.abs(rho) < 0.25) {
      console.log(`     CONSEQUENCE FOR D-721: its borrow-stress null was measured on days-to-cover, which at rho ${rho.toFixed(3)} is`);
      console.log(`     nearly unrelated to what borrowing actually COSTS. D-721 therefore remains a true null ABOUT DAYS-TO-COVER,`);
      console.log(`     and says materially less about borrow cost than its name suggests. Re-running it on the fee is a`);
      console.log(`     DIFFERENT test — which is exactly what section 4 above is, and section 5 says it is underpowered.`);
    }
    const hi = pairs.filter((p) => latestFee.get(p.symbol)! >= 0.05);
    console.log(`     among names at HOT fees (>=5%/yr, n=${hi.length}): median days-to-cover ${hi.length ? quant(hi.map((p) => p.days_cover), 0.5).toFixed(2) : "n/a"} vs universe median ${quant(pairs.map((p) => p.days_cover), 0.5).toFixed(2)}`);
  }
}

console.log(`\n${"=".repeat(114)}\n  VERDICT — UNDERPOWERED / DESCRIPTIVE ONLY. ${all.n} months of fee history cannot resolve a documented effect of this size.\n  No lineage row, no pre-registration, no promotion. The fee panel accrues daily; revisit when the span supports it.\n${"=".repeat(114)}\n`);
