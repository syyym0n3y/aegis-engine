#!/usr/bin/env -S deno run --allow-net --allow-env
// reversal-cross.ts (D-418) — the ONE survivor of the cross-asset lead-lag scan, tested honestly.
// Lead-lag scan (D-417) found 216 same-session pairs surviving OOS, but the top of the list was contaminated twice over:
// US->^N225/^FTSE (foreign bars stamped day D close ~8h BEFORE the US bar stamped day D) and US->SI=F/GC=F (COMEX settles
// 13:30 ET vs equity 16:00 ET). Both are the textbook NON-SYNCHRONOUS TRADING artifact, not information. What remained was
// a single mechanism: NEGATIVE cross-index betas — a broad-index up-day is followed by a RELATIVE down-day in the higher-beta
// index. That is short-horizon reversal. This script asks the only questions that matter:
//   (1) is it there in TRADABLE instruments (ETFs, not index levels)?
//   (2) does it survive REALISTIC cost, charged on ACTUAL turnover (the sign flips ~half of days, not every day)?
//   (3) is it still alive, or is it a pre-decimalisation/pre-HFT ghost? (per-era)
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"rx",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sd=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};

// TRADABLE ONLY — real, liquid, same-session US ETFs. No index levels, no futures, no foreign.
const PAIRS:[string,string][]=[["SPY","QQQ"],["SPY","IWM"],["SPY","XLK"],["XLF","IWM"],["SPY","XLP"],["QQQ","IWM"],["XLV","XLK"],["SPY","XLE"]];
const WANT=[...new Set(PAIRS.flat())];
const rows:{symbol:string;bars:number[][]}[]=[];
for(let i=0;i<WANT.length;i+=10){const part=WANT.slice(i,i+10).map(x=>`"${x}"`).join(",");
  const r=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]);
  if(Array.isArray(r))rows.push(...r);}
const px=new Map<string,Map<string,number>>();
for(const r of rows){const m=new Map<string,number>();for(const b of r.bars)m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);px.set(r.symbol,m);}
console.log(`==> CROSS-INDEX REVERSAL — tradable ETFs only (loaded ${px.size}/${WANT.length})`);
const dates=[...px.get("SPY")!.keys()].filter(d=>WANT.every(s=>px.get(s)?.has(d))).sort();
console.log(`    common days: ${dates.length} (${dates[0]} .. ${dates.at(-1)})`);
const ret=new Map<string,number[]>();
for(const s of WANT){const p=px.get(s)!;const a:number[]=[];for(let i=1;i<dates.length;i++)a.push(p.get(dates[i])!/p.get(dates[i-1])!-1);ret.set(s,a);}
const rdates=dates.slice(1);

// COST MODEL: charge the round-trip ONLY when the position actually flips. Turnover is measured, not assumed.
// bp is per full round-trip (in+out). A same-sign day costs nothing.
function run(lead:string,lag:string,bpRT:number,from=0,to=1e9){
  const ra=ret.get(lead)!, rb=ret.get(lag)!; const pnl:number[]=[]; let prev=0,flips=0,days=0;
  for(let i=1;i<ra.length;i++){ const y=+rdates[i].slice(0,4); if(y<from||y>=to)continue;
    const sig=-Math.sign(ra[i-1]); if(!sig)continue; days++;
    const cost=(sig!==prev?bpRT/1e4:0); if(sig!==prev)flips++; prev=sig;
    pnl.push(sig*rb[i]-cost); }
  if(pnl.length<250)return null;
  const m=mean(pnl),s=sd(pnl);
  return{ann:+(m*252*100).toFixed(1),sr:+((m/s)*Math.sqrt(252)).toFixed(2),n:pnl.length,turn:+(100*flips/days).toFixed(0)};
}
console.log(`\n    Strategy: hold LAG asset with sign = -sign(LEAD's prior day). Cost charged ONLY on flips.`);
console.log(`    ${"pair".padEnd(14)} ${"turnover".padEnd(9)} ${"GROSS".padEnd(16)} ${"@2bp RT".padEnd(16)} ${"@5bp RT".padEnd(16)} @10bp RT`);
for(const [a,b] of PAIRS){ const g=run(a,b,0),c2=run(a,b,2),c5=run(a,b,5),c10=run(a,b,10); if(!g)continue;
  const f=(x:{ann:number;sr:number}|null)=>x?`${x.ann>=0?"+":""}${x.ann}% SR${x.sr}`.padEnd(16):"-".padEnd(16);
  console.log(`    ${(a+"->"+b).padEnd(14)} ${(g.turn+"%/d").padEnd(9)} ${f(g)}${f(c2)}${f(c5)}${f(c10)}`);}

console.log(`\n    PER-ERA at 2bp round-trip (is it alive, or a pre-decimalisation ghost?):`);
const ERAS:[string,number,number][]=[["2000-2007",2000,2008],["2008-2014",2008,2015],["2015-2020",2015,2021],["2021-2026",2021,2100]];
console.log(`    ${"pair".padEnd(14)}${ERAS.map(e=>e[0].padEnd(17)).join("")}`);
for(const [a,b] of PAIRS){ const cells=ERAS.map(([,f,t])=>{const r=run(a,b,2,f,t);return r?`${r.ann>=0?"+":""}${r.ann}% SR${r.sr}`.padEnd(17):"(thin)".padEnd(17);});
  console.log(`    ${(a+"->"+b).padEnd(14)}${cells.join("")}`);}

// ============================================================================================================
// THE DECISIVE FALSIFICATION: is the LEAD doing ANY work?
// SPY's daily sign agrees with IWM's ~80% of the time. So "-sign(SPY[t-1]) -> IWM[t]" may be nothing but the long-known
// OWN-ASSET short-term reversal (-sign(IWM[t-1]) -> IWM[t]) with a correlated proxy standing in for the real signal.
// If so there is no cross-asset information here at all, and the honest label is "we rediscovered short-term reversal".
// Test: (a) own-asset control, (b) DISAGREE days only — the ~20% where lead and lag moved OPPOSITE ways. On those days the
// two hypotheses make OPPOSITE predictions, so they cleanly separate. That is the whole ballgame.
console.log(`\n    ==> FALSIFICATION: does the LEAD add anything over the LAG's OWN prior move?`);
function runSig(lag:string,sigf:(i:number)=>number,bpRT:number,from=0,to=1e9){
  const rb=ret.get(lag)!; const pnl:number[]=[]; let prev=0;
  for(let i=1;i<rb.length;i++){ const y=+rdates[i].slice(0,4); if(y<from||y>=to)continue;
    const sig=sigf(i); if(!sig)continue; const cost=(sig!==prev?bpRT/1e4:0); prev=sig; pnl.push(sig*rb[i]-cost); }
  if(pnl.length<150)return null; const m=mean(pnl),s=sd(pnl);
  return{ann:+(m*252*100).toFixed(1),sr:+((m/s)*Math.sqrt(252)).toFixed(2),t:+((m/s)*Math.sqrt(pnl.length)).toFixed(2),n:pnl.length};
}
const f=(x:{ann:number;sr:number;t:number;n:number}|null)=>x?`${x.ann>=0?"+":""}${x.ann}%/yr SR${x.sr} t${x.t} n${x.n}`.padEnd(34):"(too thin)".padEnd(34);
for(const [a,b] of PAIRS.slice(0,5)){
  const ra=ret.get(a)!, rb=ret.get(b)!;
  const own =runSig(b,i=>-Math.sign(rb[i-1]),2);
  const cross=runSig(b,i=>-Math.sign(ra[i-1]),2);
  const agree=rdates.slice(1).filter((_,i)=>Math.sign(ra[i])===Math.sign(rb[i])).length;
  // DISAGREE-ONLY: the two hypotheses predict opposite signs here.
  const dLead=runSig(b,i=>Math.sign(ra[i-1])===Math.sign(rb[i-1])?0:-Math.sign(ra[i-1]),2);
  const dOwn =runSig(b,i=>Math.sign(ra[i-1])===Math.sign(rb[i-1])?0:-Math.sign(rb[i-1]),2);
  console.log(`\n    ${a}->${b}  (lead/lag same-sign on ${(100*agree/(rdates.length-1)).toFixed(0)}% of days)`);
  console.log(`      own-asset reversal  -sign(${b}[t-1]) : ${f(own)}`);
  console.log(`      cross    reversal  -sign(${a}[t-1]) : ${f(cross)}`);
  console.log(`      DISAGREE days only, follow LEAD      : ${f(dLead)}`);
  console.log(`      DISAGREE days only, follow OWN       : ${f(dOwn)}`);
}
