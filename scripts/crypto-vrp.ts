#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-vrp.ts (D-435) — THE VARIANCE RISK PREMIUM in crypto: does implied volatility systematically exceed what
// subsequently realises, and is the difference collectable?
// This is the third member of the only family that has ever paid here (carry / structural premia, no forecast required):
// D-431 quarterly basis, D-433 funding harvest, and now variance. The first two were real and competed away. Documented
// crypto VRP is much larger than equity VRP -- which is a warning, not a promise: a bigger insurance premium means the
// insurer is being paid for a bigger tail. D-404 measured equity VRP at t=48.8 and it lost 83% in a SINGLE DAY.
// So the headline is not the mean. It is the worst outcome, and the mean is reported next to it.
// Discipline: NON-OVERLAPPING sampling for every t-stat (30d forward windows overlap 59/60 at 12h resolution -- the D-416
// trap), per-era never pooled, and effect size stated against the real cost of trading it.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"vp",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const HOR_D=30;                                     // DVOL is a 30-day forward-looking index
const VOLPT_COST=Number(Deno.env.get("VOL_POINT_COST")||2);  // round-trip cost of a 30d straddle, in vol points

const dv=await fetch(`${OWNED}/trd_perp_oi?interval=eq.dvol&select=symbol,ts,open_interest&order=symbol,ts&limit=20000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;ts:number;open_interest:number}[];
if(!Array.isArray(dv)||!dv.length){console.error("!! no DVOL — run ingest-dvol.ts");Deno.exit(1);}
console.log(`==> CRYPTO VARIANCE RISK PREMIUM — implied (DVOL) vs subsequently realised, ${HOR_D}d horizon`);
console.log(`    round-trip cost assumed ${VOLPT_COST} vol points (a 30d straddle on Deribit)\n`);

for(const [cur,perp] of [["BTC","BTCUSDT"],["ETH","ETHUSDT"]]){
  const iv=dv.filter(r=>r.symbol===cur).sort((a,b)=>a.ts-b.ts);
  const bar=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&symbol=eq.${perp}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(bar)||!bar[0]){console.log(`  ${cur}: no hourly bars`);continue;}
  const bars=bar[0].bars;
  const lr:{ts:number;r:number}[]=[];
  for(let i=1;i<bars.length;i++) if(bars[i][4]>0&&bars[i-1][4]>0) lr.push({ts:bars[i][0],r:Math.log(bars[i][4]/bars[i-1][4])});
  // realised vol over the FORWARD HOR_D days from time t, annualised in vol points
  const rvFwd=(t0:number)=>{const t1=t0+HOR_D*86400;
    const w=lr.filter(x=>x.ts>t0&&x.ts<=t1).map(x=>x.r);
    if(w.length<HOR_D*24*0.6)return null;
    return sdv(w)*Math.sqrt(24*365)*100;};
  const obs:{d:string;iv:number;rv:number;vrp:number}[]=[];
  for(const p of iv){const rv=rvFwd(p.ts); if(rv===null)continue;
    obs.push({d:new Date(p.ts*1000).toISOString().slice(0,10),iv:p.open_interest,rv,vrp:p.open_interest-rv});}
  if(obs.length<200){console.log(`  ${cur}: only ${obs.length} usable observations`);continue;}
  // NON-OVERLAPPING: 12h resolution -> 60 points per 30d window. Step by 60 so windows never share a day.
  const STEP=60;
  const nonOv=obs.filter((_,i)=>i%STEP===0);
  const m=mean(obs.map(o=>o.vrp)), mn=mean(nonOv.map(o=>o.vrp));
  const tn=mn/(sdv(nonOv.map(o=>o.vrp))/Math.sqrt(nonOv.length));
  console.log(`  ${cur}  n=${obs.length} overlapping / ${nonOv.length} NON-overlapping  ${obs[0].d} .. ${obs[obs.length-1].d}`);
  console.log(`    mean IV ${mean(obs.map(o=>o.iv)).toFixed(1)}  mean realised ${mean(obs.map(o=>o.rv)).toFixed(1)}  -> VRP ${m.toFixed(2)} vol pts (overlapping)`);
  console.log(`    NON-OVERLAPPING VRP ${mn.toFixed(2)} vol pts, t ${tn.toFixed(2)}, positive in ${(100*nonOv.filter(o=>o.vrp>0).length/nonOv.length).toFixed(0)}% of windows`);
  console.log(`    net of ${VOLPT_COST} vol pts cost: ${(mn-VOLPT_COST).toFixed(2)} vol pts = ${((mn-VOLPT_COST)/VOLPT_COST).toFixed(1)}x the cost`);
  // ERA
  const ERA=(d:string)=>{const y=+d.slice(0,4);return y<=2021?"2021":y===2022?"2022":y<=2024?"2023-2024":"2025-2026";};
  for(const e of ["2021","2022","2023-2024","2025-2026"]){
    const g=nonOv.filter(o=>ERA(o.d)===e); if(g.length<6)continue;
    console.log(`      ${e.padEnd(11)} VRP ${mean(g.map(o=>o.vrp)).toFixed(2).padStart(7)} vol pts, positive ${(100*g.filter(o=>o.vrp>0).length/g.length).toFixed(0).padStart(3)}%  (n=${g.length})`);
  }
  // THE TAIL — the number that actually decides whether this is insurable risk or a blow-up waiting to happen.
  // Short-variance P&L over a window is proportional to (IV^2 - RV^2); expressed here in variance points, normalised so a
  // typical premium is comparable to the losses.
  const pnl=obs.map(o=>(o.iv*o.iv-o.rv*o.rv)/100);
  const srt=[...pnl].sort((a,b)=>a-b);
  const worst=obs[pnl.indexOf(srt[0])];
  console.log(`    SHORT-VARIANCE TAIL: mean ${mean(pnl).toFixed(1)} | p5 ${srt[Math.floor(0.05*srt.length)].toFixed(1)} | WORST ${srt[0].toFixed(1)} on ${worst.d} (IV ${worst.iv.toFixed(0)} -> realised ${worst.rv.toFixed(0)})`);
  console.log(`    worst window is ${Math.abs(srt[0]/Math.max(1e-9,mean(pnl))).toFixed(0)}x the average premium — that is the ratio that kills variance sellers\n`);
}
console.log(`  A variance premium is payment for accepting a tail. The mean says the insurer is paid; the WORST column says`);
console.log(`  what they are paid for. Never quote one without the other.`);
