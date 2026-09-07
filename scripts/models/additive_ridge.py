# additive_ridge.py — PREREG D-814-additive-shrunk-combination. Ridge on the crypto feature stack; alpha by inner time-series
# CV on TRAIN only; yearly walk-forward (test 2024/2025/2026); OOS effect per 1 sd of prediction and decile long/short vs fee.
import sys, os, json, math, numpy as np; sys.path.insert(0, os.path.dirname(__file__)); from common import *
def ridge_fit(X, y, alpha):
    XtX = X.T @ X + alpha * np.eye(X.shape[1]); return np.linalg.solve(XtX, X.T @ y)
def inner_alpha(X, y):
    n = len(y); best = None
    for a in [0.1, 1, 10, 100, 1000, 10000]:
        errs = []
        for k in range(3):   # 3 forward folds inside train
            cut = int(n * (0.55 + 0.15 * k)); end = int(n * (0.70 + 0.15 * k))
            w = ridge_fit(X[:cut], y[:cut], a); errs.append(((X[cut:end] @ w - y[cut:end]) ** 2).mean())
        m = float(np.mean(errs)); best = (a, m) if best is None or m < best[1] else best
    return best[0]
out = {}; pooled_pred = []; pooled_y = []; pooled_sym = []
for sym in CRYPTO:
    df = load(sym); res = {}
    for Y in [2024, 2025, 2026]:
        tr = (df["year"] < Y).values; te = (df["year"] == Y).values
        d = add_train_only_means(df, tr); X = d[FEATURES_CRYPTO].values.astype(float); y = d["next"].values.astype(float)
        Z = zscore_train(X, tr); ok_tr = tr & np.isfinite(y); ok_te = te & np.isfinite(y)
        a = inner_alpha(Z[ok_tr], y[ok_tr]); w = ridge_fit(Z[ok_tr], y[ok_tr], a); pred = Z @ w
        e = ols_effect(pred[ok_te], y[ok_te]); dl = decile_ls(pred[ok_te], y[ok_te], FEE_BP[sym])
        res[Y] = dict(alpha=a, effect_bp_per_sd=e["b"], t=e["t"], n=e["n"], decile_ls_bp=dl["mean"], decile_t=dl["t"], decile_n=dl["n"], top_weights={f: round(float(v), 3) for f, v in sorted(zip(FEATURES_CRYPTO, w), key=lambda kv: -abs(kv[1]))[:4]})
        pooled_pred.append(pred[ok_te]); pooled_y.append(y[ok_te]); pooled_sym += [sym] * int(ok_te.sum())
        print(f"  {sym} {Y}: alpha {a:>6} effect {e['b']:+.2f}bp/sd t {e['t']:+.2f} n {e['n']}  | decile L/S {dl['mean']:+.2f}bp t {dl['t']:+.2f} n {dl['n']}  | top {res[Y]['top_weights']}")
    out[sym] = res
P = np.concatenate(pooled_pred); Yy = np.concatenate(pooled_y); e = ols_effect(P, Yy); dl = decile_ls(P, Yy, 7)
print(f"\n==> ADDITIVE SHRUNK COMBINATION (ridge, walk-forward) pooled OOS: effect {e['b']:+.2f}bp per 1 sd (t {e['t']:+.2f}, n {e['n']}) = {e['b']/7:.2f}x fee | decile L/S net {dl['mean']:+.2f}bp/trade t {dl['t']:+.2f} n {dl['n']}")
by_year = {Y: ols_effect(np.concatenate([out and pooled_pred[i] for i, s in enumerate(CRYPTO) for _ in [0]][0:0] or [np.array([])]), np.array([])) for Y in []}
sup = e["b"] >= 7 and e["t"] >= 2.5 and dl["mean"] >= 7 and dl["t"] >= 2.5
verdict = "SUPPORTED" if sup else ("SIGN MISSED" if e["t"] <= -2.5 else f"SUB-FEE / NULL ({e['b']/7:.2f}x fee)")
print(f"  VERDICT: {verdict}"); out["pooled"] = dict(effect=e, decile=dl, verdict=verdict); save("additive-ridge", out)
