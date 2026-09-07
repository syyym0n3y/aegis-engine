# gbm.py — PREREG D-814-gradient-boosting. HistGradientBoostingRegressor with FIXED registered hyperparameters on the same
# feature stack and walk-forward as the ridge; OOS effect per 1 sd and improvement over the ridge's OOS effect.
import sys, os, json, numpy as np; sys.path.insert(0, os.path.dirname(__file__)); from common import *
from sklearn.ensemble import HistGradientBoostingRegressor
HP = dict(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=200, l2_regularization=1.0, random_state=814)
ridge = json.load(open(os.path.join(FEAT, "result-additive-ridge.json")))
out = {}; PP = []; YY = []
for sym in CRYPTO:
    df = load(sym); res = {}
    for Y in [2024, 2025, 2026]:
        tr = (df["year"] < Y).values; te = (df["year"] == Y).values
        d = add_train_only_means(df, tr); X = d[FEATURES_CRYPTO].values.astype(float); y = d["next"].values.astype(float)
        ok_tr = tr & np.isfinite(y); ok_te = te & np.isfinite(y)
        m = HistGradientBoostingRegressor(**HP).fit(X[ok_tr], y[ok_tr]); pred = m.predict(X[ok_te])
        e = ols_effect(pred, y[ok_te]); dl = decile_ls(pred, y[ok_te], FEE_BP[sym]); r = ridge[sym][str(Y)]
        res[Y] = dict(effect=e, decile=dl, ridge_effect=r["effect_bp_per_sd"], improvement=e["b"] - r["effect_bp_per_sd"]); PP.append(pred); YY.append(y[ok_te])
        print(f"  {sym} {Y}: GBM effect {e['b']:+.2f}bp/sd t {e['t']:+.2f} n {e['n']} | decile L/S {dl['mean']:+.2f}bp t {dl['t']:+.2f} | ridge {r['effect_bp_per_sd']:+.2f} -> improvement {e['b'] - r['effect_bp_per_sd']:+.2f}bp/sd")
    out[sym] = res
e = ols_effect(np.concatenate(PP), np.concatenate(YY)); dl = decile_ls(np.concatenate(PP), np.concatenate(YY), 7); re = ridge["pooled"]["effect"]["b"]
print(f"\n==> GRADIENT BOOSTING pooled OOS: effect {e['b']:+.2f}bp/sd (t {e['t']:+.2f}, n {e['n']}) = {e['b']/7:.2f}x fee | decile L/S {dl['mean']:+.2f}bp t {dl['t']:+.2f} | vs ridge {re:+.2f} -> improvement {e['b'] - re:+.2f}bp/sd (rule needs >= +2)")
sup = e["b"] >= 7 and e["t"] >= 2.5 and (e["b"] - re) >= 2; verdict = "SUPPORTED" if sup else ("SIGN MISSED" if e["t"] <= -2.5 else f"SUB-FEE / NULL ({e['b']/7:.2f}x fee, improvement {e['b']-re:+.2f})")
print(f"  VERDICT: {verdict}"); out["pooled"] = dict(effect=e, decile=dl, ridge=re, verdict=verdict); save("gbm", out)
