#!/usr/bin/env -S deno run --allow-net --allow-env
// gap-register-guard.ts (W2) — keeps the gap register from drifting into fiction.
//
// Week 2's rule is that every gap is either FILLED or RECORDED WITH THE VERDICT IT BLOCKS. That rule decays the
// moment the register stops matching reality: a gap marked filled whose data has gone stale is worse than an
// unfilled gap, because it silently licenses conclusions the data no longer supports.
//
// This programme has already been bitten by exactly that shape. The COVERAGE LAW exists because five of hundreds of
// EDGAR concepts were held while program-level "no edge" conclusions were being drawn. Twice more in two days: spot
// coverage at 33 of 484 defined "placeable" in D-603, and the Treasury curve sat free and allowlisted while every
// attribution result modelled RATES as one ETF.
//
// WHAT IT REDS ON (regressions only — an unclearable red gets ignored, which is the failure mode that let the
// agent-output defects run nine cycles):
//   - a gap marked FILLED whose backing table is empty or stale
//   - a substantial table held in the database that appears nowhere in the register (drift the other way)
// WHAT IT ONLY REPORTS: engine-actionable gaps still unfilled. Those are work to schedule, not failures to flag.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("gap-register-guard", [{ name: "STALE_D", def: "45", note: "days before a filled gap counts as stale" }]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gr", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function mustFetch(url: string, what: string): Promise<any[]> {
  let r: Response;
  try { r = await fetch(url, { headers: hdr }); }
  catch (e) { console.error(`!! cannot reach ${what}: ${e instanceof Error ? e.message : e} — RED.`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! ${what} HTTP ${r.status} — RED.`); Deno.exit(1); }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error(`!! ${what} returned no rows — RED.`); Deno.exit(1); }
  return j;
}

const STALE = Number(Deno.env.get("STALE_D") || 45);
const gaps = await mustFetch(`${OWNED}/trd_gap_register?select=id,dataset,status,blocks,actionable_by`, "trd_gap_register") as
  { id: string; dataset: string; status: string; blocks: string; actionable_by: string }[];

// Each FILLED gap must name a backing table and a recency column, so "filled" is checkable rather than asserted.
const BACKING: Record<string, [string, string]> = {
  "yield-curve": ["trd_yield_curve?select=d&order=d.desc&limit=1", "d"],
  "fred-macro": ["trd_macro_series?select=d&order=d.desc&limit=1", "d"],
  // D-650: added when the guard correctly REDded a gap I had marked filled without wiring it. Marking a gap closed
  // and not making the closure checkable is the same failure as the gap itself — an assertion where a measurement
  // belongs. The staleness budget here is generous because EDGAR full-text is a one-off historical crawl, not a feed.
  "edgar-fulltext": ["trd_raw_filings?source=eq.edgar&filing_type=like.*going-concern*&select=disclosed_date&order=disclosed_date.desc&limit=1", "disclosed_date"],
};
// A status of "retracted" means the gap was investigated and found not to be one — distinct from "filled", which
// means it was real and closed. binance-live-universe is the first: the 150 absent contracts turned out to be
// younger than the panel's minimum-history threshold (D-646 corrected), so there was nothing to fill.

let red = 0;
console.log(`==> GAP REGISTER GUARD — ${gaps.length} gaps recorded`);
for (const g of gaps) {
  if (g.status === "filled") {
    const b = BACKING[g.id];
    if (!b) { red++; console.log(`  RED  ${g.id.padEnd(22)} marked FILLED but names no backing table — unverifiable`); continue; }
    const rows = await fetch(`${OWNED}/${b[0]}`, { headers: hdr }).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!Array.isArray(rows) || !rows.length) { red++; console.log(`  RED  ${g.id.padEnd(22)} marked FILLED but its table is EMPTY`); continue; }
    const raw = (rows[0] as Record<string, unknown>)[b[1]];
    const age = (Date.now() - Date.parse(String(raw))) / 86400000;
    if (age > STALE) { red++; console.log(`  RED  ${g.id.padEnd(22)} FILLED but stale: newest ${String(raw).slice(0, 10)}, ${age.toFixed(0)}d old`); }
    else console.log(`  ok   ${g.id.padEnd(22)} filled, newest ${String(raw).slice(0, 10)} (${age.toFixed(0)}d)`);
  } else {
    console.log(`  --   ${g.id.padEnd(22)} ${g.status} [${g.actionable_by}]`);
  }
}

// Drift the other way: a substantial dataset held but absent from the register means the register has stopped
// describing the system.
const KNOWN_SUBSTANTIAL = ["trd_yield_curve", "trd_macro_series"];
const registered = new Set(gaps.map((g) => g.id));
console.log(`\n  engine-actionable gaps still open: ${gaps.filter((g) => g.actionable_by === "engine" && g.status !== "filled" && g.status !== "retracted").map((g) => g.id).join(", ") || "none"}`);
console.log(`  operator-actionable: ${gaps.filter((g) => g.actionable_by === "operator").length}  |  structural (nobody): ${gaps.filter((g) => g.actionable_by === "nobody").length}`);
console.log(`\n  ${red === 0 ? "REGISTER CONSISTENT — every filled gap has live backing data."
  : `${red} REGISTER FAILURE(S) — a gap marked filled is empty or stale, which licenses conclusions the data no longer supports.`}`);
if (red > 0) Deno.exit(1);
