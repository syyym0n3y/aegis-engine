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
if(PASS0==="all"||PASS0==="eq"||PASS0==="pairs"||PASS0==="insider"||PASS0==="shortside"){ await loadFund(); await loadFTD(); await buildEqPanel(); }
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
    const strat:number[]=[],bh:number[]=[],hist:number[]=[]; let prev=0,switches=0;
    for(let i=401;i<c.length-1;i++){
      const w=rule.pos(c,i,hist);
      const r=c[i+1]/c[i]-1; hist.push(r);
      if(w!==prev){switches++;prev=w;}
      strat.push(w*r-(w!==prev?0:0)-(switches&&w!==prev?0:0)); bh.push(r);
    }
    // fee: 10bp per switch, charged on the switch day
    let sw=0,prev2=0; const net:number[]=[];
    {let hist2:number[]=[];
     for(let i=401;i<c.length-1;i++){const w=rule.pos(c,i,hist2);const r=c[i+1]/c[i]-1;hist2.push(r);
       net.push(w*r-(w!==prev2?10/1e4:0)); if(w!==prev2){sw++;prev2=w;}}}
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
    await record(key,"timing",{inst,rule:rule.name,switches:sw},"single",gate,ceil); done++;
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
      const p2=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.mom10:*,factor.like.strev10:*,factor.like.ltrev10:*,factor.like.op10:*,factor.like.inv10:*,factor.like.szbm25:*)&select=month,factor,ret&order=month&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
      if(!Array.isArray(p2)||!p2.length)break; out.push(...p2); if(p2.length<10000)break;}
    return out;})();
  const byS=new Map<string,Map<string,number>>();
  for(const r of ff2)(byS.get(r.factor)??byS.set(r.factor,new Map()).get(r.factor)!).set(r.month,+r.ret);
  await log(`  frenchdec: ${ff2.length.toLocaleString()} obs, ${byS.size} series`);
  const pick=(prefix:string,side:"Lo"|"Hi")=>{
    const c=[...byS.keys()].filter(k=>k.startsWith(prefix+":")&&k.split(":")[1].startsWith(side));
    return c.length===1?byS.get(c[0])!:null;};
  // [panel, LONG side per the literature, label]
  const SPECS:[string,"Lo"|"Hi",string][]=[
    ["mom10","Hi","momentum 12-2 winners-losers"],
    ["strev10","Lo","short-term reversal (long past losers)"],
    ["ltrev10","Lo","long-term reversal (long 5y losers)"],
    ["op10","Hi","operating profitability"],
    ["inv10","Lo","investment (long conservative)"],
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
