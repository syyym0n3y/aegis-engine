// trd-auction.ts — Auction Market Theory engine (pure, offline-testable). Volume-at-price profile → POC,
// Value Area (VAH/VAL), plus composite (multi-session) and prior-session value. The spine of the operator's
// "stack it into an auction-market-theory framework" ask. Each bar's volume is distributed across the price
// bins its high-low range spans (standard volume profile), then the Value Area is the smallest contiguous
// band around the POC holding `valuePct` (default 70%) of total volume. Context/awareness, not an edge.

export interface PBar { h: number; l: number; c: number; v: number; day?: string; }
export interface ValueArea { poc: number; vah: number; val: number; totalVol: number; nbins: number; binSize: number; }

/** Volume-at-price value area. `nbins` price buckets across [minLow,maxHigh]; VA grows from POC outward,
 * always adding the heavier of the two adjacent bins, until valuePct of volume is enclosed. */
export function valueArea(bars: PBar[], valuePct = 0.7, nbins = 100): ValueArea | null {
  if (!bars.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
  if (!(hi > lo)) { // flat range — degenerate but honest
    const v = bars.reduce((s, b) => s + b.v, 0);
    return { poc: lo, vah: lo, val: lo, totalVol: v, nbins: 1, binSize: 0 };
  }
  const binSize = (hi - lo) / nbins;
  const vol = new Array(nbins).fill(0);
  for (const b of bars) {
    const bLo = Math.min(nbins - 1, Math.max(0, Math.floor((b.l - lo) / binSize)));
    const bHi = Math.min(nbins - 1, Math.max(0, Math.floor((b.h - lo) / binSize)));
    const span = bHi - bLo + 1; const share = b.v / span;
    for (let k = bLo; k <= bHi; k++) vol[k] += share;
  }
  const total = vol.reduce((s, x) => s + x, 0);
  let poc = 0; for (let i = 1; i < nbins; i++) if (vol[i] > vol[poc]) poc = i;
  let lower = poc, upper = poc, acc = vol[poc]; const target = valuePct * total;
  while (acc < target && (lower > 0 || upper < nbins - 1)) {
    const below = lower > 0 ? vol[lower - 1] : -1;
    const above = upper < nbins - 1 ? vol[upper + 1] : -1;
    if (above >= below) { upper++; acc += Math.max(0, above); } else { lower--; acc += Math.max(0, below); }
  }
  const mid = (i: number) => lo + (i + 0.5) * binSize;
  return { poc: +mid(poc).toFixed(4), vah: +(lo + (upper + 1) * binSize).toFixed(4), val: +(lo + lower * binSize).toFixed(4), totalVol: total, nbins, binSize };
}

/** Group bars by `day` tag (caller sets it), preserving input order within a day. */
export function byDay(bars: PBar[]): Map<string, PBar[]> {
  const m = new Map<string, PBar[]>();
  for (const b of bars) { const d = b.day ?? "all"; (m.get(d) ?? m.set(d, []).get(d)!).push(b); }
  return m;
}

/** Developing (current session), prior (previous session), and composite (last `lookback` sessions) VAs. */
export function auctionContext(bars: PBar[], lookback = 20, valuePct = 0.7, nbins = 100): {
  developing: ValueArea | null; prior: ValueArea | null; composite: ValueArea | null; sessions: number;
} {
  const days = [...byDay(bars).entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  const n = days.length;
  const developing = n >= 1 ? valueArea(days[n - 1][1], valuePct, nbins) : null;
  const prior = n >= 2 ? valueArea(days[n - 2][1], valuePct, nbins) : null;
  const compBars = days.slice(Math.max(0, n - lookback)).flatMap((d) => d[1]);
  const composite = compBars.length ? valueArea(compBars, valuePct, nbins) : null;
  return { developing, prior, composite, sessions: n };
}
