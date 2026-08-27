#!/usr/bin/env -S deno run --allow-net --allow-env
// turnover-guard.ts (D-656) — the 20th guard. A per-trade cost is not a cost model.
//
// THE LAW: the drag on a rebalanced strategy is TURNOVER x COST, not cost alone. A row quoting a round-trip fee in
// basis points without saying how OFTEN it trades has stated half its expenses, and the half it omitted is the half
// that decides.
//
// ORIGIN — it killed the best candidate this programme has produced, on the same day it was found. D-653 measured EM
// large-cap momentum at +4.2%/yr over the market, t 3.98. It passed every structural gate that had killed its
// siblings: BIG/SMALL 0.90 against a 50% floor (developed markets came in at 0.31-0.47), a long-only leg needing no
// borrow and significant where the developed equivalent was t 1.85, positive in all four eras with no sign flip.
// D-654 then measured turnover at 33.5% one-way monthly — 67.1% of portfolio value traded per month:
//
//     @20bp round trip   cost 1.61%/yr   net +2.59%/yr   implied t  2.45
//     @60bp round trip   cost 4.83%/yr   net -0.63%/yr   implied t -0.60
//
// EM large-cap execution is not under 35bp. A 4.2%/yr edge that costs 4.8%/yr to harvest is not an edge; it is a
// description of a rebalancing schedule. Nothing in the ledger required that number, and 44 of 45 live return claims
// did not carry it.
//
// WHY THE EXISTING LAWS DO NOT COVER THIS. THE EFFECT-SIZE LAW asks for return per 1sd of signal measured in
// multiples of the round-trip cost — the right question for a per-trade signal, silent for a portfolio held and
// rebalanced. THE EXECUTION LAW asks whether a passive fill assumption survives (D-445: filled days returned
// -1.85bp against +68bp unfilled). Both concern ONE trade. Neither asks how many trades there are.
//
// WHAT IT REDS ON: a post-adoption row claiming a %/yr or Sharpe from a REBALANCED construction with no turnover
// statement. WHAT IT REPORTS: the pre-existing backlog, every run, never amnestied.
// WHAT IT EXEMPTS: single-instrument and event-study rows, where "turnover" is not defined by the construction, and
// rows claiming no return. Both stated so the scoping is auditable rather than a silent carve-out.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("turnover-guard", [
  { name: "SELFTEST", def: "", note: "prove the guard fails before trusting its green" },
  { name: "ADOPTED", def: "2026-08-27", note: "rows resolved on/after this date must comply" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const ADOPTED = Deno.env.get("ADOPTED") || "2026-08-27";

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "tg", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

async function mustFetch(url: string, what: string): Promise<Record<string, unknown>[]> {
  let r: Response;
  try { r = await fetch(url, { headers: hdr }); }
  catch (e) { console.error(`!! cannot reach ${what}: ${e instanceof Error ? e.message : e} — RED (a guard that cannot read its input is not green).`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! ${what} HTTP ${r.status} — RED.`); Deno.exit(1); }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error(`!! ${what} returned no rows — RED.`); Deno.exit(1); }
  return j as Record<string, unknown>[];
}

const CLAIMS_RETURN = /(-?\d+(\.\d+)?\s*%\s*\/\s*yr)|(\bSharpe\s+-?\d)|(\bSR\s+-?\d)/i;
const HAS_TURNOVER  = /turnover|rebalance[sd]? per|holding period|hold \d+ ?(d|day|session)|trades per|one-way/i;
// A rebalanced construction: cross-sections, books, quantile sorts, overlays. These trade repeatedly by design.
const REBALANCED    = /quintile|decile|tercile|cross-section|rebalanc|long-short|book\b|overlay|portfolio|spread/i;
// Not rebalanced in the sense that matters: one instrument, or an event study where the construction defines entry.
const EXEMPT_TEXT   = /single instrument|one instrument|event study|per event|\bUNTESTED\b|\bUNDERPOWERED\b|no return (is )?claim/i;
const EXEMPT_FAMILY = /^(infra|infrastructure|method|nonreliance|risk-management|attribution)$/i;

interface Row { id: string; family: string; status: string; key_metric: string; verdict: string; resolved_at: string | null }
const rows = await mustFetch(`${OWNED}/trd_lineage?select=id,family,status,key_metric,verdict,resolved_at&order=id&limit=5000`, "trd_lineage") as unknown as Row[];

let red = 0, backlog = 0, exempt = 0, ok = 0;
const redRows: string[] = [];
for (const r of rows) {
  const text = `${r.key_metric ?? ""} ${r.verdict ?? ""}`;
  if (!CLAIMS_RETURN.test(text)) continue;
  if (EXEMPT_FAMILY.test(r.family ?? "") || EXEMPT_TEXT.test(text)) { exempt++; continue; }
  if (!REBALANCED.test(text)) { exempt++; continue; }
  if (HAS_TURNOVER.test(text)) { ok++; continue; }
  const when = (r.resolved_at ?? "").slice(0, 10);
  if (when && when >= ADOPTED) { red++; redRows.push(`${r.id} [${r.family}/${r.status}]`); } else backlog++;
}

console.log(`==> TURNOVER GUARD — a per-trade cost is not a cost model`);
console.log(`    compliant ${ok}  |  exempt ${exempt}  |  pre-adoption backlog ${backlog}  |  post-adoption violations ${red}`);
if (backlog) {
  console.log(`    BACKLOG NOT AMNESTIED: ${backlog} row(s) recorded before ${ADOPTED} claim a return from a rebalanced`);
  console.log(`    construction without stating turnover. D-654 is what that omission costs: +4.2%/yr at t 3.98 became`);
  console.log(`    -0.63%/yr once 33.5% monthly turnover was measured.`);
}
for (const x of redRows) console.log(`  RED  ${x} — rebalanced return claimed with no turnover statement`);

if (Deno.env.get("SELFTEST") === "1") {
  console.log(`\n  SELFTEST:`);
  const bad  = "BOOK long-low / short-high quintile spread: 4.89%/yr PORTFOLIO t 1.24, costs 20bp round trip";
  const good = "quintile spread 3.01%/yr t 2.67; one-way monthly turnover 33.5%, net of 20bp = +1.40%/yr";
  const none = "corr 0.114 against a 0.8 disqualifier; no return claimed";
  const evt  = "delisting notices -42.6%/yr t -3.98, event study, 139 months";
  const c1 = CLAIMS_RETURN.test(bad) && REBALANCED.test(bad) && !HAS_TURNOVER.test(bad);
  const c2 = CLAIMS_RETURN.test(good) && HAS_TURNOVER.test(good);
  const c3 = !CLAIMS_RETURN.test(none);
  const c4 = EXEMPT_TEXT.test(evt);   // an event study must not be dragged in
  console.log(`    flags a quintile spread with a bp cost but no turnover ... ${c1 ? "YES" : "NO"}  (the D-654 shape exactly)`);
  console.log(`    passes a row stating turnover ......................... ${c2 ? "YES" : "NO"}`);
  console.log(`    ignores a row claiming no return ..................... ${c3 ? "YES" : "NO"}`);
  console.log(`    exempts an event study ............................... ${c4 ? "YES" : "NO"}  (turnover is undefined there)`);
  if (!c1 || !c2 || !c3 || !c4) { console.log(`    SELFTEST FAILED — guard does not discriminate. RED.`); Deno.exit(1); }
  console.log(`    SELFTEST PASSED.`);
}

console.log(`\n  ${red === 0
  ? `NO POST-ADOPTION VIOLATIONS — every rebalanced return claimed since ${ADOPTED} states how often it trades.`
  : `${red} POST-ADOPTION VIOLATION(S) — a rebalanced return was claimed without stating turnover.`}`);
if (red > 0) Deno.exit(1);
