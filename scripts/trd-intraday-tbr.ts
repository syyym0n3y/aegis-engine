#!/usr/bin/env -S deno run --allow-net
// trd-intraday-tbr — the GENERALIZED session-range engine (not just NY-TBR). Rauf's method — mark the
// session's opening range → wait for liquidity to be swept → enter the reversal → target the OPPOSING
// end, stop beyond the swept extreme — applied to EVERY session (Asia / London / NY) across EVERY
// market, with the condition FILTERS that separate the 2-3 clean days from the noise (selectivity =
// the real edge, per Rauf). Deep 1-minute data. Reports setup × session × market × condition → edge.
//
// This is the broad canvas: 24/7 global markets, every session, filtered. NY-TBR is one cell of it.

const MARKETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const DAYS = 90, MAXHOLD = 240, COST_R = 0.10;
// session (UTC): [rangeStartMin, rangeEndMin, tradeEndMin] — NY uses Rauf's 8:12-9:12 ET = 12:12-13:12 UTC, trade after 9:30ET=13:30
const SESSIONS: Record<string, [number, number, number]> = {
  Asia: [0, 60, 6 * 60],
  London: [7 * 60, 8 * 60, 12 * 60],
  NY: [12 * 60 + 12, 13 * 60 + 12, 19 * 60],
};
const NY_OPEN = 13 * 60 + 30; // 9:30 ET — NY trades only after the open

interface Bar { t: number; o: number; h: number; l: number; c: number; m: number; day: string; }
async function klines1m(sym: string, days: number): Promise<Bar[]> {
  const out: any[] = []; let endTime = Date.now(); const target = days * 1440;
  while (out.length < target) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
    out.unshift(...k); endTime = k[0][0] - 1; if (k.length < 1000) break;
  }
  const seen = new Set<number>(); const bars: Bar[] = [];
  for (const k of out) { if (seen.has(k[0])) continue; seen.add(k[0]); const d = new Date(k[0]); bars.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); }
  return bars.sort((a, b) => a.t - b.t);
}
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

interface T { r: number; side: string; session: string; market: string; hiVol: boolean; trendUp: boolean; }
function run(bars: Bar[], market: string): T[] {
  const trades: T[] = []; const byDay = new Map<string, Bar[]>();
  for (const b of bars) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b);
  const days = [...byDay.keys()].sort();
  const rangeSizes: number[] = [];
  for (const day of days) {
    const bs = byDay.get(day)!;
    for (const [sname, [rs, re, te]] of Object.entries(SESSIONS)) {
      const win = bs.filter((b) => b.m >= rs && b.m < re); if (win.length < 10) continue;
      const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l)); if (!(hi > lo)) continue;
      const rangePct = (hi - lo) / lo; rangeSizes.push(rangePct);
      const medRange = rangeSizes.length > 30 ? median(rangeSizes.slice(-200)) : rangePct;
      const openMin = sname === "NY" ? NY_OPEN : re;
      const after = bs.filter((b) => b.m >= openMin && b.m < te);
      // first sweep of the range with a close back inside (CISD)
      let side: "long" | "short" | null = null, k = 0, ext = 0;
      for (; k < after.length; k++) { if (after[k].h > hi) { side = "short"; ext = after[k].h; break; } if (after[k].l < lo) { side = "long"; ext = after[k].l; break; } }
      if (!side) continue;
      let cisd = -1; for (let j = k + 1; j < after.length; j++) { if (side === "short" && after[j].c < hi) { cisd = j; break; } if (side === "long" && after[j].c > lo) { cisd = j; break; } }
      if (cisd < 0 || cisd + 1 >= after.length) continue;
      const entry = after[cisd + 1].o, dir = side === "long" ? 1 : -1, stop = ext, target = side === "long" ? hi : lo;
      const risk = Math.abs(entry - stop); if (!(risk > 0) || (dir === 1 ? !(target > entry) : !(target < entry))) continue;
      let r: number | null = null;
      for (let j = cisd + 1; j < Math.min(cisd + 1 + MAXHOLD, after.length); j++) { const b = after[j]; if (dir === 1 ? b.l <= stop : b.h >= stop) { r = -1; break; } if (dir === 1 ? b.h >= target : b.l <= target) { r = (Math.abs(target - entry)) / risk; break; } }
      if (r === null) { const last = after[Math.min(cisd + MAXHOLD, after.length - 1)].c; r = dir * (last - entry) / risk; }
      // conditions: volatility (range vs its own trailing median), trend (range-end close vs prior 200min MA)
      const idxEnd = bs.findIndex((b) => b.m >= re); const maStart = Math.max(0, idxEnd - 200);
      const ma = bs.slice(maStart, idxEnd).reduce((s, b) => s + b.c, 0) / Math.max(1, idxEnd - maStart);
      trades.push({ r: r - COST_R, side, session: sname, market, hiVol: rangePct > medRange, trendUp: (win[win.length - 1]?.c ?? lo) > ma });
    }
  }
  return trades;
}

const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const agg = (t: T[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}R/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/${t.length}` : "—";
const all: T[] = [];
for (const m of MARKETS) { console.log(`Pulling ${m} 1m (~${DAYS}d)…`); const b = await klines1m(m, DAYS); if (b.length > 20000) all.push(...run(b, m)); }

console.log(`\n════ GENERALIZED SESSION-RANGE ENGINE — sweep→reversal→opposing-end, ${all.length} trades across ${MARKETS.length} markets ════`);
console.log(`ALL: ${agg(all)}\n`);
for (const s of ["Asia", "London", "NY"]) {
  const ss = all.filter((x) => x.session === s);
  console.log(`── ${s} session ──  all ${agg(ss)}`);
  console.log(`   short ${agg(ss.filter((x) => x.side === "short"))}   long ${agg(ss.filter((x) => x.side === "long"))}`);
  console.log(`   FILTERED  high-vol ${agg(ss.filter((x) => x.hiVol))}   short+downtrend ${agg(ss.filter((x) => x.side === "short" && !x.trendUp))}   long+uptrend ${agg(ss.filter((x) => x.side === "long" && x.trendUp))}`);
  console.log(`   BEST cell short+downtrend+hivol ${agg(ss.filter((x) => x.side === "short" && !x.trendUp && x.hiVol))}   long+uptrend+hivol ${agg(ss.filter((x) => x.side === "long" && x.trendUp && x.hiVol))}`);
}
console.log(`\n── by market (all sessions) ──`);
for (const m of MARKETS) console.log(`   ${m.padEnd(9)} ${agg(all.filter((x) => x.market === m))}   filtered(trend-aligned+hivol) ${agg(all.filter((x) => x.market === m && x.hiVol && ((x.side === "short" && !x.trendUp) || (x.side === "long" && x.trendUp))))}`);
console.log(`\nSELECTIVITY test: raw (every sweep) vs FILTERED (trend-aligned + high-vol only). Rauf's edge is the filter, not the sweep.`);
console.log(`FILTERED ALL: ${agg(all.filter((x) => x.hiVol && ((x.side === "short" && !x.trendUp) || (x.side === "long" && x.trendUp))))}`);
