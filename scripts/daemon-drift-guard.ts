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
// LIMITATION, STATED: this compares the ENTRY script only, not the shared modules it imports. A daemon can still
// drift on a changed _shared/*.ts while its entry file is untouched. The entry file is the dominant signal and the
// one that moved in the incident; a full dependency-closure check is a later refinement, noted not hidden.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("daemon-drift-guard", [{ name: "SELFTEST", def: "0", note: "1 = run the parse/compare self-test and exit" }]);

async function sh(cmd: string[]): Promise<string> {
  const p = new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "piped", stderr: "null" });
  const { stdout } = await p.output();
  return new TextDecoder().decode(stdout);
}

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
  console.log(ok ? "  SELFTEST OK — drift comparison correct in all 4 directions" : "  SELFTEST FAILED");
  Deno.exit(ok ? 0 : 2);
}

const REPO = new URL("..", import.meta.url).pathname;
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
  // Last commit touching this script. If the file is untracked/never committed, skip (no baseline to compare).
  const ct = (await sh(["git", "-C", REPO, "log", "-1", "--format=%ct", "--", script])).trim();
  if (!ct) continue;
  const commitEpoch = Number(ct);
  const ageH = ((Date.now() / 1000 - startEpoch) / 3600).toFixed(1);
  checked.push(`${script} (pid ${pid}, up ${ageH}h)`);
  if (drifted(startEpoch, commitEpoch)) {
    const behindH = ((commitEpoch - startEpoch) / 3600).toFixed(1);
    drifts.push(`${script}: pid ${pid} started ${behindH}h BEFORE its last commit — running code the repo no longer contains. Restart it (kill ${pid}; launchd KeepAlive respawns on current source).`);
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
