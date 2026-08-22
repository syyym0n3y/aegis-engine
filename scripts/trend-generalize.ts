#!/usr/bin/env -S deno run --allow-net --allow-env
// trend-generalize.ts (D-400) — does the ONE surviving finding GENERALISE? Long-only trend-following cut crypto drawdown by
// ~30pp with no return advantage, replicated across three data sources (D-392/395/397). The literature calls this "crisis
// alpha" and claims it holds across asset classes. If it does, the finding is a portfolio-level RISK OVERLAY rather than a
// crypto quirk — a materially bigger deal. If it does not, it is a crypto artifact and should be labelled as one.
// Tested per asset class: long-only 100d trend vs buy-and-hold, drawdown AND Sharpe, in-sample and out-of-sample.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"tg",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H=async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};};
const hdr=await H();
const LB=Number(Deno.env.get("LB")||100), COST=0.0005;
const stat=(a:number[])=>{const n=a.length;if(n<100)return null;const m=a.reduce((s,x)=>s+x,0)/n;const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(n-1));
  let cum=1,peak=1,dd=0; for(const r of a){cum*=1+r;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  return {sharpe:+((sd>0?m/sd:0)*Math.sqrt(252)).toFixed(2),ann:+(m*252*100).toFixed(1),dd:+(dd*100).toFixed(1),n};};
const CLASSES=["etf","index","sector","commodity","fx","rate","crypto_ex","equity"];
console.log(`==> DOES TREND-FOLLOWING'S DRAWDOWN PROTECTION GENERALISE? (long-only ${LB}d trend vs buy&hold, per asset class)`);
console.log(`    class          | TREND SR / dd        | BUY&HOLD SR / dd     | dd ADVANTAGE | OOS dd advantage`);
for(const cls of CLASSES){
  let rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.${cls}&select=symbol,bars&order=symbol&limit=200`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows)||rows.length<3) {console.log(`    ${cls.padEnd(14)} | (too few instruments)`); continue;}
  if(cls==="equity") rows=rows.slice(0,150);          // cap the equity pull for runtime
  // data-quality filter (the D-395 lesson: never trust a feed silently)
  const inst=rows.map(r=>({sym:r.symbol,ts:r.bars.map(b=>b[0]),c:r.bars.map(b=>b[4])}))
    .filter(x=>{ if(x.c.length<LB+300) return false; let mx=0,minp=Infinity;
      for(let i=1;i<x.c.length;i++){if(x.c[i-1]>0){const r=Math.abs(x.c[i]/x.c[i-1]-1); if(r>mx)mx=r;} if(x.c[i]>0&&x.c[i]<minp)minp=x.c[i];}
      return mx<=10 && minp>=0.01; });
  if(inst.length<3){console.log(`    ${cls.padEnd(14)} | (too few after quality filter)`); continue;}
  const dates=[...new Set(inst.flatMap(i=>i.ts.map(t=>new Date(t*1000).toISOString().slice(0,10))))].sort();
  const px=new Map<string,Map<string,number>>();
  for(const i of inst){const m=new Map<string,number>(); i.ts.forEach((t,k)=>m.set(new Date(t*1000).toISOString().slice(0,10),i.c[k])); px.set(i.sym,m);}
  const lo:number[]=[], bh:number[]=[];
  for(let d=LB+30; d<dates.length-1; d++){
    let rl=0,rb=0,w=0,nb=0;
    for(const i of inst){const m=px.get(i.sym)!; const p0=m.get(dates[d]),p1=m.get(dates[d+1]),pl=m.get(dates[d-LB]);
      if(!p0||!p1||!pl||!(p0>0)||!(pl>0))continue; const ret=p1/p0-1; if(!Number.isFinite(ret))continue;
      const up=p0/pl-1>0;
      rl+=(up?1:0)*ret; w+=1; rb+=ret; nb++;}
    if(!nb) continue;
    lo.push(rl/w - COST*0.02); bh.push(rb/nb);   // small turnover charge on the trend leg
  }
  const sp=Math.floor(lo.length*0.6);
  const L=stat(lo), B=stat(bh), Lt=stat(lo.slice(sp)), Bt=stat(bh.slice(sp));
  if(!L||!B){console.log(`    ${cls.padEnd(14)} | (insufficient history)`); continue;}
  // SIGN FIX (caught pre-report): drawdowns are NEGATIVE, so "trend better" = L.dd is closer to zero = L.dd - B.dd > 0.
  // The first version computed B.dd - L.dd and inverted every verdict.
  const adv=+(L.dd-B.dd).toFixed(1);                       // positive = trend has the SHALLOWER (better) drawdown
  const advOOS=(Lt&&Bt)?+(Lt.dd-Bt.dd).toFixed(1):NaN;
  console.log(`    ${cls.padEnd(14)} | ${String(L.sharpe).padStart(5)} / ${String(L.dd).padStart(6)}%      | ${String(B.sharpe).padStart(5)} / ${String(B.dd).padStart(6)}%      | ${String(adv).padStart(6)}pp     | ${Number.isFinite(advOOS)?String(advOOS).padStart(6)+"pp":"   n/a"}   (${inst.length} inst, ${L.n}d)`);
}
console.log(`\n  dd ADVANTAGE > 0 means trend-following had the SHALLOWER drawdown. The crypto result was ~+30pp.`);
