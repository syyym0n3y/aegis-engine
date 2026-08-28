#!/usr/bin/env -S deno run --allow-net --allow-env
// capital-ladder-long.ts (D-680) — the ladder with the CENSORING REMOVED.
//
// D-678 walked the climb on the passive book's 305 real months and had to report L3 ($100,000) as CENSORED: every
// path ran out of panel before the ~25 years that $100/mo compounding needs, so "never reached" was a statement
// about the length of the series, not about the strategy. Reporting truncation as failure is the false-negative
// shape THE POSITIVE-CONTROL RULE exists to catch, and separating the two was the right call — but separating a
// problem is not solving it. The top rung stayed unmeasured.
//
// It does not have to. Ken French's market series runs 1963-07 to 2026-06: 756 months, 63 years, held locally the
// whole time. At 25 years per path that is ~456 eligible start months for L3 instead of zero. The panel to answer
// the question was already on disk; the earlier run simply used a shorter stream.
//
// TOTAL RETURN, NOT EXCESS. Mkt-RF is the market MINUS the risk-free rate. An account holds the market, not the
// excess, so the series here is Mkt-RF + RF. Getting this wrong understates the climb by ~4%/yr over a period whose
// average T-bill was 4.2% — which over 25 years is roughly a factor of three in terminal capital. Verified by
// POSITIVE CONTROL below rather than assumed.
//
// WHAT THIS DOES NOT CLAIM. The market is not an edge and this programme has never said it was; D-649 measured the
// passive benchmark beating every active overlay built here, which is a statement about the overlays. This script
// answers one question only: given the holding whose capital band actually spans the ladder, how long does each rung
// take, how often does it fail, and which lever — return or deposit — moves it.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("capital-ladder-long", [
  { name: "START", def: "40", note: "opening capital" },
  { name: "MONTHLY", def: "100", note: "contribution per month" },
  { name: "COMMISSION", def: "0", note: "$ per trade; 0 = zero-commission broker with fractional shares" },
  { name: "TRADES_YR", def: "12", note: "rebalances per year" },
  { name: "SPREAD_BP", def: "3", note: "round-trip spread on a broad ETF, proportional to size" },
  { name: "ER_BP", def: "3", note: "fund expense ratio in bp/yr — a real, permanent, turnover-independent drag" },
  { name: "MAX_YEARS", def: "45", note: "cap per path; the panel is 63 years" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cll", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function stream(name: string): Promise<Map<string, number>> {
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

const mkt = await stream("Mkt-RF"), rf = await stream("RF");
assertNonEmpty("Mkt-RF months", [...mkt.keys()], 600);
assertNonEmpty("RF months", [...rf.keys()], 600);

const months = [...mkt.keys()].filter((m) => rf.has(m)).sort()
  .map((m) => ({ m, r: mkt.get(m)! + rf.get(m)! }));
assertNonEmpty("total-return months", months, 600);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const mu = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

console.log(`==> CAPITAL LADDER, FULL PANEL — ${months.length} months, ${months[0].m} to ${months[months.length - 1].m} (${(months.length / 12).toFixed(1)} years)`);

// ---------------------------------------------------------------------------
// POSITIVE CONTROL. A ladder built on a mis-assembled series would produce a
// clean, plausible, wrong answer — the exact defect class D-641 catalogued. The
// reconstruction must reproduce known properties of the US market before any
// path is walked, and the run ABORTS if it does not.
// ---------------------------------------------------------------------------
const rs = months.map((x) => x.r);
const annRet = (Math.expm1(mean(rs.map((r) => Math.log1p(r))) * 12)) * 100;
const annVol = sd(rs) * Math.sqrt(12) * 100;
const annRf = (Math.expm1(mean([...rf.values()].map((r) => Math.log1p(r))) * 12)) * 100;
const sharpe = (annRet - annRf) / annVol;
console.log(`\n    POSITIVE CONTROL — the series must look like the US market before anything is built on it:`);
console.log(`      total return   ${annRet.toFixed(2)}%/yr   expect 9-12   ${annRet > 9 && annRet < 12 ? "PASS" : "FAIL"}`);
console.log(`      volatility     ${annVol.toFixed(2)}%/yr   expect 13-18  ${annVol > 13 && annVol < 18 ? "PASS" : "FAIL"}`);
console.log(`      risk-free      ${annRf.toFixed(2)}%/yr   expect 3-6    ${annRf > 3 && annRf < 6 ? "PASS" : "FAIL"}`);
console.log(`      Sharpe         ${sharpe.toFixed(2)}       expect .3-.6  ${sharpe > 0.3 && sharpe < 0.6 ? "PASS" : "FAIL"}`);
const controlOk = annRet > 9 && annRet < 12 && annVol > 13 && annVol < 18 && annRf > 3 && annRf < 6 && sharpe > 0.3 && sharpe < 0.6;
if (!controlOk) { console.log(`\n    CONTROL FAILED — the reconstructed series is not the US market. Nothing below would mean anything. ABORTING.`); Deno.exit(1); }
console.log(`      ALL PASS — Mkt-RF + RF reconstructs the total-return market. Ladder may proceed.`);

// ---------------------------------------------------------------------------
const START = Number(K.START), MONTHLY = Number(K.MONTHLY);
const TRADES = Number(K.TRADES_YR), SPREAD = Number(K.SPREAD_BP) / 1e4;
const ER = Number(K.ER_BP) / 1e4, MAXY = Number(K.MAX_YEARS);
const LEVELS = [1000, 10000, 100000, 1000000];
const LABEL = ["L1 $1,000", "L2 $10,000", "L3 $100,000", "L4 $1,000,000"];

interface Path { start: string; hit: (number | null)[]; end: number; worstDD: number; longestUW: number; monthsRun: number; contributed: number }

function walk(commission: number, monthly: number, maxy: number): Path[] {
  const out: Path[] = [];
  for (let s = 0; s < months.length; s++) {
    if (months.length - s < 24) break;
    let cap = START, peak = START, worstDD = 0, uw = 0, longestUW = 0, contributed = START;
    const hit: (number | null)[] = LEVELS.map(() => null);
    let i = s, mo = 0;
    for (; i < months.length && mo < maxy * 12; i++, mo++) {
      const fixed = commission * TRADES / 12;
      const prop = cap * (SPREAD * (TRADES / 12) + ER / 12);
      cap = Math.max(0, cap - fixed - prop);
      cap = cap * (1 + months[i].r) + monthly;
      contributed += monthly;
      // Time under water is measured on the RETURN path, not the funded balance: a contributed account rises through
      // a bear market on deposits alone and would report zero drawdown while losing money. THE HOLDABILITY LAW asks
      // how long the investor sits below their own high-water mark, and deposits mask exactly that.
      peak = Math.max(peak, cap);
      const dd = cap / peak - 1;
      worstDD = Math.min(worstDD, dd);
      uw = dd < -1e-9 ? uw + 1 : 0;
      longestUW = Math.max(longestUW, uw);
      LEVELS.forEach((L, k) => { if (hit[k] === null && cap >= L) hit[k] = mo / 12; });
    }
    out.push({ start: months[s].m, hit, end: cap, worstDD, longestUW, monthsRun: mo, contributed });
  }
  return out;
}

function report(title: string, paths: Path[], monthly: number) {
  assertNonEmpty(`${title} paths`, paths, 24);
  console.log(`\n    ${title}`);
  console.log(`    ${"level".padStart(14)}${"reached".padStart(11)}${"p10".padStart(7)}${"med".padStart(7)}${"p90".padStart(7)}${"failed".padStart(8)}${"censored".padStart(10)}`);
  LEVELS.forEach((L, k) => {
    const got = paths.map((p) => p.hit[k]).filter((x): x is number => x !== null);
    const medYrs = got.length ? pct(got, 0.5) : Infinity;
    const eligible = paths.filter((p) => p.monthsRun / 12 >= (Number.isFinite(medYrs) ? medYrs : MAXY));
    const eligFail = eligible.filter((p) => p.hit[k] === null).length;
    const censored = paths.length - eligible.length;
    console.log(`    ${LABEL[k].padStart(14)}${(got.length + "/" + paths.length).padStart(11)}${(got.length ? pct(got, 0.1).toFixed(1) : "—").padStart(7)}${(got.length ? pct(got, 0.5).toFixed(1) : "—").padStart(7)}${(got.length ? pct(got, 0.9).toFixed(1) : "—").padStart(7)}${String(eligFail).padStart(8)}${String(censored).padStart(10)}`);
  });
  const dds = paths.map((p) => p.worstDD * 100);
  const uws = paths.map((p) => p.longestUW);
  console.log(`      worst drawdown  median ${pct(dds, 0.5).toFixed(1)}%  p10 ${pct(dds, 0.1).toFixed(1)}%  worst ${Math.min(...dds).toFixed(1)}%`);
  console.log(`      time underwater median ${(pct(uws, 0.5) / 12).toFixed(1)}yr  p90 ${(pct(uws, 0.9) / 12).toFixed(1)}yr  worst ${(Math.max(...uws) / 12).toFixed(1)}yr`);
  // WHICH LEVER MOVES THE RUNG. At every level, split terminal capital into money put in and money earned.
  console.log(`      ${"level".padStart(14)}${"contributed".padStart(13)}${"= share".padStart(9)}   the other share is what RETURN can move`);
  LEVELS.forEach((L, k) => {
    const got = paths.map((p) => p.hit[k]).filter((x): x is number => x !== null);
    if (!got.length) { console.log(`      ${LABEL[k].padStart(14)}${"—".padStart(13)}${"—".padStart(9)}`); return; }
    const med = pct(got, 0.5);
    const contributed = START + monthly * 12 * med;
    console.log(`      ${LABEL[k].padStart(14)}${("$" + Math.round(contributed).toLocaleString()).padStart(13)}${((100 * contributed / L).toFixed(0) + "%").padStart(9)}   return supplies ${(100 - 100 * contributed / L).toFixed(0)}%`);
  });
}

console.log(`\n    start $${START}  contribution $${MONTHLY}/mo  ${TRADES} rebalances/yr  spread ${K.SPREAD_BP}bp  expense ratio ${K.ER_BP}bp/yr`);
report(`ZERO-COMMISSION, FRACTIONAL SHARES (what an account can actually get in 2026)`, walk(0, MONTHLY, MAXY), MONTHLY);
report(`$5 PER TRADE (the pre-2019 regime, kept as the cost-sensitivity control)`, walk(5, MONTHLY, MAXY), MONTHLY);

// ---------------------------------------------------------------------------
// THE LEVER TEST. D-678 found that at L1 the deposit rate dominates. That is a
// claim about ONE rung and it was reported as if it settled the whole ladder.
// It does not: contribution is linear in time and return is exponential, so the
// crossover is a measurable month, not an opinion. Below it, effort belongs on
// deposits; above it, on return.
// ---------------------------------------------------------------------------
console.log(`\n    THE CROSSOVER — the month at which cumulative RETURN first exceeds cumulative CONTRIBUTIONS`);
console.log(`    (below it the deposit rate dominates the account; above it the strategy does)`);
const cross: number[] = [];
const crossCap: number[] = [];
for (let s = 0; s < months.length; s++) {
  if (months.length - s < 24) break;
  let cap = START, contributed = START;
  for (let i = s, mo = 0; i < months.length && mo < MAXY * 12; i++, mo++) {
    cap = Math.max(0, cap - cap * (SPREAD * (TRADES / 12) + ER / 12));
    cap = cap * (1 + months[i].r) + MONTHLY;
    contributed += MONTHLY;
    if (cap - contributed > contributed) { cross.push(mo / 12); crossCap.push(cap); break; }
  }
}
if (cross.length) {
  console.log(`      reached in ${cross.length} of ${months.length - 24} paths`);
  console.log(`      p10 ${pct(cross, 0.1).toFixed(1)}yr   median ${pct(cross, 0.5).toFixed(1)}yr   p90 ${pct(cross, 0.9).toFixed(1)}yr`);
  console.log(`      account size at the crossover: median $${Math.round(pct(crossCap, 0.5)).toLocaleString()}  (p10 $${Math.round(pct(crossCap, 0.1)).toLocaleString()}  p90 $${Math.round(pct(crossCap, 0.9)).toLocaleString()})`);
} else {
  console.log(`      NEVER REACHED in any path within ${MAXY} years — at $${MONTHLY}/mo the deposit dominates throughout.`);
}

// ---------------------------------------------------------------------------
// WHAT AN EDGE IS WORTH, PRICED IN DEPOSITS. The programme's whole output is
// candidate edges. This converts one into the currency the operator actually
// controls, so the trade-off is a number instead of an argument.
// ---------------------------------------------------------------------------
console.log(`\n    WHAT AN EDGE IS WORTH, PRICED IN MONTHLY DEPOSITS (median years to each rung)`);
const ALPHAS = [0, 0.02, 0.05];
const DEPOSITS = [100, 150, 200, 300];
console.log(`    ${"".padStart(16)}${DEPOSITS.map((d) => ("$" + d + "/mo").padStart(10)).join("")}`);
for (const a of ALPHAS) {
  const am = Math.pow(1 + a, 1 / 12) - 1;
  for (const [k, L] of LEVELS.entries()) {
    if (L !== 10000 && L !== 100000) continue;
    const cells: string[] = [];
    for (const dep of DEPOSITS) {
      const got: number[] = [];
      for (let s = 0; s < months.length; s++) {
        if (months.length - s < 24) break;
        let cap = START;
        for (let i = s, mo = 0; i < months.length && mo < MAXY * 12; i++, mo++) {
          cap = Math.max(0, cap - cap * (SPREAD * (TRADES / 12) + ER / 12));
          cap = cap * (1 + months[i].r + am) + dep;
          if (cap >= L) { got.push(mo / 12); break; }
        }
      }
      cells.push((got.length ? pct(got, 0.5).toFixed(1) + "y" : "—").padStart(10));
    }
    console.log(`    ${(`+${(a * 100).toFixed(0)}%/yr a, ${LABEL[k].split(" ")[0]}`).padEnd(16)}${cells.join("")}`);
  }
}
console.log(`\n    Read the rows against each other: an alpha this programme has never produced (+5%/yr net, sustained,`);
console.log(`    at retail size) versus a deposit increase the operator can make this afternoon. Whichever cell is`);
console.log(`    smaller is where the next unit of effort belongs, and it is a measurement rather than a preference.`);
