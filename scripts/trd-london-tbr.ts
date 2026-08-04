#!/usr/bin/env -S deno run --allow-net
// trd-london-tbr — the LONDON-session Time Based Range on ES/NQ, applied MECHANICALLY to recent real
// data (no hindsight). Range = 07:00-08:00 London (06:00-07:00 UTC, EDT). After 08:00 London wait for
// a sweep of the range, then a CISD reversal back inside → enter next bar, target the OPPOSING end,
// stop beyond the swept extreme, exit by 13:00 London. One trade/session. Shows entry/exit per day +
// the honest tally. (NOTE: this is the London variant; the NY variant LOST on ES/NQ — D-088.)

const RANGE_START = 8 * 60 + 12, RANGE_END = 9 * 60 + 12, OPEN = 9 * 60 + 12, DAY_END = 13 * 60; // 08:12-09:12 UTC range, trade after, exit by 13:00 UTC
const COST_R = 0.05;
interface Bar { t: number; o: number; h: number; l: number; c: number; d: string; m: number; iso: string; }
async function bars5m(sym: string): Promise<Bar[]> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 59 * 86400; // full 60-day 5m window (Yahoo's cap)
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; const dt = new Date(t[i] * 1000); out.push({ t: t[i], o, h, l, c, d: dt.toISOString().slice(0, 10), m: dt.getUTCHours() * 60 + dt.getUTCMinutes(), iso: dt.toISOString().slice(11, 16) }); }
  return out;
}
const hhmm = (b: Bar) => b.iso + "Z";

for (const [name, sym] of [["ES", "ES=F"], ["NQ", "NQ=F"]] as [string, string][]) {
  const bars = await bars5m(sym);
  const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.d) ?? byDay.set(b.d, []).get(b.d)!).push(b);
  const days = [...byDay.keys()].sort().filter((d) => new Date(d + "T00:00:00Z").getUTCDay() === 1); // MONDAYS only
  console.log(`\n══════ ${name} (${sym}) — London TBR (08:12-09:12 UTC), MONDAYS only, ${days.length} sessions ══════`);
  const results: number[] = [];
  for (const day of days) {
    const bs = byDay.get(day)!.sort((a, b) => a.t - b.t);
    const win = bs.filter((b) => b.m >= RANGE_START && b.m < RANGE_END); if (win.length < 3) continue;
    const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l)); if (!(hi > lo)) continue;
    const after = bs.filter((b) => b.m >= OPEN && b.m < DAY_END);
    let swept: "hi" | "lo" | null = null, ext = 0, k = 0, sweepBar: Bar | null = null;
    for (; k < after.length; k++) { if (after[k].h > hi) { swept = "hi"; ext = after[k].h; sweepBar = after[k]; break; } if (after[k].l < lo) { swept = "lo"; ext = after[k].l; sweepBar = after[k]; break; } }
    if (!swept) { console.log(`  ${day}: range [${lo.toFixed(1)}–${hi.toFixed(1)}] — no sweep, no trade`); continue; }
    let cisd = -1; for (let m = k + 1; m < after.length; m++) { if (swept === "lo" && after[m].c > lo) { cisd = m; break; } if (swept === "hi" && after[m].c < hi) { cisd = m; break; } }
    if (cisd < 0 || cisd + 1 >= after.length) { console.log(`  ${day}: swept ${swept} @${hhmm(sweepBar!)} but no CISD reversal — no trade`); continue; }
    const entryBar = after[cisd + 1]; const entry = entryBar.o; const side = swept === "lo" ? "LONG" : "SHORT";
    const stop = ext, target = swept === "lo" ? hi : lo, risk = Math.abs(entry - stop);
    if (!(risk > 0) || (side === "LONG" && !(target > entry && stop < entry)) || (side === "SHORT" && !(target < entry && stop > entry))) { console.log(`  ${day}: geometry invalid — no trade`); continue; }
    let r: number | null = null, exitBar: Bar | null = null, reason = "EOD";
    for (let m = cisd + 1; m < after.length; m++) { const b = after[m]; if (side === "LONG") { if (b.l <= stop) { r = -1; reason = "stop"; exitBar = b; break; } if (b.h >= target) { r = (target - entry) / risk; reason = "target"; exitBar = b; break; } } else { if (b.h >= stop) { r = -1; reason = "stop"; exitBar = b; break; } if (b.l <= target) { r = (entry - target) / risk; reason = "target"; exitBar = b; break; } } }
    if (r === null) { exitBar = after[after.length - 1]; const last = exitBar.c; r = (side === "LONG" ? last - entry : entry - last) / risk; }
    const rn = r - 2 * COST_R; results.push(rn);
    console.log(`  ${day}: range [${lo.toFixed(1)}–${hi.toFixed(1)}] | swept ${swept} @${hhmm(sweepBar!)} | ${side} entry ${entry.toFixed(1)} @${hhmm(entryBar)} | ${reason} exit ${(reason === "target" ? target : reason === "stop" ? stop : exitBar!.c).toFixed(1)} @${hhmm(exitBar!)} | ${rn >= 0 ? "+" : ""}${rn.toFixed(2)}R`);
  }
  const wins = results.filter((x) => x > 0).length;
  console.log(`  ── ${name} tally: ${results.length} trades, ${wins}W/${results.length - wins}L (${results.length ? (wins / results.length * 100).toFixed(0) : 0}%), total ${results.reduce((a, b) => a + b, 0).toFixed(2)}R, avg ${results.length ? (results.reduce((a, b) => a + b, 0) / results.length).toFixed(3) : 0}R`);
}
console.log(`\nHonest note: ~10 sessions is ANECDOTE, not edge — real-time rules shown (no hindsight). The NY variant`);
console.log(`LOST on ES/NQ over 60 days (D-088). A positive small sample here means "worth forward-testing", never "proven".`);
