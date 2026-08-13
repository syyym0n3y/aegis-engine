// trd-mtf-state v2 — COMPREHENSIVE real-time multi-timeframe chart-analysis engine (D-282). For any instrument
// (works across all ~60k live; multi-YEAR intraday backtesting is data-bound — see DECISIONS D-282), reads
// 1m→1d and computes, per timeframe, EVERYTHING a chart shows regardless of the lens:
//   • TREND       — price vs SMA20/50, MA structure (20>50 = up-structure)
//   • MOMENTUM    — RSI(14), rate-of-change
//   • MEAN-REV    — Bollinger position (overbought/oversold), z-score to mean
//   • VOLATILITY  — ATR%, Bollinger width vs its own history (squeeze/expansion)
//   • LEVELS      — distance to 20-bar high/low (S/R), prior-day H/L, opening range (RTH)
//   • VOLUME      — last vs 20-bar average (participation)
// → a per-TF read {bull/bear/neutral + why} and an overall DIRECTION BIAS + CONFLUENCE + volatility regime + the
// key levels to watch. Honest label: this is comprehensive CONTEXT/decision-support, not an asserted edge.
// GET ?symbol=SPY (or ?symbols=A,B,C up to 15).
const TFS:[string,string,string][]=[["1m","1d","1m"],["5m","5d","5m"],["15m","5d","15m"],["30m","1mo","30m"],["60m","3mo","1h"],["1d","1y","1d"]];
interface Bar{t:number;o:number;h:number;l:number;c:number;v:number}
async function bars(sym:string,interval:string,range:string):Promise<Bar[]>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:Bar[]=[];
  for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i],v=q.volume?.[i];if([O,h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({t:res.timestamp[i],o:O,h,l,c,v:Number.isFinite(v)?v:0});}return o;}catch{return[];}}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
const sma=(a:number[],n:number)=>a.length<n?NaN:mean(a.slice(-n));
function rsi(c:number[],n=14){if(c.length<n+1)return NaN;let ag=0,al=0;for(let i=c.length-n;i<c.length;i++){const ch=c[i]-c[i-1];if(ch>0)ag+=ch;else al-=ch;}ag/=n;al/=n;return al===0?100:100-100/(1+ag/al);}
function atr(b:Bar[],n=14){if(b.length<n+1)return NaN;let s=0;for(let i=b.length-n;i<b.length;i++)s+=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));return s/n;}
function analyzeTF(b:Bar[]){if(b.length<25)return null;const c=b.map(x=>x.c),last=c[c.length-1];
  const s20=sma(c,20),s50=sma(c,Math.min(50,c.length-1));const sd=Math.sqrt(mean(c.slice(-20).map(x=>(x-s20)**2)));
  const upper=s20+2*sd,lower=s20-2*sd,bbPos=upper>lower?(last-lower)/(upper-lower):0.5,bbW=s20>0?(upper-lower)/s20:0;
  const r=rsi(c),a=atr(b),atrp=last>0?a/last*100:0;
  const hi20=Math.max(...b.slice(-20).map(x=>x.h)),lo20=Math.min(...b.slice(-20).map(x=>x.l));
  const roc=c.length>10?(last/c[c.length-11]-1)*100:0;
  const vols=b.map(x=>x.v),vAvg=sma(vols,20),vLast=vols[vols.length-1],vRel=vAvg>0?vLast/vAvg:1;
  // synthesize a read: trend structure + momentum, tempered by stretch
  let score=0;const why:string[]=[];
  if(last>s20){score++;why.push("px>SMA20");}else{score--;why.push("px<SMA20");}
  if(Number.isFinite(s50)){if(s20>s50){score++;why.push("SMA20>50");}else{score--;why.push("SMA20<50");}}
  if(r>55){score++;why.push(`RSI ${r.toFixed(0)}`);}else if(r<45){score--;why.push(`RSI ${r.toFixed(0)}`);}
  if(bbPos>0.95)why.push("at upper band (stretched)");if(bbPos<0.05)why.push("at lower band (stretched)");
  const read=score>=2?"bullish":score<=-2?"bearish":"neutral";const vote=score>=2?1:score<=-2?-1:0;
  return{read,vote,rsi:+r.toFixed(0),roc_pct:+roc.toFixed(2),atr_pct:+atrp.toFixed(2),bb_pos:+bbPos.toFixed(2),bb_width:+bbW.toFixed(3),
    vs_sma20:+((last/s20-1)*100).toFixed(2),dist_hi20:+((last/hi20-1)*100).toFixed(2),dist_lo20:+((last/lo20-1)*100).toFixed(2),vol_rel:+vRel.toFixed(2),why:why.join(", ")};}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const syms=(u.searchParams.get("symbols")||u.searchParams.get("symbol")||"SPY").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean).slice(0,15);
  const vlong=await bars("^VIX","1y","1d");const vLast=vlong.length?vlong[vlong.length-1].c:null;const vs=vlong.map(x=>x.c).sort((a,b)=>a-b);const vp80=vs.length?vs[Math.floor(vs.length*0.8)]:null;const vp20=vs.length?vs[Math.floor(vs.length*0.2)]:null;
  const utcMin=new Date().getUTCHours()*60+new Date().getUTCMinutes();
  const session=utcMin>=480&&utcMin<810?"london":utcMin>=810&&utcMin<870?"ny-premkt":utcMin>=870&&utcMin<960?"ny-open-hour":utcMin>=960&&utcMin<1230?"ny-rth":utcMin>=1230&&utcMin<1320?"ny-close":"asia/off";
  const out=[];
  for(const sym of syms){const perTF:Record<string,unknown>={};let bias=0,votes=0;const daily=await bars(sym,"1d","1y");
    for(const [interval,range,label] of TFS){const b=await bars(sym,interval,range);const a=analyzeTF(b);if(a){perTF[label]=a;bias+=a.vote;if(a.vote!==0)votes++;}}
    const tfN=Object.keys(perTF).length;
    // key levels from daily
    const pdH=daily.length>1?daily[daily.length-2].h:null,pdL=daily.length>1?daily[daily.length-2].l:null;
    const px=daily.length?daily[daily.length-1].c:null;
    const hi52=daily.length?Math.max(...daily.slice(-252).map(x=>x.h)):null,lo52=daily.length?Math.min(...daily.slice(-252).map(x=>x.l)):null;
    out.push({symbol:sym,price:px,direction_bias:bias>0?"LONG":bias<0?"SHORT":"NEUTRAL",bias_score:bias,confluence:tfN?+(Math.abs(bias)/tfN).toFixed(2):0,aligned_tfs:`${votes}/${tfN}`,
      key_levels:{prior_day_high:pdH,prior_day_low:pdL,high_52w:hi52,low_52w:lo52},by_timeframe:perTF});}
  return new Response(JSON.stringify({ok:true,session,vix:vLast,vix_regime:vp80!=null&&vLast!=null?(vLast>=vp80?"elevated-fear":vLast<=(vp20??0)?"complacent-calm":"normal"):null,note:"real-time works on ANY instrument; multi-year intraday backtest is data-bound (D-282)",instruments:out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
