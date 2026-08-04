// trd-decay — the edge-decay monitor. Synthesised from the "free finance" essay (D-101), pillar 6
// (Andrew Lo, Adaptive Markets): "An edge decays because it works — other people notice and crowd in.
// Any approach you adopt because it worked recently sits closer to the end of its life than the start."
//
// So a forward-positive strategy is not "done" — it must be WATCHED for decay. This splits a strategy's
// chronological realised trades into an early half and a recent half and compares expectancy. The most
// important state is DEAD: an edge that was positive early and has crossed to ≤0 recently — the exact
// Adaptive-Markets death the essay warns about. Pure function; reads only realised R multiples in order.

export const MIN_N = 30;            // below this we cannot claim decay OR edge — say so
export const DECAY_DELTA = 0.15;    // R-per-trade drop between halves that counts as material decay

export type DecayStatus = "insufficient" | "improving" | "stable" | "decaying" | "dead";
export interface DecayReport {
  n: number;
  earlyExp: number;   // mean R over the earlier half
  recentExp: number;  // mean R over the recent half
  delta: number;      // recentExp - earlyExp
  status: DecayStatus;
  reason: string;
}

const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

/** @param chronoR realised R multiples in CHRONOLOGICAL order (oldest first). */
export function decayReport(chronoR: number[], minN = MIN_N): DecayReport {
  const r = chronoR.filter((x) => Number.isFinite(x));
  const n = r.length;
  if (n < minN) return { n, earlyExp: NaN, recentExp: NaN, delta: NaN, status: "insufficient", reason: `only ${n}<${minN} trades — cannot judge decay yet` };
  const h = Math.floor(n / 2);
  const early = r.slice(0, h), recent = r.slice(h);
  const earlyExp = mean(early), recentExp = mean(recent), delta = recentExp - earlyExp;
  let status: DecayStatus, reason: string;
  if (earlyExp > 0 && recentExp <= 0) {
    status = "dead"; reason = `edge died — was +${earlyExp.toFixed(3)}R early, now ${recentExp.toFixed(3)}R (Adaptive-Markets decay: retire it)`;
  } else if (delta <= -DECAY_DELTA) {
    status = "decaying"; reason = `decaying — expectancy fell ${(-delta).toFixed(3)}R (${earlyExp.toFixed(3)}→${recentExp.toFixed(3)})`;
  } else if (delta >= DECAY_DELTA) {
    status = "improving"; reason = `improving — expectancy rose ${delta.toFixed(3)}R (${earlyExp.toFixed(3)}→${recentExp.toFixed(3)})`;
  } else {
    status = "stable"; reason = `stable — expectancy ${earlyExp.toFixed(3)}→${recentExp.toFixed(3)}R (Δ${delta >= 0 ? "+" : ""}${delta.toFixed(3)})`;
  }
  return { n, earlyExp: +earlyExp.toFixed(4), recentExp: +recentExp.toFixed(4), delta: +delta.toFixed(4), status, reason };
}
