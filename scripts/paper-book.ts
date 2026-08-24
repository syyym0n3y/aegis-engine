#!/usr/bin/env -S deno run --allow-net --allow-env
// paper-book.ts (D-521) — Stage-1 PAPER executor for the frozen P2 managed book (D-518/519). $0 at risk.
// Recomputes the frozen P1 stream from trd_ff_factors (identical construction to factory PASS 31), applies the
// pre-registered vol-management weight point-in-time, honors trd_kill_switch, and marks each completed month once
// (idempotent). Runs daily from the runner; acts only when a new month of panel data has landed.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"pb",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
// ---- frozen P1 stream (construction identical to factory PASS 31; components + drags are the frozen spec) ----
const ff:{month:string;factor:string;ret:number}[]=[];
for(let off=0;;off+=10000){
  const p2=await fetch(`${OWNED}/trd_ff_factors?or=(factor.like.szmom25:*,factor.like.dxwml:*,factor.like.dxff3:*,factor.like.ni10:*,factor.like.ind49:*,factor.like.mom10:*,factor.like.strev10:*,factor.like.ltrev10:*,factor.like.op10:*,factor.like.inv10:*)&select=month,factor,ret&order=month,factor&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p2)||!p2.length)break; ff.push(...p2); if(p2.length<10000)break;}
const byF=new Map<string,Map<string,number>>();
for(const r of ff)(byF.get(r.factor)??byF.set(r.factor,new Map()).get(r.factor)!).set(String(r.month).slice(0,7),+r.ret);
const get=(f:string)=>byF.get(f);
const streams=new Map<string,Map<string,number>>();
{const L=get("szmom25:BIG_HiPRIOR"),S2=get("szmom25:BIG_LoPRIOR");
 if(L&&S2){const m=new Map<string,number>();for(const [mo,v] of L)if(S2.has(mo))m.set(mo,v-S2.get(mo)!-0.0005);streams.set("bigmom",m);}}
{const W=get("dxwml:WML"); if(W){const m=new Map<string,number>();for(const [mo,v] of W)m.set(mo,v-0.0010);streams.set("dxwml",m);}}
{const H=get("dxff3:HML"); if(H){const m=new Map<string,number>();for(const [mo,v] of H)m.set(mo,v-0.0010);streams.set("dxhml",m);}}
{const ks=[...byF.keys()].filter(k=>k.startsWith("ni10:"));
 const lo=ks.filter(k=>/:Lo/.test(k)&&/_10$/.test(k))[0]??ks.filter(k=>/:Lo/.test(k))[0];
 const hi=ks.filter(k=>/:Hi/.test(k)&&/_10$/.test(k))[0]??ks.filter(k=>/:Hi/.test(k))[0];
 const L=lo?get(lo):null,S2=hi?get(hi):null;
 if(L&&S2){const m=new Map<string,number>();for(const [mo,v] of L)if(S2.has(mo))m.set(mo,v-S2.get(mo)!-0.0005);streams.set("ni",m);}}
{const ks=[...byF.keys()].filter(k=>k.startsWith("ind49:"));
 const months=[...(ks.length?get(ks[0])!.keys():[])].sort();
 const m=new Map<string,number>();
 for(let i=12;i<months.length-2;i+=3){
   const scored=ks.map(k=>{const s3=get(k)!;let cum=1,ok=true;
     for(let q=i-12;q<i;q++){const v=s3.get(months[q]);if(v===undefined){ok=false;break;}cum*=1+v;}
     return {k,sc:ok?cum:NaN};}).filter(x=>Number.isFinite(x.sc));
   if(scored.length<40)continue;
   scored.sort((a,b)=>b.sc-a.sc);
   const long=scored.slice(0,5).map(x=>x.k),short=scored.slice(-5).map(x=>x.k);
   for(let h2=0;h2<3&&i+h2<months.length-1;h2++){
     const mo2=months[i+h2];
     const lr=mean(long.map(k=>get(k)!.get(mo2)??0)),sr=mean(short.map(k=>get(k)!.get(mo2)??0));
     m.set(mo2,lr-sr-(h2===0?0.0005:0));
   }}
 streams.set("ind49mom",m);}
{const F9:[string,string,string][]=[["mom10","Hi","Lo"],["strev10","Lo","Hi"],["ltrev10","Lo","Hi"],["op10","Hi","Lo"],["inv10","Lo","Hi"]];
 const fseries=new Map<string,Map<string,number>>();
 const pick2=(pre:string,side:string)=>{const c2=[...byF.keys()].filter(k=>k.startsWith(pre+":")&&k.split(":")[1].startsWith(side));
   const dec=c2.filter(k=>/_10$/.test(k)); return (dec.length===1?get(dec[0]):c2.length===1?get(c2[0]):null);};
 for(const [pre,ls,ss] of F9){const L=pick2(pre,ls),S2=pick2(pre,ss);
   if(L&&S2){const m=new Map<string,number>();for(const [mo,v] of L)if(S2.has(mo))m.set(mo,v-S2.get(mo)!);fseries.set(pre,m);}}
 const names=[...fseries.keys()];
 const months=[...(fseries.get(names[0])?.keys()??[])].sort();
 const m=new Map<string,number>();
 for(let i=12;i<months.length;i++){
   const scored=names.map(n=>{const s3=fseries.get(n)!;let cum=1,ok=true;
     for(let q=i-12;q<i;q++){const v=s3.get(months[q]);if(v===undefined){ok=false;break;}cum*=1+v;}
     return {n,sc:ok?cum:NaN};}).filter(x=>Number.isFinite(x.sc));
   if(scored.length<4)continue;
   scored.sort((a,b)=>b.sc-a.sc);
   const top=scored.slice(0,3).map(x=>x.n);
   m.set(months[i],mean(top.map(n=>fseries.get(n)!.get(months[i])??0))-0.0005);
 }
 streams.set("factmom",m);}
const core=["bigmom","dxwml","dxhml","ni","ind49mom","factmom"];
const w=new Map<string,number>();
for(const n of core){const v=[...(streams.get(n)?.values()??[])];if(v.length>120)w.set(n,1/(sdv(v)||1e-9));}
const wsum=[...w.values()].reduce((s,x)=>s+x,0); for(const [k2,v] of w)w.set(k2,v/wsum);
const allMo=new Set<string>(); for(const n of w.keys())for(const mo of streams.get(n)!.keys())allMo.add(mo);
const mos=[...allMo].sort().filter(mo=>[...w.keys()].filter(n=>streams.get(n)!.has(mo)).length>=3);
const book=new Map<string,number>();
for(const mo of mos){let num=0,den=0;for(const n of w.keys()){const v=streams.get(n)!.get(mo);if(v!==undefined){num+=w.get(n)!*v;den+=w.get(n)!;}}book.set(mo,num/den);}
// ---- kill switch ----
const ks2=await fetch(`${OWNED}/trd_kill_switch?select=state&limit=1`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {state:string}[];
const killed=Array.isArray(ks2)&&ks2[0]&&String(ks2[0].state).toLowerCase()!=="armed"&&String(ks2[0].state).toLowerCase()!=="ok";
// ---- mark all months not yet marked, from paper-arm month forward ----
const ARM_FROM="2026-08";                                       // paper rung armed 2026-08-24 (D-521)
const marked=await fetch(`${OWNED}/trd_paper_book?select=mo`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {mo:string}[];
const have=new Set((Array.isArray(marked)?marked:[]).map(r=>r.mo));
const seq=[...book.keys()].sort();
const TARGET=sdv([...book.values()]);
let equity=100000;
const prev=await fetch(`${OWNED}/trd_paper_book?select=equity&order=mo.desc&limit=1`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {equity:number}[];
if(Array.isArray(prev)&&prev[0])equity=+prev[0].equity;
let wrote=0;
for(const mo of seq){
  if(mo<ARM_FROM||have.has(mo))continue;
  const i=seq.indexOf(mo);
  if(i<6)continue;
  const rv=sdv(seq.slice(i-6,i).map(m2=>book.get(m2)!))||1e-9;
  const vmw=killed?0:Math.min(2,TARGET/rv);
  const mret=vmw*book.get(mo)!;
  equity*=1+mret;
  const res=await fetch(`${OWNED}/trd_paper_book`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},
    body:JSON.stringify({mo,book_ret:+book.get(mo)!.toFixed(6),vm_weight:+vmw.toFixed(3),managed_ret:+mret.toFixed(6),equity:+equity.toFixed(2)})}).catch(()=>null);
  if(!res||!res.ok){console.log(`WRITE-FAILED trd_paper_book ${res?res.status:"net"}`);Deno.exit(1);}
  wrote++;
  console.log(`PAPER MARK ${mo}: book ${(book.get(mo)!*100).toFixed(2)}% x w ${vmw.toFixed(2)} = ${(mret*100).toFixed(2)}%  equity $${equity.toFixed(0)}${killed?"  [KILL-SWITCH: weight 0]":""}`);
}
if(!wrote)console.log(`paper-book: no new complete month to mark (latest panel month ${seq.at(-1)}, marked through ${[...have].sort().at(-1)??"none"})`);
