# FRONTIER — mechanisms beyond the paradigm that has failed 2.9M times (opened 2026-09-02)

> Operator: *"we need to find ways beyond what we have explored."* Everything measured so far sits inside ONE
> paradigm — predict the next return of a liquid instrument and capture it before cost. That paradigm has 0 promoted
> of ~229 leads at 2.9M trials, and D-746 showed no budget changes that. "Beyond" therefore means a different
> MECHANISM OF PAYMENT, not another signal. This file is the open list; per the no-completeness rule it is never
> "done". Status: UNEXAMINED → PROBED (data reachable) → BUILDING → MEASURED (verdict in DECISIONS/lineage).

## The taxonomy — what pays, other than being right about direction

| mechanism of payment | why it is structurally different from what failed | examples | status |
|---|---|---|---|
| **Paid for providing a service** | no forecast needed; income is a fee for liquidity/balance-sheet/inventory | securities lending on your own long holdings; liquidity provision in wide-spread instruments | **MEASURED-BRACKET (D-752)**: broad ETF ~0 to the holder (fund keeps it); liquid single names 0.2–4.9%/yr on ASSUMED rates; CEF tercile ~0 (hard-to-borrow folklore refuted, 89/89). Rounding line on a small account. **Fees now MEASURED (D-752b, iBorrowDesk keyless, 194 names, growing ~100/day): liquid single names 0.14–0.35%/yr** — the 4.9% ceiling refuted; on-loan fraction still assumed. |
| **Paid for holding a risk nobody else wants at that size** | the premium is real and *known*; the only question is the tail and the instrument | VIX-futures roll (short front VX in contango); EM carry (D-741 — measured, research space) | VIX roll **MEASURED (D-749)**: A ruined margined (8 days), B ruined UNLEVERED (−112.6% of collateral, 2018-02-05), C null; not significant even gross; SPY dominates. Closed. |
| **Paid for being SMALL** (capacity-inverted) | institutions cannot participate, so the effect is not competed away by size | odd-lot tender priority (SC TO-I); tiny rights/stub situations | odd-lot **MEASURED (D-751)**: priority granted in 410/617 offers; clean era 2020+ — 50% priced above market (median premium −0.33%), positive subset ~5 events/yr at ~$205 → **~$2k/yr on ~$15k peak capital**; ceiling absolute at 99 shares. Real, retail-only, negligible. |
| **Paid for patience in a structurally mispriced wrapper** | the mispricing is observable (price vs NAV), long-only, mean-reverting by construction | closed-end fund discounts (Pontiff 1996) | CEF **CANDIDATE (D-750)**: widest-discount tercile +5.54%/yr excess over the universe, t 8.09, survives liquid tercile + both eras, money is discount convergence not NAV — but survivorship runs toward it (UPPER BOUND, attack running) and universe spread 1.62× (NOT IDENTIFIED). Forward clock registered. **Attacked (D-750b): hole = 52% of the 2010 universe; clean-window 2019+ excess ~4–5%/yr at t 3–5 (liquid t 3.3–3.8), still an upper bound; pessimistic reinstatement → ~0.** The first mechanism that did not die on contact — it shrank by a quarter. Companion clock REFUSED (D-750c): Test A t 12.56 = pseudo-replication, month-clustered t 1.54; no faster honest clock exists. |
| **Paid for knowing a RULE before the announcement** | index events with deterministic membership rules are predictable from public data — no announcement needed | Russell reconstitution (rank day → 4th Friday June); the S&P pop was UNTESTED for want of dates (D-740) | Russell **MEASURED-PROXY (D-748)**: cap path VOID (exposed the D-747 unit defect); $vol proxy shows adds −1.68% into recon, liquid t 0.09, 5 years, prior MISSED — proxy-null; re-run on true caps after D-747 |
| **Paid by the tax code / wrapper** | a certain, legislated return that markets cannot compete away | tax-loss harvesting; wrapper choice; currency-of-account (D-731, ~1.3pp/yr) | touched (D-731; TLH accrual analysed in the holdability work) — structural, operator-side |
| **Paid for forecasting VARIANCE, not direction** | variance is far more predictable than returns; the use is SIZING | vol-managed portfolios (D-532/566: equity time-underwater 5.8y → 2.8y; PASS 1 of 8 assets; FX negative) | MEASURED — a holdability tool, not a return tool; already in the sizer's family |
| **Paid for capital in a primary market** | issuance discounts / concessions exist because the issuer pays for certainty | IPO allocations (UK retail platforms), bond new-issue concession, rights-issue nil-paid | **MEASURED-US (D-754)**: allocated pop +20% mean (t 11), 73% of it in the top decile retail is scaled out of; the buyable first open → +250d is **−27.5% vs IWM, t −10**. A fee paid to allocation, not capital. UK (D-754b/c): buyable leg flat (t 0.46); allocated +12.9% (t 8), 78% before the first print; retail share UNTESTED (n=1 proxy). Both legs, both markets, MEASURED. |
| **Different market altogether** | different participants, different pricing failures (longshot bias) | prediction markets (Kalshi/Polymarket) | **MEASURED (D-753)**: Polymarket favourite leg clustered |t| ≤ 0.3 at every implementable horizon; longshot short LOSES; calibration sign MISSED (underdogs underpriced); Kalshi archive not public (3.1h of data), its t 6.6 same-bar. Null where testable, untested where closed, unplaceable from the UK. Closed. |
| **Information advantage that is legal and local** | the one edge the base rate does not touch: knowing a sector better than the marginal price-setter | operator domain (media/creator economy) fundamentals | UNMEASURABLE by this engine — it cannot test what it does not hold; noted so it is not mistaken for absence |

## Second wave (2026-09-02 evening) — mechanisms added after the first wave was measured
| mechanism of payment | why it is different | status |
|---|---|---|
| **absorbing FORCED selling** — index demotions (index funds must sell on the effective date); December tax-loss losers | the seller is price-insensitive by mandate or by tax calendar | **BUILDING** (`forced-selling.ts`: S&P removals held; panel held) |
| **holding cash with an option attached** — pre-deal SPAC shares below trust value | redeemable at trust; the downside is a T-bill, the upside a deal pop | **BUILDING** (`spac-trust.ts` from the 424B4 index) |
| **patience in a wrapper, second mechanism** — CEF tender offers at 98–100% of NAV | the discount is paid out to holders by the fund itself; often odd-lot priority | **MEASURED (D-755)**: 7.5% on the tendered slice, **0.8% of the position after proration**; odd-lot priority in 2/26 ($71 over 14y); the discount widens again; too rare to explain D-750. Closed. |
| rights issues (UK nil-paid rights) | forced sellers of rights at a discount to theoretical value | UNEXAMINED — LSE RNS text per issuer (host allowlisted) |
| UK retail-only instruments (NS&I Premium Bonds tax-free prize rate; ISA wrapper) | rates only a retail saver can get | UNEXAMINED — structural, quantify not test |
| covered-call / put-write (BXM, PUT) | already MEASURED long ago: worse than buy-and-hold (D-116/117) | closed |
| turn-of-month / calendar timing | already MEASURED: null (D-436) | closed |
**Continuity without Supabase (operator, same instruction):** worker owned-mode default, an owned-node cockpit
(`data/cockpit.html`, rendered each runner loop), and a 26th **sovereignty guard** that REDs on any live
*.supabase.co reference or a stale runner — BUILDING.

## The honest priors, stated before the results
- Each of the four BUILDING items is a *known* effect in the literature, so the question is not "is it there" but
  "what is left after cost, tail and capacity, in the placeable form, at small size" — the same four questions that
  killed everything else. Expect: VIX roll real-but-un-holdable (the tail); CEF real-but-small-and-illiquid; odd-lot
  real-but-tiny-$; Russell real-but-front-run-already since ~2010.
- A mechanism that survives is NOT a promotion. It goes on a forward clock like everything else (PRE-COMMITMENT LAW).
- The deposit arithmetic (D-746) still binds: below ~$60k of capital none of these outweighs the next deposit.
  Their value at this budget is *knowing*, and one or two hundred-dollar mechanisms that are genuinely retail-only.
