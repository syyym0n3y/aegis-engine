#!/usr/bin/env python3
# rebuild-spxw-oi.py (D-820) — rebuild data/databento/spxw-oi.jsonl from the raw statistics CSV with the day taken from ts_event
# (ts_ref renders empty for open-interest rows, which collapsed every OI day onto one key in the first pass). Streams the CSV.
import csv, json, os, re, sys, collections
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')); F = os.path.join(REPO, 'data', 'databento', 'spxw-statistics.csv'); OUT = os.path.join(REPO, 'data', 'databento', 'spxw-oi.jsonl')
DAY = os.environ.get('DAY_FIELD', 'ts_event'); oi = collections.defaultdict(dict); pat = re.compile(r'^SPXW\s+(\d{6})([CP])(\d{8})$'); n = 0; noi = 0
with open(F, newline='') as fh:
    r = csv.reader(fh); hd = next(r); it = hd.index('stat_type'); iq = hd.index('quantity'); isym = hd.index('symbol'); iday = hd.index(DAY)
    for row in r:
        n += 1
        if row[it] != '9': continue
        m = pat.match(row[isym]);
        if not m: continue
        d = row[iday][:10]; key = (f"20{m.group(1)[:2]}-{m.group(1)[2:4]}-{m.group(1)[4:6]}", m.group(2), int(m.group(3)) / 1000); oi[d][key] = int(float(row[iq] or 0)); noi += 1
with open(OUT, 'w') as fh:
    for d in sorted(oi): fh.write(json.dumps({"d": d, "rows": [[k[0], k[1], k[2], v] for k, v in oi[d].items()]}) + "\n")
print(f"==> rebuilt {OUT}: {len(oi)} OI days from {noi:,} open-interest rows ({n:,} statistics rows); first {min(oi) if oi else '-'} last {max(oi) if oi else '-'}")
if len(oi) < 60: print("  RED — fewer than 60 OI days"); sys.exit(1)
