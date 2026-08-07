"""main.py — Aegis MULTI-SETUP, MULTI-TIMEFRAME sweep over QC's survivorship-free US-equity universe, judged by
the ported gate (aegis_gate.py). "Don't stop until all timeframes are backtested" (operator): flip RES to
Daily / Hour / Minute and re-run. Enhancements over D-178:
  (1) SHORT BORROW COST modeled (annualized, charged per hold-day) — the make-or-break test for rip-short.
  (2) Donchian breakout FIXED — uses a rolling window of PRIOR bars (never the current bar), so brk_l/brk_s fire.
  (3) BOTH-HALVES sign stability (D-155) — each setup's t reported on H1 and H2 as well as full.

SETUPS (TP=3R, 2*ATR stop; long needs price>200MA, short needs price<200MA):
  dipbuy  L RSI<30 | ripshort S RSI>70 | bbmr_l L close<lowerBB | bbmr_s S close>upperBB |
  brk_l  L close>prior-20 high | brk_s S close<prior-20 low
Each vs its matched random control (same regime/direction/mechanics incl. borrow). Bonferroni t>=2.64 for 6.
Virtual trades only, no live orders. PascalCase LEAN Python API.
"""
from AlgorithmImports import *
import random
from collections import deque

from aegis_gate import edge_vs_random

# ---- TIMEFRAME SWITCH: set RES + matching constants, then run ----
RES = Resolution.Minute          # Daily | Hour | Minute
BAR_DAYS = 1.0/390               # calendar-days per bar for borrow accrual: Daily=1, Hour~1/6.5, Minute~1/390
# For Hour set BAR_DAYS=1/6.5; for Minute set BAR_DAYS=1/390 (and expect the free node to strain).

UNIVERSE_SIZE = 40               # minute: scope-limited (full universe over 16y exceeds the free node)
MA_LEN, ATR_LEN, RSI_LEN, BB_LEN, DCH_LEN = 200, 14, 14, 20, 20
STOP_ATR, TP_MULT, MAX_HOLD = 2.0, 3.0, 20
FEE_BPS_SIDE = 2.0
BORROW_ANNUAL = 0.08              # 8%/yr baseline short borrow (many overbought-downtrend names are HTB; pessimistic-ish)
P_CONTROL = 0.004
SETUPS = ["dipbuy", "ripshort", "bbmr_l", "bbmr_s", "brk_l", "brk_s"]
LONG_SET = {"dipbuy", "bbmr_l", "brk_l"}
DEFLATED_T = 2.64
MID = None                        # set in Initialize (midpoint of the backtest for both-halves)


class AegisMultiTF(QCAlgorithm):

    def Initialize(self):
        self.SetStartDate(2020, 1, 1)   # minute: shortened window for free-node feasibility
        self.SetEndDate(2026, 7, 31)
        self.SetCash(100000)
        self.UniverseSettings.Resolution = RES
        self.AddUniverse(self.CoarseFilter)
        self.SetWarmUp(MA_LEN + 5, RES)
        self.mid = datetime(2024, 10, 1)

        self.ind = {}
        self.don = {}             # symbol -> {"hi": deque, "lo": deque} of PRIOR bars
        self.open_trades = []
        self.r = {s: {"all": [], "h1": [], "h2": []} for s in SETUPS}
        self.cl = {"all": [], "h1": [], "h2": []}   # control long
        self.cs = {"all": [], "h1": [], "h2": []}   # control short
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
                "rsi": self.RSI(sym, RSI_LEN, MovingAverageType.Wilders, RES),
                "sma": self.SMA(sym, MA_LEN, RES),
                "atr": self.ATR(sym, ATR_LEN, MovingAverageType.Simple, RES),
                "bb": self.BB(sym, BB_LEN, 2, MovingAverageType.Simple, RES),
            }
            self.don[sym] = {"hi": deque(maxlen=DCH_LEN), "lo": deque(maxlen=DCH_LEN)}
            self.names.add(sym)
        for s in changes.RemovedSecurities:
            self.ind.pop(s.Symbol, None)
            self.don.pop(s.Symbol, None)

    def _open(self, sym, entry, sd, direction, tag):
        self.open_trades.append({"sym": sym, "entry": entry, "stop": entry - direction * sd,
                                 "tgt": entry + direction * sd * TP_MULT, "sd": sd, "dir": direction,
                                 "days": 0, "tag": tag, "half": 1 if self.Time < self.mid else 2})

    def _close_r(self, tr, px):
        r = tr["dir"] * (px - tr["entry"]) / tr["sd"]
        cost = (tr["entry"] * (FEE_BPS_SIDE / 10000.0) * 2) / tr["sd"]
        if tr["dir"] == -1:                                   # short borrow cost over the hold
            hold_days = tr["days"] * BAR_DAYS
            borrow_frac = BORROW_ANNUAL * (hold_days / 365.0)
            cost += (tr["entry"] * borrow_frac) / tr["sd"]
        return r - cost

    def _bucket(self, tr, r):
        half = "h1" if tr["half"] == 1 else "h2"
        if tr["tag"] == "ctrl_long":
            self.cl["all"].append(r); self.cl[half].append(r)
        elif tr["tag"] == "ctrl_short":
            self.cs["all"].append(r); self.cs[half].append(r)
        else:
            self.r[tr["tag"]]["all"].append(r); self.r[tr["tag"]][half].append(r)

    def OnData(self, data):
        if self.IsWarmingUp:
            # still need to build Donchian windows during warmup so breakouts are ready at go-live
            for sym, dq in self.don.items():
                bar = data.Bars.get(sym)
                if bar is not None:
                    dq["hi"].append(bar.High); dq["lo"].append(bar.Low)
            return
        still = []
        for tr in self.open_trades:
            bar = data.Bars.get(tr["sym"])
            if bar is None:
                still.append(tr); continue
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
            if bar is None:
                continue
            dq = self.don[sym]
            prior_hi = max(dq["hi"]) if len(dq["hi"]) == DCH_LEN else None
            prior_lo = min(dq["lo"]) if len(dq["lo"]) == DCH_LEN else None
            ready = all(ind[k].IsReady for k in ("rsi", "sma", "atr", "bb")) and prior_hi is not None
            if ready:
                sd = STOP_ATR * ind["atr"].Current.Value
                if sd > bar.Close * 1e-4:
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
                    if up and c > prior_hi:
                        self._open(sym, c, sd, 1, "brk_l")
                    if dn and c < prior_lo:
                        self._open(sym, c, sd, -1, "brk_s")
                    if self.rng.random() < P_CONTROL:
                        self._open(sym, c, sd, 1, "ctrl_long")
                    if self.rng.random() < P_CONTROL:
                        self._open(sym, c, sd, -1, "ctrl_short")
            dq["hi"].append(bar.High); dq["lo"].append(bar.Low)   # push AFTER use → window is prior bars only

    def OnEndOfAlgorithm(self):
        for tr in self.open_trades:
            px = self.Securities[tr["sym"]].Price
            if px > 0:
                self._bucket(tr, self._close_r(tr, px))
        res_name = {Resolution.Daily: "DAILY", Resolution.Hour: "HOUR", Resolution.Minute: "MINUTE"}.get(RES, str(RES))
        self.Debug("===== AEGIS MULTI-TF GATE [%s] survivorship-free, borrow=%.0f%%/yr, Bonferroni t>=%.2f =====" % (
            res_name, BORROW_ANNUAL * 100, DEFLATED_T))
        self.Debug("names=%d  ctrl_long=%d  ctrl_short=%d" % (len(self.names), len(self.cl["all"]), len(self.cs["all"])))
        winners = []
        for s in SETUPS:
            ctrl = self.cl if s in LONG_SET else self.cs
            g = edge_vs_random(self.r[s]["all"], ctrl["all"], min_t=DEFLATED_T)
            g1 = edge_vs_random(self.r[s]["h1"], ctrl["h1"], min_t=DEFLATED_T)
            g2 = edge_vs_random(self.r[s]["h2"], ctrl["h2"], min_t=DEFLATED_T)
            both = g1["setupMean"] is not None and g2["setupMean"] is not None and g1["setupMean"] > 0 and g2["setupMean"] > 0
            survives = g["passes"] and g["setupMean"] > 0 and both and g1["tStat"] >= 2.0 and g2["tStat"] >= 2.0
            if survives:
                winners.append(s)
            self.Debug("%-9s n=%-5d R=%+.4f vs %+.4f edge %+.4f t=%.2f | H1 t=%.2f H2 t=%.2f | %s" % (
                s, len(self.r[s]["all"]), g["setupMean"], g["controlMean"], g["edge"], g["tStat"],
                g1["tStat"], g2["tStat"],
                "<<< SURVIVES (deflated + both-halves + borrow)" if survives else "reject"))
        self.Debug("SURVIVORS: %s" % (", ".join(winners) if winners else "NONE at this timeframe"))
        self.Debug("survivorship-free (delisted incl.), short borrow charged, virtual only, $0.")
