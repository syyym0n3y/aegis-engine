#!/usr/bin/env -S deno run --allow-read
// crypto-universe-robust.ts (D-536) — THE PRINCIPLED ANSWER TO THE UNIVERSE LAW.
// D-535 showed the same idea prints SR 0.61-1.30 across five defensible universes with no criterion to choose among
// them. Choosing one is a decision dressed as a measurement. The alternative used everywhere else in statistics when
// a specification is not identified is MODEL AVERAGING: hold every defensible variant at equal weight and report the
// middle, accepting a lower number in exchange for not making an unjustifiable choice.
// This book is therefore the equal-weight average of the four available universe variants. It is by construction
// LOWER than the best variant and HIGHER than the worst — which is the point. Forward-registered; the in-sample number
// is descriptive only.
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const read=async(f:string,col:number)=>{
  try{const t=await Deno.readTextFile(f);
    return t.trim().split("\n").map(l=>{const p=l.split("\t");return +p[col];});}catch{return null;}};
const variants:[string,number[]|null][]=[
  ["all-contracts",   await read("/Users/ona/aegis-data/crypto_gbm_books_top0.tsv",1)],
  ["liquid-tercile",  await read("/Users/ona/aegis-data/crypto_gbm_books_top0.tsv",3)],
  ["fixed-top-100",   await read("/Users/ona/aegis-data/crypto_gbm_books_top100.tsv",1)],
  ["fixed-top-60",    await read("/Users/ona/aegis-data/crypto_gbm_books_top60.tsv",1)],
];
const ok=variants.filter(([,v])=>v&&v.length>500) as [string,number[]][];
if(ok.length<3){console.log(`!! only ${ok.length} variant streams available — run crypto-nonlinear.ts with TOPN=0,60,100 first`);Deno.exit(1);}
const L=Math.min(...ok.map(([,v])=>v.length));
const stat=(v:number[],label:string)=>{
  const m=mean(v),sd=sdv(v)||1e-9;
  let cum=1,pk=1,dd=0,ruined=false;
  for(const x of v){cum*=1+x;if(cum<=0){ruined=true;break;}pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
  console.log(`    ${label.padEnd(22)} ${(m*365*100).toFixed(1).padStart(7)}%/yr  SR ${((m/sd)*Math.sqrt(365)).toFixed(2).padStart(5)}  t ${(m/(sd/Math.sqrt(v.length))).toFixed(2).padStart(5)}  maxDD ${(ruined?"RUINED":(dd*100).toFixed(0)+"%").padStart(7)}  win ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}%`);
  return (m/sd)*Math.sqrt(365);};
console.log(`==> UNIVERSE-ROBUST CRYPTO BOOK (D-536) — equal-weight average of ${ok.length} defensible universes, ${L} days`);
const srs=ok.map(([n,v])=>stat(v.slice(-L),n));
const avg=Array.from({length:L},(_,i)=>mean(ok.map(([,v])=>v.slice(-L)[i])));
console.log(`    ${"-".repeat(76)}`);
const srAvg=stat(avg,"UNIVERSE-AVERAGED");
console.log(`\n    variant SR range ${Math.min(...srs).toFixed(2)} - ${Math.max(...srs).toFixed(2)} (${(Math.max(...srs)/Math.max(1e-9,Math.min(...srs))).toFixed(2)}x). Averaged SR ${srAvg.toFixed(2)}.`);
console.log(`    The averaged book is deliberately NOT the best variant. It is the number you can quote without having`);
console.log(`    made a choice you cannot justify — the Universe Law's constructive answer, not just its veto.`);
console.log(`    STILL below the 5.34 deflation ceiling; forward-registered, promoted to nothing.`);
