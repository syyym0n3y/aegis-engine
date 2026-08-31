#!/usr/bin/env -S deno run --allow-net --allow-env
// driver-coverage-matrix.ts (D-726) — the canonical PRICE-DRIVER list, checked against EVERY instrument class.
//
// The external gold list named ten drivers: CPI/inflation expectations, geopolitical risk, real yields, the dollar,
// central-bank buying, COT positioning, ETF flows, the gold/silver ratio, seasonality, and the World Gold Council's
// attribution framework. D-716's register asked "what does each instrument need"; this asks the completeness question
// the operator posed directly: for EACH of these driver TYPES, across EVERY instrument class, do we hold it — and is
// there any price driver unaccounted for anywhere in the stack. It is a matrix, probed live, so the gaps are exact.
//
// A driver is scored per (type x class) as:
//   HELD    — the input exists in the stack for that class (probed, or a documented derivation from held data)
//   DERIVE  — not stored, but COMPUTABLE from data we hold (seasonality from price, a USD proxy from FX pairs)
//   DEBT    — free and obtainable, not yet ingested (a research failure per THE COVERAGE LAW, not a market finding)
//   GATED   — real barrier (credential/paid/quarterly-lagged); named, not hand-waved
//   N/A     — the driver does not apply to that class
// EXPLAIN-only drivers (they decompose the past, they do not condition a position) are tagged, because a register of
// true facts is not a strategy — the distinction the source list omits and the one that matters most.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("driver-coverage-matrix", []);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dcm", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
async function exists(path: string): Promise<boolean> {
  try { const r = await fetch(`${OWNED}/${path}`, { headers: hdr }); if (!r.ok) return false; const j = await r.json(); return Array.isArray(j) && j.length > 0; } catch { return false; }
}

const CLASSES = ["gold/metals", "equity-index", "equity-single", "fx", "commodity", "rates/bonds", "crypto"] as const;
type Cls = typeof CLASSES[number];
type Cell = "HELD" | "DERIVE" | "DEBT" | "GATED" | "N/A";
interface Driver { name: string; use: "condition" | "explain"; cells: Record<Cls, Cell>; note: string; }

// Probe the few live inputs the matrix depends on, so the HELD cells are measured not asserted.
const has = {
  cot: await exists("trd_cot_disagg?select=report_date&limit=1") || await exists("trd_cot_tff?select=report_date&limit=1"),
  nominalCurve: await exists("trd_yield_curve?select=d&limit=1"),
  fxPairs: await exists("trd_fx_hourly?symbol=eq.EURUSD&select=ts&limit=1"),
  metals: await exists("trd_bars_deep?symbol=eq.GC%3DF&select=symbol&limit=1") && await exists("trd_bars_deep?symbol=eq.SI%3DF&select=symbol&limit=1"),
  attribution: await exists("trd_attribution?select=symbol&limit=1"),
  cryptoFunding: await exists("trd_perp_oi?interval=eq.funding&select=ts&limit=1"),
  cryptoFlows: await exists("trd_perp_oi?venue=eq.blockchain.info&select=ts&limit=1"),
  macroInfl: await exists("trd_macro_series?series=eq.cpi&select=d&limit=1"),          // D-729: FRED keyless
  realYield: await exists("trd_macro_series?series=eq.real_yield_10y&select=d&limit=1"),
  gpr: await exists("trd_macro_series?series=eq.gpr&select=d&limit=1"),   // D-727: ingested
  usd: await exists("trd_macro_series?series=eq.usd_basket&select=d&limit=1"),        // D-728: built
  ratios: await exists("trd_macro_series?series=eq.ratio_gold_silver&select=d&limit=1"),
  seasonal: await exists("trd_macro_series?series=eq.seasonal_gold&select=d&limit=1"),
};

const A = (g: Cell, ei: Cell, es: Cell, fx: Cell, co: Cell, rb: Cell, cr: Cell): Record<Cls, Cell> =>
  ({ "gold/metals": g, "equity-index": ei, "equity-single": es, "fx": fx, "commodity": co, "rates/bonds": rb, "crypto": cr });

const DRIVERS: Driver[] = [
  { name: "1 CPI / inflation expectations", use: "condition", note: has.macroInfl ? "HELD — CPI + core CPI + 5y/10y breakevens from FRED keyless fredgraph.csv (D-729)" : "FRED-gated: no CPI/breakeven series",
    cells: A(has.macroInfl ? "HELD" : "GATED", has.macroInfl ? "HELD" : "GATED", "N/A", "N/A", has.macroInfl ? "HELD" : "GATED", has.macroInfl ? "HELD" : "GATED", "N/A") },
  { name: "2 geopolitical risk", use: "condition", note: has.gpr ? "HELD — Caldara-Iacoviello GPR ingested to trd_macro_series (D-727), monthly, positive-controlled" : "GPR index free+allowlisted, not yet ingested",
    cells: A(has.gpr ? "HELD" : "DEBT", has.gpr ? "HELD" : "DEBT", "N/A", has.gpr ? "HELD" : "DEBT", has.gpr ? "HELD" : "DEBT", "N/A", "N/A") },
  { name: "3 real yields (TIPS)", use: "condition", note: has.realYield ? "HELD — 5y/10y/30y TIPS real yields from FRED keyless (D-729); gold's #1 driver, previously entirely absent" : "nominal only; real leg FRED-gated",
    cells: A(has.realYield ? "HELD" : "GATED", has.realYield ? "HELD" : "GATED", "N/A", "N/A", has.realYield ? "HELD" : "GATED", has.realYield ? "HELD" : "GATED", "N/A") },
  { name: "4 dollar (DXY / USD)", use: "condition", note: has.usd ? "HELD — usd_basket DXY-proxy built from EUR/JPY/GBP/CAD/CHF (D-728), 100-normalised, positive-controlled" : "FX held; USD basket derivable, not built",
    cells: A(has.usd ? "HELD" : "DERIVE", has.usd ? "HELD" : "DERIVE", "N/A", "HELD", has.usd ? "HELD" : "DERIVE", has.usd ? "HELD" : "DERIVE", has.usd ? "HELD" : "DERIVE") },
  { name: "5 central-bank buying / official flows", use: "explain", note: "IMF COFER / reserve data is QUARTERLY + lagged, not ingested — EXPLANATORY at best, cannot condition a position",
    cells: A("GATED", "N/A", "N/A", "GATED", "N/A", "GATED", "N/A") },
  { name: "6 COT positioning", use: "condition", note: has.cot ? "held (trd_cot_disagg/tff) for the futures complex; crypto uses funding+OI as the analogue" : "COT MISSING",
    cells: A(has.cot ? "HELD" : "GATED", has.cot ? "HELD" : "GATED", "N/A", has.cot ? "HELD" : "GATED", has.cot ? "HELD" : "GATED", has.cot ? "HELD" : "GATED", has.cryptoFunding ? "HELD" : "GATED") },
  { name: "7 fund / ETF flows", use: "condition", note: "HARDER THAN THE REGISTER ASSUMED: the SPDR issuer serves PDF bar-lists via a Cloudflare JS-app API, not a clean shares-outstanding CSV; WGC ETF-flow data sits behind forms. Not a simple free download. Crypto on-chain flows ARE held.",
    cells: A("GATED", "GATED", "N/A", "N/A", "GATED", "GATED", has.cryptoFlows ? "HELD" : "DEBT") },
  { name: "8 cross-asset ratio (gold/silver etc.)", use: "condition", note: has.ratios ? "HELD — gold/silver, stocks/bonds, copper/gold, oil/gold built (D-728), positive-controlled; more derivable on demand" : "metals held, ratios derivable",
    cells: A(has.ratios ? "HELD" : "DERIVE", has.ratios ? "HELD" : "DERIVE", "DERIVE", "DERIVE", has.ratios ? "HELD" : "DERIVE", has.ratios ? "HELD" : "DERIVE", "DERIVE") },
  { name: "9 seasonality", use: "condition", note: has.seasonal ? "HELD — per-month mean-return built for gold/spy/oil (D-728); data corrected the clip: gold's strongest month is JANUARY, not Sep. Derivable for any instrument." : "computable from held price history",
    cells: A(has.seasonal ? "HELD" : "DERIVE", has.seasonal ? "HELD" : "DERIVE", "DERIVE", "DERIVE", has.seasonal ? "HELD" : "DERIVE", "DERIVE", "DERIVE") },
  { name: "10 attribution framework (WGC-style)", use: "explain", note: has.attribution ? "trd_attribution decomposes each instrument's return into factor betas + residual (per-era, per-tf) — this IS the WGC framework, generalised" : "attribution engine absent",
    cells: A(has.attribution ? "HELD" : "GATED", has.attribution ? "HELD" : "GATED", has.attribution ? "HELD" : "GATED", has.attribution ? "HELD" : "GATED", has.attribution ? "HELD" : "GATED", has.attribution ? "HELD" : "GATED", has.attribution ? "HELD" : "GATED") },
];
assertNonEmpty("drivers", DRIVERS, 10);

const w = 40;
console.log(`==> PRICE-DRIVER COVERAGE MATRIX — the canonical 10 driver types x every instrument class\n`);
console.log(`    ${"driver".padEnd(w)}${CLASSES.map((c) => c.slice(0, 5).padStart(7)).join("")}`);
const tally: Record<Cell, number> = { HELD: 0, DERIVE: 0, DEBT: 0, GATED: 0, "N/A": 0 };
for (const d of DRIVERS) {
  const row = CLASSES.map((c) => { const v = d.cells[c]; if (v !== "N/A") tally[v]++; return (v === "HELD" ? "H" : v === "DERIVE" ? "d" : v === "DEBT" ? "$" : v === "GATED" ? "X" : "·").padStart(7); }).join("");
  const tag = d.use === "explain" ? " [EXPLAIN]" : "";
  console.log(`    ${(d.name + tag).padEnd(w)}${row}`);
}
console.log(`\n    LEGEND  H held   d derivable-from-held   $ free-debt (obtainable, not ingested)   X gated (paid/credential/quarterly)   · N/A`);
console.log(`    TALLY   ${tally.HELD} held · ${tally.DERIVE} derivable · ${tally.DEBT} free-debt · ${tally.GATED} gated  (across applicable cells)`);
console.log(`\n    WHAT IS UNACCOUNTED FOR, EXACTLY:`);
console.log(`      FREE DEBT (a research failure, not a market finding — now allowlisted, just needs ingesting):`);
for (const d of DRIVERS) if (Object.values(d.cells).includes("DEBT")) console.log(`        · ${d.name.trim()} — ${d.note}`);
console.log(`      GATED (a real barrier, named):`);
for (const d of DRIVERS) if (Object.values(d.cells).includes("GATED")) console.log(`        · ${d.name.trim()} — ${d.note}`);
console.log(`\n    DERIVABLE-BUT-NOT-BUILT (held data, no driver computed yet): dollar basket, cross-asset ratios beyond`);
console.log(`    gold/silver, and seasonality are all COMPUTABLE from prices we hold — accounted for in DATA, not yet`);
console.log(`    wired as explicit conditioning drivers. That is a build task, not a data gap.`);
console.log(`\n    THE DISTINCTION THE SOURCE LIST OMITS: drivers 5 and 10 are EXPLAIN-only — central-bank flows are`);
console.log(`    quarterly-lagged and the attribution framework decomposes the PAST. They explain a move; they do not`);
console.log(`    condition a position. A driver being real does not make it tradable. This matrix is OPEN, not a`);
console.log(`    completeness claim — a driver type absent here is a prompt to add a row, per THE COVERAGE LAW.`);
