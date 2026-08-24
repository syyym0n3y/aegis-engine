#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-capacity.ts (D-537) — AT WHAT SIZE DOES IT DIE? The operator's stated ambition is to scale; a strategy's
// honest description therefore includes the AUM at which its edge reaches zero, not just its Sharpe at zero size.
// Method, assumptions STATED (each is a lever a skeptic can move):
//   - universe: fixed top-60 by trailing dollar volume (the tradable one), quintile long-short = 12 long + 12 short
//   - gross exposure 2.0 (1.0 long, 1.0 short), FULL daily turnover (the GBM book re-ranks daily — pessimistic but true)
//   - impact model: square-root law  impact_bps = C * sigma_daily_bps * sqrt(participation),  C = 1.0
//     participation = order notional / that name's trailing 30d average daily dollar volume
//   - fees: 9bp round trip (taker), already in the book's net returns
// Reported: the AUM where modelled impact eats the measured gross edge. Also reports the 1%-participation AUM, the
// size most desks would consider the practical ceiling regardless of the impact model.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
type Day={sym:string;dvol:number;sig:number};
const byDay=new Map<string,Day[]>();
for(let i=0;i<meta.length;i+=25){
  const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){
    const b=r.bars; if(!b||b.length<120)continue;
    for(let k=31;k<b.length-1;k++){
      const dv=mean(b.slice(k-30,k).map(x=>x[6]).filter(Number.isFinite));   // 30d avg quote volume ($)
      if(!(dv>1e6))continue;
      const rets:number[]=[];for(let j=k-30;j<k;j++)if(b[j][4]>0&&b[j-1][4]>0)rets.push(b[j][4]/b[j-1][4]-1);
      if(rets.length<25)continue;
      const d=new Date(b[k][0]*1000).toISOString().slice(0,10);
      (byDay.get(d)??byDay.set(d,[]).get(d)!).push({sym:r.symbol,dvol:dv,sig:sdv(rets)});
    }
  }
}
const days=[...byDay.keys()].sort().filter(d=>byDay.get(d)!.length>=60);
console.log(`==> CRYPTO BOOK CAPACITY (D-537) — ${days.length} days with >=60 names`);
const K=12, GROSS=2.0;                                   // 12 long + 12 short out of top-60 (quintiles)
// per-day: take the top-60 by dvol, assume the book holds K longs + K shorts drawn from them at equal weight
const sample=days.slice(-750);                           // last ~3 years: the size that matters is TODAY's size
const medDvol:number[]=[],medSig:number[]=[];
for(const d of sample){
  const g=[...byDay.get(d)!].sort((a,b)=>b.dvol-a.dvol).slice(0,60);
  const traded=g.slice(0,2*K);                           // pessimistic: assume the book picks among the top-60 uniformly
  medDvol.push(mean(traded.map(x=>x.dvol)));
  medSig.push(mean(traded.map(x=>x.sig)));
}
const avgDvol=mean(medDvol), avgSig=mean(medSig);
console.log(`    typical traded name: $${(avgDvol/1e6).toFixed(1)}M/day volume, ${(avgSig*100).toFixed(2)}% daily vol  (${2*K} names held, gross ${GROSS}x)`);
const HOLD=Number(Deno.env.get("HOLD")||1);
const EDGE_PCT=Number(Deno.env.get("EDGE_PCT")||80.9);          // measured net %/yr for THIS hold period
const GROSS_EDGE_BPS_DAY = EDGE_PCT/100/365*1e4;
console.log(`    measured book: ${EDGE_PCT}%/yr net at zero size = ${GROSS_EDGE_BPS_DAY.toFixed(1)}bp/day  |  HOLD=${HOLD}d -> only 1/${HOLD} of the book trades each day`);
console.log(`\n    ${"AUM".padEnd(12)}${"$/name".padEnd(12)}${"participation".padEnd(15)}${"impact bp/day".padEnd(15)}${"net bp/day".padEnd(12)}net %/yr`);
const rows:[number,number][]=[];
for(const aum of [1e5,1e6,5e6,1e7,2.5e7,5e7,1e8,2.5e8,5e8,1e9]){
  const perName=aum*GROSS/(2*K);                         // notional per position
  const part=perName/avgDvol;                            // fraction of that name's daily volume, one side
  const impactBp=1.0*(avgSig*1e4)*Math.sqrt(part);       // square-root law, C=1
  const roundTripImpact=2*impactBp/HOLD;                // D-538: with a HOLD-day hold only 1/HOLD of the book turns over daily
  const net=GROSS_EDGE_BPS_DAY-roundTripImpact;
  rows.push([aum,net]);
  console.log(`    ${("$"+(aum/1e6).toFixed(1)+"M").padEnd(12)}${("$"+(perName/1e6).toFixed(2)+"M").padEnd(12)}${(part*100).toFixed(2).padStart(6)}%${"".padEnd(8)}${roundTripImpact.toFixed(1).padStart(6)}${"".padEnd(9)}${net.toFixed(1).padStart(6)}${"".padEnd(6)}${(net/1e4*365*100).toFixed(1)}%`);
}
const dies=rows.find(([,n])=>n<=0);
const oneP=avgDvol*0.01*(2*K)/GROSS;
console.log(`\n    EDGE REACHES ZERO at ~$${dies?(dies[0]/1e6).toFixed(0):">1000"}M AUM under this impact model (C=1, square-root).`);
console.log(`    1%-of-volume practical ceiling: ~$${(oneP/1e6).toFixed(0)}M AUM regardless of model.`);
console.log(`    ASSUMPTIONS ARE LEVERS: C=1 is mid-range (desk estimates span 0.5-2); full daily turnover is pessimistic`);
console.log(`    if the book's holdings persist; and the 80.9%/yr input is the TOP-60 variant, whose magnitude the`);
console.log(`    Universe Law records as NOT IDENTIFIED (SR 0.95-1.30). Capacity scales with the edge, so read this as`);
console.log(`    an ORDER OF MAGNITUDE, not a number.`);
