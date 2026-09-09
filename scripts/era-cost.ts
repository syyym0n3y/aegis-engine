#!/usr/bin/env -S deno run --allow-net --allow-env
// era-cost.ts (D-843) — PREREG: D-843-era-cost. A self-attack on FLAW C3 of docs/METHODOLOGY_FLAWS.md.
//
// The flaw, named by reasoning before any of this was measured: this programme charges ONE flat modern cost across
// spans reaching back to the 1960s. Execution in 1985 was not execution in 2025 — fixed commissions until May 1975,
// EIGHTHS until June 1997, SIXTEENTHS until April 2001, decimals after. A long backtest costed at modern rates
// FLATTERS its early era, and the early era is where several of this record's surviving numbers sit.
//
// The specific target is D-655, which recorded post-publication DECAY as SUPPORTED on the contrast pre-1990
// 4.30%/yr (t 2.47) vs post-1990 2.07%/yr (t 1.40) — both GROSS, both then costed at one flat rate. If the cost of
// harvesting fell faster than the premium did, the NET series does not decay and that reading inverts.
//
// HOW THE COST IS MEASURED — and why the obvious tool was discarded.
// First attempt: Corwin & Schultz (JF 2012), the standard high-low spread estimator. It is retained below as a
// SECONDARY and it FAILED here, which is reported rather than buried: it returns ~43bp for the 1970s (plausible) and
// ~47bp for 2015+ (wrong by an order of magnitude — modern large-cap effective spreads are low single-digit bp). Its
// identification is the excess of the two-day range over the one-day range, and once the spread falls far below daily
// volatility that excess is noise. The estimator has a floor, the floor is near the modern answer, and a flat curve
// came out. Its own positive control is what exposed this.
//
// What replaced it needs no estimator at all: THE MINIMUM TICK, read directly off the price lattice. Before June 1997
// US equities traded in eighths, then sixteenths, then cents. A quoted spread cannot be narrower than one tick, so
// tick/price is a HARD LOWER BOUND on the round-trip cost. And it survives our own FLAW C1 (adjusted LEVELS are not
// what traded): split and dividend adjustment multiply price and price-increment by the SAME factor, so the ratio is
// invariant and the unknown adjustment factor cancels exactly.
// Verified against arithmetic nobody could tune: CAT 1995 measures 21.5bp against 1/8 on a $58 stock = 21.6bp;
// CAT 1999 measures 11.2bp against 1/16 on $55 = 11.4bp.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("era-cost", [
  { name: "MAX_SYMS", def: "140", note: "US equities with pre-1990 history to sample; >=80 required or the run is UNTESTED" },
  { name: "PAGE", def: "5", note: "symbols per REST read (D-812: no whole-panel reads)" },
  { name: "TURNOVER", def: "0.335", note: "one-way monthly turnover, MEASURED in D-654 and HELD FIXED so only cost varies" },
  { name: "GROSS_PRE", def: "4.30", note: "D-655 pre-1990 long-only momentum excess %/yr, GROSS" },
  { name: "GROSS_POST", def: "2.07", note: "D-655 post-1990 long-only momentum excess %/yr, GROSS" },
  { name: "FLAT_BP", def: "20", note: "the flat cost D-655 actually charged, for the side-by-side" },
  { name: "RUN_ID", def: "D-843-era-cost", note: "DETERMINISTIC — a re-run of the unchanged spec must not re-spend trials (trial-idempotency guard)" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "eracost", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok };
const { q } = mkStrictRead(OWNED, hdr);
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };

// ---- SECONDARY: Corwin-Schultz (2012). Kept, run, and reported as the tool that could not answer this. -----------
const DEN = 3 - 2 * Math.SQRT2;
function cs2(h1: number, l1: number, h2: number, l2: number): number | null {
  if (!(h1 > 0 && l1 > 0 && h2 > 0 && l2 > 0) || h1 < l1 || h2 < l2) return null;
  let H2 = h2, L2 = l2;
  if (l2 > h1) { const g = l2 - h1; H2 = h2 - g; L2 = l2 - g; } else if (h2 < l1) { const g = l1 - h2; H2 = h2 + g; L2 = l2 + g; }
  if (!(L2 > 0)) return null;
  const b = Math.log(h1 / l1) ** 2 + Math.log(H2 / L2) ** 2;
  const g = Math.log(Math.max(h1, H2) / Math.min(l1, L2)) ** 2;
  const alpha = (Math.sqrt(2 * b) - Math.sqrt(b)) / DEN - Math.sqrt(g / DEN);
  const S = 2 * (Math.exp(alpha) - 1) / (1 + Math.exp(alpha));
  return Number.isFinite(S) ? Math.max(0, S) : null;   // CS floor negatives at zero, then AVERAGE (never median)
}

console.log(`\n==> D-843 ERA COST — flaw C3: we charge one flat cost across 60 years. What did trading actually cost?`);
console.log(`    PREREG: D-843-era-cost. The tick is MEASURED off the price lattice; it is a HARD LOWER BOUND on cost.\n`);

const cat = await q(`trd_bars_deep?asset_class=eq.equity&first_date=lt.1990-01-01&select=symbol,first_date,n_bars&order=n_bars.desc`) as { symbol: string; first_date: string; n_bars: number }[];
assertNonEmpty("equities with pre-1990 history", cat, 80);
const syms = cat.slice(0, +K.MAX_SYMS).map((r) => r.symbol);
console.log(`  panel: ${cat.length} US equities in trd_bars_deep hold pre-1990 history; sampling the ${syms.length} deepest.`);
console.log(`  SURVIVORSHIP, up front: these are names that still exist AND still carry 1970s-80s bars — large survivors.`);
console.log(`  D-655 trades French value-weighted deciles containing far smaller names, so this UNDERSTATES their cost.\n`);

type Y = { tick: number[]; cs: number[] };
const perYear = new Map<number, Map<string, Y>>();
let pairs = 0, floored = 0;
for (let i = 0; i < syms.length; i += +K.PAGE) {
  const page = syms.slice(i, i + +K.PAGE);
  const rows = await q(`trd_bars_deep?symbol=in.(${page.join(",")})&select=symbol,bars`) as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const b = (r.bars ?? []).slice().sort((x, y) => x[0] - y[0]);
    const byYear = new Map<number, number[][]>();
    for (const bar of b) { const y = new Date(bar[0] * 1000).getUTCFullYear(); let a = byYear.get(y); if (!a) { a = []; byYear.set(y, a); } a.push(bar); }
    for (const [y, bars] of byYear) {
      if (bars.length < 150) continue;
      const closes = bars.map((x) => x[4]).filter((x) => x > 0);
      const mc = med(closes); if (!(mc > 0)) continue;
      const d: number[] = [];
      for (let j = 1; j < bars.length; j++) { const v = Math.abs(bars[j][4] - bars[j - 1][4]); if (v > 1e-12) d.push(v); }
      if (d.length < 100) continue;
      const tickBp = 1e4 * pct(d, 0.01) / mc;               // 1st percentile of the increment lattice, in bp of price
      const cs: number[] = [];
      for (let j = 0; j + 1 < bars.length; j++) {
        if (bars[j + 1][0] - bars[j][0] > 5 * 86400) continue;
        const s = cs2(bars[j][2], bars[j][3], bars[j + 1][2], bars[j + 1][3]);
        if (s === null) continue; cs.push(s); pairs++; if (s === 0) floored++;
      }
      let m = perYear.get(y); if (!m) { m = new Map(); perYear.set(y, m); }
      m.set(r.symbol, { tick: [tickBp], cs });
    }
  }
}
const years = [...perYear.keys()].sort((a, b) => a - b);
const tickY = new Map<number, number>(), csY = new Map<number, number>(), nY = new Map<number, number>();
for (const y of years) {
  const m = perYear.get(y)!;
  const ts = [...m.values()].map((v) => v.tick[0]).filter((x) => Number.isFinite(x) && x > 0);
  const cs = [...m.values()].filter((v) => v.cs.length >= 60).map((v) => 1e4 * mean(v.cs));
  if (ts.length >= 20) { tickY.set(y, med(ts)); nY.set(y, ts.length); if (cs.length >= 20) csY.set(y, med(cs)); }
}
const use = [...tickY.keys()].sort((a, b) => a - b);
console.log(`  ${pairs.toLocaleString()} day-pairs for the secondary estimator (${(100 * floored / pairs).toFixed(1)}% floored at zero); ${use.length} years priced.\n`);

// ---- POSITIVE CONTROL (D-641): the tick must reproduce two DOCUMENTED discrete events we did not put in ---------
const g = (y: number) => tickY.get(y);
const dec = 1 - ((g(2001)! + g(2002)!) / 2) / ((g(1999)! + g(2000)!) / 2);
const six = 1 - ((g(1998)! + g(1999)!) / 2) / ((g(1995)! + g(1996)!) / 2);
console.log(`  POSITIVE CONTROL — the measurement must find regulatory events that are nowhere in the code:`);
console.log(`    SIXTEENTHS (Jun 1997):    ${((g(1995)! + g(1996)!) / 2).toFixed(1)}bp (95-96) -> ${((g(1998)! + g(1999)!) / 2).toFixed(1)}bp (98-99)   fall ${(100 * six).toFixed(1)}%   [1/8->1/16 predicts ~50%]`);
console.log(`    DECIMALS   (Apr 2001):    ${((g(1999)! + g(2000)!) / 2).toFixed(1)}bp (99-00) -> ${((g(2001)! + g(2002)!) / 2).toFixed(1)}bp (01-02)   fall ${(100 * dec).toFixed(1)}%   [needs >=20%]`);
const controlOK = dec >= 0.20 && six >= 0.20;
console.log(`    control ${controlOK ? "PASSED — both steps present, in the right direction, at roughly the right size." : "FAILED"}.\n`);

const ERAS: [string, number, number][] = [["1970s", 1970, 1979], ["1980s", 1980, 1989], ["1990-96", 1990, 1996], ["1997-2000", 1997, 2000], ["2001-09", 2001, 2009], ["2010-14", 2010, 2014], ["2015+", 2015, 2026]];
const eraTick = new Map<string, number>(), eraCs = new Map<string, number>();
for (const [n, a, b] of ERAS) { const ys = use.filter((y) => y >= a && y <= b); if (ys.length) { eraTick.set(n, med(ys.map((y) => tickY.get(y)!))); const c = ys.filter((y) => csY.has(y)).map((y) => csY.get(y)!); if (c.length) eraCs.set(n, med(c)); } }
const modern = eraTick.get("2015+")!;
console.log(`  MEASURED MINIMUM TICK BY ERA — a LOWER BOUND on round-trip cost (no commissions, no impact, no size)`);
console.log(`  ${"era".padEnd(10)} ${"yrs".padStart(4)} ${"tick bp".padStart(9)} ${"x vs 2015+".padStart(11)}   ${"[secondary: Corwin-Schultz bp]".padStart(31)}`);
for (const [n, a, b] of ERAS) { const v = eraTick.get(n); if (v === undefined) continue; const c = eraCs.get(n); console.log(`  ${n.padEnd(10)} ${String(use.filter((y) => y >= a && y <= b).length).padStart(4)} ${v.toFixed(1).padStart(9)} ${(v / modern).toFixed(2).padStart(11)}   ${(c === undefined ? "-" : c.toFixed(1)).padStart(31)}`); }
const ratio80 = eraTick.get("1980s")! / modern;
console.log(`\n    1980s / 2015+ = ${ratio80.toFixed(2)}x   [rule needed >= 2.5x]`);
console.log(`    the secondary estimator's own curve is ${(eraCs.get("1980s")! / eraCs.get("2015+")!).toFixed(2)}x over the same span — it cannot see this at all.`);

// ---- apply it to D-655, turnover HELD FIXED ---------------------------------------------------------------------
const drag = (bp: number) => 2 * (+K.TURNOVER) * 12 * bp / 1e4 * 100;   // %/yr — the D-654/656 TURNOVER LAW formula
const preYs = use.filter((y) => y < 1990), postYs = use.filter((y) => y >= 1990);
const preBp = med(preYs.map((y) => tickY.get(y)!)), postBp = med(postYs.map((y) => tickY.get(y)!));
const netPre = +K.GROSS_PRE - drag(preBp), netPost = +K.GROSS_POST - drag(postBp);
const netPreF = +K.GROSS_PRE - drag(+K.FLAT_BP), netPostF = +K.GROSS_POST - drag(+K.FLAT_BP);
// The median across years UNDER-weights the expensive early 1990s inside the long post-1990 window, so the equal-weight
// MEAN across years is computed too and both are shown. Picking whichever flatters the claim is exactly the discretion
// the pre-registration exists to remove.
const preBpM = mean(preYs.map((y) => tickY.get(y)!)), postBpM = mean(postYs.map((y) => tickY.get(y)!));
const netPreM = +K.GROSS_PRE - drag(preBpM), netPostM = +K.GROSS_POST - drag(postBpM);
console.log(`\n  D-655 RE-COSTED — same gross, same 33.5%/mo turnover; ONLY the cost changes:`);
console.log(`  ${"".padEnd(26)} ${"gross %/yr".padStart(11)} ${"cost bp".padStart(8)} ${"drag %/yr".padStart(10)} ${"NET %/yr".padStart(9)}`);
console.log(`  ${"MEASURED era cost pre-1990".padEnd(26)} ${(+K.GROSS_PRE).toFixed(2).padStart(11)} ${preBp.toFixed(1).padStart(8)} ${drag(preBp).toFixed(2).padStart(10)} ${netPre.toFixed(2).padStart(9)}`);
console.log(`  ${"MEASURED era cost post-1990".padEnd(26)} ${(+K.GROSS_POST).toFixed(2).padStart(11)} ${postBp.toFixed(1).padStart(8)} ${drag(postBp).toFixed(2).padStart(10)} ${netPost.toFixed(2).padStart(9)}`);
console.log(`  ${("as recorded, flat " + K.FLAT_BP + "bp pre").padEnd(26)} ${(+K.GROSS_PRE).toFixed(2).padStart(11)} ${(+K.FLAT_BP).toFixed(1).padStart(8)} ${drag(+K.FLAT_BP).toFixed(2).padStart(10)} ${netPreF.toFixed(2).padStart(9)}`);
console.log(`  ${("as recorded, flat " + K.FLAT_BP + "bp post").padEnd(26)} ${(+K.GROSS_POST).toFixed(2).padStart(11)} ${(+K.FLAT_BP).toFixed(1).padStart(8)} ${drag(+K.FLAT_BP).toFixed(2).padStart(10)} ${netPostF.toFixed(2).padStart(9)}`);

const supported = controlOK && ratio80 >= 2.5 && netPre <= 0 && netPost > netPre;
console.log(`  ${"MEAN-of-years pre-1990".padEnd(26)} ${(+K.GROSS_PRE).toFixed(2).padStart(11)} ${preBpM.toFixed(1).padStart(8)} ${drag(preBpM).toFixed(2).padStart(10)} ${netPreM.toFixed(2).padStart(9)}`);
console.log(`  ${"MEAN-of-years post-1990".padEnd(26)} ${(+K.GROSS_POST).toFixed(2).padStart(11)} ${postBpM.toFixed(1).padStart(8)} ${drag(postBpM).toFixed(2).padStart(10)} ${netPostM.toFixed(2).padStart(9)}`);
// How much commission + impact ON TOP OF the tick would zero each era's net. The tick is a floor, so this is the
// question the floor leaves open, and it is arithmetic on the measured numbers rather than a re-cut of the test.
const perBp = 2 * (+K.TURNOVER) * 12 / 1e4 * 100;
console.log(`\n  THE FLOOR LEAVES ONE QUESTION OPEN, so here is its breakeven:`);
console.log(`    extra round-trip cost above the tick that would zero the net — pre-1990 ${(netPre / perBp).toFixed(1)}bp, post-1990 ${(netPost / perBp).toFixed(1)}bp.`);
console.log(`    Pre-May-1975 NYSE commissions were fixed and are not in these numbers; whether they exceed ${(netPre / perBp).toFixed(1)}bp is a`);
console.log(`    judgement this script does not make and the pre-registration did not license.`);
console.log(`\n  VERDICT, against the rule written before the data was read:`);
if (!controlOK) console.log(`    UNTESTED — the positive control failed; the measurement is not finding events known to be there.`);
else if (supported) {
  console.log(`    SUPPORTED. Flat costing FLATTERS the early era. At a constant ${K.FLAT_BP}bp the pre-1990 book nets ${netPreF.toFixed(2)}%/yr against`);
  console.log(`    ${netPostF.toFixed(2)}%/yr after, which reads as an anomaly that DECAYED. At the cost that era demonstrably carried it nets`);
  console.log(`    ${netPre.toFixed(2)}%/yr against ${netPost.toFixed(2)}%/yr — the GROSS premium halved while the NET ${netPost > netPre ? "ROSE" : "fell"}.`);
  console.log(`    D-655's DECAY reading is an artifact of holding constant the one thing that actually changed.`);
} else if (ratio80 >= 2.5 && netPre > 0) {
  console.log(`    NULL on the stated rule. Costs DID fall ${ratio80.toFixed(1)}x, but even at the era's own tick the pre-1990 book`);
  console.log(`    still nets ${netPre.toFixed(2)}%/yr — POSITIVE — and the rule required it to be at or below zero. Half a claim is`);
  console.log(`    not a claim, so this is a NULL and the other half is recorded as a MEASUREMENT rather than a win:`);
  console.log(`    the ORDERING DOES reverse. ${netPreF.toFixed(2)} -> ${netPostF.toFixed(2)} at flat cost becomes ${netPre.toFixed(2)} -> ${netPost.toFixed(2)} at the era's own tick`);
  console.log(`    (mean-of-years: ${netPreM.toFixed(2)} -> ${netPostM.toFixed(2)}), so the flat-cost decay is not visible once cost is allowed to vary.`);
} else console.log(`    NULL — pre-1990 net ${netPre.toFixed(2)}%/yr vs post-1990 ${netPost.toFixed(2)}%/yr; the era curve does not overturn D-655.`);

console.log(`\n  WHAT THIS IS NOT. The tick is the FLOOR of the spread, ignores commissions (fixed and large before May 1975),`);
console.log(`  ignores impact, and is measured on large survivors. D-655's gross figures are taken as recorded, not recomputed.`);
console.log(`  It re-costs ONE result. Every other long-span cost-charged row on this board inherits the same flaw untouched.`);

const t = await spendTrials({ rest: OWNED, headers: hdr, family: "era-cost", runId: K.RUN_ID, spent: use.length });
console.log(`\n  trials +${use.length} (one per year priced); ceiling ${t.ceiling.toFixed(4)}.`);
