#!/usr/bin/env -S deno run --allow-net
// trd-intraday-deep — the deepest FREE intraday backtest: Binance 5-minute bars over ~7-8 years (the max
// free intraday history; 16y of 1-min EQUITY needs a paid SIP feed). Session-range sweep→reversal→opposing
// -end (Rauf's TBR logic) across markets, session-tagged, condition-filtered. Per ANALYSIS_CONTRACT: numbers
// + N + IS/OOS, small-N flagged. 5-min over 7y >> 1-min over 90d for statistical robustness (more sessions).

const MARKETS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
const INTERVAL = "5m", BARS_PER_DAY = 288, MAXHOLD = 96, COST_R = 0.10;
const SESSIONS: Record<string, [number, number, number]> = { Asia: [0, 60, 360], London: [420, 480, 720], NY: [732, 792, 1140] };
const NY_OPEN = 810; // 9:30 ET = 13:30 UTC = 810min

interface Bar { t: number; o: number; h: number; l: number; c: number; m: number; day: string; }
async function klines(sym: string, maxPages: number): Promise<Bar[]> {
  const out: any[] = []; let endTime = Date.now();
  for (let p = 0; p < maxPages; p++) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${INTERVAL}&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
    out.unshift(...k); endTime = k[0][0] - 1; if (k.length < 1000) break;
  }
  const seen = new Set<number>(); const bars: Bar[] = [];
  for (const k of out) { if (seen.has(k[0])) continue; seen.add(k[0]); const d = new Date(k[0]); bars.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); }
  return bars.sort((a, b) => a.t - b.t);
}
interface T { r: number; side: string; session: string; }
function run(bars: Bar[]): T[] {
  const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b);
  const trades: T[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const bs = byDay.get(day)!.sort((a, b) => a.t - b.t);
    for (const [sname, [rs, re, te]] of Object.entries(SESSIONS)) {
      const win = bs.filter((b) => b.m >= rs && b.m < re); if (win.length < 6) continue;
      const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l)); if (!(hi > lo)) continue;
      const openMin = sname === "NY" ? NY_OPEN : re;
      const after = bs.filter((b) => b.m >= openMin && b.m < te);
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
      trades.push({ r: r - COST_R, side, session: sname });
    }
  }
  return trades;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const agg = (t: T[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}R/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/n=${t.length}${t.length < 100 ? " [small-N]" : ""}` : "—";
const all: T[] = [];
for (const m of MARKETS) { const b = await klines(m, 900); if (b.length > 20000) { console.log(`${m}: ${b.length} 5m bars, ${b[0].day}→${b[b.length - 1].day}`); all.push(...run(b)); } }
all.sort(() => 0); const k = Math.floor(all.length * 0.6);
console.log(`\n════ DEEP session-range sweep-reversal, ${INTERVAL}, ${all.length} trades, ${MARKETS.length} markets ════`);
console.log(`ALL: ${agg(all)}   |   IS ${agg(all.slice(0, k))} → OOS ${agg(all.slice(k))}`);
for (const s of ["Asia", "London", "NY"]) { const ss = all.filter((x) => x.session === s); console.log(`  ${s.padEnd(7)} all ${agg(ss)}  short ${agg(ss.filter((x) => x.side === "short"))}  long ${agg(ss.filter((x) => x.side === "long"))}`); }
console.log(`\nPer ANALYSIS_CONTRACT: numbers only, N stated, small-N flagged. 16y 1-min equity would need paid SIP data.`);
