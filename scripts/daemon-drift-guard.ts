#!/usr/bin/env -S deno run --allow-run --allow-env
// daemon-drift-guard.ts (D-719c) — a long-lived daemon that started BEFORE the last commit to its own script is
// running code the repository no longer contains. That is not hypothetical: this session spent an hour diagnosing
// two "discovery write bugs" (a trd_trial_counter 409 and a trd_discovery_log 400) that did not exist in the source
// — the discovery daemon had been running since ~26h before D-714 added the on_conflict target that fixes the 409,
// so it 409'd every cycle while the committed code was already correct. The agent-output guard could not catch it
// because it reads LOG age, not CODE age: a daemon on stale code writes a fresh log full of already-fixed failures.
//
// THE CHECK: for every running `deno run ... scripts/<X>.ts` process, compare its start time to the last git commit
// touching scripts/<X>.ts. If the process is OLDER than its source, it has drifted and must be restarted. The fix is
// always the same and always safe under launchd KeepAlive — kill the process, launchd respawns it on current source.
//
// IMPORT-CLOSURE AWARE (D-720b, closing D-719c's stated limitation). The first version compared the ENTRY script
// only, so a daemon could drift on a changed _shared/*.ts while its entry file was untouched — and this is not
// hypothetical: aegis-discovery imports _shared/data-version.ts, so an edit there without a restart is exactly the
// silent drift the guard exists to catch. The check now walks each daemon's LOCAL import closure transitively and
// compares the process start against the NEWEST commit across the entry file AND every module it pulls in.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("daemon-drift-guard", [
  { name: "SELFTEST", def: "0", note: "1 = run the parse/compare self-test and exit" },
  { name: "MIN_AGE_MIN", def: "60", note: "only flag processes up longer than this — the guard targets RESIDENT daemons, not one-shot batch jobs (an ingest/analysis whose source is committed mid-run is not the stale-daemon danger; it exits or picks up current code well before this)" },
]);

async function sh(cmd: string[]): Promise<string> {
  const p = new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "piped", stderr: "null" });
  const { stdout } = await p.output();
  return new TextDecoder().decode(stdout);
}

// REPO must be initialised BEFORE the self-test block below, which calls closure() — closure reads `${REPO}...`, and
// as a `const` REPO is in the temporal dead zone until this line. The first self-test caught exactly this: the
// closure's try/catch swallowed the TDZ ReferenceError and returned only the entry file, so the dependency check
// looked inert. The live loop hid it because REPO was initialised by the time the loop ran.
const REPO = new URL("..", import.meta.url).pathname;

// Pure comparison so it can be self-tested without real processes: drift iff the process started strictly before the
// last commit to its script (with a small grace so a restart racing a commit in the same minute is not flagged).
function drifted(startEpoch: number, commitEpoch: number, graceSec = 60): boolean {
  return commitEpoch - startEpoch > graceSec;
}

if ((Deno.env.get("SELFTEST") || Deno.env.get("GUARD_SELFTEST")) === "1") {
  const cases: [number, number, boolean][] = [
    [1000, 2000, true],    // started well before the commit -> drift
    [2000, 1000, false],   // started after the commit -> fresh
    [2000, 2030, false],   // commit 30s after start, within grace -> not flagged
    [1000, 1100, true],    // commit 100s after start, past grace -> drift
  ];
  let ok = true;
  for (const [s, c, want] of cases) { const got = drifted(s, c); if (got !== want) { ok = false; console.error(`  SELFTEST FAIL: drifted(${s},${c}) = ${got}, want ${want}`); } }
  // Closure walk must transitively include a KNOWN cross-directory dependency, or the D-720b extension is inert:
  // aegis-discovery imports ../supabase/functions/_shared/data-version.ts, so that path must appear in its closure.
  const clo = await closure("scripts/aegis-discovery.ts");
  const hasDep = clo.some((f) => f.includes("data-version.ts"));
  if (!hasDep) { ok = false; console.error(`  SELFTEST FAIL: closure did not resolve the data-version.ts dependency (got ${clo.join(", ")})`); }
  else console.log(`  closure walk resolved ${clo.length} files incl. the cross-directory dependency`);
  console.log(ok ? "  SELFTEST OK — drift comparison correct in all 4 directions, closure walk resolves dependencies" : "  SELFTEST FAILED");
  Deno.exit(ok ? 0 : 2);
}

// Walk a script's LOCAL import closure (relative "./" and "../" imports only — npm/jsr/http deps are not repo code
// and cannot drift against a commit). Returns the repo-relative paths of the entry plus every local module it pulls
// in, transitively, with a visited set so import cycles terminate. A file that cannot be read is skipped, not fatal.
async function closure(entryRel: string): Promise<string[]> {
  const seen = new Set<string>(), out: string[] = [];
  async function visit(rel: string) {
    if (seen.has(rel)) return;
    seen.add(rel); out.push(rel);
    let src = "";
    try { src = await Deno.readTextFile(`${REPO}${rel}`); } catch { return; }
    for (const m of src.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
      // Resolve the relative import against the importing file's directory, then make it repo-relative again.
      const abs = new URL(m[1], `file://${REPO}${rel}`).pathname;
      const childRel = abs.startsWith(REPO) ? abs.slice(REPO.length) : abs;
      await visit(childRel);
    }
  }
  await visit(entryRel);
  return out;
}
// Newest commit epoch across a set of repo paths (0 if none are tracked).
async function newestCommit(paths: string[]): Promise<{ epoch: number; file: string }> {
  let best = { epoch: 0, file: "" };
  for (const p of paths) {
    const ct = (await sh(["git", "-C", REPO, "log", "-1", "--format=%ct", "--", p])).trim();
    const e = Number(ct);
    if (Number.isFinite(e) && e > best.epoch) best = { epoch: e, file: p };
  }
  return best;
}

// macOS ps: lstart is an absolute timestamp Date.parse understands; command carries the script path.
const ps = await sh(["ps", "-axo", "pid=,lstart=,command="]);
const drifts: string[] = [], checked: string[] = [];
for (const line of ps.split("\n")) {
  if (!/deno run/.test(line) || !/scripts\/[a-z0-9-]+\.ts/.test(line)) continue;
  if (/daemon-drift-guard\.ts/.test(line)) continue;                       // don't flag this guard's own invocation
  const m = line.match(/^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
  if (!m) continue;
  const pid = m[1], lstart = m[2], cmd = m[3];
  const sm = cmd.match(/scripts\/([a-z0-9-]+\.ts)/);
  if (!sm) continue;
  const script = `scripts/${sm[1]}`;
  const startEpoch = Math.floor(Date.parse(lstart) / 1000);
  if (!Number.isFinite(startEpoch)) continue;
  // Newest commit across the ENTRY script AND its whole local import closure. If nothing is tracked, skip.
  const clo = await closure(script);
  const newest = await newestCommit(clo);
  if (!newest.epoch) continue;
  const ageMin = (Date.now() / 1000 - startEpoch) / 60;
  const ageH = (ageMin / 60).toFixed(1);
  const via = newest.file === script ? "" : ` via ${newest.file}`;
  // A process up less than MIN_AGE is a batch job (ingest/analysis), not a resident daemon — the stale-daemon danger
  // is code running unrestarted for HOURS across commits, not a script whose source was tweaked while it briefly ran.
  // A recently-started process is running code it JUST loaded, so it cannot be stale yet — whether it is a batch job
  // that will exit or a daemon just restarted. Only once it has run past MIN_AGE across commits is drift meaningful.
  if (ageMin < Number(K.MIN_AGE_MIN)) { checked.push(`${script} (pid ${pid}, up ${ageH}h — under MIN_AGE, just-loaded code, not drift-checked)`); continue; }
  checked.push(`${script} (pid ${pid}, up ${ageH}h, closure ${clo.length} file${clo.length === 1 ? "" : "s"})`);
  if (drifted(startEpoch, newest.epoch)) {
    const behindH = ((newest.epoch - startEpoch) / 3600).toFixed(1);
    drifts.push(`${script}: pid ${pid} started ${behindH}h BEFORE its newest source commit${via} — running code the repo no longer contains. Restart it (kill ${pid}; launchd KeepAlive respawns on current source).`);
  }
}

console.log(`==> DAEMON DRIFT GUARD — ${checked.length} running deno daemon(s) checked against their source`);
for (const c of checked) console.log(`    ${c}`);
if (drifts.length) {
  console.log(`\n  ${drifts.length} DRIFTED DAEMON(S) — RED:`);
  for (const d of drifts) console.log(`    !! ${d}`);
  console.log(`\n  A daemon on stale code writes a FRESH log full of already-fixed failures — the exact shape that`);
  console.log(`  cost an hour this session (D-719/719b). The agent-output guard reads log age; this reads code age.`);
  Deno.exit(1);
}
console.log(`\n  NO DRIFT — every running daemon is at or newer than its committed source.`);
