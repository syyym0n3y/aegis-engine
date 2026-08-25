#!/usr/bin/env -S deno run --allow-net --allow-env
// model-vrp-straddle.ts (D-574) — SHORT-STRADDLE P&L MODELLED OFF DVOL.
// THIS IS A MODEL, NOT DATA. Deribit's public API does not serve historical option chains in bulk, so options are
// priced by Black-Scholes at the DVOL implied vol of the day. That assumption is exactly true for an ATM option only
// if DVOL equals the ATM implied vol; DVOL is a variance-swap-style index across strikes, so it slightly overstates
// ATM vol when the skew is steep. The direction of that bias FLATTERS the seller, and is stated rather than hidden.
// Two variants, because only one of them actually harvests variance:
//   (a) NAKED short straddle held to expiry — what a simple operator does; dominated by the terminal move, so it is
//       a directional bet with a premium attached rather than a variance harvest.
//   (b) DELTA-HEDGED short straddle, rebalanced daily against the perp — isolates variance, but pays hedging costs.
// Costs: 3.3% of premium per round trip (MEASURED live, D-573) plus 9bp round trip on every hedge adjustment.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ms",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const ncdf=(x:number)=>{const t=1/(1+0.2316419*Math.abs(x));
  const d=0.3989423*Math.exp(-x*x/2);
  const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return x>0?1-p:p;};
const bs=(S:number,K:number,T:number,sig:number)=>{
  if(T<=0||sig<=0)return {call:Math.max(0,S-K),put:Math.max(0,K-S),dCall:S>K?1:0,dPut:S>K?0:-1};
  const d1=(Math.log(S/K)+0.5*sig*sig*T)/(sig*Math.sqrt(T)), d2=d1-sig*Math.sqrt(T);
  const call=S*ncdf(d1)-K*ncdf(d2), put=K*ncdf(-d2)-S*ncdf(-d1);
  return {call,put,dCall:ncdf(d1),dPut:ncdf(d1)-1};
};
const dv=await fetch(`${OWNED}/trd_perp_oi?venue=eq.deribit&interval=eq.dvol&select=symbol,ts,open_interest&order=symbol,ts&limit=20000`,{headers:hdr}).then(r=>r.json()) as {symbol:string;ts:number;open_interest:number}[];
const ivm=new Map<string,number>();
for(const r of dv) if(r.symbol==="BTC") ivm.set(new Date(r.ts*1000).toISOString().slice(0,10),+r.open_interest);
const rb=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=eq.BTCUSDT&select=bars`,{headers:hdr}).then(x=>x.json()) as {bars:number[][]}[];
const px=new Map<string,number>();
for(const b of (rb[0]?.bars||[]))if(b[4]>0)px.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
const days=[...px.keys()].sort();
const SPREAD_PCT=0.033;     // measured live, D-573
const HEDGE_BP=9;           // perp round trip
console.log(`==> SHORT-STRADDLE P&L MODELLED OFF DVOL (D-574) — MODEL, NOT DATA`);
console.log(`    pricing: Black-Scholes at DVOL; costs: ${(SPREAD_PCT*100).toFixed(1)}% of premium per round trip (measured) + ${HEDGE_BP}bp per hedge adjustment`);
const naked:number[]=[], hedged:number[]=[], dates:string[]=[];
for(let i=0;i+30<days.length;i+=30){
  const d0=days[i], S0=px.get(d0)!, sig=(ivm.get(d0)??NaN)/100;
  if(!Number.isFinite(sig)||sig<=0)continue;
  const T=30/365, K=S0;
  const o=bs(S0,K,T,sig);
  const prem=o.call+o.put;
  const cost=prem*SPREAD_PCT;
  // (a) naked: short straddle to expiry
  const ST=px.get(days[i+30])!;
  const payoff=Math.abs(ST-K);
  naked.push((prem-payoff-cost)/S0);
  // (b) delta-hedged daily: short straddle, hedge with perp
  let cash=prem-cost, hedgePos=-(o.dCall+o.dPut);          // short straddle delta => hedge is opposite
  let hedgeCost=Math.abs(hedgePos)*S0*HEDGE_BP/1e4/2;      // entry half
  for(let k=1;k<=30;k++){
    const d=days[i+k], S=px.get(d)!;
    const Tr=Math.max(0,(30-k)/365);
    const ok=bs(S,K,Tr,sig);
    const want=-(ok.dCall+ok.dPut);
    const dq=want-hedgePos;
    hedgeCost+=Math.abs(dq)*S*HEDGE_BP/1e4/2;
    cash+=hedgePos*(S-px.get(days[i+k-1])!);               // hedge P&L over the day
    hedgePos=want;
  }
  const settle=Math.abs(px.get(days[i+30])!-K);
  hedged.push((cash-settle-hedgeCost)/S0);
  dates.push(d0);
}
const rep=(v:number[],label:string)=>{
  if(v.length<20){console.log(`    ${label}: only ${v.length} windows`);return;}
  const m=mean(v),sd=sdv(v)||1e-9;
  let cum=1,pk=1,dd=0;
  for(const x of v){cum*=1+x;pk=Math.max(pk,cum);dd=Math.min(dd,cum/pk-1);}
  const worst=Math.min(...v), best=Math.max(...v);
  console.log(`    ${label.padEnd(28)} ${(m*12*100).toFixed(1).padStart(7)}%/yr  SR ${((m/sd)*Math.sqrt(12)).toFixed(2).padStart(5)}  t ${(m/(sd/Math.sqrt(v.length))).toFixed(2).padStart(5)}  win ${(100*v.filter(x=>x>0).length/v.length).toFixed(0)}%  worst month ${(worst*100).toFixed(1)}%  maxDD ${(dd*100).toFixed(0)}%`);
};
console.log(`    ${dates.length} non-overlapping months, ${dates[0]} .. ${dates.at(-1)}\n`);
rep(naked,"(a) NAKED short straddle");
rep(hedged,"(b) DELTA-HEDGED (daily)");
console.log(`\n    returns are per unit of SPOT notional (1 BTC straddle), NOT per unit of margin — leverage and`);
console.log(`    liquidation risk are unmodelled, and the worst month is the number that would meet a margin call.`);
