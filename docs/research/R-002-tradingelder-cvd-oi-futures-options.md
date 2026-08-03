# R-002 — TradingElder scrape + futures/options profitability + CVD/OI as risk-confidence levers

> **Source-grounded pass, 2026-08-03.** Seeded from the operator's request to study
> the **Elder Santis** channel (`@tradingelder`) — specifically *"Beginners Guide To
> Start Day Trading In 2026 (2 hours)"* ([BdQlFYSWl0I](https://www.youtube.com/watch?v=BdQlFYSWl0I))
> — and to answer: how profitable can we be trading **futures & options**, what are the
> **commercial risks**, and how do **CVD** and **OI** function as confidence levers.
>
> **Scrape status (honest):** channel identity, subscriber count, and the full video
> description were extracted from the live page. **The 2-hour transcript could NOT be
> extracted** — YouTube gates the caption endpoint behind a proof-of-origin token and
> the in-page transcript panel would not render in the scraping context (timedtext
> returned HTTP 200 empty; `get_transcript` returned HTTP 400). To fold the verbatim
> teaching into this doc, the operator supplies the transcript text (paste or a
> transcript tool). The curriculum below is read from the **description**, which the
> creator wrote to summarise the video.
>
> Confidence tags: **[Certain]** = primary/authoritative source; **[Likely]** = strong
> inference or secondary aggregation; **[Guessing]** = extrapolation beyond evidence.

---

## The single most uncomfortable truth

**The operator is right that edges exist — and this exact video is the proof of where
the money actually is.** Markets require edges (market-makers, informed flow,
disciplined discretionary traders extract real money), so "no edge anywhere" is false
and was never the claim. But Elder Santis's own video description sells a **paid
mentorship** (`mastertrader.info`), **prop-firm affiliate links** (Apex, Tradeify), an
**affiliate journal** (Tradezella), and an Instagram funnel. The dominant, *reliable*
revenue stream visible on trading-YouTube is **selling the education and the affiliate
funnel — not the trading.** That is not a reason to dismiss him; his risk-management
content can be genuinely good. It is the reason the Aegis engine exists: **we verify an
edge with real N before we believe the narrator, because the narrator is paid whether or
not we make money.**

**The reframe the operator gave is better than the repo's own framing:** *"build risk
management so good that a user might as well take the trade at low risk to check
reliability."* That is precisely the falsification ladder (paper → micro → small with
real N). So this doc does **not** re-litigate D-071/D-072's "no *systematic* signal
survived costs" — that was a narrow, tested claim about backtested signals, not a claim
that skilled discretionary trading loses. This doc instead does what the operator asked:
quantifies the realistic profitability envelope, names the commercial risks, and
specifies **how CVD and OI plug into the risk gate as confidence levers** rather than as
standalone signals.

---

## Part 1 — What the channel actually is (verified from the live page)

- **[Certain]** Channel: **Elder Santis** (handle `@tradingelder`), **17.1k
  subscribers**. Target video: *"Beginners Guide To Start Day Trading In 2026 (2 hours)"*,
  **~30k views, ~1 yr old**.
- **[Certain]** Business model, verbatim from the description: **LIVE TRADING MENTORSHIP**
  (`mastertrader.info/yt`); **prop-firm affiliates** — Apex (`code "Elder"`), Tradeify
  (`ref=ELDER`); **Tradezella** journal affiliate (`fpr=elder47`); Instagram funnel.
- **[Certain]** Stated curriculum (from description): *market structure, supply & demand,
  order flow, volume, liquidity, price action, mindset, risk management*. Self-described
  *"full-time day trader for over a decade."* Includes a **futures-risk disclosure**
  (*"you can lose more than your initial investment"*).
- **[Likely]** This is a **discretionary order-flow / supply-demand** methodology, **not**
  a systematic/quant one. CVD and OI (the operator's interest) are *order-flow confluence*
  tools that fit this school — they are almost certainly used in the video as
  **confirmation layers on top of price structure**, not as mechanical triggers. This
  matches how the literature says they should be used (Part 3).

**Commercial-risk flag #1 (the affiliate funnel):** every prop-firm link is a paid
referral. Prop firms make most revenue from **evaluation fees of traders who fail**, not
from payouts (Part 2). A creator monetised on prop-firm signups has a structural
incentive to make the challenge look more passable than the data supports. Treat the
*strategy* content as a lead, the *"you can do this"* framing as marketing.

---

## Part 2 — How profitable can we realistically be? (the hard numbers)

### Retail day-trading / futures base rates — brutal, and primary-sourced

- **[Certain]** In the canonical Brazilian futures study, **~97% of retail day traders
  who persisted >300 days lost money**, and only **1.1% earned more than a bank teller**
  (Chague, De-Losso, Giovannetti — [SSRN 3423101](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3423101)).
- **[Certain]** The **CFTC's own review of retail traders in futures markets** confirms
  the population skews to losses ([CFTC, *Retail Traders in Futures Markets*](https://www.cftc.gov/sites/default/files/2024-11/Retail_Traders_Futures_V2_new_ada.pdf)).
- **[Certain]** Barber & Odean's landmark 66,465-account study: the **most active retail
  traders earned 11.4%/yr while the market did 17.9%** — activity *destroyed* ~6.5 pts/yr
  of return ([*Trading Is Hazardous to Your Wealth*](https://faculty.haas.berkeley.edu/odean/papers/returns/individual_investor_performance_final.pdf)).
- **[Likely]** Aggregators converge on **70–97% of day traders lose in year one; ~1–4%
  become consistently profitable; ~13% still active after 3 years**
  ([QuantifiedStrategies](https://www.quantifiedstrategies.com/day-trading-statistics/),
  [VettedPropFirms](https://vettedpropfirms.com/what-percentage-of-day-traders-lose-money/)).

### Prop-firm reality (the funnel this channel sells into)

- **[Likely]** Evaluation **pass rates ~5–15%**; only **~3–4% of all entrants ever reach
  a payout** ([QuantVPS](https://www.quantvps.com/blog/prop-firm-statistics),
  [AtmosFunded](https://atmosfunded.com/prop-firm-statistics/)). The prop-firm product is
  a **paid exam with a low pass rate**, not a job offer.

### Options — worse for retail, for structural reasons

- **[Certain]** Retail options traders **lose on average** in the peer-reviewed work;
  losses concentrate around **expected-volatility events (earnings)** where retail buys
  overpriced premium ([de Silva, *Losing Is Optional*](https://www.timdesilva.me/files/papers/losing_optional.pdf)).
- **[Likely]** Common aggregate estimate: **80–90% of retail options traders lose over
  time** ([CBOE research PDF](https://cdn.cboe.com/resources/education/research_publications/Retail_Profitability.pdf)
  — note CBOE's *own* framing is more favourable than academic proxies; the truth is
  methodology-sensitive, so treat 80–90% as directional, not precise).
- **[Certain — mechanism]** Options add **theta decay + volatility-premium + wider
  spreads** on top of directional risk. A long option can be *directionally right and
  still lose* to time and IV crush. This is why the Aegis ladder should reach **futures
  before options**: futures give clean linear exposure, centralised transparent volume
  (which is also what makes CVD/OI *work*), and no theta.

### The realistic envelope (what "profitable" can mean here)

- **[Guessing, but disciplined]** A *disciplined* discretionary trader with a real
  risk system is not in the 97% — they are in the **~1–5% tail**, and getting there is a
  **multi-year skill-acquisition problem**, not a strategy-download. The honest target is
  **not** "$1–2k/day" (D-072 re-anchor already killed that: it implies account-destroying
  leverage). The honest target is the repo's: **prove a small positive edge net of
  realistic costs on real N, then scale only what's proven.** CVD/OI raise *hit-rate
  conditional on a thesis*; they do not manufacture expectancy from nothing.

**Bottom line:** profitability is *possible* but *conditional* and *slow*. The dominant
failure mode is not "bad signal" — it is **overtrading + oversize + no kill-switch**.
That is exactly the surface the Aegis risk gate already owns.

---

## Part 3 — CVD and OI as confidence levers (the operator's core ask)

These are **not edges**. They are **confidence/context filters** — they change the
*conditional probability* that a price move has real participation behind it. Used
correctly they gate *when you are allowed to take a thesis*; used as triggers they lose.

### Cumulative Volume Delta (CVD)

- **[Certain]** CVD = running sum of (market-buy volume executed at ask − market-sell
  volume executed at bid). Positive/rising = net aggressive buying; negative/falling =
  net aggressive selling ([Bookmap](https://bookmap.com/blog/how-cumulative-volume-delta-transform-your-trading-strategy),
  [LuxAlgo](https://www.luxalgo.com/blog/cumulative-volume-delta-explained/)).
- **[Certain] The one high-value pattern — divergence:** price makes a **new high while
  CVD fails to** → the push is small-order-driven and large players are offloading →
  elevated reversal probability (and symmetrically at lows). This is the "trapped
  liquidity" read.
- **[Certain] Limitations that must be encoded as guardrails:**
  - Unreliable in **low liquidity / short timeframes** — a single large market order can
    inflate delta and fake a signal. **Higher timeframes (15m–1h) are more trustworthy.**
  - **Only valid on centralised-volume venues** (futures, major-exchange crypto).
    **Spot FX has no centralised volume → CVD is meaningless there.**
  - **Divergence signals "potential," and frequently fails to materialise** — it must be
    a *filter on a structural thesis*, never a standalone trigger.

### Open Interest (OI)

- **[Certain]** OI = total open futures/options contracts = **conviction/fuel** behind a
  move ([CME](https://www.cmegroup.com/education/courses/introduction-to-futures/open-interest),
  [Bookmap](https://bookmap.com/blog/interpreting-open-interest-in-futures-markets-for-better-trades)).
  The four-box read:
  - **Price ↑ + OI ↑** = new money backing the up-move → **strong continuation**.
  - **Price ↑ + OI ↓** = short-covering, no fresh longs → **weak / exhausting**.
  - **Price ↓ + OI ↑** = new shorts → **strong down-continuation**.
  - **Price ↓ + OI ↓** = long liquidation / profit-taking → **possible bounce**.
- **[Certain] Limitations:** OI **lacks price context alone**; **expiry/rollover spikes
  create false signals**; a rise in OI signals *a reversal is "near," not immediate.*
  Must be combined with price + volume.

### The confluence stack (how they compound)

- **[Likely]** The two are complementary: **CVD = who is aggressing right now (flow);
  OI = whether that flow is opening or closing exposure (commitment).** The
  highest-confidence read is when **structure + CVD + OI agree**: e.g. price at a
  supply zone, CVD bearish-diverging, OI falling on the rally (short-covering, no new
  longs) → high-confidence fade. **Alignment raises confidence; disagreement is a
  stand-aside signal, not a reverse signal.**

---

## Part 4 — Commercial risks and how to counteract them

| # | Commercial risk | Counter (encoded, not hoped) |
|---|---|---|
| 1 | **Narrator incentive** — creators earn from mentorship/affiliates regardless of our P&L | Treat all channel content as **leads, not truth**; verify every rule with real N on the ladder before sizing up |
| 2 | **Prop-firm funnel** — most entrants fail the paid eval; payout rate ~3–4% | If we ever use a prop firm, **model the eval fee as a guaranteed cost** and only enter with a strategy already proven on our own paper→micro record |
| 3 | **Overtrading** (the #1 real killer, not signal quality) | **No daily $ quota** (D-072); trade only on confluence-confirmed setups; hard cap on trades/session |
| 4 | **Oversizing / leverage** | Fixed-fractional risk per trade; **fully-losable weekly test capital ($20–50)**; broker balance = final backstop |
| 5 | **Options-specific bleed** (theta, IV crush, spreads) | **Futures before options** on the ladder; if options, only defined-risk structures and never long premium into earnings |
| 6 | **CVD/OI false signals** (low-liq, expiry, short-TF) | Encode guardrails: min-liquidity + min-timeframe (≥15m) filters; **suppress OI reads around expiry/rollover**; require CVD *and* structure, never CVD alone |
| 7 | **No durable kill-switch** | Aegis invariant already: kill-switch is a **Postgres row that survives restart**; MTM (unrealized) kill path on a timer |
| 8 | **Look-ahead / narrative-fit self-deception** | `trd_features.effective_date` + `asOf()`; every Sharpe reported next to its N; `trd_trial_counter` on every run |

---

## Part 5 — Recommendations (aligned to the ladder)

1. **[Do] Get the verbatim transcript** of BdQlFYSWl0I into the repo (operator paste)
   so the *specific* CVD/OI rules Elder teaches can be extracted as candidate filters —
   not signals. Then diff his risk rules against `RISK_POLICY.md`.
2. **[Do] Encode CVD + OI as a `trd_features` "confidence score," not a signal.** A
   0–1 confluence score (structure-agree + CVD-agree + OI-agree, with the
   low-liq/short-TF/expiry guardrails as hard zeros) that **gates position size**, not
   entry direction. This is the operator's "low-risk enough to check reliability" made
   concrete: high-confluence = allowed to take a micro-size live test; low-confluence =
   paper only.
3. **[Do] Futures before options** on the ladder — cleaner exposure, and it is the venue
   where CVD/OI are actually valid.
4. **[Don't] Believe any profitability claim without our own N.** The 97%/80–90% base
   rates are the prior; the ladder is how we find out if *we* are the exception.
5. **[Consider] The financier cross-link (D-072):** *"we studied the top trading
   educators, here's what their risk rules actually are, verified with receipts"* is
   honest, differentiated YGS finance content that funds the R&D — regardless of whether
   the trading edge clears the gate.

---

## Peer channels worth studying next (for risk-management, not signals)

Surfaced alongside the target video; prioritise the ones whose content is **risk/process**
over **P&L flex** (the flex channels are the affiliate-funnel tell):

- **SMB Capital** — *"The Only Day Trading Guide a Beginner Will Ever Need"* (desk-trained,
  process-heavy).
- **Ross Cameron / Warrior Trading** — *"27 Years of Trading Knowledge in 3h05m"*
  (also runs a paid-education funnel — same caveat as Elder).
- **Jason Graystone** — *"Trading for Beginners — Full Course"* (9.3M views; fundamentals).
- **Bookmap / LuxAlgo / QuantVPS blogs** — the *written* CVD/OI references above are more
  rigorous and citable than most video content.

> Every one of these has some monetisation funnel. The rule stands: **content is a lead;
> our own N is the truth.**

---

## Sources

- Chague/De-Losso/Giovannetti, *Day Trading for a Living?* — [SSRN 3423101](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3423101)
- CFTC, *Retail Traders in Futures Markets* — [PDF](https://www.cftc.gov/sites/default/files/2024-11/Retail_Traders_Futures_V2_new_ada.pdf)
- Barber & Odean, *Trading Is Hazardous to Your Wealth* — [PDF](https://faculty.haas.berkeley.edu/odean/papers/returns/individual_investor_performance_final.pdf)
- de Silva et al., *Losing Is Optional* (retail options) — [PDF](https://www.timdesilva.me/files/papers/losing_optional.pdf)
- CBOE, *New Evidence on the Performance of Customer Options Trades* — [PDF](https://cdn.cboe.com/resources/education/research_publications/Retail_Profitability.pdf)
- Day-trading stats — [QuantifiedStrategies](https://www.quantifiedstrategies.com/day-trading-statistics/), [VettedPropFirms](https://vettedpropfirms.com/what-percentage-of-day-traders-lose-money/)
- Prop-firm stats — [QuantVPS](https://www.quantvps.com/blog/prop-firm-statistics), [AtmosFunded](https://atmosfunded.com/prop-firm-statistics/)
- CVD — [Bookmap](https://bookmap.com/blog/how-cumulative-volume-delta-transform-your-trading-strategy), [LuxAlgo](https://www.luxalgo.com/blog/cumulative-volume-delta-explained/), [Incrypted](https://incrypted.com/en/how-use-cumulative-volume-delta/)
- Open Interest — [CME](https://www.cmegroup.com/education/courses/introduction-to-futures/open-interest), [Bookmap](https://bookmap.com/blog/interpreting-open-interest-in-futures-markets-for-better-trades), [Optimus Futures](https://optimusfutures.com/blog/volume-and-open-interest/)
- Target video — [Elder Santis, BdQlFYSWl0I](https://www.youtube.com/watch?v=BdQlFYSWl0I)
