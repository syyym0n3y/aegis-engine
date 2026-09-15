#!/usr/bin/env python3
# D-925 — order-book / order-flow imbalance as a short-horizon predictor (the last un-acquired free/keyless variable).
# Source: data.binance.vision (operator-armed allowlist). Two variables:
#   (a) resting-depth imbalance from daily bookDepth (+-1%/+-5% bands) — a slow wall, weak control, uninformative.
#   (b) taker order-FLOW imbalance from 1m klines: (2*taker_buy - volume)/volume — control PASSES, forward sub-cost.
# Usage: download klines/bookDepth zips to <dir>/kl and <dir>/bd (URLs below), then:  python3 orderbook-flow.py <dir> <btc1m.json>
#   klines:    https://data.binance.vision/data/futures/um/daily/klines/<SYM>/1m/<SYM>-1m-<DATE>.zip
#   bookDepth: https://data.binance.vision/data/futures/um/daily/bookDepth/<SYM>/<SYM>-bookDepth-<DATE>.zip
import csv, glob, math, sys, json
def slope_t(x, y):
    xy = [(a, b) for a, b in zip(x, y) if b is not None]
    xs = [a for a, _ in xy]; ys = [b for _, b in xy]; n = len(xy)
    mx = sum(xs)/n; my = sum(ys)/n
    cov = sum((a-mx)*(b-my) for a, b in xy); vx = sum((a-mx)**2 for a in xs); vy = sum((b-my)**2 for b in ys)
    beta = cov/vx if vx > 0 else 0; r = cov/math.sqrt(vx*vy) if vx*vy > 0 else 0
    t = r*math.sqrt(n-2)/math.sqrt(max(1e-9, 1-r*r)); sdx = math.sqrt(vx/(n-1))
    return dict(n=n, r=r, t=t, bp=beta*sdx*1e4)
def main(d):
    rows = []
    for f in sorted(glob.glob(f"{d}/kl/*.csv")):
        for row in csv.reader(open(f)):
            if row[0] == "open_time" or len(row) < 11: continue
            try: t=int(row[0])//1000; o=float(row[1]); c=float(row[4]); v=float(row[5]); tb=float(row[9])
            except: continue
            if v > 0 and o > 0 and c > 0: rows.append((t, o, c, v, tb))
    rows.sort(); byT = {r[0]: i for i, r in enumerate(rows)}
    OFI = [(2*r[4]-r[3])/r[3] for r in rows]
    X=[];Rc=[];R1=[];R5=[]
    for i, r in enumerate(rows):
        t = r[0]; n1 = byT.get(t+60); n5 = byT.get(t+300)
        if n1 is None: continue
        X.append(OFI[i]); Rc.append(math.log(r[2]/r[1])); R1.append(math.log(rows[n1][2]/r[2]))
        R5.append(math.log(rows[n5][2]/r[2]) if n5 is not None else None)
    c = slope_t(X, Rc); f1 = slope_t(X, R1); f5 = slope_t(X, R5)
    print(f"order-flow imbalance (n={f1['n']}): CONTEMP r={c['r']:.3f} t={c['t']:.1f} (control, must be +); "
          f"FWD1m t={f1['t']:.2f} {f1['bp']:+.3f}bp/sd; FWD5m t={f5['t']:.2f} {f5['bp']:+.3f}bp/sd — vs ~5bp taker round-trip")
if __name__ == "__main__": main(sys.argv[1] if len(sys.argv) > 1 else ".")
