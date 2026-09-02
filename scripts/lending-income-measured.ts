#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// lending-income-measured.ts — lending-income.ts (D-752) re-run with MEASURED borrow fees.
//
// WHAT CHANGED, AND WHAT DID NOT. D-752's verdict was UNTESTED-ON-RATE: it measured DEMAND (short interest,
// days-to-cover) and ASSUMED a three-bucket rate schedule, because no per-name borrow rate was reachable. It also
// named exactly what would fix it: "per-name borrow FEE in bps (iBorrowDesk / IBKR HTTPS) — replaces the whole of
// section 2's rate leg". That source is now ingested (scripts/ingest-borrow-fees.ts, series borrow_fee:<SYM>), so
// this script replaces the rate leg with the observed fee, name by name.
//   * MEASURED here: the gross annual borrow fee per name (IBKR indicative retail rate, latest observation).
//   * STILL ASSUMED here: P(on loan) — the fraction of the position a borrower actually takes — and the lender's
//     50% share of the gross fee. Neither is inferable from any public source; the second is IBKR's disclosure and
//     is the OPTIMISTIC end (Fidelity/Schwab publish no fixed split and are understood to pay less). D-752 said
//     P(on loan) "drives the bracket harder than the fee does", and that remains true, so the output is STILL a
//     bracket. The verdict moves from UNTESTED-ON-RATE to UNTESTED-ON-UTILISATION — a strictly narrower claim.
//   * The fee is a proxy for the LENDER's revenue, not a measurement of it: the lender is paid out of what the
//     borrower pays, and the retail borrow rate is not the wholesale rebate rate.
// DESCRIPTIVE ONLY (MECHANISM LAW, D-597). No lineage row, no pre-registration, no promotion, no advice.
// lending-income.ts is left untouched, so the assumed-rate and measured-rate answers can be read side by side.

import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("lending-income-measured", [
  { name: "LIM_DVOL", def: "1000000", note: "liquid-universe floor: 60-day MEDIAN dollar volume, USD (matches the ingest)" },
  { name: "LIM_SHARE", def: "0.5", note: "lender's share of the gross borrow fee (IBKR SYEP discloses 50%) — ASSUMED" },
  { name: "LIM_STALE_D", def: "10", note: "a fee older than this is not read as current" },
  { name: "LIM_CEF_PANEL", def: "data/cef-panel.json", note: "D-750 CEF discount panel (read-only)" },
  { name: "LIM_OUT", def: "data/lending-income-measured.json", note: "where the measured brackets are written" },
]);
const DVOL_FLOOR = Number(K.LIM_DVOL), LENDER_SHARE = Number(K.LIM_SHARE);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lendm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const q = async (p: string) => await fetch(`${OWNED}/${p}`, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);
const pct = (x: number) => `${(100 * x).toFixed(3)}%`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const quant = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

console.log(`\n${"=".repeat(112)}\n  LENDING INCOME, MEASURED FEES — the D-752 rate leg replaced by observation   (DESCRIPTIVE ONLY)\n${"=".repeat(112)}`);

// ── 1. THE MEASURED FEE PANEL ────────────────────────────────────────────────────────────────────────────────
const from = iso(new Date(Date.now() - Number(K.LIM_STALE_D) * 864e5));
type Row = { series: string; d: string; v: number };
const feeRows: Row[] = [];
for (let off = 0;; off += 10000) {
  const p = (await q(`trd_macro_series?series=like.borrow_fee:*&d=gte.${from}&select=series,d,v&order=series.asc,d.asc&offset=${off}&limit=10000`)) as Row[];
  if (!p.length) break;
  feeRows.push(...p);
  if (p.length < 10000) break;
}
assertNonEmpty(`borrow_fee rows dated >= ${from}`, feeRows, 1000);
const fee = new Map<string, number>();                                  // ascending order -> last row per symbol wins
for (const r of feeRows) if (Number.isFinite(r.v)) fee.set(r.series.slice(11), r.v / 100);   // API is %/yr; store as a fraction
console.log(`\n  1. MEASURED FEE PANEL — iBorrowDesk (IBKR feed), latest observation per name, dated >= ${from}\n`);
console.log(`     names with a current fee: ${fee.size.toLocaleString()}`);
console.log(`     POSITIVE CONTROL — AAPL must be present and general collateral: ${fee.has("AAPL") ? pct(fee.get("AAPL")!) + "/yr" : "ABSENT (everything below is UNTESTED)"}`);
if (!fee.has("AAPL")) Deno.exit(2);
const allFees = [...fee.values()];
console.log(`     fee distribution across all ${allFees.length.toLocaleString()} names: median ${pct(quant(allFees, 0.5))} | 75th ${pct(quant(allFees, 0.75))} | 90th ${pct(quant(allFees, 0.90))} | 99th ${pct(quant(allFees, 0.99))} | max ${pct(Math.max(...allFees))}`);

// ── 2. THE LIQUID UNIVERSE (rebuilt exactly as the ingest built it, so the two agree by construction) ─────────
type Meta = { symbol: string; n_bars: number; last_date: string };
const meta = (await q(`trd_bars_deep?asset_class=eq.equity&select=symbol,n_bars,last_date&limit=100000`)) as Meta[];
const cutoff = iso(new Date(Date.now() - 90 * 864e5));
const live = meta.filter((m) => m.n_bars >= 60 && m.last_date >= cutoff);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const dvol = new Map<string, number>();
for (let i = 0; i < live.length; i += 50) {
  const part = live.slice(i, i + 50).map((m) => `"${m.symbol}"`).join(",");
  const rows = (await q(`trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`)) as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const tail = (r.bars ?? []).slice(-60);
    if (tail.length < 40) continue;
    dvol.set(r.symbol, median(tail.map((b) => b[4] * b[5]).filter(Number.isFinite)));
  }
}
const liquid = [...dvol].filter(([, v]) => v >= DVOL_FLOOR).map(([s]) => s);
const liquidWithFee = liquid.filter((s) => fee.has(s));
console.log(`\n  2. LIQUID US UNIVERSE — 60d median $vol >= $${(DVOL_FLOOR / 1e6).toFixed(1)}M\n`);
console.log(`     liquid names: ${liquid.length.toLocaleString()} | with a current measured fee: ${liquidWithFee.length.toLocaleString()} (${(100 * liquidWithFee.length / liquid.length).toFixed(1)}% coverage)`);
console.log(`     COVERAGE LAW: the ${(liquid.length - liquidWithFee.length).toLocaleString()} names without a fee are NOT zero-fee names; they are absent from the source and are excluded, not counted as GC.`);

// ── 3. P(ON LOAN) — the one remaining assumption, isolated so it can be replaced wholesale ────────────────────
// Bucketed on the MEASURED fee, which is the correct conditioning variable: a name is expensive precisely because
// supply is short, and a retail lot is likelier to be taken. D-752's brackets are carried over unchanged, so the
// only thing that moved between the two scripts is the fee.
interface B { key: string; label: string; feeLo: number; feeHi: number; pLo: number; pHi: number }
const BUCKETS: B[] = [
  { key: "GC", label: "GC  (fee < 1%/yr)", feeLo: 0, feeHi: 0.01, pLo: 0.00, pHi: 0.05 },
  { key: "WARM", label: "WARM (1-5%/yr)", feeLo: 0.01, feeHi: 0.05, pLo: 0.05, pHi: 0.40 },
  { key: "HOT", label: "HOT (>= 5%/yr)", feeLo: 0.05, feeHi: Infinity, pLo: 0.40, pHi: 0.90 },
];
const bOf = (f: number) => BUCKETS.find((b) => f >= b.feeLo && f < b.feeHi)!;
console.log(`\n  3. P(ON LOAN) — STILL ASSUMED. This is now the ONLY unmeasured layer.\n`);
for (const b of BUCKETS) {
  const n = liquidWithFee.filter((s) => bOf(fee.get(s)!).key === b.key).length;
  console.log(`     ${b.label.padEnd(22)}P(on loan) ${(pct(b.pLo) + " - " + pct(b.pHi)).padEnd(20)}liquid names in bucket: ${String(n).padStart(5)} (${(100 * n / liquidWithFee.length).toFixed(1)}%)`);
}
console.log(`     lender's share of the gross fee: ${pct(LENDER_SHARE)} (ASSUMED — IBKR's disclosed SYEP split, the optimistic end).`);
console.log(`     income per $ held = weight x MEASURED fee x ASSUMED P(on loan) x ASSUMED lender share.`);

function income(syms: string[]): { lo: number; hi: number; n: number } {
  const w = 1 / syms.length;
  let lo = 0, hi = 0;
  for (const s of syms) { const f = fee.get(s)!; const b = bOf(f); lo += w * f * b.pLo * LENDER_SHARE; hi += w * f * b.pHi * LENDER_SHARE; }
  return { lo, hi, n: syms.length };
}

// ── 4. THE THREE PORTFOLIO BRACKETS, ON MEASURED FEES ─────────────────────────────────────────────────────────
console.log(`\n  4. INCOME PER $ HELD, BY PORTFOLIO SHAPE — measured fee, assumed utilisation\n`);

console.log(`     (a) BROAD ETF (SPY)`);
const spyF = fee.get("SPY");
const etf = spyF !== undefined ? income(["SPY"]) : { lo: 0, hi: 0, n: 0 };
console.log(`         SPY measured borrow fee: ${spyF !== undefined ? pct(spyF) + "/yr" : "ABSENT — UNTESTED"}`);
console.log(`         to the HOLDER via a retail lending program: ${spyF !== undefined ? `${pct(etf.lo)} - ${pct(etf.hi)} /yr` : "UNTESTED"}`);
console.log(`         (The FUND's own lending revenue accrues to the fund as a few bp of tracking benefit and cannot be elected by the holder.)`);

const ew = income(liquidWithFee);
console.log(`\n     (b) EQUAL-WEIGHT LIQUID SINGLE NAMES (n=${ew.n.toLocaleString()})`);
console.log(`         mean measured fee ${pct(liquidWithFee.reduce((s, x) => s + fee.get(x)!, 0) / ew.n)}/yr | median ${pct(quant(liquidWithFee.map((s) => fee.get(s)!), 0.5))}/yr`);
console.log(`         income: ${pct(ew.lo)} - ${pct(ew.hi)} /yr`);
// LIQUIDITY LAW (D-634): both halves, never one.
const byDv = [...liquidWithFee].sort((a, b) => dvol.get(b)! - dvol.get(a)!);
const half = Math.floor(byDv.length / 2);
const hiHalf = income(byDv.slice(0, half)), loHalf = income(byDv.slice(half));
console.log(`         liq:HIGH half (n=${hiHalf.n}): ${pct(hiHalf.lo)} - ${pct(hiHalf.hi)} /yr | median fee ${pct(quant(byDv.slice(0, half).map((s) => fee.get(s)!), 0.5))}`);
console.log(`         liq:LOW  half (n=${loHalf.n}): ${pct(loHalf.lo)} - ${pct(loHalf.hi)} /yr | median fee ${pct(quant(byDv.slice(half).map((s) => fee.get(s)!), 0.5))}`);

// (c) widest-discount CEF tercile — the folklore test.
console.log(`\n     (c) WIDEST-DISCOUNT CEF TERCILE (D-750 panel, ${K.LIM_CEF_PANEL})`);
let cef = { lo: 0, hi: 0, n: 0 }, cefFees: number[] = [], cefN = 0, cefHit = 0, lastM = "";
try {
  const panel = JSON.parse(await Deno.readTextFile(K.LIM_CEF_PANEL)) as { rows: { t: string; m: string; disc: number }[] };
  lastM = panel.rows.map((r) => r.m).sort().at(-1)!;
  const cur = panel.rows.filter((r) => r.m === lastM).sort((a, b) => a.disc - b.disc);
  assertNonEmpty(`CEF rows in ${lastM}`, cur, 20);
  const terc = cur.slice(0, Math.floor(cur.length / 3));
  cefN = terc.length;
  const hit = terc.map((r) => r.t).filter((t) => fee.has(t));
  cefHit = hit.length;
  console.log(`         month ${lastM} | ${cur.length} funds | widest tercile n=${cefN} | mean discount ${pct(terc.reduce((s, r) => s + r.disc, 0) / cefN)}`);
  console.log(`         borrow-fee coverage of the tercile: ${cefHit}/${cefN} (${(100 * cefHit / cefN).toFixed(1)}%)`);
  console.log(`         POSITIVE CONTROL — the fee panel returns non-zero rows for a set of listed US funds: ${cefHit > 0 ? "PASS" : "FAIL — the block below is UNTESTED"}`);
  if (cefHit > 0) {
    cefFees = hit.map((t) => fee.get(t)!);
    cef = income(hit);
    console.log(`         income: ${pct(cef.lo)} - ${pct(cef.hi)} /yr`);
  }
} catch (e) { console.log(`         UNTESTED — panel unreadable (${e instanceof Error ? e.message : e}).`); }

// ── 5. THE FOLKLORE TEST: are wide-discount CEFs hard to borrow? ──────────────────────────────────────────────
console.log(`\n  5. THE HARD-TO-BORROW FOLKLORE, ON MEASURED FEES (BENCHMARK LAW: against the universe, not in isolation)\n`);
if (cefFees.length) {
  const liqFees = liquidWithFee.map((s) => fee.get(s)!);
  const row = (lab: string, a: number[]) => console.log(`     ${lab.padEnd(34)}n=${String(a.length).padStart(5)}  median ${pct(quant(a, 0.5)).padStart(9)}  75th ${pct(quant(a, 0.75)).padStart(9)}  90th ${pct(quant(a, 0.90)).padStart(9)}  max ${pct(Math.max(...a))}`);
  row("widest-discount CEF tercile", cefFees);
  row("liquid US equity universe", liqFees);
  row("all names with a fee", allFees);
  const hotShare = (a: number[]) => `${(100 * a.filter((f) => f >= 0.05).length / a.length).toFixed(1)}%`;
  console.log(`     share of names at HOT (>=5%/yr):   CEF tercile ${hotShare(cefFees)}  vs  liquid equities ${hotShare(liqFees)}  vs  all ${hotShare(allFees)}`);
  const verdict = quant(cefFees, 0.5) > 1.5 * quant(liqFees, 0.5) ? "CONFIRMED" : quant(cefFees, 0.5) < 0.67 * quant(liqFees, 0.5) ? "REFUTED (CEFs are CHEAPER to borrow)" : "NOT CONFIRMED (indistinguishable at the median)";
  console.log(`\n     VERDICT on "wide-discount CEFs are hard to borrow": ${verdict}`);
  console.log(`     Stated as a cross-sectional comparison of latest fees on ${lastM}'s tercile, not as a time-series claim. One snapshot.`);
} else {
  console.log(`     UNTESTED — no CEF in the tercile carries a measured fee, which is a fact about the source's coverage, not about CEF borrow demand.`);
}

// ── 6. SIZE (D-746 yardstick) ─────────────────────────────────────────────────────────────────────────────────
const need = (r: number) => r > 0 ? `$${Math.round(1200 / r).toLocaleString()}` : "never";
const shapes: [string, { lo: number; hi: number }][] = [
  ["(a) broad ETF (SPY, to holder)", etf],
  ["(b) equal-weight liquid names", ew],
  ["(b') liq:HIGH half", hiHalf],
  ["(b'') liq:LOW half", loHalf],
];
if (cefHit > 0) shapes.push(["(c) widest-discount CEF tercile", cef]);
console.log(`\n  6. WHEN DOES IT MATTER? — $100/mo = $1,200/yr, the D-746 yardstick\n`);
console.log(`     ${"portfolio".padEnd(34)}${"income /yr".padEnd(26)}${"$ needed for $100/mo"}`);
for (const [l, r] of shapes) console.log(`     ${l.padEnd(34)}${(pct(r.lo) + " - " + pct(r.hi)).padEnd(26)}${need(r.hi)} (best) .. ${need(r.lo)} (worst)`);

console.log(`\n${"=".repeat(112)}\n  VERDICT — UNTESTED-ON-UTILISATION (fee MEASURED, P(on loan) and lender share ASSUMED). DESCRIPTIVE ONLY.\n${"=".repeat(112)}`);
console.log(`  What is now measured that was assumed in D-752: the gross annual borrow fee, per name, ${fee.size.toLocaleString()} names.`);
console.log(`  What remains assumed: P(on loan) (unobtainable from public data — needs an enrolled account statement) and`);
console.log(`  the 50% lender share (IBKR's disclosure; Fidelity/Schwab publish none and are understood to pay less).`);
console.log(`  The bracket is still wide, and it is wide for the SAME reason as before: utilisation, not price.\n`);

await Deno.writeTextFile(K.LIM_OUT, JSON.stringify({
  built: new Date().toISOString(), fee_asof_from: from, dvol_floor: DVOL_FLOOR, lender_share: LENDER_SHARE,
  names_with_fee: fee.size, liquid: liquid.length, liquid_with_fee: liquidWithFee.length,
  fee_quantiles_all: { p50: quant(allFees, 0.5), p75: quant(allFees, 0.75), p90: quant(allFees, 0.90), p99: quant(allFees, 0.99) },
  cef: { month: lastM, tercile_n: cefN, covered: cefHit, p50: quant(cefFees, 0.5), p90: quant(cefFees, 0.90) },
  shapes: Object.fromEntries(shapes.map(([k, v]) => [k, v])),
  status: "UNTESTED-ON-UTILISATION — fee measured, P(on loan) assumed",
}, null, 2));
console.log(`  wrote ${K.LIM_OUT}\n`);
