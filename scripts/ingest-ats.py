#!/usr/bin/env python3
# ingest-ats.py (D-505) — FINRA weeklySummary API -> trd_ats_weekly. Sequential, per-week, offset-paginated.
import json, time, datetime as dt, subprocess, urllib.request, sys
def post(body):
    for a in range(4):
        try:
            req=urllib.request.Request("https://api.finra.org/data/group/otcMarket/name/weeklySummary",
                data=json.dumps(body).encode(),headers={"Content-Type":"application/json","Accept":"application/json"})
            with urllib.request.urlopen(req,timeout=90) as r:
                if r.status==204: return []
                return json.load(r)
        except Exception:
            time.sleep(5*(a+1))
    return None
def copy(rows):
    if not rows: return True
    data="".join("\t".join(map(str,r))+"\n" for r in rows)
    sql=("create temp table stage_ats (symbol text, week_start date, type text, published date, shares float8, trades float8);\n"
         "\\copy stage_ats from stdin with (format text)\n"+data+"\\.\n"
         "insert into trd_ats_weekly select * from stage_ats on conflict (symbol, week_start, type) do nothing;\n")
    p=subprocess.run(["docker","exec","-i","aegis-db","psql","-U","postgres","-d","postgres","-q","-v","ON_ERROR_STOP=1"],
                     input=sql.encode(),capture_output=True)
    if p.returncode!=0: print("WRITE-FAILED trd_ats_weekly:",p.stderr.decode()[:200],flush=True); return False
    return True
d=dt.date(2022,1,3); total=0
while d<=dt.date.today():
    wk=d.isoformat(); rows=[]; off=0
    while True:
        batch=post({"limit":5000,"offset":off,
          "compareFilters":[{"fieldName":"weekStartDate","compareType":"EQUAL","fieldValue":wk}],
          "domainFilters":[{"fieldName":"summaryTypeCode","values":["ATS_W_SMBL","OTC_W_SMBL"]}]})
        if batch is None: print(f"{wk}: FETCH-FAILED",flush=True); break
        for r in batch:
            sym=r.get("issueSymbolIdentifier")
            if not sym: continue
            rows.append((sym,wk,r["summaryTypeCode"],r.get("initialPublishedDate") or wk,
                         r.get("totalWeeklyShareQuantity") or 0, r.get("totalWeeklyTradeCount") or 0))
        if not batch or len(batch)<5000: break
        off+=5000; time.sleep(0.3)
    if not copy(rows): sys.exit(1)
    total+=len(rows)
    if d.toordinal()%70<7: print(f"  ..{wk}: cumulative {total:,}",flush=True)
    time.sleep(0.4); d+=dt.timedelta(days=7)
print(f"TOTAL {total:,}")
