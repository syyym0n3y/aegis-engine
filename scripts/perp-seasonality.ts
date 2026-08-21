#!/usr/bin/env -S deno run --allow-net --allow-env
// perp-seasonality.ts (D-445) — hour-of-day, day-of-week, and FUNDING-SETTLEMENT effects in perps.
// Mechanism, not data-mining: funding settles at 00:00 / 08:00 / 16:00 UTC on Binance. Positions are opened and closed
// around those stamps to collect or avoid the payment, which is a REAL recurring flow with a known clock — the kind of
// thing that can leave a footprint. Hour-of-day is also where crypto's session structure (Asia / Europe / US) would show
// up if it exists.
// Very well powered: ~60,000 hourly bars per symbol means ~2,500 observations per hour-of-day per symbol.
// Judged by this session's rules: SIGN CONSISTENCY across symbols first (D-426 showed it is the strongest evidence
// available), then EFFECT SIZE against the fee, because a per-hour rule pays the round trip every time it fires.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"se",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_RT_BP=Number(Deno.env.get("PERP_FEE_RT_BP")||9);

const syms=(await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=n_bars.desc`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[]).filter(s=>s.n_bars>=20000);
console.log(`==> PERP SEASONALITY — ${syms.length} perps with >=20,000 hourly bars (fee ${FEE_RT_BP}bp round trip)`);
const byHour:number[][]=Array.from({length:24},()=>[]);      // per-symbol mean return, in bp, by UTC hour
const byDow:number[][]=Array.from({length:7},()=>[]);
const symNames:string[]=[];
for(const s of syms){
  const b=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&symbol=eq.${s.symbol}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(b)||!b[0])continue;
  const bars=b[0].bars;
  const h:number[][]=Array.from({length:24},()=>[]), d:number[][]=Array.from({length:7},()=>[]);
  for(let i=1;i<bars.length;i++){
    if(!(bars[i][4]>0)||!(bars[i-1][4]>0))continue;
    const r=bars[i][4]/bars[i-1][4]-1; const dt=new Date(bars[i][0]*1000);
    h[dt.getUTCHours()].push(r); d[dt.getUTCDay()].push(r);
  }
  symNames.push(s.symbol);
  for(let k=0;k<24;k++) if(h[k].length>300) byHour[k].push(mean(h[k])*1e4);
  for(let k=0;k<7;k++) if(d[k].length>300) byDow[k].push(mean(d[k])*1e4);
}
console.log(`    loaded ${symNames.length} symbols\n`);
console.log(`    HOUR-OF-DAY (UTC) — mean return in bp, averaged across symbols, with cross-symbol sign consistency`);
console.log(`    ${"hr".padEnd(4)}${"mean bp".padEnd(10)}${"+/n".padEnd(9)}${"consistent?".padEnd(13)}${"vs fee".padEnd(9)}note`);
const FUND_H=new Set([0,8,16]);
const strong:{h:number;bp:number;pos:number;n:number}[]=[];
for(let k=0;k<24;k++){
  const v=byHour[k]; if(v.length<5)continue;
  const m=mean(v), pos=v.filter(x=>x>0).length;
  const cons=pos>=v.length*0.8||pos<=v.length*0.2;
  if(cons)strong.push({h:k,bp:m,pos,n:v.length});
  console.log(`    ${String(k).padEnd(4)}${m.toFixed(2).padEnd(10)}${(pos+"/"+v.length).padEnd(9)}${(cons?"CONSISTENT":"mixed").padEnd(13)}${(Math.abs(m)/FEE_RT_BP).toFixed(3).padEnd(9)}${FUND_H.has(k)?"<- funding settlement":""}`);
}
console.log(`\n    DAY-OF-WEEK — mean return in bp`);
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
for(let k=0;k<7;k++){const v=byDow[k]; if(v.length<5)continue;
  const m=mean(v), pos=v.filter(x=>x>0).length;
  console.log(`    ${DOW[k].padEnd(5)}${m.toFixed(2).padEnd(10)}${(pos+"/"+v.length).padEnd(9)}${(pos>=v.length*0.8||pos<=v.length*0.2?"CONSISTENT":"mixed").padEnd(13)}${(Math.abs(m)/FEE_RT_BP).toFixed(3)}x fee`);}
console.log(`\n    hours with consistent cross-symbol sign: ${strong.length}/24`);
const tradable=strong.filter(s=>Math.abs(s.bp)>FEE_RT_BP);
console.log(`    of those, effect LARGER than the ${FEE_RT_BP}bp round-trip fee: ${tradable.length}`);
if(!tradable.length) console.log(`      (none — every hour-of-day effect is smaller than the cost of trading it, the same wall D-426 hit)`);
else for(const t of tradable) console.log(`      hour ${t.h}: ${t.bp.toFixed(2)}bp = ${(Math.abs(t.bp)/FEE_RT_BP).toFixed(2)}x the fee, ${t.pos}/${t.n} symbols agree`);

// ============================================================================================================
// THE US-AFTERNOON WINDOW, TESTED AS A STRATEGY. Hours 21 and 22 UTC (16:00-18:00 ET) are positive on 14 of 14 symbols —
// perfect cross-symbol sign consistency, the strongest form of evidence available here. Combined they are ~9.6bp/day,
// which is right at the 9bp TAKER round trip and comfortably above a ~3.6bp MAKER round trip. That is close enough that
// arithmetic is not good enough: measure it.
// HONEST ABOUT MAKER FILLS: resting orders to capture maker fees suffers adverse selection — you are filled preferentially
// when the market is moving against you. The maker column is therefore an OPTIMISTIC bound, not an achievable return, and
// is labelled as such. Taker is the number that can actually be relied on.
console.log(`\n    ==> US-AFTERNOON WINDOW (21:00-23:00 UTC) as a strategy, per symbol`);
console.log(`    ${"symbol".padEnd(12)}${"gross bp/day".padEnd(14)}${"net TAKER 9bp".padEnd(16)}${"net MAKER 3.6bp*".padEnd(18)}${"SR taker".padEnd(10)}${"SR maker*".padEnd(11)}days`);
const perSym:{sym:string;t:number;m:number}[]=[];
for(const s of syms){
  const b=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&symbol=eq.${s.symbol}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(b)||!b[0])continue;
  const bars=b[0].bars;
  const byDay=new Map<string,Map<number,number>>();
  for(const bar of bars){ if(!(bar[4]>0))continue; const dt=new Date(bar[0]*1000);
    const d=dt.toISOString().slice(0,10);
    (byDay.get(d)??byDay.set(d,new Map()).get(d)!).set(dt.getUTCHours(),bar[4]); }
  const rets:number[]=[];
  for(const [,h] of byDay){ const entry=h.get(20), exit=h.get(22);   // buy at the 20:00 close, sell at the 22:00 close
    if(entry&&exit&&entry>0) rets.push(exit/entry-1); }
  if(rets.length<400)continue;
  const g=mean(rets), sd=sdv(rets)||1e-9;
  const nt=g-9/1e4, nm=g-3.6/1e4;
  perSym.push({sym:s.symbol,t:nt,m:nm});
  console.log(`    ${s.symbol.padEnd(12)}${(g*1e4).toFixed(2).padEnd(14)}${((nt*1e4).toFixed(2)+"bp").padEnd(16)}${((nm*1e4).toFixed(2)+"bp").padEnd(18)}${((nt/sd)*Math.sqrt(365)).toFixed(2).padEnd(10)}${((nm/sd)*Math.sqrt(365)).toFixed(2).padEnd(11)}${rets.length}`);
}
const posT=perSym.filter(x=>x.t>0).length, posM=perSym.filter(x=>x.m>0).length;
console.log(`\n    symbols profitable net of TAKER fees: ${posT}/${perSym.length}`);
console.log(`    symbols profitable net of MAKER fees*: ${posM}/${perSym.length}`);
console.log(`    * MAKER is an OPTIMISTIC BOUND, not an achievable return: resting orders are filled preferentially when`);
console.log(`      the market moves against you (adverse selection), which is precisely the cost this window would pay.`);
