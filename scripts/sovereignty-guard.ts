#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net --allow-run
// sovereignty-guard.ts (D-751) — the 26th guard, and the only one whose subject is WHO OWNS THE ENGINE.
//
// THE DEFECT IT WAS BUILT FOR. Aegis was designed to run on rented infrastructure (Supabase project
// `glzzoomuhnugsiichnub`) and then migrated to an owned node — but the migration was never ENFORCED, only performed.
// Three live references survived it in plain sight: the compute worker DEFAULTED to the CC edge function as its job
// broker, the substrate guard probed the rented host on every cycle, and the operator's entire oversight surface was
// an edge function on that project. The CC project is now INACTIVE behind unpaid invoices, so the observable state
// was: research keeps running on the owned node, and the ability to SEE it is gone. An unpaid invoice should not be
// able to blind the engine.
//
// Worse, the worker's failure was SILENT: every broker call is `.catch(() => null)`, so an unreachable broker is
// indistinguishable from an empty job queue. A dependency that fails quietly is not discovered when it breaks; it is
// discovered when someone happens to look.
//
// WHAT IT CHECKS
//   1. SOVEREIGNTY — no LIVE (non-comment) reference to a `*.supabase.co` host anywhere in the daily path: the
//      runner script, every script the runner invokes, and the local import closure of every launchd-registered
//      daemon. A reference inside a comment is fine; a reference in executable code is not.
//   2. CONTINUITY — the runner's last loop is younger than 36h, and the owned PostgREST answers. Sovereignty without
//      continuity is a system that depends on nobody and also does nothing, and the point is a working engine.
//
// THE ALLOWLIST IS PRINTED, NEVER SILENT. Four files legitimately name the rented host: the one-off migration and
// provisioning tools, and the superseded edge cockpit kept for the day the CC project is restored. They are listed
// below WITH REASONS and printed on every run — the D-636 lesson, where an exemption keyed on an unrelated marker
// waved 34 rows through and made the green arithmetically meaningless.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("sovereignty-guard", [
  { name: "GUARD_SELFTEST", def: "", note: "1 = inject a fake live reference and prove the guard goes RED" },
  { name: "SOV_RUNNER", def: "infra/scripts/coverage-guard-up.sh", note: "the daily runner whose closure must be sovereign" },
  { name: "SOV_MAX_LOOP_H", def: "36", note: "hours since the runner's last loop before continuity is RED" },
  { name: "SOV_LOG", def: "infra/data/coverage.log", note: "the runner's log; its mtime is the last-loop clock" },
]);

const REPO = new URL("..", import.meta.url).pathname;
const P = (rel: string) => `${REPO}${rel.replace(/^\.?\//, "")}`;
const OWNED = Deno.env.get("OWNED_REST") || Deno.env.get("AEGIS_OWNED_REST") || `http://localhost:${Deno.env.get("REST_PORT") || "33000"}`;
const MAX_H = Number(K.SOV_MAX_LOOP_H);

// path (repo-relative prefix) -> why a live reference is permitted there
const ALLOW: Record<string, string> = {
  "scripts/sync-to-owned.ts": "the MIGRATION tool itself — it reads the rented project to copy rows onto the owned node, so naming the rented host IS its function. Not invoked by any runner or daemon.",
  "scripts/provision-aegis.sh": "one-off provisioning of the rented project. Historical; not in any launchd job.",
  "infra/scripts/migrate-db.sh": "one-off schema migration against the rented project. Historical; not in any launchd job.",
  "supabase/functions/aegis-cockpit/": "the SUPERSEDED edge cockpit, replaced by scripts/cockpit-render.ts. Kept, not deleted, for the day the CC project is restored — a deployed function that names its own host is not a dependency of the daily path.",
};
const allowed = (rel: string) => Object.keys(ALLOW).find((a) => rel === a || rel.startsWith(a));

const HOST = /[A-Za-z0-9-]+\.supabase\.co/;

// A reference inside a comment is documentation; a reference in executable code is a dependency. This strips `//`
// line comments and `/* */` blocks before matching, and ignores whole-line `#` comments in shell.
// It deliberately does NOT try to parse strings-containing-slashes perfectly: a false RED costs one waiver comment,
// a false GREEN costs the entire point of the guard.
export function liveHits(src: string, shell = false): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlock = false;
  src.split("\n").forEach((raw, i) => {
    // A URL's own "//" is not a comment. Neutralise every scheme separator before comment-stripping, or
    // `const B = "https://x.supabase.co"` reads as code-then-comment and the guard passes the exact defect it
    // exists to catch — which is precisely what its first self-test run reported.
    let line = raw.replace(/:\/\//g, ":\u0000\u0000");
    if (!shell) {
      if (inBlock) { const e = line.indexOf("*/"); if (e < 0) return; line = line.slice(e + 2); inBlock = false; }
      for (;;) {
        const b = line.indexOf("/*");
        if (b < 0) break;
        const e = line.indexOf("*/", b + 2);
        if (e < 0) { line = line.slice(0, b); inBlock = true; break; }
        line = line.slice(0, b) + line.slice(e + 2);
      }
      const c = line.indexOf("//");
      if (c >= 0) line = line.slice(0, c);
    } else {
      const c = line.indexOf("#");
      if (c >= 0) line = line.slice(0, c);
    }
    if (HOST.test(line.replace(/\u0000\u0000/g, "//"))) out.push({ line: i + 1, text: raw.trim().slice(0, 150) });
  });
  return out;
}

if (K.GUARD_SELFTEST === "1") {
  // A guard whose RED has never been produced is a green nobody has earned (D-584). Inject the exact shapes.
  // The fixtures are ASSEMBLED, never written literally: this guard is invoked by the runner, so it scans ITSELF,
  // and a literal `x.supabase.co` in this file would be a live reference by its own definition. Caught by running
  // the guard against an injected runner — a self-flagging guard is the kind of green nobody can act on.
  const H = "supabase" + ".co";
  const cases: [string, boolean, string][] = [
    [`const B = "https://glzzoomuhnugsiichnub.${H}/functions/v1/trd-compute";`, true, "a live default — the worker's original shape"],
    [`// the CC project glzzoomuhnugsiichnub.${H} is inactive`, false, "a mention inside a line comment"],
    [`/* legacy: https://x.${H}/rest/v1 */`, false, "a mention inside a block comment"],
    [`const OWNED = "http://localhost:33000";`, false, "an owned-node reference"],
    [`await fetch("https://abc.${H}/rest/v1/t"); // note`, true, "a live call with a trailing comment"],
    [`  x = 1; /* a */ const u = "https://y.${H}";`, true, "live code after a closed block comment"],
  ];
  let ok = true;
  for (const [src, want, why] of cases) {
    const got = liveHits(src).length > 0;
    console.log(`    ${got === want ? "ok " : "FAIL"}  ${want ? "RED " : "pass"}  ${why}`);
    if (got !== want) ok = false;
  }
  // Shell mode: `#` comments are documentation, the same rule.
  const shOk = liveHits(`# see https://a.${H}`, true).length === 0 && liveHits(`curl https://a.${H}/x`, true).length === 1;
  console.log(`    ${shOk ? "ok " : "FAIL"}  shell '#' comments waived, shell code flagged`);
  // And the whole-file path: inject a fake live reference into a temp file inside the scanned tree and prove RED.
  const tmp = P("scripts/.sovereignty-selftest-tmp.ts");
  await Deno.writeTextFile(tmp, `const BROKER = "https://glzzoomuhnugsiichnub.${H}/functions/v1/trd-compute";\nconsole.log(BROKER);\n`);
  const injected = liveHits(await Deno.readTextFile(tmp)).length > 0 && !allowed("scripts/.sovereignty-selftest-tmp.ts");
  await Deno.remove(tmp);
  console.log(`    ${injected ? "ok " : "FAIL"}  an injected live reference in a scanned file is RED and NOT allowlisted`);
  const done = ok && shOk && injected;
  console.log(`  SELFTEST ${done ? "PASSED" : "FAILED"} — the guard discriminates live code from commentary in both directions.`);
  Deno.exit(done ? 1 : 2);   // exit 1: the selftest's whole point is to demonstrate a RED
}

console.log("==> SOVEREIGNTY GUARD — can this engine run, be overseen and be operated with NO *.supabase.co host?");
console.log(`    allowlist (printed every run, never silent) — ${Object.keys(ALLOW).length} path(s):`);
for (const [p, why] of Object.entries(ALLOW)) console.log(`      ${p}\n        ${why}`);

// ── the scanned set ───────────────────────────────────────────────────────────────────────────────────────────────
const read = async (p: string) => { try { return await Deno.readTextFile(p); } catch { return null; } };
const scan = new Map<string, string>();   // repo-relative path -> source
async function add(rel: string) {
  if (scan.has(rel)) return;
  const src = await read(P(rel));
  if (src === null) return;
  scan.set(rel, src);
}

// (a) the daily runner, and every script it invokes
await add(K.SOV_RUNNER);
const runnerSrc = scan.get(K.SOV_RUNNER);
if (!runnerSrc) { console.error(`  RED  cannot read the runner ${K.SOV_RUNNER} — a guard that cannot read its input is not green.`); Deno.exit(1); }
const invoked = new Set<string>();
for (const m of runnerSrc.matchAll(/\.\.\/(scripts\/[A-Za-z0-9._-]+\.(?:ts|sh|py))/g)) invoked.add(m[1]);
for (const m of runnerSrc.matchAll(/\.\.\/(scripts\/[A-Za-z0-9._-]+)\b(?!\.)/g)) invoked.add(m[1]);
for (const f of invoked) await add(f);

// (b) every launchd-registered daemon script, and the LOCAL import closure of what it runs.
// The brief named "the two daemons"; there are seven io.aegis.* jobs, so the guard enumerates them rather than
// hardcoding a count — a hardcoded two would have left five daemons free to depend on a rented host.
const agents = `${Deno.env.get("HOME")}/Library/LaunchAgents`;
const daemonScripts = new Set<string>();
try {
  for await (const e of Deno.readDir(agents)) {
    if (!e.isFile || !/^io\.aegis\..*\.plist$/.test(e.name)) continue;
    const pl = await read(`${agents}/${e.name}`) ?? "";
    for (const m of pl.matchAll(/\/Users\/[^<]*\/aegis\/((?:infra\/)?scripts\/[A-Za-z0-9._-]+\.sh)/g)) daemonScripts.add(m[1]);
  }
} catch { /* no LaunchAgents dir on this box — reported below */ }
for (const d of daemonScripts) {
  await add(d);
  const src = scan.get(d) ?? "";
  for (const m of src.matchAll(/\.\.\/(scripts\/[A-Za-z0-9._-]+\.(?:ts|sh|py))/g)) await add(m[1]);
  for (const m of src.matchAll(/((?:infra\/)?scripts\/[A-Za-z0-9._-]+\.(?:ts|sh|py))/g)) await add(m[1]);
}

// (c) transitive LOCAL import closure of every .ts in the scanned set (a daemon can drift on a changed _shared/*.ts
// exactly as D-720b showed for staleness; the same is true for a rented-host reference).
for (let pass = 0; pass < 8; pass++) {
  const before = scan.size;
  for (const [rel, src] of [...scan]) {
    if (!rel.endsWith(".ts")) continue;
    const dir = rel.slice(0, rel.lastIndexOf("/") + 1);
    for (const m of src.matchAll(/from\s+"(\.[^"]+\.ts)"/g)) {
      const resolved = new URL(m[1], `file:///${dir}`).pathname.replace(/^\/+/, "");
      await add(resolved);
    }
  }
  if (scan.size === before) break;
}

// (d) the worker's EFFECTIVE default, checked as behaviour rather than as text: with AEGIS_BROKER unset the worker
// must announce OWNED mode. A grep can be satisfied by a comment; this cannot.
const workerSrc = scan.get("scripts/aegis-worker.ts") ?? await read(P("scripts/aegis-worker.ts")) ?? "";
if (workerSrc) scan.set("scripts/aegis-worker.ts", workerSrc);
const workerDefaultsOwned = /const OWNED_MODE = BROKER_ENV === ""/.test(workerSrc) &&
  !/Deno\.env\.get\("AEGIS_BROKER"\)\s*\|\|\s*"https?:/.test(workerSrc);

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────────────────────
let red = 0;
console.log(`\n    scanned ${scan.size} file(s) in the live path (${invoked.size} runner-invoked, ${daemonScripts.size} launchd daemon script(s), plus their import closures)`);
for (const [rel, src] of [...scan].sort()) {
  const hits = liveHits(src, /\.(sh|py)$/.test(rel));
  if (!hits.length) continue;
  const ex = allowed(rel);
  if (ex) { console.log(`    exempt ${rel} — ${hits.length} reference(s), allowlisted above`); continue; }
  red++;
  console.log(`  RED  ${rel} — ${hits.length} LIVE reference(s) to a *.supabase.co host:`);
  for (const h of hits.slice(0, 4)) console.log(`         :${h.line}  ${h.text}`);
}
if (!workerDefaultsOwned) {
  red++;
  console.log(`  RED  scripts/aegis-worker.ts does not default to the owned node — with AEGIS_BROKER unset it would still`);
  console.log(`       reach for a broker host, and every broker call is .catch(() => null), so the dependency fails SILENTLY.`);
} else {
  console.log(`    ok     scripts/aegis-worker.ts defaults to OWNED mode (AEGIS_BROKER selects a broker for a remote box)`);
}
if (!daemonScripts.size) {
  red++;
  console.log(`  RED  no launchd daemon scripts were found under ${agents} — the guard would then be certifying a set it`);
  console.log(`       never enumerated, which is the D-584 "green while reading nothing" defect. Check the plists exist.`);
}

// ── continuity: sovereignty is worthless if the sovereign engine has stopped ──────────────────────────────────────
let loopAgeH = NaN;
try { const st = await Deno.stat(P(K.SOV_LOG)); loopAgeH = (Date.now() - (st.mtime?.getTime() ?? 0)) / 3.6e6; } catch { /* absent */ }
if (!(loopAgeH < MAX_H)) {
  red++;
  console.log(`  RED  the daily runner's last loop is ${Number.isNaN(loopAgeH) ? "UNKNOWN (log absent)" : loopAgeH.toFixed(1) + "h"} old (budget ${MAX_H}h) — ${K.SOV_LOG}.`);
  console.log(`       An owned engine that has stopped is not sovereignty, it is silence. Restart: launchctl kickstart -k gui/$(id -u)/io.aegis.coverage`);
} else {
  console.log(`    ok     runner last loop ${loopAgeH.toFixed(1)}h ago (budget ${MAX_H}h)`);
}
// Three attempts at 15s. One 8s attempt reds spuriously while the other 25 guards are querying the same PostgREST —
// and a guard that cries wolf during its own cycle trains everyone to ignore it (the D-715 staleness-budget lesson).
const reach = await (async () => {
  let last = "";
  for (let i = 0; i < 3; i++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
    try { const r = await fetch(`${OWNED}/`, { signal: c.signal }); clearTimeout(t); return `HTTP ${r.status}`; }
    catch (e) { last = e instanceof Error ? e.message : String(e); } finally { clearTimeout(t); }
    if (i < 2) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return `UNREACHABLE after 3 tries: ${last}`;
})();
if (reach.startsWith("UNREACHABLE")) {
  red++;
  console.log(`  RED  the OWNED PostgREST is unreachable (${OWNED} -> ${reach}). Every conclusion today is UNKNOWN, not null.`);
  console.log(`       Remediation: infra/scripts/up.sh`);
} else {
  console.log(`    ok     owned PostgREST ${OWNED} -> ${reach}`);
}

console.log(`\n  ${red === 0
  ? "SOVEREIGN — nothing in the runner, the daemons or the worker's default needs a *.supabase.co host, and the owned engine is live."
  : `${red} SOVEREIGNTY/CONTINUITY FAILURE(S) — the engine depends on infrastructure an unpaid invoice can remove, or has stopped.`}`);
if (red > 0) Deno.exit(1);
