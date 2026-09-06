// decisions-guard.ts (D-804) — every DECISIONS entry from D-804 on must say which daily mechanism it feeds.
//
// The operator's instruction (2026-09-06): "make sure that any more decisions help us account for everything we need to
// extract bits of wealth every day". 580 entries were read; 198 carry open-item language and most of it was never
// revisited (five UNTESTED tests on held data had zero later mentions). A decision that does not say what it feeds is
// how research drifts back into research-for-its-own-sake. So: from D-804, each entry carries a line
//     GOLD: <structural|clock|prop|gap|reliability|research|law> — <what it changes>
// and this guard goes RED on any entry at or above the threshold without one. Documented ≠ enforced (global contract §5).
// Positive control: the parser must find at least one entry >= threshold, or it is the parser that is broken (D-641).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("decisions-guard", [
  { name: "DECISIONS", def: "DECISIONS.md", note: "the decision log (repo-relative or absolute)" },
  { name: "FROM_D", def: "804", note: "first entry number bound by the GOLD: rule" },
  { name: "SELFTEST", def: "0", note: "1 = self-test RED/GREEN/exempt and exit" },
]);
const REPO = new URL("..", import.meta.url).pathname;
const MECH = /^\s*GOLD:\s*(structural|clock|prop|gap|reliability|research|law)\b.{0,3}\S+/m;
// Headings are `## D-NNN (date) …` from D-802 on. A bare `D-NNN` at line start is NOT a heading: the first live run split
// D-804 in two on a body line that began "D-804 on must carry", and flagged the half without the line (caught by running it).
const HEAD = /^#{1,4}\s*D-(\d{3,4})[a-z]?(?:\/\d{3,4})?\b/;

export function audit(text: string, fromD: number): { checked: number; missing: string[] } {
  const lines = text.split("\n");
  const entries: { id: string; n: number; body: string[] }[] = [];
  for (const l of lines) {
    const m = HEAD.exec(l);
    if (m) entries.push({ id: `D-${m[1]}`, n: Number(m[1]), body: [l] });
    else if (entries.length) entries[entries.length - 1].body.push(l);
  }
  const missing: string[] = []; let checked = 0;
  for (const e of entries) {
    if (e.n < fromD) continue;
    checked++;
    if (!MECH.test(e.body.join("\n"))) missing.push(e.id);
  }
  return { checked, missing: [...new Set(missing)] };
}

if (K.SELFTEST === "1") {
  const good = "## D-900 (2026-01-01) — x\nbody\nD-900 mentioned mid-entry must not split it\nGOLD: clock — feeds clock #18\n";
  const bad = "## D-901 (2026-01-01) — y\nbody without the line\n";
  const a = audit(good + bad, 900);
  if (a.checked !== 2 || a.missing.join() !== "D-901") { console.error("SELFTEST FAIL: expected D-901 missing, got", a); Deno.exit(1); }
  const b = audit(good, 900);
  if (b.missing.length) { console.error("SELFTEST FAIL: compliant entry flagged", b); Deno.exit(1); }
  const c = audit("## D-1 old entry\nno line\n", 900);
  if (c.checked !== 0) { console.error("SELFTEST FAIL: pre-threshold entry checked", c); Deno.exit(1); }
  console.log("  DECISIONS GUARD SELFTEST PASS (RED on missing, GREEN on compliant, pre-threshold exempt)");
  Deno.exit(0);
}

const path = K.DECISIONS.startsWith("/") ? K.DECISIONS : `${REPO}${K.DECISIONS}`;
const text = await Deno.readTextFile(path);
const r = audit(text, Number(K.FROM_D));
if (r.checked === 0) { console.error(`  DECISIONS GUARD RED — parser found 0 entries >= D-${K.FROM_D} (positive control failed)`); Deno.exit(1); }
if (r.missing.length) { console.error(`  DECISIONS GUARD RED — ${r.missing.length} of ${r.checked} entries >= D-${K.FROM_D} carry no GOLD: line: ${r.missing.join(", ")}`); Deno.exit(1); }
console.log(`  DECISIONS GUARD GREEN — ${r.checked} entries >= D-${K.FROM_D} each name the mechanism they feed`);
