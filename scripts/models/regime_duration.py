# regime_duration.py — PREREG D-814-regime-duration. Two-state Gaussian Markov switching on DAILY returns (EM in numpy),
# fit on train (< Y), FILTERED probabilities computed causally on Y; trend (100d) unconditional vs regime-conditioned vs
# vol-target control; pooled OOS Sharpe; expected durations 1/(1-p_ii).
import sys, os, math, numpy as np, pandas as pd; sys.path.insert(0, os.path.dirname(__file__)); from common import *
def daily_close(df):
    d = df.copy(); d["day"] = d["dt"].dt.floor("D"); c = d.groupby("day")["c"].last(); return c
def em_2state(r, iters=60):
    mu = np.array([r.mean(), r.mean()]); sd = np.array([r.std() * 0.6, r.std() * 1.6]); P = np.array([[0.95, 0.05], [0.05, 0.95]]); pi = np.array([0.5, 0.5]); n = len(r)
    for _ in range(iters):
        lik = np.stack([np.exp(-0.5 * ((r - mu[k]) / sd[k]) ** 2) / (sd[k] * math.sqrt(2 * math.pi)) + 1e-300 for k in range(2)], 1)
        a = np.zeros((n, 2)); c = np.zeros(n); a[0] = pi * lik[0]; c[0] = a[0].sum(); a[0] /= c[0]
        for t in range(1, n): a[t] = (a[t - 1] @ P) * lik[t]; c[t] = a[t].sum(); a[t] /= c[t]
        b = np.ones((n, 2))
        for t in range(n - 2, -1, -1): b[t] = (P @ (lik[t + 1] * b[t + 1])) / c[t + 1]
        g = a * b; g /= g.sum(1, keepdims=True); xi = np.zeros((2, 2))
        for t in range(n - 1): x = np.outer(a[t], lik[t + 1] * b[t + 1]) * P / c[t + 1]; xi += x
        P = xi / xi.sum(1, keepdims=True); pi = g[0]; mu = (g * r[:, None]).sum(0) / g.sum(0); sd = np.sqrt((g * (r[:, None] - mu) ** 2).sum(0) / g.sum(0)) + 1e-8
    order = np.argsort(sd); return mu[order], sd[order], P[np.ix_(order, order)]
def filtered(r, mu, sd, P, p0):
    p = p0.copy(); out = np.zeros((len(r), 2))
    for t in range(len(r)):
        pred = p @ P; lik = np.array([np.exp(-0.5 * ((r[t] - mu[k]) / sd[k]) ** 2) / sd[k] for k in range(2)]) + 1e-300; p = pred * lik; p /= p.sum(); out[t] = p
    return out
books = {"uncond": {}, "regime": {}, "voltgt": {}}; out = {}
for sym in CRYPTO + FXIDX:
    c = daily_close(load(sym)); r = np.log(c).diff().dropna(); df = pd.DataFrame({"r": r}); df["year"] = df.index.year; fee = FEE_BP[sym] / 1e4
    df["trend"] = np.sign(np.log(c).diff(100).reindex(df.index)).shift(1); df["vol20"] = df["r"].rolling(20).std().shift(1)
    durs = []
    for Y in [2023, 2024, 2025, 2026]:
        tr = df[df["year"] < Y]; te = df[df["year"] == Y]
        if len(tr) < 400 or len(te) < 60: continue
        mu, sd, P = em_2state(tr["r"].values); durs.append((Y, 1 / (1 - P[0, 0]), 1 / (1 - P[1, 1])))
        pf = filtered(te["r"].values, mu, sd, P, np.array([0.5, 0.5])); plow = pd.Series(pf[:, 0], index=te.index).shift(1).fillna(0.5)   # prior close's filtered prob
        pos_u = te["trend"].fillna(0); pos_r = pos_u * (plow > 0.5); tgt = tr["r"].std(); pos_v = pos_u * np.clip(tgt / te["vol20"].replace(0, np.nan), 0, 3).fillna(0)
        for name, pos in [("uncond", pos_u), ("regime", pos_r), ("voltgt", pos_v)]:
            pnl = pos * te["r"] - fee * pos.diff().abs().fillna(0) / 2; books[name].setdefault(Y, []).append(pnl)
    out[sym] = dict(expected_duration_days={str(y): [round(a, 1), round(b, 1)] for y, a, b in durs})
    print(f"  {sym:14s} expected duration (low-vol, high-vol state) by test year: {out[sym]['expected_duration_days']}")
def pooled_sharpe(bk):
    allpnl = []
    for Y, lst in bk.items(): allpnl.append(pd.concat(lst, axis=1).mean(axis=1))
    s = pd.concat(allpnl).sort_index(); return float(s.mean() / (s.std() or 1e-12) * math.sqrt(252)), int(len(s))
su, n = pooled_sharpe(books["uncond"]); sr, _ = pooled_sharpe(books["regime"]); sv, _ = pooled_sharpe(books["voltgt"])
print(f"\n==> REGIME-CONDITIONED TREND, pooled 11-instrument OOS book ({n} days, 2023-2026): unconditional SR {su:+.2f} | regime-conditioned {sr:+.2f} | vol-target control {sv:+.2f}")
sup = (sr - su) >= 0.15 and sr >= sv; print(f"  VERDICT: {'SUPPORTED' if sup else 'NULL'} (gain {sr - su:+.2f}, control {sv:+.2f})"); out["pooled"] = dict(uncond=su, regime=sr, voltgt=sv, verdict="SUPPORTED" if sup else "NULL"); save("regime-duration", out)
