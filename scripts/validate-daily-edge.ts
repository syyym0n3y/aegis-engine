#!/usr/bin/env -S deno run --allow-net --allow-env
// validate-daily-edge.ts (D-385) — F15 FIX: the daily engine's `edge` score had NEVER been validated against forward returns.
// Its constants were tuned by looking at output (full-sample selection by inspection). This RE-BUILDS the exact score
// point-in-time through history and asks the only question that matters: does a higher edge actually predict a better
// forward return? Reports IC by horizon, decile spreads NET of cost+borrow, and a strict TRAIN/TEST split so the answer
// isn't the same in-sample flattery. Audit-corrected throughout: log-pace accel (F16), paginated fetch (F19), liquidity
// floor, borrow cost on shorts (F18), and it MEASURES the turbulent-regime bucket instead of silently dropping it (F17).
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"val",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const H = async () => { const t = await jwt(); return { "Content-Type":"application/json", Authorization:`Bearer ${t}`, apikey:t }; };
const hdr = await H();
const HZ = Number(Deno.env.get("HZ") || 21);          // forward horizon (trading days)
const COST = 0.002;                                    // 20bp round-trip
const BORROW_M = 0.03/12;                              // F18: 3%/yr borrow on the short leg (conservative-low for hard-to-borrow)
const rankIC=(xs:number[],ys:number[])=>{const n=xs.length;if(n<20)return 0;const rk=(a:number[])=>{const ix=a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);const r=new Array(n);for(let k=0;k<n;k++)r[ix[k][1]]=k;return r;};const rx=rk(xs),ry=rk(ys),mx=(n-1)/2;let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){const dx=rx[i]-mx,dy=ry[i]-mx;sxy+=dx*dy;sx+=dx*dx;sy+=dy*dy;}return sx>0&&sy>0?sxy/Math.sqrt(sx*sy):0;};

// F19: PAGINATE (the daily engine fetched meta unpaged — silently capped at 1000 against any db-max-rows backend)
const meta:{symbol:string;asset_class:string}[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?select=symbol,asset_class&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
console.log(`==> VALIDATE DAILY EDGE (F15) — universe ${meta.length}, horizon ${HZ}d`);

type Obs={date:string;edge:number;dir:string;fwd:number;regime:string;align:number;cls:string};
const obs:Obs[]=[];
for(let i=0;i<meta.length;i+=25){
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",")})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const row of rows){
    const b=row.bars; if(!b||b.length<600) continue;
    const cls=meta.find(m=>m.symbol===row.symbol)!.asset_class;
    const c=b.map(r=>r[4]), v=b.map(r=>r[5]), ts=b.map(r=>r[0]);
    // sample every 21 trading days (non-overlapping-ish) through history
    for(let k=520;k<c.length-HZ;k+=21){
      const px=c[k]; if(!(px>0)) continue;
      let dv=0,cn=0; for(let j=k-21;j<k;j++){if(c[j]>0&&v[j]>0){dv+=c[j]*v[j];cn++;}} dv=cn?dv/cn:0;
      if(cls==="equity"&&dv<5e6) continue;                       // liquidity floor (point-in-time)
      const t21=c[k]/c[k-21]-1,t63=c[k]/c[k-63]-1,t252=c[k]/c[k-252]-1;
      if(![t21,t63,t252].every(Number.isFinite))continue;
      const sg=[Math.sign(t21),Math.sign(t63),Math.sign(t252)];const up=sg.filter(s=>s>0).length,dn=sg.filter(s=>s<0).length;
      const align=Math.max(up,dn); if(align<2) continue; const dir=up>dn?"LONG":"SHORT";
      const rets:number[]=[];for(let j=k-504;j<=k;j++)if(j>0&&c[j-1]>0)rets.push(c[j]/c[j-1]-1);
      const rvNow=Math.sqrt(rets.slice(-21).reduce((s,x)=>s+x*x,0)/21);
      const win:number[]=[];for(let j=21;j<rets.length;j++)win.push(Math.sqrt(rets.slice(j-21,j).reduce((s,x)=>s+x*x,0)/21));
      const volpct=win.length?win.filter(x=>x<=rvNow).length/win.length:0.5;
      const regime=volpct<0.4?"calm":volpct>0.75?"turbulent":"normal";   // F17: KEEP turbulent, measure it
      const rvAnn=rvNow*Math.sqrt(252)||0.1;
      const strength=Math.tanh(Math.abs(t63)/(rvAnn*Math.sqrt(63/252)||0.1));
      // F16: log-pace (simple returns don't scale linearly; the old test penalised the strongest trenders)
      const pace21=Math.log1p(t21)/21, pace252=Math.log1p(t252)/252;
      const accel=(dir==="LONG"? pace21>pace252 : pace21<pace252)?1.2:1.0;
      const edge=(align===3?1.5:1.0)*strength*accel*(regime==="calm"?1.15:1.0)*100;
      const fwdRaw=c[k+HZ]/c[k]-1; if(!Number.isFinite(fwdRaw))continue;
      const signed=(dir==="LONG"?1:-1)*fwdRaw;                    // directional return of taking the setup
      obs.push({date:new Date(ts[k]*1000).toISOString().slice(0,10),edge,dir,fwd:signed,regime,align,cls});
    }
  }
}
console.log(`observations: ${obs.length}`);
if(obs.length<500){console.log("insufficient — abort");Deno.exit(0);}
obs.sort((a,b)=>a.date<b.date?-1:1);
const cut=obs[Math.floor(obs.length*0.6)].date;
const IS=obs.filter(o=>o.date<cut),OOS=obs.filter(o=>o.date>=cut);
const rep=(name:string,set:Obs[])=>{
  if(set.length<200){console.log(`  ${name}: too few (${set.length})`);return;}
  const ic=rankIC(set.map(o=>o.edge),set.map(o=>o.fwd));
  const s=[...set].sort((a,b)=>a.edge-b.edge);const d=Math.floor(s.length/10);
  const top=s.slice(s.length-d),bot=s.slice(0,d);
  const mTop=top.reduce((a,o)=>a+o.fwd,0)/d, mBot=bot.reduce((a,o)=>a+o.fwd,0)/d;
  const shortShare=top.filter(o=>o.dir==="SHORT").length/d;
  const netTop=mTop-COST-shortShare*BORROW_M*(HZ/21);
  const mean=set.reduce((a,o)=>a+o.fwd,0)/set.length;
  const sd=Math.sqrt(set.reduce((a,o)=>a+(o.fwd-mean)**2,0)/(set.length-1));
  console.log(`  ${name}: n=${set.length} IC(edge->fwd)=${ic.toFixed(4)} | top-decile ${(mTop*100).toFixed(2)}% NET ${(netTop*100).toFixed(2)}% | bottom ${(mBot*100).toFixed(2)}% | spread ${((mTop-mBot)*100).toFixed(2)}% | all-setups mean ${(mean*100).toFixed(2)}% (sd ${(sd*100).toFixed(1)}%)`);
};
console.log(`\n=== does EDGE predict? (train/test split at ${cut}) ===`);
rep("IN-SAMPLE ",IS); rep("OUT-SAMPLE",OOS); rep("FULL      ",obs);
console.log("\n=== by regime (F17: is standing aside in turbulence right?) ===");
for(const rg of ["calm","normal","turbulent"]){const set=obs.filter(o=>o.regime===rg);if(set.length<200){console.log(`  ${rg}: n=${set.length} (thin)`);continue;}const m=set.reduce((a,o)=>a+o.fwd,0)/set.length;const ic=rankIC(set.map(o=>o.edge),set.map(o=>o.fwd));console.log(`  ${rg.padEnd(9)}: n=${set.length} mean-setup ${(m*100).toFixed(2)}% IC ${ic.toFixed(4)}`);}
console.log("\n=== by alignment ===");
for(const al of [2,3]){const set=obs.filter(o=>o.align===al);if(set.length<200)continue;const m=set.reduce((a,o)=>a+o.fwd,0)/set.length;console.log(`  ${al}/3 aligned: n=${set.length} mean-setup ${(m*100).toFixed(2)}%`);}
console.log("\n=== by direction (is the SHORT side real?) ===");
for(const dr of ["LONG","SHORT"]){const set=obs.filter(o=>o.dir===dr);if(set.length<200)continue;const m=set.reduce((a,o)=>a+o.fwd,0)/set.length;console.log(`  ${dr.padEnd(5)}: n=${set.length} mean-setup ${(m*100).toFixed(2)}%`);}

// ---- REFINED RULE, derived from IN-SAMPLE evidence then tested OUT-OF-SAMPLE (no tune-by-inspection) ----
// IS evidence said: (a) turbulent regimes lose, (b) the SHORT side loses (downtrends bounce at 21d). So the candidate rule is
// LONG-ONLY in NON-TURBULENT regimes. Both legs are theory-backed (trend pays in calm; equity shorts carry borrow + reversal).
console.log("\n=== REFINED RULE: LONG-only, non-turbulent — IS-derived, OOS-tested ===");
const rule=(o:Obs)=>o.dir==="LONG"&&o.regime!=="turbulent";
for(const [nm,set] of [["IN-SAMPLE ",IS],["OUT-SAMPLE",OOS]] as [string,Obs[]][]){
  const f=set.filter(rule); if(f.length<200){console.log(`  ${nm}: thin`);continue;}
  const m=f.reduce((a,o)=>a+o.fwd,0)/f.length;
  const sd=Math.sqrt(f.reduce((a,o)=>a+(o.fwd-m)**2,0)/(f.length-1));
  const ic=rankIC(f.map(o=>o.edge),f.map(o=>o.fwd));
  const net=m-COST;
  // per-period Sharpe of the equal-weight basket of all qualifying setups, annualised from the 21d horizon
  const sr=sd>0?(net/sd)*Math.sqrt(252/HZ):0;
  const win=100*f.filter(o=>o.fwd>COST).length/f.length;
  console.log(`  ${nm}: n=${f.length} mean ${(m*100).toFixed(2)}% NET ${(net*100).toFixed(2)}%/21d  ann~${(net*(252/HZ)*100).toFixed(1)}%  SR~${sr.toFixed(2)}  win ${win.toFixed(0)}%  IC(edge) ${ic.toFixed(4)}`);
}
// baseline: what did the average liquid instrument do over the same windows? (is this just beta?)
for(const [nm,set] of [["IN-SAMPLE ",IS],["OUT-SAMPLE",OOS]] as [string,Obs[]][]){
  const lo=set.filter(o=>o.dir==="LONG"); if(!lo.length) continue;
  const m=lo.reduce((a,o)=>a+o.fwd,0)/lo.length;
  console.log(`  ${nm} BASELINE all-LONG-setups (no regime filter): ${(m*100).toFixed(2)}%/21d`);
}
