#!/usr/bin/env -S deno run --allow-net
// trd-tbr-backtest — the HONEST test of Rauf / Time Based Academy's "New York Time Based Range".
// Exact mechanics from the operator's screenshots:
//   1. Range = high/low of the 8:12–9:12 AM NY window (before the 9:30 cash open).
//   2. Wait for 9:30. 3. Wait for liquidity to be TAKEN (price sweeps TBR high or low).
//   4. Delivery shift (CISD): price closes back inside the range against the sweep.
//   5. Enter next bar; target the OPPOSING end of the range; stop beyond the swept extreme.
// One setup/day. Costs charged. Out-of-sample split. Verdict is REJECT-by-default per Aegis doctrine.
// NOTE: this is intraday-only (Yahoo 5m ≤ 60d) so n is small — the result is a lead, not a proof.

const NY_OFFSET_H = 4; // EDT (Jun–Aug 2026). NY wall-clock = UTC − 4h.
const TBR_START = 8 * 60 + 12, TBR_END = 9 * 60 + 12, OPEN = 9 * 60 + 30, DAY_END = 16 * 60;
const COST_R = 0.05;

interface Bar { t: number; o: number; h: number; l: number; c: number; nyDate: string; nyMin: number; }
async function bars5m(sym: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=60d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue;
    const ny = new Date((t[i] - NY_OFFSET_H * 3600) * 1000);
    out.push({ t: t[i], o, h, l, c, nyDate: ny.toISOString().slice(0, 10), nyMin: ny.getUTCHours() * 60 + ny.getUTCMinutes() });
  }
  return out;
}

interface Trade { day: string; side: "long" | "short"; r: number; reason: string; }
function backtestTBR(bars: Bar[]): Trade[] {
  const byDay = new Map<string, Bar[]>();
  for (const b of bars) (byDay.get(b.nyDate) ?? byDay.set(b.nyDate, []).get(b.nyDate)!).push(b);
  const trades: Trade[] = [];
  for (const [day, bs] of byDay) {
    bs.sort((a, b) => a.t - b.t);
    const win = bs.filter((b) => b.nyMin >= TBR_START && b.nyMin < TBR_END);
    if (win.length < 3) continue;
    const hi = Math.max(...win.map((b) => b.h)), lo = Math.min(...win.map((b) => b.l));
    if (!(hi > lo)) continue;
    const after = bs.filter((b) => b.nyMin >= OPEN && b.nyMin < DAY_END);
    // find first sweep of either side
    let swept: "hi" | "lo" | null = null, sweepExtreme = 0, k = 0;
    for (; k < after.length; k++) { if (after[k].h > hi) { swept = "hi"; sweepExtreme = after[k].h; break; } if (after[k].l < lo) { swept = "lo"; sweepExtreme = after[k].l; break; } }
    if (!swept) continue;
    // after the sweep, wait for CISD: a bar that closes back inside the range against the sweep
    let cisd = -1;
    for (let m = k + 1; m < after.length; m++) {
      if (swept === "lo" && after[m].c > lo) { cisd = m; break; }
      if (swept === "hi" && after[m].c < hi) { cisd = m; break; }
    }
    if (cisd < 0 || cisd + 1 >= after.length) continue;
    // enter next bar open; target opposite end; stop beyond swept extreme
    const entryBar = after[cisd + 1]; const entry = entryBar.o;
    const side: "long" | "short" = swept === "lo" ? "long" : "short";
    const stop = swept === "lo" ? sweepExtreme : sweepExtreme; // the swept extreme
    const target = swept === "lo" ? hi : lo;
    const risk = Math.abs(entry - stop); if (!(risk > 0)) continue;
    if (side === "long" && !(target > entry && stop < entry)) continue;
    if (side === "short" && !(target < entry && stop > entry)) continue;
    // simulate forward from entryBar onward
    let r: number | null = null, reason = "timeout";
    for (let m = cisd + 1; m < after.length; m++) {
      const b = after[m];
      if (side === "long") { if (b.l <= stop) { r = -1; reason = "stop"; break; } if (b.h >= target) { r = (target - entry) / risk; reason = "target"; break; } }
      else { if (b.h >= stop) { r = -1; reason = "stop"; break; } if (b.l <= target) { r = (entry - target) / risk; reason = "target"; break; } }
    }
    if (r === null) { const last = after[after.length - 1].c; r = ((side === "long" ? last - entry : entry - last) / risk); reason = "eod"; }
    trades.push({ day, side, r: r - 2 * COST_R, reason });
  }
  return trades;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

for (const [name, sym] of [["S&P (ES)", "ES=F"], ["Nasdaq (NQ)", "NQ=F"], ["Gold", "GC=F"]] as [string, string][]) {
  const bs = await bars5m(sym);
  const tr = backtestTBR(bs);
  if (tr.length < 8) { console.log(`\n${name}: ${tr.length} setups (too few / no 5m data)`); continue; }
  const rs = tr.map((t) => t.r); const wr = tr.filter((t) => t.r > 0).length / tr.length;
  const mu = mean(rs), sd = std(rs) || 1, tstat = mu / (sd / Math.sqrt(rs.length));
  const mid = Math.floor(tr.length * 0.6); const tr1 = rs.slice(0, mid), tr2 = rs.slice(mid);
  console.log(`\n══ ${name} — TBR sweep-reversal, ${tr.length} setups over ~60d ══`);
  console.log(`  win rate ${(wr * 100).toFixed(0)}% | expectancy ${mu >= 0 ? "+" : ""}${mu.toFixed(3)}R | total ${rs.reduce((a, b) => a + b, 0).toFixed(1)}R | t-stat ${tstat.toFixed(2)}`);
  console.log(`  OOS: train ${mean(tr1) >= 0 ? "+" : ""}${mean(tr1).toFixed(3)}R (n=${tr1.length}) | test ${mean(tr2) >= 0 ? "+" : ""}${mean(tr2).toFixed(3)}R (n=${tr2.length})`);
  const exits = tr.reduce((a: any, t) => (a[t.reason] = (a[t.reason] || 0) + 1, a), {});
  console.log(`  exits: ${Object.entries(exits).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  VERDICT: ${mu > 0 && tstat > 2 && mean(tr1) > 0 && mean(tr2) > 0 ? "SURVIVES first pass — pre-register + forward test" : "no significant net edge (n small; treat as lead not proof)"}`);
}
console.log(`\nHonest note: intraday 5m is capped at ~60 days on free data, so n≈40-60 setups — far below what proves a`);
console.log(`multi-condition edge. This tests the MECHANICS faithfully; a real verdict needs a pre-registered forward run.`);
