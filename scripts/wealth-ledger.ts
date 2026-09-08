#!/usr/bin/env -S deno run --allow-net --allow-env
// wealth-ledger.ts (D-795) — the STRUCTURAL ENGINE, exercised instead of documented. WEALTH_PATH §3: at this budget
// terminal wealth ≈ deposits × compounding × (1 − leakage) + alpha, alpha = 0. Every term was MEASURED (D-735 9.04× over
// 34y at $150/mo; D-744 holdability; D-758 ISA worth 0.63–1.45%/yr; D-731 currency-of-account ~1.3pp/yr) and NONE was
// tracked. A lever that is not tracked is not exercised. This is the operator-owned ledger + daily report:
//   record:  ADD_DEPOSIT=150 [ADD_DATE=2026-09-06] [CCY=GBP]        -> one append-only row (series ledger_deposit_<ccy>, d, v)
//   settle:  SET_WRAPPER=isa|gia  SET_CCY_LEAK_BP=130                -> the two one-time structural choices, as facts
//   report:  (no knobs)                                               -> adherence to plan, multiplier to date, leakage cost
// Rows live in trd_macro_series (generic keyed store, no schema change). Reads are STRICT (D-757). The report is RED-loud
// when nothing is logged, because "the structural engine is not running" is the largest financial fact on the stack.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("wealth-ledger", [
  { name: "ADD_DEPOSIT", def: "", note: "amount to record as a deposit (positive number); empty = report only" },
  { name: "ADD_DATE", def: "", note: "YYYY-MM-DD for the deposit; empty = today UTC" },
  { name: "CCY", def: "GBP", note: "ledger currency (UK operator, D-731/D-758)" },
  { name: "SET_WRAPPER", def: "", note: "isa | gia | none — records the tax-wrapper choice as a fact (D-758); none = no investment account exists yet (D-823c)" },
  { name: "SET_CCY_LEAK_BP", def: "", note: "measured currency-of-account leakage in bp/yr (D-731 default 130 if unset)" },
  { name: "PLAN_MONTHLY", def: "150", note: "the plan's monthly deposit (D-735 replay used 150/mo)" },
  { name: "ANCHOR_TERMINAL", def: "547847", note: "D-735 replay terminal on 150/mo over 34y — the annual return is DERIVED from this, not typed" },
  { name: "HORIZON_Y", def: "34", note: "D-735 horizon" },
  { name: "SELFTEST", def: "0", note: "1 = exercise the arithmetic on a synthetic ledger and exit (no writes)" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "wl", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const CCY = K.CCY.toUpperCase(), DEP = `ledger_deposit_${CCY.toLowerCase()}`, WRAP = "ledger_wrapper_isa", LEAK = "ledger_ccy_leak_bp";
const today = new Date().toISOString().slice(0, 10);
const PLAN = Number(K.PLAN_MONTHLY), ANCHOR = Number(K.ANCHOR_TERMINAL), HY = Number(K.HORIZON_Y);

// ---- pure arithmetic (self-testable) ----
// future value of a level monthly deposit stream at annual rate r over Y years (monthly compounding of the annual rate)
function fvMonthly(monthly: number, r: number, years: number): number {
  const m = Math.pow(1 + r, 1 / 12) - 1, n = Math.round(years * 12);
  return m === 0 ? monthly * n : monthly * ((Math.pow(1 + m, n) - 1) / m);
}
// The annual return IMPLIED by the D-735 replay (terminal on a level deposit stream), by bisection. THE FIRST SELF-TEST
// OF THIS SCRIPT CAUGHT A MISLABEL: WEALTH_PATH.md quotes "9.04x, 6.8% CAGR" — 6.8% is the LUMP-SUM equivalent of 9.04x
// over 34y; a deposit stream's average dollar is invested ~17y, so the replay's underlying total return is ~10.9%/yr.
// fvMonthly(150, 6.8%, 34y) = 228,196, not 547,847. The rate is therefore DERIVED from the anchor, never typed.
function impliedRate(monthly: number, terminal: number, years: number): number {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (fvMonthly(monthly, mid, years) < terminal) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// value today of deposits made on given dates, compounded at r to `asOf`
function valueToDate(deps: { d: string; v: number }[], r: number, asOf: string): number {
  const t1 = Date.parse(asOf + "T00:00:00Z");
  return deps.reduce((s, x) => s + x.v * Math.pow(1 + r, (t1 - Date.parse(x.d + "T00:00:00Z")) / (365.25 * 86400e3)), 0);
}
const RATE = impliedRate(150, ANCHOR, 34);
if (K.SELFTEST === "1") {
  const fv = fvMonthly(150, RATE, 34), dep = 150 * 34 * 12;
  const okFv = Math.abs(fv / ANCHOR - 1) < 1e-3;                       // the derived rate must reproduce the anchor
  const okLabel = Math.abs(fvMonthly(150, 0.068, 34) / ANCHOR - 1) > 0.3; // and the mislabelled 6.8% must NOT (guards the correction)
  const syn = [{ d: "2025-09-06", v: 150 }, { d: "2026-03-06", v: 150 }];
  const vtd = valueToDate(syn, RATE, "2026-09-06");
  const okVtd = vtd > 300 && vtd < 330;      // 150 for 1y (≈166) + 150 for 0.5y (≈158) at ~10.9%
  console.log(`  SELFTEST implied annual return from D-735 anchor (${ANCHOR} on 150/mo, 34y) = ${(RATE * 100).toFixed(2)}%; fvMonthly at that rate = ${fv.toFixed(0)} (${(fv / dep).toFixed(2)}x on ${dep}) ${okFv ? "OK" : "FAIL"}`);
  console.log(`  SELFTEST the WEALTH_PATH "6.8%" label gives ${fvMonthly(150, 0.068, 34).toFixed(0)} — a lump-sum figure misapplied to a stream ${okLabel ? "(mislabel confirmed, correction stands)" : "FAIL"}`);
  console.log(`  SELFTEST valueToDate(2 synthetic deposits) = ${vtd.toFixed(1)} ${okVtd ? "OK" : "FAIL"}`);
  console.log(okFv && okLabel && okVtd ? "  SELFTEST OK" : "  SELFTEST FAILED"); Deno.exit(okFv && okLabel && okVtd ? 0 : 2);
}
const CAGR = RATE;   // used by the report below: the replay-implied total return on a deposit stream

// ---- writes (operator actions), each read back ----
async function put(rows: { series: string; d: string; v: number }[]) {
  const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify(rows) });
  if (!w.ok) { console.error(`!! WRITE FAILED HTTP ${w.status}: ${(await w.text()).slice(0, 200)}`); Deno.exit(1); }
  for (const r of rows) {
    const back = await q(`trd_macro_series?series=eq.${r.series}&d=eq.${r.d}&select=v`) as { v: number }[];
    if (!back.length || Math.abs(back[0].v - r.v) > 1e-9) { console.error(`!! READ-BACK: ${r.series}@${r.d} not landed. RED.`); Deno.exit(1); }
  }
}
if (K.ADD_DEPOSIT) {
  const v = Number(K.ADD_DEPOSIT); const d = K.ADD_DATE || today;
  if (!(v > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { console.error(`!! ADD_DEPOSIT must be > 0 and ADD_DATE YYYY-MM-DD`); Deno.exit(1); }
  // a second deposit on the same date ADDS (series,d is the key): read existing first
  const ex = await q(`trd_macro_series?series=eq.${DEP}&d=eq.${d}&select=v`) as { v: number }[];
  await put([{ series: DEP, d, v: (ex[0]?.v ?? 0) + v }]);
  console.log(`  recorded deposit ${CCY} ${v} on ${d}${ex.length ? ` (added to existing ${ex[0].v})` : ""}`);
}
if (K.SET_WRAPPER) { const w = K.SET_WRAPPER.toLowerCase(); if (!["isa", "gia", "none"].includes(w)) { console.error("!! SET_WRAPPER must be isa | gia | none"); Deno.exit(1); } const isa = w === "isa" ? 1 : w === "gia" ? 0 : -1; await put([{ series: WRAP, d: today, v: isa }]); console.log(`  recorded wrapper = ${isa === 1 ? "ISA" : isa === 0 ? "GIA" : "NONE (no investment account yet)"} as of ${today}`); }
if (K.SET_CCY_LEAK_BP) { await put([{ series: LEAK, d: today, v: Number(K.SET_CCY_LEAK_BP) }]); console.log(`  recorded currency-of-account leakage = ${K.SET_CCY_LEAK_BP} bp/yr as of ${today}`); }

// ---- report ----
const deps = (await q(`trd_macro_series?series=eq.${DEP}&select=d,v&order=d.asc`)) as { d: string; v: number }[];
const wrapRows = (await q(`trd_macro_series?series=eq.${WRAP}&select=d,v&order=d.desc&limit=1`)) as { d: string; v: number }[];
const leakRows = (await q(`trd_macro_series?series=eq.${LEAK}&select=d,v&order=d.desc&limit=1`)) as { d: string; v: number }[];
console.log(`==> WEALTH LEDGER (${CCY}) — the structural engine, tracked. Plan ${PLAN}/mo, CAGR ${(CAGR * 100).toFixed(1)}% (D-735), horizon ${HY}y`);
if (!deps.length) {
  console.log(`  !! NO DEPOSITS LOGGED. The structural engine — the largest measured lever on this stack (D-735: ${fvMonthly(PLAN, CAGR, HY).toFixed(0)} on ${PLAN * HY * 12} deposited, ${(fvMonthly(PLAN, CAGR, HY) / (PLAN * HY * 12)).toFixed(2)}x) — is NOT RUNNING, or is running untracked.`);
  console.log(`     Record with: ADD_DEPOSIT=<amount> [ADD_DATE=YYYY-MM-DD] deno run --allow-net --allow-env scripts/wealth-ledger.ts`);
  console.log(`     Every month not deposited costs more than any edge this engine has ever promoted (D-746: below ~$60k, the next deposit beats a 3% alpha).`);
} else {
  const total = deps.reduce((s, x) => s + x.v, 0);
  const first = deps[0].d, months = Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / (30.44 * 86400e3)) + 1);
  const planToDate = PLAN * months, adherence = total / planToDate;
  const vtd = valueToDate(deps, CAGR, today);
  const paceMonthly = total / months;
  const termPlan = fvMonthly(PLAN, CAGR, HY), termPace = fvMonthly(paceMonthly, CAGR, HY);
  console.log(`  deposits: ${deps.length} rows, ${CCY} ${total.toFixed(0)} since ${first} (${months} mo) — pace ${paceMonthly.toFixed(0)}/mo vs plan ${PLAN}/mo = ${(adherence * 100).toFixed(0)}% adherence`);
  console.log(`  value-to-date at ${(CAGR * 100).toFixed(1)}%: ${CCY} ${vtd.toFixed(0)} (multiplier ${(vtd / total).toFixed(3)}x so far — the multiplier is on TIME; it is small early by construction)`);
  console.log(`  terminal at ${HY}y: plan ${termPlan.toFixed(0)} | at current pace ${termPace.toFixed(0)} | gap ${(termPace - termPlan).toFixed(0)} (linear in the deposit — D-746)`);
}
const isa = wrapRows[0]?.v; const leakBp = leakRows[0]?.v ?? 130;
console.log(`  wrapper: ${isa === undefined ? "NOT RECORDED (set SET_WRAPPER=isa|gia|none) — D-758 values the ISA at 0.63–1.45%/yr alpha-equivalent, more than any promoted edge" : isa === -1 ? "NONE — no investment account exists yet (recorded D-823c); the D-758 wrapper value (0.63–1.45%/yr) is NOT being captured and a prop payout is not a wrapper" : isa ? "ISA (D-758: worth 0.63–1.45%/yr, forecast-free)" : "GIA — the D-758 0.63–1.45%/yr is being LEFT ON THE TABLE"}`);
console.log(`  currency-of-account leakage: ${leakRows.length ? `${leakBp} bp/yr recorded` : `${leakBp} bp/yr (D-731 default, NOT yet measured on the live account — set SET_CCY_LEAK_BP)`} — over ${HY}y at ${(CAGR * 100).toFixed(1)}% that is ~${((1 - Math.pow((1 + CAGR - leakBp / 1e4) / (1 + CAGR), HY)) * 100).toFixed(0)}% of terminal wealth`);
// D-804: the clock count was a printed literal ("18") while the table held 17 — a number that is not measured is the class this
// programme exists to kill. Read it live; print UNREADABLE rather than a guess if the table cannot be read.
const rc = await fetch(`${OWNED}/trd_forward_rules?select=id`, { headers: { ...hdr, Prefer: "count=exact" } });
const nClocks = rc.ok ? (rc.headers.get("content-range")?.split("/")[1] ?? "?") : "UNREADABLE";
console.log(`  alpha: 0 promoted (${nClocks} clocks live). This report is the whole of the 10^7 lever that is inside the market; the rest is income (Revitalise) and time.`);
