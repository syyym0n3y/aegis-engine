# meta_labeling.py — PREREG D-814-meta-labeling. Base rule = registered utc16 abovePDH long K=6h on the crypto perps; secondary
# classifier (fixed HP) on the entry-bar features predicts win; filter p>0.55; walk-forward; vs unfiltered and vs a vol-only control.
# The three perps are POOLED into one training set per test year (the claim is "on the 3 crypto perps"; ~45 events per
# symbol-year cannot train a classifier alone — the first run skipped every fold on its own floor).
import sys, os, numpy as np, pandas as pd; sys.path.insert(0, os.path.dirname(__file__)); from common import *
from sklearn.ensemble import HistGradientBoostingClassifier
HP = dict(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=50, l2_regularization=1.0, random_state=814)   # min_samples_leaf 50: pooled event set is ~500-800, the registered 200 would forbid any split
ev_rows = []
for sym in CRYPTO:
    df = load(sym); d = df.copy(); d["day"] = d["dt"].dt.floor("D"); dl = d.groupby("day").agg(hi=("h", "max"), lo=("l", "min")); pd_hi = dl["hi"].shift(1).reindex(d["day"]).values
    c = d["c"].values; K6 = np.full(len(d), np.nan); K6[:-6] = np.log(c[6:] / c[:-6]) * 1e4 - FEE_BP[sym]
    cons = np.zeros(len(d), bool); cons[:-6] = (d["ts"].values[6:] - d["ts"].values[:-6]) == 6 * 3600
    ev = (d["hour"].values == 16) & (c > pd_hi) & np.isfinite(K6) & cons
    for Y in [2024, 2025, 2026]:
        dd = add_train_only_means(df, (df["year"] < Y).values); X = dd[FEATURES_CRYPTO].values.astype(float); X = np.where(np.isfinite(X), X, 0.0)
        for i in np.where(ev)[0]: ev_rows.append(dict(sym=sym, year=int(d["year"].values[i]), Y=Y, X=X[i], k6=K6[i], rvol=dd["rvol"].values[i]))
E = pd.DataFrame(ev_rows); out = {}; tot = {"unf": [], "filt": [], "ctrl": []}
for Y in [2024, 2025, 2026]:
    e = E[E["Y"] == Y]; tr = e[e["year"] < Y]; te = e[e["year"] == Y]
    if len(tr) < 150 or len(te) < 30: print(f"  {Y}: UNTESTED (train {len(tr)}, test {len(te)})"); continue
    Xtr = np.stack(tr["X"].values); Xte = np.stack(te["X"].values)
    clf = HistGradientBoostingClassifier(**HP).fit(Xtr, (tr["k6"].values > 0).astype(int)); p = clf.predict_proba(Xte)[:, 1]
    unf = te["k6"].values; filt = unf[p > 0.55]; med = np.nanmedian(tr["rvol"].values); ctrl = unf[te["rvol"].values > med]
    tot["unf"] += list(unf); tot["filt"] += list(filt); tot["ctrl"] += list(ctrl)
    out[Y] = dict(unfiltered=(float(unf.mean()), int(len(unf))), filtered=(float(filt.mean()) if len(filt) else None, int(len(filt))), vol_control=(float(ctrl.mean()) if len(ctrl) else None, int(len(ctrl))), train=int(len(tr)))
    print(f"  {Y} (train {len(tr)} pooled events): unfiltered {unf.mean():+.2f}bp n {len(unf)} | filtered p>0.55 {filt.mean() if len(filt) else float('nan'):+.2f}bp n {len(filt)} | vol-only control {ctrl.mean() if len(ctrl) else float('nan'):+.2f}bp n {len(ctrl)}")
U, F, C = (np.array(tot[k]) for k in ("unf", "filt", "ctrl")); gain = (F.mean() - U.mean()) if len(F) else float("nan")
print(f"\n==> META-LABELING (utc16 abovePDH base, 3 crypto pooled): unfiltered {U.mean():+.2f}bp n {len(U)} | filtered {F.mean() if len(F) else float('nan'):+.2f}bp n {len(F)} (t {tstat(F):+.2f}) | vol control {C.mean() if len(C) else float('nan'):+.2f}bp n {len(C)} | gain {gain:+.2f}bp (rule >= +5, >= 200 filtered)")
sup = len(F) >= 200 and gain >= 5 and F.mean() > (C.mean() if len(C) else -1e9); print(f"  VERDICT: {'SUPPORTED' if sup else 'NULL'}")
out["pooled"] = dict(unf=float(U.mean()) if len(U) else None, filt=float(F.mean()) if len(F) else None, n_filt=int(len(F)), ctrl=float(C.mean()) if len(C) else None, gain=float(gain) if np.isfinite(gain) else None, verdict="SUPPORTED" if sup else "NULL"); save("meta-labeling", out)
