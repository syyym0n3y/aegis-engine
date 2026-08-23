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
    const r=await fetch(`${OWNED}/trd_trial_counter?on_conflict=run_key`,{method:"POST",headers:{...hdr,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(trialRows)}).catch(()=>null);
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
const PASS0=(Deno.env.get("PASS")||"all");
// panels are only built for the passes that read them — a PASS=french run was rebuilding the 291k-row equity panel
// (~4 min) just to ignore it.
// intl (PASS 12) reads only trd_ff_factors — no panel needed
if(PASS0==="all"||PASS0==="eq"||PASS0==="pairs"||PASS0==="insider"||PASS0==="shortside"||PASS0==="pead"||PASS0==="nport"||PASS0==="form345"||PASS0==="own13f"||PASS0==="annprem"||PASS0==="darkpool"||PASS0==="nonreliance"){ await loadFund(); await loadFTD(); await buildEqPanel(); }
const {N,ceil}=await ceiling();
await log(`  deflation ceiling at start: ${ceil.toFixed(3)} (N=${N.toLocaleString()})`);
const PASS=PASS0;
const SIGNALS=Object.keys(eqPanel[0]?.sig??{});
await log(`  equity signals: ${SIGNALS.length} → grid = signals x lag{0,1} x hold{1,3} x buckets{5,10} x universe{all,liquid-top-third}`);
let done=0;
if(PASS==="all"||PASS==="eq")
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

// ================= PASS 2 — PERP CROSS-SECTIONS (498-contract survivorship-free universe) =================
if(PASS==="all"||PASS==="perp"){
  const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
  type PRow={mo:string;fwd:number;sig:Record<string,number|null>};
  const pp:PRow[]=[];
  for(let i=0;i<meta.length;i+=25){
    const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
    const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
    if(!Array.isArray(rows))continue;
    for(const r of rows){
      const b=r.bars; if(!b||b.length<120)continue;
      for(let k=61;k<b.length-1;k++){
        const c=b[k][4]; if(!(c>0)||!(b[k+1][4]>0))continue;
        const dv=b.slice(Math.max(0,k-30),k).map(x=>x[6]).filter(Number.isFinite);
        if(!dv.length||mean(dv)<1e6)continue;
        const fwd=b[k+1][4]/c-1; if(!Number.isFinite(fwd)||Math.abs(fwd)>2)continue;
        const px=(n:number)=>b[k-n]?.[4]>0?c/b[k-n][4]-1:null;
        const rets:number[]=[]; for(let q=k-30;q<k;q++)if(b[q][4]>0&&b[q-1]?.[4]>0)rets.push(b[q][4]/b[q-1][4]-1);
        const fw=b.slice(k-7,k); let tb=0,tv=0; for(const x of fw){tb+=x[7]||0;tv+=x[5]||0;}
        const v7=mean(b.slice(k-7,k).map(x=>x[5]||0)), v30=mean(b.slice(k-30,k).map(x=>x[5]||0));
        pp.push({mo:new Date(b[k][0]*1000).toISOString().slice(0,10),fwd,sig:{
          mom7:px(7),mom14:px(14),mom30:px(30),mom60:px(60),
          rev1:px(1)!=null?-(px(1) as number):null,rev3:px(3)!=null?-(px(3) as number):null,
          vol30:rets.length>20?-sdv(rets):null,                              // pre-registered: LOW vol good
          hi60:c/Math.max(...b.slice(Math.max(0,k-60),k+1).map(x=>x[2])),
          relvol7:(v7>0&&v30>0)?Math.log(v7/v30):null,
          flow7:tv>0?-((2*tb-tv)/tv):null,                                   // D-426 sign: fade the aggressor
        }});
      }
    }
  }
  await log(`  perp panel: ${pp.length.toLocaleString()} rows`);
  const PSIG=Object.keys(pp[0]?.sig??{});
  for(const sig of PSIG) for(const hold of [1,3,7]) for(const k of [5,10]){
    const key=`xsec_perp|${sig}|h${hold}|k${k}`;
    const rows=pp.filter(r=>r.sig[sig]!=null).map(r=>({mo:r.mo,fwd:r.fwd,v:r.sig[sig] as number}));
    const g=evalXsec(rows,FEE_PERP,k,365/hold,hold);
    await record(key,"xsec_perp",{sig,hold_d:hold,buckets:k},"perps_sf",g,ceil); done++;
  }
  await log(`  PASS 2 (perp) done: ${PSIG.length*6} specs`);
}
// ================= PASS 3 — TIMING vs BUY-AND-HOLD (single instruments; breadth-exempt by class) =================
if(PASS==="all"||PASS==="timing"){
  const INST=["SPY","QQQ","IWM","TLT","GLD","EFA","EEM","XLE"];
  const PERPI=["BTCUSDT","ETHUSDT","SOLUSDT"];
  const series=new Map<string,number[]>();
  for(const s2 of INST){
    const r=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${s2}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
    if(r[0]?.bars) series.set(s2,r[0].bars.map(b=>b[4]).filter(x=>x>0));
  }
  for(const s2 of PERPI){
    const r=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=eq.${s2}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
    if(r[0]?.bars) series.set(s2,r[0].bars.map(b=>b[4]).filter(x=>x>0));
  }
  type Rule={name:string;pos:(c:number[],i:number,h:number[])=>number};
  const sma2=(c:number[],i:number,n:number)=>{if(i<n)return NaN;let s3=0;for(let q=i-n+1;q<=i;q++)s3+=c[q];return s3/n;};
  const rules:Rule[]=[];
  for(const f of [20,50]) for(const sl of [100,200,400]) rules.push({name:`macross_${f}_${sl}`,pos:(c,i)=>sma2(c,i,f)>sma2(c,i,sl)?1:0});
  for(const n of [20,55,100]) rules.push({name:`breakout_${n}`,pos:(c,i)=>i>n&&c[i]>=Math.max(...c.slice(i-n,i))?1:0});
  rules.push({name:"rsi2_mr",pos:(c,i)=>{if(i<3)return 0;const up=Math.max(c[i]-c[i-1],0)+Math.max(c[i-1]-c[i-2],0);const dn=Math.max(c[i-1]-c[i],0)+Math.max(c[i-2]-c[i-1],0);const rs=100-100/(1+(up||1e-9)/(dn||1e-9));return rs<10?1:0;}});
  for(const tr of [-0.05,-0.08,-0.12]) for(const cd of [5,10,20]) rules.push({name:`cooldown_${Math.abs(tr*100)}_${cd}`,pos:(c,i,h)=>{for(let q=Math.max(0,h.length-cd);q<h.length;q++)if(h[q]<tr)return 0;return 1;}});
  for(const [inst,c] of series) for(const rule of rules){
    const key=`timing|${inst}|${rule.name}`;
    // D-498 SAME-BAR EXECUTION FIX: a close-derived signal may not act on that same close. Signals are precomputed
    // (sig[i] uses closes through i and returns through i-1->i), then the position for return i->i+1 is sig[i-1].
    const sig:number[]=[]; {const histR:number[]=[];
      for(let i=0;i<c.length-1;i++){ sig[i]=i>=401?rule.pos(c,i,histR):0; histR.push(c[i+1]/c[i]-1); }}
    const bh:number[]=[]; let sw=0,prev2=0; const net:number[]=[];
    for(let i=402;i<c.length-1;i++){
      const w=sig[i-1]; const r=c[i+1]/c[i]-1;
      net.push(w*r-(w!==prev2?10/1e4:0)); bh.push(r); if(w!==prev2){sw++;prev2=w;}
    }
    if(net.length<500){await record(key,"timing",{inst,rule:rule.name},"single",null,ceil);done++;continue;}
    const ex=net.map((x,i)=>x-bh[i]);
    const m=mean(ex),sd=sdv(ex)||1e-9,t=m/(sd/Math.sqrt(ex.length));
    let cum=1,pk=1,dd=0,ruined=false; for(const x of net){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*ex.length/4),b2=Math.floor((e+1)*ex.length/4);return mean(ex.slice(a,b2));});
    const gate:Gate={n_names:1,n_periods:ex.length,gross_ann:mean(net.map((x,i)=>x+ (0)))*252, net_ann:mean(net)*252,
      sharpe:(mean(net)/(sdv(net)||1e-9))*Math.sqrt(252),t,dd:dd*100,ruined,
      g_breadth:true /* single-instrument class: breadth law N/A, judged vs BH instead */,
      g_effect:Math.abs(m)*252>=(sw/ (ex.length/252))*10/1e4,
      g_benchmark:m>0 /* must BEAT buy-and-hold (D-439) */,
      g_liquid:true,g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3,eras:q4};
    await record(key,"timing",{inst,rule:rule.name,switches:sw,exec:"lag1"},"single",gate,ceil); done++;
  }
  await log(`  PASS 3 (timing) done: ${series.size*rules.length} specs`);
}
// ================= PASS 4 — PAIRWISE INTERACTIONS on the equity panel (rank-sum of two signals) =================
if(PASS==="all"||PASS==="pairs"){
  // precompute per-month percentile ranks per signal (once)
  const rankPanel=new Map<string,Map<string,number>>();   // sig -> "mo|idx" -> pct
  const byMo=new Map<string,number[]>();                  // mo -> indices into eqPanel
  eqPanel.forEach((r,i)=>{(byMo.get(r.mo)??byMo.set(r.mo,[]).get(r.mo)!).push(i);});
  for(const sig of SIGNALS){
    const m=new Map<string,number>();
    for(const [mo,idxs] of byMo){
      const have=idxs.filter(i=>eqPanel[i].sig[sig]!=null);
      if(have.length<30)continue;
      have.sort((a,b)=>(eqPanel[a].sig[sig] as number)-(eqPanel[b].sig[sig] as number));
      have.forEach((i,rk)=>m.set(`${mo}|${i}`,rk/(have.length-1)));
    }
    rankPanel.set(sig,m);
  }
  let pd=0;
  for(let a=0;a<SIGNALS.length;a++) for(let b2=a+1;b2<SIGNALS.length;b2++){
    const A=SIGNALS[a],B=SIGNALS[b2];
    const key=`pair|${A}+${B}|h1|k10`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    const ra=rankPanel.get(A)!, rb=rankPanel.get(B)!;
    for(const [mo,idxs] of byMo) for(const i of idxs){
      const x=ra.get(`${mo}|${i}`), y=rb.get(`${mo}|${i}`);
      if(x==null||y==null)continue;
      rows.push({mo,fwd:eqPanel[i].fwd,v:x+y});
    }
    const g=evalXsec(rows,FEE_EQ,10,12,1);
    await record(key,"pair",{a:A,b:B},"equity_liquid",g,ceil); done++; pd++;
    if(pd%40===0)await log(`  ..pairs ${pd}`);
  }
  await log(`  PASS 4 (pairs) done: ${pd} specs`);
}


// ================= PASS 6 — INSIDER BUYING (D-476: 272,958 open-market Form-4 BUYS, held since D-373, never swept) =================
// HONEST SCOPE: the backfill stored BUYS ONLY (sells filtered at source — recorded as an open item in DATA_FRONTIER).
// So this family is buy-intensity, the side with the documented positive direction. Value is normalized by the name's own
// average dollar volume (both held per panel row) — an intensity measure that needs no market-cap join.
if(PASS==="all"||PASS==="insider"){
  const ins=new Map<string,{d:string;v:number;off:boolean}[]>();
  let nIns=0;
  for(let off=0;;off+=10000){
    const p2=await fetch(`${OWNED}/trd_insider?ticker=neq.--&value_usd=gt.0&select=ticker,disclosed_date,value_usd,is_officer&order=disclosed_date&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {ticker:string;disclosed_date:string;value_usd:number;is_officer:boolean}[]){
      (ins.get(r.ticker)??ins.set(r.ticker,[]).get(r.ticker)!).push({d:r.disclosed_date,v:+r.value_usd,off:!!r.is_officer});nIns++;}
    if(p2.length<10000)break;
  }
  await log(`  insider: ${nIns.toLocaleString()} buy events, ${ins.size} tickers`);
  const trail=(t:string,endD:string,days:number,offOnly:boolean)=>{
    const a=ins.get(t); if(!a)return {v:0,n:0};
    const startD=(()=>{const x=new Date(endD+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-days);return x.toISOString().slice(0,10);})();
    let v=0,n=0;
    // events are date-sorted; linear scan bounded by binary-searching the start
    let lo=0,hi=a.length-1,st=a.length;
    while(lo<=hi){const m=(lo+hi)>>1;if(a[m].d>=startD){st=m;hi=m-1;}else lo=m+1;}
    for(let i2=st;i2<a.length&&a[i2].d<=endD;i2++){if(offOnly&&!a[i2].off)continue;v+=a[i2].v;n++;}
    return {v,n};
  };
  // month-end date per panel row = last day of its mo (approximation: signals use disclosed_date <= month end — point-in-time)
  const moEnd=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const SIGS6=["ins1m","ins3m","ins6m","ins_cnt3m","ins_off3m"] as const;
  for(const sig of SIGS6) for(const hold of [1,3]) for(const k of [5,10]){
    const key=`insider|${sig}|h${hold}|k${k}`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(const r of eqPanel){
      const end=moEnd(r.mo);
      let v:number;
      if(sig==="ins1m")v=trail(r.sym,end,30,false).v/(r.dv||1);
      else if(sig==="ins3m")v=trail(r.sym,end,91,false).v/(r.dv||1);
      else if(sig==="ins6m")v=trail(r.sym,end,182,false).v/(r.dv||1);
      else if(sig==="ins_cnt3m")v=trail(r.sym,end,91,false).n;
      else v=trail(r.sym,end,91,true).v/(r.dv||1);
      if(!(v>0))continue;                                     // signal defined only where buying occurred
      rows.push({mo:r.mo,fwd:r.fwd,v});
    }
    const g=evalXsec(rows,FEE_EQ,k,12/hold,hold);
    await record(key,"insider",{sig,hold,k},"equity_liquid",g,ceil); done++;
  }
  await log(`  PASS 6 (insider) done: ${SIGS6.length*4} specs`);
}

// ================= PASS 7 — THE SHORT SIDE, ON REAL INPUTS (D-475: re-earning D-391's verdict) =================
// D-391 ruled short interest "underpowered, 26 settlements" without fetching the free inputs. These are the real ones:
// FINRA daily short-sale volume (short_vol/total_vol per symbol per day, 2018-09->) and semi-monthly consolidated short
// interest (level + days-to-cover). Pre-registered directions from the literature: HIGH short-interest / days-to-cover
// -> NEGATIVE forward returns (shorts are informed); daily short-volume RATIO spikes -> contested, tested both as level
// and as change with the sign left to the gates (a sign-free spec costs a trial like any other, and era-consistency
// plus benchmark decide it — the deflation gate keeps this honest).
if(PASS==="all"||PASS==="shortside"){
  const sv=new Map<string,{d:string;r:number}[]>();          // short-volume ratio series per symbol
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_short_volume?select=symbol,d,short_vol,total_vol&order=d&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {symbol:string;d:string;short_vol:number;total_vol:number}[]){
      if(!(r.total_vol>0))continue;
      (sv.get(r.symbol)??sv.set(r.symbol,[]).get(r.symbol)!).push({d:r.d,r:r.short_vol/r.total_vol});}
    if(p2.length<50000)break;
  }
  const si=new Map<string,{d:string;qty:number;dtc:number|null}[]>();
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_short_interest?select=symbol,settlement,short_qty,days_cover&order=settlement&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {symbol:string;settlement:string;short_qty:number;days_cover:number|null}[])
      (si.get(r.symbol)??si.set(r.symbol,[]).get(r.symbol)!).push({d:r.settlement,qty:+r.short_qty,dtc:r.days_cover!=null?+r.days_cover:null});
    if(p2.length<50000)break;
  }
  await log(`  short-side: ${sv.size} symbols daily ratio, ${si.size} symbols short interest`);
  const moEnd=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const lastBefore=<T extends {d:string}>(a:T[]|undefined,end:string):T|null=>{
    if(!a?.length)return null; let lo=0,hi=a.length-1,b=-1;
    while(lo<=hi){const m=(lo+hi)>>1;if(a[m].d<=end){b=m;lo=m+1;}else hi=m-1;} return b<0?null:a[b];};
  const SIGS7=["svr_1m","svr_chg","si_dtc","si_chg"] as const;
  for(const sig of SIGS7) for(const dir of [1,-1]) for(const hold of [1,3]) for(const k of [5,10]){
    if((sig==="si_dtc"||sig==="si_chg")&&dir===1)continue;    // pre-registered NEGATIVE direction only for SI levels/changes
    const key=`shortside|${sig}|${dir>0?"pos":"neg"}|h${hold}|k${k}`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(const r of eqPanel){
      const end=moEnd(r.mo); if(end<"2018-10-31")continue;    // coverage begins with the data
      let v:number|null=null;
      if(sig==="svr_1m"||sig==="svr_chg"){
        const a=sv.get(r.sym); if(!a)continue;
        // trailing 21-obs mean ending at month end
        let lo=0,hi=a.length-1,b=-1;
        while(lo<=hi){const m=(lo+hi)>>1;if(a[m].d<=end){b=m;lo=m+1;}else hi=m-1;}
        if(b<20)continue;
        const cur=a.slice(b-20,b+1).reduce((s2,x)=>s2+x.r,0)/21;
        if(sig==="svr_1m")v=cur;
        else{ if(b<62)continue; const prev=a.slice(b-62,b-41).reduce((s2,x)=>s2+x.r,0)/21; v=cur-prev; }
      }else{
        const a=si.get(r.sym); const c=lastBefore(a,end); if(!c)continue;
        if(sig==="si_dtc"){ if(c.dtc==null)continue; v=c.dtc; }
        else{ const prev=lastBefore(a,(()=>{const x=new Date(end+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-35);return x.toISOString().slice(0,10);})());
          if(!prev||!(prev.qty>0))continue; v=c.qty/prev.qty-1; }
      }
      if(v==null||!Number.isFinite(v))continue;
      rows.push({mo:r.mo,fwd:r.fwd,v:dir*v});
    }
    const g=evalXsec(rows,FEE_EQ,k,12/hold,hold);
    await record(key,"shortside",{sig,dir,hold,k},"equity_liquid",g,ceil); done++;
  }
  await log(`  PASS 7 (shortside) done`);
}

// ================= PASS 8 — PEAD ON REAL SURPRISES (D-479: the input D-393 never had) =================
// D-393's PEAD null used no actual surprise data. trd_earnings now carries per-event actual EPS, consensus, and
// % surprise (Nasdaq, 2017->). Signal for month M: the % surprise of the most recent report inside the trailing 45 days,
// pre-registered direction POSITIVE (post-earnings-announcement DRIFT). Variant gated to n_ests>=3 (a surprise against
// one estimate is noise). Sign-flipped variants are NOT run — this is a documented one-direction hypothesis.
if(PASS==="all"||PASS==="pead"){
  const ev=new Map<string,{d:string;s:number;ne:number}[]>();
  let nE=0;
  for(let off=0;;off+=10000){
    const p2=await fetch(`${OWNED}/trd_earnings?surprise_pct=not.is.null&select=symbol,report_date,surprise_pct,n_ests&order=report_date&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {symbol:string;report_date:string;surprise_pct:number;n_ests:number|null}[]){
      (ev.get(r.symbol)??ev.set(r.symbol,[]).get(r.symbol)!).push({d:r.report_date,s:+r.surprise_pct,ne:r.n_ests??0});nE++;}
    if(p2.length<10000)break;
  }
  await log(`  pead: ${nE.toLocaleString()} surprise events, ${ev.size} symbols`);
  const moEnd=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  for(const minEst of [0,3]) for(const hold of [1,3]) for(const k of [5,10]){
    const key=`pead|sue45|est${minEst}|h${hold}|k${k}`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(const r of eqPanel){
      if(r.mo<"2017-03")continue;
      const end=moEnd(r.mo), a=ev.get(r.sym); if(!a)continue;
      const startD=(()=>{const x=new Date(end+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-45);return x.toISOString().slice(0,10);})();
      let lo=0,hi=a.length-1,b=-1;
      while(lo<=hi){const m=(lo+hi)>>1;if(a[m].d<=end){b=m;lo=m+1;}else hi=m-1;}
      if(b<0||a[b].d<startD)continue;
      if(minEst>0&&a[b].ne<minEst)continue;
      const sp=a[b].s; if(!Number.isFinite(sp)||Math.abs(sp)>500)continue;
      rows.push({mo:r.mo,fwd:r.fwd,v:sp});
    }
    const g=evalXsec(rows,FEE_EQ,k,12/hold,hold);
    await record(key,"pead",{minEst,hold,k},"equity_liquid",g,ceil); done++;
  }
  await log(`  PASS 8 (pead) done`);
}

// ================= PASS 9 — FACTOR MOMENTUM (D-485: momentum ACROSS the factor library; Ehsani-Linnainmaa) =================
// A documented, distinct family never tested here: rank the FACTORS by their own trailing 12-1 return, hold the winners
// short the losers. Factor set constructed from held century panels: the five decile spreads (mom, st-rev, lt-rev, op,
// inv — literature sides) + SMB/HML-like spreads from the 10x10 grid + four 5x5 corner spreads. ~11 factor series,
// ~1,100 independent months. 5bp/month drag as elsewhere in the century family; breadth-exempt by class (portfolios).
if(PASS==="all"||PASS==="factmom"){
  const ff3=await (async()=>{const out:{month:string;factor:string;ret:number}[]=[];
    for(let off=0;;off+=10000){
      const p2=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.mom10:*,factor.like.strev10:*,factor.like.ltrev10:*,factor.like.op10:*,factor.like.inv10:*,factor.like.szbm100:*)&select=month,factor,ret&order=month&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(p2)||!p2.length)break; out.push(...p2); if(p2.length<10000)break;}
    return out;})();
  const byS2=new Map<string,Map<string,number>>();
  for(const r of ff3)(byS2.get(r.factor)??byS2.set(r.factor,new Map()).get(r.factor)!).set(r.month,+r.ret);
  const get=(name:string)=>byS2.get(name);
  const one=(pref:string,side:string)=>{const c=[...byS2.keys()].filter(k=>k.startsWith(pref+":")&&k.split(":")[1].startsWith(side)&&(/_10$/.test(k)||!/_20$/.test(k)));return c.length?byS2.get(c.sort()[0])!:null;};
  const spread=(a:Map<string,number>|null,b:Map<string,number>|null)=>{if(!a||!b)return null;
    const m=new Map<string,number>(); for(const [mo,v] of a){const w=b.get(mo); if(w!=null)m.set(mo,v-w);} return m;};
  // grid helpers: szbm100 names like ME1_BM1 .. ME10_BM10 (small->big, low->high BM)
  const grid=(me:number[],bm:number[])=>{const out=new Map<string,number>();const keys=[...byS2.keys()].filter(k=>k.startsWith("szbm100:"));
    const sel=keys.filter(k=>{const m=/ME(\d+)_?BM?(\d+)|SMALL|BIG|LoBM|HiBM/i.exec(k.split(":")[1]);return false;}); void sel;
    // name format from French: e.g. "SMALL_LoBM","ME1_BM2",... robust approach: parse ME i and BM j numerically where possible
    const parsed=keys.map(k=>{const n=k.split(":")[1];
      let i=0,j=0;
      const m1=/^ME(\d+)_BM(\d+)$/.exec(n); if(m1){i=+m1[1];j=+m1[2];}
      else if(/^SMALL_LoBM$/i.test(n)){i=1;j=1;} else if(/^SMALL_HiBM$/i.test(n)){i=1;j=10;}
      else if(/^BIG_LoBM$/i.test(n)){i=10;j=1;} else if(/^BIG_HiBM$/i.test(n)){i=10;j=10;}
      return {k,i,j};}).filter(x=>x.i>0);
    const pick2=parsed.filter(x=>me.includes(x.i)&&bm.includes(x.j)).map(x=>byS2.get(x.k)!);
    if(!pick2.length)return null;
    const months3=[...pick2[0].keys()];
    for(const mo of months3){let s2=0,n2=0;for(const m2 of pick2){const v=m2.get(mo);if(v!=null){s2+=v;n2++;}}
      if(n2===pick2.length)out.set(mo,s2/n2);}
    return out;};
  const FACTORS:[string,Map<string,number>|null][]=[
    ["MOM",spread(one("mom10","Hi"),one("mom10","Lo"))],
    ["STREV",spread(one("strev10","Lo"),one("strev10","Hi"))],
    ["LTREV",spread(one("ltrev10","Lo"),one("ltrev10","Hi"))],
    ["OP",spread(one("op10","Hi"),one("op10","Lo"))],
    ["INV",spread(one("inv10","Lo"),one("inv10","Hi"))],
    ["SMB",spread(grid([1,2,3],[1,2,3,4,5,6,7,8,9,10]),grid([8,9,10],[1,2,3,4,5,6,7,8,9,10]))],
    ["HML",spread(grid([1,2,3,4,5,6,7,8,9,10],[8,9,10]),grid([1,2,3,4,5,6,7,8,9,10],[1,2,3]))],
    ["SV_CORNER",spread(grid([1,2],[9,10]),grid([1,2],[1,2]))],
    ["BG_CORNER",spread(grid([9,10],[9,10]),grid([9,10],[1,2]))],
  ];
  const live=FACTORS.filter(([,m])=>m&&m.size>600) as [string,Map<string,number>][];
  await log(`  factmom: ${live.length} factor series constructed (${live.map(([n])=>n).join(",")})`);
  const allMo=[...new Set(live.flatMap(([,m])=>[...m.keys()]))].sort();
  for(const K of [2,3]) for(const form of [12,6]){
    const key=`factmom|f${live.length}|form${form}|top${K}|h1`;
    const rets:number[]=[];
    for(let i=form+1;i<allMo.length;i++){
      const scored:{n:string;mom:number;nxt:number}[]=[];
      for(const [n,m] of live){
        let acc=1,ok=true;
        for(let q=i-form;q<i;q++){const v=m.get(allMo[q]); if(v==null){ok=false;break;} acc*=1+v;}
        const nxt=m.get(allMo[i]); if(!ok||nxt==null)continue;
        scored.push({n,mom:acc,nxt});
      }
      if(scored.length<6)continue;
      scored.sort((a,b)=>b.mom-a.mom);
      const top=scored.slice(0,K), bot=scored.slice(-K);
      rets.push(mean(top.map(x=>x.nxt))-mean(bot.map(x=>x.nxt))-0.0005);
    }
    if(rets.length<300){await record(key,"factmom",{K,form},"factor_library",null,ceil);done++;continue;}
    const m=mean(rets),sd=sdv(rets)||1e-9,t=m/(sd/Math.sqrt(rets.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of rets){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*rets.length/4),b2=Math.floor((e+1)*rets.length/4);return mean(rets.slice(a,b2));});
    const g:Gate={n_names:live.length,n_periods:rets.length,gross_ann:(m+0.0005)*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:true,g_effect:Math.abs(m)>=0.0005,g_benchmark:m>0,g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3,eras:q4};
    await record(key,"factmom",{K,form,factors:live.map(([n])=>n)},"factor_library",g,ceil);done++;
    await log(`    factmom form${form} top${K}: n=${rets.length} net ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)} eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 9 (factmom) done`);
}

// ================= PASS 10 — N-PORT FUND OWNERSHIP (D-488: monthly 13F-complement; breadth/flow/crowding) =================
// trd_nport_ownership: per-(cusip,report_date) aggregates of every registered fund's holdings, effective_date =
// report_date + 60d (public-dissemination rule). Bridged to symbols via trd_cusip_map (FTD-derived). Signals are
// point-in-time: at each panel month-end only reports with effective_date <= that date are visible.
if(PASS==="all"||PASS==="nport"){
  const cus2sym=new Map<string,string>();
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_cusip_map?select=cusip,symbol&order=cusip&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.ok?r.json():Promise.reject(r.status)).catch(e=>{console.log(`WRITE-FAILED cusip_map read ${e}`);return[];});
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {cusip:string;symbol:string}[]) cus2sym.set(r.cusip,r.symbol);
    if(p2.length<50000)break;
  }
  const own=new Map<string,{eff:string;np:number;sh:number;val:number}[]>();
  let nOwn=0;
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_nport_ownership?select=cusip,effective_date,n_positions,shares,value_usd&order=cusip,effective_date&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.ok?r.json():Promise.reject(r.status)).catch(e=>{console.log(`WRITE-FAILED nport read ${e}`);return[];});
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {cusip:string;effective_date:string;n_positions:number;shares:number;value_usd:number}[]){
      const sym=cus2sym.get(r.cusip); if(!sym)continue;
      (own.get(sym)??own.set(sym,[]).get(sym)!).push({eff:r.effective_date,np:+r.n_positions,sh:+r.shares,val:+r.value_usd});nOwn++;}
    if(p2.length<50000)break;
  }
  for(const a of own.values()) a.sort((x,y)=>x.eff<y.eff?-1:1);
  await log(`  nport: ${nOwn.toLocaleString()} symbol-months mapped, ${own.size} symbols`);
  const at=(sym:string,endD:string)=>{ // latest report visible at endD
    const a=own.get(sym); if(!a)return null;
    let lo=0,hi=a.length-1,best=-1;
    while(lo<=hi){const m=(lo+hi)>>1;if(a[m].eff<=endD){best=m;lo=m+1;}else hi=m-1;}
    return best<0?null:a[best];
  };
  const minus=(d:string,days:number)=>{const x=new Date(d+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-days);return x.toISOString().slice(0,10);};
  const moEnd10=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const SIGS10=["own_brd_chg3","own_brd_chg1","own_flow3","own_crowd","own_val_chg3"] as const;
  for(const sig of SIGS10) for(const hold of [1,3]) for(const k of [5,10]){
    const key=`nport|${sig}|h${hold}|k${k}`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(const r of eqPanel){
      const end=moEnd10(r.mo), cur=at(r.sym,end);
      if(!cur||cur.eff<minus(end,190))continue;              // stale ownership (>~6mo old) is no signal
      let v:number|null=null;
      if(sig==="own_crowd"){ v=(r.dv&&r.dv>0)?cur.val/(r.dv*21):null; } // fund $ held per month of dollar-volume
      else{
        const lag=(sig==="own_brd_chg1")?35:100;
        const prev=at(r.sym,minus(end,lag));
        if(!prev||prev.eff===cur.eff)continue;
        if(sig==="own_brd_chg3"||sig==="own_brd_chg1") v=prev.np>=5?(cur.np-prev.np)/prev.np:null;
        else if(sig==="own_flow3") v=prev.sh>0?(cur.sh-prev.sh)/prev.sh:null;
        else v=prev.val>0?(cur.val-prev.val)/prev.val:null;
      }
      if(v===null||!isFinite(v))continue;
      rows.push({mo:r.mo,fwd:r.fwd,v});
    }
    const g=evalXsec(rows,FEE_EQ,k,12/hold,hold);
    await record(key,"nport",{sig,hold,k},"equity_all",g,ceil); done++;
  }
  await log(`  PASS 10 (nport) done: ${SIGS10.length*4} specs`);
}

// ================= PASS 11 — FORM 345 FULL LEDGER (D-490: the SELLS side, 2006->2026, open-list item closed) =================
// trd_form345: per-(symbol, filing-date) open-market buy/sell aggregates from the DERA structured sets — replaces the
// buys-only crawl. effective = filing date (public on EDGAR same day). Literature prior: buys informative, sells mostly
// diversification noise; direction left to the gates.
if(PASS==="all"||PASS==="form345"){
  const f345=new Map<string,{d:string;b:number;s:number;nb:number;ns:number}[]>();
  let nF=0;
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_form345?select=symbol,filed,buy_usd,sell_usd,n_buy,n_sell&order=symbol,filed&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.ok?r.json():Promise.reject(r.status)).catch(e=>{console.log(`WRITE-FAILED form345 read ${e}`);return[];});
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {symbol:string;filed:string;buy_usd:number;sell_usd:number;n_buy:number;n_sell:number}[])
      {(f345.get(r.symbol)??f345.set(r.symbol,[]).get(r.symbol)!).push({d:r.filed,b:+r.buy_usd,s:+r.sell_usd,nb:+r.n_buy,ns:+r.n_sell});nF++;}
    if(p2.length<50000)break;
  }
  await log(`  form345: ${nF.toLocaleString()} symbol-days, ${f345.size} symbols`);
  const trail345=(sym:string,endD:string,days:number)=>{
    const a=f345.get(sym); if(!a)return null;
    const startD=(()=>{const x=new Date(endD+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-days);return x.toISOString().slice(0,10);})();
    let lo=0,hi=a.length-1,st=a.length;
    while(lo<=hi){const m=(lo+hi)>>1;if(a[m].d>=startD){st=m;hi=m-1;}else lo=m+1;}
    let b=0,s=0,nb=0,ns=0;
    for(let i2=st;i2<a.length&&a[i2].d<=endD;i2++){b+=a[i2].b;s+=a[i2].s;nb+=a[i2].nb;ns+=a[i2].ns;}
    return {b,s,nb,ns};
  };
  const moEnd11=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const SIGS11=["f345_sell3m","f345_net3m","f345_ratio3m","f345_buy3m","f345_sell6m"] as const;
  for(const sig of SIGS11) for(const hold of [1,3]) for(const k of [5,10]){
    const key=`form345|${sig}|h${hold}|k${k}`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(const r of eqPanel){
      const t=trail345(r.sym,moEnd11(r.mo),sig==="f345_sell6m"?182:91);
      if(!t)continue;
      let v:number|null=null;
      if(sig==="f345_sell3m"||sig==="f345_sell6m"){ v=t.s>0&&r.dv?t.s/r.dv:null; }
      else if(sig==="f345_buy3m"){ v=t.b>0&&r.dv?t.b/r.dv:null; }
      else if(sig==="f345_net3m"){ v=(t.b>0||t.s>0)&&r.dv?(t.b-t.s)/r.dv:null; }
      else { v=(t.b+t.s)>0?t.b/(t.b+t.s):null; }               // buy share of insider activity
      if(v===null||!isFinite(v))continue;
      rows.push({mo:r.mo,fwd:r.fwd,v});
    }
    const g=evalXsec(rows,FEE_EQ,k,12/hold,hold);
    await record(key,"form345",{sig,hold,k},"equity_all",g,ceil); done++;
  }
  await log(`  PASS 11 (form345) done: ${SIGS11.length*4} specs`);
}

// ================= PASS 12 — INTERNATIONAL FACTOR PREMIA (D-491: momentum/value OUT OF SAMPLE BY GEOGRAPHY) =================
// The top of the grand board is US momentum (t 4.84 century deciles, 4.03 ind49, 3.58 factor-mom). The cheapest honest
// falsification left is GEOGRAPHY: French's international library, 1990->2026 (~430 independent months), regions built
// from ~20 developed + EM markets. Same long-short construction as PASS 5b; drag 10bp/month (intl implementation is
// costlier, stated); breadth-exempt by class (each leg a diversified regional portfolio).
if(PASS==="all"||PASS==="intl"){
  const ffI=await (async()=>{const out:{month:string;factor:string;ret:number}[]=[];
    for(let off=0;;off+=10000){
      const p2=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.dxmom6:*,factor.like.eumom6:*,factor.like.jpmom6:*,factor.like.apmom6:*,factor.like.dxval6:*,factor.like.dxwml:*,factor.like.emmom:*,factor.like.dxff3:*,factor.like.emff5:*,factor.like.dxff5:*)&select=month,factor,ret&order=month&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(p2)||!p2.length)break; out.push(...p2); if(p2.length<10000)break;}
    return out;})();
  const byI=new Map<string,Map<string,number>>();
  for(const r of ffI)(byI.get(r.factor)??byI.set(r.factor,new Map()).get(r.factor)!).set(r.month,+r.ret);
  await log(`  intl: ${ffI.length.toLocaleString()} obs, ${byI.size} series`);
  const DRAG12=0.0010;
  // [key-suffix, label, long legs, short legs] — legs averaged, long minus short; single-factor rows have no short leg
  const SPECS12:[string,string,string[],string[]][]=[
    ["dxmom","developed ex-US momentum 12-2",["dxmom6:SMALL_HiPRIOR","dxmom6:BIG_HiPRIOR"],["dxmom6:SMALL_LoPRIOR","dxmom6:BIG_LoPRIOR"]],
    ["eumom","Europe momentum 12-2",["eumom6:SMALL_HiPRIOR","eumom6:BIG_HiPRIOR"],["eumom6:SMALL_LoPRIOR","eumom6:BIG_LoPRIOR"]],
    ["jpmom","Japan momentum 12-2",["jpmom6:SMALL_HiPRIOR","jpmom6:BIG_HiPRIOR"],["jpmom6:SMALL_LoPRIOR","jpmom6:BIG_LoPRIOR"]],
    ["apmom","Asia-Pacific ex-Japan momentum 12-2",["apmom6:SMALL_HiPRIOR","apmom6:BIG_HiPRIOR"],["apmom6:SMALL_LoPRIOR","apmom6:BIG_LoPRIOR"]],
    ["dxval","developed ex-US value HML",["dxval6:SMALL_HiBM","dxval6:BIG_HiBM"],["dxval6:SMALL_LoBM","dxval6:BIG_LoBM"]],
    ["dxwml","developed ex-US WML (French factor)",["dxwml:WML"],[]],
    ["emmom","emerging markets WML (French factor)",["emmom:WML"],[]],
    ["dxhml","developed ex-US HML (French factor)",["dxff3:HML"],[]],
    ["emhml","emerging HML",["emff5:HML"],[]],
    ["emrmw","emerging RMW (profitability)",["emff5:RMW"],[]],
    ["dxrmw","developed ex-US RMW (profitability)",["dxff5:RMW"],[]],
    ["dxcma","developed ex-US CMA (investment)",["dxff5:CMA"],[]],
    ["emcma","emerging CMA (investment)",["emff5:CMA"],[]],
  ];
  for(const [suf,label,longs,shorts] of SPECS12){
    const key=`intl|${suf}|h1`;
    const Ls=longs.map(n=>byI.get(n)), Ss=shorts.map(n=>byI.get(n));
    if(Ls.some(x=>!x)||Ss.some(x=>!x)){await record(key,"intl",{suf,label},"intl_panels",null,ceil);done++;continue;}
    const months3=[...Ls[0]!.keys()].filter(m=>Ls.every(x=>x!.has(m))&&Ss.every(x=>x!.has(m))).sort();
    const rets=months3.map(m=>{
      const l=Ls.reduce((a,x)=>a+x!.get(m)!,0)/Ls.length;
      const sh=Ss.length?Ss.reduce((a,x)=>a+x!.get(m)!,0)/Ss.length:0;
      return l-sh-DRAG12;});
    if(rets.length<120){await record(key,"intl",{suf,label},"intl_panels",null,ceil);done++;continue;}
    const m=mean(rets),sd=sdv(rets)||1e-9,t=m/(sd/Math.sqrt(rets.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of rets){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*rets.length/4),b2=Math.floor((e+1)*rets.length/4);return mean(rets.slice(a,b2));});
    const g:Gate={n_names:1,n_periods:rets.length,gross_ann:(m+DRAG12)*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:true, g_effect:Math.abs(m)>=DRAG12, g_benchmark:m>0, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"intl",{suf,label},"intl_panels",g,ceil); done++;
    await log(`    ${label.padEnd(42)} n=${rets.length}  net ${(m*12*100).toFixed(1)}%/yr  t=${t.toFixed(2)}  eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 12 (intl) done: ${SPECS12.length} specs`);
}

// ================= PASS 13 — VOL-COMPLEX TIMING (D-493: SKEW/VVIX/term-structure as SPY/QQQ risk gates) =================
// The CBOE index history (SKEW 1990->, VVIX 2007->, VIX9D/VIX3M ~2009-11->) has never been TESTED here as a timing
// input. Pre-registered direction: stress (high SKEW/VVIX z, inverted term structure) -> risk-off. Judged exactly like
// PASS 3: daily excess vs buy-and-hold, 10bp per switch, breadth-exempt single-instrument class.
if(PASS==="all"||PASS==="voltiming"){
  const iso=(ts:number)=>new Date(ts*1000).toISOString().slice(0,10);
  const volIdx=new Map<string,Map<string,number>>();
  for(const nm of ["SKEW","VVIX","VIX9D","VIX3M"]){
    const r=await fetch(`${OWNED}/trd_perp_oi?venue=eq.cboe&interval=eq.index_close&symbol=eq.${nm}&select=ts,open_interest&order=ts&limit=100000`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {ts:number;open_interest:number}[];
    volIdx.set(nm,new Map(r.map(x=>[iso(x.ts),+x.open_interest])));
  }
  const vixBars=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.%5EVIX&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const vix=new Map<string,number>((vixBars[0]?.bars||[]).map(b=>[iso(b[0]),b[4]]));
  await log(`  voltiming: SKEW ${volIdx.get("SKEW")!.size}d VVIX ${volIdx.get("VVIX")!.size}d VIX9D ${volIdx.get("VIX9D")!.size}d VIX3M ${volIdx.get("VIX3M")!.size}d VIX ${vix.size}d`);
  type VRule={name:string;need:string[];off:(d:string,z:(nm:string,d:string)=>number|null)=>boolean|null};
  const zbuf=new Map<string,{ds:string[];vs:number[]}>();
  for(const [nm,mp] of volIdx){const ds=[...mp.keys()].sort();zbuf.set(nm,{ds,vs:ds.map(d=>mp.get(d)!)});}
  const zof=(nm:string,d:string):number|null=>{
    const b=zbuf.get(nm)!; let lo=0,hi=b.ds.length-1,ix=-1;
    while(lo<=hi){const m=(lo+hi)>>1;if(b.ds[m]<=d){ix=m;lo=m+1;}else hi=m-1;}
    if(ix<252)return null;
    const w=b.vs.slice(ix-252,ix); const mu=w.reduce((a,x)=>a+x,0)/252;
    const sd2=Math.sqrt(w.reduce((a,x)=>a+(x-mu)*(x-mu),0)/252)||1e-9;
    return (b.vs[ix]-mu)/sd2;};
  const lvl=(nm:string,d:string):number|null=>volIdx.get(nm)!.get(d)??null;
  const VRULES:VRule[]=[];
  for(const th of [1.5,2.0]){
    VRULES.push({name:`skew_z${th}`,need:["SKEW"],off:(d,z)=>{const v=z("SKEW",d);return v===null?null:v>th;}});
    VRULES.push({name:`vvix_z${th}`,need:["VVIX"],off:(d,z)=>{const v=z("VVIX",d);return v===null?null:v>th;}});
  }
  for(const th of [1.0,1.05]){
    VRULES.push({name:`term9d_${th}`,need:["VIX9D"],off:(d)=>{const a=lvl("VIX9D",d),b=vix.get(d);return a==null||b==null?null:a/b>th;}});
    VRULES.push({name:`term3m_${th}`,need:["VIX3M"],off:(d)=>{const a=lvl("VIX3M",d),b=vix.get(d);return a==null||b==null?null:b/a>th;}});
  }
  for(const inst of ["SPY","QQQ"]){
    const r=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${inst}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
    const bars=(r[0]?.bars||[]).filter(b=>b[4]>0);
    for(const rule of VRULES){
      const key=`voltiming|${inst}|${rule.name}`;
      // D-498 SAME-BAR EXECUTION FIX: the signal read at close i-1 sets the position for return i->i+1.
      const net:number[]=[],bh:number[]=[]; let prev=1,sw=0,wPend:number|null=null;
      for(let i=0;i<bars.length-1;i++){
        const w=wPend;                                           // yesterday's signal
        const d=iso(bars[i][0]); const off=rule.off(d,zof);
        if(off!==null) wPend=off?0:1;                            // today's signal, for tomorrow
        if(w===null)continue;                                    // no signal yet
        const r2=bars[i+1][4]/bars[i][4]-1;
        net.push(w*r2-(w!==prev?10/1e4:0)); bh.push(r2); if(w!==prev){sw++;prev=w;}
      }
      if(net.length<500){await record(key,"voltiming",{inst,rule:rule.name},"single",null,ceil);done++;continue;}
      const ex=net.map((x,i)=>x-bh[i]);
      const m=mean(ex),sd=sdv(ex)||1e-9,t=m/(sd/Math.sqrt(ex.length));
      let cum=1,pk=1,dd=0,ruined=false;for(const x of net){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
      const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*ex.length/4),b2=Math.floor((e+1)*ex.length/4);return mean(ex.slice(a,b2));});
      const gate:Gate={n_names:1,n_periods:ex.length,gross_ann:mean(net)*252+ (sw/(ex.length/252))*10/1e4,net_ann:mean(net)*252,
        sharpe:(mean(net)/(sdv(net)||1e-9))*Math.sqrt(252),t,dd:dd*100,ruined,
        g_breadth:true, g_effect:Math.abs(m)*252>=(sw/(ex.length/252))*10/1e4,
        g_benchmark:m>0 /* must beat buy-and-hold */, g_liquid:true,
        g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
      await record(key,"voltiming",{inst,rule:rule.name,switches:sw,exec:"lag1"},"single",gate,ceil); done++;
      await log(`    ${inst} ${rule.name.padEnd(12)} n=${ex.length}  excess ${(m*252*100).toFixed(1)}%/yr  t=${t.toFixed(2)}  sw=${sw}`);
    }
  }
  await log(`  PASS 13 (voltiming) done: ${2*VRULES.length} specs`);
}

// ================= PASS 14 — 13F INSTITUTIONAL OWNERSHIP (D-494: the hedge-fund complement to N-PORT, 2013->) =================
// trd_13f_ownership: per-(cusip, quarter) aggregates over deduped latest-filed 13F-HRs, put/call rows excluded,
// pre-2023 $thousands normalized. KNOWN CAVEAT (stated): shared-discretion positions can be reported by more than one
// manager in a hierarchy, so LEVELS overstate; CHANGES are the robust signal and levels are tested with that caveat.
// effective_date = last contributing filing (a backtest reads the aggregate only when complete).
if(PASS==="all"||PASS==="own13f"){
  const cus2sym14=new Map<string,string>();
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_cusip_map?select=cusip,symbol&order=cusip&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.ok?r.json():Promise.reject(r.status)).catch(e=>{console.log(`WRITE-FAILED cusip_map read ${e}`);return[];});
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {cusip:string;symbol:string}[]) cus2sym14.set(r.cusip,r.symbol);
    if(p2.length<50000)break;
  }
  const own13=new Map<string,{eff:string;nm:number;sh:number;val:number}[]>();
  let n13=0;
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_13f_ownership?select=cusip,effective_date,n_mgrs,shares,value_usd&order=cusip,report_date&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.ok?r.json():Promise.reject(r.status)).catch(e=>{console.log(`WRITE-FAILED 13f read ${e}`);return[];});
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {cusip:string;effective_date:string;n_mgrs:number;shares:number;value_usd:number}[]){
      const sym=cus2sym14.get(r.cusip); if(!sym)continue;
      (own13.get(sym)??own13.set(sym,[]).get(sym)!).push({eff:r.effective_date,nm:+r.n_mgrs,sh:+r.shares,val:+r.value_usd});n13++;}
    if(p2.length<50000)break;
  }
  for(const a of own13.values()) a.sort((x,y)=>x.eff<y.eff?-1:1);
  await log(`  own13f: ${n13.toLocaleString()} symbol-quarters mapped, ${own13.size} symbols`);
  const at13=(sym:string,endD:string)=>{
    const a=own13.get(sym); if(!a)return null;
    let lo=0,hi=a.length-1,best=-1;
    while(lo<=hi){const m=(lo+hi)>>1;if(a[m].eff<=endD){best=m;lo=m+1;}else hi=m-1;}
    return best<0?null:{cur:a[best],prev:best>0?a[best-1]:null};
  };
  const minus14=(d:string,days:number)=>{const x=new Date(d+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-days);return x.toISOString().slice(0,10);};
  const moEnd14=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const SIGS14=["i13_brd_chg","i13_sh_chg","i13_crowd","i13_val_chg"] as const;
  for(const sig of SIGS14) for(const hold of [1,3]) for(const k of [5,10]){
    const key=`own13f|${sig}|h${hold}|k${k}`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(const r of eqPanel){
      const end=moEnd14(r.mo), hit=at13(r.sym,end);
      if(!hit||hit.cur.eff<minus14(end,200))continue;          // stale (>~2 quarters) is no signal
      let v:number|null=null;
      if(sig==="i13_crowd"){ v=(r.dv&&r.dv>0)?hit.cur.val/(r.dv*63):null; }
      else{
        const p=hit.prev; if(!p)continue;
        if(sig==="i13_brd_chg") v=p.nm>=5?(hit.cur.nm-p.nm)/p.nm:null;
        else if(sig==="i13_sh_chg") v=p.sh>0?(hit.cur.sh-p.sh)/p.sh:null;
        else v=p.val>0?(hit.cur.val-p.val)/p.val:null;
      }
      if(v===null||!isFinite(v))continue;
      rows.push({mo:r.mo,fwd:r.fwd,v});
    }
    const g=evalXsec(rows,FEE_EQ,k,12/hold,hold);
    await record(key,"own13f",{sig,hold,k},"equity_all",g,ceil); done++;
  }
  await log(`  PASS 14 (own13f) done: ${SIGS14.length*4} specs`);
}

// ================= PASS 15 — EARNINGS ANNOUNCEMENT PREMIUM (D-497: Frazzini-Lamont; calendar known ex-ante) =================
// Documented anomaly never tested here: stocks earn more in months with a scheduled earnings announcement. The signal is
// point-in-time by construction — the PREDICTED next announcement (last visible report + ~91d) uses only past dates.
// Portfolio: long predicted-announcers next month vs the rest of the panel, equal-weight, monthly rebalance at one
// round-trip fee on the announcer book.
if(PASS==="all"||PASS==="annprem"){
  const ann=new Map<string,string[]>();
  let nA=0;
  for(let off=0;;off+=10000){
    const p2=await fetch(`${OWNED}/trd_earnings?select=symbol,report_date&order=report_date&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {symbol:string;report_date:string}[]){(ann.get(r.symbol)??ann.set(r.symbol,[]).get(r.symbol)!).push(r.report_date);nA++;}
    if(p2.length<10000)break;
  }
  await log(`  annprem: ${nA.toLocaleString()} announcement dates, ${ann.size} symbols`);
  const moEnd15=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const nextMo=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,7);};
  const byMo=new Map<string,{flag:number[];rest:number[]}>();
  for(const r of eqPanel){
    const a=ann.get(r.sym); const end=moEnd15(r.mo);
    if(!a)continue;
    // last announcement visible at month end (dates sorted)
    let lo=0,hi=a.length-1,best=-1;
    while(lo<=hi){const m=(lo+hi)>>1;if(a[m]<=end){best=m;lo=m+1;}else hi=m-1;}
    if(best<0)continue;
    const last=a[best];
    const ageDays=(Date.parse(end)-Date.parse(last))/86400000;
    if(ageDays>200)continue;                                     // no live cadence
    const pred=new Date(Date.parse(last)+91*86400000).toISOString().slice(0,7);
    const flagged=pred===nextMo(r.mo)?1:0;
    const b=byMo.get(r.mo)??byMo.set(r.mo,{flag:[],rest:[]}).get(r.mo)!;
    (flagged?b.flag:b.rest).push(r.fwd);
  }
  const months15=[...byMo.keys()].sort();
  const diffs:number[]=[]; let sumFlag=0,nmo=0;
  for(const mo of months15){
    const b=byMo.get(mo)!;
    if(b.flag.length<20||b.rest.length<50)continue;              // need real breadth both sides
    diffs.push(mean(b.flag)-mean(b.rest)-2*FEE_EQ/1e4);          // full turnover of the announcer book monthly
    sumFlag+=b.flag.length; nmo++;
  }
  const key=`annprem|pred91|h1`;
  if(diffs.length<60){await record(key,"annprem",{},"equity_all",null,ceil);done++;}
  else{
    const m=mean(diffs),sd=sdv(diffs)||1e-9,t=m/(sd/Math.sqrt(diffs.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of diffs){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*diffs.length/4),b2=Math.floor((e+1)*diffs.length/4);return mean(diffs.slice(a,b2));});
    const g:Gate={n_names:Math.round(sumFlag/Math.max(1,nmo)),n_periods:diffs.length,gross_ann:(m+2*FEE_EQ/1e4)*12,net_ann:m*12,
      sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:Math.round(sumFlag/Math.max(1,nmo))>=50, g_effect:Math.abs(m)>=2*FEE_EQ/1e4, g_benchmark:m>0, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"annprem",{},"equity_all",g,ceil); done++;
    await log(`    annprem pred91: n=${diffs.length}mo  avg announcers ${Math.round(sumFlag/Math.max(1,nmo))}  net ${(m*12*100).toFixed(1)}%/yr  t=${t.toFixed(2)}  eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 15 (annprem) done`);
}

// ================= PASS 16 — CFTC COT POSITIONING (D-501: the only multi-decade positioning dataset; Tier-B unlock) =================
// 287,779 weekly reports 1986->2026. Tuesday positions publish Friday; execution here waits for the first close
// >= report_date + 6 calendar days (Monday), so every position uses only published data — the same-bar law honored by
// construction. Time-series book across ~24 futures markets (commodities + CME FX + equity index + bonds), equal-weight;
// the claim is a PORTFOLIO-of-TS-strategies claim (like factmom), with the market count stated, not a cross-sectional one.
// Panel span is the price-data intersection (Yahoo futures mostly 2000->); COT reaches 1986 but is only used where prices exist.
if(PASS==="all"||PASS==="cot"){
  type CotRow={report_date:string;oi:number;ncl:number;ncs:number;cl:number;cs:number};
  const MAP:[string,string,number,string[]][]=[ // [yahooSym, label, signVsUSD, codes (primary first, aliases for older eras)]
    ["CL=F","wti",1,["067651"]],["NG=F","natgas",1,["023651"]],["GC=F","gold",1,["088691"]],["SI=F","silver",1,["084691"]],
    ["HG=F","copper",1,["085692"]],["PL=F","platinum",1,["076651"]],["PA=F","palladium",1,["075651"]],
    ["ZC=F","corn",1,["002602","002601"]],["ZW=F","wheat",1,["001602","001601"]],["ZS=F","soybeans",1,["005602","005601"]],
    ["KC=F","coffee",1,["083731"]],["SB=F","sugar",1,["080732"]],["CC=F","cocoa",1,["073732"]],["CT=F","cotton",1,["033661"]],
    ["LE=F","cattle",1,["057642"]],["HE=F","hogs",1,["054642"]],
    ["EURUSD=X","eur",1,["099741"]],["GBPUSD=X","gbp",1,["096742"]],["AUDUSD=X","aud",1,["232741"]],["NZDUSD=X","nzd",1,["112741"]],
    ["JPY=X","jpy",-1,["097741"]],["CAD=X","cad",-1,["090741"]],["CHF=X","chf",-1,["092741"]],["MXN=X","mxn",-1,["095741"]],
    ["^GSPC","spx",1,["13874A","138741"]],["TLT","ust30y",1,["020601"]],
  ];
  const iso16=(ts:number)=>new Date(ts*1000).toISOString().slice(0,10);
  const plus=(d:string,days:number)=>{const x=new Date(d+"T00:00:00Z");x.setUTCDate(x.getUTCDate()+days);return x.toISOString().slice(0,10);};
  // load COT per instrument (aliases merged, primary wins on overlap)
  const cot=new Map<string,{d:string;comm:number;spec:number}[]>();
  for(const [sym,label,_sg,codes] of MAP){
    const seen=new Map<string,{d:string;comm:number;spec:number}>();
    for(let ci=codes.length-1;ci>=0;ci--){                      // aliases first, primary overwrites
      const rows2=await fetch(`${OWNED}/trd_cot?market_code=eq.${codes[ci]}&select=report_date,oi,ncl,ncs,cl,cs&order=report_date&limit=3000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as CotRow[];
      for(const r of rows2){ if(!(r.oi>0))continue;
        seen.set(r.report_date,{d:r.report_date,comm:(r.cl-r.cs)/r.oi,spec:(r.ncl-r.ncs)/r.oi}); }
    }
    cot.set(sym,[...seen.values()].sort((a,b)=>a.d<b.d?-1:1));
  }
  await log(`  cot: ${MAP.length} markets, ${[...cot.values()].reduce((a,x)=>a+x.length,0).toLocaleString()} weekly reports mapped`);
  // percentile of latest value within trailing 156 weekly reports
  const pct=(a:{d:string;comm:number;spec:number}[],i:number,f:(x:{comm:number;spec:number})=>number)=>{
    if(i<52)return null; const lo=Math.max(0,i-156); const v=f(a[i]); let c=0,n=0;
    for(let q=lo;q<i;q++){n++;if(f(a[q])<=v)c++;} return n<52?null:c/n;};
  const SIGS16:[string,(cp:number,sp:number,thH:number,thL:number)=>number][]=[
    ["follow_comm",(cp,_sp,thH,thL)=>cp>=thH?1:cp<=thL?-1:0],
    ["fade_spec",(_cp,sp,thH,thL)=>sp<=thL?1:sp>=thH?-1:0],
    ["follow_spec",(_cp,sp,thH,thL)=>sp>=thH?1:sp<=thL?-1:0],
  ];
  for(const [signame,rule] of SIGS16) for(const [thH,thL] of [[0.8,0.2],[0.9,0.1]] as [number,number][]){
    const key=`cot|${signame}|${thH}`;
    // daily book return across markets
    const daily=new Map<string,{r:number;n:number}>();
    let nMktUsed=0;
    for(const [sym,_label,sg] of MAP){
      const a=cot.get(sym)!; if(a.length<60)continue;
      const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
      const bars=(rb[0]?.bars||[]).filter(b=>b[4]>0); if(bars.length<500)continue;
      nMktUsed++;
      // weekly signal timeline -> daily position via "tradable from" dates
      const marks:{from:string;w:number}[]=[];
      for(let i=0;i<a.length;i++){
        const cp=pct(a,i,x=>x.comm), sp=pct(a,i,x=>x.spec);
        if(cp===null||sp===null)continue;
        marks.push({from:plus(a[i].d,6),w:rule(cp,sp,thH,thL)});
      }
      if(marks.length<50)continue;
      let mi=-1,prevW=0;
      for(let i=0;i<bars.length-1;i++){
        const d=iso16(bars[i][0]);
        while(mi+1<marks.length&&marks[mi+1].from<=d)mi++;
        if(mi<0)continue;
        const w=marks[mi].w*sg;
        const r2=bars[i+1][4]/bars[i][4]-1;
        const fee=(w!==prevW)?10/1e4:0; prevW=w;
        const cur=daily.get(d)??daily.set(d,{r:0,n:0}).get(d)!;
        cur.r+=w*r2*sg*sg-fee; cur.n++;    // sg applied to return direction via w*sg already; r2 is the yahoo series return
      }
    }
    // NOTE the sign: for USD-inverted FX (JPY=X etc.) w*sg flips the position so the book is long the FOREIGN currency
    // future when the rule says +1; the return series itself stays as quoted.
    const moAgg=new Map<string,number>();
    for(const [d,v] of daily){ if(v.n<5)continue; moAgg.set(d.slice(0,7),(moAgg.get(d.slice(0,7))||0)+v.r/v.n); }
    const mos=[...moAgg.entries()].sort().map(x=>x[1]);
    if(mos.length<120){await record(key,"cot",{signame,thH,exec:"pub_lag6d"},"futures_cot",null,ceil);done++;continue;}
    const m=mean(mos),sd=sdv(mos)||1e-9,t=m/(sd/Math.sqrt(mos.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of mos){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*mos.length/4),b2=Math.floor((e+1)*mos.length/4);return mean(mos.slice(a2,b2));});
    const g:Gate={n_names:nMktUsed,n_periods:mos.length,gross_ann:m*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:nMktUsed>=20 /* TS-portfolio class; market count stated */, g_effect:true /* fees inside net */,
      g_benchmark:m>0 /* self-financing L/S book */, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"cot",{signame,thH,exec:"pub_lag6d",markets:nMktUsed},"futures_cot",g,ceil); done++;
    await log(`    cot ${signame} th${thH}: mkts=${nMktUsed} n=${mos.length}mo net ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)} eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 16 (cot) done: ${SIGS16.length*2} specs`);
}

// ================= PASS 17 — TREASURY AUCTION DEMAND (D-502: bid-to-cover as duration timing; 1979-> auctions) =================
// Auction results publish ~13:00 ET on auction day; execution waits for the NEXT daily close (lag-1 by construction).
// Signal: 10Y/30Y bid-to-cover z vs the trailing 10 same-term auctions. Overlay on TLT (2002->), long/short, held to
// the next auction. Self-financing L/S judged on its own mean; single-instrument class, benchmark-vs-flat stated.
if(PASS==="all"||PASS==="auction"){
  const au=await fetch(`${OWNED}/trd_auctions?security_term=in.(10-Year,30-Year)&bid_to_cover=not.is.null&select=auction_date,security_term,bid_to_cover&order=auction_date&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {auction_date:string;security_term:string;bid_to_cover:number}[];
  await log(`  auction: ${au.length} 10Y/30Y auctions with bid-to-cover`);
  const byTerm=new Map<string,{d:string;b:number}[]>();
  for(const r of au)(byTerm.get(r.security_term)??byTerm.set(r.security_term,[]).get(r.security_term)!).push({d:r.auction_date,b:+r.bid_to_cover});
  const events:{d:string;z:number}[]=[];
  for(const a of byTerm.values()){
    for(let i=10;i<a.length;i++){
      const w=a.slice(i-10,i).map(x=>x.b);
      const mu=mean(w),sd2=sdv(w)||1e-9;
      events.push({d:a[i].d,z:(a[i].b-mu)/sd2});
    }
  }
  events.sort((x,y)=>x.d<y.d?-1:1);
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.TLT&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const bars=(rb[0]?.bars||[]).filter(b=>b[4]>0);
  const iso17=(ts:number)=>new Date(ts*1000).toISOString().slice(0,10);
  for(const dir of ["follow","fade"]) for(const th of [0.5,1.0]){
    const key=`auction|btc_${dir}|z${th}`;
    const daily:{d:string;r:number}[]=[]; let ei=-1,w=0,prevW=0,swc=0;
    for(let i=0;i<bars.length-1;i++){
      const d=iso17(bars[i][0]);
      while(ei+1<events.length&&events[ei+1].d<d)              // auction strictly before today's close -> lag-1
        {ei++; const z=events[ei].z; const raw=z>th?1:z<-th?-1:0; w=dir==="follow"?raw:-raw;}
      const r2=bars[i+1][4]/bars[i][4]-1;
      const fee=(w!==prevW)?10/1e4:0; if(w!==prevW){swc++;prevW=w;}
      daily.push({d:iso17(bars[i][0]),r:w*r2-fee});
    }
    const moA=new Map<string,number>();
    for(const x of daily) moA.set(x.d.slice(0,7),(moA.get(x.d.slice(0,7))||0)+x.r);
    const mos=[...moA.entries()].sort().map(x=>x[1]);
    if(mos.length<120){await record(key,"auction",{dir,th,exec:"lag1"},"single",null,ceil);done++;continue;}
    const m=mean(mos),sd=sdv(mos)||1e-9,t=m/(sd/Math.sqrt(mos.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of mos){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*mos.length/4),b2=Math.floor((e+1)*mos.length/4);return mean(mos.slice(a2,b2));});
    const g:Gate={n_names:1,n_periods:mos.length,gross_ann:m*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:true, g_effect:true, g_benchmark:m>0, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"auction",{dir,th,exec:"lag1",switches:swc},"single",g,ceil); done++;
    await log(`    auction ${dir} z${th}: n=${mos.length}mo net ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)} sw=${swc} eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 17 (auction) done: 4 specs`);
}

// ================= PASS 18 — CALENDAR SEASONALITY (D-503: TOM / Halloween / September; never swept here) =================
// The rule input is the DATE — known ex-ante, so no execution lag applies (exec:"calendar"). Judged like the timing
// class: excess vs buy-and-hold of the same instrument, 10bp per switch, single-instrument breadth exemption.
if(PASS==="all"||PASS==="seasonal"){
  const INST18=["^GSPC","SPY","QQQ","TLT","GLD","GC=F","CL=F"];
  const iso18=(ts:number)=>new Date(ts*1000).toISOString().slice(0,10);
  type SRule={name:string;hold:(d:Date,isLast:boolean,dayN:number)=>boolean};
  const SRULES:SRule[]=[
    {name:"tom",hold:(_d,isLast,dayN)=>isLast||dayN<=3},           // last trading day + first 3
    {name:"nov_apr",hold:(d)=>{const m=d.getUTCMonth()+1;return m>=11||m<=4;}},
    {name:"ex_september",hold:(d)=>d.getUTCMonth()+1!==9},
  ];
  for(const inst of INST18){
    const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(inst)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
    const bars=(rb[0]?.bars||[]).filter(b=>b[4]>0); if(bars.length<2500)continue;
    for(const rule of SRULES){
      const key=`seasonal|${inst}|${rule.name}`;
      const ex:number[]=[]; const exD:string[]=[]; let prevW=1,sw=0;
      for(let i=0;i<bars.length-1;i++){
        const d=new Date(bars[i][0]*1000);
        const dNext=new Date(bars[i+1][0]*1000);
        const isLast=dNext.getUTCMonth()!==d.getUTCMonth();
        // trading-day-of-month for date i
        let dayN=0; for(let q=i;q>=0;q--){const dq=new Date(bars[q][0]*1000);if(dq.getUTCMonth()===d.getUTCMonth()&&dq.getUTCFullYear()===d.getUTCFullYear())dayN++;else break;}
        const w=rule.hold(d,isLast,dayN)?1:0;
        const r2=bars[i+1][4]/bars[i][4]-1;
        const fee=(w!==prevW)?10/1e4:0; if(w!==prevW){sw++;prevW=w;}
        ex.push(w*r2-fee-r2); exD.push(iso18(bars[i][0]));
      }
      const moA=new Map<string,number>();
      for(let q=0;q<ex.length;q++) moA.set(exD[q].slice(0,7),(moA.get(exD[q].slice(0,7))||0)+ex[q]);
      const mos=[...moA.entries()].sort().map(x=>x[1]);
      if(mos.length<180){await record(key,"seasonal",{inst,rule:rule.name,exec:"calendar"},"single",null,ceil);done++;continue;}
      const m=mean(mos),sd=sdv(mos)||1e-9,t=m/(sd/Math.sqrt(mos.length));
      let cum=1,pk=1,dd=0,ruined=false;for(const x of mos){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
      const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*mos.length/4),b2=Math.floor((e+1)*mos.length/4);return mean(mos.slice(a2,b2));});
      const g:Gate={n_names:1,n_periods:mos.length,gross_ann:m*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
        g_breadth:true, g_effect:true, g_benchmark:m>0, g_liquid:true,
        g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
      await record(key,"seasonal",{inst,rule:rule.name,exec:"calendar",switches:sw},"single",g,ceil); done++;
      if(Math.abs(t)>1.5) await log(`    seasonal ${inst} ${rule.name}: n=${mos.length}mo excess ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)} eras ${q4.map(x=>x>0?"+":"-").join("")}`);
    }
  }
  await log(`  PASS 18 (seasonal) done`);
}

// ================= PASS 19 — OVERNIGHT vs INTRADAY (D-503b: the decomposition, costed honestly) =================
// "All of the equity premium is overnight" is a decomposition FACT in the literature; as a STRATEGY it pays two spreads
// a day. Both legs recorded with the 20bp/day round trip inside net — the pre-registered expectation is SUB-FEE, and
// the gross decomposition is stated in the log for the record.
if(PASS==="all"||PASS==="overnight"){
  const iso19=(ts:number)=>new Date(ts*1000).toISOString().slice(0,10);
  for(const inst of ["SPY","QQQ","^GSPC","GLD","TLT"]){
    const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(inst)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
    const bars=(rb[0]?.bars||[]).filter(b=>b[4]>0&&b[1]>0); if(bars.length<2500)continue;
    for(const leg of ["overnight","intraday"]){
      const key=`overnight|${inst}|${leg}`;
      const moG=new Map<string,number>(), moN=new Map<string,number>();
      for(let i=0;i<bars.length-1;i++){
        const gRet=leg==="overnight"?bars[i+1][1]/bars[i][4]-1:bars[i+1][4]/bars[i+1][1]-1;
        const mo=iso19(bars[i][0]).slice(0,7);
        moG.set(mo,(moG.get(mo)||0)+gRet); moN.set(mo,(moN.get(mo)||0)+gRet-20/1e4);
      }
      const mosG=[...moG.entries()].sort().map(x=>x[1]), mosN=[...moN.entries()].sort().map(x=>x[1]);
      if(mosN.length<180){await record(key,"overnight",{inst,leg},"single",null,ceil);done++;continue;}
      const mG=mean(mosG);
      const m=mean(mosN),sd=sdv(mosN)||1e-9,t=m/(sd/Math.sqrt(mosN.length));
      let cum=1,pk=1,dd=0,ruined=false;for(const x of mosN){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
      const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*mosN.length/4),b2=Math.floor((e+1)*mosN.length/4);return mean(mosN.slice(a2,b2));});
      const g:Gate={n_names:1,n_periods:mosN.length,gross_ann:mG*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
        g_breadth:true, g_effect:m>0, g_benchmark:m>0, g_liquid:true,
        g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
      await record(key,"overnight",{inst,leg},"single",g,ceil); done++;
      await log(`    overnight ${inst} ${leg}: gross ${(mG*12*100).toFixed(1)}%/yr  NET(20bp/d) ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)}`);
    }
  }
  await log(`  PASS 19 (overnight) done`);
}

// ================= PASS 20 — SIZE x MOMENTUM BIVARIATES (D-504b: does momentum live where SIZE can go?) =================
// The Liquidity Law asks it of every cross-sectional result; here it is asked of the program's strongest premium at
// century power: momentum (and ST-reversal) INSIDE the large-cap quintile vs inside small caps. 1927->2026.
if(PASS==="all"||PASS==="szbivar"){
  const ffB=await (async()=>{const out:{month:string;factor:string;ret:number}[]=[];
    for(let off=0;;off+=10000){
      const p2=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.szmom25:*,factor.like.szstrev25:*)&select=month,factor,ret&order=month&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(p2)||!p2.length)break; out.push(...p2); if(p2.length<10000)break;}
    return out;})();
  const byB=new Map<string,Map<string,number>>();
  for(const r of ffB)(byB.get(r.factor)??byB.set(r.factor,new Map()).get(r.factor)!).set(r.month,+r.ret);
  await log(`  szbivar: ${ffB.length.toLocaleString()} obs, ${byB.size} series`);
  const DRAG20=0.0005;
  const SPECS20:[string,string,string,string][]=[
    ["bigmom","BIG-cap momentum (winners-losers, ME5)","szmom25:BIG_HiPRIOR","szmom25:BIG_LoPRIOR"],
    ["smallmom","SMALL-cap momentum (ME1)","szmom25:SMALL_HiPRIOR","szmom25:SMALL_LoPRIOR"],
    ["bigstrev","BIG-cap ST-reversal (long losers, ME5)","szstrev25:BIG_LoPRIOR","szstrev25:BIG_HiPRIOR"],
    ["smallstrev","SMALL-cap ST-reversal (ME1)","szstrev25:SMALL_LoPRIOR","szstrev25:SMALL_HiPRIOR"],
  ];
  for(const [suf,label,ln,sn] of SPECS20){
    const key=`szbivar|${suf}|h1`;
    const L=byB.get(ln),Sh=byB.get(sn);
    if(!L||!Sh){await record(key,"szbivar",{suf,label},"decile_panels",null,ceil);done++;continue;}
    const months=[...L.keys()].filter(m=>Sh.has(m)).sort();
    const rets=months.map(m=>L.get(m)!-Sh.get(m)!-DRAG20);
    if(rets.length<240){await record(key,"szbivar",{suf,label},"decile_panels",null,ceil);done++;continue;}
    const m=mean(rets),sd=sdv(rets)||1e-9,t=m/(sd/Math.sqrt(rets.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of rets){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*rets.length/4),b2=Math.floor((e+1)*rets.length/4);return mean(rets.slice(a2,b2));});
    const g:Gate={n_names:1,n_periods:rets.length,gross_ann:(m+DRAG20)*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:true, g_effect:Math.abs(m)>=DRAG20, g_benchmark:m>0, g_liquid:suf.startsWith("big"),
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"szbivar",{suf,label},"decile_panels",g,ceil); done++;
    await log(`    ${label.padEnd(44)} n=${rets.length}  net ${(m*12*100).toFixed(1)}%/yr  t=${t.toFixed(2)}  eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 20 (szbivar) done`);
}

// ================= PASS 21 — FX INTRADAY (D-504: Dukascopy hourly, 4 majors 2016->; sessions + h1 momentum) =================
// Rules: (a) asian_break — sign of the 00:00->07:00 UTC move held 07:00->16:00 (London session); (b) h1_mom / h1_rev —
// previous hour's sign held (or faded) for one hour. Fees 1bp per position change (majors, tight spread). Portfolio
// equal-weight across pairs; monthly-aggregated t. Signals use only completed bars (lag structure explicit).
if(PASS==="all"||PASS==="fxintraday"){
  const PAIRS21=["EURUSD","GBPUSD","USDJPY","AUDUSD"];
  const series21=new Map<string,{ts:number;o:number;c:number}[]>();
  for(const p of PAIRS21){
    const rows:{ts:number;o:number;c:number}[]=[];
    for(let off=0;;off+=50000){
      const p2=await fetch(`${OWNED}/trd_fx_hourly?symbol=eq.${p}&select=ts,o,c&order=ts&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(p2)||!p2.length)break;
      for(const r of p2 as {ts:number;o:number;c:number}[]) rows.push({ts:+r.ts,o:+r.o,c:+r.c});
      if(p2.length<50000)break;
    }
    series21.set(p,rows);
  }
  await log(`  fxintraday: ${[...series21.values()].reduce((a,x)=>a+x.length,0).toLocaleString()} hourly bars, ${PAIRS21.length} pairs`);
  const RULES21=["asian_break","h1_mom","h1_rev"] as const;
  for(const rule of RULES21){
    const key=`fxintraday|${rule}`;
    const moA=new Map<string,{r:number;n:number}>();
    for(const p of PAIRS21){
      const a=series21.get(p)!; if(a.length<5000)continue;
      let prevW=0;
      for(let i=1;i<a.length;i++){
        const d=new Date(a[i].ts*1000); const hr=d.getUTCHours();
        let w=0;
        if(rule==="asian_break"){
          if(hr>=7&&hr<16){
            // find the 00:00 open of this UTC day and the 07:00 open (bar preceding position start)
            let o0=NaN,o7=NaN;
            for(let q=i;q>=0&&q>i-20;q--){const h2=new Date(a[q].ts*1000);if(h2.getUTCDate()!==d.getUTCDate())break;
              if(h2.getUTCHours()===0)o0=a[q].o; if(h2.getUTCHours()===7)o7=a[q].o;}
            if(isFinite(o0)&&isFinite(o7)&&o7!==o0)w=Math.sign(o7-o0);
          }
        } else {
          const rPrev=a[i-1].c/a[i-1].o-1;
          w=rule==="h1_mom"?Math.sign(rPrev):-Math.sign(rPrev);
        }
        const r2=a[i].c/a[i].o-1;
        const fee=(w!==prevW)?1/1e4:0; prevW=w;
        const mo=d.toISOString().slice(0,7);
        const cur=moA.get(mo)??moA.set(mo,{r:0,n:0}).get(mo)!;
        cur.r+=(w*r2-fee)/PAIRS21.length; cur.n++;
      }
    }
    const mos=[...moA.entries()].sort().filter(x=>x[1].n>200).map(x=>x[1].r);
    if(mos.length<60){await record(key,"fxintraday",{rule,exec:"completed-bars"},"fx_majors",null,ceil);done++;continue;}
    const m=mean(mos),sd=sdv(mos)||1e-9,t=m/(sd/Math.sqrt(mos.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of mos){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*mos.length/4),b2=Math.floor((e+1)*mos.length/4);return mean(mos.slice(a2,b2));});
    const g:Gate={n_names:PAIRS21.length,n_periods:mos.length,gross_ann:m*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:true /* 4-pair TS-portfolio class, count stated */, g_effect:true, g_benchmark:m>0, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"fxintraday",{rule,exec:"completed-bars"},"fx_majors",g,ceil); done++;
    await log(`    fxintraday ${rule}: n=${mos.length}mo net ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)} eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 21 (fxintraday) done`);
}

// ================= PASS 22 — DARK-POOL SHARE (D-505: FINRA ATS/OTC weekly, 2022->, published +2-4wk) =================
// Signal: off-exchange (ATS / OTC internalizer) share of total volume, and its 3-month change. Point-in-time via
// FINRA's own initialPublishedDate. Short span (~4.7y) stated.
if(PASS==="all"||PASS==="darkpool"){
  const ats=new Map<string,{wk:string;pub:string;atsSh:number;otcSh:number}[]>();
  {const tmp=new Map<string,Map<string,{pub:string;a:number;o:number}>>();
  for(let off=0;;off+=50000){
    const p2=await fetch(`${OWNED}/trd_ats_weekly?select=symbol,week_start,type,published,shares&order=symbol,week_start&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {symbol:string;week_start:string;type:string;published:string;shares:number}[]){
      const m2=tmp.get(r.symbol)??tmp.set(r.symbol,new Map()).get(r.symbol)!;
      const e=m2.get(r.week_start)??m2.set(r.week_start,{pub:r.published,a:0,o:0}).get(r.week_start)!;
      if(r.published>e.pub)e.pub=r.published;
      if(r.type==="ATS_W_SMBL")e.a+=+r.shares; else e.o+=+r.shares;
    }
    if(p2.length<50000)break;
  }
  for(const [sym,m2] of tmp) ats.set(sym,[...m2.entries()].map(([wk,e])=>({wk,pub:e.pub,atsSh:e.a,otcSh:e.o})).sort((x,y)=>x.wk<y.wk?-1:1));}
  await log(`  darkpool: ${[...ats.values()].reduce((a,x)=>a+x.length,0).toLocaleString()} symbol-weeks, ${ats.size} symbols`);
  const moEnd22=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const SIGS22=["dp_share","dp_share_chg"] as const;
  for(const sig of SIGS22) for(const hold of [1,3]) for(const k of [5,10]){
    const key=`darkpool|${sig}|h${hold}|k${k}`;
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(const r of eqPanel){
      const a=ats.get(r.sym); if(!a)continue;
      const end=moEnd22(r.mo);
      const vis=a.filter(x=>x.pub<=end);
      if(vis.length<8)continue;
      const recent=vis.slice(-4), prior=vis.slice(-13,-4);
      const shTot=(x:{atsSh:number;otcSh:number})=>x.atsSh+x.otcSh;
      const rAvg=mean(recent.map(shTot));
      if(!(r.dv>0)||!(rAvg>0))continue;
      // dv is monthly DOLLAR volume; off-exchange shares are SHARE counts — the ratio is share-scale-free only through
      // the CHANGE spec; the LEVEL spec uses shares/dollar-vol as a proxy ordering (stated, rank-based eval).
      let v:number|null=null;
      if(sig==="dp_share") v=rAvg/r.dv;
      else{const pAvg=mean(prior.map(shTot)); v=pAvg>0?rAvg/pAvg-1:null;}
      if(v===null||!isFinite(v))continue;
      rows.push({mo:r.mo,fwd:r.fwd,v});
    }
    const g=evalXsec(rows,FEE_EQ,k,12/hold,hold);
    await record(key,"darkpool",{sig,hold,k},"equity_all",g,ceil); done++;
  }
  await log(`  PASS 22 (darkpool) done: ${SIGS22.length*4} specs`);
}

// ================= PASS 24 — DISAGGREGATED COT (D-507: producer vs managed-money, the cohort split) =================
// Same 26-market book and publication lag as PASS 16, but with the informed-cohort split the legacy report pools:
// producers/merchants (hedgers proper) and managed money (CTAs/trend). 2006->2026 weekly.
if(PASS==="all"||PASS==="cotdisagg"){
  type DgRow={report_date:string;oi:number;pm_l:number;pm_s:number;mm_l:number;mm_s:number};
  const MAP24:[string,number,string[]][]=[
    ["CL=F",1,["067651"]],["NG=F",1,["023651"]],["GC=F",1,["088691"]],["SI=F",1,["084691"]],
    ["HG=F",1,["085692"]],["PL=F",1,["076651"]],["PA=F",1,["075651"]],
    ["ZC=F",1,["002602"]],["ZW=F",1,["001602"]],["ZS=F",1,["005602"]],
    ["KC=F",1,["083731"]],["SB=F",1,["080732"]],["CC=F",1,["073732"]],["CT=F",1,["033661"]],
    ["LE=F",1,["057642"]],["HE=F",1,["054642"]],
    ["EURUSD=X",1,["099741"]],["GBPUSD=X",1,["096742"]],["AUDUSD=X",1,["232741"]],["NZDUSD=X",1,["112741"]],
    ["JPY=X",-1,["097741"]],["CAD=X",-1,["090741"]],["CHF=X",-1,["092741"]],["MXN=X",-1,["095741"]],
  ];
  const iso24=(ts:number)=>new Date(ts*1000).toISOString().slice(0,10);
  const plus24=(d:string,days:number)=>{const x=new Date(d+"T00:00:00Z");x.setUTCDate(x.getUTCDate()+days);return x.toISOString().slice(0,10);};
  const dg=new Map<string,{d:string;pm:number;mm:number}[]>();
  for(const [sym,_sg,codes] of MAP24){
    const rows2=await fetch(`${OWNED}/trd_cot_disagg?market_code=eq.${codes[0]}&select=report_date,oi,pm_l,pm_s,mm_l,mm_s&order=report_date&limit=3000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as DgRow[];
    dg.set(sym,rows2.filter(r=>r.oi>0).map(r=>({d:r.report_date,pm:(r.pm_l-r.pm_s)/r.oi,mm:(r.mm_l-r.mm_s)/r.oi})));
  }
  await log(`  cotdisagg: ${[...dg.values()].reduce((a,x)=>a+x.length,0).toLocaleString()} weekly reports, ${MAP24.length} markets`);
  const pct24=(a:{d:string;pm:number;mm:number}[],i:number,f:(x:{pm:number;mm:number})=>number)=>{
    if(i<52)return null; const lo=Math.max(0,i-156); const v=f(a[i]); let c=0,n=0;
    for(let q=lo;q<i;q++){n++;if(f(a[q])<=v)c++;} return n<52?null:c/n;};
  const SIGS24:[string,(pp:number,mp:number,thH:number,thL:number)=>number][]=[
    ["follow_producer",(pp,_mp,thH,thL)=>pp>=thH?1:pp<=thL?-1:0],
    ["fade_mmoney",(_pp,mp,thH,thL)=>mp<=thL?1:mp>=thH?-1:0],
    ["follow_mmoney",(_pp,mp,thH,thL)=>mp>=thH?1:mp<=thL?-1:0],
  ];
  for(const [signame,rule] of SIGS24) for(const [thH,thL] of [[0.8,0.2],[0.9,0.1]] as [number,number][]){
    const key=`cotdisagg|${signame}|${thH}`;
    const daily=new Map<string,{r:number;n:number}>(); let nMkt=0;
    for(const [sym,sg] of MAP24.map(m=>[m[0],m[1]] as [string,number])){
      const a=dg.get(sym)!; if(!a||a.length<60)continue;
      const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
      const bars=(rb[0]?.bars||[]).filter(b=>b[4]>0); if(bars.length<500)continue;
      nMkt++;
      const marks:{from:string;w:number}[]=[];
      for(let i=0;i<a.length;i++){
        const pp=pct24(a,i,x=>x.pm), mp=pct24(a,i,x=>x.mm);
        if(pp===null||mp===null)continue;
        marks.push({from:plus24(a[i].d,6),w:rule(pp,mp,thH,thL)});
      }
      if(marks.length<50)continue;
      let mi=-1,prevW=0;
      for(let i=0;i<bars.length-1;i++){
        const d=iso24(bars[i][0]);
        while(mi+1<marks.length&&marks[mi+1].from<=d)mi++;
        if(mi<0)continue;
        const w=marks[mi].w*sg;
        const r2=bars[i+1][4]/bars[i][4]-1;
        const fee=(w!==prevW)?10/1e4:0; prevW=w;
        const cur=daily.get(d)??daily.set(d,{r:0,n:0}).get(d)!;
        cur.r+=w*r2-fee; cur.n++;
      }
    }
    const moAgg=new Map<string,number>();
    for(const [d,v] of daily){ if(v.n<5)continue; moAgg.set(d.slice(0,7),(moAgg.get(d.slice(0,7))||0)+v.r/v.n); }
    const mos=[...moAgg.entries()].sort().map(x=>x[1]);
    if(mos.length<120){await record(key,"cotdisagg",{signame,thH,exec:"pub_lag6d"},"futures_cot",null,ceil);done++;continue;}
    const m=mean(mos),sd=sdv(mos)||1e-9,t=m/(sd/Math.sqrt(mos.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of mos){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*mos.length/4),b2=Math.floor((e+1)*mos.length/4);return mean(mos.slice(a2,b2));});
    const g:Gate={n_names:nMkt,n_periods:mos.length,gross_ann:m*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:nMkt>=20, g_effect:true, g_benchmark:m>0, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"cotdisagg",{signame,thH,exec:"pub_lag6d",markets:nMkt},"futures_cot",g,ceil); done++;
    await log(`    cotdisagg ${signame} th${thH}: mkts=${nMkt} n=${mos.length}mo net ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)} eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 24 (cotdisagg) done`);
}

// ================= PASS 23 — NON-RELIANCE EVENTS (D-506: 8-K Item 4.02 accounting red flag, 2004->) =================
// Event study via the annprem structure: names filing a 4.02 in the trailing month vs the rest of the panel.
// Pre-registered literature direction: NEGATIVE forward drift for filers. Filed date = public date (EDGAR same-day).
if(PASS==="all"||PASS==="nonreliance"){
  const ev4=new Map<string,string[]>(); let nE4=0;
  for(let off=0;;off+=10000){
    const p2=await fetch(`${OWNED}/trd_events_402?select=symbol,filed&order=filed&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p2)||!p2.length)break;
    for(const r of p2 as {symbol:string;filed:string}[]){(ev4.get(r.symbol)??ev4.set(r.symbol,[]).get(r.symbol)!).push(r.filed);nE4++;}
    if(p2.length<10000)break;
  }
  await log(`  nonreliance: ${nE4.toLocaleString()} 4.02 events, ${ev4.size} symbols`);
  const moEnd23=(mo:string)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);};
  const minus23=(d:string,days:number)=>{const x=new Date(d+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-days);return x.toISOString().slice(0,10);};
  for(const look of [35,95]){
    const key=`nonreliance|look${look}|h1`;
    const byMo=new Map<string,{flag:number[];rest:number[]}>();
    for(const r of eqPanel){
      const end=moEnd23(r.mo), a=ev4.get(r.sym);
      const flagged=a?a.some(d=>d<=end&&d>=minus23(end,look)):false;
      const b=byMo.get(r.mo)??byMo.set(r.mo,{flag:[],rest:[]}).get(r.mo)!;
      (flagged?b.flag:b.rest).push(r.fwd);
    }
    const diffs:number[]=[]; let sumF=0,nmo=0;
    for(const mo of [...byMo.keys()].sort()){
      const b=byMo.get(mo)!;
      if(b.flag.length<5||b.rest.length<100)continue;
      diffs.push(mean(b.flag)-mean(b.rest)-2*FEE_EQ/1e4);
      sumF+=b.flag.length; nmo++;
    }
    if(diffs.length<60){await record(key,"nonreliance",{look},"equity_all",null,ceil);done++;continue;}
    const m=mean(diffs),sd=sdv(diffs)||1e-9,t=m/(sd/Math.sqrt(diffs.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of diffs){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a2=Math.floor(e*diffs.length/4),b2=Math.floor((e+1)*diffs.length/4);return mean(diffs.slice(a2,b2));});
    const g:Gate={n_names:Math.round(sumF/Math.max(1,nmo)),n_periods:diffs.length,gross_ann:(m+2*FEE_EQ/1e4)*12,net_ann:m*12,
      sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:false /* few filers per month by nature — event class, count stated */,
      g_effect:Math.abs(m)>=2*FEE_EQ/1e4, g_benchmark:m<0 /* pre-registered NEGATIVE drift for filers */, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)).length>=3, eras:q4};
    await record(key,"nonreliance",{look},"equity_all",g,ceil); done++;
    await log(`    nonreliance look${look}: n=${diffs.length}mo avg-flagged ${Math.round(sumF/Math.max(1,nmo))} drift ${(m*12*100).toFixed(1)}%/yr t=${t.toFixed(2)} eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 23 (nonreliance) done`);
}













// ================= PASS 5 — CENTURY PANELS (Ken French: 49 industries, 100 size x B/M; 1926-2026) =================
// The one venue where a portfolio-t can clear a 5.3 ceiling honestly: ~1,200 INDEPENDENT months. Signals are the
// documented classics, applied cross-sectionally ACROSS portfolios (industry momentum, grid momentum/reversal). These
// portfolios are not directly tradable at stated cost — the family's fee model uses 20bp/side ETF-implementation drag,
// and the note records that implementation is via proxies. Survivor here means the PHENOMENON clears every gate at
// century scale; implementability is assessed per-survivor afterward.
if(PASS==="all"||PASS==="french"){
  const ff=await (async()=>{const out:{month:string;factor:string;ret:number}[]=[];
    for(let off=0;;off+=10000){
      const p2=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.ind49:*,factor.like.szbm100:*)&select=month,factor,ret&order=month&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(p2)||!p2.length)break; out.push(...p2); if(p2.length<10000)break;}
    return out;})();
  await log(`  french panel: ${ff.length.toLocaleString()} obs`);
  const bySeries=new Map<string,Map<string,number>>();
  for(const r of ff)(bySeries.get(r.factor)??bySeries.set(r.factor,new Map()).get(r.factor)!).set(r.month,+r.ret);
  const months=[...new Set(ff.map(r=>r.month))].sort();
  function xsecFrench(prefix:string,form:number,skip:number,dirMom:1|-1,k:number,hold:number,key:string,spec:unknown){
    const series=[...bySeries.entries()].filter(([f])=>f.startsWith(prefix));
    const rows:{mo:string;fwd:number;v:number}[]=[];
    for(let mi=form+skip;mi<months.length-hold;mi++){
      const mo=months[mi];
      for(const [,mmap] of series){
        let mom=1,ok=true;
        for(let q=mi-form-skip;q<mi-skip;q++){const r2=mmap.get(months[q]); if(r2==null){ok=false;break;} mom*=1+r2;}
        if(!ok)continue;
        let f=1;
        for(let h=1;h<=hold;h++){const r2=mmap.get(months[mi+h-1]); if(r2==null){ok=false;break;} f*=1+r2;}
        if(!ok)continue;
        rows.push({mo,fwd:f-1,v:dirMom*(mom-1)});
      }
    }
    const g=evalXsec(rows,40,k,12/hold,hold);       // 20bp/side ETF-proxy drag, round trip
    return record(key,"french",spec,prefix==="ind49:"?"industries_49":"szbm_100",g,ceil).then(()=>{done++;});
  }
  // fix the >=30-names floor for the 49-industry panel: evalXsec requires >=30/mo — 49 industries pass; grid passes.
  for(const prefix of ["ind49:","szbm100:"]) for(const form of [3,6,12]) for(const skip of [0,1]) for(const k of [3,5]) for(const hold of [1,3]){
    await xsecFrench(prefix,form,skip,1,k,hold,`french|${prefix.replace(":","")}|mom${form}_s${skip}|k${k}|h${hold}`,{prefix,form,skip,dir:"mom",k,hold});
  }
  // long-horizon reversal (documented: 36-60m, sign flips)
  for(const prefix of ["ind49:","szbm100:"]) for(const form of [36,60]) for(const k of [3,5]){
    await xsecFrench(prefix,form,12,-1,k,1,`french|${prefix.replace(":","")}|ltrev${form}|k${k}|h1`,{prefix,form,skip:12,dir:"ltrev",k,hold:1});
  }
  await log(`  PASS 5 (french) done`);
}

// ================= PASS 5b — THE CLASSIC DECILE PREMIA at century power (D-472b) =================
// French's pre-sorted characteristic deciles: momentum (1927->), short/long-term reversal, operating profitability,
// investment. The natural spec per panel is the extreme-decile long-short with the LITERATURE'S pre-registered side.
// ~760-1,190 INDEPENDENT months each — maximum honest power available anywhere. Implementation drag 5bp/month (factor-
// ETF-scale, stated); breadth-exempt by class (each leg is a diversified portfolio), benchmarked as self-financing L/S.
if(PASS==="all"||PASS==="frenchdec"){
  const ff2=await (async()=>{const out:{month:string;factor:string;ret:number}[]=[];
    for(let off=0;;off+=10000){
      const p2=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.mom10:*,factor.like.strev10:*,factor.like.ltrev10:*,factor.like.op10:*,factor.like.inv10:*,factor.like.szbm25:*,factor.like.ep10:*,factor.like.cfp10:*,factor.like.dp10:*,factor.like.ac10:*,factor.like.ni10:*,factor.like.var10:*,factor.like.resvar10:*,factor.like.beta10:*)&select=month,factor,ret&order=month&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(p2)||!p2.length)break; out.push(...p2); if(p2.length<10000)break;}
    return out;})();
  const byS=new Map<string,Map<string,number>>();
  for(const r of ff2)(byS.get(r.factor)??byS.set(r.factor,new Map()).get(r.factor)!).set(r.month,+r.ret);
  await log(`  frenchdec: ${ff2.length.toLocaleString()} obs, ${byS.size} series`);
  const pick=(prefix:string,side:"Lo"|"Hi")=>{
    // op/inv files carry MULTIPLE column sets (quintiles AND deciles): "Lo_20"... and "Lo_10"... The first version
    // required exactly one match and recorded both premia UNTESTED. Fix: prefer the DECILE set (_10) explicitly, fall
    // back to a unique match; ambiguity that survives is still recorded UNTESTED rather than guessed.
    const c=[...byS.keys()].filter(k=>k.startsWith(prefix+":")&&k.split(":")[1].startsWith(side));
    if(c.length===1)return byS.get(c[0])!;
    const dec=c.filter(k=>/_10$/.test(k));
    return dec.length===1?byS.get(dec[0])!:null;};
  // [panel, LONG side per the literature, label]
  const SPECS:[string,"Lo"|"Hi",string][]=[
    ["mom10","Hi","momentum 12-2 winners-losers"],
    ["strev10","Lo","short-term reversal (long past losers)"],
    ["ltrev10","Lo","long-term reversal (long 5y losers)"],
    ["op10","Hi","operating profitability"],
    ["inv10","Lo","investment (long conservative)"],
    // D-492: the remaining classic characteristic deciles, literature side pre-registered
    ["ep10","Hi","earnings/price (long cheap)"],
    ["cfp10","Hi","cashflow/price (long cheap)"],
    ["dp10","Hi","dividend/price (long high yield)"],
    ["ac10","Lo","accruals (long low accruals; Sloan 1996)"],
    ["ni10","Lo","net share issuance (long low issuance)"],
    ["var10","Lo","variance (long low vol; Ang et al)"],
    ["resvar10","Lo","residual variance (long low idio vol)"],
    ["beta10","Lo","beta (long low beta; naive BAB, not beta-neutral)"],
  ];
  const DRAG=0.0005;                                   // 5bp/month implementation drag, stated
  for(const [prefix,side,label] of SPECS){
    const L=pick(prefix,side), Sh=pick(prefix,side==="Hi"?"Lo":"Hi");
    const key=`frenchdec|${prefix}|${side}long|h1`;
    if(!L||!Sh){await record(key,"frenchdec",{prefix,side,label},"decile_panels",null,ceil);done++;continue;}
    const months2=[...L.keys()].filter(m=>Sh.has(m)).sort();
    const rets=months2.map(m=>L.get(m)!-Sh.get(m)!-DRAG);
    if(rets.length<120){await record(key,"frenchdec",{prefix,side,label},"decile_panels",null,ceil);done++;continue;}
    const m=mean(rets),sd=sdv(rets)||1e-9,t=m/(sd/Math.sqrt(rets.length));
    let cum=1,pk=1,dd=0,ruined=false;for(const x of rets){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
    const q4=[0,1,2,3].map(e=>{const a=Math.floor(e*rets.length/4),b2=Math.floor((e+1)*rets.length/4);return mean(rets.slice(a,b2));});
    const g:Gate={n_names:1,n_periods:rets.length,gross_ann:(m+DRAG)*12,net_ann:m*12,sharpe:(m/sd)*Math.sqrt(12),t,dd:dd*100,ruined,
      g_breadth:true /* each leg a diversified portfolio */, g_effect:Math.abs(m)>=DRAG, g_benchmark:m>0, g_liquid:true,
      g_era:q4.filter(x=>Math.sign(x)===Math.sign(m)&&m>0).length>=3, eras:q4};
    await record(key,"frenchdec",{prefix,side,label},"decile_panels",g,ceil); done++;
    await log(`    ${label.padEnd(40)} n=${rets.length}  net ${(m*12*100).toFixed(1)}%/yr  t=${t.toFixed(2)}  eras ${q4.map(x=>x>0?"+":"-").join("")}`);
  }
  await log(`  PASS 5b (frenchdec) done`);
}
if(trialRows.length){await fetch(`${OWNED}/trd_trial_counter?on_conflict=run_key`,{method:"POST",headers:{...hdr,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(trialRows)}).catch(()=>null);trialRows=[];}
const {N:N2,ceil:c2}=await ceiling();
await log(`\n==> XSEC_EQ pass done: ${done} specs, ${written} ledger rows. Ceiling ${ceil.toFixed(3)} -> ${c2.toFixed(3)} (N=${N2.toLocaleString()})`);
const surv=await fetch(`${OWNED}/trd_factory?survivor=eq.true&select=spec_key,portfolio_t,net_ann,n_names&order=portfolio_t.desc&limit=10`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
await log(`    SURVIVORS so far: ${Array.isArray(surv)?surv.length:0}`);
for(const s of (Array.isArray(surv)?surv:[])) await log(`      ${s.spec_key}  t=${s.portfolio_t}  net ${(+s.net_ann*100).toFixed(1)}%/yr  breadth ${s.n_names}`);
