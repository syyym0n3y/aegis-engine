#!/bin/bash
# ingest-form345.sh (D-490) — SEC DERA insider (Form 3/4/5) structured sets -> per-(symbol, filing-date)
# open-market BUY and SELL aggregates. TRANS_CODE P/S only, non-derivative table. Idempotent.
set -uo pipefail
D=/Users/ona/aegis-data/form345; mkdir -p "$D"; cd "$D"
UA="aegis-research ona@revitalise.io"
PSQL="docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1"
QUARTERS="${QUARTERS:-$(for y in $(seq 2006 2026); do for q in 1 2 3 4; do echo ${y}q${q}; done; done | sed -n '1,82p')}"
for q in $QUARTERS; do
  z="${q}_form345.zip"
  if [ ! -s "$z" ]; then
    url="https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${z}"
    [ "$q" = "2026q2" ] && url="https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets/${z}"
    curl -s -o "$z" "$url" -H "User-Agent: $UA" --max-time 300
  fi
  if ! unzip -l "$z" >/dev/null 2>&1; then echo "$q: MISSING (size $(stat -f%z "$z" 2>/dev/null))"; rm -f "$z"; continue; fi
  unzip -p "$z" SUBMISSION.tsv > sub345.tsv
  unzip -p "$z" NONDERIV_TRANS.tsv | awk -F'\t' -v SUB=sub345.tsv '
    BEGIN{ split("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC",mn," "); for(i=1;i<=12;i++) M[mn[i]]=sprintf("%02d",i);
      while((getline line < SUB)>0){ nf=split(line,a,"\t"); if(a[1]=="ACCESSION_NUMBER") continue;
        sym=a[12]; gsub(/[ \t]/,"",sym); if(sym==""||sym=="NONE"||sym=="N/A") continue;
        split(a[2],d,"-"); if(d[3]=="") continue;
        SY[a[1]]=toupper(sym); FD[a[1]]=d[3]"-"M[d[2]]"-"d[1]; } }
    NR>1 && ($10=="P"||$10=="S") && ($1 in SY) && $15!="" && $17!="" {
      v=$15*$17; if(v<=0||v>2e10) next;
      k=SY[$1] SUBSEP FD[$1];
      if($10=="P"){b[k]+=v;nb[k]++} else {s[k]+=v;ns[k]++}; seen[k]=1 }
    END{ for(k in seen){ split(k,p,SUBSEP);
      printf "%s\t%s\t%.0f\t%.0f\t%d\t%d\n", p[1], p[2], b[k]+0, s[k]+0, nb[k]+0, ns[k]+0 } }' > agg345.tsv
  rows=$(wc -l < agg345.tsv | tr -d ' ')
  { echo "create temp table stage_f345 (symbol text, filed date, buy_usd float8, sell_usd float8, n_buy int, n_sell int);
\\copy stage_f345 from stdin with (format text)"
    cat agg345.tsv
    echo "\\."
    echo "insert into trd_form345 select * from stage_f345
  on conflict (symbol, filed) do update set buy_usd=excluded.buy_usd, sell_usd=excluded.sell_usd,
    n_buy=excluded.n_buy, n_sell=excluded.n_sell;"
  } | $PSQL
  if [ $? -ne 0 ]; then echo "$q: WRITE-FAILED"; else echo "$q: $rows symbol-days"; fi
  rm -f agg345.tsv sub345.tsv "$z"
done
$PSQL -Atc "select count(*), min(filed), max(filed), count(distinct symbol), round(sum(sell_usd)/1e9) sells_bn, round(sum(buy_usd)/1e9) buys_bn from trd_form345;" | xargs echo "TOTAL:"
