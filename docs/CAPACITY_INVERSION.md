# CAPACITY INVERSION — the search space, derived rather than remembered (D-838, 2026-09-08)

> **Why this document exists.** D-836 concluded that no methodology fix produces a 10^7 outcome and that widening what
> we ask beats tightening how we test. D-834 found the reason to believe it: **the only mechanisms that survived ten
> weeks of measurement are ones institutions structurally cannot do**, and both were found by accident while looking
> elsewhere. If that is the productive class, it should be searched systematically instead of stumbled upon.
>
> So this does not list ideas I happen to remember. It derives **why capacity inversion happens**, and uses each
> generator to produce candidates — including ones nobody has proposed. It is the queue the hunt continues from.

## The generators — why a mechanism can pay a small holder and not a large one

| # | generator | the structural reason it cannot be competed away | candidates | status |
|---|---|---|---|---|
| **G1** | **A rule grants priority to small holders** | the priority is written into the offer document; scaling into it destroys eligibility | odd-lot tender priority | **MEASURED REAL** (D-751): ~13%/yr on capital employed, 410 of 617 offers; UK broker access UNVERIFIED |
| **G2** | **A hard cap on participation size** | the cap is regulatory or contractual, so size cannot enter at all | UK regular-saver accounts; NS&I Premium Bonds; retail-only deposit rates | **QUANTIFIED** (D-758) for the wrapper; the rate products are arithmetic, not market claims, and are the operator's to use |
| **G3** | **Total market capacity below an institutional minimum ticket** | the whole opportunity is smaller than one fund's smallest position | pre-deal SPAC trust | **MEASURED REAL** (D-760): ~3%/yr over bills, 98% of positions positive, whole-market capacity a few hundred thousand dollars |
| **G4** | **Fixed per-event costs make small events uneconomic for anyone paying institutional overheads** | the edge is real but each instance is worth less than an analyst-hour | **reverse-split round-ups** | **TESTED TODAY — NULL** (D-837): real and recurring at 176 events/yr, but $1.63 per event after a $1 commission. Size, not realisability, is the constraint |
| **G5** | **Regulatory access asymmetry** | some products are retail-only; some are institution-only | retail-only platforms; and the INVERSE — UK retail is banned from crypto derivatives (D-823f), which removes 5 of 12 instruments from our own micro rung | partly mapped |
| **G6** | **Customer-acquisition subsidies** | a firm pays to acquire a person, not capital; it cannot pay a fund the same way | current-account switching incentives; broker sign-up offers; introductory rates | **NOT TESTED — and not market data.** These are certain, retail-only, and for a small account can exceed every edge in this record. Arithmetic, verifiable only against live offers |
| **G7** | **Rounding rules that favour the small holder** | rounding is applied per holder, so the benefit is fixed per person rather than per pound | merger odd-lot provisions; fractional round-ups; minimum allocations | **QUEUED** — same data path as D-837 |
| **G8** | **Attention cost nobody will pay for a small sum** | the claim is free but must be made by a person | class-action settlement claims on shares held; unclaimed corporate-action elections | **QUEUED** — not measurable from price data; needs a holdings list |

## What the generators say once assembled

**Three of eight are measured real** (G1, G2, G3). **One was tested today and is null on size** (G4). **Four have never
been tested here** (G5 partly, G6, G7, G8), and G6 and G8 are not market-data questions at all — which is precisely why
a market-data engine never asked them.

**The pattern across the real ones is exact and worth stating as a rule:** every surviving mechanism pays a **fixed
amount per holder or per event**, not a rate on capital. That is the mathematical signature of capacity inversion, and
it has two consequences. It is why they cannot be scaled — and it is why they are worth *more*, not less, to an account
starting near zero. It also sets the ceiling honestly: a fixed amount per event times a countable number of events is a
bounded number, and no amount of it compounds into 10^7 on its own.

## The queue, in the order the evidence justifies

1. **The broker question — PARTLY ANSWERED FROM PUBLISHED SOURCES, 2026-09-08 (D-839), and much narrower now.**
   - **Pass-through exists and is self-service.** Interactive Brokers' own documentation states the Corporate Action
     Manager lets a client "review information on upcoming mandatory and voluntary corporate actions relating to
     positions held in the account, and submit elections to IB for voluntary offers." **No fee is stated for an on-time
     election**; a late/after-deadline request carries a fee (AUD 100 quoted). Instructions are due ~5 days before
     expiry. So "does a broker pass tender offers through" is answered: at IBKR, documented as yes.
   - **Odd-lot priority explicitly covers BENEFICIAL owners, not just record holders.** The standard offer language
     across SEC tender filings grants priority to "any person who owns **beneficially or of record** an aggregate of
     fewer than 100 shares **and so certifies** in the appropriate place on the Letter of Transmittal." A street-name
     holder therefore qualifies **by the terms of the offer itself** — which was the thing this record had been
     treating as unknown.
   - **Two operational constraints that came with it, and they bind.** The holder must tender **ALL** shares owned (no
     tendering 99 of 150), and ownership is **aggregated across accounts** — the priority "is not available to partial
     tenders or to beneficial or record holders of an aggregate of 100 or more shares, even if these holders have
     separate accounts."
   - **WHAT IS STILL GENUINELY OPEN, and it is now one precise question:** does the broker's election tool **transmit
     the odd-lot certification** on the client's behalf? The entitlement exists; whether the plumbing carries it is not
     in any published document I could find. That is a support-ticket question with a yes/no answer.
   - **US SPAC commons (G3):** PRIIPs/KID blocks US-domiciled **ETFs** for UK retail, but PRIIPs governs *packaged*
     products and ordinary shares are not packaged — so SPAC **commons** should be reachable while **units and
     warrants** may not be. **NOT confirmed from a primary source**; recorded as likely, not established.
2. **G7 — merger odd-lot and rounding provisions.** Same data path as D-837, and the per-event value is plausibly far
   larger because merger considerations are settled in cash at a stated price.
3. **G6 — acquisition subsidies.** Not a market test. For an account of a few thousand pounds these are large,
   certain and retail-only, and the record has never counted them because they are not in a price series.
4. **G8 — attention-cost claims.** Requires a holdings list, so it follows an account rather than preceding one.

## What this document does not claim

None of this is an edge until the broker question is answered, and G4's null is the warning: a mechanism can be real,
recurring, structurally sound and still worth $1.63. **The generators tell us where to look; they do not promise
anything is there.** Every candidate above enters through a pre-registration like any other claim.
