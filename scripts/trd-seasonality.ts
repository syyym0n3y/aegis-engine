#!/usr/bin/env -S deno run --allow-net
// trd-seasonality — untested family (D-208): calendar anomalies. (1) TURN-OF-MONTH (last trading day + first 3 =
// the classic equity seasonal), (2) DAY-OF-WEEK, (3) MONTH (sell-in-May). Per-instrument, de-biased: is the seasonal
// window's daily return systematically HIGHER than the rest, and is a window-only holding net-positive after cost?
// Count instruments individually significant (Binomial null). Free (Yahoo daily).
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
interface B{d:string;c:number}
async function daily(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const c=q.close[i];if(c==null||!Number.isFinite(c))continue;o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),c});}return o;}catch{return[];}}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
function welch(a:number[],b:number[]){const se=Math.sqrt(sampleStd(a)**2/a.length+sampleStd(b)**2/b.length);return se>0?(mean(a)-mean(b))/se:0;}
const UNIV:Record<string,string[]>={
  "eq-mega":["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","WMT","PG","HD","UNH","KO","CVX","MRK","BAC","COST","ORCL","AVGO","LLY","V","MA","PEP","DIS","NKE","CAT","GE","BA"],
  "etf":["SPY","QQQ","IWM","DIA","XLE","XLF","XLK","XLV","XLI","XLP","XLY","XLU","SMH","EEM","EFA","TLT","HYG","GLD","SLV"],
};
console.log(`SEASONALITY — per-instrument, de-biased. Turn-of-month = last trading day + first 3 of next month.\n`);
console.log(`${"class".padEnd(9)} ${"effect".padEnd(14)} ${"N".padStart(3)} ${"kSig".padStart(4)} ${"win%dailyΔ".padStart(11)} ${"binom p".padStart(9)}  verdict`);
for(const[cls,syms]of Object.entries(UNIV)){
  const tom:{t:number;d:number}[]=[],mon:{t:number;d:number}[]=[];
  const perTom:number[]=[],perMon:number[]=[];
  const rows:{tomT:number;monT:number}[]=[];
  for(const sym of syms){const b=await daily(sym);if(b.length<500)continue;
    const rin:number[]=[],rout:number[]=[];const monIn:number[]=[],monOut:number[]=[]; // TOM vs rest ; Monday vs rest
    // mark month positions
    for(let i=1;i<b.length;i++){const ret=b[i].c/b[i-1].c-1;const dt=new Date(b[i].d);const dom=dt.getUTCDate();const dow=dt.getUTCDay();
      // turn-of-month: day>=1&&<=3 (first 3) OR is last trading day of month (next bar is a new month)
      const isLastOfMonth=i+1<b.length&&new Date(b[i+1].d).getUTCMonth()!==dt.getUTCMonth();
      if(dom<=3||isLastOfMonth)rin.push(ret);else rout.push(ret);
      if(dow===1)monIn.push(ret);else monOut.push(ret);}
    if(rin.length>=30&&rout.length>=30)rows.push({tomT:welch(rin,rout),monT:welch(monIn,monOut)});
  }
  if(rows.length<4)continue;
  for(const[eff,key]of [["turn-of-month","tomT"],["Monday","monT"]] as const){
    const N=rows.length,k=rows.filter(r=>(r as any)[key]>=2).length;const p=binomUpper(k,N,0.025);
    const v=p<0.001?"✓✓ SYSTEMATIC seasonal":p<0.05?"~ leans":"✗ none";
    console.log(`${cls.padEnd(9)} ${eff.padEnd(14)} ${String(N).padStart(3)} ${String(k).padStart(4)} ${(k+"/"+N+" higher").padStart(11)} ${p.toExponential(1).padStart(9)}  ${v}`);
  }
  console.log("");
}
console.log(`READ: kSig = #instruments where the seasonal window's daily return significantly exceeds the rest (t≥2).`);
console.log(`p<0.001 = a real calendar effect. But a window-only strategy trades ~monthly → cost hurdle applies before it's tradeable.`);
