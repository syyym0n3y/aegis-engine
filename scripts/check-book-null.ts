#!/usr/bin/env -S deno run --allow-net --allow-env
// check-book-null.ts (D-558) — HOW MUCH OF THE BOOK'S t IS SELECTION INFLATION?
// The equity book's t 6.21 clears the 5.34 ceiling, but its six components were chosen in-sample (D-557: the gate
// cannot see that). The decisive test is a NULL DISTRIBUTION: build books from RANDOMLY chosen components out of the
// same candidate pool, using the identical equal-vol construction, and see what t's arise by chance. If the real
// book's t sits inside that distribution, its excess over the ceiling is selection inflation, not evidence.
// Deterministic seed (the runtime forbids Math.random in workflows; here we use a fixed LCG so the test is repeatable).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"bn",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const ff:{month:string;factor:string;ret:number}[]=[];
for(let off=0;;off+=10000){
  const p=await fetch(`${OWNED}/trd_ff_factors?factor=like.*:*&select=month,factor,ret&order=month,factor&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break; ff.push(...p); if(p.length<10000)break;}
const byF=new Map<string,Map<string,number>>();
for(const r of ff)(byF.get(r.factor)??byF.set(r.factor,new Map()).get(r.factor)!).set(String(r.month).slice(0,7),+r.ret);
const pick=(pre:string,side:string)=>{const c=[...byF.keys()].filter(k=>k.startsWith(pre+":")&&k.split(":")[1].startsWith(side));
  const d=c.filter(k=>/_10$/.test(k)); return d.length===1?byF.get(d[0]):c.length===1?byF.get(c[0]):null;};
// CANDIDATE POOL: every classic long-short premium available, literature-sided — the pool the six were chosen FROM
const POOL:[string,"Hi"|"Lo"][]=[["mom10","Hi"],["strev10","Lo"],["ltrev10","Lo"],["op10","Hi"],["inv10","Lo"],
  ["ep10","Hi"],["cfp10","Hi"],["dp10","Hi"],["ac10","Lo"],["ni10","Lo"],["var10","Lo"],["resvar10","Lo"],["beta10","Lo"]];
const streams:Map<string,Map<string,number>>=new Map();
for(const [pre,side] of POOL){
  const L=pick(pre,side),S=pick(pre,side==="Hi"?"Lo":"Hi");
  if(!L||!S)continue;
  const m=new Map<string,number>();
  for(const [mo,v] of L)if(S.has(mo))m.set(mo,v-S.get(mo)!-0.0005);
  if(m.size>240)streams.set(pre,m);
}
const names=[...streams.keys()];
console.log(`==> BOOK NULL DISTRIBUTION (D-558) — pool of ${names.length} literature-sided premia`);
const bookT=(sel:string[])=>{
  const w=new Map<string,number>();
  for(const n of sel){const v=[...streams.get(n)!.values()];w.set(n,1/(sdv(v)||1e-9));}
  const ws=[...w.values()].reduce((s,x)=>s+x,0); for(const [k,v] of w)w.set(k,v/ws);
  const all=new Set<string>(); for(const n of sel)for(const mo of streams.get(n)!.keys())all.add(mo);
  const mos=[...all].sort().filter(mo=>sel.filter(n=>streams.get(n)!.has(mo)).length>=Math.min(3,sel.length));
  const rets=mos.map(mo=>{let num=0,den=0;
    for(const n of sel){const v=streams.get(n)!.get(mo);if(v!==undefined){num+=w.get(n)!*v;den+=w.get(n)!;}}
    return num/den;});
  if(rets.length<200)return null;
  const m=mean(rets),sd=sdv(rets)||1e-9;
  return {t:m/(sd/Math.sqrt(rets.length)),sr:(m/sd)*Math.sqrt(12),n:rets.length};};
// deterministic LCG
let seed=20260825;
const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const ts:number[]=[];
for(let trial=0;trial<400;trial++){
  const pool=[...names];
  const sel:string[]=[];
  while(sel.length<6&&pool.length)sel.push(pool.splice(Math.floor(rnd()*pool.length),1)[0]);
  const r=bookT(sel);
  if(r)ts.push(r.t);
}
ts.sort((a,b)=>a-b);
const q=(p:number)=>ts[Math.min(ts.length-1,Math.floor(p*ts.length))];
console.log(`    ${ts.length} random 6-component books from the same pool, identical equal-vol construction:`);
console.log(`      median t ${q(0.5).toFixed(2)}   90th pct ${q(0.9).toFixed(2)}   95th ${q(0.95).toFixed(2)}   99th ${q(0.99).toFixed(2)}   max ${ts[ts.length-1].toFixed(2)}`);
const ACTUAL=6.21;
const above=ts.filter(x=>x>=ACTUAL).length;
console.log(`\n    the actual book scored t ${ACTUAL}. ${above} of ${ts.length} RANDOM books scored at least that (${(100*above/ts.length).toFixed(1)}%).`);
console.log(`    -> ${above/ts.length>0.10?"THE BOOK'S t IS UNREMARKABLE against random selection from the same pool — its excess over the 5.34 ceiling is selection inflation, not evidence":above/ts.length>0.05?"borderline: the book beats most random selections but not decisively":"the book's construction does beat random selection at the 5% level"}`);
console.log(`    NOTE: this measures SELECTION inflation only. Every random book here is still built from premia that`);
console.log(`    are themselves the survivors of a century of published research — the pool is not neutral.`);
