# DECODE — Trades By Sci (@tradesbysci, 539k subs)

> Decoded from his own free teaching (7 core transcripts pulled via `yt-dlp`, 22,767 words: Day Trading Crash Course
> #1–6, "Market Structure", "Indication", "Corrections", "identify market structure shift"), cross-referenced to the
> screenshots and gated against everything Aegis has already tested (D-146…D-196). This is the template for decoding
> any trading-education channel: **extract the exact mechanical rule → map it to a tested family → report what's real,
> what's marketing, and the highest-probability way to actually use it.**

## 1. The method, in his own words (not the hype — the mechanics)

His entire system is **ICC — Indication · Correction · Continuation**, applied on 4H/1H (his words: "1–2 trades a week"):
- **Indication** = price prints a new swing high (uptrend) or new swing low (downtrend). "The indication level is
  where your entry is going to be." It marks BOTH direction and the entry level.
- **Correction** = the pullback against the impulse (lower-highs/higher-lows). "You can't tell when a correction
  starts, only when it's over" — he drops to a smaller timeframe (15m/1H) to see the correction end.
- **Continuation** = price reclaims the indication level → enter in the impulse direction, target the prior high/low.

Two hard rules he repeats:
1. **"Never buy a higher high; never sell a lower low. Buy the higher-LOW, sell the lower-HIGH."** = fade the pullback
   in the direction of the trend.
2. **Multi-timeframe alignment** ("you need a team — multiple timeframes matching = strength"): Daily/4H/1H must all
   agree before entry.

Support/resistance he reframes as "buyers/sellers"; corrections are "buyers going back to grab more orders." It's
standard trend-pullback price action with an SMC vocabulary.

## 2. Decode → our verdicts (every pillar already tested)

| His pillar | Mechanical translation | Aegis verdict | Evidence |
|---|---|---|---|
| **Sell the lower-high in a downtrend** | fade a rally inside a downtrend (short) | ✓ **THIS IS OUR ONE SURVIVOR** | rip-short (RSI>70 & <200MA, short), t=7.23 daily / 8.07 crypto (D-179/170), the only edge that clears every gate |
| **Buy the higher-low in an uptrend** | buy a dip inside an uptrend (long) | ✗ dead survivorship-free | dip-buy family: t=5.63 biased → t=1.15 survivorship-free (D-176/177) |
| **ICC continuation entry** (buy the reclaim of the indication level after a correction) | breakout / trend-continuation long | ✗ falsified every timeframe | momentum/breakout dead (D-188); resist-breakout = drift (D-196, t=2.40 = survivorship) |
| **Demand-zone / support bounce** (the gold screenshots) | S/R mean-reversion long | ✗ loses to random on gold | D-196: GLD random long +0.71R **beats** his bounce +0.60R; broad-daily "edge" is dip-buy on biased data |
| **Multi-timeframe alignment** = the winning confluence | stack agreeing timeframes/signals | ✗ confluence adds nothing | D-195: even *orthogonal* confluence gives zero incremental lift; correlated stacking is *worse* (D-194) |
| **7-step sweep/FVG (his ICT cousin)** | liquidity-grab reversal | ✗ worse than random | D-193/195 precise 7-step: −0.12 to −0.21R, t=−3 to −7 |

## 3. What is REAL vs what is MARKETING

**Real (the one thing he's right about):** his *sell-side* instinct — **sell the lower-high in a downtrend** — is
mechanically identical to rip-short, the single edge that survived our entire falsification program. Fading rallies in
a downtrend beats a random short because shorts fight drift (PLAYBOOK #2). Directionally, half his method points at the
only real edge in the building.

**Marketing (where the probability isn't):**
- **The $8.5M gold longs** (screenshot 1) are the *buy* side (buy higher-low in a gold uptrend) = the dead dip-buy
  family. It's printing only because gold went parabolic — that's **drift × leverage**, not edge. The tell is in his
  own panel: **Margin Level 260%** and **Free Margin < Margin** means he's near-fully margined. That is the exact
  full-margin behaviour of "Tape 002 — i full margin my first xauusd trade" and "Tape 004 — LOST $366,000." Leverage
  turns gold's drift into an 8-figure equity screenshot *and* into a blow-up when gold corrects — which his own D1
  chart shows it repeatedly does.
- **ICC continuation entries** are breakouts, which we've killed at every timeframe.
- **Multi-timeframe "alignment"** is sold as the source of the edge; measured, confluence adds nothing.
- The value/volume, buyers-vs-sellers, "corrections = grabbing orders" narrative is a *story* that fits any chart in
  hindsight — none of it survives a random-entry control.

## 4. Highest-probability way to actually approach this (augmentation, not imitation)

1. **Keep his sell-side, drop his buy-side.** Sell lower-highs in confirmed downtrends (= rip-short) — the real edge.
   Ignore "buy the dip in the uptrend"; that's where his own account is most fragile.
2. **Condition it by regime, don't stack timeframes.** rip-short's edge nearly doubles in high-vol bull regimes
   (+0.057→+0.109R, D-194); multi-timeframe confluence adds nothing (D-195). "When" beats "how many confirmations."
3. **Size small and wide, never full-margin.** The real edge is +0.06–0.11R/trade across many names (D-184). His 260%
   margin level is the opposite of this — one gold reversal wipes the screenshot. Cap loss at 1R, target 3R.
4. **Treat any "buy support in an uptrend" setup as unproven** until it's run survivorship-free; on the instrument he
   markets (gold) it loses to buying randomly.

## 5. Reproduce
```bash
yt-dlp --skip-download --write-auto-sub --sub-lang "en.*" -o "%(id)s.%(ext)s" "https://www.youtube.com/watch?v=<id>"
deno run --allow-net scripts/trd-gold-sr.ts        # the S/R / demand-zone gate (D-196)
```
Core method video IDs: Market Structure `3NDqGuITSpk` · Indication `fDtZbxeNWyw` · Corrections `lcodvDq2jx4` ·
Crash Course #1 `PYVr6O6p_V4` · #5 Daily&4H `NQY6xAL4SuU` · Day 14 Structure `Y7Q37vTbuNg`.
