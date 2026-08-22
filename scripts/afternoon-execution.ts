#!/usr/bin/env -S deno run --allow-net --allow-env
// afternoon-execution.ts (D-448) — the question the whole candidate turns on, answered from data instead of asserted.
// D-447 established the 20:00-22:00 UTC window is genuinely special: rank #1 of 22 windows, 3.61sd above a typical one,
// drift-neutral excess 7.83bp with 14/14 symbols positive at t 10.92, positive in 3 of 4 eras. Against fees it is 0.87x
// at TAKER and 2.17x at MAKER. So it is not tradable by crossing the spread, and IS tradable by resting orders — if
// resting orders actually fill.
// Everything therefore depends on a question hourly bars cannot answer and I have so far only asserted: does the move
// accrue SMOOTHLY (a passive bid gets hit before the move happens) or as a JUMP at 20:00 (the passive bid never fills,
// and when it does it is because the move went the other way — adverse selection)?
// Measured on 5-minute bars:
//   FILL RATE  — placing a limit buy AT the 20:00 close, does price trade at or below it during the window?
//   CONDITIONAL RETURN — on the days it fills, what is the return from there to the 22:00 close? This is the number that
//                        matters: fills are not random, they happen on weak days, and that selection is the real cost.
//   PATH SHAPE — how much of the 2-hour move has happened by each 20-minute mark.
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const SYMS=(Deno.env.get("SYMS")||"BTCUSDT,ETHUSDT,SOLUSDT,DOGEUSDT").split(",");
const DAYS=Number(Deno.env.get("DAYS")||730);
console.log(`==> AFTERNOON EXECUTION — 5m bars, last ~${DAYS} days, ${SYMS.length} symbols`);
console.log(`    maker round trip 3.6bp | taker 9bp\n`);
for(const sym of SYMS){
  const bars:number[][]=[];
  let start=Date.now()-DAYS*86400000;
  for(let g=0;g<200;g++){
    const r=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=5m&startTime=${start}&limit=1500`).then(x=>x.json()).catch(()=>null);
    await sleep(200);
    if(!Array.isArray(r)||!r.length)break;
    for(const k of r as (string|number)[][]){const ts=Math.floor(Number(k[0])/1000);
      if(bars.length&&ts<=bars[bars.length-1][0])continue;
      bars.push([ts,+k[1],+k[2],+k[3],+k[4]]);}
    if(r.length<1500)break; start=Number((r[r.length-1] as (string|number)[])[0])+1;
  }
  if(bars.length<5000){console.log(`  ${sym}: only ${bars.length} bars — skipped`);continue;}
  // group into UTC days, keep 20:00-22:00
  const days=new Map<string,number[][]>();
  for(const b of bars){const dt=new Date(b[0]*1000); const h=dt.getUTCHours();
    if(h<20||h>=22)continue;
    const d=dt.toISOString().slice(0,10);
    (days.get(d)??days.set(d,[]).get(d)!).push(b);}
  const filled:number[]=[], unfilled:number[]=[], allRet:number[]=[];
  const path:number[][]=[[],[],[],[],[],[]];   // cumulative fraction of the move at each 20-min mark
  let nFill=0,nDay=0;
  for(const [,seq] of days){
    if(seq.length<20)continue;                 // need a near-complete 2h window (24 five-minute bars)
    seq.sort((a,b)=>a[0]-b[0]);
    const ref=seq[0][1];                       // the 20:00 OPEN is the reference a resting order would be placed at
    const close=seq[seq.length-1][4];
    if(!(ref>0)||!(close>0))continue;
    nDay++;
    const total=close/ref-1; allRet.push(total);
    // does price trade AT OR BELOW the reference at any point after the first bar? that is the passive fill.
    let fillIdx=-1;
    for(let i=1;i<seq.length;i++){ if(seq[i][3]<=ref){fillIdx=i;break;} }
    if(fillIdx>=0){ nFill++; filled.push(close/ref-1); } else unfilled.push(total);
    for(let m=0;m<6;m++){ const idx=Math.min(seq.length-1,Math.round((m+1)/6*(seq.length-1)));
      if(Math.abs(total)>1e-9) path[m].push((seq[idx][4]/ref-1)/total); }
  }
  if(nDay<200){console.log(`  ${sym}: only ${nDay} usable days (bars=${bars.length}) — SKIPPED, not silently dropped\n`);continue;}
  const fr=100*nFill/nDay;
  console.log(`  ${sym}  ${nDay} days`);
  console.log(`    passive fill rate at the 20:00 reference : ${fr.toFixed(0)}%`);
  console.log(`    return 20:00->22:00, ALL days            : ${(mean(allRet)*1e4).toFixed(2)}bp`);
  console.log(`    return on days the passive order FILLED  : ${(mean(filled)*1e4).toFixed(2)}bp  (t ${(mean(filled)/(sdv(filled)/Math.sqrt(filled.length))).toFixed(2)})`);
  console.log(`    return on days it did NOT fill           : ${unfilled.length?(mean(unfilled)*1e4).toFixed(2):"n/a"}bp   <- the move you MISS`);
  const sel=(mean(filled)-mean(allRet))*1e4;
  console.log(`    ADVERSE SELECTION cost                   : ${sel.toFixed(2)}bp (filled minus all-days)`);
  console.log(`    net at maker 3.6bp on filled days        : ${(mean(filled)*1e4-3.6).toFixed(2)}bp -> ${((mean(filled)*1e4-3.6)/3.6).toFixed(2)}x the fee`);
  console.log(`    path: fraction of the move done by 20/40/60/80/100/120min: ${path.map(p=>p.length?mean(p).toFixed(2):"-").join("  ")}`);
  console.log("");
}
console.log(`  A passive strategy earns the FILLED-days return, not the all-days return. If filling costs more than the`);
console.log(`  maker discount saves, the maker column in D-445/447 was a mirage and the window is untradable either way.`);
