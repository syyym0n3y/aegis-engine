#!/usr/bin/env -S deno run --allow-net
// trd-lead-oos-now — resolve the "waiting" leads on EXISTING deep history, TODAY, instead of forward-
// waiting months. Pulls years of BTC 15m klines (Binance, free, back to 2017) and runs the FROZEN
// btc-sweep-rr3 spec against the FULL grammar (4,320 specs) on that deep, out-of-window data. The honest
// question a forward test answers slowly, answered fast: is btc-sweep-rr3 a real edge, or just the max
// of 4,320 noisy trials? Deflated Sharpe with the EMPIRICAL trial-Sharpe variance (not an assumption),
// plus a chronological walk-forward on the frozen spec itself.

import { enumerate, runComponentTrades, specKey, type Bar, type ComponentSpec } from "../supabase/functions/_shared/trd-grammar.ts";
import { sharpe, deflatedSharpe, mean, sampleStd, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";

const COST_R = 0.05;                 // per-side, matches the frozen pre-reg cost
const PAGES = 130;                   // 130 × 1000 = 130k bars of 15m ≈ 3.7 years (Binance spot caps limit at 1000)
const FROZEN: ComponentSpec = { trigger: "sweep", emaPeriod: 20, trendMode: "with", stopLookback: 5, rr: 3, session: "all" };

async function klines(pages: number): Promise<Bar[]> {
  const out: any[] = []; let endTime = Date.now();
  for (let p = 0; p < pages; p++) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
    out.unshift(...k); endTime = k[0][0] - 1;
    if (k.length < 1000) break;
  }
  const seen = new Set<number>(); const bars: Bar[] = [];
  for (const k of out) { const t = k[0]; if (seen.has(t)) continue; seen.add(t); bars.push({ ts: new Date(t).toISOString(), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }); }
  bars.sort((a, b) => a.ts < b.ts ? -1 : 1);
  return bars;
}

console.log("Pulling deep BTC 15m history from Binance…");
const bars = await klines(PAGES);
console.log(`Got ${bars.length} bars, ${bars[0]?.ts.slice(0, 10)} → ${bars[bars.length - 1]?.ts.slice(0, 10)}.\n`);

// ---- run the WHOLE grammar on this deep data ----
const specs = enumerate();
const rows = specs.map((s) => {
  const tr = runComponentTrades(bars, s, { costRPerSide: COST_R });
  const rs = tr.map((t) => t.r);
  return { key: specKey(s), n: rs.length, exp: rs.length ? mean(rs) : 0, sh: rs.length >= 2 ? sharpe(rs) : 0, rs };
});
const MINN = 30;
const usable = rows.filter((r) => r.n >= MINN);
const trialSh = usable.map((r) => r.sh);
const varTrial = sampleStd(trialSh) ** 2;               // EMPIRICAL trial-Sharpe variance (the deflation input)
usable.sort((a, b) => b.sh - a.sh);

const frozenKey = specKey(FROZEN);
const frozen = rows.find((r) => r.key === frozenKey)!;
const rankByExp = [...usable].sort((a, b) => b.exp - a.exp).findIndex((r) => r.key === frozenKey) + 1;
const rankBySh = usable.findIndex((r) => r.key === frozenKey) + 1;

console.log(`Grammar: ${specs.length} specs, ${usable.length} with n≥${MINN} trades on this data.`);
console.log(`\n── Top 6 specs by per-trade Sharpe (deep BTC 15m, ~4y) ──`);
for (const r of usable.slice(0, 6)) console.log(`  ${r.key.padEnd(34)} n=${String(r.n).padStart(4)}  exp=${r.exp >= 0 ? "+" : ""}${r.exp.toFixed(3)}R  Sharpe=${r.sh.toFixed(3)}${r.key === frozenKey ? "   ← FROZEN LEAD" : ""}`);

console.log(`\n════ FROZEN LEAD  btc-sweep-rr3  (${frozenKey}) ════`);
console.log(`  trades on ~4y deep data (N):     ${frozen.n}`);
console.log(`  per-trade expectancy:            ${frozen.exp >= 0 ? "+" : ""}${frozen.exp.toFixed(3)}R`);
console.log(`  per-trade Sharpe:                ${frozen.sh.toFixed(3)}`);
console.log(`  rank among ${usable.length} usable specs:     #${rankBySh} by Sharpe · #${rankByExp} by expectancy`);
const dsr = deflatedSharpe(frozen.sh, frozen.n, 0, 3, usable.length, varTrial);
console.log(`  Deflated Sharpe (N_trials=${usable.length}):   ${(dsr * 100).toFixed(1)}%   ${dsr > 0.95 ? "✓ clears 0.95" : "✗ FAILS the 0.95 gate"}`);

// ---- chronological walk-forward on the frozen spec: is it stable across time, or one lucky era? ----
const K = 5; const seg = Math.floor(frozen.rs.length / K);
console.log(`\n  Walk-forward (${K} equal chronological blocks of the frozen spec's trades):`);
if (seg >= 5) {
  for (let i = 0; i < K; i++) { const s = frozen.rs.slice(i * seg, i === K - 1 ? undefined : (i + 1) * seg); console.log(`    block ${i + 1}: n=${s.length}  exp=${mean(s) >= 0 ? "+" : ""}${mean(s).toFixed(3)}R  Sharpe=${sharpe(s).toFixed(2)}`); }
  const half = Math.floor(frozen.rs.length / 2);
  const firstExp = mean(frozen.rs.slice(0, half)), lastExp = mean(frozen.rs.slice(half));
  console.log(`    first-half exp ${firstExp >= 0 ? "+" : ""}${firstExp.toFixed(3)}R → last-half exp ${lastExp >= 0 ? "+" : ""}${lastExp.toFixed(3)}R  (${lastExp < 0 ? "DECAYED to negative" : lastExp < firstExp ? "decaying" : "holding"})`);
} else console.log(`    too few trades to block.`);

console.log(`\nVERDICT basis: a real edge is stable across blocks AND clears deflation vs the ${usable.length}-spec search.`);
console.log(`This is the answer from EXISTING data — no waiting. Forward-testing only re-confirms; it should never be the bottleneck.`);
