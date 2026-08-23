#!/bin/bash
# ingest-13f.sh (D-494) — SEC 13F structured sets -> per-(cusip, report-period) institutional ownership aggregates.
# Dedup: per (CIK, period) keep only the latest-filed 13F-HR/13F-HR&A. PUTCALL rows excluded. Pre-2023 VALUE is in
# $thousands (SEC full-dollar rule change) — normalized here by report period (<2023-01-01 -> x1000).
# effective_date = the latest FILING_DATE among contributors to that (cusip, period) aggregate.
set -uo pipefail
D=/Users/ona/aegis-data/form13f; mkdir -p "$D"; cd "$D"
UA="aegis-research ona@revitalise.io"
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
URLS="${URLS:-/tmp/claude-501/-Users-ona-Projects-aegis/1292132c-91ce-4acc-a833-40f48105f2a1/scratchpad/form13f-urls.txt}"
tail -r "$URLS" | while read -r path; do    # oldest first
  z=$(basename "$path")
  [ -s "$z" ] || curl -s -o "$z" "https://www.sec.gov${path}" -H "User-Agent: $UA" --max-time 900
  if ! unzip -l "$z" >/dev/null 2>&1; then echo "$z: MISSING/corrupt"; rm -f "$z"; continue; fi
  unzip -p "$z" SUBMISSION.tsv > sub13f.tsv
  unzip -p "$z" INFOTABLE.tsv | awk -F'\t' -v SUB=sub13f.tsv '
    BEGIN{ split("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC",mn," "); for(i=1;i<=12;i++) M[mn[i]]=sprintf("%02d",i);
      while((getline line < SUB)>0){ nf=split(line,a,"\t"); if(a[1]=="ACCESSION_NUMBER") continue;
        if(a[3]!~/^13F-HR/) continue;
        split(a[2],fd,"-"); split(a[5],pd,"-"); if(fd[3]==""||pd[3]=="") continue;
        f=fd[3]"-"M[fd[2]]"-"fd[1]; p=pd[3]"-"M[pd[2]]"-"pd[1];
        key=a[4] SUBSEP p;
        if(!(key in BEST) || f > BESTF[key]){ if(key in BEST) DROP[BEST[key]]=1; BEST[key]=a[1]; BESTF[key]=f; }
        else DROP[a[1]]=1;
        ACC[a[1]]=p; FIL[a[1]]=f; }
      for(k in BEST){ KEEP[BEST[k]]=1 } }
    NR>1 && ($1 in KEEP) && $10=="" && $5 ~ /^[0-9A-Z]{9}$/ && $9=="SH" {
      p=ACC[$1]; mult=(p<"2023-01-01")?1000:1;
      k=$5 SUBSEP p; n[k]++; sh[k]+=$8; v[k]+=$7*mult;
      if(FIL[$1]>eff[k]) eff[k]=FIL[$1] }
    END{ for(k in n){ split(k,q,SUBSEP);
      printf "%s\t%s\t%s\t%d\t%.0f\t%.0f\n", q[1], q[2], eff[k], n[k], sh[k], v[k] } }' > agg13f.tsv
  rows=$(wc -l < agg13f.tsv | tr -d ' ')
  { echo "create temp table stage_13f (cusip text, report_date date, effective_date date, n_mgrs int, shares float8, value_usd float8);
\\copy stage_13f from stdin with (format text)"
    cat agg13f.tsv
    echo "\\."
    echo "insert into trd_13f_ownership select * from stage_13f
  on conflict (cusip, report_date) do update set n_mgrs=excluded.n_mgrs, shares=excluded.shares,
    value_usd=excluded.value_usd, effective_date=greatest(trd_13f_ownership.effective_date, excluded.effective_date);"
  } | $PSQL
  if [ $? -ne 0 ]; then echo "$z: WRITE-FAILED"; else echo "$z: $rows cusip-periods"; fi
  rm -f agg13f.tsv sub13f.tsv "$z"
done
$PSQL -Atc "select count(*), min(report_date), max(report_date), count(distinct cusip), round(max(value_usd)/1e9) from trd_13f_ownership;" | xargs echo "TOTAL:"
