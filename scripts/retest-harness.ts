#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write
// retest-harness.ts (D-736) — "keep running tests on the new data we keep finding." A verdict is a snapshot of the
// data as it was; new events (spin-offs, de-SPACs), new prices, and new macro readings arrive continuously, and a
// null can decay into a signal or a candidate can die. This re-runs the programme's key RESEARCH scripts on a cadence,
// captures each one's headline verdict, and FLAGS when a verdict MATERIALLY MOVES since the last re-test — so effort
// follows where the dirt has started (or stopped) yielding, instead of re-mining settled ground or missing a shift.
//
// It is deliberately CHEAP to add a script (one manifest line) and deliberately HONEST: it does not re-interpret a
// result, it records the number the script itself prints and compares it to last time. A flip is a prompt for a human
// (or the author) to look, never an auto-verdict — the same discipline as the forward scorer (D-613).
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("retest-harness", [{ name: "ONLY", def: "", note: "comma-separated names to re-test (default: all)" }]);

const STATE = "/Users/ona/Projects/aegis/data/retest-state.json";
const REPO = new URL("..", import.meta.url).pathname;

// Each entry: run this script, then pull a numeric headline via `pick` (a regex capturing one number from stdout).
// The number is what gets tracked run-to-run; `moved` decides what counts as a material change worth flagging.
interface Test { name: string; args: string[]; pick: RegExp; moved: (prev: number, now: number) => boolean; note: string }
const TESTS: Test[] = [
  { name: "spinoff", args: ["scripts/spinoff-event.ts"], pick: /500d LIQUID.*?median\s+(-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 8, note: "spin-off 500d liquid median excess vs SPY (the candidate)" },
  { name: "despac", args: ["scripts/despac-event.ts"], pick: /500d\s+ALL n=\s*\d+\s+median\s+(-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 8, note: "de-SPAC 500d ALL median excess (the confirmed underperformance)" },
  { name: "merger-arb", args: ["scripts/merger-arb-event.ts"], pick: /LIQUID tercile.*?DRIFT excess\s+(-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 1.5, note: "merger-arb liquid post-announcement drift (was NULL)" },
  { name: "macro-regime", args: ["scripts/macro-regime-conditioning.ts"], pick: /GC=F:.*?=\s*(-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 0.05, note: "gold-vs-real-yield contemporaneous corr (the driver check)" },
  { name: "bond-carry", args: ["scripts/bond-carry.ts"], pick: /ROLLING Z.*?steep-minus-flat t=(-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 1.0, note: "bond-carry rolling-z t (was NULL, t 1.29)" },
  { name: "fx-carry", args: ["scripts/fx-carry.ts"], pick: /Sharpe \(ann\)\s+(-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 0.3, note: "fx-carry G6 long-short Sharpe (was NULL, SR 0.22 / t 1.06, D-738)" },
  { name: "options-regime", args: ["scripts/options-regime.ts"], pick: /VERDICT S1 SKEW z252:.*?\|t\|\s+(-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 1.0, note: "options-regime SKEW OOS overlap-adjusted |t| (was NULL, 0.28, D-739)" },
  { name: "index-inclusion", args: ["--allow-read", "--allow-write", "scripts/index-inclusion-event.ts"], pick: /^\s+21\s+\d+\s+-?\d+\.?\d*\s+-?\d+\.?\d*\s+(-?\d+\.?\d*)/m,
    moved: (p, n) => Math.abs(n - p) > 1.5, note: "S&P-500 inclusion 21d full-sample excess t (was NULL, -1.39, D-740)" },
  { name: "fx-carry-em", args: ["scripts/fx-carry-em.ts"], pick: /EM : gross t (-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 1.0, note: "EM-only carry gross t (research-space premium, not promotable, 2.79, D-741)" },
  { name: "commodity-roll", args: ["scripts/commodity-roll.ts"], pick: /post-2005 \(OOS-style\): -?\d+\.?\d*%\/yr t (-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 1.0, note: "CL roll-yield post-2005 gross t (NULL OOS, 1.18, D-742; static EIA history so should not move)" },
  { name: "inventory-surprise", args: ["scripts/inventory-surprise.ts"], pick: /SIGN-CONDITIONED short-build\/long-draw \(gross\)\s+-?\d+\.?\d*%\/yr\s+SR -?\d+\.?\d*\s+gross t (-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 1.0, note: "CL inventory-change conditioning gross t (NULL, -0.62, D-743; live weekly feed)" },
  { name: "gld-flow", args: ["scripts/gld-flow.ts"], pick: /SIGN-CONDITIONED \(gross\)\s+-?\d+\.?\d*%\/yr\s+SR -?\d+\.?\d*\s+gross t (-?\d+\.?\d*)/i,
    moved: (p, n) => Math.abs(n - p) > 1.0, note: "GLD flow -> gold sign-conditioned gross t (prior backwards, -1.88, D-745; live daily feed)" },
];

let state: Record<string, number> = {};
try { state = JSON.parse(await Deno.readTextFile(STATE)); } catch { /* first run */ }
const only = (Deno.env.get("ONLY") || "").split(",").map((s) => s.trim()).filter(Boolean);
const run = TESTS.filter((t) => !only.length || only.includes(t.name));

console.log(`==> RE-TEST HARNESS — re-running ${run.length} research verdict(s) on current data\n`);
const flags: string[] = [];
for (const t of run) {
  const p = new Deno.Command("deno", { args: ["run", "--allow-net", "--allow-env", ...t.args], cwd: REPO, stdout: "piped", stderr: "piped",
    env: { ...Deno.env.toObject() } });
  const { stdout, stderr } = await p.output();
  const out = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
  const m = out.match(t.pick);
  if (!m) { console.log(`  ${t.name.padEnd(14)} could not parse a headline (${t.note}) — script output changed or errored`); continue; }
  const now = Number(m[1]);
  const prev = state[t.name];
  const moved = prev != null && Number.isFinite(prev) && t.moved(prev, now);
  console.log(`  ${t.name.padEnd(14)} ${now.toFixed(3).padStart(9)}  ${prev == null ? "(first reading)" : `prev ${prev.toFixed(3)}${moved ? "  ** MATERIAL MOVE **" : ""}`}   ${t.note}`);
  if (moved) flags.push(`${t.name}: ${prev.toFixed(2)} -> ${now.toFixed(2)} (${t.note})`);
  state[t.name] = now;
}
await Deno.writeTextFile(STATE, JSON.stringify(state, null, 2));
if (flags.length) {
  console.log(`\n  ${flags.length} VERDICT(S) MOVED MATERIALLY since last re-test — a human should look (a flip is a prompt, not a verdict):`);
  for (const f of flags) console.log(`    !! ${f}`);
  Deno.exit(1);   // RED so the daily board surfaces it
}
console.log(`\n  No material verdict moves — settled ground stays settled; new data has not changed the picture.`);
