#!/usr/bin/env -S deno run --allow-read --allow-env
// permissions-guard.ts (D-803) — the machine guard for the defect that bit twice on 2026-09-06: a runner-wired script that
// needs a permission the runner line does not grant. D-801: market-cap-guard ran with `--allow-net --allow-env`, its
// loader hit PermissionDenied on readTextFile, swallowed it as "file absent", and the guard was RED in the loop while
// GREEN on the board (guard-status grants read). Verified "from cwd=infra" with -A, which hid it. This guard reads the
// runner, and for every `deno run <flags> ../scripts/X.ts` derives what X and its LOCAL import closure actually call —
// read (readTextFile/readFile/readDir/stat/open), write (writeTextFile/writeFile/mkdir/remove/rename), run (Command),
// net (fetch), env (Deno.env) — and goes RED on any need the line does not grant. `-A`/`--allow-all` lines are skipped.
// Pure `missing()` is self-tested; the closure detector is positive-controlled on the D-801 case (market-cap-guard's
// closure MUST need read). RUNNER may point at another file so the guard can be made to fail on the literal old line.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("permissions-guard", [
  { name: "RUNNER", def: "infra/scripts/coverage-guard-up.sh", note: "the scheduled daily invoker (repo-relative or absolute)" },
  { name: "SELFTEST", def: "0", note: "1 = self-test the comparison + the closure detector and exit" },
]);
const REPO = new URL("..", import.meta.url).pathname;
const abs = (p: string) => p.startsWith("/") ? p : `${REPO}${p}`;
const NEED: Record<string, RegExp> = {
  read: /Deno\.(readTextFile|readFile|readDir|stat|lstat|open|readLink|realPath)\s*\(/,
  write: /Deno\.(writeTextFile|writeFile|mkdir|remove|rename|create|truncate)\s*\(/,
  run: /Deno\.(Command|run)\s*\(/,
  net: /\bfetch\s*\(/,
  env: /Deno\.env\b/,
};
function flagsOf(line: string): Set<string> {
  const s = new Set<string>();
  if (/\s(-A|--allow-all)\s/.test(line)) s.add("all");
  for (const m of line.matchAll(/--allow-(read|write|run|net|env|sys|ffi)\b/g)) s.add(m[1]);
  return s;
}
// pure: which needs are not granted (an 'all' grant covers everything)
function missing(flags: Set<string>, needs: Set<string>): string[] { return flags.has("all") ? [] : [...needs].filter((n) => !flags.has(n)).sort(); }
// ---- function-level attribution (D-803 v2). A static import of a shared module must not count every call the module
// contains: run-preconditions.ts has Deno.stat inside assertFresh(), and a script that imports only declareKnobs +
// mkStrictRead never executes it. So: the ENTRY script counts everything in its own code; an imported module counts
// (a) its top-level code, (b) the segments named in the importer's `import { … }` list, and (c) transitively any
// same-module segment those call by name. `import * as ns` counts the whole module. First cut flagged 22 lines, ~18 of
// them this over-approximation.
interface Seg { name: string | null; code: string }
function segments(src: string): Seg[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const lines = code.split("\n"); const segs: Seg[] = []; let cur: Seg = { name: null, code: "" };
  const decl = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=|let\s+(\w+)\s*=|class\s+(\w+))/;
  for (const ln of lines) {
    const m = ln.match(decl);
    if (m) { segs.push(cur); cur = { name: m[1] ?? m[2] ?? m[3] ?? m[4] ?? null, code: "" }; }
    else if (/^(export\s+)?(interface|type)\s/.test(ln) || /^import\s/.test(ln)) { segs.push(cur); cur = { name: null, code: "" }; }
    cur.code += ln + "\n";
  }
  segs.push(cur); return segs;
}
function importsOf(src: string): Array<{ spec: string; names: string[] | "*" }> {
  const out: Array<{ spec: string; names: string[] | "*" }> = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?(\*\s+as\s+\w+|\{([^}]*)\})?\s*(?:from\s+)?"(\.\.?\/[^"]+)"/g)) {
    const spec = m[3]; if (!spec) continue;
    if (m[1]?.startsWith("*")) out.push({ spec, names: "*" });
    else out.push({ spec, names: (m[2] ?? "").split(",").map((s) => s.replace(/\btype\b/, "").trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) });
  }
  return out;
}
async function needsOf(entryRel: string): Promise<{ needs: Set<string>; via: Record<string, string> }> {
  const needs = new Set<string>(), via: Record<string, string> = {};
  const add = (code: string, rel: string) => { for (const [k, re] of Object.entries(NEED)) if (!needs.has(k) && re.test(code)) { needs.add(k); via[k] = rel; } };
  const visited = new Set<string>();
  async function visit(rel: string, wanted: string[] | "*" | "ENTRY") {
    const key = `${rel}|${wanted === "*" || wanted === "ENTRY" ? wanted : [...wanted].sort().join(",")}`; if (visited.has(key)) return; visited.add(key);
    let src = ""; try { src = await Deno.readTextFile(`${REPO}${rel}`); } catch { return; }
    const segs = segments(src);
    let active: Seg[];
    if (wanted === "ENTRY" || wanted === "*") active = segs;
    else {
      const byName = new Map(segs.filter((s) => s.name).map((s) => [s.name!, s]));
      const want = new Set<string>(wanted); const stack = [...wanted];
      while (stack.length) { const n = stack.pop()!; const s = byName.get(n); if (!s) continue; for (const o of byName.keys()) if (!want.has(o) && new RegExp(`\\b${o}\\s*\\(`).test(s.code)) { want.add(o); stack.push(o); } }
      active = segs.filter((s) => s.name === null || want.has(s.name));
    }
    for (const s of active) add(s.code, rel);
    // recurse into this file's own imports, but only the names the ACTIVE code references
    for (const imp of importsOf(src)) {
      const a = new URL(imp.spec, `file://${REPO}${rel}`).pathname; const childRel = a.startsWith(REPO) ? a.slice(REPO.length) : a;
      if (imp.names === "*") { await visit(childRel, "*"); continue; }
      const activeCode = active.map((s) => s.code).join("\n");
      const used = imp.names.filter((n) => new RegExp(`\\b${n}\\b`).test(activeCode));
      if (used.length) await visit(childRel, used);
    }
  }
  await visit(entryRel, "ENTRY");
  return { needs, via };
}
if (K.SELFTEST === "1") {
  let ok = true;
  const c1 = missing(new Set(["net", "env"]), new Set(["net", "env", "read"])); if (c1.join() !== "read") { ok = false; console.error(`  FAIL missing(): got ${c1}`); }
  const c2 = missing(new Set(["all"]), new Set(["read", "run"])); if (c2.length) { ok = false; console.error(`  FAIL -A must cover everything`); }
  const c3 = missing(new Set(["net", "env", "read"]), new Set(["net", "env", "read"])); if (c3.length) { ok = false; console.error(`  FAIL exact grant flagged`); }
  const f = flagsOf("  if ! deno run --allow-net --allow-env ../scripts/market-cap-guard.ts; then"); if (f.has("read") || !f.has("net")) { ok = false; console.error(`  FAIL flagsOf parse`); }
  // POSITIVE CONTROL — the D-801 case: market-cap-guard's closure must need `read` (via _shared/fpi-adr.ts) and `net`.
  const n = await needsOf("scripts/market-cap-guard.ts");
  if (!n.needs.has("read") || !n.needs.has("net")) { ok = false; console.error(`  FAIL detector: market-cap-guard needs = ${[...n.needs]}`); }
  else console.log(`  positive control: market-cap-guard needs ${[...n.needs].sort().join(",")} (read via ${n.via.read})`);
  // attribution control: ingest-cboe imports only declareKnobs/mkStrictRead-class names — it must need env,net and NOT read.
  const n2 = await needsOf("scripts/ingest-cboe.ts");
  if (n2.needs.has("read")) { ok = false; console.error(`  FAIL attribution: ingest-cboe flagged read via ${n2.via.read} (assertFresh is not imported by it)`); }
  else console.log(`  attribution control: ingest-cboe needs ${[...n2.needs].sort().join(",")} — no false read`);
  console.log(ok ? "  SELFTEST OK — comparison, flag parsing, and the closure detector all behave" : "  SELFTEST FAILED"); Deno.exit(ok ? 0 : 2);
}
const runnerPath = abs(K.RUNNER);
let runner = ""; try { runner = await Deno.readTextFile(runnerPath); } catch (e) { console.error(`!! cannot read runner ${runnerPath}: ${e instanceof Error ? e.message : e} — RED`); Deno.exit(1); }
console.log(`==> PERMISSIONS GUARD — does every runner line grant what its script actually needs? (${K.RUNNER})`);
let checked = 0; const bad: string[] = [], waived: string[] = [];
for (const [i, raw] of runner.split("\n").entries()) {
  const m = raw.match(/deno run\s+([^\n]*?)\s+\.\.\/scripts\/([a-z0-9-]+\.ts)/); if (!m) continue;
  const flags = flagsOf(` ${m[1]} `), script = `scripts/${m[2]}`;
  const { needs, via } = await needsOf(script); checked++;
  const miss = missing(flags, needs);
  // WAIVER — `# perms-ok: <reason>` on the runner line. For needs the detector sees but the normal path never exercises
  // (a pattern literal inside a rule, a self-test-only write). Reported EVERY run, never silent, exactly like the
  // registry guard's declared exemptions; a waiver without a reason is not a waiver.
  const wv = raw.match(/#\s*perms-ok:\s*(.+)$/);
  if (miss.length && wv) { waived.push(`line ${i + 1}  ${script}: would need ${miss.map((x) => `--allow-${x}`).join(", ")} — waived: ${wv[1].trim()}`); continue; }
  if (miss.length && !wv) bad.push(`line ${i + 1}  ${script}: needs ${miss.map((x) => `--allow-${x} (${via[x]})`).join(", ")} — granted [${[...flags].sort().join(",") || "none"}]`);
}
if (checked < 20) { console.error(`!! only ${checked} deno-run lines parsed from the runner — the parser is broken, not the runner. RED.`); Deno.exit(1); }
console.log(`    ${checked} runner invocation(s) checked against their scripts' import closures`);
if (waived.length) { console.log(`\n    DECLARED WAIVERS (${waived.length}) — reported every run, never silent:`); for (const w of waived) console.log(`      ${w}`); }
if (bad.length) { console.log(`\n  ${bad.length} UNDER-GRANTED INVOCATION(S) — RED:`); for (const b of bad) console.log(`    !! ${b}`); console.log(`\n  An under-granted script fails inside the loop and can pass on the board (D-801). Grant the flag on the runner line.`); Deno.exit(1); }
console.log(`\n  EVERY RUNNER LINE GRANTS WHAT ITS SCRIPT NEEDS.`);
