"""main.py — Aegis strategy runner INSIDE QuantConnect/LEAN, judged by the ported gate (aegis_gate.py).

WHAT THIS IS: a LEAN algorithm that runs the D-170 RSI mean-reversion family on LEAN's data and, at the end,
runs EVERY trade through the falsification gate (random-control test + Deflated Sharpe) — the same gate that
killed 859 anomalies. It places NO live orders: it books VIRTUAL trades (entry/stop/target R-multiples) so the
output is pure measurement, and simultaneously books matched RANDOM-entry controls (same instrument/direction/
mechanics) so the D-146 gate can run. This is the falsification engine, not an execution bot.

WHY LEAN: its universe is survivorship-free and point-in-time — the fix for METHODOLOGY_AUDIT.md flaw #1/#2.
Swap the single symbol for a universe selection to sweep thousands of names; the gate call is unchanged.

Uses the long-stable PascalCase LEAN Python API. See README.md to run.
"""
from AlgorithmImports import *
import random

from aegis_gate import edge_vs_random, deflated_sharpe, sharpe, skewness, kurtosis


class AegisGate(QCAlgorithm):

    def Initialize(self):
        self.SetStartDate(2018, 1, 1)
        self.SetEndDate(2026, 7, 31)
        self.SetCash(100000)

        # --- what to trade (swap for a universe to sweep every instrument) ---
        self.symbol = self.AddCrypto("BTCUSD", Resolution.Minute, Market.Coinbase).Symbol

        # --- strategy params (the D-170 survivor: short RSI>70 while below the 200-SMA) ---
        self.tf_minutes = 5
        self.rsi_thresh = 70
        self.ma_len = 200
        self.atr_len = 14
        self.stop_atr = 2.0
        self.tp_mult = 3.0            # try 5.0 too (D-172: 5R beat 3R on this entry)
        self.max_bars = 144
        self.fee_bps_side = 5.0       # D-170 survival gate: real only at <=5bp/side
        self.direction = -1           # short

        # --- indicators on a 5-minute consolidated bar ---
        self.rsi = RelativeStrengthIndex(14)
        self.ma = SimpleMovingAverage(self.ma_len)
        self.atr_ind = AverageTrueRange(self.atr_len)
        cons = TradeBarConsolidator(timedelta(minutes=self.tf_minutes))
        cons.DataConsolidated += self.OnBar
        self.SubscriptionManager.AddConsolidator(self.symbol, cons)

        self.rng = random.Random(999983)     # deterministic controls
        self.open_trades = []                 # virtual trades: {dir, entry, stop, tgt, bars, kind}
        self.setup_r = []
        self.control_r = []
        self.p_control = 0.01                 # open a random-timed control on ~1% of eligible bars (D-146 matched control)

    def _register(self, bar):
        self.rsi.Update(bar.EndTime, bar.Close)
        self.ma.Update(bar.EndTime, bar.Close)
        self.atr_ind.Update(bar)

    def _open(self, kind, direction, entry, sd):
        stop = entry - direction * sd
        tgt = entry + direction * sd * self.tp_mult
        self.open_trades.append({"dir": direction, "entry": entry, "stop": stop, "tgt": tgt, "sd": sd, "bars": 0, "kind": kind})

    def _close_r(self, tr, exit_price):
        r = tr["dir"] * (exit_price - tr["entry"]) / tr["sd"]
        cost = (tr["entry"] * (self.fee_bps_side / 10000.0) * 2) / tr["sd"]
        return r - cost

    def OnBar(self, sender, bar):
        self._register(bar)
        if not (self.rsi.IsReady and self.ma.IsReady and self.atr_ind.IsReady):
            return
        sd = self.stop_atr * self.atr_ind.Current.Value
        if not (sd > bar.Close * 1e-4):
            return

        # 1) manage open virtual trades against THIS bar (stop checked first — pessimistic)
        still = []
        for tr in self.open_trades:
            tr["bars"] += 1
            hit_stop = (bar.Low <= tr["stop"]) if tr["dir"] == 1 else (bar.High >= tr["stop"])
            hit_tgt = (bar.High >= tr["tgt"]) if tr["dir"] == 1 else (bar.Low <= tr["tgt"])
            if hit_stop:
                self._bucket(tr, self._close_r(tr, tr["stop"]))
            elif hit_tgt:
                self._bucket(tr, self._close_r(tr, tr["tgt"]))
            elif tr["bars"] >= self.max_bars:
                self._bucket(tr, self._close_r(tr, bar.Close))
            else:
                still.append(tr)
        self.open_trades = still

        # 2) the SETUP fires on its condition; the CONTROL fires at RANDOM times on eligible bars (same
        #    instrument/direction/mechanics) — a matched random-entry sample, not co-located with the setup.
        fire = (self.rsi.Current.Value > self.rsi_thresh and bar.Close < self.ma.Current.Value) if self.direction == -1 \
            else (self.rsi.Current.Value < (100 - self.rsi_thresh) and bar.Close > self.ma.Current.Value)
        if fire:
            self._open("setup", self.direction, bar.Close, sd)
        if self.rng.random() < self.p_control:
            self._open("control", self.direction, bar.Close, sd)

    def _bucket(self, tr, r):
        (self.setup_r if tr["kind"] == "setup" else self.control_r).append(r)

    def OnEndOfAlgorithm(self):
        # flush any still-open virtual trades at last price
        px = self.Securities[self.symbol].Price
        for tr in self.open_trades:
            self._bucket(tr, self._close_r(tr, px))
        g = edge_vs_random(self.setup_r, self.control_r)
        sr = sharpe(self.setup_r) if len(self.setup_r) > 1 else 0.0
        dsr = deflated_sharpe(sr, len(self.setup_r), skewness(self.setup_r), kurtosis(self.setup_r), 92, 0.25) \
            if len(self.setup_r) > 3 else float("nan")
        self.Log("================ AEGIS GATE VERDICT ================")
        self.Log(f"setup trades: {len(self.setup_r)}   controls: {len(self.control_r)}")
        self.Log(f"net mean R @ {self.fee_bps_side}bp/side: setup {g['setupMean']}  control {g['controlMean']}")
        self.Log(f"edge vs random: {g['edge']}R   t = {g['tStat']}   PASSES = {g['passes']}")
        self.Log(f"per-trade Sharpe {sr:.4f}   Deflated Sharpe(92 trials, uncalibrated var) {dsr}")
        self.Log(f"VERDICT: {g['verdict']}")
        self.Log("NOTE: DSR here needs the real variance of the trial Sharpes to be meaningful; the")
        self.Log("random-control t is the operative gate (D-146). No live orders were placed — virtual measurement only.")
