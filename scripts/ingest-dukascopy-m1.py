#!/usr/bin/env python3
# ingest-dukascopy-m1.py (D-709) — MINUTE bars, not hourly. The one thing that stands between the NQ Motion Model
# being UNTESTED and being verdicted.
#
# WHY THIS EXISTS. D-708 tested an externally-supplied opening-range-breakout checklist on USATECHIDXUSD at HOURLY
# resolution and could not resolve it: on 22% of days the opening high AND the opening low both break inside the
# same hourly bar, and which one triggers FIRST decides whether the day is a winner or a whipsaw. Including those
# days at a coin flip gives +7.32 pts at t 4.27; at the worst assignment, -4.87 at t -2.46. The verdict spanned zero
# because of a limitation of the DATA, not of the market — exactly the situation THE COVERAGE LAW says must be
# recorded as UNTESTED rather than as a null.
#
# THE SOURCE WAS ALREADY HERE. `ingest-dukascopy.py` (D-504) fetches Dukascopy m1 candles and then AGGREGATES THEM
# TO HOURLY before storing — it throws away the exact resolution the question needs, and has since 2026-05. One
# request returns a whole day of minutes, so the entire 2016-2026 span is ~2,700 sequential requests.
#
# WHY IT CACHES TO A FILE RATHER THAN A NEW TABLE. Persisting minute bars needs a new table, and a schema change is
# an operator gate under the standing rules. This writes a compact local cache instead, so the analysis is fully
# reproducible today without one; promoting it to a table is a decision to put to the operator, not to assume.
#
# FORMAT (from the D-504 reader, unchanged): LZMA-compressed 24-byte records, ">IIIIIf" = seconds-from-day-start,
# open, close, LOW, HIGH, volume — note the low/high ORDER, which is the kind of detail that silently inverts a
# range calculation if guessed rather than copied.
import sys, os, lzma, struct, time, datetime as dt, socket, http.client, json, gzip
socket.setdefaulttimeout(30)

PAIR   = os.environ.get("PAIR", "USATECHIDXUSD")
SCALE  = float(os.environ.get("SCALE", "1e-3"))
START  = dt.date.fromisoformat(os.environ.get("FROM", "2016-01-01"))
END    = dt.date.fromisoformat(os.environ.get("TO",   "2026-08-28"))
# The model's window is 8:30-11:00 US Central = 13:30-16:00 UTC in summer, 14:30-17:00 in winter. 12:00-18:00 UTC
# covers both with margin on each side, at a fifth of the storage of a full day.
H_FROM = int(os.environ.get("H_FROM", "12"))
H_TO   = int(os.environ.get("H_TO",   "18"))
CACHE  = os.environ.get("CACHE", f"/Users/ona/aegis-data/m1_{PAIR}.jsonl.gz")

print(f"==> DUKASCOPY M1 IMPORT — {PAIR} scale={SCALE} {START}..{END}, UTC hours {H_FROM}:00-{H_TO}:00")
print(f"    cache: {CACHE}")

have = set()
if os.path.exists(CACHE):
    with gzip.open(CACHE, "rt") as f:
        for line in f:
            try: have.add(json.loads(line)["d"])
            except Exception: pass
    print(f"    {len(have)} day(s) already cached — resuming, not refetching")

CONN = [None]
def _conn():
    if CONN[0] is None:
        CONN[0] = http.client.HTTPSConnection("datafeed.dukascopy.com", timeout=30)
    return CONN[0]

def fetch(path):
    for attempt in range(4):
        try:
            c = _conn(); c.request("GET", path, headers={"User-Agent": "Mozilla/5.0"})
            r = c.getresponse(); body = r.read()
            if r.status == 200: return body
            if r.status == 404: return None          # no session that day — not an error
            raise IOError(f"http {r.status}")
        except Exception:
            try: CONN[0].close()
            except Exception: pass
            CONN[0] = None
            time.sleep(3 * (attempt + 1))
    return None

out = gzip.open(CACHE, "at")
d = START
days = 0; bars = 0; missing = 0; skipped = 0
try:
    while d <= END:
        key = d.isoformat()
        if d.weekday() == 5:                 # Saturday has no session
            d += dt.timedelta(days=1); continue
        if key in have:
            skipped += 1; d += dt.timedelta(days=1); continue
        url = f"/datafeed/{PAIR}/{d.year}/{d.month-1:02d}/{d.day:02d}/BID_candles_min_1.bi5"
        raw = fetch(url)
        time.sleep(0.10)                     # sequential and polite; the Hard Rule forbids parallel fetching
        if not raw:
            missing += 1; d += dt.timedelta(days=1); continue
        try: binf = lzma.decompress(raw)
        except Exception:
            missing += 1; d += dt.timedelta(days=1); continue
        rows = []
        for i in range(len(binf) // 24):
            sec, o, c, lo, hi, vol = struct.unpack(">IIIIIf", binf[i*24:(i+1)*24])
            if o == 0: continue
            hh = sec // 3600
            if hh < H_FROM or hh >= H_TO: continue
            rows.append([sec, round(o*SCALE, 4), round(hi*SCALE, 4), round(lo*SCALE, 4), round(c*SCALE, 4)])
        if rows:
            out.write(json.dumps({"d": key, "b": rows}, separators=(",", ":")) + "\n")
            days += 1; bars += len(rows)
            if days % 200 == 0:
                out.flush()
                print(f"    ..{key}: {days} days, {bars:,} minute bars", flush=True)
        d += dt.timedelta(days=1)
finally:
    out.close()
print(f"\n    fetched {days} new day(s), {bars:,} minute bars | {skipped} already cached | {missing} day-files absent")
# COVERAGE STATEMENT, not a completion claim: absent day-files are holidays and pre-listing dates, and the count is
# reported so a later analysis cannot mistake a gap for a market fact.
tot = len(have) + days
span = (END - START).days
print(f"    cache now holds {tot} day(s) across a {span}-day span ({100*tot/max(1,span*5/7):.0f}% of ~weekday count)")
