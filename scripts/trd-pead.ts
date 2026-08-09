#!/usr/bin/env -S deno run --allow-net
// trd-pead — post-earnings-announcement drift (D-215). SOURCED free+keyless: Nasdaq earnings-surprise (dateReported +
// consensus + actual + %surprise, last 4 quarters) × Yahoo prices. PEAD: stocks drift in the surprise DIRECTION for
// weeks after the report. Test = enter the day AFTER the report (skip the jump, capture the DRIFT), hold H days, long
// positive-surprise / short negative, vs RANDOM direction. Split by |surprise| tercile (bigger surprise → bigger drift
// = the PEAD signature). CAVEAT: Nasdaq gives only ~4 quarters → ~1yr era (2025-26); deeper needs a keyed feed.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
let seed=17; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const U="AAPL MSFT NVDA AMZN GOOGL META TSLA JPM XOM JNJ WMT PG HD UNH KO CVX MRK BAC COST ORCL AVGO LLY V MA PEP DIS NKE CAT GE BA AMD NFLX CRM ADBE QCOM TXN INTC CSCO PFE T VZ WFC GS MS C COP SLB LOW TGT DE UPS FDX MCD SBUX GILD AMGN BMY GM F UBER ABBV TMO ABT DHR ACN LIN NEE PM RTX HON UNP LMT SPGI GS BLK AXP CB MMC ISRG NOW INTU AMAT MU LRCX ADI KLAC SNPS CDNS PANW CRWD DDOG SHOP ABNB UBER PYPL SQ COIN ROKU RBLX PLTR SOFI DKNG CVNA W CCL NCLH AAL DAL UAL MAR HLT".split(" ");
async function surprises(sym:string){try{const r=await fetch(`https://api.nasdaq.com/api/company/${sym}/earnings-surprise`,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"}});const j=await r.json();const rows=j?.data?.earningsSurpriseTable?.rows||[];return rows.map((x:any)=>{const[m,d,y]=String(x.dateReported).split("/");return{date:`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`,sur:parseFloat(x.percentageSurprise)};}).filter((x:any)=>Number.isFinite(x.sur));}catch{return[];}}
async function prices(sym:string):Promise<{d:string;o:number;c:number}[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o=[];for(let i=0;i<t.length;i++){const O=q.open[i],c=q.close[i];if(c!=null&&Number.isFinite(c))o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O??c,c});}return o;}catch{return[];}}
const H1=20,H2=60,COST=(3/10000)*2;
type Ev={sur:number;r20:number;r60:number};
const evs:Ev[]=[];let nStocks=0;
for(const sym of U){const sr=await surprises(sym);if(!sr.length)continue;const px=await prices(sym);if(px.length<120)continue;nStocks++;
  const idx=new Map(px.map((x,i)=>[x.d,i]));
  for(const e of sr){let ei=idx.get(e.date);if(ei==null){const c=px.findIndex(x=>x.d>e.date);if(c>0)ei=c-1;}if(ei==null)continue;const entry=ei+1;if(entry>=px.length)continue;
    const p0=px[entry].o;const p20=px[Math.min(entry+H1,px.length-1)].c,p60=px[Math.min(entry+H2,px.length-1)].c;
    const dir=e.sur>0?1:-1;evs.push({sur:e.sur,r20:dir*(p20/p0-1)*100-COST*100,r60:dir*(p60/p0-1)*100-COST*100});}
}
function report(key:"r20"|"r60",label:string){const S=evs.map(e=>e[key]);const C:number[]=[];for(const e of evs){if(rnd()<1){const rd=rnd()<0.5?1:-1;C.push((rd/(e.sur>0?1:-1))*e[key]);}} // random-direction control
  const g=edgeVsRandom(S,C,2,30);console.log(`  ${label.padEnd(10)} n=${S.length}  drift ${(mean(S)>=0?"+":"")+mean(S).toFixed(3)}%  vsRand ${g.controlMean.toFixed(3)}  edge ${(g.edge>=0?"+":"")+g.edge.toFixed(3)}  t=${g.tStat.toFixed(2)}  ${g.passes&&g.setupMean>0?"✓ PEAD present":"✗"}`);}
console.log(`POST-EARNINGS-ANNOUNCEMENT DRIFT — ${nStocks} stocks, ${evs.length} events (Nasdaq surprise × Yahoo px, ~1yr era)\n`);
report("r20","20-day"); report("r60","60-day");
// tercile by |surprise|: PEAD signature = bigger surprise → bigger drift
const byAbs=[...evs].sort((a,b)=>Math.abs(a.sur)-Math.abs(b.sur));const t3=Math.floor(byAbs.length/3);
for(const[lab,slice]of [["small |surp|",byAbs.slice(0,t3)],["large |surp|",byAbs.slice(-t3)]] as const){
  const s20=slice.map(e=>e.r20);const t=mean(s20)/(sampleStd(s20)/Math.sqrt(s20.length));
  console.log(`  ${lab.padEnd(12)} 20d drift ${(mean(s20)>=0?"+":"")+mean(s20).toFixed(3)}%  t=${t.toFixed(2)}  (median |surprise| ${Math.abs(slice[Math.floor(slice.length/2)].sur).toFixed(1)}%)`);}
console.log(`\nPEAD signature = drift in surprise direction, LARGER for big surprises. CAVEAT: ~1yr era (Nasdaq depth); 20yr needs keyed feed.`);
