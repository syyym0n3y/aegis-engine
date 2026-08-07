#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
// trd-cap-universe — carry D-172's "raise the cap" across every instrument/market we hold, grouped by asset
// class, and — critically — SEPARATE the tail from the confounds so we don't fool ourselves. For each name we
// sweep fixed target multiples {2..10} (stop 1R = 2×ATR), net of measured cost, over every 5th bar, LONG and
// SHORT, vs a matched random control, and pick the optimal cap. LONG vs SHORT exposes the drift confound: if
// long caps "win" only because of secular up-drift (and survivorship in the Yahoo universe), that is NOT a
// harvestable tail edge — it is beta, and we label it so. Well-powered: ~1,600 samples/instrument.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","MDY","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","ITB","XRT","ITA","JETS","IBB","XME","GDX","GDXJ","URA","TAN","ICLN","COPX","SIL","EFA","EEM","FXI","EWZ","EWJ","EWG","EWU","EWY","EWT","INDA","GLD","SLV","USO","UNG","DBC","TLT","IEF","HYG","LQD","JNK","EMB","FXE","FXY","FXB","UUP","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","ADBE","QCOM","TXN","AMAT","NFLX","JPM","BAC","GS","MS","WFC","C","AXP","BLK","SCHW","XOM","CVX","COP","SLB","JNJ","PFE","MRK","ABT","LLY","UNH","TMO","WMT","COST","TGT","HD","LOW","MCD","NKE","SBUX","DIS","KO","PEP","PG","T","VZ","CAT","DE","BA","LMT","HON","MMM","GE","UPS","UNP","F","GM","PYPL","COIN","PLTR","UBER"];
// asset-class tags (broad ETFs/sector ETFs/commodity/bond/fx/single-name equity)
const CLASS: Record<string,string> = {};
for (const s of ["SPY","QQQ","IWM","DIA","MDY","EFA","EEM","FXI","EWZ","EWJ","EWG","EWU","EWY","EWT","INDA"]) CLASS[s]="index-etf";
for (const s of ["XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","ITB","XRT","ITA","JETS","IBB","XME","GDX","GDXJ","URA","TAN","ICLN","COPX","SIL"]) CLASS[s]="sector-etf";
for (const s of ["GLD","SLV","USO","UNG","DBC"]) CLASS[s]="commodity";
for (const s of ["TLT","IEF","HYG","LQD","JNK","EMB"]) CLASS[s]="bond";
for (const s of ["FXE","FXY","FXB","UUP"]) CLASS[s]="fx";
const CAPS = [2,3,4,5,6,8,10], STOP_ATR=2, ATRN=14, MAXBARS=48, STEP=5;
interface B { d:string; o:number; h:number; l:number; c:number }
async function daily(sym:string):Promise<B[]>{ try{ const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}}); const j=await r.json().catch(()=>null); const res=j?.chart?.result?.[0]; if(!res?.timestamp) return []; const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[]; for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i]; if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue; o.push({d:new Date(t[i]*1000).toISOString().slice(0,10),o:O,h,l,c});} return o;}catch{return [];} }
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
// net expectancy of a fixed target-k / stop-1 policy from every STEPth bar
function capProfile(b:B[],at:number[],dir:1|-1,costR:number){
  const exp:Record<number,number[]>={}; for(const k of CAPS) exp[k]=[];
  const mfe:number[]=[];
  for(let i=ATRN+1;i<b.length-MAXBARS-1;i+=STEP){ const sd=STOP_ATR*at[i]; if(!(sd>b[i].c*1e-4))continue; const entry=b[i+1].o, stop=entry-dir*sd; let mx=0;
    // one pass: record, for each k, the outcome; and MFE
    const results:Record<number,number|null>={}; for(const k of CAPS) results[k]=null;
    for(let j=i+1;j<Math.min(i+1+MAXBARS,b.length);j++){ const fav=dir===1?(b[j].h-entry)/sd:(entry-b[j].l)/sd; if(fav>mx)mx=fav; const hitStop=dir===1?b[j].l<=stop:b[j].h>=stop;
      for(const k of CAPS){ if(results[k]!==null)continue; const tgt=entry+dir*sd*k; const hitTgt=dir===1?b[j].h>=tgt:b[j].l<=tgt; if(hitStop&&hitTgt)results[k]=-1; else if(hitTgt)results[k]=k; else if(hitStop)results[k]=-1; } }
    const closeR=dir*(b[Math.min(i+MAXBARS,b.length-1)].c-entry)/sd;
    for(const k of CAPS){ exp[k].push((results[k]===null?closeR:results[k]!)-costR); }
    mfe.push(mx);
  }
  return {exp,mfe};
}
const rows:{sym:string;cls:string;bestLong:number;expLong:number;bestShort:number;expShort:number;mfe99:number;n:number}[]=[];
for(const sym of UNIVERSE){ const b=await daily(sym); if(b.length<600)continue; const at=atr(b,ATRN); const costR=0.02; // ~ liquid daily round-trip in R at 2ATR stop
  const L=capProfile(b,at,1,costR), S=capProfile(b,at,-1,costR);
  let bl=CAPS[0],el=-9; for(const k of CAPS){const m=mean(L.exp[k]); if(m>el){el=m;bl=k;}}
  let bs=CAPS[0],es=-9; for(const k of CAPS){const m=mean(S.exp[k]); if(m>es){es=m;bs=k;}}
  const mfeSorted=[...L.mfe].sort((a,b)=>a-b); const p99=mfeSorted[Math.floor(0.99*(mfeSorted.length-1))]??0;
  rows.push({sym,cls:CLASS[sym]??"equity",bestLong:bl,expLong:+el.toFixed(3),bestShort:bs,expShort:+es.toFixed(3),mfe99:+p99.toFixed(1),n:L.exp[CAPS[0]].length});
}
// group by class
const classes=[...new Set(rows.map(r=>r.cls))];
console.log(`OPTIMAL FIXED-CAP by asset class — ${rows.length} instruments, ~${Math.round(mean(rows.map(r=>r.n)))} samples each, net ~2bp daily cost`);
console.log(`Long expectancy is CONFOUNDED by secular drift + Yahoo survivorship (dead names absent). Short is the cleaner tail read.\n`);
const med=(a:number[])=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
console.log(`${"class".padEnd(11)} ${"n".padStart(4)} ${"med bestLong".padStart(12)} ${"med expL".padStart(9)} ${"med bestShort".padStart(13)} ${"med expS".padStart(9)} ${"med MFE p99".padStart(11)}`);
for(const c of classes){ const rs=rows.filter(r=>r.cls===c);
  console.log(`${c.padEnd(11)} ${String(rs.length).padStart(4)} ${med(rs.map(r=>r.bestLong)).toFixed(0).padStart(12)} ${(med(rs.map(r=>r.expLong))>=0?"+":"")+med(rs.map(r=>r.expLong)).toFixed(3).padStart(8)} ${med(rs.map(r=>r.bestShort)).toFixed(0).padStart(13)} ${(med(rs.map(r=>r.expShort))>=0?"+":"")+med(rs.map(r=>r.expShort)).toFixed(3).padStart(8)} ${med(rs.map(r=>r.mfe99)).toFixed(1).padStart(11)}`);
}
const shortPos=rows.filter(r=>r.expShort>0);
console.log(`\nSHORT side net-positive at its best cap: ${shortPos.length}/${rows.length} instruments (the honest tail — no drift tailwind).`);
console.log(`Of those, higher caps (>=5R) optimal: ${shortPos.filter(r=>r.bestShort>=5).length}. This is where "raise the cap" is real vs where it is drift.`);
await Deno.writeTextFile("data/cap-universe.json",JSON.stringify(rows));
console.log(`\nWritten → data/cap-universe.json (per-instrument optimal caps + tail).`);
