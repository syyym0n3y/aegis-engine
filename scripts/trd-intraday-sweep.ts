#!/usr/bin/env -S deno run --allow-net
// trd-intraday-sweep — the INTRADAY session engine, starting with the sweep-reversal (ICT/TBR + Elder
// Santis CVD confirmation). On 1-minute data (where the money your group trades actually lives), detect
// liquidity-sweep reversals BOTH directions, tag every trade by SESSION (Asia/London/NY) and by whether
// CVD (cumulative-volume-delta, free from Binance taker-buy volume) CONFIRMS the reversal. Reports which
// session × direction × CVD-filter actually won — the intraday map daily bars are blind to.
//
// Sweep-short: price pokes ABOVE recent highs (grabs liquidity) then closes back below → sellers trap
// buyers. CVD-confirm: the sweep/reversal shows NON-positive delta (the up-poke had no real buying).

const LOOKBACK = 60;      // recent swing window (minutes) whose highs/lows are the "liquidity"
const RR = 2, MAXHOLD = 120, COST_R = 0.10, DAYS = 55;

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; delta: number; }
async function klines1m(sym: string, days: number): Promise<Bar[]> {
  const out: any[] = []; let endTime = Date.now(); const target = days * 1440;
  while (out.length < target) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break;
    out.unshift(...k); endTime = k[0][0] - 1; if (k.length < 1000) break;
  }
  const seen = new Set<number>(); const bars: Bar[] = [];
  for (const k of out) { if (seen.has(k[0])) continue; seen.add(k[0]); const v = +k[5], tb = +k[9]; bars.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v, delta: 2 * tb - v }); }
  return bars.sort((a, b) => a.t - b.t);
}
function session(t: number): string { const h = new Date(t).getUTCHours(); return h < 7 ? "Asia" : h < 13 ? "London" : h < 21 ? "NY" : "Asia-late"; }

interface T { r: number; side: string; session: string; cvdConfirm: boolean; }
function run(bars: Bar[]): T[] {
  const trades: T[] = []; let i = LOOKBACK + 1;
  while (i < bars.length - 1) {
    let hi = -Infinity, lo = Infinity; for (let j = i - LOOKBACK; j < i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
    const b = bars[i]; let side: "long" | "short" | null = null;
    if (b.h > hi && b.c < hi) side = "short";        // swept highs, closed back inside → short
    else if (b.l < lo && b.c > lo) side = "long";    // swept lows, closed back inside → long
    if (!side) { i++; continue; }
    const dir = side === "long" ? 1 : -1; const entry = b.c; const stop = side === "short" ? b.h : b.l;
    const risk = Math.abs(entry - stop); if (!(risk > 0)) { i++; continue; }
    const target = entry + dir * RR * risk; let r: number | null = null;
    for (let k = i + 1; k < Math.min(i + 1 + MAXHOLD, bars.length); k++) {
      if (dir === 1 ? bars[k].l <= stop : bars[k].h >= stop) { r = -1; break; }
      if (dir === 1 ? bars[k].h >= target : bars[k].l <= target) { r = RR; break; }
    }
    if (r === null) { const last = bars[Math.min(i + MAXHOLD, bars.length - 1)].c; r = dir * (last - entry) / risk; }
    const cvdConfirm = side === "short" ? b.delta <= 0 : b.delta >= 0;   // reversal bar's order-flow agrees
    trades.push({ r: r - COST_R, side, session: session(b.t), cvdConfirm });
    i = Math.min(i + 1 + MAXHOLD, i + 5);   // avoid immediate re-entry on the same structure
  }
  return trades;
}

const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const agg = (t: T[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}R/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/${t.length}` : "—";

for (const sym of ["BTCUSDT", "ETHUSDT"]) {
  console.log(`Pulling ${sym} 1m (~${DAYS}d)…`);
  const bars = await klines1m(sym, DAYS);
  if (bars.length < 5000) { console.log(`  too few bars (${bars.length})`); continue; }
  const t = run(bars);
  console.log(`\n════ ${sym} — intraday sweep-reversal (1m, ${bars.length} bars, ${new Date(bars[0].t).toISOString().slice(0, 10)}→${new Date(bars[bars.length - 1].t).toISOString().slice(0, 10)}) ════`);
  console.log(`  ALL: ${agg(t)}   |   RR=${RR}, stop=swept-extreme, cost ${COST_R}R`);
  for (const side of ["short", "long"]) {
    const ts = t.filter((x) => x.side === side);
    console.log(`  ${side.toUpperCase().padEnd(6)} all ${agg(ts)}  |  CVD-confirmed ${agg(ts.filter((x) => x.cvdConfirm))}  |  CVD-against ${agg(ts.filter((x) => !x.cvdConfirm))}`);
    console.log(`         by session:  Asia ${agg(ts.filter((x) => x.session === "Asia" || x.session === "Asia-late"))}   London ${agg(ts.filter((x) => x.session === "London"))}   NY ${agg(ts.filter((x) => x.session === "NY"))}`);
  }
}
console.log(`\nThis is the INTRADAY session map (vs daily-EOD, which was blind to it). CVD-confirmed = Elder Santis's`);
console.log(`order-flow filter. Next frameworks to add: Force Index / Elder-Ray / Triple Screen (Dr. A. Elder), Wyckoff spring/upthrust.`);
