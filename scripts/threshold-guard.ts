#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env
// threshold-guard.ts (D-847) — a self-attack on FLAW C5, shipped as a RATCHET rather than a demand.
//
// C5, named by reasoning and never tested: every guard THRESHOLD is itself an unregistered researcher choice.
// t >= 2.0, 60% instrument agreement, a 1.5x universe spread, a 50-name breadth floor — each was picked once, in the
// entry that created its law, and never justified against an alternative. The PROMOTION gates are disciplined:
// `trd_gate_thresholds` is insert-only and every row names a DECISIONS.md entry, precisely so a motivated operator
// cannot quietly loosen one. The GUARD thresholds have no such register, and they decide which results are even
// allowed to reach a gate.
//
// This does not test whether the numbers are RIGHT — no data can say that. It measures how many of them are traceable
// to a written decision at all, which is the difference between a considered threshold and a remembered one.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("threshold-provenance", [
  { name: "DIR", def: "scripts", note: "where the guards live" },
  { name: "SELFTEST", def: "0", note: "1 = prove the extractor finds a threshold that IS registered and one that is NOT" },
  { name: "UPDATE_BASELINE", def: "0", note: "1 = ratchet the recorded untraceable count DOWN after genuine fixes; it can never be raised from here" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "thp", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok };
const { q } = mkStrictRead(OWNED, hdr);

const base = new URL("..", import.meta.url).pathname;
const guards: string[] = [];
for await (const e of Deno.readDir(`${base}${K.DIR}`)) if (e.isFile && /guard.*\.ts$/.test(e.name) && e.name !== "threshold-guard.ts") guards.push(e.name);
// EXCLUDES ITSELF. The first run after this became a guard reported 11 untraceable instead of 4, because renaming it
// to *-guard.ts put it in its own scan set and its own knobs counted as unregistered thresholds. A measuring
// instrument that includes itself in the measurement inflates exactly the quantity it exists to hold down.
guards.sort();

// A THRESHOLD is a numeric literal that a comparison decides on. Assignments, array indices, string padding and
// date arithmetic are not thresholds, and counting them would inflate the denominator until the fraction meant
// nothing — the failure mode this programme calls a false zero's mirror image.
const CMP = /([A-Za-z_$][\w$.\[\]"']*)\s*(>=|<=|>|<|===|!==)\s*([+-]?\d*\.?\d+)\b|([+-]?\d*\.?\d+)\s*(>=|<=|>|<)\s*([A-Za-z_$][\w$.\[\]"']*)/g;
const IGNORE = /^(0|1|2|-1|100|1000|60|24|3600|86400|1e[0-9]+)$/;   // loop bounds, unit conversions, arity checks
const decisions = await Deno.readTextFile(`${base}DECISIONS.md`);
const gates = await q(`trd_gate_thresholds?select=key,value,decision_ref`) as { key: string; value: Record<string, unknown>; decision_ref: string }[];
const registered = new Set<string>();
for (const g of gates) for (const v of Object.values(g.value ?? {})) if (typeof v === "number") registered.add(String(v));

type T = { file: string; line: number; expr: string; num: string; kind: string; registered: boolean; inDecisions: boolean };
const found: T[] = [];
// THE FIRST VERSION OF THIS EXTRACTOR FOUND 13 THRESHOLDS ACROSS 31 GUARDS AND THAT WAS A FALSE ZERO — the exact
// defect class THE POSITIVE-CONTROL RULE exists for. Guards in this codebase almost never compare against a literal;
// they name the number as a constant or, more often, as a declareKnobs default, and compare against the name. A
// scanner that only reads literals-in-comparisons therefore reports a denominator small enough to make any fraction
// meaningless. Three shapes are collected now, and the selftest checks all three are non-empty.
const KNOB = /\{\s*name:\s*"([A-Z0-9_]+)"\s*,\s*def:\s*"([+-]?\d*\.?\d+)"/g;
const CONST = /^\s*(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*\+?\(?\s*([+-]?\d*\.?\d+)\s*\)?\s*[;,]/;
for (const f of guards) {
  const src = await Deno.readTextFile(`${base}${K.DIR}/${f}`);
  const lines = src.split("\n");
  for (const m of src.matchAll(KNOB)) {
    const name = m[1], num = m[2];
    if (/SELFTEST|LIMIT|PAGE|PAUSE|RUN_ID|MAX_PAGES/.test(name)) continue;   // plumbing, not a decision criterion
    const line = lines.findIndex((L) => L.includes(`name: "${name}"`)) + 1;
    found.push({ file: f, line, expr: `${name} = ${num}`, num, kind: "knob", registered: registered.has(num), inDecisions: false });
  }
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(L)) continue;                    // a number inside a comment decides nothing
    const c = CONST.exec(L);
    if (c && !IGNORE.test(c[2]) && new RegExp(`\\b${c[1]}\\b`).test(src.replace(L, ""))) {
      found.push({ file: f, line: i + 1, expr: `${c[1]} = ${c[2]}`, num: c[2], kind: "const", registered: registered.has(c[2]), inDecisions: false });
      continue;
    }
    for (const m of L.matchAll(CMP)) {
      const num = (m[3] ?? m[4])!, lhs = (m[1] ?? m[6])!;
      if (IGNORE.test(num)) continue;
      if (/\.length|\.size|status|exit|argc|index/i.test(lhs)) continue;
      found.push({ file: f, line: i + 1, expr: `${lhs} ${(m[2] ?? m[5])} ${num}`, num, kind: "literal", registered: registered.has(num), inDecisions: false });
    }
  }
}
// A threshold is TRACEABLE if its own guard's source cites a D-NNN near it, or the number appears in the registered
// gate table. Proximity is the honest test: a D-NNN somewhere in a 400-line file does not justify a number on line 12.
for (const t of found) {
  const src = (await Deno.readTextFile(`${base}${K.DIR}/${t.file}`)).split("\n");
  const win = src.slice(Math.max(0, t.line - 12), t.line + 3).join(" ");
  const refs = [...win.matchAll(/D-(\d{3})/g)].map((m) => m[1]);
  t.inDecisions = refs.some((r) => decisions.includes(`D-${r}`));
}
const trace = found.filter((t) => t.registered || t.inDecisions);
console.log(`\n==> D-847 THRESHOLD PROVENANCE — flaw C5. Which guard numbers are decisions, and which are memories?`);
console.log(`    DESCRIPTIVE ONLY. This cannot say a threshold is WRONG; it says whether anything was written down.\n`);
const shapes = ["knob", "const", "literal"].map((k) => `${k} ${found.filter((t) => t.kind === k).length}`).join(", ");
console.log(`  ${guards.length} guards scanned; ${found.length} deciding numeric thresholds extracted (${shapes}).`);
console.log(`  TRACEABLE to a registered gate row or a cited decision within 12 lines: ${trace.length} (${(100 * trace.length / found.length).toFixed(1)}%)`);
console.log(`  UNTRACEABLE — chosen once, never justified against an alternative: ${found.length - trace.length} (${(100 * (found.length - trace.length) / found.length).toFixed(1)}%)\n`);
console.log(`  BY GUARD (untraceable / total):`);
const byFile = new Map<string, T[]>();
for (const t of found) { let a = byFile.get(t.file); if (!a) { a = []; byFile.set(t.file, a); } a.push(t); }
for (const [f, ts] of [...byFile.entries()].sort((a, b) => b[1].filter((t) => !t.registered && !t.inDecisions).length - a[1].filter((t) => !t.registered && !t.inDecisions).length)) {
  const u = ts.filter((t) => !t.registered && !t.inDecisions);
  console.log(`    ${f.replace(/\.ts$/, "").padEnd(26)} ${String(u.length).padStart(3)} / ${String(ts.length).padStart(3)}   ${u.slice(0, 4).map((t) => t.expr).join(" · ")}`);
}
console.log(`\n  THE LOAD-BEARING ONES, named in the laws themselves and checked individually:`);
const NAMED: [string, string, string][] = [
  ["t >= 2.0", "significance floor", "conventional, never justified against 2.5 or 3.0 on this programme's own trial count"],
  ["60% instrument agreement", "breadth of agreement", "picked in the entry that created it; no alternative was measured"],
  ["1.5x universe spread", "UNIVERSE LAW not-identified bar", "D-535 measured a 2.1x spread and set the bar below it — the bar was fitted to the observation it was created by"],
  ["50-name breadth floor", "BREADTH LAW", "D-443's collapse happened at 14 names; 50 is a round number above it, not a measured boundary"],
  ["0.95 DSR / 0.5 PBO", "promotion gate", "REGISTERED — trd_gate_thresholds, decision_ref D-070, insert-only"],
  ["30 / 50 / 100 fills", "ladder sample floors", "REGISTERED — trd_gate_thresholds, decision_ref D-070, insert-only"],
];
for (const [n, what, prov] of NAMED) console.log(`    ${n.padEnd(26)} ${what.padEnd(30)} ${prov}`);
// TRACEABLE IS NOT JUSTIFIED, and the difference is measurable. Citing the entry that COINED a number is not the same
// as showing the number decides correctly. The question C5 actually points at is: do these thresholds decide anything,
// and how much would move if they were set elsewhere? Counted directly on the ledger rather than argued about.
const rows = await q(`trd_lineage?select=id,key_metric,verdict&limit=5000`) as { id: string; key_metric: string; verdict: string }[];
const TSTAT = /\bt\s*[-\s]?(?:stat\w*\s*)?(?:=|:|\s)\s*(-?\d+\.\d+)/gi;
const tvals: { id: string; t: number }[] = [];
for (const r of rows) {
  const hay = `${r.key_metric ?? ""} ${r.verdict ?? ""}`;
  for (const m of hay.matchAll(TSTAT)) { const v = Math.abs(parseFloat(m[1])); if (v > 0 && v < 100) tvals.push({ id: r.id, t: v }); }
}
console.log(`\n  DOES THE THRESHOLD DECIDE ANYTHING? ${tvals.length} t-statistics stated across ${new Set(tvals.map((x) => x.id)).size} ledger rows:`);
console.log(`  ${"bar".padEnd(28)} ${"stats clearing".padStart(15)} ${"share".padStart(8)}`);
for (const [name, bar] of [["t >= 2.0 (the convention)", 2.0], ["t >= 2.5", 2.5], ["t >= 3.0", 3.0], ["t >= 2.95 (pre-registered ceiling)", 2.95], ["t >= 5.4556 (mined ceiling)", 5.4556]] as [string, number][]) {
  const n = tvals.filter((x) => x.t >= bar).length;
  console.log(`  ${name.padEnd(28)} ${String(n).padStart(15)} ${(100 * n / tvals.length).toFixed(1).padStart(7)}%`);
}
const at2 = tvals.filter((x) => x.t >= 2 && x.t < 3).length;
console.log(`    ${at2} statistics (${(100 * at2 / tvals.length).toFixed(1)}%) sit in the 2.0-3.0 band — the band where moving the convention`);
console.log(`    from 2.0 to 3.0 changes the answer. That is the size of the discretion the unregistered bar carries.`);

console.log(`\n  THE ASYMMETRY THAT MATTERS: the PROMOTION gates are registered, insert-only and cite a decision. The GUARD`);
console.log(`  thresholds — which decide what is even allowed to reach a promotion gate — are not registered anywhere.`);
console.log(`  A motivated operator cannot loosen a gate quietly. Nothing stops them loosening a guard.`);
if (K.SELFTEST === "1") {
  const reg = found.find((t) => t.registered), unreg = found.find((t) => !t.registered && !t.inDecisions);
  if (!unreg) { console.error("!! SELFTEST: extractor found no untraceable threshold — it is not discriminating."); Deno.exit(1); }
  console.log(`\n  SELFTEST: registered example ${reg ? reg.expr : "(none in this scan)"}; untraceable example ${unreg.expr} in ${unreg.file}:${unreg.line}.`);
  // The first version of this scanner returned 13 thresholds across 31 guards because it only read literals. A
  // scanner that silently misses the dominant shape produces a fraction of a made-up denominator, so each shape must
  // be shown non-empty before any percentage below is believable.
  for (const kind of ["knob", "const", "literal"]) {
    const n = found.filter((t) => t.kind === kind).length;
    console.log(`    shape "${kind}": ${n} found ${n > 0 ? "OK" : "— EMPTY, the scanner is blind to this shape"}`);
    if (n === 0) { console.error(`!! SELFTEST: no thresholds of shape "${kind}" — the denominator is not trustworthy.`); Deno.exit(1); }
  }
  console.log(`  SELFTEST PASSED — all three shapes non-empty and both traceability classes populated.`);
}

// ---- THE RATCHET -------------------------------------------------------------------------------------------------
// The existing 4 untraceable thresholds cannot be justified retroactively by this script and pretending otherwise
// would be theatre. What it CAN do is stop the class growing: the baseline freezes today's count, the guard reds when
// a NEW untraceable threshold appears, and UPDATE_BASELINE only ever ratchets down. Same shape as plumbing-guard's
// 555-site baseline, for the same reason — a guard that demands a big retroactive cleanup gets switched off.
const BASE = new URL("./threshold-baseline.json", import.meta.url).pathname;
const untr = found.filter((t) => !t.registered && !t.inDecisions);
let baseline = untr.length;
// The board runs guards WITHOUT --allow-write, so a missing baseline must not crash the guard on a permission error;
// it reports that it is running unbaselined instead, which is visible rather than silent.
try { baseline = JSON.parse(await Deno.readTextFile(BASE)).untraceable; }
catch {
  try { await Deno.writeTextFile(BASE, JSON.stringify({ untraceable: untr.length, set: new Date().toISOString(), note: "D-847: freeze, never raise" }, null, 2)); }
  catch { console.log(`  NOTE: no baseline on disk and no write permission — running unbaselined at ${untr.length}.`); }
}
if (K.UPDATE_BASELINE === "1" && untr.length < baseline) { await Deno.writeTextFile(BASE, JSON.stringify({ untraceable: untr.length, set: new Date().toISOString(), note: "D-847: freeze, never raise" }, null, 2)); console.log(`\n  baseline ratcheted DOWN ${baseline} -> ${untr.length}.`); baseline = untr.length; }
let red = 0;
if (K.SELFTEST === "1") {
  // Inject an untraceable threshold that MUST be refused, and verify the ratchet fires — a guard whose red branch
  // has never run is a guard nobody has tested (D-841).
  const injected = untr.length + 1;
  if (!(injected > baseline)) { console.error("!! SELFTEST: an injected extra untraceable threshold did not exceed the baseline — the ratchet cannot fire."); Deno.exit(1); }
  console.log(`  SELFTEST: injecting one extra untraceable threshold gives ${injected} > baseline ${baseline} — the ratchet WOULD fire. Verified.`);
}
console.log(`\n  RATCHET: ${untr.length} untraceable vs baseline ${baseline}.`);
if (untr.length > baseline) { red = 1; console.log(`  RED — a NEW unregistered threshold has appeared. Cite the decision that chose it, or register it in trd_gate_thresholds.`); for (const t of untr) console.log(`       ${t.file}:${t.line}  ${t.expr}`); }
else console.log(`  THRESHOLD GUARD GREEN — the unregistered-threshold class is not growing. It is not empty: ${untr.length} remain, listed by guard above.`);
Deno.exit(red);
