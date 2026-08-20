#!/usr/bin/env -S deno run --allow-net --allow-env
// trend-overlay-portfolio.ts (D-401) — does the drawdown protection COMPOUND across asset classes? D-400 showed trend cuts
// drawdown in 6 of 7 classes individually. The practical question is portfolio-level: a diversified multi-asset book with a
// trend overlay vs the same book held passively. If the protection compounds (drawdowns are not synchronised across classes)
// the overlay is a genuine portfolio risk tool. Also measures behaviour in the ACTUAL crises — that is where "crisis alpha"
// is claimed to live, and where a risk overlay either earns its keep or does not.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"to",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H(); const LB=Number(Deno.env.get("LB")||100), COST=0.00001;
const CLASSES=["etf","index","sector","commodity","fx","equity","crypto_ex"];
// load instruments per class, quality-filtered (D-395 lesson)
const byCls=new Map<string,{sym:string;m:Map<string,number>}[]>();
for(const cls of CLASSES){
  const lim=cls==="equity"?150:200;
  const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.${cls}&select=symbol,bars&limit=${lim}`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  const keep:{sym:string;m:Map<string,number>}[]=[];
  for(const r of (Array.isArray(rows)?rows:[])){
    const c=r.bars.map(b=>b[4]); if(c.length<LB+400) continue;
    let mx=0,minp=Infinity; for(let i=1;i<c.length;i++){if(c[i-1]>0){const q=Math.abs(c[i]/c[i-1]-1);if(q>mx)mx=q;} if(c[i]>0&&c[i]<minp)minp=c[i];}
    if(mx>10||minp<0.01) continue;
    const m=new Map<string,number>(); r.bars.forEach(b=>m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]));
    keep.push({sym:r.symbol,m});
  }
  if(keep.length>=3) byCls.set(cls,keep);
}
console.log(`==> TREND OVERLAY, PORTFOLIO LEVEL — classes: ${[...byCls.entries()].map(([c,a])=>`${c}(${a.length})`).join(" ")}`);
const dates=[...new Set([...byCls.values()].flat().flatMap(i=>[...i.m.keys()]))].sort();
// equal RISK across classes (each class contributes equally), each instrument equal-weight within its class
const ov:number[]=[], pas:number[]=[]; const keptDates:string[]=[];
for(let d=LB+30; d<dates.length-1; d++){
  const day=dates[d], nxt=dates[d+1], lag=dates[d-LB];
  let ovSum=0, pasSum=0, nCls=0;
  for(const [,list] of byCls){
    let ro=0, rp=0, n=0;
    for(const i of list){const p0=i.m.get(day), p1=i.m.get(nxt), pl=i.m.get(lag);
      if(!p0||!p1||!pl||!(p0>0)||!(pl>0)) continue; const ret=p1/p0-1; if(!Number.isFinite(ret)) continue;
      ro+=(p0/pl-1>0?1:0)*ret; rp+=ret; n++;}
    if(n<3) continue;
    ovSum+=ro/n; pasSum+=rp/n; nCls++;
  }
  if(nCls<3) continue;
  ov.push(ovSum/nCls-COST); pas.push(pasSum/nCls); keptDates.push(day);
}
const stat=(a:number[])=>{const n=a.length;const m=a.reduce((s,x)=>s+x,0)/n;const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(n-1));
  let cum=1,peak=1,dd=0; for(const r of a){cum*=1+r;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  return {sharpe:+((sd>0?m/sd:0)*Math.sqrt(252)).toFixed(2),ann:+(m*252*100).toFixed(1),dd:+(dd*100).toFixed(1),vol:+(sd*Math.sqrt(252)*100).toFixed(1),n};};
const O=stat(ov), P=stat(pas);
console.log(`\n  DIVERSIFIED PASSIVE : SR ${P.sharpe}  ann ${P.ann}%  vol ${P.vol}%  maxDD ${P.dd}%  (${P.n} days)`);
console.log(`  DIVERSIFIED + TREND : SR ${O.sharpe}  ann ${O.ann}%  vol ${O.vol}%  maxDD ${O.dd}%`);
console.log(`  -> drawdown advantage ${(O.dd-P.dd).toFixed(1)}pp | return give-up ${(O.ann-P.ann).toFixed(1)}pp/yr | vol reduction ${(P.vol-O.vol).toFixed(1)}pp`);
const sp=Math.floor(ov.length*0.6);
const Ot=stat(ov.slice(sp)), Pt=stat(pas.slice(sp));
console.log(`  OOS: passive SR ${Pt.sharpe} dd ${Pt.dd}%  |  overlay SR ${Ot.sharpe} dd ${Ot.dd}%  -> dd advantage ${(Ot.dd-Pt.dd).toFixed(1)}pp`);
// CRISIS windows — where a risk overlay must earn its keep
const CRISES:[string,string,string][]=[["GFC","2007-10-01","2009-03-31"],["COVID","2020-02-01","2020-04-30"],["2022 bear","2022-01-01","2022-10-31"],["2018 Q4","2018-10-01","2018-12-31"]];
console.log(`\n  CRISIS WINDOWS (cumulative return, passive vs overlay):`);
for(const [nm,a,b] of CRISES){
  const idx=keptDates.map((d,i)=>({d,i})).filter(x=>x.d>=a&&x.d<=b).map(x=>x.i);
  if(idx.length<20){console.log(`    ${nm.padEnd(10)}: (no data)`);continue;}
  const cum=(arr:number[])=>{let c=1;for(const i of idx)c*=1+arr[i];return (c-1)*100;};
  const cp=cum(pas), co=cum(ov);
  console.log(`    ${nm.padEnd(10)}: passive ${cp.toFixed(1)}%  overlay ${co.toFixed(1)}%  -> ${(co-cp)>0?"+":""}${(co-cp).toFixed(1)}pp`);
}
