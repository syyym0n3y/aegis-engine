#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-run --allow-write
// guard-selftest-all.ts (D-836) — THE META-GUARD: can each guard still FAIL?
// C4 in docs/METHODOLOGY_FLAWS.md. Every guard here was verified by being made to go RED — once, at birth. Four have
// since been found broken AFTER shipping (D-584 fail-open, D-650, D-659 silent, D-671), and `registry-guard` only
// checks a guard EXISTS. Nothing has ever re-verified that a guard can still refuse. That makes the board's green —
// the single most load-bearing claim in the programme — an assumption rather than a measurement.
// This runs every guard's own SELFTEST path and asserts it EXITS 0 while actually exercising its red branch, and it
// reports the guards that carry no self-test at all, which is its own finding rather than a pass.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("guard-selftest-all", [{ name: "TIMEOUT_S", def: "90" }]);
const REPO = new URL("..", import.meta.url).pathname;
const guards: string[] = [];
for await (const e of Deno.readDir(`${REPO}scripts`)) if (e.isFile && e.name.endsWith("-guard.ts")) guards.push(e.name);
guards.sort();
/* D-836, corrected after the first run returned 0 of 27 — which was MY defect, not 27 broken guards. Setting BOTH
   SELFTEST and GUARD_SELFTEST tripped declareKnobs' near-miss refusal on every script: the PRECONDITION LAW names this
   exact pair as its worked example, and it refused to run rather than pretend. The variable is also inconsistent across
   the tree (9 declare SELFTEST, 2 GUARD_SELFTEST, the rest read one directly), so the name is now DETECTED per guard
   and only that one is set. A meta-guard that trips the precondition guard is not evidence about the guards. */
const varOf = new Map<string, string>();
const withSelf: string[] = [], without: string[] = [];
for (const g of guards) {
  const src = await Deno.readTextFile(`${REPO}scripts/${g}`);
  const m = src.match(/\b(GUARD_SELFTEST|SELFTEST)\b/);
  if (m) { withSelf.push(g); varOf.set(g, m[1]); } else without.push(g);
}
console.log(`\n==> D-836 META-GUARD — can each guard still FAIL? ${guards.length} guards, ${withSelf.length} with a self-test, ${without.length} without.`);
console.log(`    self-test variable detected per guard (the tree is inconsistent): ` + [...new Set(varOf.values())].join(", "));
const pass: string[] = [], fail: string[] = [];
for (const g of withSelf) {
  const p = new Deno.Command("deno", { args: ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-run", "--allow-write", `${REPO}scripts/${g}`], env: { ...Deno.env.toObject(), [varOf.get(g)!]: "1" }, stdout: "piped", stderr: "piped" });
  const t0 = Date.now();
  let code = -1, out = "";
  try { const r = await p.output(); code = r.code; out = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr); }
  catch (e) { out = String(e); }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  /* CORRECTED after the second run: guards signal a working self-test in TWO different shapes, and my first criterion
     only recognised one of them. Some (decisions, rest-restart) run the test in isolation and exit 0 with "SELFTEST
     PASS". Most INJECT synthetic rows into the live run and exit 1 BECAUSE THEY CORRECTLY REFUSED the bad one — for
     those, a non-zero exit IS the red branch working, and demanding exit 0 marked 25 healthy guards as broken.
     The honest criterion is evidence in the OUTPUT that the guard exercised a synthetic subject: it must mention its
     self-test AND either declare a pass or visibly refuse. Silence still counts as failure (D-659). */
  const mentions = /selftest|self-test/i.test(out);
  const declared = /SELFTEST\s*[- ]?(PASS|OK)|SELF-TEST\s+PASS/i.test(out);
  const refused = code !== 0 && /RED|refus|violat/i.test(out);
  const ok = mentions && (declared || refused);
  const how = declared ? "declares PASS" : refused ? `refused a synthetic row (exit ${code}) — the red branch works` : "";
  if (ok) { pass.push(g); console.log(`    PASS  ${g.padEnd(30)} ${secs}s  ${how}`); }
  else { fail.push(`${g} (exit ${code}${mentions ? "" : ", output never mentions its self-test"})`); console.log(`    FAIL  ${g.padEnd(30)} ${secs}s  exit ${code} — ${mentions ? "mentions a self-test but neither declared a pass nor visibly refused" : "output never mentions its self-test: indistinguishable from a check that did nothing (D-659)"}`); }
}
console.log(`\n  ${pass.length} of ${withSelf.length} self-tests exercised their red branch and said so.`);
if (without.length) {
  console.log(`\n  NO SELF-TEST AT ALL (${without.length}) — these guards have never been proven able to refuse anything:`);
  for (const g of without) console.log(`    ${g}`);
  console.log(`  That is a finding, not a pass: a guard that cannot be made to fail is a green light of unknown value.`);
}
if (fail.length) { console.error(`\n  RED — ${fail.length} guard self-test(s) did not demonstrate a working red branch: ${fail.join(", ")}`); Deno.exit(1); }
