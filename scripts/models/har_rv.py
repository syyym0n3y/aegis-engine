# har_rv.py — PREREG D-814-har-rv-volatility. Daily RV from hourly returns; HAR (lags 1/5/22, log space) vs trailing-22d mean;
# yearly walk-forward; OOS R^2 gain per instrument. A SIZING/DURATION model, not a direction claim.
import sys, os, numpy as np, pandas as pd; sys.path.insert(0, os.path.dirname(__file__)); from common import *
def daily_rv(df):
    d = df.copy(); d["day"] = d["dt"].dt.floor("D"); g = d.groupby("day")
    rv = g["ret"].apply(lambda r: float((r.dropna() ** 2).sum())); cnt = g["ret"].count(); rv = rv[cnt >= 12]; return np.log(rv[rv > 0])
out = {}; cleared = 0
for sym in CRYPTO + FXIDX:
    lrv = daily_rv(load(sym)); s = pd.DataFrame({"y": lrv})
    x = np.exp(s["y"]); s["h1"] = np.log(x.shift(1)); s["h5"] = np.log(x.shift(1).rolling(5).mean()); s["h22"] = np.log(x.shift(1).rolling(22).mean()); s["naive"] = s["h22"]
    s = s.dropna(); s["year"] = s.index.year; years = sorted(y for y in s["year"].unique() if (s["year"] < y).sum() >= 300 and (s["year"] == y).sum() >= 60)
    gains = []
    for Y in years:
        tr = s[s["year"] < Y]; te = s[s["year"] == Y]; A = np.c_[np.ones(len(tr)), tr[["h1", "h5", "h22"]].values]; w = np.linalg.lstsq(A, tr["y"].values, rcond=None)[0]
        p = np.c_[np.ones(len(te)), te[["h1", "h5", "h22"]].values] @ w; y = te["y"].values; ss = ((y - y.mean()) ** 2).sum()
        r2_har = 1 - ((y - p) ** 2).sum() / ss; r2_nv = 1 - ((y - te["naive"].values) ** 2).sum() / ss; gains.append((Y, r2_har, r2_nv))
    g = np.mean([a - b for _, a, b in gains]) if gains else float("nan"); ok = g >= 0.05; cleared += ok
    out[sym] = dict(years=[y for y, _, _ in gains], r2_har=float(np.mean([a for _, a, _ in gains])) if gains else None, r2_naive=float(np.mean([b for _, _, b in gains])) if gains else None, gain=float(g), clears=bool(ok))
    print(f"  {sym:14s} test years {gains[0][0] if gains else '-'}..{gains[-1][0] if gains else '-'}  OOS R2 HAR {out[sym]['r2_har']:.3f} vs naive-22d {out[sym]['r2_naive']:.3f}  gain {g:+.3f} {'CLEARS' if ok else 'below +0.05'}")
print(f"\n==> HAR-RV: {cleared}/11 instruments clear +0.05 OOS R^2 gain (rule: >= 8) -> {'SUPPORTED as a sizing input' if cleared >= 8 else 'NULL'}"); out["verdict"] = "SUPPORTED" if cleared >= 8 else "NULL"; save("har-rv", out)
