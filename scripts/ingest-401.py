#!/usr/bin/env python3
# ingest-402.py (D-508) — 8-K Item 4.01 events via EDGAR full-text search, monthly windows, sequential.
import json, re, time, datetime as dt, subprocess, urllib.request, urllib.parse, sys
UA={"User-Agent":"aegis-research ona@revitalise.io"}
def get(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=60) as r:
                return json.load(r)
        except Exception: time.sleep(4*(a+1))
    return None
rows=[]; d=dt.date(2004,1,1)
while d<=dt.date(2026,8,1):
    end=(d.replace(day=28)+dt.timedelta(days=4)).replace(day=1)-dt.timedelta(days=1)
    frm=0
    while True:
        q=urllib.parse.urlencode({"q":'"Item 4.01"',"forms":"8-K","dateRange":"custom",
                                  "startdt":d.isoformat(),"enddt":end.isoformat(),"from":frm,"size":100})
        j=get(f"https://efts.sec.gov/LATEST/search-index?{q}")
        if not j: print(f"{d}: FETCH-FAILED",flush=True); break
        hits=j.get("hits",{}).get("hits",[])
        for h in hits:
            s=h["_source"]
            if "4.01" not in (s.get("items") or []): continue
            for dn in s.get("display_names") or []:
                m=re.search(r"\(([A-Z][A-Z0-9.,\- ]{0,40})\)\s+\(CIK",dn)
                if not m: continue
                tick=m.group(1).split(",")[0].strip()
                if tick and len(tick)<=6:
                    rows.append((h["_id"].split(":")[0]+":"+tick, tick, s["file_date"]))
                break
        if len(hits)<100: break
        frm+=100; time.sleep(0.3)
    if d.month==1: print(f"  ..{d.year}: {len(rows):,} rows so far",flush=True)
    time.sleep(0.35)
    d=(end+dt.timedelta(days=1))
seen=set(); uniq=[r for r in rows if not (r[0] in seen or seen.add(r[0]))]
data="".join(f"{a}\t{s}\t{f}\n" for a,s,f in uniq)
sql=("create temp table stage_e (accession text, symbol text, filed date);\n"
     "\\copy stage_e from stdin with (format text)\n"+data+"\\.\n"
     "insert into trd_events_401 select * from stage_e on conflict (accession) do nothing;\n")
p=subprocess.run(["docker","exec","-i","aegis-db","psql","-U","postgres","-d","postgres","-q","-v","ON_ERROR_STOP=1"],input=sql.encode(),capture_output=True)
if p.returncode!=0: print("WRITE-FAILED:",p.stderr.decode()[:200]); sys.exit(1)
print(f"TOTAL {len(uniq):,} 4.01 events")
