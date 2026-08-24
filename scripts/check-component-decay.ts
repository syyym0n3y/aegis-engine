const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cd",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const ff:{month:string;factor:string;ret:number}[]=[];
for(let off=0;;off+=10000){
  const p=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.szmom25:*,factor.like.dxwml:*,factor.like.dxff3:*,factor.like.ni10:*,factor.like.ind49:*,factor.like.mom10:*,factor.like.strev10:*,factor.like.ltrev10:*,factor.like.op10:*,factor.like.inv10:*)&select=month,factor,ret&order=month,factor&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break; ff.push(...p); if(p.length<10000)break;}
const byF=new Map<string,Map<string,number>>();
for(const r of ff)(byF.get(r.factor)??byF.set(r.factor,new Map()).get(r.factor)!).set(String(r.month).slice(0,7),+r.ret);
const g=(f:string)=>byF.get(f);
const streams=new Map<string,Map<string,number>>();
{const L=g("szmom25:BIG_HiPRIOR"),S=g("szmom25:BIG_LoPRIOR");
 if(L&&S){const m=new Map<string,number>();for(const [mo,v] of L)if(S.has(mo))m.set(mo,v-S.get(mo)!-0.0005);streams.set("bigmom",m);}}
{const W=g("dxwml:WML"); if(W){const m=new Map<string,number>();for(const [mo,v] of W)m.set(mo,v-0.0010);streams.set("dxwml",m);}}
{const H=g("dxff3:HML"); if(H){const m=new Map<string,number>();for(const [mo,v] of H)m.set(mo,v-0.0010);streams.set("dxhml",m);}}
{const ks=[...byF.keys()].filter(k=>k.startsWith("ni10:"));
 const lo=ks.filter(k=>/:Lo/.test(k)&&/_10$/.test(k))[0]??ks.filter(k=>/:Lo/.test(k))[0];
 const hi=ks.filter(k=>/:Hi/.test(k)&&/_10$/.test(k))[0]??ks.filter(k=>/:Hi/.test(k))[0];
 const L=lo?g(lo):null,S=hi?g(hi):null;
 if(L&&S){const m=new Map<string,number>();for(const [mo,v] of L)if(S.has(mo))m.set(mo,v-S.get(mo)!-0.0005);streams.set("ni",m);}}
{const ks=[...byF.keys()].filter(k=>k.startsWith("ind49:"));
 const months=[...(ks.length?g(ks[0])!.keys():[])].sort(); const m=new Map<string,number>();
 for(let i=12;i<months.length-2;i+=3){
   const sc=ks.map(k=>{const s=g(k)!;let cum=1,ok=true;for(let q=i-12;q<i;q++){const v=s.get(months[q]);if(v===undefined){ok=false;break;}cum*=1+v;}return {k,sc:ok?cum:NaN};}).filter(x=>Number.isFinite(x.sc));
   if(sc.length<40)continue; sc.sort((a,b)=>b.sc-a.sc);
   const L=sc.slice(0,5).map(x=>x.k),S=sc.slice(-5).map(x=>x.k);
   for(let h=0;h<3&&i+h<months.length-1;h++){const mo=months[i+h];
     m.set(mo,mean(L.map(k=>g(k)!.get(mo)??0))-mean(S.map(k=>g(k)!.get(mo)??0))-(h===0?0.0005:0));}}
 streams.set("ind49mom",m);}
{const F9:[string,string,string][]=[["mom10","Hi","Lo"],["strev10","Lo","Hi"],["ltrev10","Lo","Hi"],["op10","Hi","Lo"],["inv10","Lo","Hi"]];
 const fs=new Map<string,Map<string,number>>();
 const pick=(pre:string,side:string)=>{const c=[...byF.keys()].filter(k=>k.startsWith(pre+":")&&k.split(":")[1].startsWith(side));
   const d=c.filter(k=>/_10$/.test(k)); return d.length===1?g(d[0]):c.length===1?g(c[0]):null;};
 for(const [pre,ls,ss] of F9){const L=pick(pre,ls),S=pick(pre,ss);
   if(L&&S){const m=new Map<string,number>();for(const [mo,v] of L)if(S.has(mo))m.set(mo,v-S.get(mo)!);fs.set(pre,m);}}
 const names=[...fs.keys()], months=[...(fs.get(names[0])?.keys()??[])].sort(); const m=new Map<string,number>();
 for(let i=12;i<months.length;i++){
   const sc=names.map(n=>{const s=fs.get(n)!;let cum=1,ok=true;for(let q=i-12;q<i;q++){const v=s.get(months[q]);if(v===undefined){ok=false;break;}cum*=1+v;}return {n,sc:ok?cum:NaN};}).filter(x=>Number.isFinite(x.sc));
   if(sc.length<4)continue; sc.sort((a,b)=>b.sc-a.sc);
   m.set(months[i],mean(sc.slice(0,3).map(x=>fs.get(x.n)!.get(months[i])??0))-0.0005);}
 streams.set("factmom",m);}
console.log(`==> PER-COMPONENT ERA DECAY (D-527b, DESCRIPTIVE ONLY — no re-selection)`);
console.log(`    ${"component".padEnd(11)}${"full %/yr".padEnd(11)}${"full t".padEnd(9)}${"2006+ %/yr".padEnd(12)}${"2006+ t".padEnd(9)}${"2016+ %/yr".padEnd(12)}2016+ t`);
for(const [n,m] of streams){
  const all=[...m.entries()].sort();
  const seg=(from:string)=>{const v=all.filter(([mo])=>mo>=from).map(([,x])=>x);
    if(v.length<24)return null; const mu=mean(v),sd=sdv(v)||1e-9; return [mu*12*100, mu/(sd/Math.sqrt(v.length))];};
  const f=seg("0000")!,a=seg("2006-01"),b=seg("2016-01");
  console.log(`    ${n.padEnd(11)}${f[0].toFixed(1).padEnd(11)}${f[1].toFixed(2).padEnd(9)}${(a?a[0].toFixed(1):"-").padEnd(12)}${(a?a[1].toFixed(2):"-").padEnd(9)}${(b?b[0].toFixed(1):"-").padEnd(12)}${b?b[1].toFixed(2):"-"}`);
}
console.log(`\n    REFUSAL, stated: components are NOT re-picked on these modern-era numbers. Re-selecting on the same window`);
console.log(`    you then report is the SELECTION LAW trap (D-455). Any re-spec must be pre-registered and judged FORWARD.`);

// ============ D-528: THE SELECTION-LAW-COMPLIANT TEST OF SELECTIVITY ============
// PRE-REGISTERED: pick components using ONLY data through 2015-12 (keep those with train t >= 2), freeze that choice,
// and evaluate on 2016-01..2026 which the pick never saw. Compare against the BLANKET book (all six) on the same
// window. If selective > blanket, selectivity adds. D-455's precedent (the trend overlay) says it probably does not.
const TRAIN_END="2015-12", TEST_FROM="2016-01";
const names=[...streams.keys()];
const trainT=new Map<string,number>();
for(const n of names){
  const v=[...streams.get(n)!.entries()].filter(([mo])=>mo<=TRAIN_END).map(([,x])=>x);
  if(v.length<120){trainT.set(n,NaN);continue;}
  const mu=mean(v),sd=sdv(v)||1e-9; trainT.set(n,mu/(sd/Math.sqrt(v.length)));
}
const kept=names.filter(n=>Number.isFinite(trainT.get(n)!)&&trainT.get(n)!>=2);
console.log(`\n==> D-528 SELECTIVITY, TRAIN-ONLY PICK (train <= ${TRAIN_END}, test from ${TEST_FROM})`);
console.log(`    train t: ${names.map(n=>`${n} ${trainT.get(n)!.toFixed(2)}`).join("  |  ")}`);
console.log(`    kept by the train-only rule (t>=2): ${kept.length?kept.join(", "):"NONE"}`);
const bookOf=(ns:string[])=>{
  const w=new Map<string,number>();
  for(const n of ns){const v=[...streams.get(n)!.entries()].filter(([mo])=>mo<=TRAIN_END).map(([,x])=>x);
    w.set(n,1/(sdv(v)||1e-9));}                                   // weights ALSO train-only (no test-window info)
  const ws=[...w.values()].reduce((s,x)=>s+x,0); for(const [k,v] of w)w.set(k,v/ws);
  const all=new Set<string>(); for(const n of ns)for(const mo of streams.get(n)!.keys())if(mo>=TEST_FROM)all.add(mo);
  const mos=[...all].sort().filter(mo=>ns.filter(n=>streams.get(n)!.has(mo)).length>=Math.min(2,ns.length));
  return mos.map(mo=>{let num=0,den=0;
    for(const n of ns){const v=streams.get(n)!.get(mo);if(v!==undefined){num+=w.get(n)!*v;den+=w.get(n)!;}}
    return num/den;});};
const stat=(v:number[],label:string)=>{
  if(v.length<24){console.log(`    ${label}: too few test months (${v.length})`);return null;}
  const mu=mean(v),sd=sdv(v)||1e-9;
  console.log(`    ${label.padEnd(26)} n=${v.length}mo  ${(mu*12*100).toFixed(1)}%/yr  SR ${((mu/sd)*Math.sqrt(12)).toFixed(2)}  t ${(mu/(sd/Math.sqrt(v.length))).toFixed(2)}`);
  return v;};
const bBlank=stat(bookOf(names),"BLANKET (all 6)");
const bSel=kept.length?stat(bookOf(kept),`SELECTIVE (${kept.length} kept)`):null;
// SECOND DECLARED VARIANT (trial counted): keep only the TOP-3 by train t. Different question — "does backing the
// strongest components help?" — and the honest answer matters because factmom was the STRONGEST in train (t 6.20).
const top3=[...names].filter(n=>Number.isFinite(trainT.get(n)!)).sort((a,b)=>trainT.get(b)!-trainT.get(a)!).slice(0,3);
console.log(`    top-3 by TRAIN t (declared variant): ${top3.join(", ")}`);
const bTop=stat(bookOf(top3),"TOP-3 by train strength");
if(bBlank&&bTop){
  const n=Math.min(bBlank.length,bTop.length);
  const d=bTop.slice(-n).map((x,i)=>x-bBlank.slice(-n)[i]);
  const dt=mean(d)/((sdv(d)||1e-9)/Math.sqrt(d.length));
  console.log(`    top3 - blanket: ${(mean(d)*12*100).toFixed(2)}%/yr, paired t ${dt.toFixed(2)}  ->  ${dt>2?"backing the strongest ADDS":dt<-2?"backing the strongest HURTS — in-sample strength is anti-predictive":"null"}`);
}
if(bBlank&&bSel){
  const n=Math.min(bBlank.length,bSel.length);
  const d=bSel.slice(-n).map((x,i)=>x-bBlank.slice(-n)[i]);
  const dt=mean(d)/((sdv(d)||1e-9)/Math.sqrt(d.length));
  console.log(`    selective - blanket: ${(mean(d)*12*100).toFixed(2)}%/yr, paired t ${dt.toFixed(2)}  ->  ${dt>2?"SELECTIVITY ADDS (train-only pick, honest OOS)":dt<-2?"SELECTIVITY HURTS":"NULL: selectivity adds nothing (D-455 precedent repeats)"}`);
}
