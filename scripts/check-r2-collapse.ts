#!/usr/bin/env -S deno run --allow-net --allow-env
// check-r2-collapse.ts (D-523) — pre-registered: an instrument whose adj-R2 drops >=0.25 below its trailing-12m mean
// (its explanation COLLAPSES) exhibits elevated realized vol in the NEXT month. If true, explanation-collapse is a
// de-risk trigger candidate (a P2 conditioner needing its own registration before entering the book). One definition,
// one outcome, stated before looking. Trials +1.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"rc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const attr=await(async()=>{const out:{symbol:string;asof:string;adj_r2:number}[]=[];
  for(let off=0;;off+=10000){
    const p=await fetch(`${OWNED}/trd_attribution?select=symbol,asof,adj_r2&order=symbol,asof&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
    if(!Array.isArray(p)||!p.length)break; out.push(...p); if(p.length<10000)break;}
  return out;})();
const bySym=new Map<string,{asof:string;r2:number}[]>();
for(const r of attr)(bySym.get(r.symbol)??bySym.set(r.symbol,[]).get(r.symbol)!).push({asof:r.asof,r2:+r.adj_r2});
// realized vol per (symbol, month) from daily bars
const volOf=new Map<string,Map<string,number>>();
for(const sym of bySym.keys()){
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const bars=(rb[0]?.bars||[]).filter(b=>b[4]>0);
  const byMo=new Map<string,number[]>();
  for(let i=1;i<bars.length;i++){const mo=new Date(bars[i][0]*1000).toISOString().slice(0,7);
    (byMo.get(mo)??byMo.set(mo,[]).get(mo)!).push(bars[i][4]/bars[i-1][4]-1);}
  const m=new Map<string,number>();
  for(const [mo,rets] of byMo) if(rets.length>=10) m.set(mo,sdv(rets)*Math.sqrt(252));
  volOf.set(sym,m);
}
// events: collapse vs all-other months; outcome = NEXT-month vol / trailing-12m own vol (ratio controls level)
const collapse:number[]=[],normal:number[]=[];
for(const [sym,rows] of bySym){
  rows.sort((a,b)=>a.asof<b.asof?-1:1);
  const vm=volOf.get(sym)!;
  for(let i=12;i<rows.length-1;i++){
    const trail=mean(rows.slice(i-12,i).map(x=>x.r2));
    const nextMo=rows[i+1].asof.slice(0,7);
    const v=vm.get(nextMo);
    const base=mean(rows.slice(i-12,i).map(x=>vm.get(x.asof.slice(0,7))??NaN).filter(Number.isFinite));
    if(v===undefined||!Number.isFinite(base)||base<=0)continue;
    const ratio=v/base;
    if(rows[i].r2<=trail-0.25)collapse.push(ratio); else normal.push(ratio);
  }
}
const mc=mean(collapse),mn=mean(normal);
const se=Math.sqrt((sdv(collapse)**2)/collapse.length+(sdv(normal)**2)/normal.length);
const t=(mc-mn)/se;
console.log(`==> R2-COLLAPSE -> FORWARD VOL (pre-registered, D-523)`);
console.log(`    collapse events: ${collapse.length}   normal months: ${normal.length}`);
console.log(`    next-month vol ratio (vs own trailing-12m): collapse ${mc.toFixed(3)}  normal ${mn.toFixed(3)}  diff t=${t.toFixed(2)}`);
console.log(`    verdict: ${t>2?"COLLAPSE PREDICTS ELEVATED RISK - de-risk trigger candidate (own registration required before book entry)":t<-2?"collapse predicts LOWER vol (prereg miss)":"no reliable link (null)"}`);
{const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},
  body:JSON.stringify({family:"adhoc",run_key:`r2-collapse-D523`})}).catch(()=>null);
 if(!tw||(!tw.ok&&tw.status!==409))console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
