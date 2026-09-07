# common.py (D-814) — shared loader, walk-forward and statistics for the model-class tests. Every model reads the same
# data/features/<SYM>-1h.csv (export-feature-stack.ts). Nothing here chooses anything on the full sample: hour-of-day and
# day-of-week means, z-scores and any model parameter are computed on the TRAIN window only (SELECTION LAW).
import os, json, math, numpy as np, pandas as pd
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FEAT = os.path.join(REPO, "data", "features")
CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]; FXIDX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"]
FEE_BP = {"BTCUSDT": 7, "ETHUSDT": 7, "SOLUSDT": 7, "EURUSD": 2, "GBPUSD": 2, "USDJPY": 2, "AUDUSD": 2, "XAUUSD": 4, "USA500IDXUSD": 4, "USATECHIDXUSD": 4, "BRENTCMDUSD": 4}
def load(sym):
    df = pd.read_csv(os.path.join(FEAT, f"{sym}-1h.csv")); df = df.sort_values("ts").reset_index(drop=True)
    df["dt"] = pd.to_datetime(df["ts"], unit="s", utc=True); df["year"] = df["dt"].dt.year
    df["ret"] = np.log(df["c"]).diff() * 1e4
    gap = df["ts"].diff() == 3600                       # only consecutive hours define a next-hour return
    df["next"] = np.where(gap.shift(-1, fill_value=False), df["ret"].shift(-1), np.nan)
    df["r1"] = df["ret"]; df["r24"] = np.log(df["c"]).diff(24) * 1e4
    df["rvol"] = df["ret"].rolling(720, min_periods=200).std()
    return df
FEATURES_CRYPTO = ["delta", "fp", "imb1", "imb5", "topls", "takerls", "funding", "r1", "r24", "rvol", "hod", "dow_m"]
def add_train_only_means(df, train_mask):
    # hour-of-day and day-of-week mean next-hour return, from the TRAIN window only
    tr = df[train_mask]
    hod = tr.groupby("hour")["next"].mean(); dow = tr.groupby("dow")["next"].mean()
    df = df.copy(); df["hod"] = df["hour"].map(hod).astype(float); df["dow_m"] = df["dow"].map(dow).astype(float); return df
def zscore_train(X, train_mask):
    mu = np.nanmean(X[train_mask], axis=0); sd = np.nanstd(X[train_mask], axis=0); sd[sd == 0] = 1
    Z = (X - mu) / sd; Z = np.where(np.isfinite(Z), Z, 0.0); return Z
def ols_effect(pred, y):
    m = np.isfinite(pred) & np.isfinite(y); x = pred[m]; yy = y[m]; n = len(x)
    if n < 100: return dict(b=float("nan"), t=float("nan"), n=n)
    z = (x - x.mean()) / (x.std() or 1e-12); b = np.cov(z, yy, bias=True)[0, 1] / (z.var() or 1e-12)
    resid = yy - yy.mean() - b * (z - z.mean()); se = math.sqrt(resid.var() / max(1, n - 2) / (z.var() or 1e-12) / n * n) / math.sqrt(n) * math.sqrt(n) / math.sqrt(n)
    se = math.sqrt((resid ** 2).sum() / max(1, n - 2) / ((z - z.mean()) ** 2).sum())
    return dict(b=float(b), t=float(b / (se or 1e-12)), n=int(n))
def decile_ls(pred, y, fee_bp):
    m = np.isfinite(pred) & np.isfinite(y); x = pred[m]; yy = y[m]
    if len(x) < 500: return dict(mean=float("nan"), t=float("nan"), n=len(x))
    lo, hi = np.quantile(x, 0.1), np.quantile(x, 0.9); trades = np.concatenate([yy[x >= hi] - fee_bp, -(yy[x <= lo]) - fee_bp])
    return dict(mean=float(trades.mean()), t=float(trades.mean() / (trades.std(ddof=1) / math.sqrt(len(trades)) or 1e-12)), n=int(len(trades)))
def tstat(a):
    a = np.asarray(a, float); a = a[np.isfinite(a)]; return float(a.mean() / (a.std(ddof=1) / math.sqrt(len(a)) or 1e-12)) if len(a) > 1 else float("nan")
def save(name, obj):
    p = os.path.join(REPO, "data", "features", f"result-{name}.json"); json.dump(obj, open(p, "w"), indent=1, default=float); return p
