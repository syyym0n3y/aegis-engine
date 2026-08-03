// trd-liquidity-grab — a FAITHFUL, mechanical implementation of the Pranam Ghagare / trendwisdom
// "XAU 15m liquidity-grab" strategy (the Instagram carousel), so Aegis can test the 76.53%-win
// claim honestly instead of taking it on faith. Rules, verbatim from the 8 slides:
//   • 30 EMA trend filter: price > EMA → longs only; price < EMA → shorts only.
//   • Auto S/R = pivot highs/lows with Left=1, Right=1 (LuxAlgo "S/R with Breaks", the 15→1 knob).
//   • LONG liquidity grab: a candle trades BELOW an active support (pivot low) but CLOSES back
//     above it (stops below the level are swept, then price resumes the uptrend).
//   • Enter on the BREAK of that grab candle's HIGH; stop-loss at the grab candle LOW; target 1:1.
//   • SHORT is the mirror (break above resistance, close back below; enter on break of the low).
// No look-ahead: entry is a resting STOP order at a price known when the grab candle closed; fills
// only if a LATER bar trades through it. Costs are applied pessimistically (spread+slippage+comm),
// because a 1:1 target is exactly where costs do the most damage — the whole point of the test.

export interface Bar { ts: string; open: number; high: number; low: number; close: number; }

export interface LGConfig {
  emaPeriod: number; // 30
  pivotLeft: number; // 1
  pivotRight: number; // 1
  rr: number; // 1  (target = rr × risk)
  entryValidBars: number; // how many bars the resting stop-entry stays live (else cancelled)
  levelStaleBars: number; // an S/R level older than this is no longer "recent liquidity"
  costPerSideUsd: number; // $/oz all-in per side (half-spread + slippage + commission)
}

export const DEFAULT_LG: LGConfig = { emaPeriod: 30, pivotLeft: 1, pivotRight: 1, rr: 1, entryValidBars: 3, levelStaleBars: 96, costPerSideUsd: 0.25 };

export interface LGTrade { side: "long" | "short"; grabTs: string; entryTs: string; entry: number; stop: number; target: number; exitTs: string; exit: number; r: number; win: boolean; reason: "target" | "stop" | "timeout"; }

export function ema(vals: number[], period: number): number[] {
  const out: number[] = []; const k = 2 / (period + 1); let prev = vals[0];
  for (let i = 0; i < vals.length; i++) { prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}

// Confirmed pivots. A pivot low at index i needs `left` lower-bounding bars before and `right`
// after (so it is only KNOWN at i+right — we return it stamped with its confirmation index).
interface Pivot { idx: number; confirmAt: number; price: number; kind: "support" | "resistance"; }
export function pivots(bars: Bar[], left: number, right: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < bars.length - right; i++) {
    let isLow = true, isHigh = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].low <= bars[i].low) isLow = false;
      if (bars[j].high >= bars[i].high) isHigh = false;
    }
    if (isLow) out.push({ idx: i, confirmAt: i + right, price: bars[i].low, kind: "support" });
    if (isHigh) out.push({ idx: i, confirmAt: i + right, price: bars[i].high, kind: "resistance" });
  }
  return out;
}

/**
 * Run the strategy over bars. Pure + point-in-time: at bar i we only use info known by close of i.
 * One position at a time (as a retail trader would run it). Returns the trade list.
 */
export function backtestLiquidityGrab(bars: Bar[], cfg: LGConfig = DEFAULT_LG): LGTrade[] {
  const n = bars.length; if (n < cfg.emaPeriod + 5) return [];
  const closes = bars.map((b) => b.close);
  const e = ema(closes, cfg.emaPeriod);
  const piv = pivots(bars, cfg.pivotLeft, cfg.pivotRight);
  // index pivots by the bar at which they become known
  const pivByConfirm = new Map<number, Pivot[]>();
  for (const p of piv) (pivByConfirm.get(p.confirmAt) ?? pivByConfirm.set(p.confirmAt, []).get(p.confirmAt)!).push(p);

  const activeSupports: { price: number; bornAt: number }[] = [];
  const activeResistances: { price: number; bornAt: number }[] = [];
  const trades: LGTrade[] = [];
  // a pending resting entry (stop order) or an open position
  let pending: { side: "long" | "short"; grabTs: string; trigger: number; stop: number; born: number } | null = null;
  let open: { side: "long" | "short"; grabTs: string; entryTs: string; entry: number; stop: number; target: number } | null = null;

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    // 1) manage an OPEN position first (exits resolved on this bar)
    if (open) {
      let exit: number | null = null, reason: LGTrade["reason"] | null = null;
      if (open.side === "long") {
        if (bar.low <= open.stop) { exit = open.stop; reason = "stop"; } // conservative: stop first
        else if (bar.high >= open.target) { exit = open.target; reason = "target"; }
      } else {
        if (bar.high >= open.stop) { exit = open.stop; reason = "stop"; }
        else if (bar.low <= open.target) { exit = open.target; reason = "target"; }
      }
      if (exit !== null && reason !== null) {
        const dir = open.side === "long" ? 1 : -1;
        const gross = (exit - open.entry) * dir;
        const risk = Math.abs(open.entry - open.stop);
        const net = gross - 2 * cfg.costPerSideUsd; // entry + exit cost
        const r = risk > 0 ? net / risk : 0;
        trades.push({ side: open.side, grabTs: open.grabTs, entryTs: open.entryTs, entry: open.entry, stop: open.stop, target: open.target, exitTs: bar.ts, exit, r, win: r > 0, reason });
        open = null;
      }
    }
    // 2) try to FILL a pending resting stop-entry (only if flat)
    if (!open && pending) {
      if (i - pending.born > cfg.entryValidBars) { pending = null; }
      else {
        const dir = pending.side === "long" ? 1 : -1;
        const filled = pending.side === "long" ? bar.high >= pending.trigger : bar.low <= pending.trigger;
        if (filled) {
          // realistic fill: at the trigger (+ slippage folded into costPerSide), not a better price
          const entry = pending.trigger;
          const risk = Math.abs(entry - pending.stop);
          const target = entry + dir * cfg.rr * risk;
          open = { side: pending.side, grabTs: pending.grabTs, entryTs: bar.ts, entry, stop: pending.stop, target };
          pending = null;
        }
      }
    }
    // 3) register newly-confirmed pivots as active liquidity levels
    for (const p of pivByConfirm.get(i) ?? []) {
      if (p.kind === "support") activeSupports.push({ price: p.price, bornAt: p.idx });
      else activeResistances.push({ price: p.price, bornAt: p.idx });
    }
    // expire stale levels
    while (activeSupports.length && i - activeSupports[0].bornAt > cfg.levelStaleBars) activeSupports.shift();
    while (activeResistances.length && i - activeResistances[0].bornAt > cfg.levelStaleBars) activeResistances.shift();

    // 4) detect a liquidity grab on THIS closed bar → arm a pending entry (only if flat & no pending)
    if (!open && !pending) {
      // LONG: broke below an active support but closed back above it
      if (bar.close > e[i]) {
        const grabbed = activeSupports.find((s) => bar.low < s.price && bar.close > s.price);
        if (grabbed) {
          pending = { side: "long", grabTs: bar.ts, trigger: bar.high, stop: bar.low, born: i };
          // consume levels at/above the grab so we don't re-fire on the same sweep
          for (let k = activeSupports.length - 1; k >= 0; k--) if (activeSupports[k].price >= grabbed.price - 1e-9) activeSupports.splice(k, 1);
        }
      } else if (bar.close < e[i]) {
        const grabbed = activeResistances.find((r) => bar.high > r.price && bar.close < r.price);
        if (grabbed) {
          pending = { side: "short", grabTs: bar.ts, trigger: bar.low, stop: bar.high, born: i };
          for (let k = activeResistances.length - 1; k >= 0; k--) if (activeResistances[k].price <= grabbed.price + 1e-9) activeResistances.splice(k, 1);
        }
      }
    }
  }
  return trades;
}

export interface LGStats { n: number; wins: number; winRate: number; expectancyR: number; totalR: number; maxDrawdownR: number; }
export function summarize(trades: LGTrade[]): LGStats {
  const n = trades.length; const wins = trades.filter((t) => t.win).length;
  const rs = trades.map((t) => t.r); const totalR = rs.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, maxDD = 0; for (const r of rs) { eq += r; if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }
  return { n, wins, winRate: n ? wins / n : 0, expectancyR: n ? totalR / n : 0, totalR, maxDrawdownR: maxDD };
}
