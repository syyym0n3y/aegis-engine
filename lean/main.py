"""main.py — Aegis MULTI-SETUP daily sweep over QC's survivorship-free US-equity universe, judged by the ported
gate (aegis_gate.py). D-177 killed the dip-buy; this keeps pushing by testing a PANEL of setups in ONE run,
each vs its own matched random control (D-146), with a Bonferroni t-threshold for the number of setups tested
so multiple-testing can't manufacture a fake winner.

SETUPS (all TP=3R, 2*ATR stop, daily, entry next bar; long needs price>200SMA, short needs price<200SMA):
  dipbuy   long   RSI14 < 30                 (the D-177 baseline — expect fail)
  ripshort short  RSI14 > 70
  bbmr_l   long   close < lower Bollinger(20,2)
  bbmr_s   short  close > upper Bollinger(20,2)
  brk_l    long   close > prior 20d high (Donchian upper)
  brk_s    short  close < prior 20d low  (Donchian lower)

Survivorship-free (delisted included) + random-control gate + deflation = the honest three-layer filter.
Books VIRTUAL trades only (no live orders). Uses the long-stable PascalCase LEAN Python API.
"""
from AlgorithmImports import *
import random

from aegis_gate import edge_vs_random, sharpe

UNIVERSE_SIZE = 300
MA_LEN, ATR_LEN, RSI_LEN, BB_LEN, DCH_LEN = 200, 14, 14, 20, 20
STOP_ATR, TP_MULT, MAX_HOLD = 2.0, 3.0, 20
FEE_BPS_SIDE = 2.0
P_CONTROL = 0.004                 # per eligible symbol-bar, split long/short → matched random pools
SETUPS = ["dipbuy", "ripshort", "bbmr_l", "bbmr_s", "brk_l", "brk_s"]
# Bonferroni two-sided t for 6 tests at alpha=0.05: alpha/6=0.0083 -> z ~ 2.64
DEFLATED_T = 2.64


class AegisMultiSweep(QCAlgorithm):

    def Initialize(self):
        self.SetStartDate(2010, 1, 1)
        self.SetEndDate(2026, 7, 31)
        self.SetCash(100000)
        self.UniverseSettings.Resolution = Resolution.Daily
        self.AddUniverse(self.CoarseFilter)
        self.SetWarmUp(MA_LEN + 5, Resolution.Daily)

        self.ind = {}
        self.open_trades = []
        self.setup_r = {s: [] for s in SETUPS}
        self.ctrl_long = []
        self.ctrl_short = []
        self.rng = random.Random(20260807)
        self.names = set()
        self._month = -1

    def CoarseFilter(self, coarse):
        if self.Time.month == self._month:
            return Universe.Unchanged
        self._month = self.Time.month
        f = [c for c in coarse if c.HasFundamentalData and c.Price > 5 and c.DollarVolume > 0]
        f.sort(key=lambda c: c.DollarVolume, reverse=True)
        return [c.Symbol for c in f[:UNIVERSE_SIZE]]

    def OnSecuritiesChanged(self, changes):
        for s in changes.AddedSecurities:
            sym = s.Symbol
            if sym in self.ind:
                continue
            self.ind[sym] = {
                "rsi": self.RSI(sym, RSI_LEN, MovingAverageType.Wilders, Resolution.Daily),
                "sma": self.SMA(sym, MA_LEN, Resolution.Daily),
                "atr": self.ATR(sym, ATR_LEN, MovingAverageType.Simple, Resolution.Daily),
                "bb": self.BB(sym, BB_LEN, 2, MovingAverageType.Simple, Resolution.Daily),
                "dch": self.DCH(sym, DCH_LEN, Resolution.Daily),
            }
            self.names.add(sym)
        for s in changes.RemovedSecurities:
            self.ind.pop(s.Symbol, None)

    def _open(self, symbol, entry, sd, direction, tag):
        self.open_trades.append({"symbol": symbol, "entry": entry, "stop": entry - direction * sd,
                                 "tgt": entry + direction * sd * TP_MULT, "sd": sd, "dir": direction,
                                 "days": 0, "tag": tag})

    def _close_r(self, tr, px):
        r = tr["dir"] * (px - tr["entry"]) / tr["sd"]
        cost = (tr["entry"] * (FEE_BPS_SIDE / 10000.0) * 2) / tr["sd"]
        return r - cost

    def _bucket(self, tr, r):
        if tr["tag"] == "ctrl_long":
            self.ctrl_long.append(r)
        elif tr["tag"] == "ctrl_short":
            self.ctrl_short.append(r)
        else:
            self.setup_r[tr["tag"]].append(r)

    def OnData(self, data):
        if self.IsWarmingUp:
            return
        still = []
        for tr in self.open_trades:
            bar = data.Bars.get(tr["symbol"])
            if bar is None:
                still.append(tr)
                continue
            tr["days"] += 1
            hit_stop = (bar.Low <= tr["stop"]) if tr["dir"] == 1 else (bar.High >= tr["stop"])
            hit_tgt = (bar.High >= tr["tgt"]) if tr["dir"] == 1 else (bar.Low <= tr["tgt"])
            if hit_stop:
                self._bucket(tr, self._close_r(tr, tr["stop"]))
            elif hit_tgt:
                self._bucket(tr, self._close_r(tr, tr["tgt"]))
            elif tr["days"] >= MAX_HOLD:
                self._bucket(tr, self._close_r(tr, bar.Close))
            else:
                still.append(tr)
        self.open_trades = still

        for sym, ind in self.ind.items():
            bar = data.Bars.get(sym)
            if bar is None or not all(ind[k].IsReady for k in ("rsi", "sma", "atr", "bb", "dch")):
                continue
            sd = STOP_ATR * ind["atr"].Current.Value
            if not (sd > bar.Close * 1e-4):
                continue
            c = bar.Close
            up = c > ind["sma"].Current.Value
            dn = c < ind["sma"].Current.Value
            if up and ind["rsi"].Current.Value < 30:
                self._open(sym, c, sd, 1, "dipbuy")
            if dn and ind["rsi"].Current.Value > 70:
                self._open(sym, c, sd, -1, "ripshort")
            if up and c < ind["bb"].LowerBand.Current.Value:
                self._open(sym, c, sd, 1, "bbmr_l")
            if dn and c > ind["bb"].UpperBand.Current.Value:
                self._open(sym, c, sd, -1, "bbmr_s")
            if up and c > ind["dch"].UpperBand.Current.Value:
                self._open(sym, c, sd, 1, "brk_l")
            if dn and c < ind["dch"].LowerBand.Current.Value:
                self._open(sym, c, sd, -1, "brk_s")
            # matched random controls (same universe/regime/mechanics), one per direction pool
            if self.rng.random() < P_CONTROL:
                self._open(sym, c, sd, 1, "ctrl_long")
            if self.rng.random() < P_CONTROL:
                self._open(sym, c, sd, -1, "ctrl_short")

    def OnEndOfAlgorithm(self):
        for tr in self.open_trades:
            px = self.Securities[tr["symbol"]].Price
            if px > 0:
                self._bucket(tr, self._close_r(tr, px))
        self.Debug("========= AEGIS MULTI-SETUP GATE (daily survivorship-free, Bonferroni t>=%.2f for %d setups) =========" % (DEFLATED_T, len(SETUPS)))
        self.Debug("universe names seen: %d   ctrl_long: %d   ctrl_short: %d" % (len(self.names), len(self.ctrl_long), len(self.ctrl_short)))
        winners = []
        for s in SETUPS:
            direction_ctrl = self.ctrl_long if s in ("dipbuy", "bbmr_l", "brk_l") else self.ctrl_short
            g = edge_vs_random(self.setup_r[s], direction_ctrl, min_t=DEFLATED_T)
            passed = g["passes"] and g["setupMean"] > 0
            if passed:
                winners.append(s)
            self.Debug("%-9s n=%-5d setupR=%+.4f  vs random %+.4f  edge %+.4f  t=%.2f  %s" % (
                s, len(self.setup_r[s]), g["setupMean"], g["controlMean"], g["edge"], g["tStat"],
                "<<< SURVIVES (deflated)" if passed else "reject"))
        self.Debug("SURVIVORS after deflation: %s" % (", ".join(winners) if winners else "NONE — every setup is regime drift on honest data (D-146/D-070)"))
        self.Debug("survivorship-free (delisted incl.), virtual trades only, no live orders, $0.")
