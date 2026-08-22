#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-factory.ts (D-470) — THE STRATEGY FACTORY. Enumerates the spec grid and pushes every run through the six gates
// of the trd_factory ledger, incrementing the live trial counter per run so the deflation ceiling rises with the sweep.
// Three families in this runner:
//   XSEC_EQ   — monthly equity cross-sections: ~26 signals (price/volume + the NEW fundamental families Tier A unlocked:
//               cash-flow yield, FCF yield, buyback yield, R&D intensity, gross profitability, leverage, margins, FTD
//               stress) x formation/hold/bucket variants, ranked INSIDE the $10M/day tradable universe.
//   XSEC_PERP — daily cross-sections on the 498-contract survivorship-free perp universe.
//   TIMING    — single-instrument rules (MA cross, breakout, RSI-MR, post-loss cooldown) on 10 liquid instruments,
//               judged against BUY-AND-HOLD of the same instrument (the D-439 control), exempt from breadth by class.
// Honesty is structural: portfolio_t only (n = rebalances), pre-registered signal SIGNS (a spec tests its documented
// direction; flipping sign to fit is a different spec and costs another trial), era gate = same net sign in >=3 of 4 eras,
// survivor = the ledger's GENERATED column, never this script's opinion.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fac",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_EQ=10, FEE_PERP=9;                       // bp round trip
const DV_MIN=1e7;
const enc=new TextEncoder();
const log=(s:string)=>Deno.stdout.write(enc.encode(s+"\n"));

// ---------- live deflation ceiling ----------
async function ceiling(){
  const r=await fetch(`${OWNED}/trd_trial_counter?select=id&limit=1`,{headers:{...hdr,Prefer:"count=exact"}}).catch(()=>null);
  const live=r?+((r.headers.get("content-range")||"").split("/")[1]||0):0;
  return {N:1_530_000+live,ceil:Math.sqrt(2*Math.log(1_530_000+live))};
}
// ---------- fundamentals (point-in-time) ----------
type FRec={eff:string;v:number};
const fund=new Map<string,Map<string,FRec[]>>();
const CONC=["StockholdersEquity","NetIncomeLoss","Assets","EntityCommonStockSharesOutstanding","AssetsCurrent","LiabilitiesCurrent","CashAndCashEquivalentsAtCarryingValue","NetCashProvidedByUsedInOperatingActivities","PaymentsToAcquirePropertyPlantAndEquipment","PaymentsForRepurchaseOfCommonStock","PaymentsOfDividendsCommonStock","ResearchAndDevelopmentExpense","GrossProfit","Revenues","OperatingIncomeLoss","LongTermDebtNoncurrent","InterestExpense","SellingGeneralAndAdministrativeExpenses"];
async function loadFund(){
  let n=0;
  for(const c of CONC) for(let off=0;;off+=10000){
    const p=await fetch(`${OWNED}/trd_fundamentals?concept=eq.${c}&select=ticker,effective_date,value&order=effective_date&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p)||!p.length)break;
    for(const r of p as {ticker:string;effective_date:string;value:number}[]){
      if(!r.ticker||!Number.isFinite(r.value))continue;
      ((fund.get(r.ticker)??fund.set(r.ticker,new Map()).get(r.ticker)!).get(c)??(fund.get(r.ticker)!.set(c,[]).get(c)!)).push({eff:r.effective_date,v:r.value});n++;}
    if(p.length<10000)break;
  }
  for(const [,m] of fund) for(const [,a] of m) a.sort((x,y)=>x.eff<y.eff?-1:1);
  await log(`  fundamentals: ${n.toLocaleString()} facts, ${fund.size} tickers`);
}
function asOf(t:string,c:string,d:string):number|null{
  const a=fund.get(t)?.get(c); if(!a?.length)return null;
  let lo=0,hi=a.length-1,best=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(a[m].eff<=d){best=m;lo=m+1;}else hi=m-1;}
  return best<0?null:a[best].v;
}
const back=(t:string,c:string,d:string,days:number)=>{const x=new Date(d+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-days);return asOf(t,c,x.toISOString().slice(0,10));};
// trailing-4-quarter sum for FLOW concepts (quarterly frames)
function ttm(t:string,c:string,d:string):number|null{
  const a=fund.get(t)?.get(c); if(!a?.length)return null;
  let hi=-1,lo=0,h2=a.length-1;
  while(lo<=h2){const m=(lo+h2)>>1;if(a[m].eff<=d){hi=m;lo=m+1;}else h2=m-1;}
  if(hi<3)return null;
  return a[hi].v+a[hi-1].v+a[hi-2].v+a[hi-3].v;
}
// ---------- FTD (monthly aggregates per symbol) ----------
const ftd=new Map<string,Map<string,number>>();    // sym -> "YYYY-MM" -> total fails
async function loadFTD(){
  let n=0;
  for(let off=0;;off+=50000){
    const p=await fetch(`${OWNED}/trd_ftd?select=symbol,settle_date,qty_fails&order=settle_date&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p)||!p.length)break;
    for(const r of p as {symbol:string;settle_date:string;qty_fails:number}[]){
      const mo=r.settle_date.slice(0,7);
      (ftd.get(r.symbol)??ftd.set(r.symbol,new Map()).get(r.symbol)!).set(mo,((ftd.get(r.symbol)!.get(mo))||0)+r.qty_fails);n++;}
    if(p.length<50000)break;
  }
  await log(`  ftd: ${n.toLocaleString()} day-rows aggregated to ${ftd.size} symbols`);
}
// ---------- equity monthly panel ----------
type EqRow={mo:string;sym:string;fwd:number;dv:number;sig:Record<string,number|null>};
const eqPanel:EqRow[]=[];
async function buildEqPanel(){
  const meta:{symbol:string}[]=[];
  for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
  for(let i=0;i<meta.length;i+=30){
    const part=meta.slice(i,i+30).map(m=>`"${m.symbol}"`).join(",");
    const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
    if(!Array.isArray(rows))continue;
    for(const r of rows){
      const b=r.bars; if(!b||b.length<300)continue;
      const idx:number[]=[]; let last="";
      for(let k=0;k<b.length;k++){const mo=new Date(b[k][0]*1000).toISOString().slice(0,7);if(mo!==last){if(k>0)idx.push(k-1);last=mo;}}
      idx.push(b.length-1);
      const c=b.map(x=>x[4]),v=b.map(x=>x[5]);
      for(let j=12;j<idx.length-1;j++){
        const k=idx[j],kn=idx[j+1],px=c[k]; if(!(px>1))continue;
        let dv=0,cn=0; for(let q=Math.max(0,k-21);q<k;q++)if(c[q]>0&&v[q]>0){dv+=c[q]*v[q];cn++;}
        if(!cn||(dv/=cn)<DV_MIN)continue;                                 // LIQUIDITY: inside the tradable universe
        const fwd=c[kn]/px-1; if(!Number.isFinite(fwd)||Math.abs(fwd)>3)continue;
        const d=new Date(b[k][0]*1000).toISOString().slice(0,10), mo=d.slice(0,7);
        const rets:number[]=[]; for(let q=Math.max(1,k-252);q<=k;q++)if(c[q-1]>0)rets.push(c[q]/c[q-1]-1);
        const sh=asOf(r.symbol,"EntityCommonStockSharesOutstanding",d); const mc=(sh&&sh>0)?px*sh:null;
        const at=asOf(r.symbol,"Assets",d), eq=asOf(r.symbol,"StockholdersEquity",d);
        const ocf=ttm(r.symbol,"NetCashProvidedByUsedInOperatingActivities",d);
        const capex=ttm(r.symbol,"PaymentsToAcquirePropertyPlantAndEquipment",d);
        const bb=ttm(r.symbol,"PaymentsForRepurchaseOfCommonStock",d), div=ttm(r.symbol,"PaymentsOfDividendsCommonStock",d);
        const rd=ttm(r.symbol,"ResearchAndDevelopmentExpense",d), gp=ttm(r.symbol,"GrossProfit",d);
        const rev=ttm(r.symbol,"Revenues",d), op=ttm(r.symbol,"OperatingIncomeLoss",d);
        const ltd=asOf(r.symbol,"LongTermDebtNoncurrent",d), ie=ttm(r.symbol,"InterestExpense",d);
        const ni=ttm(r.symbol,"NetIncomeLoss",d);
        const ac=asOf(r.symbol,"AssetsCurrent",d),lc=asOf(r.symbol,"LiabilitiesCurrent",d),csh=asOf(r.symbol,"CashAndCashEquivalentsAtCarryingValue",d);
        const acP=back(r.symbol,"AssetsCurrent",d,400),lcP=back(r.symbol,"LiabilitiesCurrent",d,400),cshP=back(r.symbol,"CashAndCashEquivalentsAtCarryingValue",d,400);
        const atP=back(r.symbol,"Assets",d,400), shP=back(r.symbol,"EntityCommonStockSharesOutstanding",d,400);
        const fm=ftd.get(r.symbol); const prevMo=new Date(d+"T00:00:00Z"); prevMo.setUTCMonth(prevMo.getUTCMonth()-1);
        const fails=fm?.get(prevMo.toISOString().slice(0,7));            // LAGGED one month (publication lag)
        const nul=(x:number|null|undefined)=>x==null||!Number.isFinite(x)?null:x;
        eqPanel.push({mo,sym:r.symbol,fwd,dv,sig:{
          mom12_1:c[k-Math.min(k,21)]&&idx[j-12]!=null&&c[idx[j-12]]>0?c[idx[j-1]]/c[idx[j-12]]-1:null,
          mom6_1:idx[j-6]!=null&&c[idx[j-6]]>0?c[idx[j-1]]/c[idx[j-6]]-1:null,
          rev1m:idx[j-1]!=null&&c[idx[j-1]]>0?px/c[idx[j-1]]-1:null,
          vol12:rets.length>200?sdv(rets):null,
          hi52:px/Math.max(...c.slice(Math.max(0,k-252),k+1)),
          bm:(mc&&eq!=null&&mc>0)?eq/mc:null,
          ep:(mc&&ni!=null&&mc>0)?ni/mc:null,
          cfo_yield:(mc&&ocf!=null&&mc>0)?ocf/mc:null,
          fcf_yield:(mc&&ocf!=null&&capex!=null&&mc>0)?(ocf-capex)/mc:null,
          buyback_yield:(mc&&bb!=null&&mc>0)?bb/mc:null,
          div_yield:(mc&&div!=null&&mc>0)?div/mc:null,
          shareholder_yield:(mc&&bb!=null&&div!=null&&mc>0)?(bb+div)/mc:null,
          gross_prof:(at&&gp!=null&&at>0)?gp/at:null,
          rd_intensity:(at&&rd!=null&&at>0)?rd/at:null,
          op_margin:(rev&&op!=null&&rev>0)?op/rev:null,
          roe:(eq&&ni!=null&&eq>0)?ni/eq:null,
          leverage:(at&&ltd!=null&&at>0)?-(ltd/at):null,                  // pre-registered: LOW leverage good
          int_burden:(op&&ie!=null&&op>0)?-(ie/op):null,
          accruals:(ac!=null&&lc!=null&&csh!=null&&acP!=null&&lcP!=null&&cshP!=null&&at&&at>0)?-((((ac-csh)-lc)-((acP-cshP)-lcP))/at):null,
          asset_growth:(at&&atP&&atP>0)?-(at/atP-1):null,
          issuance:(sh&&shP&&shP>0)?-(sh/shP-1):null,
          ftd_stress:nul(fails!=null&&sh&&sh>0?-(fails/sh):null),         // pre-registered: HIGH fails bad
        }});
      }
    }
    if(i%900===0)await log(`  ..eq panel ${i}/${meta.length} rows=${eqPanel.length}`);
  }
  await log(`  equity panel: ${eqPanel.length.toLocaleString()} rows`);
}
// ---------- generic cross-section evaluator ----------
type Gate={n_names:number;n_periods:number;gross_ann:number;net_ann:number;sharpe:number;t:number;dd:number;ruined:boolean;
  g_breadth:boolean;g_effect:boolean;g_benchmark:boolean;g_liquid:boolean;g_era:boolean;eras:number[]};
// hold: forward window in months. OVERLAP FIX (the factory's first two "survivors" were this bug): a 3-month forward
// return sampled MONTHLY gives consecutive observations sharing 2/3 of their window — t inflated ~sqrt(3), the exact
// D-454 trap. Periods are strided by `hold` so every observation is disjoint; n_periods drops accordingly and the t is
// honest. Caught because the h3 rows carried the SAME n_periods as h1 — the number that cannot lie.
function evalXsec(rows:{mo:string;fwd:number;v:number}[],feeBp:number,k:number,perYear:number,hold=1):Gate|null{
  const by=new Map<string,{fwd:number;v:number}[]>();
  for(const r of rows)(by.get(r.mo)??by.set(r.mo,[]).get(r.mo)!).push(r);
  const perAll=[...by.entries()].filter(([,g])=>g.length>=30).sort((a,b)=>a[0]<b[0]?-1:1);
  const per=hold>1?perAll.filter((_,i)=>i%hold===0):perAll;   // DISJOINT windows only
  if(per.length<24)return null;
  const rets:number[]=[],names:number[]=[],moKeys:string[]=[];
  for(const [mo,g] of per){
    g.sort((a,b)=>b.v-a.v);
    const q=Math.max(3,Math.floor(g.length/k));
    rets.push(mean(g.slice(0,q).map(x=>x.fwd))-mean(g.slice(-q).map(x=>x.fwd))-feeBp/1e4);
    names.push(g.length); moKeys.push(mo);
  }
  const m=mean(rets),sd=sdv(rets)||1e-9,t=m/(sd/Math.sqrt(rets.length));
  let cum=1,pk=1,dd=0,ruined=false;
  for(const r of rets){cum*=1+r;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
  const bounds=[0.25,0.5,0.75].map(f=>moKeys[Math.floor(f*moKeys.length)]);
  const eras=[0,1,2,3].map(e=>{
    const g=rets.filter((_,i)=>{const mo=moKeys[i];
      return e===0?mo<bounds[0]:e===1?mo>=bounds[0]&&mo<bounds[1]:e===2?mo>=bounds[1]&&mo<bounds[2]:mo>=bounds[2];});
    return g.length?mean(g):0;});
  const nn=mean(names);
  return {n_names:Math.round(nn),n_periods:rets.length,gross_ann:(m+feeBp/1e4)*perYear,net_ann:m*perYear,
    sharpe:(m/sd)*Math.sqrt(perYear),t,dd:dd*100,ruined,
    g_breadth:nn>=50,g_effect:Math.abs(m+feeBp/1e4)>=feeBp/1e4,g_benchmark:m>0,g_liquid:true,
    g_era:eras.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3,eras};
}
// ---------- ledger write ----------
let written=0,trialRows:{family:string;run_key:string}[]=[];
async function record(spec_key:string,family:string,spec:unknown,universe:string,g:Gate|null,ceil:number){
  trialRows.push({family,run_key:spec_key});
  if(trialRows.length>=200){
    const r=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},body:JSON.stringify(trialRows)}).catch(()=>null);
    if(!r||!r.ok)await log(`WRITE-FAILED trd_trial_counter ${r?r.status:"net"}`);
    trialRows=[];
  }
  const row=g?{spec_key,family,spec,universe,n_names:g.n_names,n_periods:g.n_periods,gross_ann:+g.gross_ann.toFixed(4),
    net_ann:+g.net_ann.toFixed(4),sharpe_net:+g.sharpe.toFixed(3),portfolio_t:+g.t.toFixed(3),maxdd_pct:+g.dd.toFixed(1),
    ruined:g.ruined,g_breadth:g.g_breadth,g_effect:g.g_effect,g_benchmark:g.g_benchmark,g_liquid:g.g_liquid,g_era:g.g_era,
    g_deflation:g.t>ceil,note:null}
    :{spec_key,family,spec,universe,ruined:false,note:"UNTESTED: insufficient panel"};
  const r=await fetch(`${OWNED}/trd_factory?on_conflict=spec_key`,{method:"POST",
    headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([row])}).catch(()=>null);
  if(!r||!r.ok)await log(`WRITE-FAILED trd_factory ${r?r.status:"net"} ${spec_key}`);
  else written++;
}
// ---------- main ----------
const t0=Date.now();
await log("==> AEGIS FACTORY — building panels");
await loadFund(); await loadFTD(); await buildEqPanel();
const {N,ceil}=await ceiling();
await log(`  deflation ceiling at start: ${ceil.toFixed(3)} (N=${N.toLocaleString()})`);
const SIGNALS=Object.keys(eqPanel[0]?.sig??{});
await log(`  equity signals: ${SIGNALS.length} → grid = signals x lag{0,1} x hold{1,3} x buckets{5,10} x universe{all,liquid-top-third}`);
let done=0;
for(const sig of SIGNALS) for(const lag of [0,1]) for(const hold of [1,3]) for(const k of [5,10]) for(const uni of ["all","liqtop"]){
  if(uni==="liqtop"&&(lag>0||hold>1))continue;      // grid economy: the liquidity-stress variant runs at base lag/hold only
  const spec={sig,lag,hold_m:hold,buckets:k,universe:uni};
  const key=`xsec_eq|${sig}|l${lag}|h${hold}|k${k}|${uni}`;
  // build the (mo, fwd, v) rows for this spec — lag shifts the signal month; hold compounds fwd months
  const byMoSym=new Map<string,EqRow>();
  for(const r of eqPanel)byMoSym.set(`${r.mo}|${r.sym}`,r);
  const rows:{mo:string;fwd:number;v:number}[]=[];
  for(const r of eqPanel){
    let v=r.sig[sig]; if(v==null)continue;
    if(lag>0){const d=new Date(r.mo+"-15T00:00:00Z");d.setUTCMonth(d.getUTCMonth()-lag);
      const p=byMoSym.get(`${d.toISOString().slice(0,7)}|${r.sym}`); v=p?.sig[sig]??null; if(v==null)continue;}
    if(uni==="liqtop"){/* handled per-month below via dv rank */}
    let fwd=r.fwd;
    if(hold>1){let f=1+r.fwd,ok=true;
      for(let h=1;h<hold;h++){const d=new Date(r.mo+"-15T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+h);
        const nx=byMoSym.get(`${d.toISOString().slice(0,7)}|${r.sym}`); if(!nx){ok=false;break;} f*=1+nx.fwd;}
      if(!ok)continue; fwd=f-1;}
    rows.push({mo:r.mo,fwd,v:v as number});
  }
  let use=rows;
  if(uni==="liqtop"){
    // liq-top-third: per month, keep only the most liquid third BEFORE ranking (the D-450 discipline)
    use=[]; const tmp=new Map<string,{fwd:number;v:number;dv:number}[]>();
    for(const r of eqPanel){const v=r.sig[sig]; if(v==null)continue;
      (tmp.get(r.mo)??tmp.set(r.mo,[]).get(r.mo)!).push({fwd:r.fwd,v:v as number,dv:r.dv});}
    for(const [mo,g] of tmp){g.sort((a,b)=>b.dv-a.dv);
      for(const x of g.slice(0,Math.max(30,Math.floor(g.length/3))))use.push({mo,fwd:x.fwd,v:x.v});}
  }
  const g=evalXsec(use,FEE_EQ,k,12/hold,hold);
  await record(key,"xsec_eq",spec,uni==="liqtop"?"equity_liqtop":"equity_liquid",g,ceil);
  done++;
  if(done%50===0)await log(`  ..${done} specs (${((Date.now()-t0)/60000).toFixed(1)}m)`);
}
if(trialRows.length){await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},body:JSON.stringify(trialRows)}).catch(()=>null);trialRows=[];}
const {N:N2,ceil:c2}=await ceiling();
await log(`\n==> XSEC_EQ pass done: ${done} specs, ${written} ledger rows. Ceiling ${ceil.toFixed(3)} -> ${c2.toFixed(3)} (N=${N2.toLocaleString()})`);
const surv=await fetch(`${OWNED}/trd_factory?survivor=eq.true&select=spec_key,portfolio_t,net_ann,n_names&order=portfolio_t.desc&limit=10`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
await log(`    SURVIVORS so far: ${Array.isArray(surv)?surv.length:0}`);
for(const s of (Array.isArray(surv)?surv:[])) await log(`      ${s.spec_key}  t=${s.portfolio_t}  net ${(+s.net_ann*100).toFixed(1)}%/yr  breadth ${s.n_names}`);
