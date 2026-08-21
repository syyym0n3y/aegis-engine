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
// VARIANCE LEG (D-435). The third structural premium, and it decayed on exactly the same timeline as the other two
// (BTC 22.2 -> 14.1 -> 7.3 -> 1.8 vol points across the four eras). LIVE PROXY ONLY: true VRP needs the FORWARD realised
// vol, which is unknowable today, so this compares current implied against TRAILING realised and is labelled as an
// estimate. It is directional guidance for whether the premium has returned, not a measurement.
console.log(`\n  --- variance risk premium (sell 30d variance), LIVE PROXY: implied now vs TRAILING realised ---`);
for(const cur of ["BTC","ETH"]){
  const j=await fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${cur}&start_timestamp=${Date.now()-7*86400000}&end_timestamp=${Date.now()}&resolution=43200`).then(r=>r.json()).catch(()=>null) as {result?:{data?:number[][]}}|null;
  const data=j?.result?.data;
  if(!Array.isArray(data)||!data.length){console.log(`  ${cur}: DVOL unavailable — UNKNOWN`);continue;}
  const ivNow=data[data.length-1][4];
  const hv=await fetch(`https://www.deribit.com/api/v2/public/get_historical_volatility?currency=${cur}`).then(r=>r.json()).catch(()=>null) as {result?:number[][]}|null;
  const rv=Array.isArray(hv?.result)&&hv!.result!.length?hv!.result![hv!.result!.length-1][1]:null;
  if(rv===null){console.log(`  ${cur}: realised vol unavailable — UNKNOWN`);continue;}
  const vrp=ivNow-rv; const net=vrp-2;                       // 2 vol points round-trip cost
  const hit=net>4;                                           // a premium worth its tail, not merely positive
  if(hit)fire++;
  console.log(`  ${hit?"FIRE":"    "} ${cur.padEnd(16)} implied ${ivNow.toFixed(1)}  trailing realised ${rv.toFixed(1)}  VRP ${vrp.toFixed(1)} net ${net.toFixed(1)} vol pts ${hit?"<- condition MET":""}`);
}
console.log(`\n  ${fire?`${fire} contract(s) meet the condition. STILL DORMANT — surfacing only; nothing is armed and no order path exists.`
  :"No structural premium meets its condition. Correct action: hold cash. (Basis last cleared 5%/yr on 2025-02-02; funding beat cash for 1 of 8 symbols in 2025-2026 by 0.12%/yr; BTC VRP is down to 1.8 vol points from 22.2 in 2021 and ETH is negative.)"}`);
console.log(`  All three premia decayed on the SAME timeline (D-431/433/435) and each carries a tail that dwarfs it: the worst`);
console.log(`  30d variance window cost 11x (BTC) and 48x (ETH) the average premium. Selling insurance is paid for a reason.`);
console.log(`  Unmodelled and material: exchange/counterparty risk (this trade was destroyed by FTX in 2022), margin calls`);
console.log(`  on the short leg during a squeeze, settlement/withdrawal risk. Clearing the hurdle is necessary, not sufficient.`);
