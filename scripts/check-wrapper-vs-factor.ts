#!/usr/bin/env -S deno run --allow-net --allow-env
// check-wrapper-vs-factor.ts (D-555) — did the FACTORS fail in the ETF era, or only their WRAPPERS?
// D-554's sign audit showed value/quality/size/low-vol all went AGAINST their literature signs in ETF form since 2013.
// Two very different worlds: (a) the academic long-shorts were also negative -> the factors failed, and no vehicle
// would have helped; (b) the academic long-shorts were positive -> the WRAPPER is the problem (long-only tilts vs SPY
// are not the same instrument as a decile long-short), and the search for a placeable vehicle is not yet exhausted.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"wf",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FROM="2013-08";
// ---- academic side: French decile long-shorts, literature sides ----
const ff:{month:string;factor:string;ret:number}[]=[];
for(let off=0;;off+=10000){
  const p=await fetch(`${OWNED}/trd_ff_factors?factor=like.*:*&select=month,factor,ret&order=month,factor&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break; ff.push(...p); if(p.length<10000)break;}
const byF=new Map<string,Map<string,number>>();
for(const r of ff)(byF.get(r.factor)??byF.set(r.factor,new Map()).get(r.factor)!).set(String(r.month).slice(0,7),+r.ret);
const pick=(pre:string,side:string)=>{const c=[...byF.keys()].filter(k=>k.startsWith(pre+":")&&k.split(":")[1].startsWith(side));
  const d=c.filter(k=>/_10$/.test(k)); return d.length===1?byF.get(d[0]):c.length===1?byF.get(c[0]):null;};
const acad=(pre:string,longSide:"Hi"|"Lo")=>{
  const L=pick(pre,longSide),S=pick(pre,longSide==="Hi"?"Lo":"Hi");
  if(!L||!S)return null;
  const mos=[...L.keys()].filter(m=>m>=FROM&&S.has(m)).sort();
  return mos.length>60?mos.map(m=>L.get(m)!-S.get(m)!):null;};
// ---- ETF side: long tilt minus SPY ----
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[]))if(b[4]>0)m.set(new Date(b[0]*1000).toISOString().slice(0,10).slice(0,7),b[4]);   // last close of month
  return m;};
const px=new Map<string,Map<string,number>>();
for(const s of ["MTUM","VLUE","QUAL","USMV","IWM","SPY"])px.set(s,await load(s));
const etf=(a:string,b:string)=>{
  const A=px.get(a)!,B=px.get(b)!;
  const mos=[...A.keys()].filter(m=>m>=FROM&&B.has(m)).sort();
  const out:number[]=[];
  for(let i=1;i<mos.length;i++){
    const ra=A.get(mos[i])!/A.get(mos[i-1])!-1, rb=B.get(mos[i])!/B.get(mos[i-1])!-1;
    out.push(ra-rb);}
  return out.length>60?out:null;};
const stat=(v:number[]|null)=>v?`${(mean(v)*12*100).toFixed(1).padStart(6)}%/yr  t ${(mean(v)/((sdv(v)||1e-9)/Math.sqrt(v.length))).toFixed(2).padStart(5)}`:"   n/a";
console.log(`==> WRAPPER vs FACTOR since ${FROM} — did the factors fail, or only their ETF vehicles?`);
console.log(`    ${"factor".padEnd(12)}${"ACADEMIC decile L/S".padEnd(26)}ETF tilt vs SPY`);
const PAIRS:[string,string,"Hi"|"Lo",string,string][]=[
  ["momentum","mom10","Hi","MTUM","SPY"],
  ["value","ep10","Hi","VLUE","SPY"],
  ["quality","op10","Hi","QUAL","SPY"],
  ["low-vol","var10","Lo","USMV","SPY"],
  ["size","ni10","Lo","IWM","SPY"],
];
for(const [label,pre,side,a,b] of PAIRS){
  console.log(`    ${label.padEnd(12)}${stat(acad(pre,side)).padEnd(26)}${stat(etf(a,b))}`);
}
console.log(`\n    NOTE: the academic column is an extreme-decile LONG-SHORT over thousands of names; the ETF column is a`);
console.log(`    long-only tilt minus SPY. They are different instruments, which is exactly the question under test.`);
console.log(`    size uses net-issuance deciles academically (the closest available long-short) vs IWM-SPY — imperfect, stated.`);
