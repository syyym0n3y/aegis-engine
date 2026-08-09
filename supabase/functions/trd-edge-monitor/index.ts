// trd-edge-monitor — closes the "durable edges aren't monitored" gap (D-221). Live current-state of ALL 7 verified
// edges from free data: is each actionable NOW + its current metric. The broad edges (VRP/pairs/term-structure/
// XS-momentum) had no wiring; this is their live pulse. Runnable locally + deployed as an edge fn for the cockpit.
async function daily(sym:string,range="1y"){try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:{c:number,h:number,l:number}[]=[];for(let i=0;i<res.timestamp.length;i++){const c=q.close[i],h=q.high[i],l=q.low[i];if(c!=null&&Number.isFinite(c))o.push({c,h:h??c,l:l??c});}return o;}catch{return[];}}
const cl=(b:any[])=>b.map(x=>x.c);
function sma(a:number[],n:number){if(a.length<n)return NaN;return a.slice(-n).reduce((x,y)=>x+y,0)/n;}
function rsi(a:number[],n=14){if(a.length<n+1)return NaN;let ag=0,al=0;for(let i=a.length-n;i<a.length;i++){const ch=a[i]-a[i-1];ag+=Math.max(ch,0);al+=Math.max(-ch,0);}return 100-100/(1+(ag/n)/((al/n)||1e-9));}
function rvol(a:number[],n=21){if(a.length<n+1)return NaN;const r=[];for(let i=a.length-n;i<a.length;i++)r.push(Math.log(a[i]/a[i-1]));const m=r.reduce((x,y)=>x+y,0)/r.length;return Math.sqrt(r.reduce((s,x)=>s+(x-m)**2,0)/r.length)*Math.sqrt(252)*100;}

async function monitor(){
  const out:Record<string,unknown>={};
  // regime
  const spy=cl(await daily("SPY","2y"));const spyMA=sma(spy,200);const bull=spy.at(-1)!>spyMA;
  out.regime={spy:+spy.at(-1)!.toFixed(2),ma200:+spyMA.toFixed(2),state:bull?"BULL (SPY>200MA)":"BEAR (SPY<200MA)"};
  // 1) rip-short (narrow: US quality large-caps; fires in bull)
  const LC=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","AVGO","LLY","V"];
  let rs=0;for(const s of LC){const b=cl(await daily(s,"2y"));if(b.length<200)continue;if(rsi(b)>70&&b.at(-1)!<sma(b,200))rs++;}
  out.ripShort={actionable:bull&&rs>0,firing:rs,of:LC.length,note:bull?(rs?`${rs} large-caps overbought-in-downtrend`:"none firing"):"OFF — bear regime"};
  // 2) bbfade_lo/bear (fires in bear)
  out.bbfadeBear={actionable:!bull,note:bull?"OFF — needs SPY<200MA":"ON — scan lower-band longs"};
  // 3) crypto momentum (Donchian-20 breakout now)
  const COINS=["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","DOGE-USD","LTC-USD"];let cm=0;
  for(const s of COINS){const b=await daily(s,"3mo");if(b.length<25)continue;const c=cl(b);const hh=Math.max(...b.slice(-21,-1).map(x=>x.h));if(c.at(-1)!>hh)cm++;}
  out.cryptoMomentum={firing:cm,of:COINS.length,note:cm?`${cm} coins in 20-day breakout`:"no breakouts"};
  // 4) VRP (implied vs realized)
  const vix=cl(await daily("^VIX","3mo")).at(-1)!;const rv=rvol(cl(await daily("SPY","3mo")),21);
  out.vrp={vix:+vix.toFixed(1),realized21d:+rv.toFixed(1),premium:+(vix-rv).toFixed(1),rich:vix>rv,note:vix>rv?`implied rich by ${(vix-rv).toFixed(1)} vol-pts (sell-vol favourable)`:"implied cheap (rare — caution)"};
  // 5) pairs at |z|>2 now
  const PAIRS:[string,string][]=[["KO","PEP"],["V","MA"],["XOM","CVX"],["JPM","BAC"],["HD","LOW"],["GLD","SLV"],["QQQ","SPY"],["MSFT","AAPL"]];let diverged=[];
  for(const[a,bb]of PAIRS){const A=cl(await daily(a,"6mo")),B=cl(await daily(bb,"6mo"));const n=Math.min(A.length,B.length);if(n<80)continue;const sp:number[]=[];for(let i=n-60;i<n;i++)sp.push(Math.log(A[A.length-n+i])-Math.log(B[B.length-n+i]));const m=sp.reduce((x,y)=>x+y,0)/sp.length,sd=Math.sqrt(sp.reduce((s,x)=>s+(x-m)**2,0)/sp.length);const z=(sp.at(-1)!-m)/sd;if(Math.abs(z)>2)diverged.push(`${a}/${bb} z=${z.toFixed(1)}`);}
  out.pairs={diverged:diverged.length,which:diverged,note:diverged.length?`${diverged.length} pairs at |z|>2 (fade)`:"no pairs diverged >2σ"};
  // 6) term-structure (VIX vs VIX3M contango = short-vol roll favourable ; commodity USO/USL as backup)
  const vix3m=cl(await daily("^VIX3M","3mo")).at(-1)!;
  out.termStructure={vix:+vix.toFixed(1),vix3m:+vix3m.toFixed(1),contango:vix3m>vix,note:vix3m>vix?"vol curve in contango — short-vol roll favourable":"backwardation — roll unfavourable"};
  // 7) cross-sectional momentum: current top vs bottom of a liquid set by 12-1m return
  const MOM=["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","HD","AVGO","LLY","AMD","NFLX","CRM","BAC","CVX","COST"];const rets:{s:string;r:number}[]=[];
  for(const s of MOM){const b=cl(await daily(s,"2y"));if(b.length<260)continue;rets.push({s,r:b[b.length-21]/b[b.length-252]-1});}
  rets.sort((a,b)=>b.r-a.r);const q=Math.max(1,Math.floor(rets.length*0.2));
  out.crossSecMomentum={longWinners:rets.slice(0,q).map(x=>x.s),shortLosers:rets.slice(-q).map(x=>x.s),note:"long top / short bottom quintile (12-1m), market-neutral"};
  return out;
}
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{const gen=new Date().toISOString();const r=await monitor();
  // persist snapshot (append-only history; the 30-min cron feeds this so the cockpit reads a fresh cached state)
  const SB=Deno.env.get("SUPABASE_URL"),SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(SB&&SRK){await fetch(`${SB}/rest/v1/trd_edge_snapshot`,{method:"POST",headers:{apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({generated_at:gen,edges:r})}).catch(()=>{});}
  return new Response(JSON.stringify({ok:true,generated_at:gen,edges:r},null,2),{headers:cors});}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
