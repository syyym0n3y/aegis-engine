"""main.py — Aegis DAILY survivorship-free US-equity universe sweep, judged by the ported gate (aegis_gate.py).

WHY THIS SHAPE: QuantConnect's US-equity data is survivorship-bias-free (delisted names included, back to 1998)
and FREE — the exact fix for METHODOLOGY_AUDIT.md flaws #1/#2. Running it at DAILY resolution (not the minute
crypto that choked the free node) makes a whole-universe sweep tractable on the free tier. The strategy is the
ONE edge that ever beat a random control in-sample (D-146): the dip-buy — long when RSI(14) < 30 while price is
above its 200-day SMA — now tested across the liquid universe INCLUDING delisted names. TP = 3R, 2*ATR stop.

Discipline: books VIRTUAL trades only (no live orders) plus matched RANDOM-timed controls, so the D-146 gate
runs at OnEndOfAlgorithm. No look-ahead — indicators are auto-updated on closed daily bars; entries are the
next bar. Swap UNIVERSE_SIZE / dates to widen. Uses the long-stable PascalCase LEAN Python API.
"""
from AlgorithmImports import *
import random

from aegis_gate import edge_vs_random, deflated_sharpe, sharpe, skewness, kurtosis

UNIVERSE_SIZE = 100      # top-N by dollar volume, refreshed monthly (stable large/mid caps)
RSI_LEN, MA_LEN, ATR_LEN = 14, 200, 14
RSI_BUY = 30             # dip-buy trigger
STOP_ATR, TP_MULT = 2.0, 3.0
MAX_HOLD = 20            # trading-day cap on a virtual trade (~1 month)
FEE_BPS_SIDE = 2.0       # liquid US equity daily round-trip ≈ 2bp/side (pessimistic-ish, $0 commission era)
P_CONTROL = 0.002        # random-timed control probability per eligible symbol-bar (D-146 matched control)


class AegisEquitySweep(QCAlgorithm):

    def Initialize(self):
        self.SetStartDate(2010, 1, 1)
        self.SetEndDate(2026, 7, 31)
        self.SetCash(100000)

        self.UniverseSettings.Resolution = Resolution.Daily
        self.AddUniverse(self.CoarseFilter)
        self.SetWarmUp(MA_LEN + 5, Resolution.Daily)

        self.ind = {}            # symbol -> {"rsi","sma","atr"}
        self.open_trades = []    # {symbol, entry, stop, tgt, days, kind}
        self.setup_r = []
        self.control_r = []
        self.rng = random.Random(20260807)
        self.symbols_seen = set()
        self._month = -1

    # refresh the universe monthly to keep it stable and cheap
    def CoarseFilter(self, coarse):
        if self.Time.month == self._month:
            return Universe.Unchanged
        self._month = self.Time.month
        filtered = [c for c in coarse if c.HasFundamentalData and c.Price > 5 and c.DollarVolume > 0]
        filtered.sort(key=lambda c: c.DollarVolume, reverse=True)
        return [c.Symbol for c in filtered[:UNIVERSE_SIZE]]

    def OnSecuritiesChanged(self, changes):
        for s in changes.AddedSecurities:
            sym = s.Symbol
            if sym in self.ind:
                continue
            self.ind[sym] = {
                "rsi": self.RSI(sym, RSI_LEN, MovingAverageType.Wilders, Resolution.Daily),
                "sma": self.SMA(sym, MA_LEN, Resolution.Daily),
                "atr": self.ATR(sym, ATR_LEN, MovingAverageType.Simple, Resolution.Daily),
            }
            self.symbols_seen.add(sym)
        for s in changes.RemovedSecurities:
            self.ind.pop(s.Symbol, None)

    def _open(self, symbol, entry, sd, kind):
        self.open_trades.append({"symbol": symbol, "entry": entry, "stop": entry - sd,
                                 "tgt": entry + sd * TP_MULT, "sd": sd, "days": 0, "kind": kind})

    def _close_r(self, tr, exit_price):
        r = (exit_price - tr["entry"]) / tr["sd"]
        cost = (tr["entry"] * (FEE_BPS_SIDE / 10000.0) * 2) / tr["sd"]
        return r - cost

    def _bucket(self, tr, r):
        (self.setup_r if tr["kind"] == "setup" else self.control_r).append(r)

    def OnData(self, data):
        if self.IsWarmingUp:
            return
        # 1) manage open virtual trades against today's bars (stop checked first — pessimistic)
        still = []
        for tr in self.open_trades:
            bar = data.Bars.get(tr["symbol"])
            if bar is None:
                still.append(tr)
                continue
            tr["days"] += 1
            if bar.Low <= tr["stop"]:
                self._bucket(tr, self._close_r(tr, tr["stop"]))
            elif bar.High >= tr["tgt"]:
                self._bucket(tr, self._close_r(tr, tr["tgt"]))
            elif tr["days"] >= MAX_HOLD:
                self._bucket(tr, self._close_r(tr, bar.Close))
            else:
                still.append(tr)
        self.open_trades = still

        # 2) scan the universe for the dip-buy setup + random-timed controls
        for sym, ind in self.ind.items():
            bar = data.Bars.get(sym)
            if bar is None or not (ind["rsi"].IsReady and ind["sma"].IsReady and ind["atr"].IsReady):
                continue
            sd = STOP_ATR * ind["atr"].Current.Value
            if not (sd > bar.Close * 1e-4):
                continue
            if ind["rsi"].Current.Value < RSI_BUY and bar.Close > ind["sma"].Current.Value:
                self._open(sym, bar.Close, sd, "setup")
            if self.rng.random() < P_CONTROL:
                self._open(sym, bar.Close, sd, "control")

    def OnEndOfAlgorithm(self):
        for tr in self.open_trades:
            px = self.Securities[tr["symbol"]].Price
            if px > 0:
                self._bucket(tr, self._close_r(tr, px))
        g = edge_vs_random(self.setup_r, self.control_r)
        sr = sharpe(self.setup_r) if len(self.setup_r) > 1 else 0.0
        n_trials = max(2, len(self.symbols_seen))
        dsr = deflated_sharpe(sr, len(self.setup_r), skewness(self.setup_r), kurtosis(self.setup_r), n_trials, 0.25) \
            if len(self.setup_r) > 3 else float("nan")
        self.Log("================ AEGIS GATE VERDICT (daily survivorship-free equity sweep) ================")
        self.Log(f"universe names seen: {len(self.symbols_seen)}   setup trades: {len(self.setup_r)}   controls: {len(self.control_r)}")
        self.Log(f"net mean R @ {FEE_BPS_SIDE}bp/side: setup {g['setupMean']}   control {g['controlMean']}")
        self.Log(f"edge vs random: {g['edge']}R   t = {g['tStat']}   PASSES = {g['passes']}")
        self.Log(f"per-trade Sharpe {sr:.4f}   Deflated Sharpe({n_trials} trials, uncalibrated var) {dsr}")
        self.Log(f"VERDICT: {g['verdict']}")
        self.Log("NOTE: DSR needs the real variance of the per-name trial Sharpes; the random-control t is the")
        self.Log("operative gate (D-146). Includes DELISTED names (survivorship-free). No live orders — virtual only.")
