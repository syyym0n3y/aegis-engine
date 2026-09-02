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
