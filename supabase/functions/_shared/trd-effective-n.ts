// trd-effective-n.ts — the EFFECTIVE-N gate for every Information Coefficient in this engine (pure, tested).
//
// Why this exists, in the repo's own words. D-337: "our IC t-stats are OVERSTATED — overlapping forward windows +
// cross-correlated ETF panel inflate effective-N; trust sign coherence, not magnitudes (apply to ALL IC henceforth)".
// D-338 repeats the same caveat. D-336 states it concretely: the Form-4 pool's 21d IC of −0.515 at "N=18" came from a
// pool where ONE issuer (BAC) supplied 15 of 24 events, so the naive t=−2.40 was one name's buy-timing counted 15 times.
// That caveat has been carried in prose three times and enforced ZERO times. This module makes it machine-enforced:
// a naive t computed on a raw observation count is not admissible evidence; the honest t is computed on the number of
// INDEPENDENT CLUSTERS, and it fails closed when there are too few.
//
// The two independent inflation sources, and the single conservative device that covers both:
//   1. OVERLAPPING FORWARD WINDOWS. An observation sampled on day d measuring an H-day forward return shares H−1 days
//      of its return path with the observation on day d+1. Those are not two independent draws.
//   2. CROSS-SECTIONAL / SAME-MEMBER CORRELATION. Many observations on the SAME symbol (or on symbols that move
//      together) are one bet repeated, not many bets. This is the D-336 BAC failure exactly.
// Device: count DISTINCT (symbol, time-block) clusters, where the block width is the forward horizon H. Two
// observations can contribute two independent units only if they are on different symbols OR are separated by at least
// one full horizon. Within a cluster, everything collapses to ONE. This is deliberately CONSERVATIVE — it under-counts
// rather than over-counts, which is the correct direction for a gate whose job is to refuse to be fooled.
//
// What this is NOT: it is not a Newey–West/HAC variance estimator, and it does not model the correlation between two
// DIFFERENT symbols (two banks in the same week are still counted as two clusters, so cross-name correlation is only
// partially handled). Both are stated rather than hidden: effN is an UPPER bound on independence, so t_eff is still an
// upper bound on significance. Reported alongside is `maxMemberShare` — the single-member concentration that made the
// D-336 pool a one-name artifact — so a dominated pool is visible in the row itself and not only to whoever reads it.

/** One IC observation: a factor value `x` and its realised forward return `y`, tagged with the member it belongs to
 *  (symbol/instrument) and the integer day the forward window STARTS. `day` must be a calendar-day index (see
 *  `dayIndex`), not a row number — otherwise the overlap blocks are meaningless. */
export interface ICObs { member: string; day: number; x: number; y: number }

export interface EffectiveIC {
  ic: number;            // Spearman rank-IC over all observations
  n: number;             // raw observation count (what a naive t would use)
  tNaive: number;        // the OVERSTATED t — reported only so the inflation is visible, never as the verdict
  effN: number;          // independent (member, horizon-block) clusters
  tEff: number;          // the honest t, computed on effN; 0 when effN < minEffN (fails closed)
  vif: number;           // n / effN — how many times each independent bet was counted
  nMembers: number;      // distinct members in the pool
  nBlocks: number;       // distinct horizon-blocks spanned
  maxMemberShare: number; // largest single member's share of n (D-336's one-issuer detector)
  underpowered: boolean; // effN < minEffN → no significance claim is admissible from this pool
  verdict: string;
}

/** Days since 1970-01-01 for a 'YYYY-MM-DD' (or ISO timestamp) date. Non-parseable input yields NaN, which
 *  `effectiveRankIC` treats as its own block rather than silently bucketing it with day 0. */
export function dayIndex(iso: string): number {
  const ms = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : NaN;
}

function rankOf(a: number[]): number[] {
  const n = a.length;
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(n);
  // average ranks over ties — without this, tied factor values (common: many buys of identical size) would be
  // ordered by array position, which is an artifact of fetch order, not of the data.
  let i = 0;
  while (i < n) {
    let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(rx: number[], ry: number[]): number {
  const n = rx.length;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += rx[i]; my += ry[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** t of a correlation on `df + 2` independent units. |r| is clamped just below 1 so a perfect in-sample fit returns a
 *  large FINITE t rather than 0 — zeroing it (the pattern this module replaces) understates rather than overstates,
 *  which is the wrong failure direction for a number a human then reads as "no significance". */
function tFromR(r: number, units: number): number {
  if (!(units >= 3)) return 0;
  const rc = Math.min(Math.abs(r), 0.999999) * Math.sign(r);
  return rc * Math.sqrt((units - 2) / (1 - rc * rc));
}

/**
 * Rank-IC with a cluster-based effective sample size.
 *
 * @param obs           the pooled observations
 * @param horizonDays   the forward-return horizon in DAYS — this is the overlap block width
 * @param minEffN       independence floor; below it no significance is claimed (fails closed, default 10)
 */
export function effectiveRankIC(obs: ICObs[], horizonDays: number, minEffN = 10): EffectiveIC {
  const n = obs.length;
  const empty: EffectiveIC = {
    ic: 0, n, tNaive: 0, effN: 0, tEff: 0, vif: 0, nMembers: 0, nBlocks: 0, maxMemberShare: 0,
    underpowered: true, verdict: `no observations`,
  };
  if (n === 0) return empty;

  const H = Math.max(1, Math.floor(horizonDays));
  const ic = pearson(rankOf(obs.map((o) => o.x)), rankOf(obs.map((o) => o.y)));

  const clusters = new Set<string>(), members = new Set<string>(), blocks = new Set<string>();
  const perMember = new Map<string, number>();
  for (const o of obs) {
    // A non-finite day cannot be placed on the overlap axis; give it its own block so it is never merged with a
    // real one, and never silently treated as day 0.
    const b = Number.isFinite(o.day) ? String(Math.floor(o.day / H)) : `nd:${o.member}:${blocks.size}`;
    clusters.add(`${o.member}|${b}`); members.add(o.member); blocks.add(b);
    perMember.set(o.member, (perMember.get(o.member) ?? 0) + 1);
  }
  const effN = clusters.size;
  const maxMemberShare = Math.max(...perMember.values()) / n;
  const underpowered = effN < minEffN;
  const tNaive = tFromR(ic, n);
  const tEff = underpowered ? 0 : tFromR(ic, effN);

  return {
    ic: +ic.toFixed(4), n, tNaive: +tNaive.toFixed(2), effN, tEff: +tEff.toFixed(2),
    vif: +(n / effN).toFixed(2), nMembers: members.size, nBlocks: blocks.size,
    maxMemberShare: +maxMemberShare.toFixed(3), underpowered,
    verdict: underpowered
      ? `UNDERPOWERED — ${effN} independent (member,${H}d-block) clusters behind ${n} observations (need ≥${minEffN}); no significance claimed`
      : `IC ${ic.toFixed(4)} on effN=${effN} (raw n=${n}, VIF ${(n / effN).toFixed(2)}×, top member ${(maxMemberShare * 100).toFixed(0)}% of n) — honest t ${tEff.toFixed(2)} vs naive ${tNaive.toFixed(2)}`,
  };
}
