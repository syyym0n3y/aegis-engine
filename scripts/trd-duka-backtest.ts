#!/usr/bin/env -S deno run --allow-read
// trd-duka-backtest — DEEP intraday backtest on FREE Dukascopy 1-min INDEX data (S&P500 usa500idxusd,
// Nasdaq100 usatechidxusd), ~16y (2010→2026). The NY-TBR sweep→reversal→opposing-end BOTH directions,
// session-tagged, IS/OOS. This is the real instruments (ES/NQ proxies) at the real timeframe over 16y —
// the gap that "needed paid data" until a search found Dukascopy. Per ANALYSIS_CONTRACT: numbers + N + OOS.
// Reads CSVs from data/duka/ (timestamp_ms,open,high,low,close).

const DIR = "data/duka";
const COST_R = 0.10, MAXHOLD = 240;
interface Bar { t: number; o: number; h: number; l: number; c: number; m: number; day: string; }
async function load(prefix: string): Promise<Bar[]> {
  const bars: Bar[] = []; const seen = new Set<number>();
  for await (const e of Deno.readDir(DIR)) {
    if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue;
    const txt = await Deno.readTextFile(`${DIR}/${e.name}`);
    for (const line of txt.split("\n")) { const p = line.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12) continue; if (seen.has(t)) continue; seen.add(t); const d = new Date(t); bars.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: new Date(t - 4 * 3600000).toISOString().slice(0, 10) }); }
  }
  return bars.sort((a, b) => a.t - b.t);
}
// NY-TBR: 8:12-9:12 ET = 12:12-13:12 UTC (EDT); trade after 9:30ET=13:30UTC=810 until 16:00ET=20:00UTC=1200
function tbr(bars: Bar[]): { r: number; side: string }[] {
  const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b);
  const out: { r: number; side: string }[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const bs = byDay.get(day)!;
    const win = bs.filter((b) => b.m >= 732 && b.m < 792); if (win.length < 10) continue;
    const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l)); if (!(hi > lo)) continue;
    const after = bs.filter((b) => b.m >= 810 && b.m < 1200);
    let side: "long" | "short" | null = null, k = 0, ext = 0;
    for (; k < after.length; k++) { if (after[k].h > hi) { side = "short"; ext = after[k].h; break; } if (after[k].l < lo) { side = "long"; ext = after[k].l; break; } }
    if (!side) continue;
    let cisd = -1; for (let j = k + 1; j < after.length; j++) { if (side === "short" && after[j].c < hi) { cisd = j; break; } if (side === "long" && after[j].c > lo) { cisd = j; break; } }
    if (cisd < 0 || cisd + 1 >= after.length) continue;
    const entry = after[cisd + 1].o, dir = side === "long" ? 1 : -1, stop = ext, target = side === "long" ? hi : lo, risk = Math.abs(entry - stop);
    if (!(risk > 0) || (dir === 1 ? !(target > entry) : !(target < entry))) continue;
    let r: number | null = null;
    for (let j = cisd + 1; j < Math.min(cisd + 1 + MAXHOLD, after.length); j++) { const b = after[j]; if (dir === 1 ? b.l <= stop : b.h >= stop) { r = -1; break; } if (dir === 1 ? b.h >= target : b.l <= target) { r = Math.abs(target - entry) / risk; break; } }
    if (r === null) { const last = after[Math.min(cisd + MAXHOLD, after.length - 1)].c; r = dir * (last - entry) / risk; }
    out.push({ r: r - COST_R, side });
  }
  return out;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const agg = (t: { r: number }[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}R/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/n=${t.length}${t.length < 100 ? " [small-N]" : ""}` : "—";

for (const [name, prefix] of [["S&P500 (ES proxy)", "usa500idxusd"], ["Nasdaq100 (NQ proxy)", "usatechidxusd"]]) {
  const bars = await load(prefix);
  if (bars.length < 5000) { console.log(`${name}: only ${bars.length} bars — pull still running or missing`); continue; }
  const t = tbr(bars); const k = Math.floor(t.length * 0.6);
  console.log(`\n════ ${name} — NY-TBR sweep-reversal, 1m Dukascopy, ${bars.length} bars, ${bars[0].day}→${bars[bars.length - 1].day} ════`);
  console.log(`  ALL: ${agg(t)}   |  IS ${agg(t.slice(0, k))} → OOS ${agg(t.slice(k))}`);
  console.log(`  SHORT ${agg(t.filter((x) => x.side === "short"))}   LONG ${agg(t.filter((x) => x.side === "long"))}`);
}
console.log(`\nDeep intraday on the REAL instruments (index = ES/NQ proxy), ~16y, FREE (Dukascopy). Numbers only per ANALYSIS_CONTRACT.`);
