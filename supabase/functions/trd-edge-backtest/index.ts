// trd-edge-backtest — the UNIFIED runner (D-263/D-265). Drives an edge through the SAME gauntlet as every other
// and emits ONE comparable, cost-net scorecard (composes the tested _shared cores via trd-harness). Each ?edge=
// reproduces the DEPLOYED executor geometry EXACTLY over MAX daily history, builds a matched random-entry control
// (D-146), MEASURES cost (Corwin-Schultz), bumps trd_trial_counter, stores trd_edge_scorecard.
//   bblo   — BB(20,2) lower-band fade long, 2ATR stop, +3R target        (DEMOTED D-264; kept for audit)
//   crypto — Donchian-20 breakout long, 2ATR stop, 20d-low trail exit    (trd-crypto-exec geometry)
//   vrp    — SVXY long while VIX3M>VIX (contango), exit on backwardation  (trd-vrp-exec geometry)
//   pairs  — spread z=logA−β·logB fade |z|>2, exit |z|<0.5               (trd-pairs-exec geometry)
// orbfollow is scored from trd_futures_orb_results (already vs-random on 4yr futures 1m) — see ?edge=orbfollow.
import { scoreEdge, type HarnessTrade } from "../_shared/trd-harness.ts";
import { corwinSchultzSpread, type Bar as CBar } from "../_shared/trd-cost.ts";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const EQUITY_UNIVERSE=["SPY","QQQ","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","V","UNH","HD","PG","KO"];
const CRYPTO=["BTC-USD","ETH-USD","SOL-USD","AVAX-USD","LTC-USD","BCH-USD","LINK-USD","UNI-USD","AAVE-USD","DOGE-USD","DOT-USD"];
const PAIRS:[string,string][]=[["KO","PEP"],["V","MA"],["XOM","CVX"],["JPM","BAC"],["GS","MS"],["HD","LOW"],["GOOGL","META"],["MSFT","AAPL"],["NVDA","AMD"],["UPS","FDX"],["WMT","TGT"],["CAT","DE"],["T","VZ"],["COP","SLB"],["DUK","SO"],["GLD","SLV"],["XLE","XOP"],["EEM","EFA"],["QQQ","SPY"],["USO","BNO"],["WFC","C"],["ADBE","CRM"],["PFE","MRK"],["NKE","LULU"]];
interface Bar{d:string;h:number;l:number;c:number}
function mulberry(s:number){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
async function daily(sym:string,full=true):Promise<Bar[]>{try{
  const q=full?`period1=0&period2=${Math.floor(Date.now()/1000)}`:"range=5y";
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&${q}`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];
  const qq=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=qq.high[i],l=qq.low[i],c=qq.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(res.timestamp[i]*1000).toISOString().slice(0,10),h,l,c});}
  return o;}catch{return[];}}
function atrArr(b:Bar[],n:number){const o=new Array(b.length).fill(NaN);let s=0;const tr:number[]=[];
  for(let i=0;i<b.length;i++){tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
const q4=(d:string)=>`${d.slice(0,4)}Q${Math.floor((+d.slice(5,7)-1)/3)+1}`;
// long bracket: risk=stopDist, +3R target
function bracketR(b:Bar[],i0:number,entry:number,stopDist:number):number|null{const stop=entry-stopDist,tgt=entry+3*stopDist;
  for(let k=i0+1;k<b.length;k++){if(b[k].l<=stop)return -1;if(b[k].h>=tgt)return 3;}return (b[b.length-1].c-entry)/stopDist;}
// long with a Donchian-DL trailing exit (crypto): exit when close < prior 20d low; R in units of 2ATR
function trailR(b:Bar[],i0:number,entry:number,stopDist:number,DL:number):number|null{
  for(let k=i0+1;k<b.length;k++){let lo=Infinity;for(let j=Math.max(0,k-DL);j<k;j++)lo=Math.min(lo,b[j].l);if(b[k].c<lo)return (b[k].c-entry)/stopDist;}
  return (b[b.length-1].c-entry)/stopDist;}

function genBblo(b:Bar[],seed:number){const setup:HarnessTrade[]=[],ctrl:HarnessTrade[]=[];if(b.length<60)return{setup,ctrl};
  const a=atrArr(b,14),rnd=mulberry(seed),N=20;let openUntil=-1;
  for(let i=N;i<b.length-1;i++){const win=b.slice(i-N+1,i+1).map(x=>x.c);const m=win.reduce((s,x)=>s+x,0)/N;const sd=Math.sqrt(win.reduce((s,x)=>s+(x-m)**2,0)/N);const lower=m-2*sd;
    if(!(a[i]>0))continue;if(b[i].c<lower&&i>openUntil){const entry=b[i].c,sdist=2*a[i],r=bracketR(b,i,entry,sdist);if(r==null)continue;
      setup.push({r,stopFrac:sdist/entry,period:q4(b[i].d)});const ri=N+Math.floor(rnd()*(b.length-1-N));if(a[ri]>0){const re=b[ri].c,rsd=2*a[ri],rr=bracketR(b,ri,re,rsd);if(rr!=null)ctrl.push({r:rr,stopFrac:rsd/re,period:q4(b[i].d)});}openUntil=i+10;}}
  return{setup,ctrl};}
function genCrypto(b:Bar[],seed:number){const setup:HarnessTrade[]=[],ctrl:HarnessTrade[]=[];if(b.length<60)return{setup,ctrl};
  const a=atrArr(b,14),rnd=mulberry(seed),DON=20;let openUntil=-1;
  for(let i=DON;i<b.length-1;i++){let hh=-Infinity;for(let j=i-DON;j<i;j++)hh=Math.max(hh,b[j].h);
    if(!(a[i]>0))continue;if(b[i].c>hh&&i>openUntil){const entry=b[i].c,sdist=2*a[i],r=trailR(b,i,entry,sdist,DON);if(r==null)continue;
      setup.push({r,stopFrac:sdist/entry,period:q4(b[i].d)});const ri=DON+Math.floor(rnd()*(b.length-1-DON));if(a[ri]>0){const re=b[ri].c,rsd=2*a[ri],rr=trailR(b,ri,re,rsd,DON);if(rr!=null)ctrl.push({r:rr,stopFrac:rsd/re,period:q4(b[i].d)});}openUntil=i+5;}}
  return{setup,ctrl};}
// vrp: long SVXY while VIX3M>VIX (contango); exit when VIX3M<=VIX (backwardation). Setup vs random SVXY entry.
function genVrp(svxy:Bar[],vix:Map<string,number>,vix3m:Map<string,number>,seed:number){const setup:HarnessTrade[]=[],ctrl:HarnessTrade[]=[];
  const a=atrArr(svxy,14),rnd=mulberry(seed);let inpos=false,entry=0,ei=0,sdist=0,pd="";
  const contango=(d:string)=>{const v=vix.get(d),v3=vix3m.get(d);return v!=null&&v3!=null?v3>v:null;};
  for(let i=20;i<svxy.length-1;i++){const d=svxy[i].d,ct=contango(d);if(ct==null||!(a[i]>0))continue;
    if(!inpos&&ct){inpos=true;entry=svxy[i].c;ei=i;sdist=2*a[i];pd=q4(d);}
    else if(inpos&&!ct){const r=(svxy[i].c-entry)/sdist;setup.push({r,stopFrac:sdist/entry,period:pd});
      // matched random control: random entry, held the SAME number of bars
      const hold=i-ei;const ri=20+Math.floor(rnd()*(svxy.length-1-20-hold));if(a[ri]>0){const rr=(svxy[Math.min(svxy.length-1,ri+hold)].c-svxy[ri].c)/(2*a[ri]);ctrl.push({r:rr,stopFrac:2*a[ri]/svxy[ri].c,period:pd});}
      inpos=false;}}
  return{setup,ctrl};}
// pairs: spread s=logA−β·logB, rolling-60 OLS+z. Fade |z|>2 (short spread if z>0), exit |z|<0.5 / stop |z|>3.5 /
// maxhold 28. R = z captured toward 0 / (stop 3.5−2=1.5). Control = enter at a RANDOM day's z with same exit rules.
function genPairs(A:Bar[],B:Bar[],seed:number){const setup:HarnessTrade[]=[],ctrl:HarnessTrade[]=[];
  const ma=new Map(A.map(x=>[x.d,x.c])),mb=new Map(B.map(x=>[x.d,x.c]));const ds=[...ma.keys()].filter(d=>mb.has(d)).sort();
  const W=60;if(ds.length<W+40)return{setup,ctrl};const la=ds.map(d=>Math.log(ma.get(d)!)),lb=ds.map(d=>Math.log(mb.get(d)!));const rnd=mulberry(seed);
  const zAt=(i:number)=>{if(i<W)return null;let sx=0,sy=0,sxx=0,sxy=0;for(let k=i-W;k<i;k++){sx+=lb[k];sy+=la[k];sxx+=lb[k]*lb[k];sxy+=lb[k]*la[k];}const beta=(W*sxy-sx*sy)/(W*sxx-sx*sx||1e-9);const spr:number[]=[];for(let k=i-W;k<=i;k++)spr.push(la[k]-beta*lb[k]);const m=spr.slice(0,W).reduce((x,y)=>x+y,0)/W;let v=0;for(let k=0;k<W;k++)v+=(spr[k]-m)**2;const sd=Math.sqrt(v/W)||1e-9;return (spr[W]-m)/sd;};
  const run=(startFn:(i:number)=>boolean,into:HarnessTrade[])=>{let openUntil=-1;
    for(let i=W;i<ds.length-1;i++){const z=zAt(i);if(z==null)continue;if(i<=openUntil)continue;
      if(startFn(i)){const dir=z>0?-1:1;const z0=z;let exitZ=z0,held=0;
        for(let k=i+1;k<ds.length&&held<28;k++,held++){const zk=zAt(k);if(zk==null)break;exitZ=zk;if(Math.abs(zk)<0.5||Math.abs(zk)>3.5)break;}
        // R = (|z0|−|exitZ|) signed toward mean, in units of 1.5 (the 2→3.5 stop room)
        const captured=(Math.abs(z0)-Math.abs(exitZ))*Math.sign(z0)*dir; // positive if reverted toward 0
        into.push({r:captured/1.5,stopFrac:0.01,period:q4(ds[i])});openUntil=i+held;}}};
  run((i)=>{const z=zAt(i)!;return Math.abs(z)>=2&&Math.abs(z)<3.5;},setup);          // the real setup
  run((i)=>rnd()<0.03,ctrl);                                                           // random-day entries, same exit logic
  return{setup,ctrl};}

async function vixMaps(){const v=await daily("^VIX",false),v3=await daily("^VIX3M",false);
  return[new Map(v.map(x=>[x.d,x.c])),new Map(v3.map(x=>[x.d,x.c]))] as const;}

Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const edge=new URL(req.url).searchParams.get("edge")||"bblo";
  // orbfollow is scored directly from the futures vs-random results (already 4yr, matched random, split-half OOS)
  if(edge==="orbfollow"){
    const rows=await fetch(`${SB}/rest/v1/trd_futures_orb_results?mode=eq.follow&win=eq.cash_open&select=edge_r,mean_r,win_pct,n,period`,{headers:H}).then(r=>r.json()).catch(()=>[]);
    const E=(rows as {edge_r:number,mean_r:number,win_pct:number,n:number,period:string}[]).filter(r=>Number.isFinite(r.edge_r));
    if(E.length<10)return new Response(JSON.stringify({ok:false,err:"no futures cash_open follow rows"}),{headers:cors});
    const m=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length,edges=E.map(r=>r.edge_r);
    const mean=m(edges),sd=Math.sqrt(m(edges.map(x=>(x-mean)**2))*E.length/(E.length-1)),t=mean/(sd/Math.sqrt(E.length));
    const h1=E.filter(r=>r.period<"2025").map(r=>r.edge_r),h2=E.filter(r=>r.period>="2025").map(r=>r.edge_r);
    const row={edge:"orbfollow",run_at:new Date().toISOString(),n:E.reduce((s,r)=>s+r.n,0),n_trials:1,
      abs_r:+m(E.map(r=>r.mean_r)).toFixed(4),cost_r:null,net_r:null,cost_bps:null,
      vs_random_edge:+mean.toFixed(4),vs_random_t:+t.toFixed(2),vs_random_passes:t>=2,
      deflated_sharpe:null,sharpe:null,max_dd:null,min_trl:null,
      oos_h1:+m(h1).toFixed(4),oos_h2:+m(h2).toFixed(4),holds_both:m(h1)>0&&m(h2)>0,
      gate_passed:t>=2&&m(h1)>0&&m(h2)>0,gate_failing:t>=2?[]:["vs_random_t<2"],
      detail:{source:"trd_futures_orb_results cash_open follow (4yr futures 1m, matched random control)",cells:E.length}};
    await fetch(`${SB}/rest/v1/trd_edge_scorecard?on_conflict=edge`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)}).catch(()=>{});
    return new Response(JSON.stringify({ok:true,scorecard:row},null,2),{headers:cors});
  }

  const setup:HarnessTrade[]=[],ctrl:HarnessTrade[]=[];const spreads:number[]=[];let spanLo="9999",spanHi="0",bars=0;
  if(edge==="bblo"||edge==="crypto"){
    const uni=edge==="bblo"?EQUITY_UNIVERSE:CRYPTO;const gen=edge==="bblo"?genBblo:genCrypto;
    const series=await Promise.all(uni.map(s=>daily(s)));
    series.forEach((b,idx)=>{if(b.length<60)return;bars+=b.length;spanLo=b[0].d<spanLo?b[0].d:spanLo;spanHi=b[b.length-1].d>spanHi?b[b.length-1].d:spanHi;
      const g=gen(b,idx*7919+13);setup.push(...g.setup);ctrl.push(...g.ctrl);
      const sp=corwinSchultzSpread(b.slice(-500) as CBar[]);if(Number.isFinite(sp)&&sp>0)spreads.push(sp);});
  } else if(edge==="vrp"){
    const [svxy,[vix,vix3m]]=await Promise.all([daily("SVXY",false),vixMaps()]);
    if(svxy.length<60)return new Response(JSON.stringify({ok:false,err:"no SVXY"}),{headers:cors});
    bars=svxy.length;spanLo=svxy[0].d;spanHi=svxy[svxy.length-1].d;const g=genVrp(svxy,vix,vix3m,101);setup.push(...g.setup);ctrl.push(...g.ctrl);
    const sp=corwinSchultzSpread(svxy.slice(-500) as CBar[]);if(Number.isFinite(sp)&&sp>0)spreads.push(sp);
  } else if(edge==="pairs"){
    const need=[...new Set(PAIRS.flat())];const bm=new Map((await Promise.all(need.map(async s=>[s,await daily(s,false)] as const))));
    for(const [a,b] of PAIRS){const A=bm.get(a)!,B=bm.get(b)!;if(!A?.length||!B?.length)continue;bars+=A.length+B.length;
      spanLo=A[0].d<spanLo?A[0].d:spanLo;spanHi=A[A.length-1].d>spanHi?A[A.length-1].d:spanHi;
      const g=genPairs(A,B,(a.length+b.length)*131+7);setup.push(...g.setup);ctrl.push(...g.ctrl);
      const sp=corwinSchultzSpread(A.slice(-500) as CBar[]);if(Number.isFinite(sp)&&sp>0)spreads.push(sp);}
  } else return new Response(JSON.stringify({ok:false,err:`unknown edge ${edge}`}),{status:400,headers:cors});

  if(setup.length<30)return new Response(JSON.stringify({ok:false,edge,err:`too few trades (${setup.length})`}),{headers:cors});
  const medSpread=spreads.length?spreads.sort((a,b)=>a-b)[Math.floor(spreads.length/2)]:0.0005;
  const legMult=edge==="pairs"?2:1; // pairs pays round-trip cost on BOTH legs
  const costBps=Math.max(5,medSpread*1e4*1.5*legMult);
  const runKey=`edge-backtest:${edge}:${new Date().toISOString().slice(0,13)}`;
  await fetch(`${SB}/rest/v1/trd_trial_counter`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({family:`edge-backtest:${edge}`,run_key:runKey})}).catch(()=>{});
  const trials=await fetch(`${SB}/rest/v1/trd_trial_counter?family=eq.edge-backtest:${edge}&select=id`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const nTrials=Math.max(1,Array.isArray(trials)?trials.length:1);
  const sc=scoreEdge(edge,setup,ctrl,{costBps,nTrials,benchmarkSharpe:0.5});
  const row={edge:sc.edge,run_at:new Date().toISOString(),n:sc.n,n_trials:sc.nTrials,abs_r:sc.absR,cost_r:sc.costR,net_r:sc.netR,cost_bps:+costBps.toFixed(2),
    vs_random_edge:sc.vsRandomEdge,vs_random_t:sc.vsRandomT,vs_random_passes:sc.vsRandomPasses,
    deflated_sharpe:sc.deflatedSharpe,sharpe:sc.sharpe,max_dd:sc.maxDrawdown,min_trl:Number.isFinite(sc.minTRL)?sc.minTRL:null,
    oos_h1:Number.isFinite(sc.oosH1)?sc.oosH1:null,oos_h2:Number.isFinite(sc.oosH2)?sc.oosH2:null,holds_both:sc.holdsBoth,
    gate_passed:sc.gatePassed,gate_failing:sc.gateFailing,detail:{control_n:ctrl.length,span:`${spanLo}→${spanHi}`,bars,vs_random_verdict:sc.vsRandomVerdict}};
  await fetch(`${SB}/rest/v1/trd_edge_scorecard?on_conflict=edge`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)}).catch(()=>{});
  return new Response(JSON.stringify({ok:true,scorecard:row},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
