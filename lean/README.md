# lean/ — Aegis gate ported to QuantConnect/LEAN

The falsification **gate** (random-control test D-146 + Deflated Sharpe + PBO/CSCV), ported byte-faithfully from
`supabase/functions/_shared/trd-stats.ts` + `trd-random-control.ts` to Python, so it can run inside LEAN over a
**survivorship-free, point-in-time universe** — the fix for `METHODOLOGY_AUDIT.md` flaws #1/#2 (survivorship +
universe breadth). The gate is the IP; LEAN is the sandbox.

## Files
- `aegis_gate.py` — the ported gate (pure stdlib; drops into LEAN's Python runtime).
- `test_aegis_gate.py` — **parity** vs the TS original on shared fixtures + unit tests. This is the proof the port is faithful.
- `run_gate_on_csv.py` — end-to-end: runs the D-170 survivor on our local Binance CSV through the Python gate; reproduces +0.145R @5bp, t≈7.
- `main.py` — the LEAN algorithm: runs the strategy, books virtual setup + matched random-control trades, calls the gate in `OnEndOfAlgorithm`. **No live orders** — virtual measurement only.
- `config.json` — LEAN project config.

## Verify the port locally (no LEAN, no account needed)
```bash
# 1) regenerate the TS reference on shared fixtures (writes /tmp/ts_out.json + /tmp/fixtures.json)
deno run --allow-read --allow-write /tmp/ts_gate_dump.ts > /tmp/ts_out.json    # script in repo history; see D-174
# 2) assert the Python gate matches the TS gate exactly
python3 lean/test_aegis_gate.py
# 3) reproduce the D-170 survivor through the Python gate
python3 lean/run_gate_on_csv.py
```

## Run on LEAN (operator — I cannot create the QuantConnect account)
LEAN's survivorship-free data lives on QuantConnect cloud (free tier) or via a local data subscription. Steps:
```bash
pip install lean                       # the LEAN CLI
lean login                             # QuantConnect account (create at quantconnect.com — free tier)
lean project-create "AegisGate" --language python
cp lean/main.py lean/aegis_gate.py "AegisGate/"     # drop the algo + gate into the project
lean cloud push --project "AegisGate"
lean cloud backtest "AegisGate" --open              # runs on QC's survivorship-free data
```
Read the `AEGIS GATE VERDICT` block in the backtest log: `edge vs random ... t ... PASSES`. That is the D-146
gate speaking on point-in-time data.

## To sweep every instrument (the whole point)
In `main.py`, replace the single `AddCrypto(...)` with a LEAN **universe selection** (e.g. coarse US-equity
universe, or a futures/FX chain) and route each symbol's virtual trades into per-symbol `setup_r`/`control_r`
buckets. The gate call is unchanged. That is "chart every market" done for real — survivorship-free, point-in-time,
and it runs without hand-rolled CSV loaders. Feed anything that PASSES into the live `trd_forward` tracker (D-171).

## Honest caveats (see METHODOLOGY_AUDIT.md)
- **DSR calibration:** `deflated_sharpe(...)` needs the real variance of the trial Sharpes; `main.py` passes a
  placeholder (0.25), so treat the **random-control t** as the operative gate until DSR is calibrated per sweep.
- **Data-source discrepancy:** the survivor was measured on Binance; LEAN crypto is Coinbase/Bitfinex — a small
  feed difference the forward test itself will expose. Equities/futures on LEAN are the real prize (survivorship-free).
- **No look-ahead:** indicators update on closed consolidated bars; virtual entries use the signal bar's close as a
  proxy for the next fill. For live-grade fills, enter on the next bar open (a one-line change).
