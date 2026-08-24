#!/usr/bin/env -S deno run --allow-net --allow-env
// check-factor-timing.ts (D-529) — DOES ANYTHING PREDICT WHICH PREMIA WORK NEXT?
// D-528 showed in-sample strength is anti-predictive across our six components (n=6, one transition). This asks it
// properly: across ~18 classic long-short premia and six decades, does a premium's TRAILING k-year return predict its
// NEXT k-year return? PRE-REGISTERED, two declared horizons (k=3, k=5), NON-OVERLAPPING windows only (pseudo-
// replication law), rank IC per transition and a t across transitions. Outcomes: IC<0 => factor MEAN-REVERSION (buy
// the beaten-down premium); IC>0 => persistence; IC~0 => nothing predicts and equal-weight-forever is optimal.
// Underpowered by construction (n = transitions, ~10-20) — the power limit is stated, not hidden. Trials +2.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ft",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const spear=(a:number[],b:number[])=>{const n=a.length;if(n<4)return NaN;
  const ra=[...a.keys()].sort((i,j)=>a[i]-a[j]),rb=[...a.keys()].sort((i,j)=>b[i]-b[j]);
  const A=new Array(n),B=new Array(n);ra.forEach((i,r)=>A[i]=r);rb.forEach((i,r)=>B[i]=r);
  const m=(n-1)/2;let nu=0,d1=0,d2=0;for(let i=0;i<n;i++){nu+=(A[i]-m)*(B[i]-m);d1+=(A[i]-m)**2;d2+=(B[i]-m)**2;}
  return d1&&d2?nu/Math.sqrt(d1*d2):NaN;};
const ff:{month:string;factor:string;ret:number}[]=[];
for(let off=0;;off+=10000){
  const p=await fetch(`${OWNED}/trd_ff_factors?factor=like.*:*&select=month,factor,ret&order=month,factor&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break; ff.push(...p); if(p.length<10000)break;}
const byF=new Map<string,Map<string,number>>();
for(const r of ff)(byF.get(r.factor)??byF.set(r.factor,new Map()).get(r.factor)!).set(String(r.month).slice(0,7),+r.ret);
const g=(f:string)=>byF.get(f);
// classic long-short premia, literature side pre-registered (same construction as PASS 5b)
const SPECS:[string,"Lo"|"Hi"][]=[["mom10","Hi"],["strev10","Lo"],["ltrev10","Lo"],["op10","Hi"],["inv10","Lo"],
  ["ep10","Hi"],["cfp10","Hi"],["dp10","Hi"],["ac10","Lo"],["ni10","Lo"],["var10","Lo"],["resvar10","Lo"],["beta10","Lo"]];
const pick=(pre:string,side:string)=>{const c=[...byF.keys()].filter(k=>k.startsWith(pre+":")&&k.split(":")[1].startsWith(side));
  const d=c.filter(k=>/_10$/.test(k)); return d.length===1?g(d[0]):c.length===1?g(c[0]):null;};
const premia=new Map<string,Map<string,number>>();
for(const [pre,side] of SPECS){
  const L=pick(pre,side),S=pick(pre,side==="Hi"?"Lo":"Hi");
  if(!L||!S)continue;
  const m=new Map<string,number>();
  for(const [mo,v] of L)if(S.has(mo))m.set(mo,v-S.get(mo)!);
  if(m.size>360)premia.set(pre,m);
}
// international premia from the intl library (same sides)
{const L=g("dxwml:WML"); if(L&&L.size>240)premia.set("dxwml",new Map(L));}
{const H=g("dxff3:HML"); if(H&&H.size>240)premia.set("dxhml",new Map(H));}
{const E=g("emmom:WML"); if(E&&E.size>240)premia.set("emmom",new Map(E));}
{const V=g("emff5:HML"); if(V&&V.size>240)premia.set("emhml",new Map(V));}
const names=[...premia.keys()];
console.log(`==> FACTOR TIMING TEST (D-529) — ${names.length} premia: ${names.join(", ")}`);
const allMo=[...new Set(names.flatMap(n=>[...premia.get(n)!.keys()]))].sort();
const counts:Record<number,number>={};
for(const K of [3,5]){
  const step=K*12;
  const wins:string[][]=[];
  for(let i=0;i+step<=allMo.length;i+=step)wins.push(allMo.slice(i,i+step));
  const ics:number[]=[];
  for(let w=1;w<wins.length;w++){
    const prev=wins[w-1],cur=wins[w];
    const a:number[]=[],b:number[]=[];
    for(const n of names){
      const m=premia.get(n)!;
      const pv=prev.map(mo=>m.get(mo)).filter(x=>x!==undefined) as number[];
      const cv=cur.map(mo=>m.get(mo)).filter(x=>x!==undefined) as number[];
      if(pv.length<step*0.8||cv.length<step*0.8)continue;
      a.push(mean(pv)); b.push(mean(cv));
    }
    if(a.length>=8){const ic=spear(a,b);if(Number.isFinite(ic))ics.push(ic);}
  }
  if(ics.length<4){console.log(`    k=${K}y: only ${ics.length} usable transitions — UNTESTED`);continue;}
  counts[K]=ics.length;
  const m=mean(ics),t=m/((sdv(ics)||1e-9)/Math.sqrt(ics.length));
  console.log(`    k=${K}y  transitions=${ics.length} (non-overlapping)  mean rank-IC ${m>=0?"+":""}${m.toFixed(3)}  t ${t.toFixed(2)}`);
  console.log(`      -> ${t<=-2?"MEAN-REVERSION: buy the beaten-down premium":t>=2?"PERSISTENCE: back the winners":"NOTHING PREDICTS at this power (equal-weight-forever is the honest default)"}`);
}
console.log(`    POWER NOTE: n is the number of NON-OVERLAPPING transitions actually usable (k=3y: ${counts[3]??0}, k=5y: ${counts[5]??0}). Overlapping windows`);
console.log(`    would inflate n by ~60x and the t with it — the pseudo-replication law forbids it. A null here is`);
console.log(`    "no strong effect detectable with a century of data", not proof of exact zero.`);
for(const rk of ["factor-timing-D529-k3","factor-timing-D529-k5"]){
  const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,"Content-Type":"application/json",Prefer:"return=minimal"},
    body:JSON.stringify({family:"adhoc",run_key:rk})}).catch(()=>null);
  if(!tw||(!tw.ok&&tw.status!==409))console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
