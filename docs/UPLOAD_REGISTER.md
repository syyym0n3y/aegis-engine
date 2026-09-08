# UPLOAD REGISTER — every artifact the operator has uploaded, and where the stack accounts for it

> Started 2026-09-06 (D-794) after the operator asked that everything uploaded be traced across the stack. Rule:
> an upload is accounted for only when this table names the DECISIONS entry that MEASURED its concept, or states
> plainly why it cannot be measured. "Seen" is not "accounted for".

## A. Files — `/Users/ona/Downloads/drive-download-20260805T022909Z-1-001` (5 × MetaTrader 5 `.ex5`, 204 KB)

Compiled MQL5 binaries. **No source; EX5 bodies are encrypted by MetaEditor — `strings` (ASCII and UTF-16LE) returns
nothing.** They cannot be read, and executing opaque downloaded binaries is off the table. Accounting is therefore at the
CONCEPT level the filenames declare. To test the exact logic, supply the `.mq5` source or the vendor's input list.

| file | concept it names | stack status | ref |
|---|---|---|---|
| `Stochastic Divergence AW.ex5` | stochastic-oscillator divergence at swing lows/highs as a reversal signal | **MEASURED** on 17-instrument 1h panel | D-794 (a) |
| `Buy and Sell Power.ex5` | buy-vs-sell pressure oscillator (Elder Bull/Bear Power is the canonical form) | **MEASURED** as Elder Bull/Bear Power on 17-panel | D-794 (b) |
| `Easy Buy Sell Signal.ex5` | generic arrow signal (unknown rule) | **UNTESTABLE as-is** — no source, no rule; generic MA/RSI crossovers were covered by the grammar search (D-4xx era) and by the pattern audit D-775 | — |
| `Boom1000_Confluence_Alert..ex5` | alert on Deriv "Boom 1000" synthetic index | **OUT OF SCOPE, deliberately** — Boom/Crash indices are house-generated random processes with engineered spikes, not a market; no data held, nothing to falsify, and the product's edge belongs to the house. Not pursued. | — |
| `Trade_Assistant Shephred_FX….ex5` | lot / stop / target calculator, trade panel | **ACCOUNTED** by `docs/SIZING_FRAMEWORK.md` (1.0× notional cap, 2.5×ATR stop, time exit) with its D-782 regime warning; exit-policy variants measured in D-794 (g) | D-772/D-786/D-794 |

## B. Screenshots (9, 2026-09-06) — Instagram reels: kasen.nq, steel.nq ×3, atraintrades ×4, atraintrading.com ×2

| concept on screen | source | stack status | ref |
|---|---|---|---|
| 10AM ET open, "wait for manipulation to one or both sides" | kasen.nq | **MEASURED** — both sweep-and-reclaim fades LOSE net of cost at 10AM NQ; only breakout-continuation survives | D-779 |
| FVG / SIBI / BISI / P.iFVG (imbalance entries, inversion) | steel.nq | **MEASURED** — FVG respect 0+/8−, IFVG continuation 0+/12− | D-765 |
| SMT divergence (NQ vs SPX at swing lows/highs) | steel.nq | **MEASURED** on NQ/SPX 1h | D-794 (c) |
| C.E — consequent encroachment (limit entry at FVG midpoint vs edge) | steel.nq | **MEASURED** fill-conditional per EXECUTION LAW | D-794 (d) |
| AMD / PO3 (accumulation → manipulation low → distribution), Asia "ping pong" | steel.nq | **MEASURED** — the UTC-01 sweep-of-PDL-and-reclaim cell IS this; registered as clock `fwd-utc01-sweepPDL-reclaim-long-K6-panel17`, 2026 partial tracking KILL | D-780/D-782 |
| 4H PO3 — 4H-candle open/low as the frame | steel.nq | **MEASURED** — 4H-block open continuation/reversion | D-794 (f) |
| Trade management: break-even, partials, runners, pyramiding, buy/sell limits & stops | steel.nq ×3 | **MEASURED** as exit-policy variants on the registered UTC-01 cell | D-794 (g) |
| LRL ("low-resistance liquidity run") | steel.nq | **UNTESTED, out of reach** — requires order-book depth (L2) to define "low resistance"; L2 gated for FX/CFD (driver register) | — |
| SMT/"5m −SMT" divergence timeframe | steel.nq | 1h is the finest held for NQ/SPX; 5m untested (no 5m index data) | D-794 (c), coverage stated |
| "IV walls / ceiling — 90% chance we stay in range" | atraintrades | **MEASURED** — a tautology as stated; as a conditioner it does NOT refine clock #18 (sign collapses to 47%); exposed the VIX3M ≥ 20 regime dependence | D-791 |
| "Historical volatility / average ranges" as walls | atraintrades | **MEASURED** — day-open ± ADR(20) walls, touch-and-fade vs continuation | D-794 (e) |
| Market-maker positioning / dealer inventory / OI by strike | atraintrades | **BUILT as a live feed** (Deribit BTC/ETH per-strike OI → PCR, ATM IV, naive GEX), forward-only; no history exists so not a conditioner until months accumulate; per-strike equity OI gated | D-792 |
| "Fractals" (branding) | atraintrading.com | The fractal-swing primitives are the library's own (`swings`, `breaksOfStructure`) and underlie D-763/766 | D-763 |
| "$100/mo access", prop-firm payouts (Topstep, Lucid $5,000) | all | Context, not a concept. A prop-firm evaluation pass is a drawdown-rule pass, not evidence of edge; the base rate (97% of retail lose) is the prior these screenshots are selected against. Nothing here required a paid product. | D-791 |

## C. What "accounted for" changed

- 6 concepts moved from unmeasured to measured in one pass (D-794 a–g), on held data, with trial counts.
- 2 are stated as out of reach with the exact missing input named (LRL → L2; 5m SMT → no 5m index bars).
- 1 is deliberately out of scope with the reason on record (Deriv synthetic index).
- 5 binaries are recorded as opaque; the path to exact-logic testing is the `.mq5` source.

## C. Trading literature named by the operator 2026-09-08 (D-831)

Mark Douglas, *Trading in the Zone* and *The Disciplined Trader*; Jack Schwager, *Market Wizards*.

**On obtaining them:** all three are in copyright. Free full-text copies circulating online are unauthorised, so this
stack does not hold or quote them. Legitimate routes: UK public library apps (Libby / BorrowBox — all three are
commonly stocked), Internet Archive controlled lending, or purchase at roughly £10–15. **Nothing below quotes or
reproduces any of them.** Ideas are not copyrightable; what follows is each work's testable propositions restated in
my own words, which is the only form this engine can use anyway — a proposition it cannot measure is not usable here.

**Why this section differs from sections A and B.** Those were SIGNAL folklore (entry patterns), and the engine
measured them one by one. Douglas and Schwager are overwhelmingly about PROCESS: how a person converts an edge into
money, or fails to. That class has never been measured on this stack, and it is the class that matters most right now,
because the micro rung is about to put fills in the operator's own hands.

| # | proposition, restated | class | stack status |
|---|---|---|---|
| 1 | Any single trade's outcome is essentially random; an edge only appears over a series, so the sample a trader judges themselves on is far larger than the one they feel | process | **MEASURED and already load-bearing** — every gate here is a sample-size gate (paper→micro ≥30, micro→small ≥50); D-520 measured the same shape: 62% of months but **96.8% of rolling 3-year windows** positive |
| 2 | **Inconsistent execution destroys an edge**; discipline is the mechanism that converts expectancy into money | process | **UNTESTED until D-831** — 15 mentions of discretion in the record, never a measurement. Tested below |
| 3 | A trader will fool themselves by remembering selected trades; the felt track record is not the real one | process | **UNTESTED until D-831** — this is the measurable half of proposition 2, and the more dangerous one for us |
| 4 | Expectancy, not win rate, is what pays | arithmetic | **MEASURED, repeatedly** — D-742's uploaded strategy claimed 76.5% win rate, measured 44.1%, expectancy −0.118R at ZERO cost (D-77x); D-154 "R:R is decisive"; D-520 win rate is an aggregation property, not a per-trade promise |
| 5 | Risk a small fixed fraction per trade; survival first | sizing | **MEASURED and enforced** — `RISK_POLICY.md` (0.5%/trade, 2% daily kill), the D-744 holdability sizer (a 30% drawdown ceiling costs 59% of terminal wealth), D-767's finding that the leverage that HOLDS is 0.06–0.10× |
| 6 | Cut losses; let winners run (asymmetric payoff) | signal-adjacent | **MEASURED and REFUTED on our data** — D-787: trailing stops and pyramiding destroy what fixed-K holding keeps; stop geometry became a grammar axis at D-305 and no geometry cleared |
| 7 | Most of Schwager's interviewees were trend followers or global macro | selection | **NOT A CLAIM — it is survivorship**. The book interviews winners; the base rate of the strategies they used is absent by construction. Recorded as unmeasurable in principle from the source |
| 8 | Trade your own system, not someone else's | process | **STRUCTURAL** — the whole pre-registration + immutable-clock apparatus is this proposition mechanised |

**The honest summary of what this literature adds to this stack:** propositions 1, 4, 5, 6 and 8 are already measured
or enforced here, and where the data disagreed (6) the data won. Proposition 7 is survivorship and cannot be tested
from the source. Propositions **2 and 3 are the genuinely new ones**, and they are measured in D-831.

