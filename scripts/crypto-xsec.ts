#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-xsec.ts (D-402) — CROSS-SECTIONAL crypto, a genuinely different mechanism from everything tested so far. All prior
// crypto work was TIME-SERIES (each coin vs its own trend). This ranks coins AGAINST EACH OTHER and goes long the top /
// short the bottom — market-neutral by construction, so it cannot be crypto beta in disguise (the trap that inflated D-392).
// Signals: cross-sectional momentum (1w/1m/3m), cross-sectional REVERSAL (documented to dominate momentum in crypto), and
// relative VOLATILITY. Exchange-quality data (D-397). Within-day cross-sections, net of realistic crypto costs, train/test.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cx2",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.crypto_ex&select=symbol,bars`,{headers:hdr}).then(r=>r.json()) as {symbol:string;bars:number[][]}[];
const inst=rows.map(r=>({sym:r.symbol,m:new Map<string,number>(r.bars.map(b=>[new Date(b[0]*1000).toISOString().slice(0,10),b[4]] as [string,number]))}))
  .filter(x=>{const v=[...x.m.values()]; if(v.length<400)return false; let mx=0,mn=Infinity;
    for(let i=1;i<v.length;i++){if(v[i-1]>0){const q=Math.abs(v[i]/v[i-1]-1);if(q>mx)mx=q;} if(v[i]>0&&v[i]<mn)mn=v[i];}
    return mx<=10&&mn>=0.01 && !x.sym.startsWith("USDT");});   // drop stablecoin (no cross-sectional signal)
console.log(`==> CROSS-SECTIONAL CRYPTO: ${inst.length} instruments (exchange-quality)`);
const dates=[...new Set(inst.flatMap(i=>[...i.m.keys()]))].sort();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const tstat=(a:number[])=>{const m=mean(a);const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));return sd>0?m/(sd/Math.sqrt(a.length)):0;};
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<6)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};
const SIGS:[string,number,number][]=[  // [name, lookback days, hold days]
  ["xsec MOMENTUM 1w -> 1w",7,7],["xsec MOMENTUM 1m -> 1m",30,30],["xsec MOMENTUM 3m -> 1m",90,30],
  ["xsec REVERSAL 1w -> 1w",-7,7],["xsec REVERSAL 1d -> 1d",-1,1],
];
for(const [nm,lbRaw,hold] of SIGS){
  const lb=Math.abs(lbRaw), rev=lbRaw<0;
  const ics:number[]=[], ls:number[]=[];
  for(let d=lb+5; d<dates.length-hold; d+=hold){         // non-overlapping holds
    const now=dates[d], past=dates[d-lb], fut=dates[d+hold];
    const pts:{sig:number;fwd:number}[]=[];
    for(const i of inst){const p0=i.m.get(now),pl=i.m.get(past),pf=i.m.get(fut);
      if(!p0||!pl||!pf||!(p0>0)||!(pl>0))continue;
      const s=p0/pl-1, f=pf/p0-1; if(!Number.isFinite(s)||!Number.isFinite(f))continue;
      pts.push({sig:rev?-s:s,fwd:f});}
    if(pts.length<8) continue;
    ics.push(rankIC(pts.map(p=>p.sig),pts.map(p=>p.fwd)));
    const s2=[...pts].sort((a,b)=>a.sig-b.sig); const q=Math.max(1,Math.floor(s2.length/3));
    ls.push(mean(s2.slice(s2.length-q).map(p=>p.fwd))-mean(s2.slice(0,q).map(p=>p.fwd)));
  }
  if(ls.length<20){console.log(`  ${nm}: thin (${ls.length})`);continue;}
  const cost=0.004;                                       // 2 legs x 20bp crypto round-trip
  const per=365/hold, sp=Math.floor(ls.length*0.6);
  const rep=(t:string,ic:number[],l:number[])=>{const m=mean(l)-cost;const sd=Math.sqrt(l.reduce((s,x)=>s+(x-mean(l))**2,0)/(l.length-1));
    return `${t} IC ${mean(ic).toFixed(4)}(t${tstat(ic).toFixed(2)}) NET ${(m*100).toFixed(2)}%/${hold}d ann ${(m*per*100).toFixed(0)}% SR ${(sd>0?(m/sd)*Math.sqrt(per):0).toFixed(2)}`;};
  console.log(`\n  ${nm}  (n=${ls.length} periods)`);
  console.log(`    ${rep("FULL:",ics,ls)}`);
  console.log(`    ${rep("TEST:",ics.slice(sp),ls.slice(sp))}`);
}
