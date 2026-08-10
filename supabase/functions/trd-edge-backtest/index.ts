// trd-edge-backtest — the UNIFIED runner (D-263). Drives an edge through the SAME gauntlet as every other edge
// and emits ONE comparable, cost-net scorecard. Composes the tested cores (trd-harness → cost + edgeVsRandom +
// evaluateStrategy + gate). ?edge=bblo pulls MAX daily history for a liquid universe, reproduces the executor
// geometry EXACTLY (BB(20,2) lower-band fade long, stop 2ATR = 1R, target +3R), builds a matched random-entry
// control per D-146, MEASURES cost with Corwin-Schultz spread, bumps trd_trial_counter, stores trd_edge_scorecard.
// Structured so other edges plug in as generators. Offline stats are the tested _shared core — this only wires data.
import { scoreEdge, type HarnessTrade } from "../_shared/trd-harness.ts";
import { corwinSchultzSpread, type Bar as CBar } from "../_shared/trd-cost.ts";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const UNIVERSE=["SPY","QQQ","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","V","UNH","HD","PG","KO"];
interface Bar{d:string;h:number;l:number;c:number}
function mulberry(s:number){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
async function daily(sym:string):Promise<Bar[]>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({d:new Date(res.timestamp[i]*1000).toISOString().slice(0,10),h,l,c});}
  return o;}catch{return[];}}
function atr(b:Bar[],n:number){const o=new Array(b.length).fill(NaN);let s=0;const tr:number[]=[];
  for(let i=0;i<b.length;i++){tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
// realized R for a long bracket (risk=stopDist, target=+3R) from bar i0+1 forward
function bracketR(b:Bar[],i0:number,entry:number,stopDist:number):number|null{const stop=entry-stopDist,tgt=entry+3*stopDist;
  for(let k=i0+1;k<b.length;k++){if(b[k].l<=stop)return -1;if(b[k].h>=tgt)return 3;}
  const last=b[b.length-1].c;return (last-entry)/stopDist;}
// bblo generator: BB(20,2) lower-band fade long; returns setup + matched random-entry control trades
function genBblo(b:Bar[],seed:number):{setup:HarnessTrade[],ctrl:HarnessTrade[]}{
  const setup:HarnessTrade[]=[],ctrl:HarnessTrade[]=[];if(b.length<60)return{setup,ctrl};
  const a=atr(b,14);const rnd=mulberry(seed);const N=20;
  let openUntil=-1;
  for(let i=N;i<b.length-1;i++){
    const win=b.slice(i-N+1,i+1).map(x=>x.c);const m=win.reduce((s,x)=>s+x,0)/N;
    const sd=Math.sqrt(win.reduce((s,x)=>s+(x-m)**2,0)/N);const lower=m-2*sd;
    if(!(a[i]>0))continue;
    if(b[i].c<lower&&i>openUntil){
      const entry=b[i].c,stopDist=2*a[i];const r=bracketR(b,i,entry,stopDist);if(r==null)continue;
      const period=`${b[i].d.slice(0,4)}Q${Math.floor((+b[i].d.slice(5,7)-1)/3)+1}`;
      setup.push({r,stopFrac:stopDist/entry,period});
      // matched random control: random day, same 2ATR-at-that-day geometry, same instrument
      const ri=N+Math.floor(rnd()*(b.length-1-N));if(a[ri]>0){const re=b[ri].c,rsd=2*a[ri];const rr=bracketR(b,ri,re,rsd);if(rr!=null)ctrl.push({r:rr,stopFrac:rsd/re,period});}
      // hold-out: don't re-enter until this trade would have resolved (approx: skip 10 bars)
      openUntil=i+10;
    }
  }
  return{setup,ctrl};
}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const edge=new URL(req.url).searchParams.get("edge")||"bblo";
  if(edge!=="bblo")return new Response(JSON.stringify({ok:false,err:"only edge=bblo implemented in v1 (others plug in as generators)"}),{status:400,headers:cors});
  const setup:HarnessTrade[]=[],ctrl:HarnessTrade[]=[];const spreads:number[]=[];let spanLo="9999",spanHi="0",bars=0;
  const results=await Promise.all(UNIVERSE.map(s=>daily(s)));
  results.forEach((b,idx)=>{if(b.length<60)return;bars+=b.length;spanLo=b[0].d<spanLo?b[0].d:spanLo;spanHi=b[b.length-1].d>spanHi?b[b.length-1].d:spanHi;
    const g=genBblo(b,idx*7919+13);setup.push(...g.setup);ctrl.push(...g.ctrl);
    const sp=corwinSchultzSpread(b.slice(-500) as CBar[]);if(Number.isFinite(sp)&&sp>0)spreads.push(sp);});
  if(setup.length<30)return new Response(JSON.stringify({ok:false,err:`too few trades (${setup.length})`}),{headers:cors});
  // MEASURED round-trip cost from RECENT clean bars only (full unadjusted history has split-day H/L jumps that
  // blow up Corwin-Schultz). medSpread = median proportional spread across the universe (last 500 bars each).
  // Round-trip ≈ one full spread (half in, half out) + 50% slippage cushion (pessimistic). Floored at 5bps.
  const medSpread=spreads.length?spreads.sort((a,b)=>a-b)[Math.floor(spreads.length/2)]:0.0005;
  const costBps=Math.max(5, medSpread*1e4*1.5);
  // bump the trial counter (append-only) and read N for this family
  const runKey=`edge-backtest:${edge}:${new Date().toISOString().slice(0,13)}`;
  await fetch(`${SB}/rest/v1/trd_trial_counter`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({family:`edge-backtest:${edge}`,run_key:runKey})}).catch(()=>{});
  const trials=await fetch(`${SB}/rest/v1/trd_trial_counter?family=eq.edge-backtest:${edge}&select=id`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const nTrials=Math.max(1,Array.isArray(trials)?trials.length:1);
  const sc=scoreEdge(edge,setup,ctrl,{costBps,nTrials,benchmarkSharpe:0.5});
  const row={edge:sc.edge,run_at:new Date().toISOString(),n:sc.n,n_trials:sc.nTrials,abs_r:sc.absR,cost_r:sc.costR,net_r:sc.netR,cost_bps:+costBps.toFixed(2),
    vs_random_edge:sc.vsRandomEdge,vs_random_t:sc.vsRandomT,vs_random_passes:sc.vsRandomPasses,
    deflated_sharpe:sc.deflatedSharpe,sharpe:sc.sharpe,max_dd:sc.maxDrawdown,min_trl:Number.isFinite(sc.minTRL)?sc.minTRL:null,
    oos_h1:Number.isFinite(sc.oosH1)?sc.oosH1:null,oos_h2:Number.isFinite(sc.oosH2)?sc.oosH2:null,holds_both:sc.holdsBoth,
    gate_passed:sc.gatePassed,gate_failing:sc.gateFailing,detail:{universe:UNIVERSE.length,control_n:ctrl.length,span:`${spanLo}→${spanHi}`,bars,vs_random_verdict:sc.vsRandomVerdict}};
  await fetch(`${SB}/rest/v1/trd_edge_scorecard?on_conflict=edge`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)}).catch(()=>{});
  return new Response(JSON.stringify({ok:true,scorecard:row},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
