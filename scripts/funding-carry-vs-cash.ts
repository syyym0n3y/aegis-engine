#!/usr/bin/env -S deno run --allow-net --allow-env
// funding-carry-vs-cash.ts (D-433) — completing the CARRY picture, and against the benchmark that actually decides it.
// D-409 found perp funding is systematically positive: mean 0.0017%/8h = 1.9%/yr gross, t=18.0. That was recorded as a
// "real finding". It was never compared with the RISK-FREE RATE. 1.9%/yr gross against ~4% in T-bills is NEGATIVE before a
// single fee is paid — the delta-neutral funding harvest ties up capital in exchange-custodied assets to underperform cash.
// (D-410's companion finding, funding-as-a-crowding-predictor, was retracted in D-415 as a pooling artifact. The carry
// itself was never re-examined. This does that.)
// Discipline: per-symbol (no pooling), per-era (never a pooled mean), net of both legs' fees amortised over the hold, and
// benchmarked against cash rather than against zero — the comparison that was missing.
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const FAPI="https://fapi.binance.com/fapi/v1";
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const RF=Number(Deno.env.get("RF_ANNUAL")||0.04);
const FEE_RT_BP=Number(Deno.env.get("FEE_RT_BP")||18);   // both legs, in and out
const HOLD_D=Number(Deno.env.get("HOLD_DAYS")||90);      // fees amortised over a quarter-long hold

const SYMS=(Deno.env.get("SYMS")||"BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,LINKUSDT,ADAUSDT").split(",");
console.log(`==> PERP FUNDING CARRY vs CASH — fees ${FEE_RT_BP}bp over a ${HOLD_D}d hold, risk-free ${(RF*100).toFixed(0)}%/yr`);
const feeAnn=(FEE_RT_BP/1e4)*(365/HOLD_D);
console.log(`    annualised fee drag ${(feeAnn*100).toFixed(2)}%/yr; a carry must clear ${((RF+feeAnn)*100).toFixed(2)}%/yr to beat doing nothing\n`);

const ERA=(d:string)=>{const y=+d.slice(0,4);return y<=2021?"2019-2021":y===2022?"2022":y<=2024?"2023-2024":"2025-2026";};
const ERAS=["2019-2021","2022","2023-2024","2025-2026","ALL"];
console.log(`    ${"symbol".padEnd(11)}${"era".padEnd(12)}${"gross %/yr".padEnd(12)}${"net vs cash".padEnd(13)}${"% intervals +".padEnd(15)}${"t(gross)".padEnd(10)}n`);
const verdicts:{sym:string;era:string;net:number}[]=[];
for(const sym of SYMS){
  const all:{d:string;r:number}[]=[];
  let start=Date.parse("2019-09-01T00:00:00Z");
  for(let g=0;g<60;g++){
    const j=await fetch(`${FAPI}/fundingRate?symbol=${sym}&startTime=${start}&limit=1000`).then(r=>r.json()).catch(()=>null);
    await sleep(120);
    if(!Array.isArray(j)||!j.length)break;
    for(const x of j as {fundingTime:number;fundingRate:string}[]){
      const r=Number(x.fundingRate); if(!Number.isFinite(r))continue;
      all.push({d:new Date(x.fundingTime).toISOString().slice(0,10),r});
    }
    const last=Number((j[j.length-1] as {fundingTime:number}).fundingTime);
    if(j.length<1000)break; start=last+1;
  }
  if(all.length<2000){console.log(`    ${sym.padEnd(11)}(only ${all.length} intervals — skipped)`);continue;}
  for(const e of ERAS){
    const g=(e==="ALL"?all:all.filter(x=>ERA(x.d)===e)).map(x=>x.r);
    if(g.length<200)continue;
    const perYr=mean(g)*3*365;                      // 3 funding payments per day
    const net=perYr-RF-feeAnn;
    const t=mean(g)/(sdv(g)/Math.sqrt(g.length));
    verdicts.push({sym,era:e,net});
    console.log(`    ${sym.padEnd(11)}${e.padEnd(12)}${(perYr*100).toFixed(2).padEnd(11)}%${((net)*100).toFixed(2).padEnd(12)}%${(100*g.filter(x=>x>0).length/g.length).toFixed(0).padEnd(14)}%${t.toFixed(1).padEnd(10)}${g.length}`);
  }
  console.log("");
}
// The verdict is not the pooled mean; it is how often the trade beat cash AT ALL, by symbol and era.
const beat=verdicts.filter(v=>v.era!=="ALL"&&v.net>0).length, tot=verdicts.filter(v=>v.era!=="ALL").length;
console.log(`    symbol-era cells where the funding harvest BEAT CASH after fees: ${beat}/${tot}`);
const recent=verdicts.filter(v=>v.era==="2025-2026");
console.log(`    in the CURRENT era (2025-2026): ${recent.filter(v=>v.net>0).length}/${recent.length} symbols beat cash` +
  (recent.length?`, best ${(Math.max(...recent.map(v=>v.net))*100).toFixed(2)}%/yr`:""));
console.log(`\n    Benchmarked against CASH, not zero — the comparison D-409 omitted. Exchange/counterparty risk is on top of`);
console.log(`    this and is not priced: the same trade was destroyed by LUNA/FTX in 2022.`);
