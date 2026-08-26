#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-run
// forward-scorer.ts (D-613) — the missing half of the PRE-COMMITMENT LAW, and the thing that makes this outlive a session.
//
// THE GAP IT CLOSES. D-571 built trd_forward_rules with an immutability trigger so a forward test could not be
// rationalised after the fact. Five clocks now run against it — the paper book, crypto lit5, residual-follow, the
// eight payout leads, and the hedging-pressure flip. NOTHING SCORED THEM. `forward-rules-guard.ts` checks a rule is
// two-sided and numeric; it never asks what the data has since done.
//
// That gap is worse than it looks. A registered-but-unscored rule produces the FEELING of discipline while leaving
// the discretion exactly where it was, because whoever reads the numbers in 2028 still decides what they meant. The
// whole point of writing the kill condition first is that something else applies it.
//
// WHAT THIS DOES, and deliberately does not do:
//   - records an append-only MARK per rule per run: elapsed days, whatever is computable now, and maturity
//   - goes RED when a clock has MATURED and carries no verdict, so an unevaluated mature rule cannot be ignored
//   - it does NOT invent verdicts. Each rule's spec needs its own measurement, and a generic scorer that guessed
//     would be worse than one that says "matured, needs evaluation" in a place nobody can miss.
// The honest division: the machine tracks the clock and refuses to let maturity pass silently; a human or a
// spec-specific script supplies the number.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

declareKnobs("forward-scorer", [{ name: "QUIET", def: "", note: "1 = suppress per-rule detail" }]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fs", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();

async function mustFetch(url: string, what: string): Promise<any[]> {
  let r: Response;
  try { r = await fetch(url, { headers: hdr }); }
  catch (e) { console.error(`!! cannot reach ${what}: ${e instanceof Error ? e.message : e} — RED.`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! ${what} HTTP ${r.status} — RED.`); Deno.exit(1); }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error(`!! ${what} returned no rows — RED.`); Deno.exit(1); }
  return j;
}

// Horizon in days, parsed from what each rule itself pre-registered. Where a rule states weeks or months, that
// statement governs — the scorer does not get to pick a friendlier horizon than the one on record.
const HORIZON: Record<string, number> = {
  "fwd-payout-8": 365,                 // "monthly scoring", first meaningful read at a year
  "fwd-book-p2-paper": 30 * 30,        // ">=30 independent monthly marks"
  "fwd-crypto-lit5": 365,              // "daily marks; earliest meaning" — a year
  "fwd-residual-follow": 183,          // "first read at >=6 months"
  "fwd-hedging-pressure-flip": 104 * 7, // "104 forward weeks minimum in EACH universe"
};

const rules = await mustFetch(`${OWNED}/trd_forward_rules?select=id,clock_started,horizon_desc,promote_if,kill_if`, "trd_forward_rules") as
  { id: string; clock_started: string; horizon_desc: string; promote_if: string; kill_if: string }[];
const marks = await mustFetch(`${OWNED}/trd_forward_marks?select=rule_id,verdict,marked_at&order=marked_at.desc`, "trd_forward_marks") as
  { rule_id: string; verdict: string | null; marked_at: string }[];
const hasVerdict = new Set(marks.filter((m) => m.verdict).map((m) => m.rule_id));

const today = new Date();
let matured = 0, pending = 0, unevaluated: string[] = [];
console.log(`==> FORWARD SCORER — ${rules.length} registered clock(s), ${today.toISOString().slice(0, 10)}`);

for (const r of rules) {
  const started = new Date(r.clock_started + "T00:00:00Z");
  const elapsed = Math.floor((today.getTime() - started.getTime()) / 86400000);
  const horizon = HORIZON[r.id] ?? 365;
  const isMature = elapsed >= horizon;
  const decided = hasVerdict.has(r.id);
  if (isMature) matured++; else pending++;
  if (isMature && !decided) unevaluated.push(r.id);

  // Append the reading. metric_value stays null: this scorer tracks the CLOCK, and inventing a number per spec is
  // exactly the discretion the pre-registration exists to remove.
  await fetch(`${OWNED}/trd_forward_marks`, {
    method: "POST",   // plumbing-ok: audited — response checked immediately below and reported per rule
    headers: { ...hdr, Prefer: "return=minimal" },
    body: JSON.stringify({
      rule_id: r.id, elapsed_days: elapsed, metric_name: "clock", metric_value: null,
      matured: isMature,
      note: `elapsed ${elapsed}d of ${horizon}d horizon (${r.horizon_desc.slice(0, 60)})`,
    }),
  }).then((res) => { if (!res.ok) console.log(`    WRITE-FAILED mark for ${r.id}: ${res.status}`); })
    .catch(() => console.log(`    WRITE-FAILED mark for ${r.id}: network`));

  if (Deno.env.get("QUIET") !== "1") {
    const pct = Math.min(100, Math.round(100 * elapsed / horizon));
    console.log(`  ${isMature ? (decided ? "DONE " : "RED  ") : "wait "} ${r.id.padEnd(28)} ${String(elapsed).padStart(5)}d / ${String(horizon).padStart(5)}d  ${String(pct).padStart(3)}%${isMature && !decided ? "   MATURED AND UNEVALUATED" : ""}`);
  }
}

console.log(`\n  ${pending} clock(s) still running, ${matured} matured.`);
if (unevaluated.length) {
  console.log(`  ${unevaluated.length} MATURED WITHOUT A VERDICT: ${unevaluated.join(", ")}`);
  console.log(`  A pre-registered rule that reaches its horizon and is never scored leaves the discretion it was`);
  console.log(`  written to remove. Evaluate it against its own promote_if / kill_if and record the verdict.`);
  Deno.exit(1);
}
console.log(`  No matured rule is missing a verdict.`);
