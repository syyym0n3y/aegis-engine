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
  { name: "FROM_ACTS", def: "823", note: "D-823 RESEARCH FREEZE: from this entry, GOLD: research must also carry ACTS-ON: <position|ledger|gate|clock>" },
]);
const REPO = new URL("..", import.meta.url).pathname;
const MECH = /^\s*GOLD:\s*(structural|clock|prop|gap|reliability|research|law)\b.{0,3}\S+/m;
// Headings are `## D-NNN (date) …` from D-802 on. A bare `D-NNN` at line start is NOT a heading: the first live run split
// D-804 in two on a body line that began "D-804 on must carry", and flagged the half without the line (caught by running it).
const HEAD = /^#{1,4}\s*D-(\d{3,4})[a-z]?(?:\/\d{3,4})?\b/;
// D-823: research is free, so it never stops on its own. A research entry must name the position, ledger row, gate or
// clock verdict it acts on, or it is research for its own sake and the guard refuses it.
const RESEARCH = /^\s*GOLD:\s*research\b/m;
const ACTS = /^\s*ACTS-ON:\s*(position|ledger|gate|clock)\b.{0,3}\S+/m;

export function audit(text: string, fromD: number, fromActs = Number.MAX_SAFE_INTEGER): { checked: number; missing: string[] } {
  const lines = text.split("\n");
  const entries: { id: string; n: number; body: string[]; lvl: number }[] = [];
  for (const l of lines) {
    const m = HEAD.exec(l);
    // D-836: a DEEPER heading inside an entry is a subheading, not a new entry. Three times now an entry written with
    // `### D-NNN — part one` / `### D-NNN — part two` sections was split into pieces, and the piece without the GOLD:
    // line was reported missing — a false RED that costs exactly as much trust as a false green. An entry starts only
    // at a heading whose level is at or above (i.e. hash-count at or below) the current entry's.
    const lvl = m ? (l.match(/^#+/)?.[0].length ?? 2) : 0;
    const cur = entries[entries.length - 1];
    if (m && (!cur || lvl <= cur.lvl)) entries.push({ id: `D-${m[1]}`, n: Number(m[1]), body: [l], lvl });
    else if (entries.length) entries[entries.length - 1].body.push(l);
  }
  const missing: string[] = []; let checked = 0;
  for (const e of entries) {
    if (e.n < fromD) continue;
    checked++;
    const body = e.body.join("\n");
    if (!MECH.test(body)) missing.push(e.id);
    else if (e.n >= fromActs && RESEARCH.test(body) && !ACTS.test(body)) missing.push(`${e.id} (research without ACTS-ON)`);
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
  // D-836: a deeper heading must NOT split its parent entry (three false REDs before this was fixed).
  const nested = "## D-960 (2026-01-01) — parent\n### D-960 — part one\nbody\n### D-961 — part two\nbody\nGOLD: law — x\n";
  const nn = audit(nested, 900);
  if (nn.checked !== 1 || nn.missing.length) { console.error("SELFTEST FAIL: subheadings split the entry", nn); Deno.exit(1); }
  const twoTop = audit("## D-970 (2026-01-01) — a\nGOLD: law — x\n## D-971 (2026-01-01) — b\nbody\n", 900);
  if (twoTop.checked !== 2 || twoTop.missing.join() !== "D-971") { console.error("SELFTEST FAIL: same-level entries must still split", twoTop); Deno.exit(1); }
  const rNo = "## D-950 (2026-01-01) — r\nbody\nGOLD: research — a null\n", rYes = "## D-951 (2026-01-01) — r\nbody\nGOLD: research — a null\nACTS-ON: gate — feeds the micro_entry review\n";
  const d = audit(rNo + rYes, 900, 950);
  if (d.missing.join() !== "D-950 (research without ACTS-ON)") { console.error("SELFTEST FAIL: research freeze — expected D-950 flagged only, got", d); Deno.exit(1); }
  const e2 = audit(rNo, 900, 951);
  if (e2.missing.length) { console.error("SELFTEST FAIL: pre-freeze research entry flagged", e2); Deno.exit(1); }
  console.log("  DECISIONS GUARD SELFTEST PASS (RED on missing, GREEN on compliant, pre-threshold exempt; RED on post-freeze research without ACTS-ON, GREEN with it, pre-freeze exempt)");
  Deno.exit(0);
}

const path = K.DECISIONS.startsWith("/") ? K.DECISIONS : `${REPO}${K.DECISIONS}`;
const text = await Deno.readTextFile(path);
const r = audit(text, Number(K.FROM_D), Number(K.FROM_ACTS));
if (r.checked === 0) { console.error(`  DECISIONS GUARD RED — parser found 0 entries >= D-${K.FROM_D} (positive control failed)`); Deno.exit(1); }
if (r.missing.length) { console.error(`  DECISIONS GUARD RED — ${r.missing.length} of ${r.checked} entries >= D-${K.FROM_D} carry no GOLD: line: ${r.missing.join(", ")}`); Deno.exit(1); }
console.log(`  DECISIONS GUARD GREEN — ${r.checked} entries >= D-${K.FROM_D} each name the mechanism they feed; research entries >= D-${K.FROM_ACTS} name what they act on`);
