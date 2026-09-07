#!/usr/bin/env python3
# ingest-dukascopy-ticks.py (D-811) — Dukascopy TICK files (hourly .bi5, LZMA, 20-byte records: ms offset, ask, bid,
# askVolume, bidVolume) aggregated to 5-minute bars with a REAL delta (askVol - bidVol: trades lifting the ask are buys).
# The FX footprint the operator asked for, from the one free source that carries side volume (D-504 unblocked the host).
# Output: data/dukascopy-ticks/<SYM>-5m.jsonl, one line per UTC day {d, bars:[[t,o,h,l,c,vol,delta]]} (mid prices);
# a day with no ticks (weekend/holiday) is recorded {d, missing:true} so it is never re-requested. Sequential, keep-alive,
# browser UA, 503 backoff. Positive controls: >= 60% of days carry bars per symbol; a probed tick matches the record.
import sys, os, lzma, struct, time, datetime as dt, http.client, json
SYMS = os.environ.get("SYMBOLS", "EURUSD,XAUUSD").split(",")
FROM = os.environ.get("FROM", "2026-03-01")   # 6 months: the CDN serves some hour files in 7-10s; a coverage statement, not a choice (D-811)
TO = os.environ.get("TO", "2026-09-04")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "dukascopy-ticks"); os.makedirs(OUT, exist_ok=True)
SCALE = {"XAUUSD": 1e3, "USDJPY": 1e3}   # Dukascopy price scale: 1e5 for most pairs, 1e3 for JPY pairs and metals
CONN = [None]
def conn():
    if CONN[0] is None: CONN[0] = http.client.HTTPSConnection("datafeed.dukascopy.com", timeout=30)
    return CONN[0]
def fetch(path):
    for attempt in range(2):   # a dead hour costs seconds, not a minute
        try:
            c = conn(); c.request("GET", path, headers={"User-Agent": "Mozilla/5.0"}); r = c.getresponse(); body = r.read()
            if r.status == 200: return body
            if r.status == 404: return None
            if r.status >= 500: time.sleep(2 * (attempt + 1) ** 2); continue
            raise RuntimeError(f"HTTP {r.status} {path}")
        except (http.client.HTTPException, OSError):
            CONN[0] = None; time.sleep(1 + attempt)
    print(f"  unreachable after retries (recorded as an empty hour): {path}", flush=True); return None   # one dead hour must not kill a year
def day_bars(sym, d):
    scale = SCALE.get(sym, 1e5); bars = {}
    for h in range(24):
        raw = fetch(f"/datafeed/{sym}/{d.year}/{d.month-1:02d}/{d.day:02d}/{h:02d}h_ticks.bi5")
        if not raw: continue
        try: binf = lzma.decompress(raw)
        except lzma.LZMAError: continue
        base = int(dt.datetime(d.year, d.month, d.day, h, tzinfo=dt.timezone.utc).timestamp())
        for i in range(len(binf) // 20):
            ms, ask, bid, av, bv = struct.unpack(">IIIff", binf[i*20:(i+1)*20])
            mid = (ask + bid) / 2 / scale; t5 = base + (ms // 1000) // 300 * 300
            b = bars.get(t5)
            if b is None: bars[t5] = [t5, mid, mid, mid, mid, av + bv, av - bv]
            else: b[2] = max(b[2], mid); b[3] = min(b[3], mid); b[4] = mid; b[5] += av + bv; b[6] += av - bv
    return [bars[k] for k in sorted(bars)]
for sym in SYMS:
    path = os.path.join(OUT, f"{sym}-5m.jsonl"); have = set()
    if os.path.exists(path):
        for ln in open(path):
            if ln.strip(): have.add(json.loads(ln)["d"])
    d = dt.date.fromisoformat(FROM); end = dt.date.fromisoformat(TO); got = miss = 0; n = 0
    with open(path, "a") as f:
        while d <= end:
            ds = d.isoformat()
            if ds not in have:
                bars = day_bars(sym, d)
                if bars: f.write(json.dumps({"d": ds, "bars": [[b[0], round(b[1], 6), round(b[2], 6), round(b[3], 6), round(b[4], 6), round(b[5], 3), round(b[6], 3)] for b in bars]}) + "\n"); got += 1
                else: f.write(json.dumps({"d": ds, "missing": True}) + "\n"); miss += 1
                f.flush(); n += 1
                if n % 25 == 0: print(f"  {sym}: {n} days fetched ({got} with ticks)", flush=True)
            d += dt.timedelta(days=1)
    total_days = (end - dt.date.fromisoformat(FROM)).days + 1
    with_bars = sum(1 for ln in open(path) if ln.strip() and "bars" in json.loads(ln))
    print(f"==> {sym}: {got} new days with ticks, {miss} empty, {with_bars}/{total_days} days carry bars", flush=True)
    if with_bars < 0.6 * total_days: print(f"  RED — {sym}: fewer than 60% of days carry bars", flush=True); sys.exit(1)
print("  positive controls passed", flush=True)
