#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run
// host-budget-guard.ts (D-975) — THE 33rd GUARD, and the first whose subject is THE OPERATOR'S MACHINE.
//
// THE DEFECT IT WAS BUILT FOR. For roughly two weeks the operator's 16GB iMac degraded with uptime and had to be
// rebooted every few days. Every guard on this board was green throughout, because all 32 inspect the RESEARCH --
// the ledger, the agents, the data, the daemons -- and not one asked whether the host those run on was still
// usable. Measured 2026-10-04: 7% memory free, 6.45GB of 7.17GB swap consumed, 57,477 pageouts, caused by a
// 3-hourly cron loading an 11GB vision model into 16GB of RAM. The engine was healthy; the human's machine was not.
// An engine that costs its operator their computer is not free, and nothing was measuring that cost.
//
// WHAT IT REFUSES: sustained memory starvation, a swap file that is mostly consumed, and (named, not guessed) the
// process holding the most resident memory, so the RED says what to do rather than that something is wrong.
// Thresholds are deliberately loose -- this must catch "the machine is becoming unusable", not normal busy work.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("host-budget-guard", [
  { name: "MIN_FREE_PCT", def: "15", note: "RED below this much system memory free (sustained starvation)" },
  { name: "MAX_SWAP_PCT", def: "80", note: "swap share that counts as pressure (only RED when memory is ALSO below COMFORT_PCT)" },
  { name: "COMFORT_PCT", def: "40", note: "memory-free level above which paging is treated as harmless background activity" },
  { name: "MAX_PAGEOUT_RATE", def: "200", note: "pages/second sustained over the sample window that counts as real thrash (the 2026-10-04 incident ran orders of magnitude above this)" },
  { name: "SAMPLE_S", def: "4", note: "seconds between the two vm_stat reads that give a RATE rather than a total" },
  { name: "SELFTEST", def: "0", note: "1 = feed impossible readings and prove the guard refuses them" },
]);
const sh = async (cmd: string[]) => { try { const p = new Deno.Command(cmd[0], { args: cmd.slice(1) }); const o = await p.output(); return new TextDecoder().decode(o.stdout); } catch { return ""; } };
const judge = (freePct: number | null, swapUsed: number, swapTot: number, pageoutRate: number | null = null) => {
  const reds: string[] = [];
  if (freePct !== null && freePct < +K.MIN_FREE_PCT) reds.push(`only ${freePct}% system memory free (floor ${K.MIN_FREE_PCT}%) — the machine is starved`);
  // Swap alone is NOT a RED: after a pressure event macOS leaves the swap file populated long after the machine
  // is healthy again, and a guard that stays red once the problem is over trains the operator to ignore it (the
  // crying-wolf failure this programme names explicitly). So swap only counts as ACTIVE pressure when memory is
  // also under comfort -- historical residue, which a reboot clears, is reported but does not red.
  // D-984: this said "actively paging" while measuring static swap OCCUPANCY, which is not the same thing — macOS
  // keeps swap allocated long after the pressure passes, so on a host up 10+ days it fires during ordinary work
  // (39% free with a browser open is not degradation). The honest signal for "actively paging" is the pageout RATE,
  // which the caller measures over a real interval and passes in. Occupancy alone is now reported, never RED.
  const swapPct = swapTot > 0 ? 100 * swapUsed / swapTot : 0;
  if (pageoutRate !== null && pageoutRate > +K.MAX_PAGEOUT_RATE && freePct !== null && freePct < +K.COMFORT_PCT)
    reds.push(`paging out ${pageoutRate.toFixed(0)} pages/s sustained while memory is at ${freePct}% — actively paging, not computing (swap ${swapPct.toFixed(0)}% consumed)`);
  return reds;
};
if (K.SELFTEST === "1") {
  const a = judge(3, 7000, 7168, 5000); if (a.length !== 2) { console.error("SELFTEST FAIL: a starved host must raise both", a); Deno.exit(1); }
  const b = judge(39, 6185, 7168, 0); if (b.length !== 0) { console.error("SELFTEST FAIL: full swap with NO paging is residue, must pass", b); Deno.exit(1); }
  const c = judge(null, 100, 0, null); if (c.length !== 0) { console.error("SELFTEST FAIL: unknown readings must not invent a RED", c); Deno.exit(1); }
  console.log("  HOST BUDGET SELFTEST PASS (RED on starvation+swap, GREEN on a healthy host, silent when unreadable)");
  Deno.exit(0);
}
const mp = await sh(["/usr/bin/memory_pressure"]);
const fm = mp.match(/System-wide memory free percentage:\s*(\d+)%/);
const freePct = fm ? +fm[1] : null;
const sw = await sh(["/usr/sbin/sysctl", "-n", "vm.swapusage"]);
const used = +(sw.match(/used = ([0-9.]+)M/)?.[1] ?? 0), tot = +(sw.match(/total = ([0-9.]+)M/)?.[1] ?? 0);
const pageouts = async () => { const v = await sh(["/usr/bin/vm_stat"]); const m = v.match(/Pageouts:\s*(\d+)/); return m ? +m[1] : null; };
const p1 = await pageouts(); await new Promise((r) => setTimeout(r, +K.SAMPLE_S * 1000)); const p2 = await pageouts();
const rate = (p1 !== null && p2 !== null) ? (p2 - p1) / +K.SAMPLE_S : null;
const reds = judge(freePct, used, tot, rate);
console.log(`\n==> HOST BUDGET GUARD — memory free ${freePct ?? "?"}% · swap ${used.toFixed(0)}M/${tot.toFixed(0)}M (occupancy, not pressure) · pageouts ${rate !== null ? rate.toFixed(0) + "/s" : "?"}`);
if (reds.length) {
  // name the hog, so the RED is actionable rather than a complaint
  const ps = await sh(["/bin/ps", "axo", "rss=,comm="]);
  const top = ps.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && +p[0] > 0)
    .map((p) => ({ mb: +p[0] / 1024, cmd: p.slice(1).join(" ") })).sort((a, b) => b.mb - a.mb)[0];
  for (const r of reds) console.log(`  RED  ${r}`);
  if (top) console.log(`  RED  largest resident process: ${top.cmd.split("/").pop()} at ${top.mb.toFixed(0)}MB — check \`ollama ps\` first; a loaded model is the usual cause`);
  console.error(`  HOST BUDGET RED — the engine's host is degraded. An engine that costs the operator their machine is not free.`);
  Deno.exit(1);
}
console.log(`  HOST BUDGET GREEN — the host has headroom; the engine is not costing the operator their machine.`);
