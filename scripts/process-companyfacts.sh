#!/usr/bin/env bash
# process-companyfacts.sh (D-482) — SEC companyfacts bulk into trd_fundamentals.
# Two upgrades over the frames loader this replaces the gaps of:
#   (1) TRUE POINT-IN-TIME: every fact carries its actual `filed` date; effective_date becomes the EARLIEST filing that
#       disclosed that (concept, period_end) — replacing the +75-day assumption everywhere this data covers.
#   (2) FISCAL-ALIGNMENT: frames only serve calendar-aligned windows; companyfacts carries every fiscal shape, closing
#       the systematic hole against odd-fiscal-year companies.
# Stream: extract zip -> python walks 20,266 JSONs -> TSV -> staged \copy -> merged upsert. Landing verified by counts.
set -euo pipefail
S="${SCRATCH:?}"; cd "$S"
if [ ! -d cf ]; then mkdir -p cf && unzip -q -o companyfacts.zip -d cf; fi
echo "extracted: $(ls cf | wc -l | tr -d ' ') files"
curl -s "https://www.sec.gov/files/company_tickers.json" -H "User-Agent: aegis-research ona@revitalise.io" -o tickers.json
python3 - <<'PY'
import json,os,glob
CONCEPTS_USD=["Assets","Liabilities","StockholdersEquity","NetIncomeLoss","AssetsCurrent","LiabilitiesCurrent",
"CashAndCashEquivalentsAtCarryingValue","InventoryNet","AccountsReceivableNetCurrent","Revenues",
"RevenueFromContractWithCustomerExcludingAssessedTax","CostOfRevenue","GrossProfit","OperatingIncomeLoss",
"ResearchAndDevelopmentExpense","SellingGeneralAndAdministrativeExpenses","NetCashProvidedByUsedInOperatingActivities",
"NetCashProvidedByUsedInInvestingActivities","PaymentsToAcquirePropertyPlantAndEquipment",
"DepreciationDepletionAndAmortization","InterestExpense","IncomeTaxExpenseBenefit","PaymentsOfDividendsCommonStock",
"PaymentsForRepurchaseOfCommonStock","OperatingExpenses","LongTermDebtNoncurrent","DebtCurrent",
"PropertyPlantAndEquipmentNet","Goodwill","RetainedEarningsAccumulatedDeficit","AccountsPayableCurrent",
"EarningsPerShareDiluted"]
t=json.load(open("tickers.json"))
cik2t={str(v["cik_str"]):v["ticker"].upper() for v in t.values()}
out=open("cf_facts.tsv","w")
best={}  # (ticker,concept,end) -> (filed,val)
n_files=0
for fp in glob.glob("cf/CIK*.json"):
    n_files+=1
    if n_files%2000==0: print(f"  ..{n_files} files, {len(best):,} facts", flush=True)
    cik=os.path.basename(fp)[3:13].lstrip("0")
    tick=cik2t.get(cik)
    if not tick: continue
    try: d=json.load(open(fp))
    except Exception: continue
    gaap=(d.get("facts") or {}).get("us-gaap") or {}
    for c in CONCEPTS_USD:
        node=gaap.get(c)
        if not node: continue
        for unit,entries in (node.get("units") or {}).items():
            if unit not in ("USD","USD/shares"): continue
            for e in entries:
                form=e.get("form") or ""
                if not (form.startswith("10-K") or form.startswith("10-Q")): continue
                end=e.get("end"); filed=e.get("filed"); val=e.get("val")
                if not end or not filed or val is None: continue
                # duration facts: keep only ~quarterly windows (60-100d) or annual (350-380d) so TTM sums stay coherent
                st=e.get("start")
                if st:
                    from datetime import date
                    try:
                        ln=(date.fromisoformat(end)-date.fromisoformat(st)).days
                    except Exception: continue
                    if not (55<=ln<=100 or 350<=ln<=380): continue
                    if 350<=ln<=380 and c not in ("EarningsPerShareDiluted",): 
                        # annual duration rows kept ONLY where quarterly absent — mark with A suffix key so quarterly wins
                        k=(tick,c,end,"A")
                    else: k=(tick,c,end,"Q")
                else:
                    k=(tick,c,end,"I")
                cur=best.get(k)
                if cur is None or filed<cur[0]: best[k]=(filed,val)
# resolve A vs Q: drop annual where a quarterly exists for same (tick,c,end)
qkeys={(t_,c_,e_) for (t_,c_,e_,typ) in best if typ in ("Q","I")}
w=0
for (t_,c_,e_,typ),(filed,val) in best.items():
    if typ=="A" and (t_,c_,e_) in qkeys: continue
    out.write(f"{t_}\t{t_}\t{c_}\t{e_}\t{filed}\t{val}\n"); w+=1
out.close()
print(f"==> {n_files} files -> {w:,} point-in-time facts written")
PY
wc -l cf_facts.tsv
docker exec aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c "create table if not exists _cf_stage(cik text,ticker text,concept text,period_end date,filed date,value double precision);"
docker exec aegis-db psql -U postgres -d postgres -q -c "truncate _cf_stage;"
docker exec -i aegis-db psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c "\copy _cf_stage from stdin with (format text)" < cf_facts.tsv
docker exec aegis-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
insert into trd_fundamentals (cik,ticker,concept,period_end,effective_date,value,updated_at)
select cik,ticker,concept,period_end,filed,value,now() from _cf_stage
on conflict (cik,concept,period_end) do update
  set value=excluded.value, effective_date=excluded.effective_date, updated_at=now()
  where excluded.effective_date <= trd_fundamentals.effective_date;   -- true-filed can only tighten, never loosen
select count(*) from trd_fundamentals;"
docker exec aegis-db psql -U postgres -d postgres -q -c "drop table if exists _cf_stage;"
echo "== companyfacts merged =="
