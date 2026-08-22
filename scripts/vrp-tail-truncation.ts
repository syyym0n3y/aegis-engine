#!/usr/bin/env -S deno run --allow-net --allow-env
// vrp-tail-truncation.ts (D-461) — the one question worth asking about the one thing that survived audit.
// D-454 confirmed the equity variance risk premium at a corrected t of 12.6 (down from a recorded 48.8, but still well
// clear of the deflated ceiling of 5.34). It is the ONLY back-catalogue claim to survive. D-404 also established why it
// is not a free lunch: harvesting it with SVXY returned 31.4%/yr at Sharpe 0.57 with maxDD -95.2% and **-83.0% in a
// SINGLE DAY** (2018-02-06). The premium is compensation for exactly that.
// The untested question — and the only one that matters for a premium this program has confirmed — is whether the TAIL
// can be structurally truncated while keeping enough of the premium to be worth holding. This program's own doctrine says
// risk management is the component with reliable positive expected value, so this is where that doctrine gets tested.
// Rules compared, each usable with only same-day-or-earlier information:
//   RAW            hold short-vol always (the D-404 baseline)
//   VIX-GATE       flat whenever VIX closed above a threshold yesterday (fear regime = stand aside)
//   TERM-GATE      flat whenever the VIX curve was inverted yesterday (VIX > its own 20d mean = stress)
//   VOL-TARGET     scale exposure by realised-vol target, capped at 1x (never levered up)
//   STOP           exit for N days after any single-day loss worse than X%
// Judged on: return, Sharpe, maxDD, and above all the WORST SINGLE DAY — which is the number that actually ends the trade.
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
async function yf(sym:string){
  const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=20y`;
  const j=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}}).then(r=>r.json()).catch(()=>null);
  const res=j?.chart?.result?.[0]; if(!res?.timestamp)return new Map<string,number>();
  const q=res.indicators.quote[0]; const m=new Map<string,number>();
  for(let i=0;i<res.timestamp.length;i++){const c=q.close[i]; if(c!=null&&Number.isFinite(c)) m.set(new Date(res.timestamp[i]*1000).toISOString().slice(0,10),c);}
  return m;
}
const svxy=await yf("SVXY"); await sleep(400);
const vix=await yf("^VIX");
if(svxy.size<500||vix.size<500){console.error(`!! insufficient data (SVXY ${svxy.size}, VIX ${vix.size}) — UNTESTED, not null`);Deno.exit(1);}
const days=[...svxy.keys()].filter(d=>vix.has(d)).sort();
console.log(`==> VRP TAIL TRUNCATION — SVXY ${days.length} common days ${days[0]} .. ${days[days.length-1]}`);
const ret:number[]=[], vx:number[]=[];
for(let i=1;i<days.length;i++){ const a=svxy.get(days[i])!, b=svxy.get(days[i-1])!;
  if(!(a>0)||!(b>0))continue; ret.push(a/b-1); vx.push(vix.get(days[i-1])!); }
const dts=days.slice(1);
// trailing 20d mean of VIX, using only prior data
const vxMA:number[]=[]; for(let i=0;i<vx.length;i++){ const w=vx.slice(Math.max(0,i-20),i); vxMA.push(w.length?mean(w):vx[i]); }
function run(name:string,pos:(i:number,hist:number[])=>number){
  const p:number[]=[]; const hist:number[]=[];
  for(let i=0;i<ret.length;i++){ const w=pos(i,hist); const r=w*ret[i]; p.push(r); hist.push(ret[i]); }
  const m=mean(p), sd=sdv(p)||1e-9;
  let cum=1,peak=1,dd=0; for(const r of p){cum*=1+r;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  const worst=Math.min(...p); const wi=p.indexOf(worst);
  const exposure=100*p.filter((_,i)=>pos(i,ret.slice(0,i))!==0).length/p.length;
  return {name,ann:m*252*100,sr:(m/sd)*Math.sqrt(252),dd:dd*100,worst:worst*100,worstDay:dts[wi],exp:exposure};
}
const results=[
  run("RAW (D-404 baseline)",()=>1),
  run("VIX-GATE >25",(i)=>vx[i]>25?0:1),
  run("VIX-GATE >20",(i)=>vx[i]>20?0:1),
  run("TERM-GATE (VIX>20dMA)",(i)=>vx[i]>vxMA[i]?0:1),
  run("VOL-TARGET 15% cap1x",(i,h)=>{const w=h.slice(-20); if(w.length<20)return 1; const rv=sdv(w)*Math.sqrt(252); return Math.min(1,0.15/(rv||1));}),
  run("STOP: flat 10d after a -8% day",(i,h)=>{for(let k=Math.max(0,h.length-10);k<h.length;k++) if(h[k]<-0.08) return 0; return 1;}),
];
console.log(`\n    ${"rule".padEnd(30)}${"ann %/yr".padEnd(11)}${"SR".padEnd(7)}${"maxDD".padEnd(10)}${"WORST DAY".padEnd(12)}${"on".padEnd(12)}exposure`);
for(const r of results)
  console.log(`    ${r.name.padEnd(30)}${r.ann.toFixed(1).padEnd(11)}${r.sr.toFixed(2).padEnd(7)}${(r.dd.toFixed(1)+"%").padEnd(10)}${(r.worst.toFixed(1)+"%").padEnd(12)}${r.worstDay.padEnd(12)}${r.exp.toFixed(0)}%`);
const raw=results[0];
console.log(`\n    The number that ends the trade is WORST DAY, not maxDD: a -83% day wipes a levered book before any drawdown`);
console.log(`    statistic has time to update. Baseline worst ${raw.worst.toFixed(1)}% on ${raw.worstDay}.`);
const best=results.slice(1).filter(r=>r.worst>raw.worst).sort((a,b)=>b.sr-a.sr)[0];
console.log(`    ${best?`Best rule that ALSO truncates the tail: ${best.name} — worst day ${best.worst.toFixed(1)}% vs ${raw.worst.toFixed(1)}%, SR ${best.sr.toFixed(2)} vs ${raw.sr.toFixed(2)}, ${best.exp.toFixed(0)}% invested.`:"NO rule truncated the tail — every gate was flat-footed on the day that mattered."}`);

// ============================================================================================================
// APPLYING MY OWN SELECTION LAW (D-456) TO MY OWN RESULT.
// The stop rule above was picked as the best of five, with its two parameters (-8% trigger, 10-day cooldown) chosen by me
// while looking at this data. That is exactly the in-sample selection the Selection Law forbids, and the result deserves
// no more credulity than D-405's "selective overlay" got. Worse: the rule's entire tail benefit rests on ONE event — its
// worst day is 2017-05-17, which means it happened to be FLAT on 2018-02-06. A tail rule validated on n=1 tail is not
// validated; it is a rule that worked once.
// Two checks that can distinguish structure from fitting:
//   (1) PARAMETER GRID — if the benefit survives across a wide range of (trigger, cooldown), the mechanism is real; if it
//       lives only at -8%/10d, it is a curve fit.
//   (2) TRAIN/TEST — choose the parameters on the first 60% and apply them, frozen, to the last 40%.
console.log(`\n    ==> PARAMETER GRID — is the stop STRUCTURAL, or fitted to -8%/10d?`);
console.log(`    ${"trigger".padEnd(10)}${[5,10,15,20].map(c=>`cool${c}d`.padEnd(13)).join("")}`);
const grid:{trig:number;cool:number;sr:number;worst:number;ann:number}[]=[];
for(const trig of [-0.05,-0.06,-0.08,-0.10,-0.12]){
  const cells:string[]=[];
  for(const cool of [5,10,15,20]){
    const r=run(`stop${trig}/${cool}`,(i,h)=>{for(let k=Math.max(0,h.length-cool);k<h.length;k++) if(h[k]<trig) return 0; return 1;});
    grid.push({trig,cool,sr:r.sr,worst:r.worst,ann:r.ann});
    cells.push(`SR${r.sr.toFixed(2)} w${r.worst.toFixed(0)}%`.padEnd(13));
  }
  console.log(`    ${(trig*100).toFixed(0)+"%"} ${" ".repeat(5)}${cells.join("")}`);
}
const rawR=results[0];
const better=grid.filter(g=>g.sr>rawR.sr&&g.worst>rawR.worst);
console.log(`\n    cells beating RAW on BOTH Sharpe and worst-day: ${better.length}/${grid.length}`);
console.log(`    worst-day range across the grid: ${Math.min(...grid.map(g=>g.worst)).toFixed(0)}% .. ${Math.max(...grid.map(g=>g.worst)).toFixed(0)}%  (RAW ${rawR.worst.toFixed(0)}%)`);
console.log(`    -> ${better.length>=grid.length*0.8?"STRUCTURAL: the benefit is not specific to the parameters I chose."
  :better.length>=grid.length*0.5?"MOSTLY structural, but parameter-sensitive — treat the specific numbers as illustrative."
  :"FITTED: the benefit lives only near the parameters I picked. Not evidence."}`);

// (2) TRAIN/TEST with the parameters FROZEN on train
const sp=Math.floor(ret.length*0.6);
console.log(`\n    ==> TRAIN/TEST — parameters chosen on the first 60%, frozen, applied to the last 40%`);
function sub(name:string,pos:(i:number,h:number[])=>number,from:number,to:number){
  const p:number[]=[]; for(let i=from;i<to;i++) p.push(pos(i,ret.slice(0,i))*ret[i]);
  const m=mean(p),sd=sdv(p)||1e-9; let cum=1,peak=1,dd=0;
  for(const r of p){cum*=1+r;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  return {name,ann:m*252*100,sr:(m/sd)*Math.sqrt(252),dd:dd*100,worst:Math.min(...p)*100};
}
let bestTrain={trig:-0.08,cool:10,sr:-9};
for(const trig of [-0.05,-0.06,-0.08,-0.10,-0.12]) for(const cool of [5,10,15,20]){
  const s=sub("t",(i,h)=>{for(let k=Math.max(0,h.length-cool);k<h.length;k++) if(h[k]<trig) return 0; return 1;},0,sp);
  if(s.sr>bestTrain.sr) bestTrain={trig,cool,sr:s.sr};
}
console.log(`    train picked: trigger ${(bestTrain.trig*100).toFixed(0)}%, cooldown ${bestTrain.cool}d (train SR ${bestTrain.sr.toFixed(2)})`);
const teRaw=sub("RAW",()=>1,sp,ret.length);
const teStop=sub("STOP",(i,h)=>{for(let k=Math.max(0,h.length-bestTrain.cool);k<h.length;k++) if(h[k]<bestTrain.trig) return 0; return 1;},sp,ret.length);
console.log(`    ${"TEST window".padEnd(14)}${"ann %/yr".padEnd(11)}${"SR".padEnd(8)}${"maxDD".padEnd(10)}worst day`);
for(const r of [teRaw,teStop]) console.log(`    ${r.name.padEnd(14)}${r.ann.toFixed(1).padEnd(11)}${r.sr.toFixed(2).padEnd(8)}${(r.dd.toFixed(1)+"%").padEnd(10)}${r.worst.toFixed(1)}%`);
console.log(`    -> OOS: the stop ${teStop.worst>teRaw.worst?`truncated the tail (${teStop.worst.toFixed(1)}% vs ${teRaw.worst.toFixed(1)}%)`:"did NOT truncate the tail"}, Sharpe ${teStop.sr>teRaw.sr?"improved":"fell"} ${teRaw.sr.toFixed(2)} -> ${teStop.sr.toFixed(2)}`);
