# AUGMENTATION.md — when to trade, with what setup, in which regime

> The pivot (D-194): we don't just tell a trader their strategy loses — we find the **regime cell where it beats a
> random entry**, and we prove which "improvements" actually help. Every cell below is gated vs a matched
> same-direction random control (D-146) and **deflated** for the fact that searching over regimes is itself multiple
> testing (Bonferroni across 30 cells, crit |t|≈3.14). A condition that only clears raw t≥2 is flagged "promising,
> not proven" — because selling an un-deflated conditional edge is the exact self-deception we exist to expose.

## The decision map (daily equities, liquid US names, next-open entry, 2×ATR stop, 3R target, cost+borrow)

| Setup | Direction | FIRE IT when… | DON'T when… | Status |
|---|---|---|---|---|
| **rip-short** (RSI14>70 & close<200MA) | short | **bull regime + high vol** (SPY>200MA, name in stress) → +0.109R, t=4.38 | calm regimes (setupR ~0, dead); bear tape (D-191, edge collapses) | ✓✓ **deployable, conditioned** |
| **Bollinger-fade-long** (close<lower 2SD band) | long | **bear regime** (SPY<200MA) → +0.078R, t=3.69, n=7,230 | bull/calm (edge vanishes into drift) | ✓✓ **new conditional candidate** |
| **dip-buy** (RSI14<30 & close>200MA) | long | *maybe* bear/stress selloffs → +0.215R raw, t=2.24 | any blanket use (dead overall, edge −0.002) | ~ **promising, not proven** |
| **Bollinger-fade-short** (close>upper band) | short | — (setupR stays negative in every cell) | always, as a standalone | ✗ **no rescue** |
| **7-step ICT** (sweep→FVG→inverse→BOS) | either | — (worse than random on GLD/SPY/QQQ/SLV, t=−3 to −7) | always | ✗ **anti-edge** |

## Three rules this proved (the transferable IP)

1. **Regime-conditioning is the real augmentation.** The same setup is deployable or dead depending on the regime
   slice — rip-short's per-trade edge nearly doubles (+0.057R→+0.109R) once you fire it only in high-vol bull tape.
   "When to trade" beats "what to trade." A blanket rule averages the good cell with the dead one and looks mediocre.

2. **Redundant confluence makes trades WORSE, not better.** Stacking two setups that fire on the same condition
   (rip-short ∧ upper-band-fade) *reduced* the edge vs rip-short alone (t 2.56 vs 4.45) — it shrinks your sample
   faster than it sharpens the signal. More confirmations ≠ better trade. Confluence only helps if the signals are
   **orthogonal** (e.g. a flow signal + a mean-reversion signal), which we have not yet been able to test — never
   two flavours of the same overbought reading.

3. **A falsified strategy can hold a real conditional edge.** Bollinger-fade-long is rejected as a blanket rule
   (D-178) yet is a deflated edge in bear regimes. The honest message to a trader running it: *"it loses on average
   because you run it in every tape — restrict it to down-markets and it beats random."* That is augmentation, not
   falsification. But the discipline is identical: the conditional edge must clear the deflated gate, or it's just a
   nicer-looking overfit.

## What augmentation does NOT license
- Searching cells until one prints, then quoting the raw t. Every cell here paid the Bonferroni tax.
- Promoting a raw-only cell (dip-buy/stress) to real money. It goes to the forward tracker to accumulate honest
  samples, not to an order path.
- Assuming a daily-equity regime map transfers to another timeframe/market. rip-short is daily+crypto5m; each cell
  is instrument- and timeframe-locked (PLAYBOOK #4).

## Reproduce
```bash
deno run --allow-net scripts/trd-augment.ts            # the regime×vol map, deflated
SB_ANON=<anon> deno run --allow-net --allow-env scripts/trd-ict-run.ts GLD,SLV,SPY,QQQ   # the 7-step ICT gate
```
