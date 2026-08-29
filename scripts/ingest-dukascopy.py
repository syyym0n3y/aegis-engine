#!/usr/bin/env python3
# ingest-dukascopy.py (D-504) — Dukascopy m1 BID candles -> hourly bars in trd_fx_hourly.
# Sequential, browser UA, 503-backoff. Idempotent (ON CONFLICT DO NOTHING via staged copy).
import sys, os, lzma, struct, time, datetime as dt, subprocess, socket, http.client
socket.setdefaulttimeout(30)
# One persistent TLS connection: one-shot urllib paid ~7s/request in handshakes against this host (measured), which
# priced the crawl at ~26 hours. A reused HTTPSConnection brings it to ~0.3s/request.
CONN=[None]
def _conn():
    if CONN[0] is None: CONN[0]=http.client.HTTPSConnection("datafeed.dukascopy.com",timeout=30)
    return CONN[0]
PAIRS={"EURUSD":1e-5,"GBPUSD":1e-5,"USDJPY":1e-3,"AUDUSD":1e-5}
import os
if os.environ.get("PAIRS"):  # e.g. PAIRS="XAUUSD:1e-3,USA500IDXUSD:1e-3"
    PAIRS={p.split(":")[0]:float(p.split(":")[1]) for p in os.environ["PAIRS"].split(",")}
# D-715: the range is env-configurable so the DAILY runner can ask for just the recent gap. It was hardcoded to the
# full 2016-2026 span, which meant the only way to run it was a 20-minute crawl — so in practice it was run by hand,
# which is to say almost never, and the feed it owns had drifted 7.9 days stale while the continuity guard reported
# it faithfully and nothing acted. FROM defaults to 10 days back: idempotent, cheap, and enough to close any gap a
# short outage opens.
START=dt.date.fromisoformat(os.environ.get("FROM")) if os.environ.get("FROM") else dt.date.today()-dt.timedelta(days=10)
END=dt.date.fromisoformat(os.environ.get("TO")) if os.environ.get("TO") else dt.date.today()
UA={"User-Agent":"Mozilla/5.0"}
def fetch(path):
    for attempt in range(4):
        try:
            c=_conn(); c.request("GET",path,headers={"User-Agent":"Mozilla/5.0"})
            r=c.getresponse(); body=r.read()
            if r.status==200: return body
            if r.status==404: return None
            raise IOError(f"http {r.status}")
        except Exception:
            try: CONN[0].close()
            except Exception: pass
            CONN[0]=None
            time.sleep(3*(attempt+1))
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
            url=f"/datafeed/{pair}/{d.year}/{d.month-1:02d}/{d.day:02d}/BID_candles_min_1.bi5"
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
            time.sleep(0.1)
        nfiles=got
        if got and got%200==0 and len(buf)==0: pass
        if len(buf)>=8000:
            if not psql_copy(buf): sys.exit(1)
            total+=len(buf); buf=[]
            print(f"  ..{pair} {d}: {total:,} hourly rows",flush=True)
        d+=dt.timedelta(days=1)
    if not psql_copy(buf): sys.exit(1)
    total+=len(buf)
    print(f"{pair}: done, {got} day-files, cumulative {total:,} rows",flush=True)
print(f"TOTAL sent: {total:,}")
