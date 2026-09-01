#!/usr/bin/env -S deno run --allow-net --allow-env
// fx-carry.ts (D-738) — the FX CARRY test, unblocked by D-737 (FRED keyless foreign 3m rates). Carry = the interest-rate
// differential rate_3m_X - ust_3m; the carry TRADE bets against uncovered interest parity (long high-rate, short
// low-rate currencies) and is the single most-studied FX effect. The block the odds-map recorded ("needs both rate
// legs") is removed — this RUNS it.
//
// HONESTY UP FRONT, three ways, because this is exactly the shape prior laws were written to police:
//  1. BREADTH (D-443): the universe is SIX currencies (GBP/EUR/JPY/CAD/AUD/CHF). Our own BREADTH LAW floors a
//     cross-sectional claim at ~50 names; a 6-name sort is UNTESTED as a cross-section, full stop. So the headline is
//     NOT a cross-sectional t — it is a descriptive long-short with the breadth stated as loudly as the number.
//  2. STATIONARITY (D-730): carry is a persistent LEVEL; the macro-regime LEVEL test washed out under differencing.
//     The long-short PORTFOLIO RETURN is already a differenced quantity, so it is the clean object and it leads; the
//     level regression is reported second, explicitly as the suspect one.
//  3. HOLDABILITY (D-565) + TURNOVER (D-654): time-underwater and turnover*cost are reported beside any return, or the
//     row is not deployable-claimable.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("fx-carry", [{ name: "RT_BP", def: "4", note: "round-trip FX cost in bp (majors ~2-6bp)" }]);
const RT_BP = Number(Deno.env.get("RT_BP") || "4");

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fxcarry", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const q = async (p: string) => await fetch(`${OWNED}/${p}`, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);

// Yahoo FX convention: some symbols are USD-per-foreign (invert=false: return of the symbol IS the currency's return vs
// USD), others are foreign-per-USD (invert=true: the currency's return vs USD is the return of 1/price).
const CCYS: { ccy: string; sym: string; invert: boolean; rate: string }[] = [
  { ccy: "GBP", sym: "GBPUSD=X", invert: false, rate: "rate_3m_gbp" },
  { ccy: "EUR", sym: "EURUSD=X", invert: false, rate: "rate_3m_eur" },
  { ccy: "AUD", sym: "AUDUSD=X", invert: false, rate: "rate_3m_aud" },
  { ccy: "JPY", sym: "JPY=X", invert: true, rate: "rate_3m_jpy" }, // USDJPY
  { ccy: "CAD", sym: "CAD=X", invert: true, rate: "rate_3m_cad" }, // USDCAD
  { ccy: "CHF", sym: "CHF=X", invert: true, rate: "rate_3m_chf" }, // USDCHF
];

type Bar = [number, number, number, number, number, number];
const ym = (ts: number) => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

// month-end close of the currency vs USD (already inverted), per ccy
async function monthlyLevel(sym: string, invert: boolean): Promise<Map<string, number>> {
  const row = (await q(`trd_bars_deep?asset_class=eq.fx&symbol=eq.${encodeURIComponent(sym)}&select=bars`))[0];
  const bars: Bar[] = row?.bars || [];
  const lastOfMonth = new Map<string, number>();
  for (const b of bars) { const px = b[4]; if (!(px > 0)) continue; lastOfMonth.set(ym(b[0]), invert ? 1 / px : px); }
  return lastOfMonth;
}
// month-end value of a macro series (asOf: latest obs whose date's month <= this month)
async function monthlyRate(series: string): Promise<Map<string, number>> {
  const rows = (await q(`trd_macro_series?series=eq.${series}&select=d,v&order=d.asc`)) as { d: string; v: number }[];
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.d.slice(0, 7), r.v); // last obs in each month wins (asc order)
  // forward-fill so a monthly rate covers the month it was published and stays until the next print (asOf-safe: only past)
  return m;
}
const ust = await monthlyRate("ust_3m");

// build the panel: per ccy, per month -> { retFwd (t->t+1), carry (at t) }
interface Row { ccy: string; month: string; carry: number; retFwd: number }
const panel: Row[] = [];
for (const c of CCYS) {
  const lvl = await monthlyLevel(c.sym, c.invert);
  const rate = await monthlyRate(c.rate);
  const months = [...lvl.keys()].sort();
  // forward-fill both rate legs across months (they are monthly prints; a month with no new print keeps the last)
  const ff = (m: Map<string, number>) => { let last: number | undefined; const o = new Map<string, number>(); for (const mo of months) { if (m.has(mo)) last = m.get(mo); if (last != null) o.set(mo, last); } return o; };
  const rf = ff(rate), uf = ff(ust);
  for (let i = 0; i < months.length - 1; i++) {
    const m0 = months[i], m1 = months[i + 1];
    const p0 = lvl.get(m0)!, p1 = lvl.get(m1)!;
    const rX = rf.get(m0), rU = uf.get(m0);
    if (rX == null || rU == null || !(p0 > 0) || !(p1 > 0)) continue;
    const retFwd = Math.log(p1 / p0);          // log return of holding the currency vs USD, m0 -> m1
    const carry = (rX - rU) / 100 / 12;        // monthly rate differential (annual % -> monthly fraction)
    panel.push({ ccy: c.ccy, month: m0, carry, retFwd });
  }
}
assertNonEmpty("fx-carry panel", panel, 200);

// ---- THE CLEAN OBJECT: the differenced long-short carry portfolio (leads, per D-730) ----
// Each month, rank the available currencies by carry; long the top half, short the bottom half, equal-weight, dollar
// -neutral. The portfolio return already differences out the persistent level. Carry is ADDED to the price return
// because a long high-carry position earns the rate differential while held (the excess return = fx move + carry).
const byMonth = new Map<string, Row[]>();
for (const r of panel) { (byMonth.get(r.month) || byMonth.set(r.month, []).get(r.month)!).push(r); }
const pnl: { month: string; ret: number; turnover: number }[] = [];
let prevW = new Map<string, number>();
for (const month of [...byMonth.keys()].sort()) {
  const rows = byMonth.get(month)!.filter((r) => Number.isFinite(r.carry));
  if (rows.length < 4) continue; // need at least 2 long + 2 short
  const sorted = [...rows].sort((a, b) => b.carry - a.carry);
  const h = Math.floor(sorted.length / 2);
  const longs = sorted.slice(0, h), shorts = sorted.slice(sorted.length - h);
  const w = new Map<string, number>();
  for (const r of longs) w.set(r.ccy, 1 / longs.length);
  for (const r of shorts) w.set(r.ccy, -1 / shorts.length);
  // excess return of the leg = fx move + carry earned (long earns +carry, short pays -carry)
  let ret = 0;
  for (const r of longs) ret += (r.retFwd + r.carry) / longs.length;
  for (const r of shorts) ret -= (r.retFwd + r.carry) / shorts.length;
  let turnover = 0; const keys = new Set([...w.keys(), ...prevW.keys()]);
  for (const k of keys) turnover += Math.abs((w.get(k) || 0) - (prevW.get(k) || 0));
  pnl.push({ month, ret, turnover }); prevW = w;
}
const rets = pnl.map((p) => p.ret);
const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
const tstat = mean / (sd / Math.sqrt(rets.length));
const srA = (mean / sd) * Math.sqrt(12);
const annRet = mean * 12 * 100;
// turnover*cost drag (TURNOVER LAW)
const avgTO = pnl.reduce((a, p) => a + p.turnover, 0) / pnl.length; // one-way sum of |dw| per month
const dragA = avgTO * 12 * (RT_BP / 1e4) * 100; // annual %; RT_BP is round-trip, avgTO already both-sides gross
// time underwater (HOLDABILITY LAW)
let peak = 0, cum = 0, longestUW = 0, curUW = 0, worstDD = 0;
for (const r of rets) { cum += r; if (cum > peak) { peak = cum; curUW = 0; } else { curUW++; if (curUW > longestUW) longestUW = curUW; } const dd = cum - peak; if (dd < worstDD) worstDD = dd; }

console.log(`==> FX CARRY (D-738) — 6 currencies (GBP/EUR/AUD/JPY/CAD/CHF), monthly, ${pnl.length} months\n`);
console.log(`  *** BREADTH = 6 currencies. Our BREADTH LAW (D-443) floors a cross-sectional claim at ~50 names. This is`);
console.log(`      therefore UNTESTED as a cross-section — the number below is DESCRIPTIVE, not a promotable edge. ***\n`);
console.log(`  LONG-SHORT CARRY PORTFOLIO (top-half minus bottom-half by rate differential, +carry earned):`);
console.log(`    gross mean/mo   ${(mean * 100).toFixed(3)}%   annualised ${annRet.toFixed(2)}%/yr`);
console.log(`    Sharpe (ann)    ${srA.toFixed(2)}    t-stat ${tstat.toFixed(2)}   N=${rets.length} months`);
console.log(`    turnover        ${avgTO.toFixed(2)} one-way/mo  ->  cost drag @${RT_BP}bp RT = ${dragA.toFixed(2)}%/yr`);
console.log(`    NET of cost     ${(annRet - dragA).toFixed(2)}%/yr`);
console.log(`    HOLDABILITY     longest underwater ${longestUW} months (${(longestUW / 12).toFixed(1)}y); worst DD ${(worstDD * 100).toFixed(1)}%\n`);

// ---- THE SUSPECT OBJECT: pooled level regression forward_ret ~ carry (reported second, flagged) ----
const xs = panel.map((r) => r.carry), ysr = panel.map((r) => r.retFwd);
const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ysr.reduce((a, b) => a + b, 0) / ysr.length;
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ysr[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ysr[i] - my) ** 2; }
const slope = sxy / sxx;
const r2 = (sxy * sxy) / (sxx * syy);
// naive OLS t (KNOWN over-stated: pooled, ignores currency + serial dependence). Report it AS suspect.
const resid = panel.map((r, i) => r.retFwd - (my + slope * (r.carry - mx)));
const s2 = resid.reduce((a, b) => a + b * b, 0) / (panel.length - 2);
const seSlope = Math.sqrt(s2 / sxx);
const tSlope = slope / seSlope;
console.log(`  POOLED LEVEL REGRESSION ret[t+1] ~ carry[t]  (SUSPECT — carry is a persistent level, D-730; naive t is`);
console.log(`  over-stated because it pools 6 currencies and ignores serial dependence — reported for completeness only):`);
console.log(`    slope ${slope.toFixed(2)}  (UIP-failure predicts >0: high carry -> currency does NOT fully depreciate)`);
console.log(`    naive pooled t ${tSlope.toFixed(2)}   R^2 ${(r2 * 100).toFixed(2)}%   n=${panel.length} ccy-months`);

// VERDICT
console.log(`\n  VERDICT: ${
  Math.abs(tstat) < 2 ? "NO SIGNIFICANT CARRY in this 6-name book (|t|<2). Consistent with the base rate."
  : (annRet - dragA) <= 0 ? "carry gross t is significant but NET of cost is <=0 — SUB-COST, not an edge."
  : "carry survives cost in-sample BUT breadth=6 makes it UNTESTED as a cross-section; a 6-name result is not promotable."
}`);
console.log(`  Either way this is DESCRIPTIVE ONLY (breadth floor) — it does not clear a gate and is not on a forward clock.`);
