#!/usr/bin/env -S deno run --allow-net --allow-env
// check-vrp-implementable.ts (D-573) — CAN THE CRYPTO VRP ACTUALLY BE HARVESTED?
// D-572 measured a BTC variance premium of ~10.8%/yr on variance notional (t 3.76). Every prior premium in this
// programme died at the implementability wall (equity decile books unplaceable; ETF wrappers lose 80% of the signal;
// concentrated stock books dead). The wall is measured here BEFORE any further work, not after.
// The placeable instrument is not a variance swap — it is a short ATM straddle rolled monthly on Deribit. So the
// honest cost is the LIVE bid-ask on the options actually required, not a theoretical slippage assumption.
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const j=await fetch("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option").then(r=>r.json()).catch(()=>null);
const rows=(j?.result||[]) as {instrument_name:string;bid_price:number|null;ask_price:number|null;mark_price:number;underlying_price:number;mid_price:number|null;volume:number;open_interest:number}[];
if(!rows.length){console.log("!! no Deribit option data returned");Deno.exit(1);}
const spot=rows.find(r=>r.underlying_price)?.underlying_price??0;
console.log(`==> DERIBIT BTC OPTIONS — ${rows.length} instruments live, spot ~$${spot.toFixed(0)}`);
// parse BTC-DDMMMYY-STRIKE-C/P
const parsed=rows.map(r=>{
  const p=r.instrument_name.split("-");
  const strike=+p[2];
  const cp=p[3];
  const d=p[1];
  return {...r,strike,cp,expiry:d};
}).filter(r=>Number.isFinite(r.strike)&&r.bid_price&&r.ask_price&&r.mark_price>0);
// group by expiry, find the near-30d one with the most open interest
const byExp=new Map<string,typeof parsed>();
for(const r of parsed)(byExp.get(r.expiry)??byExp.set(r.expiry,[]).get(r.expiry)!).push(r);
const MONTHS:Record<string,number>={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const now=Date.now();
const expInfo=[...byExp.entries()].map(([e,rs])=>{
  const m=/^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(e);
  if(!m)return null;
  const dt=Date.UTC(2000+ +m[3],MONTHS[m[2]],+m[1],8,0,0);
  return {exp:e,days:(dt-now)/86400000,rs,oi:rs.reduce((s,r)=>s+(r.open_interest||0),0)};
}).filter(Boolean) as {exp:string;days:number;rs:typeof parsed;oi:number}[];
const near=expInfo.filter(e=>e.days>=15&&e.days<=45).sort((a,b)=>b.oi-a.oi)[0]
        ?? expInfo.filter(e=>e.days>0).sort((a,b)=>Math.abs(a.days-30)-Math.abs(b.days-30))[0];
if(!near){console.log("!! no suitable expiry");Deno.exit(1);}
console.log(`    nearest ~30d expiry: ${near.exp} (${near.days.toFixed(0)}d), total OI ${near.oi.toFixed(0)} BTC across ${near.rs.length} strikes`);
// ATM straddle: call+put nearest to spot
const strikes=[...new Set(near.rs.map(r=>r.strike))].sort((a,b)=>Math.abs(a-spot)-Math.abs(b-spot));
const K=strikes[0];
const call=near.rs.find(r=>r.strike===K&&r.cp==="C"), put=near.rs.find(r=>r.strike===K&&r.cp==="P");
if(!call||!put){console.log("!! no ATM pair");Deno.exit(1);}
const legCost=(r:typeof parsed[number])=>{
  const bid=r.bid_price!,ask=r.ask_price!;
  const mid=(bid+ask)/2;
  return {mid,spread:ask-bid,halfSpreadPct:mid>0?((ask-bid)/2)/mid*100:NaN};
};
const c=legCost(call), p=legCost(put);
console.log(`    ATM strike $${K.toFixed(0)}:`);
console.log(`      call  bid ${call.bid_price} ask ${call.ask_price} (BTC)  mid ${c.mid.toFixed(4)}  half-spread ${c.halfSpreadPct.toFixed(1)}% of premium`);
console.log(`      put   bid ${put.bid_price} ask ${put.ask_price} (BTC)  mid ${p.mid.toFixed(4)}  half-spread ${p.halfSpreadPct.toFixed(1)}% of premium`);
const straddleMid=c.mid+p.mid;                                  // in BTC
const straddleMidUsd=straddleMid*spot;
const roundTripCost=(c.spread+p.spread)*spot;                   // pay half-spread each way on both legs = full spread each leg per round trip
console.log(`\n    monthly ATM straddle: mid premium $${straddleMidUsd.toFixed(0)} (${(straddleMid*100).toFixed(2)}% of spot)`);
console.log(`    round-trip spread cost: $${roundTripCost.toFixed(0)} = ${(roundTripCost/straddleMidUsd*100).toFixed(1)}% OF THE PREMIUM COLLECTED`);
// Deribit fees: 0.03% of underlying per contract, capped at 12.5% of option price; settlement 0.015%
const feeUsd=Math.min(0.0003*spot,0.125*c.mid*spot)+Math.min(0.0003*spot,0.125*p.mid*spot);
console.log(`    exchange fees (0.03% of underlying, capped 12.5% of premium, both legs): $${feeUsd.toFixed(0)} = ${(feeUsd/straddleMidUsd*100).toFixed(1)}% of premium`);
const totalCostPct=(roundTripCost+feeUsd)/straddleMidUsd*100;
console.log(`    TOTAL round-trip cost: ${totalCostPct.toFixed(1)}% of the premium collected, EVERY MONTH`);
console.log(`\n    D-572 measured the gross premium at ~10.8%/yr on variance notional, i.e. the edge is the SHORTFALL of`);
console.log(`    realised vs implied. A short straddle collects the option premium and pays out realised moves; the`);
console.log(`    transaction cost above is charged on the PREMIUM, monthly, 12 times a year.`);
console.log(`    -> ${totalCostPct>50?"IMPLEMENTABILITY WALL: costs exceed half the premium collected each month":totalCostPct>20?"SEVERE: costs take a fifth to a half of gross premium monthly":"costs are a modest fraction of premium — worth a full modelled test"}`);
// liquidity check: how much size can actually be done at these quotes?
const atmOI=(call.open_interest||0)+(put.open_interest||0);
const atmVol=(call.volume||0)+(put.volume||0);
console.log(`\n    ATM liquidity: open interest ${atmOI.toFixed(0)} BTC, 24h volume ${atmVol.toFixed(0)} BTC (~$${(atmVol*spot/1e6).toFixed(1)}M notional/day at this strike)`);
