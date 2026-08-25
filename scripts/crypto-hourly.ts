#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// crypto-hourly.ts (D-569) — THE HIGHER-FREQUENCY TEST, aimed at the binding constraint.
// Rationale (D-565/567): recovery time scales with the number of INDEPENDENT bets. The daily book makes ~73 bets a
// year at a 5-day hold and spends 3.7 years underwater. At a 24h hold the same structure makes 365 bets a year; at 8h,
// 1,095. If the effects exist at these horizons, drawdown DURATION should shorten even at equal Sharpe.
// THE CENTRAL THREAT IS FEES, and it is arithmetic: with overlapping cohorts the book rolls 1/HOLD of itself each
// hour, so annual fee = 8760/HOLD x round-trip. At 9bp that is 3.3%/yr for a 24h hold, 19.7%/yr at 4h, 79%/yr at 1h.
// Anything under ~4h is dead on arrival and is not tested.
// SIGNALS: the same five literature-sided effects, recomputed on HOURLY bars with hourly lookbacks (i.e. genuinely
// higher-frequency versions of the same published effects, not the daily signal executed more finely).
// EXECUTION: lag-1 HOUR. Signs pre-registered, identical to lit5.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"chy",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("PERP_FEE_RT_BP")||9);
const HOLD=Number(Deno.env.get("HOLD")||24);        // hours
const TOPN=Number(Deno.env.get("TOPN")||50);
const HPY=8760;
console.log(`==> CRYPTO HOURLY (D-569) — hold ${HOLD}h, top-${TOPN}, lag-1h, ${FEE_BP}bp round trip`);
console.log(`    fee arithmetic: ${(HPY/HOLD).toFixed(0)} rolls/yr x ${FEE_BP}bp = ${((HPY/HOLD)*FEE_BP/100).toFixed(1)}%/yr of turnover cost`);
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc&limit=300`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
if(!meta.length){console.log("!! no 1hSF data — run ingest-crypto-hourly.ts first");Deno.exit(1);}
type Row={t:number;sym:string;x:number[];y:number};
const FEAT=["hi60h","vol30h","maxret30h","mom7h","flow7h","dvol"] as const;
const panel:Row[]=[];
for(let i=0;i<meta.length;i+=10){
  const part=meta.slice(i,i+10).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1hSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const r of rows){
    const b=r.bars; if(!b||b.length<200)continue;
    for(let k=61;k<b.length-2;k++){
      const c=b[k][4],cP7=b[k-7][4],cP1=b[k-1][4];
      if(!(c>0)||!(cP7>0)||!(cP1>0))continue;
      const rets:number[]=[]; for(let j=k-30;j<k;j++) if(b[j][4]>0&&b[j-1][4]>0) rets.push(b[j][4]/b[j-1][4]-1);
      if(rets.length<25)continue;
      const dv=mean(b.slice(k-30,k).map(x=>x[6]).filter(Number.isFinite));
      if(!(dv>2e4))continue;                                   // $20k/hour floor
      const hi=Math.max(...b.slice(k-60,k+1).map(x=>x[2]));
      const fw=b.slice(k-7,k); let tb=0,tv=0; for(const x of fw){tb+=x[7];tv+=x[5];}
      // LAG-1 HOUR: signal from data through close k, position taken at close k+1, return k+1 -> k+2
      const entry=b[k+1][4], exit=b[k+2][4];
      if(!(entry>0)||!(exit>0))continue;
      const y=exit/entry-1; if(!Number.isFinite(y)||Math.abs(y)>0.5)continue;
      const x=[c/hi, sdv(rets), Math.max(...rets), c/cP7-1, tv>0?(2*tb-tv)/tv:0, Math.log(dv)];
      if(!x.every(Number.isFinite))continue;
      panel.push({t:b[k][0],sym:r.symbol,x,y});
    }
  }
}
console.log(`    panel: ${panel.length.toLocaleString()} symbol-hours`);
const byT=new Map<number,Row[]>(); for(const p of panel)(byT.get(p.t)??byT.set(p.t,[]).get(p.t)!).push(p);
// per-hour: keep the TOPN most liquid, rank-normalise features
const hours=[...byT.keys()].sort((a,b)=>a-b);
const clean:[number,Row[]][]=[];
for(const t of hours){
  let g=byT.get(t)!;
  if(g.length<40)continue;
  g=[...g].sort((a,b)=>b.x[5]-a.x[5]).slice(0,TOPN);
  for(let f=0;f<FEAT.length;f++){
    const ord=[...g.keys()].sort((a,b)=>g[a].x[f]-g[b].x[f]);
    ord.forEach((gi,rk)=>{g[gi].x[f]=rk/(g.length-1)-0.5;});
  }
  clean.push([t,g]);
}
console.log(`    usable hours (>=40 names): ${clean.length.toLocaleString()}, mean breadth ${mean(clean.map(([,g])=>g.length)).toFixed(0)}`);
if(clean.length<3000){console.log("!! too few usable hours — UNTESTED");Deno.exit(0);}
// LIT5-hourly, signs pre-registered identically to the daily book
const REGIME=Deno.env.get("REGIME")||"momentum";
const SET:[string,number][]= REGIME==="reversal"
  ? [["mom7h",-1],["hi60h",-1],["vol30h",-1],["maxret30h",-1],["flow7h",1]]   // short-horizon reversal regime
  : [["hi60h",1],["vol30h",-1],["maxret30h",-1],["mom7h",1],["flow7h",1]];    // multi-week momentum regime (D-569)
console.log(`    REGIME=${REGIME}  signs: ${SET.map(([n,s2])=>`${n}${s2>0?"+":"-"}`).join(" ")}`);
const coh:{w:Map<string,number>;left:number}[]=[]; const out:number[]=[]; const ts:number[]=[];
for(const [t,g] of clean){
  const pred=g.map(r=>SET.reduce((s,[nm,sg])=>{const j=FEAT.indexOf(nm as typeof FEAT[number]);return j>=0?s+sg*r.x[j]:s;},0)/SET.length);
  const ord=[...g.keys()].sort((a,b)=>pred[b]-pred[a]);
  const kk=Math.max(3,Math.floor(g.length/5));
  const w=new Map<string,number>();
  for(const i of ord.slice(0,kk))w.set(g[i].sym,1/(2*kk));
  for(const i of ord.slice(-kk))w.set(g[i].sym,-(1/(2*kk)));
  coh.push({w,left:HOLD});
  for(const c of coh)c.left--;
  while(coh.length&&coh[0].left<=0)coh.shift();
  const rmap=new Map(g.map(r=>[r.sym,r.y]));
  let ret=0,gr=0;
  for(const c of coh){for(const [sym,ww] of c.w){ret+=ww*(rmap.get(sym)??0)/coh.length;gr+=Math.abs(ww)/coh.length;}}
  out.push(ret*(2/Math.max(1e-9,gr))-(1/Math.max(1,coh.length))*FEE_BP/1e4);
  ts.push(t);
}
const m=mean(out),sd=sdv(out)||1e-9;
let cum=1,pk=1,dd=0,cur=0,longest=0;
for(const x of out){cum*=1+x; if(cum>=pk){pk=cum;longest=Math.max(longest,cur);cur=0;} else cur++; dd=Math.min(dd,cum/pk-1);}
longest=Math.max(longest,cur);
console.log(`\n    HOURLY BOOK  n=${out.length.toLocaleString()}h  ${(m*HPY*100).toFixed(1)}%/yr  SR ${((m/sd)*Math.sqrt(HPY)).toFixed(2)}  t ${(m/(sd/Math.sqrt(out.length))).toFixed(2)}  maxDD ${(dd*100).toFixed(0)}%`);
console.log(`    HOLDABILITY: longest underwater ${longest.toLocaleString()} hours = ${(longest/24).toFixed(0)} days = ${(longest/8760).toFixed(2)} years`);
console.log(`    bets/yr ~ ${(HPY/HOLD).toFixed(0)} (daily book at 5d hold: 73)`);
await Deno.writeTextFile(`/Users/ona/aegis-data/crypto_hourly_top${TOPN}_hold${HOLD}.tsv`,ts.map((t,i)=>`${new Date(t*1000).toISOString()}\t${out[i]}`).join("\n"));
