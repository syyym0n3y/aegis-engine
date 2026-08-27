#!/usr/bin/env -S deno run --allow-net --allow-env
// benchmark-guard.ts (W4, D-636) — the 19th guard, enforcing the law that has been most productive and least written down.
//
// THE LAW: a long-short or quantile SPREAD says nothing about whether either leg earns anything. A spread can be
// large and precisely estimated while both legs are dominated by universe drift. Every cross-sectional return claim
// must therefore state its ABSOLUTE decomposition — the universe mean over the same periods, and the flagged
// bucket's excess against it — or it is not a claim about a signal.
//
// WHY IT NEEDED A GUARD. In one session the absolute diagnostic killed or reshaped three findings:
//   D-627  the fails headline -11.10%/yr decomposed to an excess of ~-2.75%/yr; the short leg RISES.
//   D-630  short-volume surprise, headline t -7.37, has an excess of t -0.46 — the cross-section is FLAT
//          (extremes 0.779% vs 0.781%), so the headline measured estimation precision, not return.
//   D-633  the fails excess lives entirely in the LIQUID half; the illiquid half carries the WRONG SIGN.
// The law was referenced in code comments and in three decision entries. It appeared ZERO times in CLAUDE.md and had
// no machine enforcement, while 105 recorded rows report a return or Sharpe with no decomposition at all.
//
// WHY IT REDS ON NEW WORK ONLY. A guard that goes RED on 42 live rows on the day it ships cannot be cleared, and an
// unclearable guard gets switched off — the exact failure that let the agent-output defects run nine cycles. So this
// one binds work recorded from its adoption forward, and REPORTS the pre-existing backlog every run so it cannot be
// quietly forgotten. That is remediation, not amnesty: the backlog count is printed, never suppressed.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("benchmark-guard", [
  { name: "SELFTEST", def: "", note: "prove the guard fails before trusting its green" },
  { name: "ADOPTED", def: "2026-08-27", note: "rows resolved on/after this date must comply" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
const ADOPTED = Deno.env.get("ADOPTED") || "2026-08-27";

async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "bmg", exp: 4102444800 });
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

// A return claim: a %/yr figure, a Sharpe, or an SR.
const CLAIMS_RETURN = /(-?\d+(\.\d+)?\s*%\s*\/\s*yr)|(\bSharpe\s+-?\d)|(\bSR\s+-?\d)/i;
// An absolute decomposition: the universe/benchmark mean, or an explicitly-labelled excess.
const HAS_ABSOLUTE = /universe mean|absolute diagnostic|excess vs|benchmark law|vs universe|excess of|raw bucket|bucket raw/i;
// Families where a universe decomposition is meaningless: one instrument, or a timing rule on a single series.
// Stated explicitly so the scoping is auditable rather than a silent carve-out — the execution and selection guards
// both shipped with negation bugs precisely here.
const EXEMPT_FAMILY = /^(infra|infrastructure|method|nonreliance|risk-management|attribution)$/i;
// NOTE THE ABSENCE OF "DESCRIPTIVE ONLY". It was in this list in the first version and it GUTTED THE GUARD: that
// marker is a MECHANISM-LAW stamp meaning "no causal claim is being made", which is orthogonal to whether a return
// is claimed — and nearly every honest row carries it, so 34 rows were being waved through as exempt, including
// D-630 and D-633 which actually DO carry full decompositions and should have counted as compliant. An exemption
// keyed on an unrelated marker is worse than no guard, because the green is arithmetically meaningless.
const EXEMPT_TEXT = /single instrument|one instrument|timing rule|no cross-section|\bUNTESTED\b|\bUNDERPOWERED\b/i;

interface Row { id: string; family: string; status: string; key_metric: string; verdict: string; resolved_at: string | null }

const rows = await mustFetch(`${OWNED}/trd_lineage?select=id,family,status,key_metric,verdict,resolved_at&order=id&limit=5000`, "trd_lineage") as unknown as Row[];

let red = 0, backlog = 0, exempt = 0, ok = 0;
const redRows: string[] = [];

for (const r of rows) {
  const text = `${r.key_metric ?? ""} ${r.verdict ?? ""}`;
  if (!CLAIMS_RETURN.test(text)) continue;
  if (EXEMPT_FAMILY.test(r.family ?? "") || EXEMPT_TEXT.test(text)) { exempt++; continue; }
  if (HAS_ABSOLUTE.test(text)) { ok++; continue; }
  // Non-compliant. Bind only work resolved on/after adoption; everything earlier is reported as backlog.
  const when = (r.resolved_at ?? "").slice(0, 10);
  if (when && when >= ADOPTED) { red++; redRows.push(`${r.id} [${r.family}/${r.status}]`); }
  else backlog++;
}

console.log(`==> BENCHMARK GUARD — a spread is not a return until its universe is subtracted`);
console.log(`    compliant ${ok}  |  exempt ${exempt}  |  pre-adoption backlog ${backlog}  |  post-adoption violations ${red}`);
if (backlog) {
  console.log(`    BACKLOG NOT AMNESTIED: ${backlog} row(s) recorded before ${ADOPTED} claim a return with no absolute`);
  console.log(`    decomposition. Each is a number that may be universe drift — D-630 found exactly this shape at t -7.37.`);
}
for (const x of redRows) console.log(`  RED  ${x} — claims a return with no universe decomposition`);

if (Deno.env.get("SELFTEST") === "1") {
  console.log(`\n  SELFTEST:`);
  const bad = "BOOK long-short: -9.56%/yr PORTFOLIO t -7.80";
  const good = "BOOK -9.56%/yr t -7.80; universe mean +0.353%/20d, EXCESS vs universe -0.138% t -1.99";
  const none = "corr 0.114 against a 0.8 disqualifier; no return claimed";
  const c1 = CLAIMS_RETURN.test(bad) && !HAS_ABSOLUTE.test(bad);
  const c2 = CLAIMS_RETURN.test(good) && HAS_ABSOLUTE.test(good);
  const c3 = !CLAIMS_RETURN.test(none);
  // The exemption bug this guard shipped with, now permanently tested: a row marked DESCRIPTIVE ONLY that also
  // carries a return and a decomposition must be COMPLIANT, never exempt.
  const desc = "BOOK -9.56%/yr t -7.80; universe mean +0.353%; excess vs universe -0.138% | DESCRIPTIVE ONLY";
  const c4 = CLAIMS_RETURN.test(desc) && HAS_ABSOLUTE.test(desc) && !EXEMPT_TEXT.test(desc);
  console.log(`    flags a bare spread ...................... ${c1 ? "YES" : "NO"}`);
  console.log(`    passes one with a universe decomposition . ${c2 ? "YES" : "NO"}`);
  console.log(`    ignores a row claiming no return ......... ${c3 ? "YES" : "NO"}  (the negation case both the execution and selection guards got wrong)`);
  console.log(`    does NOT exempt a DESCRIPTIVE-ONLY row that claims a return ... ${c4 ? "YES" : "NO"}  (the exemption bug this guard shipped with)`);
  if (!c1 || !c2 || !c3 || !c4) { console.log(`    SELFTEST FAILED — guard does not discriminate. RED.`); Deno.exit(1); }
  console.log(`    SELFTEST PASSED.`);
}

console.log(`\n  ${red === 0
  ? "NO POST-ADOPTION VIOLATIONS — every return claimed since " + ADOPTED + " states what it is a return ABOVE."
  : `${red} POST-ADOPTION VIOLATION(S) — a spread was reported as a return without subtracting its universe.`}`);
if (red > 0) Deno.exit(1);
