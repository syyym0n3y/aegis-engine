#!/usr/bin/env -S deno run --allow-net --allow-env
// passive-allocation-ladder.ts (D-689) — the one lever on the ladder that needs no edge, and has never been tested.
//
// WHERE THIS SITS. D-679 found the only candidate whose capital band spans L0-L3 is the passive benchmark. D-680
// measured the climb on it. D-688 showed the deposit-dominated phase is ~9.8 years and cannot be shortened by
// depositing more. That leaves four levers: deposits (raises the level, not the phase), starting capital (shortens
// the phase), return (nothing in 1,059 specs clears the bar), and COST (D-686, improved, revealed nothing).
//
// A FIFTH WAS NEVER EXAMINED: WHICH passive holding. Every ladder result here assumed "the US total market" as
// though it were the only zero-borrow, fractional-share, $1-floor option. It is not, and asset allocation is the one
// choice that demonstrably moves long-horizon outcomes without requiring anybody to have an edge.
//
// THIS IS NOT AN EDGE CLAIM AND MUST NOT BECOME ONE. Every candidate below is a fixed-weight, publicly-listed,
// monthly-rebalanced basket. No forecasting, no timing, no conditioning — D-649 already measured the trend overlay
// costing ~5.7pp/yr, and this deliberately does not go there. The question is narrow: among holdings an account can
// actually buy at any size, does the CHOICE change the climb, and by how much.
//
// THE SPAN IS THE LIMITATION AND IS STATED FIRST. A 60/40 needs a bond series, and TLT starts 2002-07; EEM 2003-04.
// The common span is therefore ~22 years, not the 63 the single-asset ladder had (D-680). That is long enough to
// contain 2008 and 2020 — the two worst drawdowns of the era — and NOT long enough to settle L3, which is reported
// as censored rather than as failure. Anyone reading a 22-year answer as a 60-year answer is the error this
// paragraph exists to prevent.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("passive-allocation-ladder", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month" },
  { name: "COST_BP", def: "3", note: "round trip, charged on TURNOVER only (D-686), not per rebalance" },
  { name: "ER_BP", def: "5", note: "blended expense ratio, bp/yr — a permanent turnover-independent drag" },
  { name: "MAX_YEARS", def: "30" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pal", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// Fixed-weight baskets. Every constituent is a listed US ETF: fractional-share tradable, no borrow, no margin,
// no minimum beyond one share's fraction — THE INSTRUMENT LAW satisfied by construction rather than by assumption.
const PORTFOLIOS: { name: string; w: Record<string, number>; note: string }[] = [
  { name: "US total", w: { SPY: 1 }, note: "the benchmark every ladder result so far assumed" },
  { name: "US 60/40", w: { SPY: 0.6, IEF: 0.4 }, note: "the default advice" },
  { name: "US 80/20", w: { SPY: 0.8, IEF: 0.2 }, note: "a younger tilt" },
  { name: "global eq", w: { SPY: 0.6, EFA: 0.25, EEM: 0.15 }, note: "cap-ish global equity" },
  { name: "global 60/40", w: { SPY: 0.36, EFA: 0.15, EEM: 0.09, IEF: 0.4 }, note: "global equity + duration" },
  { name: "eq+gold", w: { SPY: 0.8, GLD: 0.2 }, note: "one real-asset sleeve" },
  { name: "4-way", w: { SPY: 0.4, IEF: 0.3, GLD: 0.15, EFA: 0.15 }, note: "diversified, no forecast" },
  { name: "US small tilt", w: { SPY: 0.7, IWM: 0.3 }, note: "size tilt, long-only, no borrow" },
];

const SYMS = [...new Set(PORTFOLIOS.flatMap((p) => Object.keys(p.w)))];
const series = new Map<string, Map<string, number>>();
for (const s of SYMS) {
  const rb = await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(s)}&select=bars`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { bars: number[][] }[];
  const bars = (rb[0]?.bars || []).filter((b) => b[4] > 0);
  const mo = new Map<string, number>();
  for (let i = 0; i < bars.length - 1; i++) {
    const m = new Date(bars[i + 1][0] * 1000).toISOString().slice(0, 7);
    mo.set(m, (mo.get(m) ?? 0) + Math.log(bars[i + 1][4] / bars[i][4]));
  }
  const r = new Map<string, number>();
  for (const [m, lg] of mo) r.set(m, Math.expm1(lg));
  series.set(s, r);
  console.log(`    ${s.padEnd(6)} ${String(r.size).padStart(4)} months  ${[...r.keys()].sort()[0]} .. ${[...r.keys()].sort().slice(-1)[0]}`);
}

// Common span: a portfolio is only as long as its shortest constituent, and comparing portfolios over DIFFERENT
// spans would compare eras, not allocations. One span for all of them.
const commonMonths = [...series.get(SYMS[0])!.keys()]
  .filter((m) => SYMS.every((s) => series.get(s)!.has(m))).sort();
assertNonEmpty("common months across every constituent", commonMonths, 180);
console.log(`\n==> PASSIVE ALLOCATION LADDER — common span ${commonMonths[0]} .. ${commonMonths[commonMonths.length - 1]} (${commonMonths.length} months, ${(commonMonths.length / 12).toFixed(1)} years)`);
console.log(`    start $${K.START}  contribution $${K.MONTHLY}/mo  cost ${K.COST_BP}bp on turnover  expense ${K.ER_BP}bp/yr`);

// POSITIVE CONTROL. A mis-assembled basket produces a clean, plausible, wrong ranking. SPY over this span must look
// like the US market, and the 60/40 must have visibly lower volatility than 100% equity or the weights are not being
// applied. The run ABORTS rather than reporting a ranking built on a broken series.
const spyR = commonMonths.map((m) => series.get("SPY")!.get(m)!);
const spyAnn = Math.expm1(mean(spyR.map((r) => Math.log1p(r))) * 12) * 100;
const spyVol = sd(spyR) * Math.sqrt(12) * 100;
console.log(`\n    POSITIVE CONTROL over the common span:`);
console.log(`      SPY total return ${spyAnn.toFixed(2)}%/yr, vol ${spyVol.toFixed(2)}%  — expect 7-14 / 13-20  ${spyAnn > 7 && spyAnn < 14 && spyVol > 13 && spyVol < 20 ? "PASS" : "FAIL"}`);
const p6040 = commonMonths.map((m) => 0.6 * series.get("SPY")!.get(m)! + 0.4 * series.get("IEF")!.get(m)!);
const vol6040 = sd(p6040) * Math.sqrt(12) * 100;
console.log(`      60/40 vol ${vol6040.toFixed(2)}% must be BELOW SPY's ${spyVol.toFixed(2)}% ................. ${vol6040 < spyVol ? "PASS" : "FAIL"}`);
if (!(spyAnn > 7 && spyAnn < 14 && spyVol > 13 && spyVol < 20 && vol6040 < spyVol)) {
  console.log(`\n    CONTROL FAILED — the baskets are not what they claim. Nothing below would mean anything. ABORTING.`);
  Deno.exit(1);
}
console.log(`      PASS — weights are being applied and the series is the market.`);

const START = Number(K.START), MONTHLY = Number(K.MONTHLY);
const COST = Number(K.COST_BP) / 1e4, ER = Number(K.ER_BP) / 1e4, MAXY = Number(K.MAX_YEARS);
const LEVELS = [1000, 10000, 100000];
const LABEL = ["$1k", "$10k", "$100k"];

interface Res { name: string; ann: number; vol: number; sharpe: number; maxDD: number; uwY: number;
  hit: (number | null)[][]; crossover: number[]; turnover: number }

const results: Res[] = [];
for (const p of PORTFOLIOS) {
  const names = Object.keys(p.w);
  // Monthly rebalance back to fixed weights. Turnover is the drift the rebalance has to undo, which is small for a
  // fixed-weight basket — charging a full round trip every month would be the D-686 error repeated here.
  const rets: number[] = [], turns: number[] = [];
  for (const m of commonMonths) {
    let r = 0;
    for (const s of names) r += p.w[s] * series.get(s)!.get(m)!;
    // post-drift weights, then the L1 distance back to target = one-way turnover
    let tw = 0;
    for (const s of names) {
      const drifted = p.w[s] * (1 + series.get(s)!.get(m)!) / (1 + r);
      tw += Math.abs(drifted - p.w[s]);
    }
    const oneway = tw / 2;
    turns.push(oneway);
    rets.push(r - 2 * oneway * COST - ER / 12);
  }
  const ann = Math.expm1(mean(rets.map((x) => Math.log1p(x))) * 12) * 100;
  const vol = sd(rets) * Math.sqrt(12) * 100;

  let cum = 1, pk = 1, dd = 0, uw = 0, longestUW = 0;
  for (const x of rets) { cum *= 1 + x; pk = Math.max(pk, cum); const d = cum / pk - 1; dd = Math.min(dd, d); uw = d < -1e-9 ? uw + 1 : 0; longestUW = Math.max(longestUW, uw); }

  // walk every start month
  const hit: (number | null)[][] = [];
  const crossover: number[] = [];
  for (let s = 0; s < rets.length; s++) {
    if (rets.length - s < 24) break;
    let cap = START, contributed = START;
    const h: (number | null)[] = LEVELS.map(() => null);
    let cross: number | null = null;
    for (let i = s, mo = 0; i < rets.length && mo < MAXY * 12; i++, mo++) {
      cap = cap * (1 + rets[i]) + MONTHLY;
      contributed += MONTHLY;
      LEVELS.forEach((L, k) => { if (h[k] === null && cap >= L) h[k] = mo / 12; });
      if (cross === null && cap - contributed > contributed) cross = mo / 12;
    }
    hit.push(h);
    if (cross !== null) crossover.push(cross);
  }
  results.push({ name: p.name, ann, vol, sharpe: (ann - 2) / vol, maxDD: dd * 100, uwY: longestUW / 12, hit, crossover, turnover: mean(turns) });
}
assertNonEmpty("portfolios evaluated", results, 4);

console.log(`\n    ${"portfolio".padEnd(14)}${"%/yr".padStart(8)}${"vol".padStart(7)}${"SR".padStart(6)}${"maxDD".padStart(8)}${"UW yr".padStart(7)}${"turn/mo".padStart(9)}`);
for (const r of results) {
  console.log(`    ${r.name.padEnd(14)}${r.ann.toFixed(2).padStart(8)}${r.vol.toFixed(1).padStart(7)}${r.sharpe.toFixed(2).padStart(6)}${(r.maxDD.toFixed(0) + "%").padStart(8)}${r.uwY.toFixed(1).padStart(7)}${(100 * r.turnover).toFixed(2).padStart(8)}%`);
}

console.log(`\n    MEDIAN YEARS TO EACH RUNG, and how many eligible paths never arrive:`);
console.log(`    ${"portfolio".padEnd(14)}${LABEL.map((l) => l.padStart(11)).join("")}${"crossover".padStart(11)}`);
for (const r of results) {
  const cells = LEVELS.map((_, k) => {
    const got = r.hit.map((h) => h[k]).filter((x): x is number => x !== null);
    if (!got.length) return "—".padStart(11);
    const med = pct(got, 0.5);
    const eligible = r.hit.filter((_, i) => (r.hit.length - i) / 12 >= med).length;
    const fail = eligible - got.filter((_, i) => i < eligible).length;
    return `${med.toFixed(1)}y${fail > 0 ? `/${fail}f` : ""}`.padStart(11);
  });
  const cx = r.crossover.length ? `${pct(r.crossover, 0.5).toFixed(1)}y` : "never";
  console.log(`    ${r.name.padEnd(14)}${cells.join("")}${cx.padStart(11)}`);
}

const base = results.find((r) => r.name === "US total")!;
console.log(`\n    AGAINST THE BENCHMARK EVERY EARLIER LADDER RESULT ASSUMED (US total):`);
console.log(`    ${"portfolio".padEnd(14)}${"d %/yr".padStart(9)}${"d SR".padStart(8)}${"d maxDD".padStart(10)}${"d UW yr".padStart(9)}${"d crossover".padStart(13)}`);
for (const r of results) {
  if (r.name === base.name) continue;
  const cx = r.crossover.length ? pct(r.crossover, 0.5) : NaN;
  const cb = base.crossover.length ? pct(base.crossover, 0.5) : NaN;
  console.log(`    ${r.name.padEnd(14)}${(r.ann - base.ann).toFixed(2).padStart(9)}${(r.sharpe - base.sharpe).toFixed(2).padStart(8)}${((r.maxDD - base.maxDD).toFixed(0) + "pp").padStart(10)}${(r.uwY - base.uwY).toFixed(1).padStart(9)}${(Number.isFinite(cx) && Number.isFinite(cb) ? (cx - cb).toFixed(1) + "y" : "—").padStart(13)}`);
}

console.log(`\n    THE SPAN IS ${(commonMonths.length / 12).toFixed(1)} YEARS. That settles L1 and L2 and does NOT settle L3, which needs ~20.`);
console.log(`    It contains 2008 and 2020, so it is a hard span rather than a short easy one — but a single span is`);
console.log(`    a single draw, and an allocation ranking measured on one 22-year window is not a durable ordering.`);
await stampDataVersion(OWNED, hdr, { trd_bars_deep: null });
