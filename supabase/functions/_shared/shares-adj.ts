// shares-adj.ts — convert a RAW-AS-FILED share count into TODAY'S share units, so it can be multiplied by a
// SPLIT-ADJUSTED price without mixing two share bases.
//
// THE PROBLEM. `trd_bars_deep` closes are fully back-adjusted for splits: every historical close is expressed in
// today's share units. `trd_fundamentals` concept `EntityCommonStockSharesOutstanding` is the EDGAR cover-page
// count, raw as filed, expressed in the share units of the FILING DATE. `mc = px_adj * sh_raw` is therefore wrong
// by the product of every split ratio occurring strictly AFTER the filing date:
//     GWAV 2021-05-28: $163,350 adjusted close x 493.7M raw shares = "$80.7T"
//     AAPL 2021-05-28: correct only because AAPL has not split since the filing it uses.
// The bias is directional, not noise: forward-splitters are past winners, so their PAST caps are inflated and every
// past yield built on those caps is deflated for exactly the names that went on to win.
//
// THE FIX. shares in today's units = raw shares x (product of split ratios after the filing date). A 7:1 forward
// split means one filed share became seven of today's shares, so v = 7 multiplies UP. A 1-for-10 reverse split
// means ten filed shares became one of today's, so v = 0.1 multiplies DOWN. Both directions are the same formula.
//
// Split rows come from `trd_macro_series` under series "split:<SYMBOL>", v = numerator/denominator (see
// scripts/ingest-splits.ts). The SENTINEL row d="1900-01-01", v=1 means "checked, no splits" — it is inert here
// because it multiplies by 1 and, being dated 1900, never falls after a filing date in this database anyway.

export interface Split { d: string; v: number }

/**
 * Product of every split ratio strictly AFTER `asOfDate`. 1 when there are none.
 * Dates are ISO "YYYY-MM-DD", which compares correctly as a string.
 */
export function splitFactorAfter(splits: Split[] | undefined | null, asOfDate: string): number {
  if (!splits?.length) return 1;
  let f = 1;
  for (const s of splits) {
    if (!s || !s.d || !Number.isFinite(s.v) || !(s.v > 0)) continue;
    if (s.d > asOfDate) f *= s.v;
  }
  return f;
}

/**
 * A raw-as-filed share count restated in TODAY'S share units, so `price_adjusted * adjShares(...)` is a market cap.
 * `filingDate` must be the date the share count was legally knowable (its `effective_date`), NOT the date being
 * priced — the correction depends on which splits happened after the FILING, not after the observation.
 */
export function adjShares(rawShares: number, splits: Split[] | undefined | null, filingDate: string): number {
  return rawShares * splitFactorAfter(splits, filingDate);
}

/**
 * THE ONE loader for split rows. `trd_macro_series` holds them under series "split:<SYMBOL>", v = num/den (see
 * scripts/ingest-splits.ts). The d="1900-01-01", v=1 rows are "checked, no splits" sentinels and are dropped here
 * so that every caller sees the same map — aegis-factory.ts used to carry a private copy of this loop, and the
 * seven scripts that never had one is exactly how D-747 survived the first fix.
 * Pure I/O; the offline test never calls it.
 */
export async function loadSplits(
  owned: string,
  hdr: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, Split[]>> {
  const splits = new Map<string, Split[]>();
  for (let off = 0;; off += 10000) {
    const p = await fetchFn(
      `${owned}/trd_macro_series?series=like.split:*&select=series,d,v&order=series.asc,d.asc&offset=${off}&limit=10000`,
      { headers: hdr },
    ).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(p) || !p.length) break;
    for (const r of p as { series: string; d: string; v: number }[]) {
      if (r.d === "1900-01-01") continue;                    // sentinel: checked, no splits
      if (!Number.isFinite(r.v) || !(r.v > 0)) continue;
      const sym = r.series.slice(6);
      (splits.get(sym) ?? splits.set(sym, []).get(sym)!).push({ d: r.d, v: r.v });
    }
    if (p.length < 10000) break;
  }
  return splits;
}

/** Convenience for the `pit()`-style stores that key filings by epoch-ms rather than an ISO date. */
export function adjSharesMs(rawShares: number, splits: Split[] | undefined | null, filingMs: number): number {
  return adjShares(rawShares, splits, new Date(filingMs).toISOString().slice(0, 10));
}

// ---------------------------------------------------------------------------------------------------------------
// THE THIRD SHARE-BASE DEFECT (D-747f) — CORRUPT FACTS AS FILED.
//
// Neither the split correction nor the ADR correction touches this one: some EDGAR cover-page share counts are
// simply WRONG AS FILED. BTI files 2,460,000,000,000,000 shares between neighbours of 2.46e9 — a factor of exactly
// 1e6, a units error made by the filer. CCL's 2021-03-30 filing carries 9.32e11 between neighbours of 5.28e8 and
// 9.86e8. These are single-point spikes: the series returns to its previous level on the very next filing.
//
// THE STORED FACT IS NOT MUTATED. `trd_fundamentals` is append-only evidence of what the filer actually said, and
// rewriting it would destroy the only record that the filing was wrong. The fix lives in the READER: the series is
// cleaned on the way in to asOf()/asOfRec(), and what was dropped is PRINTED, so a correction can never be silent.
//
// THE RULE IS DELIBERATELY CONSERVATIVE, because the cost of dropping a REAL share count (a whole name's market
// cap goes null for a year) exceeds the cost of keeping a corrupt one that some later guard will catch. A point is
// dropped only when BOTH its nearest earlier and later neighbours AGREE WITH EACH OTHER (within 3x) and the point
// is more than 50x or less than 1/50 of BOTH. That is the signature of a spike, and it is exactly what a genuine
// corporate action is NOT: a real 10:1 reverse split moves the series to a new level and LEAVES IT THERE, so its
// later neighbour never agrees with its earlier one and no split can be dropped by this rule. A first or last
// point has only one neighbour and no agreement can be established, so it is dropped only past 1000x — the BTI
// shape and nothing subtler.
const SPIKE = 50;                 // x, against BOTH neighbours
const AGREE = 3;                  // the two neighbours must be within this factor of each other
const EDGE_SPIKE = 1000;          // x, for a first/last point that has only one neighbour
const POW10 = [1e3, 1e6, 1e9];    // filer units errors: thousands, millions, billions
// A REFERENCE MUST ITSELF BE PLAUSIBLE. Found by reading the live drops rather than by reasoning: the first
// version condemned PSKY's real 1,071,666,977 because the two facts beside it are the placeholder 1000, and
// condemned CLUS's real 434,473,776 because the two beside it are 4399. In both cases the rule deleted the truth
// and kept the garbage, and PSKY sits at rank 676 of the liquid top-1000 — the exact class of error this whole
// change exists to stop, committed by the fix for it. A listed company's cover-page share count is never below
// ~1e5; values of 1, 7, 8, 24, 100, 1000, 4399 are placeholders, and a placeholder may never convict a neighbour.
const MIN_PLAUSIBLE = 1e5;

export interface ShareFact { eff: string; value: number }
export interface DroppedFact { eff: string; value: number; reason: string }

const near = (x: number, y: number) => Math.abs(x / y - 1) < 1e-9;

/**
 * Drop corrupt single-point spikes from a share-count series. `facts` must be sorted ascending by `eff`.
 * Every decision is made against the ORIGINAL series, so one bad point can never cascade into dropping its
 * neighbours. Returns the kept series and an itemised list of what was dropped and why.
 */
export function cleanShareSeries(facts: ShareFact[]): { kept: ShareFact[]; dropped: DroppedFact[] } {
  const dropped: DroppedFact[] = [];
  if (facts.length < 2) return { kept: facts.slice(), dropped };
  const drop = new Array<DroppedFact | null>(facts.length).fill(null);

  // --- PHASE 1: interior points, judged against the ORIGINAL series so one bad point can never cascade.
  for (let i = 1; i < facts.length - 1; i++) {
    const f = facts[i], p = facts[i - 1], q = facts[i + 1];
    if (!(f.value > 0) || !(p.value > 0) || !(q.value > 0)) continue;
    if (p.value < MIN_PLAUSIBLE || q.value < MIN_PLAUSIBLE) continue;   // placeholders convict nobody
    // the two neighbours must AGREE, else this is a level change (a real split) and not a spike.
    const agree = Math.max(p.value, q.value) / Math.min(p.value, q.value);
    if (agree > AGREE) continue;
    const rp = f.value / p.value, rq = f.value / q.value;
    const up = rp > SPIKE && rq > SPIKE, dn = rp < 1 / SPIKE && rq < 1 / SPIKE;
    // exact power-of-ten multiples of BOTH neighbours: the filer's units error, stated as such.
    const pow = POW10.find((k) => (near(rp, k) && near(rq, k)) || (near(rp, 1 / k) && near(rq, 1 / k)));
    if (!up && !dn && pow == null) continue;
    const how = pow != null
      ? `exactly ${rp > 1 ? "x" : "1/"}${pow.toExponential(0)} of BOTH neighbours — a filer units error`
      : `${up ? ">" + SPIKE + "x" : "<1/" + SPIKE + " of"} BOTH neighbours`;
    drop[i] = { eff: f.eff, value: f.value, reason: `${how}: ${p.value.toExponential(3)} (${p.eff}) / ${q.value.toExponential(3)} (${q.eff}), which agree within ${agree.toFixed(2)}x` };
  }

  // --- PHASE 2: the two ENDPOINTS. These have one neighbour and no agreement can be established, so the bar is
  // 1000x. Critically, the neighbour used is the nearest SURVIVOR of phase 1: the first version judged BTI's good
  // 2.46e9 opening fact against the 2.46e15 spike sitting next to it and deleted the HEALTHY point instead of the
  // corrupt one. A cleaner that can delete the truth because the lie is adjacent to it is worse than no cleaner —
  // and it was caught only because the BTI unit test asserted WHICH row was dropped rather than how many.
  for (const [i, step] of [[0, 1], [facts.length - 1, -1]] as [number, number][]) {
    const f = facts[i];
    if (!(f.value > 0) || drop[i]) continue;
    let j = i + step;
    while (j >= 0 && j < facts.length && (drop[j] || !(facts[j].value > 0))) j += step;
    if (j < 0 || j >= facts.length) continue;                    // no surviving neighbour: nothing to judge against
    // The reference must itself be CORROBORATED — it has to agree with its own far-side neighbour. Without that,
    // an endpoint is being judged against a single unverified number, and if THAT number is the corrupt one the
    // rule deletes the healthy endpoint. [1e8, 1e12, 1e10] is the shape: 1e12 survives phase 1 because its
    // neighbours disagree, and an uncorroborated endpoint rule would then drop the perfectly good 1e8.
    const ref = facts[j];
    let k = j + step;
    while (k >= 0 && k < facts.length && (drop[k] || !(facts[k].value > 0))) k += step;
    if (k < 0 || k >= facts.length) continue;                    // nothing corroborates the reference: keep.
    if (facts[j].value < MIN_PLAUSIBLE) continue;                // a placeholder reference convicts nobody
    if (Math.max(ref.value, facts[k].value) / Math.min(ref.value, facts[k].value) > AGREE) continue;
    const n = ref, r = f.value / n.value;
    if (r > EDGE_SPIKE || r < 1 / EDGE_SPIKE) {
      drop[i] = { eff: f.eff, value: f.value, reason: `endpoint ${r > 1 ? r.toExponential(2) + "x" : "1/" + (1 / r).toExponential(2) + " of"} its nearest surviving neighbour ${n.value.toExponential(3)} (${n.eff}); endpoint floor ${EDGE_SPIKE}x` };
    }
  }

  const kept: ShareFact[] = [];
  for (let i = 0; i < facts.length; i++) { if (drop[i]) dropped.push(drop[i]!); else kept.push(facts[i]); }
  return { kept, dropped };
}

/**
 * THE ONE wiring point. Cleans `EntityCommonStockSharesOutstanding` in a factory-style
 * `ticker -> concept -> [{eff,v}]` store IN PLACE, and returns a one-line summary plus the itemised drops.
 * aegis-factory.ts and factory-forward-score.ts both call this so the two can never construct a different series.
 * The store's arrays must already be sorted ascending by `eff`.
 */
export function scrubShareFacts(
  fund: Map<string, Map<string, { eff: string; v: number }[]>>,
  concept = "EntityCommonStockSharesOutstanding",
): { line: string; drops: { ticker: string; eff: string; value: number; reason: string }[] } {
  const drops: { ticker: string; eff: string; value: number; reason: string }[] = [];
  for (const [ticker, m] of fund) {
    const a = m.get(concept); if (!a?.length) continue;
    const { kept, dropped } = cleanShareSeries(a.map((x) => ({ eff: x.eff, value: x.v })));
    if (!dropped.length) continue;
    for (const d of dropped) drops.push({ ticker, ...d });
    m.set(concept, kept.map((x) => ({ eff: x.eff, v: x.value })));
  }
  const tk = [...new Set(drops.map((d) => d.ticker))].sort();
  const line = `  share-fact scrub (D-747f): dropped ${drops.length} corrupt fact(s) across ${tk.length} ticker(s)${tk.length ? ": " + tk.join(",") : ""}`;
  return { line, drops };
}
