# OPERATOR QUEUE — regenerated 2026-09-23T03:35Z (D-854)

> The one page to read. Everything a session could move on its own has been moved; what is listed under **Yours** cannot be done by Claude (accounts, deposits, fills, a support ticket) and is the whole of what stands between this record and its first real fill. Regenerated at the end of every daily cycle by `scripts/operator-queue.ts`.

## Board — **1 RED** (32 guards, board logged 0.0h ago)
- RED   log-triage     RED — 1 NEW error class(es) since the baseline. Read eac

## Micro rung — live feed and sheet
- hourly FX/index feed: **7/7 fresh within 3h** · sheet: **1 candidate(s); 0 instrument(s) STALE; 12 instruments live** · manual fills recorded: **0** · kill-switch rows: 2
- the sheet prints candidates only on fresh bars; a STALE instrument prints no candidate by design.

## Yours — in evidence order, each with its exact act
1. **Broker ticket (gates D-751 odd-lot tenders, the only measured capacity-inverted mechanism):** ask IBKR support one question — *"When I submit a voluntary tender election through Corporate Action Manager on a holding under 100 shares, is the odd-lot certification transmitted to the tender agent?"* Yes/No. Record the answer with `ADD=1 REASON="broker: <answer>" deno run --allow-net --allow-env scripts/micro-ledger.ts` or paste it into DECISIONS.md under D-839.
2. **The reachable sign-up set (D-851, ~£150–£400 once, non-compounding):** IG (£500 deposit → £50–£1,000 bonus shares, hold to 31 Dec 2026), Trading 212 (£1 → free share), InvestEngine (£100 → £20–£100, 12-month hold), Freetrade (£50 → £10–£100). Each is one per person and a one-off. Claude never opens or funds an account; if you do, note each in the wealth ledger.
3. **First hand-placed fill:** set the budget and arm — `MICRO_BUDGET=<£> ARM=1 REASON="first fill" deno run --allow-net --allow-env scripts/micro-ledger.ts` — then read `data/micro-sheet.log` at :05 past the hour and place only what it prints as a candidate. Record every fill with `ADD=1`. Thirty fills is an OPERATIONAL review, never an expectancy test (D-832).
4. **Three wealth-ledger rows (D-735/746/758):** deposits × wrapper are the certain money and are unlogged because they are boring.
5. **File every settlement notice on any US-listed position you ever hold (D-852):** 75% of eligible investors never do; it is free money with a deadline, not a mechanism.

## Forward clocks — 34 registered, none may be re-mined
| clock | started | latest reading | n | note |
|---|---|---|---|---|
| fwd-book-p2-paper | 2026-08-24 | not yet computable | 0 | trd_paper_book holds ZERO marks; the French panel ends 2026-06 so the first markable month has not occurred |
| fwd-canonical-premia-blend | 2026-09-15 | not yet computable | - | elapsed 8d of 365d horizon (Score after >=250 fresh trading days (data past 2026-09-15) ) |
| fwd-cef-discount | 2026-09-01 | not yet computable | 0 | 0 scored month(s) since 2026-09; the rule permits a magnitude decision only at >=24 (~2028-08). ACCRUING — not |
| fwd-crypto-lit5 | 2026-08-24 | not yet computable | 30 | 30 calendar day(s) elapsed of the 250 TRADING days the rule requires; forward table last stamped 2026-09-23 |
| fwd-despac-underperf | 2026-08-31 | not yet computable | 0 | 0 new de-SPACs with 500d since 2026-08-31; rule needs >=15. Post-boom de-SPAC volume is low — may stay inconcl |
| fwd-despac-underperf-v2 | 2026-09-02 | not yet computable | 0 | 0 new de-SPACs (5.06 dated) with 500d since 2026-09-02; rule needs >=15. First possible read ~2028-09; post-bo |
| fwd-direction-4h-xrp-bnb-makerin-takerout | 2026-09-13 | not yet computable | 42 | 42 forward trade(s) since 2026-09-13; the kill clauses read at 200 and the promote clause at 400. not-yet-comp |
| fwd-distress-blend-combined | 2026-09-16 | not yet computable | - | elapsed 7d of 365d horizon (~250+ trading days from 2026-09-16 (first decisive read ~202) |
| fwd-distress-ivol-blend-5 | 2026-09-16 | not yet computable | - | elapsed 7d of 365d horizon (~250+ trading days from 2026-09-16 (first decisive read ~202) |
| fwd-eq-belowPML-liquid-K5-day-clustered | 2026-09-04 | not yet computable | 9 | 9 forward event-days since 2026-09-04 (rule requires >=150 for kill or >=200 for promote). not-yet-computable. |
| fwd-etf-trend-timing | 2026-09-13 | not yet computable | 10 | 10 paper day(s) since 2026-09-13; first read at 12 months (drawdown claim — needs a drawdown to have happened) |
| fwd-fourfactor-blend-gcshort | 2026-09-16 | not yet computable | - | elapsed 7d of 365d horizon (Score after >=250 fresh trading days past 2026-09-16 or 2027) |
| fwd-ftd-persistence-short | 2026-08-26 | not yet computable | 28 | 28 day(s) of the 728 required. Scored by scripts/ftd-persistence.ts with FROM_D=2026-08-26 and LIQUID_ONLY=1. |
| fwd-goingconcern-distress | 2026-09-15 | not yet computable | - | elapsed 8d of 365d horizon (Score after >=100 fresh going-concern 10-K filings past 2026) |
| fwd-gold-rangeext-cont-k24 | 2026-09-13 | not yet computable | 0 | 0 closed paper fill(s) since 2026-09-13 (0 open); rule first reads at 150, decides at 400 (~0.6/day historical |
| fwd-hedging-pressure-flip | 2026-08-26 | not yet computable | 28 | 28 day(s) of the 728 required. Scored by scripts/cot-crosssectional.ts and tff-crosssectional.ts with FROM_D s |
| fwd-isa-crypto-parity | 2026-09-13 | not yet computable | 10 | 10 paper day(s) since 2026-09-13 (~0.5 months); first read at 12 months, decision at 24. not-yet-computable, N |
| fwd-latefiling-distress | 2026-09-16 | not yet computable | - | elapsed 7d of 365d horizon (Score after >=100 fresh NT filings past 2026-09-16 accrue >=) |
| fwd-nt-late-avoid | 2026-09-02 | not yet computable | 0 | 0 new liquid-tercile NT events with 250d since 2026-09-02; rule needs >=50. Accrues ~2000 NT/yr; first read ~2 |
| fwd-onchain-fee-momentum | 2026-09-15 | not yet computable | - | elapsed 8d of 365d horizon (Score after >=52 fresh non-overlapping weekly observations p) |
| fwd-payout-8 | 2026-08-22 | not yet computable | 32 | 32 day(s) elapsed; rule needs >=12 scored months (~365d) |
| fwd-persist-real-K24 | 2026-09-03 | not yet computable | 1 | 1 forward persist(real)+PSL-fade events since 2026-09-03 across 0 crypto with >=20; rule needs >=200 pooled to |
| fwd-placeable-psl-fade-k24 | 2026-09-08 | not yet computable | 42 | 42 forward event(s) since 2026-09-08 across 3 placeable instrument(s); the rule's first read is at 250 and its |
| fwd-prop-ftmo100k-utc16-0p5x-v1 | 2026-09-06 | not yet computable | 0 | ledger empty since registration 2026-09-06: fee unpaid, no evaluation started. not-yet-computable, NOT inconcl |
| fwd-psl-fade | 2026-09-03 | not yet computable | 228 | 228 forward PSL-fade events since 2026-09-03 across 3 instrument(s) with >=20; rule needs >=1000 pooled (~6 mo |
| fwd-residual-follow | 2026-08-24 | not yet computable | 13 | 13 attribution stamp(s) since the clock start. UNDERPOWERED BY CONSTRUCTION until the stamps are daily: the ru |
| fwd-spinoff-premium | 2026-08-31 | not yet computable | 0 | 0 new liquid spincos with full 500d forward data since 2026-08-31; rule needs >=20 (~3-4y to accrue). not-yet- |
| fwd-three-factor-blend | 2026-09-15 | not yet computable | - | elapsed 8d of 365d horizon (Score after >=250 fresh trading days past 2026-09-15 or 2027) |
| fwd-trend-long-parity | 2026-09-13 | not yet computable | 10 | 10 paper day(s) since 2026-09-13 (~0.5 months); first read at 12 months, decision at 24. not-yet-computable, N |
| fwd-tsmom-110 | 2026-09-13 | not yet computable | 10 | 10 paper day(s) since 2026-09-13 (~0.5 months); first read at 12 months, decision at 24. not-yet-computable, N |
| fwd-utc01-sweepPDL-reclaim-long-K6-panel17 | 2026-09-04 | not yet computable | 14 | 14 forward events since 2026-09-04 on the 17-panel; below 30, not-yet-computable (rule floors: kill at n>=250, |
| fwd-utc09to10-belowPDL-long-K6-panel17 | 2026-09-04 | 60.219 | 74 | 74 forward events since 2026-09-04: pooled net 60.22bp, gross t 3.45, 13/17 instruments positive (of 17). belo |
| fwd-utc16-abovePDH-long-K6-panel17 | 2026-09-04 | 34.093 | 69 | 69 forward events since 2026-09-04: pooled net 34.09bp, gross t 2.05, 9/17 instruments positive (of 17). below |
| fwd-xmr-asia-rangefade | 2026-09-15 | not yet computable | - | elapsed 8d of 365d horizon (Score after >=150 fresh out-of-sample trades accrue (data pa) |

## If you want the sessions to run without you
A session's job is now: read this page, fix any RED the guard output names, commit, regenerate. That is a routine, not a conversation. To arm it (it spends, so it is not created for you): in Claude Code run `/schedule` and give it — *"In /Users/ona/Projects/aegis: run `bash scripts/guard-status.sh` and `deno run --allow-net --allow-env --allow-read --allow-write --allow-run scripts/log-triage-guard.ts`; for every RED, read the guard's own output, fix the cause, verify the guard green, commit with a D-entry; then regenerate docs/OPERATOR_QUEUE.md. Never open accounts, deposit, or place orders. Stop when the board is green."* — daily, after the 02:00 UTC cycle.

## What this page will not do
It will not tell you a strategy is ready. Nothing has cleared the gates (D-070: that is the engine working), and the numbers that matter at this account's scale are per head, not per pound (D-834/851).
