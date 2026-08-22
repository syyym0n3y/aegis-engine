#!/usr/bin/env -S deno run --allow-net --allow-env
// audit-vrp-overlap.ts (D-454) — auditing the program's single largest surviving statistic.
// D-404 records the equity variance risk premium as "the most statistically robust finding in the program": VRP = 3.67 vol
// points, **t = 48.8**, on "8,444 OVERLAPPING days". The word overlapping is in the record, and it is the whole problem:
// VIX is a 30-day forward-looking measure compared against the SUBSEQUENT 21-day realised vol, sampled DAILY. Consecutive
// observations therefore share 20 of their 21 days. They are not independent draws, and a t-stat computed as if they were
// is inflated by roughly sqrt(21).
// This is the D-416 trap (caught then for long-horizon equity factors) and the D-451 pseudo-replication rule, applied to
// the one number this program has repeatedly cited as its strongest.
// NOTE ON WHAT THIS AUDIT EXPECTS TO FIND: unlike the three refutations, this one is likely to CONFIRM the finding while
// correcting its headline. A premium of 3.67 vol points over 33 years should survive an honest denominator. Reporting a
// correction that leaves a result standing matters as much as reporting one that kills it.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"av",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const H=21;

const get=async(sym:string)=>{const r=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>(); if(r[0]) for(const b of r[0].bars) if(b[4]>0) m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]); return m;};
const vix=await get("^VIX"), spx=await get("^GSPC");
if(!vix.size||!spx.size){console.error("!! missing ^VIX or ^GSPC");Deno.exit(1);}
const days=[...spx.keys()].filter(d=>vix.has(d)).sort();
console.log(`==> AUDIT: EQUITY VRP overlap correction — ${days.length} common days ${days[0]} .. ${days[days.length-1]}`);
const lr:number[]=[]; for(let i=1;i<days.length;i++) lr.push(Math.log(spx.get(days[i])!/spx.get(days[i-1])!));
// VRP(t) = VIX(t) - annualised realised vol over the NEXT H trading days
const obs:{d:string;vrp:number}[]=[];
for(let i=1;i+H<days.length;i++){
  const w=lr.slice(i,i+H); if(w.length<H)continue;
  const rv=sdv(w)*Math.sqrt(252)*100;
  const v=vix.get(days[i])!;
  if(!Number.isFinite(rv)||!Number.isFinite(v))continue;
  obs.push({d:days[i],vrp:v-rv});
}
const all=obs.map(o=>o.vrp);
const tOverlap=mean(all)/(sdv(all)/Math.sqrt(all.length));
console.log(`\n    OVERLAPPING (the recorded methodology, daily sampling of ${H}-day forward windows)`);
console.log(`      VRP ${mean(all).toFixed(2)} vol pts, t ${tOverlap.toFixed(1)}, positive on ${(100*all.filter(x=>x>0).length/all.length).toFixed(0)}% of days, n=${all.length}`);
// NON-OVERLAPPING: step by H so no two windows share a day. Report every phase offset so the answer cannot be an artefact
// of which day the sampling happens to start on.
const phases:number[]=[];
for(let p=0;p<H;p++){ const s:number[]=[]; for(let i=p;i<obs.length;i+=H) s.push(obs[i].vrp);
  if(s.length>20) phases.push(mean(s)/(sdv(s)/Math.sqrt(s.length))); }
const nonOv=obs.filter((_,i)=>i%H===0).map(o=>o.vrp);
console.log(`\n    NON-OVERLAPPING (step ${H}; every window disjoint)`);
console.log(`      VRP ${mean(nonOv).toFixed(2)} vol pts, t ${(mean(nonOv)/(sdv(nonOv)/Math.sqrt(nonOv.length))).toFixed(2)}, n=${nonOv.length}`);
console.log(`      across all ${phases.length} phase offsets: t ranges ${Math.min(...phases).toFixed(2)} .. ${Math.max(...phases).toFixed(2)}, median ${phases.sort((a,b)=>a-b)[Math.floor(phases.length/2)].toFixed(2)}`);
console.log(`\n    INFLATION FACTOR: ${(tOverlap/mean(phases)).toFixed(1)}x  (overlapping t / mean non-overlapping t)`);
console.log(`    Deflated ceiling for this program (D-363/364, ~1.53M trials): t ~ 5.34`);
const survives=mean(phases)>5.34;
console.log(`    -> corrected t ${mean(phases).toFixed(2)} ${survives?"STILL CLEARS the deflated bar — the finding SURVIVES, the headline does not":"does NOT clear the deflated bar"}`);
// regime split, non-overlapping, since D-404 claimed monotonicity in VIX level
console.log(`\n    VIX-level buckets, NON-OVERLAPPING (D-404 claimed a monotone rise with fear):`);
for(const [lab,lo,hi] of [["VIX<15",0,15],["15-20",15,20],["20-30",20,30],["VIX>30",30,999]] as [string,number,number][]){
  const g=obs.filter((_,i)=>i%H===0).filter(o=>{const v=vix.get(o.d)!;return v>=lo&&v<hi;}).map(o=>o.vrp);
  if(g.length<15){console.log(`      ${lab.padEnd(8)} (thin: n=${g.length})`);continue;}
  console.log(`      ${lab.padEnd(8)} VRP ${mean(g).toFixed(2).padStart(6)} pts, t ${(mean(g)/(sdv(g)/Math.sqrt(g.length))).toFixed(2).padStart(6)}, n=${g.length}`);
}
