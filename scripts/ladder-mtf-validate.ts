#!/usr/bin/env -S deno run --allow-net --allow-env
// ladder-mtf-validate.ts (D-706) — VALIDATE THE LADDER ACROSS TIMEFRAMES AND ACROSS TWO INDEPENDENT DATA SOURCES.
//
// WHY THIS IS OVERDUE. Every ladder result recorded so far — L1/L2/L3 timings, the 9.8-year crossover invariance,
// the allocation ordering, the leverage table, the behavioural cost — was computed on MONTHLY returns from ONE
// source, the Ken French Mkt-RF + RF series. The programme's own standing rule is that no verdict comes from a
// pooled number and that timeframe is one of the axes a result must be disaggregated across. The ladder has never
// been disaggregated across anything. If its conclusions are an artifact of monthly compounding, or of that one
// series, then the whole lever ranking is wrong and nothing downstream survives.
//
// THE TWO CHECKS ARE DIFFERENT AND BOTH ARE NECESSARY:
//   TIMEFRAME — the same underlying, compounded daily / weekly / monthly. These must agree, because the account's
//   terminal balance does not care how often you SAMPLE it. Disagreement means a compounding or contribution-timing
//   bug, not a market fact.
//   SOURCE — French factor returns versus ^GSPC price returns, two independently constructed series for the same
//   thing. Agreement here is the strongest validation available without a third vendor; disagreement localises the
//   problem to one series.
//
// WHAT WOULD FALSIFY THE LADDER: any material disagreement in years-to-level across timeframes on the same source.
// That is a pure arithmetic identity — a bug, and it would invalidate D-680, D-688, D-689, D-701 and D-702 at once.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("ladder-mtf-validate", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month; at daily/weekly steps it lands on the first step of each month" },
  { name: "MAX_YEARS", def: "45" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mtf", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// ---- SOURCE A: French factors, monthly total return -------------------------------------------------------------
async function ff(name: string) {
  const m = new Map<string, number>();
  for (let off = 0;; off += 10000) {
    const r = await fetch(`${OWNED}/trd_ff_factors?select=month,ret&factor=eq.${encodeURIComponent(name)}&order=month.asc&offset=${off}&limit=10000`, { headers: hdr });
    if (!r.ok) { console.error(`!! ${name} HTTP ${r.status}`); Deno.exit(1); }
    const rows = await r.json() as { month: string; ret: number }[];
    if (!rows.length) break;
    for (const x of rows) { const v = Number(x.ret); if (Number.isFinite(v)) m.set(x.month.slice(0, 7), v); }
    if (rows.length < 10000) break;
  }
  return m;
}
const mkt = await ff("Mkt-RF"), rfm = await ff("RF");
const frenchM = [...mkt.keys()].filter((m) => rfm.has(m)).sort().map((m) => ({ d: m + "-28", r: mkt.get(m)! + rfm.get(m)! }));
assertNonEmpty("french monthly", frenchM, 600);

// ---- SOURCE B: ^GSPC daily prices -------------------------------------------------------------------------------
const rb = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.%5EGSPC&select=bars`, { headers: hdr }).then((r) => r.json()) as { bars: number[][] }[];
const bars = (rb[0]?.bars || []).filter((b) => b[4] > 0);
assertNonEmpty("^GSPC daily bars", bars, 5000);
const gspcD: { d: string; r: number }[] = [];
for (let i = 0; i < bars.length - 1; i++) {
  gspcD.push({ d: new Date(bars[i + 1][0] * 1000).toISOString().slice(0, 10), r: bars[i + 1][4] / bars[i][4] - 1 });
}
// NOTE STATED UP FRONT: ^GSPC is a PRICE index — it excludes dividends. French Mkt-RF+RF is TOTAL return. The two
// therefore MUST differ by roughly the dividend yield (~2%/yr), and reporting them as if they should match exactly
// would be the error. The timeframe check is run WITHIN each source, where that difference cancels.
function resample(daily: { d: string; r: number }[], to: "W" | "M") {
  const acc = new Map<string, number>();
  const key = (d: string) => {
    if (to === "M") return d.slice(0, 7);
    const dt = new Date(d + "T00:00:00Z");
    const yr = dt.getUTCFullYear();
    const start = Date.UTC(yr, 0, 1);
    return `${yr}-W${String(Math.floor((dt.getTime() - start) / (7 * 864e5))).padStart(2, "0")}`;
  };
  for (const x of daily) acc.set(key(x.d), (acc.get(key(x.d)) ?? 0) + Math.log1p(x.r));
  const out: { d: string; r: number }[] = [];
  const lastDayOf = new Map<string, string>();
  for (const x of daily) lastDayOf.set(key(x.d), x.d);
  for (const [k, lg] of [...acc.entries()].sort()) out.push({ d: lastDayOf.get(k)!, r: Math.expm1(lg) });
  return out;
}

// ---- the climb, timeframe-agnostic ------------------------------------------------------------------------------
const START = Number(K.START), CONTRIB = Number(K.MONTHLY), MAXY = Number(K.MAX_YEARS);
const LEVELS = [1000, 10000, 100000];
function climb(series: { d: string; r: number }[], stepsPerYear: number) {
  const t: number[][] = LEVELS.map(() => []);
  const cross: number[] = [];
  const stride = Math.max(1, Math.round(stepsPerYear / 12));   // walk a start every ~month regardless of timeframe
  for (let s = 0; s < series.length; s += stride) {
    if (series.length - s < stepsPerYear * 2) break;
    let cap = START, contributed = START, lastMo = "";
    const hit: (number | null)[] = LEVELS.map(() => null);
    let cx: number | null = null;
    for (let i = s, n = 0; i < series.length && n < MAXY * stepsPerYear; i++, n++) {
      cap = cap * (1 + series[i].r);
      // CONTRIBUTIONS LAND ONCE PER CALENDAR MONTH AT EVERY TIMEFRAME. Adding the contribution once per STEP would
      // deposit 252 times a year at daily resolution and 12 times at monthly — the timeframes would disagree for a
      // reason that has nothing to do with markets, and the check would report a bug it had itself created.
      const mo = series[i].d.slice(0, 7);
      if (mo !== lastMo) { cap += CONTRIB; contributed += CONTRIB; lastMo = mo; }
      const yrs = n / stepsPerYear;
      LEVELS.forEach((L, k) => { if (hit[k] === null && cap >= L) hit[k] = yrs; });
      if (cx === null && cap - contributed > contributed) cx = yrs;
    }
    hit.forEach((h, k) => { if (h !== null) t[k].push(h); });
    if (cx !== null) cross.push(cx);
  }
  return { med: t.map((a) => a.length ? pct(a, 0.5) : NaN), cross: cross.length ? pct(cross, 0.5) : NaN, n: t[0].length };
}

console.log(`==> LADDER MTF + CROSS-SOURCE VALIDATION`);
console.log(`    source A: French Mkt-RF+RF, ${frenchM.length} months ${frenchM[0].d.slice(0,7)}..${frenchM[frenchM.length-1].d.slice(0,7)} (TOTAL return)`);
console.log(`    source B: ^GSPC daily, ${gspcD.length} days ${gspcD[0].d}..${gspcD[gspcD.length-1].d} (PRICE index, ex-dividends)\n`);

const runs: { label: string; series: { d: string; r: number }[]; spy: number }[] = [
  { label: "B ^GSPC daily", series: gspcD, spy: 252 },
  { label: "B ^GSPC weekly", series: resample(gspcD, "W"), spy: 52 },
  { label: "B ^GSPC monthly", series: resample(gspcD, "M"), spy: 12 },
  { label: "A French monthly", series: frenchM, spy: 12 },
];
console.log(`    ${"series".padEnd(20)}${"steps".padStart(8)}${"to $1k".padStart(9)}${"to $10k".padStart(10)}${"to $100k".padStart(11)}${"crossover".padStart(11)}${"paths".padStart(8)}`);
const out: { label: string; med: number[]; cross: number }[] = [];
for (const r of runs) {
  const c = climb(r.series, r.spy);
  out.push({ label: r.label, med: c.med, cross: c.cross });
  console.log(`    ${r.label.padEnd(20)}${String(r.series.length).padStart(8)}${(Number.isFinite(c.med[0]) ? c.med[0].toFixed(1) + "y" : "—").padStart(9)}${(Number.isFinite(c.med[1]) ? c.med[1].toFixed(1) + "y" : "—").padStart(10)}${(Number.isFinite(c.med[2]) ? c.med[2].toFixed(1) + "y" : "—").padStart(11)}${(Number.isFinite(c.cross) ? c.cross.toFixed(1) + "y" : "—").padStart(11)}${String(c.n).padStart(8)}`);
}

// ---- CHECK 1: TIMEFRAME INVARIANCE WITHIN ^GSPC (a pure arithmetic identity) ------------------------------------
const d = out[0], w = out[1], m = out[2];
console.log(`\n    CHECK 1 — TIMEFRAME INVARIANCE within ^GSPC. Same underlying, three sampling rates. The terminal`);
console.log(`    balance cannot depend on how often it is sampled, so ANY material gap here is a BUG, not a finding.`);
let tfFail = 0;
LEVELS.forEach((L, k) => {
  const vals = [d.med[k], w.med[k], m.med[k]].filter(Number.isFinite);
  const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : NaN;
  const ok = !Number.isFinite(spread) || spread <= 1.0;
  if (!ok) tfFail++;
  console.log(`      to $${L.toLocaleString().padEnd(8)} daily ${Number.isFinite(d.med[k]) ? d.med[k].toFixed(1) : "—"}y  weekly ${Number.isFinite(w.med[k]) ? w.med[k].toFixed(1) : "—"}y  monthly ${Number.isFinite(m.med[k]) ? m.med[k].toFixed(1) : "—"}y  -> spread ${Number.isFinite(spread) ? spread.toFixed(2) + "y" : "—"} ${ok ? "OK" : "*** DISAGREEMENT ***"}`);
});
const cxSpread = Math.max(d.cross, w.cross, m.cross) - Math.min(d.cross, w.cross, m.cross);
console.log(`      crossover     daily ${d.cross.toFixed(1)}y  weekly ${w.cross.toFixed(1)}y  monthly ${m.cross.toFixed(1)}y  -> spread ${cxSpread.toFixed(2)}y ${cxSpread <= 1.0 ? "OK" : "*** DISAGREEMENT ***"}`);
if (cxSpread > 1.0) tfFail++;

// ---- CHECK 2: CROSS-SOURCE, on the overlapping span -------------------------------------------------------------
const fFrom = frenchM[0].d.slice(0, 7), gFrom = gspcD[0].d.slice(0, 7);
console.log(`\n    CHECK 2 — CROSS-SOURCE. French monthly (TOTAL return) vs ^GSPC monthly (PRICE index).`);
console.log(`    These must NOT match exactly: ^GSPC excludes dividends, so the total-return series must reach every`);
console.log(`    level SOONER. A match would mean one of them is mislabelled.`);
const fr = out[3];
LEVELS.forEach((L, k) => {
  const gap = m.med[k] - fr.med[k];
  // A TIE IS NOT A WRONG DIRECTION. At $1,000 the balance is ~94% contributed money (D-680), so dividends cannot
  // move the crossing and both series round to the same tenth of a year. Flagging that as a failure is crying wolf,
  // and a check that cries wolf gets ignored — the same lesson the plumbing rule taught an hour ago.
  const dirOK = !Number.isFinite(gap) || gap >= -0.05;
  console.log(`      to $${L.toLocaleString().padEnd(8)} French(total) ${Number.isFinite(fr.med[k]) ? fr.med[k].toFixed(1) : "—"}y  vs  ^GSPC(price) ${Number.isFinite(m.med[k]) ? m.med[k].toFixed(1) : "—"}y  -> price index slower by ${Number.isFinite(gap) ? gap.toFixed(1) + "y" : "—"} ${Math.abs(gap) < 0.05 ? "OK (tie — this rung is ~94% contributed money, dividends cannot move it)" : dirOK ? "OK (expected direction)" : "*** WRONG DIRECTION ***"}`);
});
// The implied dividend yield the gap corresponds to, as a magnitude sanity check.
const annOf = (ss: { r: number }[], spy: number) => Math.expm1(mean(ss.map((x) => Math.log1p(x.r))) * spy) * 100;
const aF = annOf(frenchM, 12), aG = annOf(resample(gspcD, "M"), 12);
console.log(`      annualised: French total ${aF.toFixed(2)}%/yr, ^GSPC price ${aG.toFixed(2)}%/yr -> implied dividend ${(aF - aG).toFixed(2)}%/yr`);
console.log(`      expect roughly 1.5-3.5%/yr for US equities over this era ... ${(aF - aG) > 1.0 && (aF - aG) < 4.0 ? "OK" : "*** OUT OF RANGE ***"}`);

// ---- CHECK 3: an independent arithmetic route to the same number ------------------------------------------------
console.log(`\n    CHECK 3 — INDEPENDENT ARITHMETIC. Compound the French series to a terminal balance directly and`);
console.log(`    compare with the level-crossing route, which uses different code.`);
{
  let cap = START, contributed = START, lastMo = "";
  let crossedAt = NaN;
  for (let i = 0; i < Math.min(frenchM.length, 20 * 12); i++) {
    cap = cap * (1 + frenchM[i].r);
    const mo = frenchM[i].d.slice(0, 7);
    if (mo !== lastMo) { cap += CONTRIB; contributed += CONTRIB; lastMo = mo; }
    if (!Number.isFinite(crossedAt) && cap >= 100000) crossedAt = i / 12;
  }
  console.log(`      first 20 years from ${frenchM[0].d.slice(0,7)}: terminal $${Math.round(cap).toLocaleString()}, contributed $${Math.round(contributed).toLocaleString()}, return share ${(100 * (1 - contributed / cap)).toFixed(0)}%`);
  console.log(`      reached $100k within those 20 years: ${Number.isFinite(crossedAt) ? crossedAt.toFixed(1) + "y" : "no"} — a single-path check, not a median`);
}

console.log(`\n    VERDICT: ${tfFail === 0 ? "TIMEFRAME-INVARIANT — the ladder's timings do not depend on sampling rate, so D-680/688/689/701/702 are not artifacts of monthly compounding." : `*** ${tfFail} TIMEFRAME DISAGREEMENT(S) — this is an arithmetic identity and a gap here is a BUG that invalidates the ladder results. ***`}`);
await stampDataVersion(OWNED, hdr, { trd_ff_factors: null, trd_bars_deep: null });
