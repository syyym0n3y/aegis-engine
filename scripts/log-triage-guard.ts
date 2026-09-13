#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-run
// log-triage-guard.ts (D-854b) — the guard that does what the operator had to prompt a session to do.
//
// D-853 was found by READING THE LOGS of a runner that the board certified green: the index feed had 500'd for twelve
// hours, a clock had raised on a missing column for weeks, and every one of those errors sat in a log nothing read.
// The board watched the LEDGER and the MARKS; nobody watched the ERROR STREAM. This reads it: the database's own
// ERROR lines, PostgREST's non-2xx responses by path, every ingest log for a failed write, and the scorer for a
// scorer-error — and it reds on any class that is NEW against a baseline, so a defect that was fixed does not
// keep the board red and a defect that appears cannot hide behind volume. Ratchet shape (plumbing/threshold guards).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("log-triage-guard", [
  { name: "SINCE", def: "26h", note: "docker --since window; a hair over a daily cycle" },
  { name: "SELFTEST", def: "0", note: "1 = inject an error class that cannot be in the baseline and prove the guard refuses it" },
  { name: "UPDATE_BASELINE", def: "0", note: "1 = accept today's classes as the new baseline (only after each was read and either fixed or waived)" },
]);
const base = new URL("..", import.meta.url).pathname;
const BASE = `${base}scripts/log-triage-baseline.json`;
async function sh(cmd: string[]): Promise<string> {
  try { const p = new Deno.Command(cmd[0], { args: cmd.slice(1), stdout: "piped", stderr: "piped" }); const o = await p.output(); return new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr); } catch { return ""; }
}
const norm = (s: string) => s.replace(/\d+/g, "N").replace(/\s+/g, " ").trim().slice(0, 90);
// BY-DESIGN refusals are not defects: the immutability triggers on trd_prereg / trd_forward_rules / trd_forward_marks /
// trd_trial_counter are made to RAISE every day by the guards' own self-tests (D-571/613/631). Counting those as error
// classes would re-red the board every cycle for the system working. Excluded by the trigger's own wording.
const BY_DESIGN = /append-only|cannot be rewritten|cannot be deleted|UPDATE\/DELETE forbidden|is immutable|already recorded as/i;
type Cls = { source: string; key: string; count: number; sample: string };
const classes = new Map<string, Cls>();
const add = (source: string, key: string, sample: string) => { const id = `${source}|${key}`; const c = classes.get(id); if (c) c.count++; else classes.set(id, { source, key, count: 1, sample }); };

// 1. Postgres ERROR lines, by normalised message
const db = await sh(["docker", "logs", "aegis-db", "--since", K.SINCE]);
let dbLines = 0;
for (const L of db.split("\n")) { const m = /ERROR:\s+(.*)$/.exec(L); if (m) { dbLines++; if (BY_DESIGN.test(m[1])) continue; add("postgres", norm(m[1]), m[1].slice(0, 160)); } }
// 2. PostgREST non-2xx, by status + path
const rest = await sh(["docker", "logs", "aegis-rest", "--since", K.SINCE]);
let restLines = 0;
for (const L of rest.split("\n")) { const m = /"(?:GET|POST|PATCH|DELETE) (\/[^ ?"]*)[^"]*" ([45]\d\d) /.exec(L); if (m) { restLines++; add("postgrest", `${m[2]} ${m[1]}`, L.slice(0, 160)); } }
// 3. Ingest / job logs: a failed write printed as a status, or named as a failure
const LOGS = ["data/micro-fx-live.log", "data/micro-sheet.log", "infra/data/micro-hourly.log", "infra/data/micro-hourly.err", "infra/data/coverage.log", "infra/data/coverage.err", "infra/data/daily.err", "infra/data/cryptofwd.err", "infra/data/autopilot.err", "infra/data/attribution.err", "data/catalogue.log", "data/search-space.log"];
for (const f of LOGS) {
  let t = ""; try { t = await Deno.readTextFile(`${base}${f}`); } catch { continue; }
  // The daily runner's logs ACCUMULATE across cycles (a 2026-09-06 borrow-fee failure was still in coverage.log four
  // days after it was fixed). Only the CURRENT cycle is evidence: read from the last "== CYCLE START ==" stamp the
  // runner prints (D-854, peer session). Per-run logs are overwritten and carry no stamp.
  const cut = t.lastIndexOf("== CYCLE START =="); if (cut > 0) t = t.slice(cut);
  for (const L of t.split("\n")) {
    if (/write (4|5)\d\d\b|WRITE FAILED|WRITE-FAILED|FAILED\b|SCORER-ERROR|Uncaught|STRICT READ FAILED/.test(L)) add(f, norm(L.replace(/^\s*[\d-]+T[\d:]+Z?\s*/, "")), L.trim().slice(0, 160));
  }
}
if (K.SELFTEST === "1") add("SELFTEST", "injected error class that cannot be in any baseline", "SELFTEST injected");

let baseline: Record<string, number> = {};
try { baseline = JSON.parse(await Deno.readTextFile(BASE)).classes ?? {}; } catch { /* first run: everything is new until accepted */ }
const ids = [...classes.keys()].sort();
const isNew = ids.filter((id) => !(id in baseline));
console.log(`==> LOG TRIAGE GUARD — ${dbLines} postgres ERROR line(s), ${restLines} PostgREST non-2xx, ${classes.size} error class(es) in the last ${K.SINCE}`);
for (const id of ids) { const c = classes.get(id)!; console.log(`  ${id in baseline ? "seen" : "NEW "}  ${String(c.count).padStart(4)}x  [${c.source}] ${c.key}`); if (!(id in baseline)) console.log(`          e.g. ${c.sample}`); }
if (K.UPDATE_BASELINE === "1") {
  const out: Record<string, number> = {}; for (const id of ids) if (id !== "SELFTEST|injected error class that cannot be in any baseline") out[id] = classes.get(id)!.count;
  await Deno.writeTextFile(BASE, JSON.stringify({ classes: out, set: new Date().toISOString(), note: "D-854: every class here was READ and either fixed (it will age out) or waived with a reason in DECISIONS.md" }, null, 2));
  console.log(`  baseline updated: ${Object.keys(out).length} class(es) accepted.`);
}
if (K.SELFTEST === "1") {
  if (!isNew.some((id) => id.startsWith("SELFTEST|"))) { console.error("!! SELFTEST: injected class was not flagged NEW — RED."); Deno.exit(1); }
  console.log(`  SELFTEST PASSED — the injected class was refused as NEW.`);
  Deno.exit(1);   // a selftest run MUST end red: it injected a subject that has to be refused (D-841 convention)
}
if (isNew.length) { console.log(`\n  RED — ${isNew.length} NEW error class(es) since the baseline. Read each, fix or waive, then UPDATE_BASELINE=1.`); Deno.exit(1); }
console.log(`\n  LOG TRIAGE GREEN — no new error class in the last ${K.SINCE}; ${ids.length} known class(es) still present are listed above and age out when fixed.`);
