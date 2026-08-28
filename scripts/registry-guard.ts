#!/usr/bin/env -S deno run --allow-read --allow-env
// registry-guard.ts (D-682) — the 23rd guard, and the only one whose subject is the other twenty-two.
//
// THE DEFECT IT WAS BUILT FOR. A census on 2026-08-28 found three different answers to "how many guards are there":
//
//   23 guard scripts on disk
//   21 invoked by the daily runner (infra/scripts/coverage-guard-up.sh)
//   17 shown by scripts/guard-status.sh — THE OPERATOR'S ONE-COMMAND VIEW
//
// So four guards (trial-ledger, benchmark, turnover, schema-honesty) could go RED daily and never appear in the view
// built specifically so a RED would reach a human. That is D-586 recurring inside the fix for D-586: guard-status.sh
// exists because four guards had been RED since a 14:40 cycle and nobody knew.
//
// And one guard, `infra-guard.ts`, was wired into NEITHER. It is the D-408 substrate probe — the guard whose entire
// job is to distinguish "the engine is down, so every conclusion is UNKNOWN" from "we measured a null". The guard
// that detects a dead substrate had itself been dead the whole time. Built is not wired, and wired is not run.
//
// WHY A META-GUARD RATHER THAN JUST FIXING THE LISTS. Fixing the lists fixes today. Every guard added since D-586 has
// drifted from at least one list, because adding a guard means remembering two hand-maintained enumerations in two
// files in two languages. This makes the omission mechanical: a new `scripts/*-guard.ts` that nothing invokes turns
// the board RED on the next cycle, which is the same standard every other guard is held to.
//
// DELIBERATE ASYMMETRY, RECORDED RATHER THAN SILENT. A guard may legitimately be excluded from a list — this one
// cannot invoke itself from guard-status without recursion, and a guard needing credentials the scheduled context
// lacks would wedge the runner. Exclusions live in EXEMPT below WITH THEIR REASON and are PRINTED every run. An
// exemption nobody can see is how a carve-out becomes permanent (the D-659 lesson, and the D-636 exemption bug that
// waved 34 rows through on an unrelated marker).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("registry-guard", [
  { name: "SELFTEST", def: "", note: "prove the guard fails before trusting its green" },
  { name: "RUNNER", def: "infra/scripts/coverage-guard-up.sh", note: "the scheduled daily invoker" },
  { name: "STATUS", def: "scripts/guard-status.sh", note: "the operator's one-command view" },
]);

const RUNNER = Deno.env.get("RUNNER") || "infra/scripts/coverage-guard-up.sh";
const STATUS = Deno.env.get("STATUS") || "scripts/guard-status.sh";

// name -> why it is absent from a list. Both fields are required; a bare name would be an unexplained carve-out.
const EXEMPT: Record<string, { from: string[]; why: string }> = {
  "registry": {
    from: [STATUS],
    why: "guard-status.sh enumerates guards and this guard checks that enumeration; listing itself there would have it assert its own presence, which is not a check. It runs from the daily runner, where its RED is real.",
  },
};

async function read(p: string): Promise<string> {
  try { return await Deno.readTextFile(p); }
  catch (e) { console.error(`!! cannot read ${p}: ${e instanceof Error ? e.message : e} — RED (a guard that cannot read its input is not green).`); Deno.exit(1); }
}

const onDisk: string[] = [];
for await (const e of Deno.readDir("scripts")) {
  if (e.isFile && e.name.endsWith("-guard.ts")) onDisk.push(e.name.replace(/-guard\.ts$/, ""));
}
onDisk.sort();
if (onDisk.length < 5) { console.error(`!! only ${onDisk.length} guard script(s) found under scripts/ — the search is broken, not the repo. RED.`); Deno.exit(1); }

const runnerSrc = await read(RUNNER);
const statusSrc = await read(STATUS);

// The runner names files (`benchmark-guard.ts`); guard-status names stems in a `for g in ...` list. Match each on the
// form that file actually uses rather than one regex hoping to cover both — a matcher that quietly fits neither is
// how a green stops meaning anything (D-641).
const inRunner = (g: string) => runnerSrc.includes(`${g}-guard.ts`);
const inStatus = (g: string) => new RegExp(`(^|[\\s\\\\])${g}([\\s\\\\]|$)`, "m").test(
  (statusSrc.match(/for g in ([\s\S]*?);\s*do/)?.[1]) ?? "",
);

let red = 0;
console.log(`==> REGISTRY GUARD — every guard on disk must be invoked by the runner and visible to the operator`);
console.log(`    ${onDisk.length} guard script(s) on disk`);

const rows: string[] = [];
for (const g of onDisk) {
  const ex = EXEMPT[g];
  const missRunner = !inRunner(g) && !(ex?.from.includes(RUNNER));
  const missStatus = !inStatus(g) && !(ex?.from.includes(STATUS));
  if (missRunner || missStatus) {
    red++;
    const where = [missRunner ? `runner (${RUNNER})` : null, missStatus ? `operator view (${STATUS})` : null].filter(Boolean).join(" and ");
    rows.push(`  RED  ${g.padEnd(20)} not invoked by ${where}`);
  } else {
    rows.push(`  ok   ${g.padEnd(20)} runner ${inRunner(g) ? "yes" : "EXEMPT"}   operator view ${inStatus(g) ? "yes" : "EXEMPT"}`);
  }
}
for (const r of rows) console.log(r);

// Exemptions are printed whether or not anything is red, because the reader must be able to audit the carve-outs
// without reading this file.
if (Object.keys(EXEMPT).length) {
  console.log(`\n    DECLARED EXEMPTIONS (${Object.keys(EXEMPT).length}) — reported every run, never silent:`);
  for (const [g, e] of Object.entries(EXEMPT)) console.log(`      ${g} absent from ${e.from.join(", ")}\n        ${e.why}`);
}

if (Deno.env.get("SELFTEST") === "1") {
  console.log(`\n  SELFTEST:`);
  const fakeRunner = `deno run -A scripts/coverage-guard.ts\ndeno run -A scripts/breadth-guard.ts`;
  const fakeStatus = `for g in coverage breadth \\\n         universe; do`;
  const listOf = (s: string) => (s.match(/for g in ([\s\S]*?);\s*do/)?.[1]) ?? "";
  const inR = (g: string, s: string) => s.includes(`${g}-guard.ts`);
  const inS = (g: string, s: string) => new RegExp(`(^|[\\s\\\\])${g}([\\s\\\\]|$)`, "m").test(listOf(s));
  const c1 = inR("coverage", fakeRunner) && inS("coverage", fakeStatus);       // fully wired
  const c2 = inR("breadth", fakeRunner) && !inS("breadth", fakeStatus) === false; // breadth IS in both
  const c3 = !inR("universe", fakeRunner) && inS("universe", fakeStatus);      // runner-only omission detected
  const c4 = !inR("turnover", fakeRunner) && !inS("turnover", fakeStatus);     // absent from both detected
  const c5 = listOf(fakeStatus).length > 0;                                    // the list parser found a list
  const c6 = !inS("cover", fakeStatus);                                        // a PREFIX must not count as present
  console.log(`    sees a fully-wired guard as present ............... ${c1 ? "YES" : "NO"}`);
  console.log(`    sees a guard present in both lists ................ ${c2 ? "YES" : "NO"}`);
  console.log(`    detects a guard missing from the runner ........... ${c3 ? "YES" : "NO"}  (the infra-guard shape)`);
  console.log(`    detects a guard missing from both ................. ${c4 ? "YES" : "NO"}  (the turnover shape)`);
  console.log(`    parses the guard-status list at all ............... ${c5 ? "YES" : "NO"}  (a failed parse would call every guard missing)`);
  console.log(`    does NOT count a prefix as a match ................ ${c6 ? "YES" : "NO"}  (\"cover\" must not match \"coverage\")`);
  if (!(c1 && c2 && c3 && c4 && c5 && c6)) { console.log(`    SELFTEST FAILED — guard does not discriminate. RED.`); Deno.exit(1); }
  console.log(`    SELFTEST PASSED.`);
}

console.log(`\n  ${red === 0
  ? `REGISTRY CONSISTENT — all ${onDisk.length} guards are invoked daily and visible to the operator.`
  : `${red} UNWIRED GUARD(S) — a guard that nothing runs is documentation, not enforcement.`}`);
if (red > 0) Deno.exit(1);
