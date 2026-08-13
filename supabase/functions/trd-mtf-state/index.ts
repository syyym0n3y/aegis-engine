// trd-mtf-state — MULTI-TIMEFRAME / MULTI-SESSION market-state engine (D-281). Reads 1m→1d simultaneously for an
// instrument and produces a per-timeframe read (trend vs MA, momentum, opening-range status) + a CONFLUENCE score and
// a net DIRECTION BIAS. Purpose: context across every timeframe & session to inform which side, and to CONDITION the
// ORB edge (size up / gate entries when higher timeframes agree). This is analysis/decision-support + a data
// generator — it is NOT itself an asserted edge; whether the bias improves entries is measured separately vs-random.
// GET ?symbol=SPY  (or ?symbols=SPY,QQQ,XLK). Session/VIX context via ^VIX.
const TFS:[string,string,string][]=[["1m","1d","1m"],["5m","5d","5m"],["15m","5d","15m"],["30m","1mo","30m"],["60m","3mo","1h"],["1d","1y","1d"]];
interface Bar{t:number;h:number;l:number;c:number}
async function bars(sym:string,interval:string,range:string):Promise<Bar[]>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:Bar[]=[];
  for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({t:res.timestamp[i],h,l,c});}return o;}catch{return[];}}
function sma(a:number[],n:number){if(a.length<n)return NaN;let s=0;for(let i=a.length-n;i<a.length;i++)s+=a[i];return s/n;}
// per-timeframe read: trend (close vs SMA20), momentum (last-10-bar return), and a directional vote in [-1,1]
function readTF(b:Bar[]){if(b.length<21)return null;const c=b.map(x=>x.c);const last=c[c.length-1];const ma=sma(c,20);
  const mom=c[c.length-1]/c[Math.max(0,c.length-11)]-1;const trend=last>ma?1:-1;const md=mom>0?1:-1;
  const vote=trend===md?trend:0; // agreement of trend & momentum → conviction; disagreement → neutral
  return{trend:trend>0?"up":"down",mom:+(mom*100).toFixed(2),vote};}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const syms=(u.searchParams.get("symbols")||u.searchParams.get("symbol")||"SPY").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean).slice(0,20);
  const vix=await bars("^VIX","5d","1d");const vixLast=vix.length?vix[vix.length-1].c:null;
  const vlong=await bars("^VIX","1y","1d");const vsorted=vlong.map(x=>x.c).sort((a,b)=>a-b);const vp80=vsorted.length?vsorted[Math.floor(vsorted.length*0.8)]:null;
  const nowUTC=new Date();const utcMin=nowUTC.getUTCHours()*60+nowUTC.getUTCMinutes();
  const session=utcMin>=480&&utcMin<810?"london":utcMin>=810&&utcMin<870?"ny-open":utcMin>=870&&utcMin<1200?"ny-rth":utcMin>=1200&&utcMin<1320?"ny-close":"off/asia";
  const out=[];
  for(const sym of syms){
    const perTF:Record<string,unknown>={};let bias=0,votes=0;
    for(const [interval,range,label] of TFS){const b=await bars(sym,interval,range);const rd=readTF(b);if(rd){perTF[label]={trend:rd.trend,mom_pct:rd.mom,vote:rd.vote};bias+=rd.vote;if(rd.vote!==0)votes++;}}
    const tfCount=Object.keys(perTF).length;const confluence=tfCount?+(Math.abs(bias)/tfCount).toFixed(2):0;
    out.push({symbol:sym,direction_bias:bias>0?"LONG":bias<0?"SHORT":"NEUTRAL",bias_score:bias,confluence,aligned_tfs:`${votes}/${tfCount}`,by_timeframe:perTF});
  }
  return new Response(JSON.stringify({ok:true,session,vix:vixLast,vix_regime:vp80!=null&&vixLast!=null?(vixLast>=vp80?"elevated-fear":"calm"):null,instruments:out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
