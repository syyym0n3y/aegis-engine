#!/usr/bin/env -S deno run --allow-net --allow-env
// fx-carry-em.ts (D-741) — the FX CARRY test EXTENDED to the EM high-yielders, closing the gap D-738 named in its own
// output: "EM high-yielders where the textbook carry premium concentrates are not held". That was a COVERAGE-LAW
// statement, not a market finding — the EM FX bars were held in trd_bars_deep all along and only the foreign rate leg
// was missing. The rate leg is now ingested (FRED keyless, verified per-ID, see ingest-fred-macro.ts D-741 block).
//
// The same three honesty framings as D-738 carry over unchanged, plus one new one:
//  1. BREADTH (D-443): the universe is 14 currencies, not 50. A 14-name sort is UNTESTED as a cross-section. The
//     BREADTH caveat therefore STAYS and is printed in full — extending 6 -> 14 does not clear the floor.
//  2. STATIONARITY (D-730): the long-short PORTFOLIO RETURN is already differenced and leads; the pooled LEVEL
//     regression is reported second and flagged suspect, with its t named "gross t" (COST-INFLATION COROLLARY D-661).
//  3. HOLDABILITY (D-565) + TURNOVER (D-654): time-underwater, worst DD, turnover and turnover*cost drag beside the
//     gross, and a NET figure.
//  4. INSTRUMENT (D-575): for BRL/TRY/INR the ingested series is an OVERNIGHT POLICY/CALL rate, not a 3m interbank
//     rate, because no 3m interbank series exists (BRL, INR) or it is dead after 2008 (TRY). The label says rate_3m_
//     for naming consistency with the G6; the instrument is stated here so the proxy is never read as the real thing.
//     EM deliverable-forward pricing also carries capital-control and NDF-basis effects this rate differential does
//     not capture — the differential is a RESEARCH PROXY for EM carry, not a placeable instrument.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("fx-carry-em", [{ name: "RT_BP", def: "15", note: "round-trip FX cost in bp (EM ~10-25bp, majors ~2-6bp)" }]);
const RT_BP = Number(Deno.env.get("RT_BP") || "15");

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fxcarryem", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const q = async (p: string) => await fetch(`${OWNED}/${p}`, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);

// Yahoo FX convention: invert=false means the symbol is USD-per-foreign (its return IS the currency's return vs USD);
// invert=true means foreign-per-USD, so the currency's return vs USD is the return of 1/price.
type Ccy = { ccy: string; sym: string; invert: boolean; rate: string; grp: "DEV" | "EM" };
const CCYS: Ccy[] = [
  // developed (D-738's G6, unchanged) + NZD
  { ccy: "GBP", sym: "GBPUSD=X", invert: false, rate: "rate_3m_gbp", grp: "DEV" },
  { ccy: "EUR", sym: "EURUSD=X", invert: false, rate: "rate_3m_eur", grp: "DEV" },
  { ccy: "AUD", sym: "AUDUSD=X", invert: false, rate: "rate_3m_aud", grp: "DEV" },
  { ccy: "NZD", sym: "NZDUSD=X", invert: false, rate: "rate_3m_nzd", grp: "DEV" },
  { ccy: "JPY", sym: "JPY=X", invert: true, rate: "rate_3m_jpy", grp: "DEV" },
  { ccy: "CAD", sym: "CAD=X", invert: true, rate: "rate_3m_cad", grp: "DEV" },
  { ccy: "CHF", sym: "CHF=X", invert: true, rate: "rate_3m_chf", grp: "DEV" },
  // EM high-yielders (all foreign-per-USD)
  { ccy: "MXN", sym: "MXN=X", invert: true, rate: "rate_3m_mxn", grp: "EM" },
  { ccy: "BRL", sym: "USDBRL=X", invert: true, rate: "rate_3m_brl", grp: "EM" },
  { ccy: "ZAR", sym: "USDZAR=X", invert: true, rate: "rate_3m_zar", grp: "EM" },
  { ccy: "TRY", sym: "USDTRY=X", invert: true, rate: "rate_3m_try", grp: "EM" },
  { ccy: "INR", sym: "USDINR=X", invert: true, rate: "rate_3m_inr", grp: "EM" },
  { ccy: "KRW", sym: "USDKRW=X", invert: true, rate: "rate_3m_krw", grp: "EM" },
  { ccy: "CNY", sym: "USDCNY=X", invert: true, rate: "rate_3m_cny", grp: "EM" },
];

type Bar = [number, number, number, number, number, number];
const ym = (ts: number) => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

async function monthlyLevel(sym: string, invert: boolean): Promise<Map<string, number>> {
  const row = (await q(`trd_bars_deep?asset_class=eq.fx&symbol=eq.${encodeURIComponent(sym)}&select=bars`))[0];
  const bars: Bar[] = row?.bars || [];
  const lastOfMonth = new Map<string, number>();
  for (const b of bars) { const px = b[4]; if (!(px > 0)) continue; lastOfMonth.set(ym(b[0]), invert ? 1 / px : px); }
  return lastOfMonth;
}
async function monthlyRate(series: string): Promise<Map<string, number>> {
  const rows = (await q(`trd_macro_series?series=eq.${series}&select=d,v&order=d.asc`)) as { d: string; v: number }[];
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.d.slice(0, 7), r.v);
  return m;
}

// ---- POSITIVE CONTROL (D-641): a zero here would look identical to a broken series, so two values that MUST be
// large are checked before anything is measured. TRY policy rate > 30% in 2024; BRL > 10% in 2023.
{
  const tryR = await monthlyRate("rate_3m_try"), brlR = await monthlyRate("rate_3m_brl");
  const tryMax = Math.max(...[...tryR.entries()].filter(([d]) => d.startsWith("2024")).map(([, v]) => v), -Infinity);
  const brlMax = Math.max(...[...brlR.entries()].filter(([d]) => d.startsWith("2023")).map(([, v]) => v), -Infinity);
  console.log(`  POSITIVE CONTROL: TRY 2024 max ${tryMax.toFixed(2)}% (must be >30) | BRL 2023 max ${brlMax.toFixed(2)}% (must be >10)`);
  if (!(tryMax > 30 && brlMax > 10)) { console.error("!! EM rate-leg positive control FAILED — the series is wrong, not the world. RED."); Deno.exit(1); }
}

interface Row { ccy: string; grp: "DEV" | "EM"; month: string; carry: number; retFwd: number }
const panel: Row[] = [];
const cover: string[] = [];
for (const c of CCYS) {
  const lvl = await monthlyLevel(c.sym, c.invert);
  const rate = await monthlyRate(c.rate);
  const ustM = await monthlyRate("ust_3m");
  const months = [...lvl.keys()].sort();
  const ff = (m: Map<string, number>) => { let last: number | undefined; const o = new Map<string, number>(); for (const mo of months) { if (m.has(mo)) last = m.get(mo); if (last != null) o.set(mo, last); } return o; };
  const rf = ff(rate), uf = ff(ustM);
  let n = 0, first = "", lastM = "";
  for (let i = 0; i < months.length - 1; i++) {
    const m0 = months[i], m1 = months[i + 1];
    const p0 = lvl.get(m0)!, p1 = lvl.get(m1)!;
    const rX = rf.get(m0), rU = uf.get(m0);
    if (rX == null || rU == null || !(p0 > 0) || !(p1 > 0)) continue;
    const retFwd = Math.log(p1 / p0);        // log return of holding the currency vs USD, m0 -> m1 (lag-1 by construction:
    const carry = (rX - rU) / 100 / 12;      // the signal is dated m0 and the return is m0 -> m1)
    panel.push({ ccy: c.ccy, grp: c.grp, month: m0, carry, retFwd });
    n++; if (!first) first = m0; lastM = m0;
  }
  cover.push(`    ${c.ccy.padEnd(4)} ${c.grp.padEnd(4)} ${c.sym.padEnd(10)} ${String(n).padStart(4)} months  ${first} -> ${lastM}`);
}
assertNonEmpty("fx-carry-em panel", panel, 500);

// ---- the differenced long-short carry portfolio: top-third minus bottom-third by carry, dollar-neutral, +carry earned
interface Book { rets: number[]; months: string[]; turnovers: number[]; breadth: number[] }
function build(rows: Row[], minN: number): Book {
  const byMonth = new Map<string, Row[]>();
  for (const r of rows) { const a = byMonth.get(r.month); if (a) a.push(r); else byMonth.set(r.month, [r]); }
  const out: Book = { rets: [], months: [], turnovers: [], breadth: [] };
  let prevW = new Map<string, number>();
  for (const month of [...byMonth.keys()].sort()) {
    const rs = byMonth.get(month)!.filter((r) => Number.isFinite(r.carry));
    if (rs.length < minN) continue;
    const sorted = [...rs].sort((a, b) => b.carry - a.carry);
    const k = Math.max(1, Math.floor(sorted.length / 3));    // TOP THIRD minus BOTTOM THIRD
    const longs = sorted.slice(0, k), shorts = sorted.slice(sorted.length - k);
    const w = new Map<string, number>();
    for (const r of longs) w.set(r.ccy, 1 / longs.length);
    for (const r of shorts) w.set(r.ccy, -1 / shorts.length);
    let ret = 0;
    for (const r of longs) ret += (r.retFwd + r.carry) / longs.length;
    for (const r of shorts) ret -= (r.retFwd + r.carry) / shorts.length;
    let to = 0; const keys = new Set([...w.keys(), ...prevW.keys()]);
    for (const kk of keys) to += Math.abs((w.get(kk) || 0) - (prevW.get(kk) || 0));
    out.rets.push(ret); out.months.push(month); out.turnovers.push(to); out.breadth.push(rs.length);
    prevW = w;
  }
  return out;
}
interface Stats { n: number; mean: number; sd: number; t: number; sr: number; annRet: number; avgTO: number; drag: number; net: number; uw: number; dd: number; breadth: number; from: string; to: string }
function stats(b: Book): Stats | null {
  const rets = b.rets;
  if (rets.length < 12) return null;
  const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1));
  const avgTO = b.turnovers.reduce((a, x) => a + x, 0) / b.turnovers.length;
  const drag = avgTO * 12 * (RT_BP / 1e4) * 100;
  let peak = 0, cum = 0, uw = 0, cur = 0, dd = 0;
  for (const r of rets) { cum += r; if (cum > peak) { peak = cum; cur = 0; } else { cur++; if (cur > uw) uw = cur; } const d = cum - peak; if (d < dd) dd = d; }
  return {
    n: rets.length, mean, sd, t: mean / (sd / Math.sqrt(rets.length)), sr: (mean / sd) * Math.sqrt(12),
    annRet: mean * 12 * 100, avgTO, drag, net: mean * 12 * 100 - drag, uw, dd,
    breadth: b.breadth.reduce((a, x) => a + x, 0) / b.breadth.length, from: b.months[0], to: b.months[b.months.length - 1],
  };
}
function report(label: string, s: Stats | null) {
  if (!s) { console.log(`  ${label}: too few months to measure — UNTESTED\n`); return; }
  console.log(`  ${label}  (${s.from} -> ${s.to})`);
  console.log(`    breadth         ${s.breadth.toFixed(1)} names/rebalance   ${s.n} months`);
  console.log(`    gross mean/mo   ${(s.mean * 100).toFixed(3)}%   annualised ${s.annRet.toFixed(2)}%/yr`);
  console.log(`    Sharpe (ann)    ${s.sr.toFixed(2)}    t-stat ${s.t.toFixed(2)}   N=${s.n} months`);
  console.log(`    turnover        ${s.avgTO.toFixed(2)} one-way/mo  ->  cost drag @${RT_BP}bp RT = ${s.drag.toFixed(2)}%/yr`);
  console.log(`    NET of cost     ${s.net.toFixed(2)}%/yr`);
  console.log(`    HOLDABILITY     longest underwater ${s.uw} months (${(s.uw / 12).toFixed(1)}y); worst DD ${(s.dd * 100).toFixed(1)}%`);
  console.log(`    SIGN vs prior   prior = POSITIVE carry premium (UIP fails; high-rate ccy does not fully depreciate) -> ${s.mean > 0 ? "MATCHED" : "MISSED"}\n`);
}

const bAll = build(panel, 6);
const bDev = build(panel.filter((r) => r.grp === "DEV"), 4);
const bEm = build(panel.filter((r) => r.grp === "EM"), 4);
const sAll = stats(bAll), sDev = stats(bDev), sEm = stats(bEm);

const nCcy = new Set(panel.map((r) => r.ccy)).size;
console.log(`\n==> FX CARRY, EM-EXTENDED (D-741) — ${nCcy} currencies (G6 + NZD + MXN/BRL/ZAR/TRY/INR/KRW/CNY), monthly\n`);
console.log(`  *** BREADTH = ${nCcy} currencies. Our BREADTH LAW (D-443) floors a cross-sectional claim at ~50 names.`);
console.log(`      ${nCcy} < 50, so the BREADTH CAVEAT STAYS: this is UNTESTED as a cross-section and every number below`);
console.log(`      is DESCRIPTIVE, not a promotable edge. Extending 6 -> ${nCcy} narrows the gap; it does not clear it. ***\n`);
console.log(`  COVERAGE (UNIVERSE LAW D-535/645 — present, not intended):`);
for (const l of cover) console.log(l);
console.log(`    panel = ${panel.length} ccy-months\n`);
console.log(`  CONSTRUCTION: monthly, rank by carry = (foreign 3m/policy rate - UST 3m); LONG top third, SHORT bottom`);
console.log(`  third, equal-weight, dollar-neutral; return = fx log-move + carry earned; signal dated t, return t->t+1 (lag-1).\n`);
report("ALL — 14-currency book", sAll);
report("DEVELOPED-ONLY (G6+NZD)", sDev);
report("EM-ONLY (MXN/BRL/ZAR/TRY/INR/KRW/CNY)", sEm);

// ---- era split (pre-2015 / post-2015) on all three books
console.log(`  ERA SPLIT (gross annualised %/yr, Sharpe, t, N months):`);
const eras: [string, (m: string) => boolean][] = [["pre-2015 ", (m) => m < "2015-01"], ["post-2015", (m) => m >= "2015-01"]];
for (const [nm, b] of [["ALL", bAll], ["DEV", bDev], ["EM ", bEm]] as [string, Book][]) {
  for (const [en, f] of eras) {
    const idx = b.months.map((m, i) => [m, i] as [string, number]).filter(([m]) => f(m)).map(([, i]) => i);
    if (idx.length < 12) { console.log(`    ${nm} ${en}: ${idx.length} months — UNTESTED (below 12-month floor)`); continue; }
    const rr = idx.map((i) => b.rets[i]);
    const mu = rr.reduce((a, x) => a + x, 0) / rr.length;
    const sdv = Math.sqrt(rr.reduce((a, x) => a + (x - mu) ** 2, 0) / (rr.length - 1));
    console.log(`    ${nm} ${en}: ${(mu * 12 * 100).toFixed(2)}%/yr   SR ${((mu / sdv) * Math.sqrt(12)).toFixed(2)}   t ${(mu / (sdv / Math.sqrt(rr.length))).toFixed(2)}   N=${rr.length}`);
  }
}

// ---- THE SUSPECT OBJECT: pooled level regression ret[t+1] ~ carry[t]
console.log(`\n  POOLED LEVEL REGRESSION ret[t+1] ~ carry[t]  (SUSPECT — carry is a persistent LEVEL, D-730; the t below is`);
console.log(`  a GROSS t (no cost charged, per the COST-INFLATION COROLLARY D-661) and is over-stated anyway because it`);
console.log(`  pools ${nCcy} currencies and ignores serial dependence — reported for completeness only):`);
for (const [nm, rows] of [["ALL", panel], ["DEV", panel.filter((r) => r.grp === "DEV")], ["EM ", panel.filter((r) => r.grp === "EM")]] as [string, Row[]][]) {
  const xs = rows.map((r) => r.carry), ys = rows.map((r) => r.retFwd);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const slope = sxy / sxx, r2 = (sxy * sxy) / (sxx * syy);
  const resid = rows.map((r) => r.retFwd - (my + slope * (r.carry - mx)));
  const s2 = resid.reduce((a, b) => a + b * b, 0) / (rows.length - 2);
  const tSlope = slope / Math.sqrt(s2 / sxx);
  console.log(`    ${nm}: slope ${slope.toFixed(2)}  gross t ${tSlope.toFixed(2)}  R^2 ${(r2 * 100).toFixed(2)}%  n=${rows.length} ccy-months  (UIP-failure predicts slope>0 -> ${slope > 0 ? "MATCHED" : "MISSED"})`);
}

// ---- DECOMPOSITION (Rule 8 / D-590 shape): the portfolio return is POSITIVE while the pooled level slope is
// NEGATIVE. Those are not contradictory only if the portfolio's return comes from the CARRY term that is added, not
// from the fx move. Split the long-short return into its two additive parts and say which one carries it. If the
// spot leg is negative and the carry leg is the whole return, then "high-rate currencies depreciate but not by
// enough" is the finding — and how much is "not enough" is exactly the number below.
console.log(`\n  DECOMPOSITION — long-short return = SPOT leg + CARRY leg (the same book, split additively):`);
function decomp(rows: Row[], minN: number) {
  const byMonth = new Map<string, Row[]>();
  for (const r of rows) { const a = byMonth.get(r.month); if (a) a.push(r); else byMonth.set(r.month, [r]); }
  const spot: number[] = [], cry: number[] = [];
  for (const month of [...byMonth.keys()].sort()) {
    const rs = byMonth.get(month)!.filter((r) => Number.isFinite(r.carry));
    if (rs.length < minN) continue;
    const sorted = [...rs].sort((a, b) => b.carry - a.carry);
    const k = Math.max(1, Math.floor(sorted.length / 3));
    const L = sorted.slice(0, k), S = sorted.slice(sorted.length - k);
    let sp = 0, cr = 0;
    for (const r of L) { sp += r.retFwd / L.length; cr += r.carry / L.length; }
    for (const r of S) { sp -= r.retFwd / S.length; cr -= r.carry / S.length; }
    spot.push(sp); cry.push(cr);
  }
  const mu = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const tt = (a: number[]) => { const m = mu(a); const s = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); return m / (s / Math.sqrt(a.length)); };
  return { sp: mu(spot) * 12 * 100, spT: tt(spot), cr: mu(cry) * 12 * 100, crT: tt(cry) };
}
for (const [nm, rows, mn] of [["ALL", panel, 6], ["DEV", panel.filter((r) => r.grp === "DEV"), 4], ["EM ", panel.filter((r) => r.grp === "EM"), 4]] as [string, Row[], number][]) {
  const d = decomp(rows, mn);
  console.log(`    ${nm}: SPOT ${d.sp.toFixed(2)}%/yr (t ${d.spT.toFixed(2)})  +  CARRY ${d.cr.toFixed(2)}%/yr (t ${d.crT.toFixed(2)})  =  ${(d.sp + d.cr).toFixed(2)}%/yr`);
}
console.log(`    Read this beside the pooled slope above: a NEGATIVE spot leg with a larger POSITIVE carry leg IS the`);
console.log(`    textbook UIP failure, and it also means the entire return is the rate differential being collected —`);
console.log(`    i.e. it is a bet that EM spot does not depreciate by the full differential, paid for by holding EM risk.`);

// ---- VERDICT
const v = (s: Stats | null, nm: string) =>
  !s ? `${nm}: UNTESTED` : Math.abs(s.t) < 2 ? `${nm}: NO SIGNIFICANT CARRY (|t| ${Math.abs(s.t).toFixed(2)} < 2)` : s.net <= 0 ? `${nm}: gross t ${s.t.toFixed(2)} significant but NET ${s.net.toFixed(2)}%/yr <= 0 — SUB-COST` : `${nm}: gross t ${s.t.toFixed(2)}, NET ${s.net.toFixed(2)}%/yr > 0 — survives cost IN-SAMPLE`;
console.log(`\n  VERDICT (per book):`);
console.log(`    ${v(sAll, "ALL")}`);
console.log(`    ${v(sDev, "DEV")}`);
console.log(`    ${v(sEm, "EM ")}`);
const best = [sAll, sDev, sEm].filter((s): s is Stats => !!s).sort((a, b) => Math.abs(b.t) - Math.abs(a.t))[0];
console.log(`\n  VERDICT: ${
  !best ? "UNTESTED — no book had enough months."
  : Math.abs(best.t) < 2 ? `NO SIGNIFICANT CARRY anywhere in this ${nCcy}-name universe (best |t| ${Math.abs(best.t).toFixed(2)} < 2). The D-738 gap is now CLOSED as a data matter, and the answer did not change: the EM extension does not produce a significant carry premium here.`
  : best.net <= 0 ? `carry is gross-significant somewhere (best |t| ${Math.abs(best.t).toFixed(2)}) but SUB-COST at ${RT_BP}bp RT — not an edge.`
  : `carry survives cost in-sample (best |t| ${Math.abs(best.t).toFixed(2)}, NET ${best.net.toFixed(2)}%/yr) BUT breadth=${nCcy} < 50 makes it UNTESTED as a cross-section and it is NOT promotable on this evidence.`
}`);
console.log(`  DESCRIPTIVE ONLY (breadth floor + EM rate leg is a research proxy, not a placeable NDF/forward). No gate`);
console.log(`  cleared, no forward clock started, no lineage row written.`);
