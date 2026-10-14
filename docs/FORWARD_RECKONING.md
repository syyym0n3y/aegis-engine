# FORWARD RECKONING — would real cash have made or lost money?

> Generated 2026-10-14T19:22:33.101Z from the owned node. **Latest** mark per clock, never the best one:
> a first pass using the maximum read the deployed blend at Sharpe 3.39 when its current value is 1.60, which is
> survivorship applied to our own record. Promote/kill floors were written before any of this data existed.

## The short answer

**No clock has cleared its promote floor, so under the ladder no real cash would have been deployed at all.**
That is the literal answer: there is no realised profit or loss because the discipline never released capital.
What follows is what cash WOULD have done had it been deployed anyway, per clock, with the sizing stated.

## Clocks carrying a computable number

| clock | latest | metric | n | if £10,000/trade had been deployed |
|---|---|---|---|---|
| fwd-residual-follow | 0.273 | portfolio_t | 24 | — metric does not convert to cash (a t-stat / Sharpe is not a P&L) |
| fwd-hedging-pressure-flip | -1.540 | gross_portfolio_t | 1037 | — metric does not convert to cash (a t-stat / Sharpe is not a P&L) |
| fwd-spinoff-premium | 45.524 | liq_median_excess_vs_iwm_500d_pp | 54 | — metric does not convert to cash (a t-stat / Sharpe is not a P&L) |
| fwd-utc01-sweepPDL-reclaim-long-K6-panel17 | 64.269 | pooled_net_bp_K6_panel17 | 35 | **+£2,249** cumulative (64.27bp × 35 trades) |
| fwd-utc09to10-belowPDL-long-K6-panel17 | 1.200 | pooled_net_bp_K6_panel17 | 188 | **+£226** cumulative (1.20bp × 188 trades) |
| fwd-utc16-abovePDH-long-K6-panel17 | 11.460 | pooled_net_bp_K6_panel17 | 122 | **+£1,398** cumulative (11.46bp × 122 trades) |
| fwd-distress-ivol-blend-5 | 1.601 | fwd_sharpe_7sleeve | 28 | Sharpe 1.60 — a RATIO, not money; cash depends on vol target and leverage |

## The decay that matters

The two most mature intraday clocks have fallen hard as their samples grew — the signature of an edge that was
sampling noise early:

| clock | best mark ever | latest | floor to promote |
|---|---|---|---|
| fwd-utc09to10-belowPDL-long-K6 | 64.96bp | **1.20bp** | >= +6bp (and ≥400 events) |
| fwd-utc16-abovePDH-long-K6 | 34.09bp | **11.46bp** | >= +5bp (and ≥400 events) |

## Clocks running with no number yet

27 of 34 clocks have marks but no computable metric yet (not-yet-computable is distinct from
inconclusive — conflating those is how a clock quietly stops meaning anything, per the continuity law).

## Honest caveats on every cash figure above

- bp figures assume **equal notional on every trade** and that each trade was actually fillable at the modelled price.
- They are **gross of slippage beyond the modelled cost** and of any borrow on short legs.
- None of this is realised: `trd_manual_trades` holds **0 fills**. This is what the model says, not what a broker confirmed.
