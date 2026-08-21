#!/usr/bin/env -S deno run --allow-net --allow-env
// vix-term.ts (D-412) — VIX TERM STRUCTURE, the natural complement to D-404's volatility risk premium and a Tier-1 options
// gap. VIX (30d implied) vs VIX3M (93d implied): contango (VIX < VIX3M) = calm, roll-down pays short-vol; backwardation
// (VIX > VIX3M) = stress. Documented as both a regime indicator and a timing signal for vol exposure.
// D-404 established the VRP is real (t=48.8) but carries a -83% day. The question here: does TERM STRUCTURE tell you WHEN
// to harvest it — i.e. does conditioning on contango avoid the blowups? That is the risk-management question, which is where
// every surviving result in this program has landed.
const UA={"User-Agent":"Mozilla/5.0"};
const get=async(s:string)=>{const j=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:UA}).then(r=>r.json());
  const r=j?.chart?.result?.[0]; if(!r?.timestamp)return new Map<string,number>();
  const q=r.indicators.quote[0]; const m=new Map<string,number>();
  for(let i=0;i<r.timestamp.length;i++){const c=q.close[i]; if(c!=null&&Number.isFinite(c)) m.set(new Date(r.timestamp[i]*1000).toISOString().slice(0,10),c);} return m;};
const vix=await get("^VIX"), v3m=await get("^VIX3M"), spy=await get("SPY"), svxy=await get("SVXY");
console.log(`==> VIX TERM STRUCTURE — VIX ${vix.size}d, VIX3M ${v3m.size}d, SPY ${spy.size}d, SVXY ${svxy.size}d`);
const dates=[...vix.keys()].filter(d=>v3m.has(d)&&spy.has(d)).sort();
console.log(`    overlapping: ${dates.length} days (${dates[0]} .. ${dates[dates.length-1]})`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tst=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
// 1. does term structure predict the NEXT 21d realised-vol outcome and SPY return?
const obs:{d:string;ts:number;spyFwd:number;svxyFwd:number|null}[]=[];
for(let i=0;i<dates.length-21;i++){
  const d=dates[i]; const a=vix.get(d)!,b=v3m.get(d)!; if(!(a>0)||!(b>0))continue;
  const ts=a/b-1;                                        // >0 = backwardation (stress), <0 = contango (calm)
  const p0=spy.get(d)!,p1=spy.get(dates[i+21])!; if(!(p0>0))continue;
  const s0=svxy.get(d),s1=svxy.get(dates[i+21]);
  obs.push({d,ts,spyFwd:p1/p0-1,svxyFwd:(s0&&s1&&s0>0)?s1/s0-1:null});
}
console.log(`\n  1. FORWARD 21d RETURNS BY TERM-STRUCTURE STATE (n=${obs.length})`);
const srt=[...obs].map(o=>o.ts).sort((a,b)=>a-b);
const q=(f:number)=>srt[Math.floor(srt.length*f)];
const cuts=[q(0.2),q(0.4),q(0.6),q(0.8)];
const lab=["deep contango","contango","flat","mild backwardation","backwardation"];
for(let k=0;k<5;k++){
  const sel=obs.filter(o=>(k===0?o.ts<cuts[0]:k===4?o.ts>=cuts[3]:o.ts>=cuts[k-1]&&o.ts<cuts[k]));
  if(sel.length<50){console.log(`     ${lab[k].padEnd(20)}: thin`);continue;}
  const sp=sel.map(o=>o.spyFwd), sv=sel.filter(o=>o.svxyFwd!=null).map(o=>o.svxyFwd!);
  console.log(`     ${lab[k].padEnd(20)}: SPY ${(mean(sp)*100).toFixed(2)}% (t ${tst(sp).toFixed(2)})  SHORT-VOL(SVXY) ${sv.length>30?`${(mean(sv)*100).toFixed(2)}% (t ${tst(sv).toFixed(2)})`:"thin"}  n=${sel.length}`);
}
// 2. THE RISK QUESTION: does trading short-vol ONLY in contango avoid the catastrophic days?
const withSv=obs.filter(o=>o.svxyFwd!=null);
if(withSv.length>200){
  const all=withSv.map(o=>o.svxyFwd!), contango=withSv.filter(o=>o.ts<0).map(o=>o.svxyFwd!);
  const dd=(a:number[])=>{let c=1,p=1,d=0;for(const r of a){c*=1+r/21;p=Math.max(p,c);d=Math.min(d,c/p-1);}return d*100;};
  console.log(`\n  2. DOES CONTANGO-GATING AVOID THE BLOWUPS? (short-vol, overlapping 21d windows)`);
  console.log(`     ALWAYS short vol : mean ${(mean(all)*100).toFixed(2)}%/21d  worst ${(Math.min(...all)*100).toFixed(1)}%  n=${all.length}`);
  console.log(`     ONLY in contango : mean ${(mean(contango)*100).toFixed(2)}%/21d  worst ${(Math.min(...contango)*100).toFixed(1)}%  n=${contango.length}`);
  console.log(`     -> gating ${Math.min(...contango)>Math.min(...all)?"REDUCES":"does NOT reduce"} the worst outcome.`);
}
