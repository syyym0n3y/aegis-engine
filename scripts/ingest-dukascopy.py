#!/usr/bin/env python3
# ingest-dukascopy.py (D-504) — Dukascopy m1 BID candles -> hourly bars in trd_fx_hourly.
# Sequential, browser UA, 503-backoff. Idempotent (ON CONFLICT DO NOTHING via staged copy).
import sys, os, lzma, struct, time, datetime as dt, subprocess, urllib.request
PAIRS={"EURUSD":1e-5,"GBPUSD":1e-5,"USDJPY":1e-3,"AUDUSD":1e-5}
START=dt.date(2016,1,1); END=dt.date(2026,8,22)
UA={"User-Agent":"Mozilla/5.0"}
def fetch(url):
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers=UA)
            with urllib.request.urlopen(req,timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code==404: return None
            time.sleep(5*(attempt+1))
        except Exception:
            time.sleep(5*(attempt+1))
    return None
def psql_copy(rows):
    if not rows: return True
    data="".join(f"{s}\t{ts}\t{o}\t{h}\t{l}\t{c}\t{v}\n" for s,ts,o,h,l,c,v in rows)
    sql=("create temp table stage_fx (symbol text, ts bigint, o float8, h float8, l float8, c float8, vol float8);\n"
         "\\copy stage_fx from stdin with (format text)\n"+data+"\\.\n"
         "insert into trd_fx_hourly select * from stage_fx on conflict (symbol, ts) do nothing;\n")
    p=subprocess.run(["docker","exec","-i","aegis-db","psql","-U","postgres","-d","postgres","-q","-v","ON_ERROR_STOP=1"],
                     input=sql.encode(),capture_output=True)
    if p.returncode!=0:
        print("WRITE-FAILED trd_fx_hourly:",p.stderr.decode()[:200],flush=True); return False
    return True
total=0
for pair,scale in PAIRS.items():
    d=START; buf=[]; got=0
    while d<=END:
        if d.weekday()!=5:  # Saturday has no session; Sunday partial exists
            url=f"https://datafeed.dukascopy.com/datafeed/{pair}/{d.year}/{d.month-1:02d}/{d.day:02d}/BID_candles_min_1.bi5"
            raw=fetch(url)
            if raw:
                try: bin_=lzma.decompress(raw)
                except Exception: bin_=b""
                base=int(dt.datetime(d.year,d.month,d.day,tzinfo=dt.timezone.utc).timestamp())
                hours={}
                for i in range(len(bin_)//24):
                    sec,o,c,lo,hi,vol=struct.unpack(">IIIIIf",bin_[i*24:(i+1)*24])
                    if o==0: continue
                    hts=base+(sec//3600)*3600
                    b=hours.get(hts)
                    if b is None: hours[hts]=[o*scale,hi*scale,lo*scale,c*scale,vol]
                    else:
                        b[1]=max(b[1],hi*scale); b[2]=min(b[2],lo*scale); b[3]=c*scale; b[4]+=vol
                for hts,b in hours.items():
                    buf.append((pair,hts,round(b[0],6),round(b[1],6),round(b[2],6),round(b[3],6),round(b[4],2)))
                got+=1
            time.sleep(0.25)
        if len(buf)>=20000:
            if not psql_copy(buf): sys.exit(1)
            total+=len(buf); buf=[]
            print(f"  ..{pair} {d}: {total:,} hourly rows",flush=True)
        d+=dt.timedelta(days=1)
    if not psql_copy(buf): sys.exit(1)
    total+=len(buf)
    print(f"{pair}: done, {got} day-files, cumulative {total:,} rows",flush=True)
print(f"TOTAL sent: {total:,}")
