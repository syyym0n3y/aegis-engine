#!/usr/bin/env -S deno run --allow-net --allow-env
// basis-carry.ts (D-431) — THE FIRST TEST IN THIS PROGRAM THAT IS NOT A PREDICTION PROBLEM.
// Everything Aegis has tested for months asks "does X forecast returns". The quarterly BASIS asks something different: it
// is a spread you COLLECT, not a direction you guess. Long spot, short the dated future, hold to expiry: the future must
// converge to spot at delivery, so the annualised basis is earned with no directional exposure. That is why it deserves a
// separate test -- it has no forecasting error to be wrong about, only costs to be beaten and risks to be named.
// What can still kill it, and is measured here rather than assumed:
//   (a) FEES: four legs (open spot, open future, close/deliver, and the spot exit) ~ 18bp round trip at taker.
//   (b) OPPORTUNITY COST: capital tied up must beat the risk-free rate, not zero.
//   (c) TIME: the basis compressed hard after 2022 as the trade became institutional. Reported per-era, never pooled.
// Honest about what is NOT modelled: exchange/counterparty risk, margin calls on the short leg during a squeeze, and
// withdrawal/settlement risk. Those are real and are named, not silently priced at zero.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"bc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const pct=(a:number[],q:number)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor(q*s.length)))];};
const FEE_RT_BP=Number(Deno.env.get("BASIS_FEE_RT_BP")||18);   // four taker legs
const RF=Number(Deno.env.get("RF_ANNUAL")||0.04);              // opportunity cost of the capital

const rows=await fetch(`${OWNED}/trd_perp_oi?interval=eq.basis_ann&select=symbol,ts,open_interest&order=symbol,ts&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;ts:number;open_interest:number}[];
if(!Array.isArray(rows)||!rows.length){console.error("!! no basis rows — run ingest-basis.ts");Deno.exit(1);}
const by=new Map<string,{d:string;b:number}[]>();
for(const r of rows)(by.get(r.symbol)??by.set(r.symbol,[]).get(r.symbol)!).push({d:new Date(r.ts*1000).toISOString().slice(0,10),b:r.open_interest});
console.log(`==> QUARTERLY BASIS CARRY (~60d constant maturity) — fees ${FEE_RT_BP}bp round trip, opportunity cost ${(RF*100).toFixed(0)}%/yr`);

const ERA=(d:string)=>{const y=+d.slice(0,4);return y<=2021?"2020-2021 (retail bull)":y<=2022?"2022 (post-LUNA/FTX)":y<=2024?"2023-2024":"2025-2026";};
for(const [sym,a] of by){
  console.log(`\n  ${sym}  n=${a.length} days  ${a[0].d} .. ${a[a.length-1].d}`);
  console.log(`    ${"era".padEnd(24)}${"median".padEnd(10)}${"p25".padEnd(9)}${"p75".padEnd(9)}${"NET of fees+rf".padEnd(17)}${"% days > rf".padEnd(13)}n`);
  const eras=[...new Set(a.map(x=>ERA(x.d)))].sort();
  for(const e of [...eras,"ALL"]){
    const g=(e==="ALL"?a:a.filter(x=>ERA(x.d)===e)).map(x=>x.b);
    if(g.length<30)continue;
    // NET carry: the gross annualised basis, less the round-trip fee annualised over a 60-day hold, less the risk-free rate
    // the same capital would have earned doing nothing.
    const feeAnn=(FEE_RT_BP/1e4)*(365/60);
    const net=mean(g)-feeAnn-RF;
    const above=100*g.filter(x=>x-feeAnn-RF>0).length/g.length;
    console.log(`    ${e.padEnd(24)}${(mean(g)*100).toFixed(1).padEnd(9)}%${(pct(g,0.25)*100).toFixed(1).padEnd(8)}%${(pct(g,0.75)*100).toFixed(1).padEnd(8)}%${((net)*100).toFixed(1).padEnd(16)}%${above.toFixed(0).padEnd(12)}%${g.length}`);
  }
  // A CARRY TRADE IS ONLY REAL IF IT IS THERE WHEN YOU LOOK, not on average. Report the fraction of days the net carry
  // clears a meaningful hurdle, because a mean dragged up by a 2021 spike is not a strategy anyone could have run.
  const feeAnn=(FEE_RT_BP/1e4)*(365/60);
  for(const hurdle of [0.05,0.10]){
    const days=a.filter(x=>x.b-feeAnn-RF>hurdle);
    console.log(`    net carry > ${(hurdle*100).toFixed(0)}%/yr on ${days.length}/${a.length} days (${(100*days.length/a.length).toFixed(0)}%)${days.length?` — most recent ${days[days.length-1].d}`:""}`);
  }
}
console.log(`\n  NOT MODELLED (named, not priced at zero): exchange/counterparty risk, margin calls on the short leg during a`);
console.log(`  squeeze, settlement and withdrawal risk. A basis that clears fees is necessary for this trade, not sufficient.`);
