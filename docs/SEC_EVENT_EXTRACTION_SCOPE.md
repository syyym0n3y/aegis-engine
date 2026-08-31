# SEC-filing event-extraction build — scope (D-732)

Unlocks up to 5 untested approaches (coverage map): merger arbitrage, spin-offs, IPO/lockup, SPAC/de-SPAC, index
inclusion. Scoped against live holdings; the obstacles below are **measured, not assumed**.

## Foundation (DONE this session)
- **`trd_cik_ticker` populated** — 8,004 current CIK→ticker mappings from SEC `company_tickers.json` (allowlisted
  www.sec.gov). This is the resolver every event study needs to join a filing to a price series. Reusable, refreshable.
- Verified: `AAPL → CIK 0000320193`. Limitation: it is the CURRENT map — **delisted** companies are absent, so
  historical events whose party has since delisted resolve only via the expanded price panel's own symbols.

## The universal obstacle, measured
An event study needs `(ticker, event_date)`. Our raw filings (`trd_raw_filings`: 14,757 going-concern 10-Ks, 1,526
spin-off 10-12Bs) carry **accession + filing_date + category but no resolved ticker**. Resolution rates:
- **Spin-offs via accession-prefix CIK: 39 / 1,526 = 2.6%.** The accession prefix is the FILING AGENT (a law firm),
  not the registrant, ~97% of the time — AND a spinco is **not yet listed** when it files its 10-12B, so its ticker
  is not in the filing metadata at all. Spin-off resolution is therefore genuinely hard: it needs the registrant CIK
  from EDGAR submission metadata (data.sec.gov, NOT currently allowlisted) plus a post-listing ticker match.

## Tractability by approach (measured, not guessed)
| approach | parties listed at filing? | filings held? | verdict |
|---|---|---|---|
| **merger arbitrage** | YES (acquirer + target both listed) | NO (8-K 1.01/2.01 not ingested) | **most tractable** — FTS returns tickers in `display_names`; needs a fresh FTS ingest then event study |
| **SPAC / de-SPAC** | PARTLY (SPAC trades pre-merger) | NO | tractable after a targeted FTS ingest |
| **spin-offs** | NO (spinco unlisted at 10-12B) | YES (1,526) | blocked on registrant-CIK resolution — needs data.sec.gov submissions metadata (allowlist) or name-matching |
| **IPO / lockup** | NO (issuer unlisted at S-1) | NO | same block as spin-offs + a fresh S-1/424B ingest |
| **index inclusion** | n/a | NO | NOT an EDGAR event — needs S&P/FTSE-Russell reconstitution data (separate source) |

## Phased plan (each phase is a fresh-context unit — this is a multi-session build)
- **Phase 0 — CIK map. DONE.**
- **Phase 1 — merger arb (most tractable).** Run `ingest-edgar-fts.ts` for 8-K item 1.01 + 2.01 with ticker capture
  (`tickerOf(display_names)` already exists in that script). Extract (acquirer, target, announce_date). Event study:
  target announcement drift and deal-completion spread, in the LIQUID tercile, benchmarked, costed. Expected honest
  outcome per the programme's priors: a real but capacity-/cost-bound announcement pop, no residual edge post-costs.
- **Phase 2 — SPAC/de-SPAC.** Targeted FTS ingest; de-SPAC completion event study (the well-documented post-merger
  underperformance).
- **Phase 3 — spin-offs.** Resolve registrant CIK: allowlist data.sec.gov submissions API, map accession→registrant
  CIK→ticker (post-listing), OR fuzzy-match filer name→ticker. Then the Cusatis-Miles-Woolridge spinco-outperformance
  event study on the now-survivorship-complete panel.
- **Phase 4 — IPO/lockup.** S-1/424B ingest + issuer-CIK resolution; 180-day lockup-expiry event study.
- **index inclusion** — deferred: needs a non-EDGAR index-reconstitution source.

## Why phased and not one push
Each phase is a distinct ingest + resolver + event study with its own data obstacle (measured above). The resolution
obstacle for spin-offs/IPOs (registrant CIK, allowlist) is real and not a one-liner. Grinding all four in one session
at depth is exactly the failure mode that produced this session's ETF-clobber incident. Phase 1 (merger arb) is the
clean next unit; the CIK-map foundation it depends on is now in place.
