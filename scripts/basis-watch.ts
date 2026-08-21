#!/usr/bin/env -S deno run --allow-net --allow-env
// basis-watch.ts (D-432) — a LIVE WATCH, not a backtest. DORMANT: it surfaces, it never trades.
// D-431 found the quarterly basis carry is real, capacity-rich, requires no forecast — and has been competed down from
// +13%/yr net (2021) to +0.3%/yr (2025-2026). It is not dead, it is CONDITIONAL: net carry last exceeded 5%/yr on
// 2025-02-02. A research verdict of "it decayed" would file that away and never notice when it returns. This checks the
// live term structure every day and says plainly whether the condition is met right now.
// Reads Binance directly (allowlisted, free) rather than the stored history, so it reflects the market, not our ingest lag.
const FAPI="https://fapi.binance.com/fapi/v1";
const FEE_RT_BP=Number(Deno.env.get("BASIS_FEE_RT_BP")||18);
const RF=Number(Deno.env.get("RF_ANNUAL")||0.04);
const HURDLE=Number(Deno.env.get("BASIS_HURDLE")||0.05);   // net carry that would make the trade worth its unmodelled risks

const info=await fetch(`${FAPI}/exchangeInfo`).then(r=>r.json()).catch(()=>null) as {symbols?:{symbol:string;contractType?:string;deliveryDate?:number;pair?:string}[]}|null;
if(!info?.symbols){console.error("!! exchangeInfo unavailable — reporting UNKNOWN, not zero");Deno.exit(1);}
const dated=info.symbols.filter(s=>s.contractType==="CURRENT_QUARTER"||s.contractType==="NEXT_QUARTER");
console.log(`==> BASIS WATCH (DORMANT) — hurdle ${(HURDLE*100).toFixed(0)}%/yr net of ${FEE_RT_BP}bp fees and ${(RF*100).toFixed(0)}% opportunity cost`);
let fire=0;
for(const base of ["BTCUSDT","ETHUSDT"]){
  const spotArr=await fetch(`${FAPI}/ticker/price?symbol=${base}`).then(r=>r.json()).catch(()=>null) as {price?:string}|null;
  const spot=Number(spotArr?.price);
  if(!(spot>0)){console.log(`  ${base}: perp price unavailable — UNKNOWN`);continue;}
  for(const c of dated.filter(d=>d.pair===base||d.symbol.startsWith(base+"_"))){
    const f=await fetch(`${FAPI}/ticker/price?symbol=${c.symbol}`).then(r=>r.json()).catch(()=>null) as {price?:string}|null;
    const fut=Number(f?.price); if(!(fut>0))continue;
    const days=((c.deliveryDate||0)-Date.now())/86400000;
    if(days<5)continue;
    const ann=(fut/spot-1)*365/days;
    const net=ann-(FEE_RT_BP/1e4)*(365/Math.max(1,days))-RF;
    const hit=net>HURDLE; if(hit)fire++;
    console.log(`  ${hit?"FIRE":"    "} ${c.symbol.padEnd(16)} ${days.toFixed(0).padStart(3)}d  gross ${(ann*100).toFixed(1).padStart(6)}%/yr  net ${(net*100).toFixed(1).padStart(6)}%/yr  ${hit?"<- condition MET":""}`);
  }
}
// FUNDING LEG. The quarterly basis and the perp funding rate are the same structural trade at two maturities, and D-433
// showed they have decayed in lockstep (both were worth +25-30%/yr in 2021 and are ~0 vs cash now). A watch that saw only
// one of them would miss the other returning first, so both are reported side by side against the same cash benchmark.
console.log(`\n  --- perp funding carry (short perp / long spot), trailing 30d annualised vs cash ---`);
for(const base of ["BTCUSDT","ETHUSDT","SOLUSDT","LINKUSDT"]){
  const j=await fetch(`${FAPI}/fundingRate?symbol=${base}&limit=90`).then(r=>r.json()).catch(()=>null);
  if(!Array.isArray(j)||!j.length){console.log(`  ${base}: funding unavailable — UNKNOWN`);continue;}
  const rates=(j as {fundingRate:string}[]).map(x=>Number(x.fundingRate)).filter(Number.isFinite);
  if(!rates.length)continue;
  const ann=(rates.reduce((s,x)=>s+x,0)/rates.length)*3*365;
  const net=ann-RF-(FEE_RT_BP/1e4)*(365/90);
  const hit=net>HURDLE; if(hit)fire++;
  console.log(`  ${hit?"FIRE":"    "} ${base.padEnd(16)} 30d  gross ${(ann*100).toFixed(1).padStart(6)}%/yr  net ${(net*100).toFixed(1).padStart(6)}%/yr  ${hit?"<- condition MET":""}`);
}
console.log(`\n  ${fire?`${fire} contract(s) meet the condition. STILL DORMANT — surfacing only; nothing is armed and no order path exists.`
  :"Neither carry meets the condition. Correct action: hold cash. (Basis last cleared 5%/yr on 2025-02-02; funding beat cash for only 1 of 8 symbols in 2025-2026, by 0.12%/yr.)"}`);
console.log(`  Unmodelled and material: exchange/counterparty risk (this trade was destroyed by FTX in 2022), margin calls`);
console.log(`  on the short leg during a squeeze, settlement/withdrawal risk. Clearing the hurdle is necessary, not sufficient.`);
