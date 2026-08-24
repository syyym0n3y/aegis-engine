#!/usr/bin/env -S deno run --allow-read
// crypto-final-spec.ts (D-540) — THE FROZEN CANDIDATE, every choice made by a LAW rather than by performance.
//   model    = LINEAR composite      <- D-539: at tradable lag the GBM adds t 1.76 (null). Parsimony wins ties; fewer
//                                       researcher degrees of freedom (no depth/lr/n_trees) is itself robustness.
//   execution= LAG 1 bar             <- D-498 same-bar corollary: a close-derived signal may not act on that close.
//   hold     = 5 days                <- D-537/538 CAPACITY: ~$100M vs ~$5M at daily turnover, with Sharpe FLAT across
//                                       the 1/3/5/10 grid (1.18-1.23), so this is a capacity choice, not a return pick.
//   universe = equal-weight average  <- D-535 Universe Law: no criterion selects among defensible universes, so average.
//   fees     = 9bp round trip taker  <- no passive-fill assumption, so the Execution Law's fill study does not apply.
// The in-sample number below is DESCRIPTIVE. The forward clock is the test.
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const read=async(f:string,col:number)=>{try{const t=await Deno.readTextFile(f);
  return t.trim().split("\n").map(l=>{const p=l.split("\t");return +p[col];}).filter(Number.isFinite);}catch{return null;}};
const LIN=5;                                                      // column index of linHold in the dump
const vs:[string,number[]|null][]=[
  ["all-contracts", await read("/Users/ona/aegis-data/crypto_books_1dSF_top0_lag1_hold5.tsv",LIN)],
  ["fixed-top-100", await read("/Users/ona/aegis-data/crypto_books_1dSF_top100_lag1_hold5.tsv",LIN)],
  ["fixed-top-60",  await read("/Users/ona/aegis-data/crypto_books_1dSF_top60_lag1_hold5.tsv",LIN)],
];
const ok=vs.filter(([,v])=>v&&v.length>500) as [string,number[]][];
if(ok.length<2){console.log(`!! need at least 2 universe streams; have ${ok.length}`);Deno.exit(1);}
const L=Math.min(...ok.map(([,v])=>v.length));
const stat=(v:number[],label:string)=>{
  const m=mean(v),sd=sdv(v)||1e-9;
  let cum=1,pk=1,dd=0,ruined=false;
  for(const x of v){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
  console.log(`    ${label.padEnd(24)} ${(m*365*100).toFixed(1).padStart(7)}%/yr  SR ${((m/sd)*Math.sqrt(365)).toFixed(2).padStart(5)}  t ${(m/(sd/Math.sqrt(v.length))).toFixed(2).padStart(5)}  maxDD ${(ruined?"RUINED":(dd*100).toFixed(0)+"%").padStart(7)}  daily-win ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}%`);
  return (m/sd)*Math.sqrt(365);};
console.log(`==> FROZEN CANDIDATE (D-540): LINEAR · LAG-1 · 5-DAY HOLD · UNIVERSE-AVERAGED — ${L} OOS days`);
const srs=ok.map(([n,v])=>stat(v.slice(-L),n));
const avg=Array.from({length:L},(_,i)=>mean(ok.map(([,v])=>v.slice(-L)[i])));
console.log(`    ${"-".repeat(84)}`);
const srA=stat(avg,"FROZEN (averaged)");
console.log(`\n    universe sensitivity: SR ${Math.min(...srs).toFixed(2)}-${Math.max(...srs).toFixed(2)} (${(Math.max(...srs)/Math.max(1e-9,Math.min(...srs))).toFixed(2)}x) across ${ok.length} definitions; averaged ${srA.toFixed(2)}`);
console.log(`    deflation ceiling 5.34 — this is BELOW it. Frozen 2026-08-24; promoted to nothing; forward clock is the test.`);
