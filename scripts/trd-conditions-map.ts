#!/usr/bin/env -S deno run --allow-net
// trd-conditions-map — the operator's ask: which SETUPS won in which CONDITIONS, across every instrument
// and all history we can ingest, accounting for cyclic context. Fires each setup UNCONDITIONALLY, tags
// every trade with its market condition (VIX regime, trend, day-of-week, month), then aggregates
// expectancy by condition → the lookup of "which setup is suitable for which regime". 5-day forward
// horizon, 2×ATR stop (uniform, so setups are comparable). Free Yahoo daily.

import { rsi, atr, type Bar } from "../supabase/functions/_shared/trd-meanrev.ts";
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const UNIVERSE = ["SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV", "XLU", "XLI", "XLP", "XLY", "XLB", "SMH", "XBI", "EEM", "EFA", "FXI", "EWZ", "GLD", "SLV", "USO", "DBC", "TLT", "HYG", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", "BTC-USD", "ETH-USD"];
const HORIZON = 5, STOP_ATR = 2, ATRP = 10;
type XBar = Bar & { ts: number };
async function bars(sym: string): Promise<XBar[]> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 4200 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: any[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c, ts: t[i] }); }
  return out;
}
const sma = (cl: number[], i: number, n: number) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += cl[k]; return s / n; };
const vixBars = await bars("^VIX"); const vix = new Map<string, number>(); for (const b of vixBars) vix.set(b.d, (b as any).c);

// setups: name → (bars, i) → side | null  (fires on bar i's close)
type Side = "long" | "short" | null;
const SETUPS: Record<string, (b: any[], r2: number[], cl: number[], i: number) => Side> = {
  "rsi2-long (oversold)": (b, r2, cl, i) => r2[i] < 10 ? "long" : null,
  "rsi2-short (overbought)": (b, r2, cl, i) => r2[i] > 90 ? "short" : null,
  "breakout-long (20d high)": (b, r2, cl, i) => cl[i] > Math.max(...b.slice(i - 20, i).map((x: any) => x.h)) ? "long" : null,
  "breakdown-short (20d low)": (b, r2, cl, i) => cl[i] < Math.min(...b.slice(i - 20, i).map((x: any) => x.l)) ? "short" : null,
  "dip-buy (RSI<30 >200MA)": (b, r2, cl, i) => (r2[i] < 30 && cl[i] > sma(cl, i, 200)) ? "long" : null,
};
interface T { r: number; vix: number; up: boolean; dow: number; mon: number }
const trades: Record<string, T[]> = {}; for (const k of Object.keys(SETUPS)) trades[k] = [];

for (const sym of UNIVERSE) {
  const b = await bars(sym); if (b.length < 260) continue;
  const cl = b.map((x) => x.c); const r2 = rsi(cl, 2); const at = atr(b as Bar[], ATRP);
  for (let i = 220; i < b.length - HORIZON - 1; i++) {
    if (!(at[i] > 0)) continue; const ma = sma(cl, i, 200); if (!(ma > 0)) continue;
    const v = vix.get(b[i].d) ?? 15; const dt = new Date(b[i].ts * 1000);
    for (const [name, fn] of Object.entries(SETUPS)) {
      const side = fn(b, r2, cl, i); if (!side) continue;
      const dir = side === "long" ? 1 : -1; const entry = b[i + 1].o; const stop = entry - dir * STOP_ATR * at[i]; let r: number | null = null;
      for (let k = i + 1; k <= i + HORIZON; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } }
      if (r === null) r = dir * (b[i + HORIZON].c - entry) / (STOP_ATR * at[i]);
      trades[name].push({ r: r - 0.05, vix: v, up: cl[i] > ma, dow: dt.getUTCDay(), mon: dt.getUTCMonth() + 1 });
    }
  }
}

const agg = (t: T[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}R/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/${t.length}` : "—";
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
console.log(`CONDITIONS MAP — expectancy(R) / win% / N, per setup × condition. ${UNIVERSE.length} instruments, ~11y, 5d horizon, 2ATR stop.\n`);
for (const [name, t] of Object.entries(trades)) {
  console.log(`══ ${name}  [ALL: ${agg(t)}] ══`);
  console.log(`   VIX:  calm<15 ${agg(t.filter((x) => x.vix < 15))}   normal15-25 ${agg(t.filter((x) => x.vix >= 15 && x.vix < 25))}   STRESS>25 ${agg(t.filter((x) => x.vix >= 25))}`);
  console.log(`   trend: aboveMA ${agg(t.filter((x) => x.up))}   belowMA ${agg(t.filter((x) => !x.up))}`);
  console.log(`   day:  ` + [1, 2, 3, 4, 5].map((d) => `${["", "Mon", "Tue", "Wed", "Thu", "Fri"][d]} ${agg(t.filter((x) => x.dow === d))}`).join("  "));
  const best = [...Array(12)].map((_, m) => ({ m: m + 1, e: t.filter((x) => x.mon === m + 1).length ? mean(t.filter((x) => x.mon === m + 1).map((x) => x.r)) : -9 })).sort((a, b) => b.e - a.e);
  console.log(`   season: best ${MON[best[0].m]} (${best[0].e >= 0 ? "+" : ""}${best[0].e.toFixed(3)}R)  worst ${MON[best[11].m]} (${best[11].e.toFixed(3)}R)\n`);
}
console.log(`READ: this is the "which setup for which condition" lookup. Mean-reversion should light up in STRESS/high-VIX;`);
console.log(`breakout/trend in aboveMA/low-VIX. The cyclic (day/season) rows are the calendar edges. Forward test confirms live.`);
