#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run
// rest-restart-guard.ts (D-810) — the 30th guard: did PostgREST RESTART since the last cycle?
//
// Origin: 2026-09-06 10:09:38Z — the market-cap guard went RED in the loop ("cannot reach equity bars"), the board was
// green, and the cause was a PostgREST restart at that exact second (the DB log: "unexpected EOF on client connection with
// an open transaction"). `docker logs aegis-rest` carries 15 "Starting PostgREST" lines since the container was created;
// at least two coincide with research scripts pulling whole panels through REST. Every fail-closed guard turns RED on a
// restart and NOTHING says "REST restarted" — so the symptom (a guard) gets chased instead of the cause (the substrate).
// This guard counts starts and goes RED when the count rose since its last run, printing the new start timestamps; it
// then advances its baseline so it can go GREEN again (a guard that cannot go green gets ignored, D-586).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("rest-restart-guard", [
  { name: "CONTAINER", def: "aegis-rest" }, { name: "DB_CONTAINER", def: "aegis-db" }, { name: "BASELINE", def: "data/rest-start-count.json" },
  { name: "GUARD_SELFTEST", def: "", note: "1 = inject a fake higher count and prove the guard goes RED without touching the baseline" },
]);
const REPO = new URL("..", import.meta.url).pathname; const base = K.BASELINE.startsWith("/") ? K.BASELINE : `${REPO}${K.BASELINE}`;
export function newStarts(logLines: string[], prevCount: number): { count: number; fresh: string[] } {
  const starts = logLines.filter((l) => /Starting PostgREST/.test(l)); return { count: starts.length, fresh: starts.slice(prevCount).map((l) => l.slice(0, 26)) };
}
let lines: string[];
if (K.GUARD_SELFTEST === "1") { lines = ["01/Jan/2026:00:00:00 +0000: Starting PostgREST 12", "02/Jan/2026:00:00:00 +0000: Starting PostgREST 12"]; const r = newStarts(lines, 1); if (r.count !== 2 || r.fresh.length !== 1) { console.error("SELFTEST FAIL", r); Deno.exit(1); } const g = newStarts(lines, 2); if (g.fresh.length) { console.error("SELFTEST FAIL: no new starts should be green", g); Deno.exit(1); } console.log("  REST RESTART GUARD SELFTEST PASS (RED on a new start, GREEN when the count is unchanged)"); Deno.exit(0); }
// D-812: the DB side. A backend killed by the kernel (signal 9) while building a response is the mechanism that was
// established on 2026-09-07 00:17Z: "server process ... was terminated by signal 9: Killed / Failed process was running:
// WITH pgrst_source AS ( SELECT ... trd_bars_intraday ...)". The postmaster then bounces every backend and PostgREST
// reconnects/restarts. Print the culprit statement so the cause is named, not the symptom.
const dbOut = await new Deno.Command("docker", { args: ["logs", "--since", "25h", K.DB_CONTAINER], stdout: "piped", stderr: "piped" }).output();
const dbLines = (new TextDecoder().decode(dbOut.stdout) + new TextDecoder().decode(dbOut.stderr)).split("\n");
const kills = dbLines.filter((l) => /terminated by signal 9|Failed process was running/.test(l)).map((l) => l.slice(0, 200));
const out = await new Deno.Command("docker", { args: ["logs", K.CONTAINER], stdout: "piped", stderr: "piped" }).output();
if (!out.success) { console.error(`  REST RESTART GUARD RED — cannot read docker logs for ${K.CONTAINER} (exit ${out.code}); refusing to certify`); Deno.exit(1); }
lines = (new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr)).split("\n");
let prev = -1; try { prev = JSON.parse(await Deno.readTextFile(base)).count; } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
const r = newStarts(lines, Math.max(0, prev));
// The BOARD (guard-status.sh) runs guards without --allow-write; the LOOP grants it. A read-only run still gets a verdict
// against the persisted baseline and simply does not advance it — the loop is the writer. (Without this the guard threw
// on the board while passing in the loop: the D-801 shape, mirrored.)
let persisted = true;
try { await Deno.writeTextFile(base, JSON.stringify({ count: r.count, checked_at: new Date().toISOString() }) + "\n"); }
catch (e) { if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) persisted = false; else throw e; }
if (!persisted) console.log("  (read-only run: baseline not advanced — the runner's line writes it)");
if (prev < 0) { console.log(`  REST RESTART GUARD — baseline set: ${r.count} start(s) in the container log (first run, no verdict)`); Deno.exit(0); }
if (kills.length) console.log(`  DB-SIDE: ${kills.length / 2 | 0 || 1} backend kill(s) in the last 25h — the killed statement(s):\n    ${kills.join("\n    ")}`);
if (r.count > prev) { console.error(`  REST RESTART GUARD RED — PostgREST restarted ${r.count - prev} time(s) since the last cycle: ${r.fresh.join(", ")}. Every fail-closed guard RED in this cycle may be this, not data.`); Deno.exit(1); }
console.log(`  REST RESTART GUARD GREEN — no PostgREST restart since the last cycle (${r.count} start(s) on record)`);
