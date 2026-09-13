#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
// data-stack-guard.ts (D-879) — the 32nd guard: the whole data stack, on the board. Reads data/data-stack-audit.json
// written by scripts/data-stack-audit.ts each cycle. A whole PANEL not being refreshed is RED unconditionally (that is
// how Bybit and spot sat three weeks stale under a green board); every other RED class ratchets against a baseline
// the way the plumbing and threshold guards do, so a defect that was read and fixed ages out and a new one cannot hide.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("data-stack-guard", [
  { name: "MAX_AGE_H", def: "30", note: "the audit file must be younger than this or the guard is reading a stale audit — RED" },
  { name: "UPDATE_BASELINE", def: "0", note: "1 = accept today's non-panel RED count as the baseline (only after each was read)" },
  { name: "SELFTEST", def: "0", note: "1 = inject a stale-panel finding and prove it is refused" },
]);
const SELFTEST = K.SELFTEST === "1" || Deno.env.get("GUARD_SELFTEST") === "1";
const base = new URL("..", import.meta.url).pathname; const AUD = `${base}data/data-stack-audit.json`, BASE = `${base}scripts/data-stack-baseline.json`;
let a: { at: string; red: number; findings: { table: string; tf: string; symbol: string; verdict: string; staleDays: number }[] };
try { a = JSON.parse(await Deno.readTextFile(AUD)); } catch { console.error("!! data/data-stack-audit.json missing — the audit has not run; RED."); Deno.exit(1); }
const ageH = (Date.now() - Date.parse(a.at)) / 3600000; let red = 0;
console.log(`\n==> DATA STACK GUARD — audit from ${a.at.slice(0, 16)} (${ageH.toFixed(1)}h old)`);
if (ageH > +K.MAX_AGE_H) { red++; console.log(`  RED  the audit is ${ageH.toFixed(0)}h old (budget ${K.MAX_AGE_H}h) — a guard reading a stale audit certifies nothing`); }
const findings = [...a.findings, ...(SELFTEST ? [{ table: "trd_bars_intraday", tf: "SELFTEST", symbol: "SELFTEST", verdict: "RED-PANEL-STALE", staleDays: 99 }] : [])];
const panelStale = [...new Set(findings.filter((f) => f.verdict === "RED-PANEL-STALE").map((f) => `${f.table}/${f.tf}`))];
for (const p of panelStale) { red++; console.log(`  RED  whole panel not refreshed: ${p}`); }
const other = findings.filter((f) => f.verdict === "RED");
let baseline = other.length; try { baseline = JSON.parse(await Deno.readTextFile(BASE)).red; } catch { try { await Deno.writeTextFile(BASE, JSON.stringify({ red: other.length, set: new Date().toISOString() }, null, 2)); } catch { /* board runs without write */ } }
if (K.UPDATE_BASELINE === "1" && other.length < baseline) { await Deno.writeTextFile(BASE, JSON.stringify({ red: other.length, set: new Date().toISOString() }, null, 2)); baseline = other.length; console.log(`  baseline ratcheted down to ${baseline}`); }
if (other.length > baseline) { red++; console.log(`  RED  ${other.length} series RED vs baseline ${baseline} — a NEW data defect: ${other.slice(0, 8).map((f) => `${f.tf}/${f.symbol}`).join(", ")}`); }
else console.log(`  ok   ${other.length} series RED (stale or broken) vs baseline ${baseline}; ${panelStale.length ? "" : "every panel is being refreshed"}`);
if (SELFTEST) { if (!panelStale.includes("trd_bars_intraday/SELFTEST")) { console.error("!! SELFTEST: injected stale panel not refused — RED."); Deno.exit(1); } console.log("  SELFTEST PASSED — an injected stale panel was refused."); Deno.exit(1); }
console.log(`  ${red ? `${red} RED` : "DATA STACK GREEN — every panel refreshed, no new series defect."}`);
if (red) Deno.exit(1);
