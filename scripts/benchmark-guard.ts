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

// D-673: THE COST-INFLATION COROLLARY, previously the only law in doctrine with no machine check.
// A flat per-period cost shifts the mean and leaves the variance untouched, so charging a LOSING book manufactures
// its significance. Measured three times in one session, each ratio identical to two decimals:
//   TFF hedging pressure   gross t -1.54  reported t -9.26   mean ratio 6.02 / t ratio 6.01
//   settlement fails book  gross t -2.90  reported t -7.80   mean ratio 2.69 / t ratio 2.69
//   COT commodities        gross t -0.95  reported t -4.15   mean ratio 4.40 / t ratio 4.37
// A row asserting that something SIGNIFICANTLY LOSES must therefore carry its gross figure, because the net one can
// be manufactured at will by raising the assumed fee.
{
  const CLAIMS_SIG_LOSS = /(t\s*-[2-9]\d*(\.\d+)?)|(portfolio t\s*-[2-9])|(significantly (loses|negative))/i;
  const HAS_GROSS = /gross t|GROSS \(|gross of|COST_BP=0|before cost|gross portfolio t|pre-cost/i;
  let lossRed = 0, lossOk = 0, lossBacklog = 0;
  for (const r of rows) {
    const text = `${r.key_metric ?? ""} ${r.verdict ?? ""}`;
    if (!CLAIMS_SIG_LOSS.test(text)) continue;
    if (EXEMPT_FAMILY.test(r.family ?? "")) continue;
    if (HAS_GROSS.test(text)) { lossOk++; continue; }
    const when = (r.resolved_at ?? "").slice(0, 10);
    if (when && when >= ADOPTED) { lossRed++; console.log(`  RED  ${r.id.padEnd(30)} claims a significant LOSS with no gross figure beside it`); }
    else lossBacklog++;
  }
  console.log(`\n  COST-INFLATION COROLLARY: ${lossOk} row(s) state a gross figure beside a significant loss; ${lossBacklog} pre-adoption backlog; ${lossRed} post-adoption violation(s)`);
  if (lossBacklog) console.log(`    Backlog reported, not amnestied — three of these were measured and ALL THREE were artifacts.`);
  red += lossRed;
}

// D-684: THE SAME LAW CHECKED ARITHMETICALLY INSTEAD OF BY REGEX. The prose check above asks whether a row MENTIONS
// its gross figure — necessary, and it can only ever police what an author chose to write. `trd_factory` already
// stores gross_ann, net_ann and portfolio_t for every spec, and because a flat per-period cost leaves the variance
// untouched, the gross t is recoverable exactly:  t_gross = t_net * (gross_ann / net_ann).  No migration, no new
// column, no author cooperation. Applied across all 1,059 specs it found 49 that are significant at net and NOT at
// gross — a THIRD of every significant-loss claim in the factory — including the largest |t| the programme has ever
// recorded, `overnight|SPY|intraday` at t -22.30, whose gross counterpart is +1.87%/yr at t +0.86. The sign flips.
//
// WHAT IS AND IS NOT BEING ALLEGED. Charging the cost is CORRECT — trading an intraday split really does pay a
// round trip a day, and the overnight pass says so in its own header. The defect is that the LEDGER stores the net t
// as THE t with no gross counterpart, so every downstream reader, guard and summary sees -22.30 and reads it as a
// fact about markets. The honest statement is "no overnight/intraday effect (t 0.86), and trading it would cost
// ~50%/yr on top" — not "the overnight leg significantly loses".
{
  interface F { spec_key: string; family: string; gross_ann: number | null; net_ann: number | null; portfolio_t: number | null }
  // KEYSET on id, never OFFSET: spec_key is not unique and offset paging over ties silently drops rows (D-629).
  const specs: F[] = [];
  let after = "";
  for (;;) {
    const url = `${OWNED}/trd_factory?select=id,spec_key,family,gross_ann,net_ann,portfolio_t&order=id.asc&limit=1000${after ? `&id=gt.${after}` : ""}`;
    const page = await mustFetch(url, "trd_factory") as unknown as (F & { id: string })[];
    if (!page.length) break;
    specs.push(...page);
    after = page[page.length - 1].id;
    if (page.length < 1000) break;
  }
  if (!specs.length) { console.error(`!! trd_factory returned no specs — RED (a guard that reads nothing is not green).`); Deno.exit(1); }
  const sig = specs.filter((s) => s.portfolio_t !== null && s.gross_ann !== null && s.net_ann !== null && s.net_ann !== 0 && s.portfolio_t <= -2);
  const art = sig.filter((s) => Math.abs(s.portfolio_t! * (s.gross_ann! / s.net_ann!)) < 2);
  const byFam = new Map<string, number>();
  for (const a of art) byFam.set(a.family, (byFam.get(a.family) ?? 0) + 1);
  console.log(`\n  ARITHMETIC CHECK on ${specs.length} factory specs: ${sig.length} claim a significant loss (t <= -2);`);
  console.log(`    ${art.length} are COST ARTIFACTS — significant net, not significant gross.`);
  if (art.length) {
    console.log(`    by family: ${[...byFam].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}:${n}`).join("  ")}`);
    const worst = [...art].sort((a, b) => a.portfolio_t! - b.portfolio_t!).slice(0, 3);
    for (const w of worst) {
      console.log(`      ${w.spec_key.padEnd(34)} net ${(w.net_ann! * 100).toFixed(2)}%/yr t ${w.portfolio_t!.toFixed(2)}  ->  gross ${(w.gross_ann! * 100).toFixed(2)}%/yr t ${(w.portfolio_t! * (w.gross_ann! / w.net_ann!)).toFixed(2)}`);
    }
    console.log(`    Reported every run, never amnestied. These are not promotable and none is promoted — the harm is`);
    console.log(`    that their t-statistics are read as findings about markets when they are findings about a fee.`);
  }
}

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
