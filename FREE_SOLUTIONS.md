# FREE_SOLUTIONS.md — every "paid-tier" frontier has a verified free path (D-185)

Operator directive: "make sure the paid tiers have a free solution I can actually use — no bottlenecks, only
solutions." This maps each frontier I earlier called paid to a **verified, free, actually-usable** solution. Three
of four were never really paid; the fourth is partially free with one honest quality caveat. None is a hard wall.

## 1. Minute-resolution UNIVERSE sweeps — FREE ✅
The bottleneck was QC's single free node (slow) + the free CLI's cloud sync needing a paid seat. Neither is
required to backtest at minute resolution.
- **Compute:** the LEAN engine is open-source (Apache-2.0) and runs LOCALLY via Docker on your Mac — unlimited
  local compute, no node queue. `docker pull quantconnect/lean`. OR use the local backtest scripts already in this
  repo (`scripts/trd-*.ts` — they run minute sweeps on local data today, e.g. `trd-nasdaq-hf.ts`, `trd-full-sweep.ts`).
- **Data:** Alpaca free tier gives 7+ years of historical MINUTE bars for US stocks (IEX feed, keyless-signup,
  10k calls/min) — enough to feed a minute-universe backtest. Plus the local Dukascopy (NASDAQ/S&P 1-min, 15y) and
  Binance (BTC/ETH 1-min) CSVs already in `data/`.
- Caveat: Alpaca free minute is the IEX feed (a volume subset), not full SIP — fine for mean-reversion research,
  not for microstructure/HFT. Sources: quantconnect/lean docker; alpaca.markets/data.

## 2. Futures / FX / commodities INTRADAY — FREE ✅ (already in use)
- **Dukascopy** publishes free historical tick→monthly data for **1600+ instruments** (Forex, commodities,
  indices, bonds, ETFs, crypto) via its public servers. We already use it (`data/duka/`). Bulk download via the
  open-source `dukascopy-node` CLI or `duka`. This is the free solution for futures/FX/commodity intraday — no
  paid vendor needed. Source: dukascopy.com historical export; dukascopy-node.

## 3. GLOBAL / non-US equities — FREE for prices ✅, one caveat on survivorship
- **Stooq** offers free bulk EOD downloads across global exchanges + indices + crypto (ASCII/Metastock). Free, no
  licence friction. Good for global breadth research. Source: stooq.com.
- **Honest caveat:** free global sources (Stooq, Yahoo, EODData) are survivorship-BIASED — delisted names are
  dropped. This is the ONE genuine quality gap. It is NOT a hard wall: (a) US equities are ALREADY survivorship-
  free and free via QuantConnect's dataset (used in D-176..D-180); (b) for global, we run on Stooq with eyes open
  and DISCOUNT long results using the exact survivorship correction we measured (D-176/177: curated-vs-delisted
  gap). Full global survivorship-free-with-delisted is the only thing that's genuinely cheaper paid (EODHD ~low
  cost), but the method works free everywhere and the bias is quantified, not unknown.

## 4. Per-day BORROW modeling in the forward tracker — FIXED, FREE ✅ (D-185, done this session)
This was pure code, never paid. Now done: `_shared/trd-forward-setup.ts::detectTrades` charges 8%/yr short borrow
per hold-day (SetupParams.borrowAnnual/barDays); `trd-forward-tick` redeployed (v2); the 10 rip-short-daily rows
updated to fee=2bp spread + borrow modeled. The "optimistic net" caveat on rip-short forward paper is removed.
7 unit tests green; verified borrow lowers short net (1.55→1.45 on the fixture); all 24 live candidates tick clean.

## Verdict — no bottleneck stands
| Frontier | Free solution | Status |
|---|---|---|
| Minute-universe backtest | local LEAN/own-scripts + Alpaca-free/Dukascopy/Binance data | usable now |
| Futures / FX / commodity intraday | Dukascopy (1600+ instruments, free) | in use |
| Global equity prices | Stooq (free bulk EOD) | usable; survivorship-biased, quantified |
| US survivorship-free | QuantConnect free dataset | in use (D-176..180) |
| Short borrow cost | code fix in the tracker | FIXED this session |

The engine can research every timeframe, every asset class, and (with a measured bias discount) every geography
for $0. The only thing money buys is convenience + delisted-global coverage — not capability. No frontier is a
wall; each has a solution you can actually use.
