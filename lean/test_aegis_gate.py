"""test_aegis_gate.py — PARITY + unit tests for the ported gate.

Parity: /tmp/ts_out.json holds the TS gate's output on the fixtures in /tmp/fixtures.json (produced by the deno
dump). We run the Python gate on the SAME fixtures and assert equality. A port that is not provably equal to the
source is a rewrite, not a port — so this is the test that matters.

Run:  python3 -m pytest lean/test_aegis_gate.py -q     (or: python3 lean/test_aegis_gate.py)
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import aegis_gate as G

TS = "/tmp/ts_out.json"
FX = "/tmp/fixtures.json"


def _load():
    with open(TS) as f:
        ts = json.load(f)
    with open(FX) as f:
        fx = json.load(f)
    return ts, fx


def close(a, b, tol=1e-9):
    if a is None or b is None:
        return a == b
    if isinstance(a, float) and (math.isnan(a) or math.isinf(a)):
        return (math.isnan(b) and math.isnan(a)) or a == b
    return abs(a - b) <= tol + tol * abs(b)


def test_parity():
    ts, fx = _load()
    setup, control, rets, M = fx["setup"], fx["control"], fx["rets"], fx["M"]
    checks = []

    def chk(name, py, tsval, tol=1e-9):
        ok = close(py, tsval, tol)
        checks.append((name, ok, py, tsval))

    chk("erf(-1.3)", G.erf(-1.3), ts["erf"][0])
    chk("erf(0)", G.erf(0.0), ts["erf"][1])
    chk("erf(0.77)", G.erf(0.77), ts["erf"][2])
    chk("erf(2.1)", G.erf(2.1), ts["erf"][3])
    chk("normalCdf(-2)", G.normal_cdf(-2), ts["normalCdf"][0])
    chk("normalCdf(1.64)", G.normal_cdf(1.64), ts["normalCdf"][2])
    chk("invNorm(0.01)", G.inv_norm(0.01), ts["invNorm"][0])
    chk("invNorm(0.95)", G.inv_norm(0.95), ts["invNorm"][2])
    chk("invNorm(0.999)", G.inv_norm(0.999), ts["invNorm"][3])
    chk("mean", G.mean(rets), ts["mean"])
    chk("sampleStd", G.sample_std(rets), ts["sampleStd"])
    chk("popStd", G.pop_std(rets), ts["popStd"])
    chk("skewness", G.skewness(rets), ts["skewness"])
    chk("kurtosis", G.kurtosis(rets), ts["kurtosis"])
    chk("sharpe", G.sharpe(rets), ts["sharpe"])
    chk("sortino", G.sortino(rets), ts["sortino"])
    chk("maxDrawdown", G.max_drawdown(rets), ts["maxDrawdown"])
    chk("calmar", G.calmar(rets, 252), ts["calmar"])
    sr, sk, ku = G.sharpe(rets), G.skewness(rets), G.kurtosis(rets)
    chk("psr", G.probabilistic_sharpe(sr, 0, len(rets), sk, ku), ts["psr"])
    chk("expMaxSharpe", G.expected_max_sharpe(50, 0.04), ts["expMaxSharpe"])
    chk("dsr", G.deflated_sharpe(sr, len(rets), sk, ku, 50, 0.04), ts["dsr"])
    chk("minTRL", G.min_trl(0.12, 0.03, sk, ku, 0.95), ts["minTRL"])
    pbo = G.pbo_cscv(M, 8)
    chk("pbo.pbo", pbo["pbo"], ts["pbo"]["pbo"])
    chk("pbo.nCombos", float(pbo["nCombos"]), float(ts["pbo"]["nCombos"]))
    e = G.edge_vs_random(setup, control)
    chk("edge.setupMean", e["setupMean"], ts["edge"]["setupMean"], 1e-4)
    chk("edge.controlMean", e["controlMean"], ts["edge"]["controlMean"], 1e-4)
    chk("edge.edge", e["edge"], ts["edge"]["edge"], 1e-4)
    chk("edge.tStat", e["tStat"], ts["edge"]["tStat"], 1e-2)
    assert e["passes"] == ts["edge"]["passes"], "edge.passes mismatch"

    failed = [c for c in checks if not c[1]]
    for name, ok, py, tsv in checks:
        print(f"  {'OK ' if ok else 'FAIL'} {name:<16} py={py!r:<26} ts={tsv!r}")
    assert not failed, f"{len(failed)} parity checks failed: {[c[0] for c in failed]}"


def test_edge_fails_closed_on_thin_sample():
    r = G.edge_vs_random([0.1] * 10, [0.0] * 10)
    assert r["passes"] is False and "fails closed" in r["verdict"]


def test_mintrl_infinite_when_no_edge():
    assert G.min_trl(0.02, 0.05, 0, 3) == math.inf


if __name__ == "__main__":
    test_parity()
    test_edge_fails_closed_on_thin_sample()
    test_mintrl_infinite_when_no_edge()
    print("\nALL PARITY + UNIT TESTS PASSED")
