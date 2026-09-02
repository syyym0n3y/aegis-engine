#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// factory-forward-score.ts (D-474) — the MONTHLY FORWARD SCORER for registered factory leads. The trial-free test:
// each lead is scored ONLY on months whose ENTRY (formation month-end) falls after its registered_at; forward N = the
// count of registered leads, so the forward ceiling is sqrt(2 ln N) ≈ 2.1 instead of 5.34.
// Runs DAILY from the agent but exits in ~1s unless an unscored completed month exists (panel build only when needed).
// SELFTEST=1 exercises the ENTIRE path — panel, signals, ranking, L/S computation — on the last completed month and
// prints what it WOULD write, without writing: the scorer is proven working today, not discovered broken at first use.
// Registration is the immutable line: a pre-registration month can never be written (guarded twice — in SQL and here).
import { adjShares, loadSplits, scrubShareFacts } from "../supabase/functions/_shared/shares-adj.ts";
import { loadFpiFlags, mcFpi } from "../supabase/functions/_shared/fpi-adr.ts";
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ffs",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const SELFTEST=Deno.env.get("SELFTEST")==="1";
const FEE_EQ=10, DV_MIN=1e7;

const leads=await fetch(`${OWNED}/trd_factory_forward?select=spec_key,registered_at`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {spec_key:string;registered_at:string}[];
if(!Array.isArray(leads)||!leads.length){console.log("forward-scorer: no registered leads");Deno.exit(0);}
// months needing a score: formation month mo is scoreable for h1 when month mo+1 has ENDED; for h3 when mo+3 has ended
// and (mo - registrationMonth) % 3 == 0 (disjoint windows anchored at registration).
const today=new Date().toISOString().slice(0,10);
const monthEnded=(mo:string,plus:number)=>{const d=new Date(mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+plus+1);d.setUTCDate(3);return d.toISOString().slice(0,10)<=today;};   // +3 days settle
const scored=await fetch(`${OWNED}/trd_factory_forward_returns?select=spec_key,month`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {spec_key:string;month:string}[];
const have=new Set((Array.isArray(scored)?scored:[]).map(r=>`${r.spec_key}|${r.month.slice(0,7)}`));
type Job={spec_key:string;mo:string;hold:number;lag:number;sig:string;pair?:[string,string]};
const jobs:Job[]=[];
for(const l of leads){
  const m=l.spec_key.match(/^xsec_eq\|(\w+)\|l(\d)\|h(\d)\|k10\|all$/);
  const p=l.spec_key.match(/^pair\|(\w+)\+(\w+)\|h1\|k10$/);
  const hold=m?+m[3]:1, lag=m?+m[2]:0;
  const regMo=l.registered_at.slice(0,7);
  // candidate formation months: from registration month forward, up to now
  const start=new Date(regMo+"-01T00:00:00Z");
  for(let i=0;i<24;i++){
    const d=new Date(start); d.setUTCMonth(d.getUTCMonth()+i);
    const mo=d.toISOString().slice(0,7); if(mo>today.slice(0,7))break;
    if(hold===3){const anchor=(d.getUTCFullYear()*12+d.getUTCMonth())-(start.getUTCFullYear()*12+start.getUTCMonth()); if(anchor%3!==0)continue;}
    if(!monthEnded(mo,hold))continue;
    if(have.has(`${l.spec_key}|${mo}`))continue;
    if(m)jobs.push({spec_key:l.spec_key,mo,hold,lag,sig:m[1]});
    else if(p)jobs.push({spec_key:l.spec_key,mo,hold:1,lag:0,sig:"",pair:[p[1],p[2]]});
  }
}
const selfMo=(()=>{const d=new Date();d.setUTCMonth(d.getUTCMonth()-2);return d.toISOString().slice(0,7);})();
if(!jobs.length&&!SELFTEST){console.log(`forward-scorer: nothing to score (first scoreable months not yet complete); ${leads.length} leads armed`);Deno.exit(0);}
if(SELFTEST){ // exercise the path on a PRE-registration month, never written
  for(const l of leads){
    const m=l.spec_key.match(/^xsec_eq\|(\w+)\|l(\d)\|h(\d)\|k10\|all$/); const p=l.spec_key.match(/^pair\|(\w+)\+(\w+)\|h1\|k10$/);
    if(m)jobs.push({spec_key:l.spec_key,mo:selfMo,hold:1,lag:+m[2],sig:m[1]});
    else if(p)jobs.push({spec_key:l.spec_key,mo:selfMo,hold:1,lag:0,sig:"",pair:[p[1],p[2]]});
  }
  console.log(`SELFTEST: scoring dry-run on ${selfMo} (pre-registration month; nothing will be written)`);
}
console.log(`forward-scorer: ${jobs.length} (lead, month) pairs to score`);
// ---- minimal panel: only the months and signals the jobs need ----
const needMos=new Set(jobs.flatMap(j=>{const out=[j.mo]; if(j.lag){const d=new Date(j.mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()-j.lag);out.push(d.toISOString().slice(0,7));} return out;}));
const CONC=["EntityCommonStockSharesOutstanding","NetCashProvidedByUsedInOperatingActivities","PaymentsToAcquirePropertyPlantAndEquipment","PaymentsForRepurchaseOfCommonStock","GrossProfit","Assets"];
const fund=new Map<string,Map<string,{eff:string;v:number}[]>>();
for(const c of CONC) for(let off=0;;off+=10000){
  const p=await fetch(`${OWNED}/trd_fundamentals?concept=eq.${c}&select=ticker,effective_date,value&order=effective_date&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break;
  for(const r of p as {ticker:string;effective_date:string;value:number}[]){if(!r.ticker||!Number.isFinite(r.value))continue;
    ((fund.get(r.ticker)??fund.set(r.ticker,new Map()).get(r.ticker)!).get(c)??(fund.get(r.ticker)!.set(c,[]).get(c)!)).push({eff:r.effective_date,v:r.value});}
  if(p.length<10000)break;
}
for(const [,m2] of fund) for(const [,a] of m2) a.sort((x,y)=>x.eff<y.eff?-1:1);
// D-747f: corrupt EDGAR share counts (BTI 2.46e15, CCL 9.32e11) are dropped by the SAME shared helper the factory
// calls, so the forward scorer and the factory can never see a different share series. Stored facts are untouched.
{ const sc=scrubShareFacts(fund); console.log(sc.line);
  for(const d of sc.drops) console.log(`    drop ${d.ticker} ${d.eff} ${d.value.toExponential(3)} — ${d.reason}`); }
// asOfRec keeps the effective_date beside the value: a RAW share count can only be restated into today's units by
// knowing which splits fell after ITS FILING (D-747). asOf is the value-only wrapper, so no other caller changes.
const asOfRec=(t:string,c:string,d:string)=>{const a=fund.get(t)?.get(c);if(!a?.length)return null;
  let lo=0,hi=a.length-1,b=-1;while(lo<=hi){const m2=(lo+hi)>>1;if(a[m2].eff<=d){b=m2;lo=m2+1;}else hi=m2-1;}return b<0?null:a[b];};
const asOf=(t:string,c:string,d:string)=>asOfRec(t,c,d)?.v??null;
// trd_bars_deep closes are SPLIT-ADJUSTED; EntityCommonStockSharesOutstanding is RAW AS FILED. px_adj*sh_raw is
// wrong by the product of every split after the filing date, so every yield below was contaminated (D-747).
const splits=await loadSplits(OWNED,hdr);
console.log(`  splits: ${[...splits.values()].reduce((n,a)=>n+a.length,0)} events across ${splits.size} symbols`);
// D-747b, the SECOND share-base defect: a foreign private issuer files ORDINARY shares on the EDGAR cover page
// while trd_bars_deep carries the ADR price, so px_adr*shares_ordinary overstates the cap by the ADR ratio and no
// split touches it. Where the ratio is MEASURED it is divided out; where it is not, mc is NULL and the yields go
// null with it. Kept identical to aegis-factory.ts through one shared module, deliberately: the forward scorer and
// the factory must never construct a market cap two different ways.
const fpi=await loadFpiFlags();
if(!fpi.loaded)console.log(`  !! data/fpi-flags.json NOT FOUND — the ADR correction is a NO-OP here. Run scripts/fpi-flags.ts.`);
else console.log(`  fpi/adr: ${fpi.fpiCount} foreign private issuers — ${fpi.ratio.size} CORRECTED by a measured ADR ratio, ${fpi.exclude.size} EXCLUDED (mc=null)`);
const ttm=(t:string,c:string,d:string)=>{const a=fund.get(t)?.get(c);if(!a?.length)return null;
  let hi=-1,lo=0,h2=a.length-1;while(lo<=h2){const m2=(lo+h2)>>1;if(a[m2].eff<=d){hi=m2;lo=m2+1;}else h2=m2-1;}
  return hi<3?null:a[hi].v+a[hi-1].v+a[hi-2].v+a[hi-3].v;};
type PR={mo:string;sym:string;fwd:Record<number,number|null>;sig:Record<string,number|null>};
const panel:PR[]=[];
{
  const meta:{symbol:string}[]=[];
  for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
  for(let i=0;i<meta.length;i+=30){
    const part=meta.slice(i,i+30).map(m2=>`"${m2.symbol}"`).join(",");
    const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
    if(!Array.isArray(rows))continue;
    for(const r of rows){
      const b=r.bars; if(!b||b.length<300)continue;
      const idx:number[]=[]; const mos:string[]=[]; let last="";
      for(let k=0;k<b.length;k++){const mo=new Date(b[k][0]*1000).toISOString().slice(0,7);if(mo!==last){if(k>0){idx.push(k-1);mos.push(last);}last=mo;}}
      idx.push(b.length-1); mos.push(last);
      const c=b.map(x=>x[4]),v=b.map(x=>x[5]);
      for(let j=12;j<idx.length;j++){
        if(!needMos.has(mos[j]))continue;
        const k=idx[j],px=c[k]; if(!(px>1))continue;
        let dv=0,cn=0;for(let q=Math.max(0,k-21);q<k;q++)if(c[q]>0&&v[q]>0){dv+=c[q]*v[q];cn++;}
        if(!cn||(dv/=cn)<DV_MIN)continue;
        const d=new Date(b[k][0]*1000).toISOString().slice(0,10);
        const shRec=asOfRec(r.symbol,"EntityCommonStockSharesOutstanding",d); const sh=shRec?.v??null;
        const mc=(sh&&sh>0&&shRec)?mcFpi(px,adjShares(sh,splits.get(r.symbol),shRec.eff),r.symbol,fpi):null;
        const ocf=ttm(r.symbol,"NetCashProvidedByUsedInOperatingActivities",d);
        const capex=ttm(r.symbol,"PaymentsToAcquirePropertyPlantAndEquipment",d);
        const bb=ttm(r.symbol,"PaymentsForRepurchaseOfCommonStock",d);
        const gp=ttm(r.symbol,"GrossProfit",d), at=asOf(r.symbol,"Assets",d);
        const fwd:Record<number,number|null>={};
        for(const h of [1,3]){const kk=idx[j+h]; fwd[h]=(kk!=null&&c[kk]>0)?c[kk]/px-1:null;}
        panel.push({mo:mos[j],sym:r.symbol,fwd,sig:{
          buyback_yield:(mc&&bb!=null&&mc>0)?bb/mc:null,
          cfo_yield:(mc&&ocf!=null&&mc>0)?ocf/mc:null,
          fcf_yield:(mc&&ocf!=null&&capex!=null&&mc>0)?(ocf-capex)/mc:null,
          gross_prof:(at&&gp!=null&&at>0)?gp/at:null,
          mom12_1:(idx[j-12]!=null&&c[idx[j-12]]>0&&idx[j-1]!=null)?c[idx[j-1]]/c[idx[j-12]]-1:null,
        }});
      }
    }
  }
}
console.log(`  panel: ${panel.length.toLocaleString()} rows over ${needMos.size} month(s)`);
const byMo=new Map<string,PR[]>(); for(const r of panel)(byMo.get(r.mo)??byMo.set(r.mo,[]).get(r.mo)!).push(r);
function score(j:Job):{n:number;ret:number}|null{
  let g=byMo.get(j.mo)??[];
  if(j.lag){const d=new Date(j.mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()-j.lag);
    const sigMo=d.toISOString().slice(0,7); const sm=new Map((byMo.get(sigMo)??[]).map(r=>[r.sym,r]));
    g=g.map(r=>({...r,sig:sm.get(r.sym)?.sig??{}})) as PR[];}
  let scored:{fwd:number;v:number}[];
  if(j.pair){
    const [A,B]=j.pair;
    const hav=g.filter(r=>r.sig[A]!=null&&r.sig[B]!=null&&r.fwd[1]!=null);
    if(hav.length<50)return null;
    const rk=(key:string)=>{const o=[...hav.keys()].sort((a,b)=>(hav[a].sig[key] as number)-(hav[b].sig[key] as number));const m2=new Array(hav.length);o.forEach((i2,r2)=>m2[i2]=r2/(hav.length-1));return m2;};
    const ra=rk(A),rb=rk(B);
    scored=hav.map((r,i2)=>({fwd:r.fwd[1] as number,v:ra[i2]+rb[i2]}));
  }else{
    const hav=g.filter(r=>r.sig[j.sig]!=null&&r.fwd[j.hold]!=null);
    if(hav.length<50)return null;
    scored=hav.map(r=>({fwd:r.fwd[j.hold] as number,v:r.sig[j.sig] as number}));
  }
  scored.sort((a,b)=>b.v-a.v);
  const q=Math.max(3,Math.floor(scored.length/10));
  return {n:scored.length,ret:mean(scored.slice(0,q).map(x=>x.fwd))-mean(scored.slice(-q).map(x=>x.fwd))-FEE_EQ/1e4};
}
let wrote=0;
for(const j of jobs){
  const s=score(j);
  if(!s){console.log(`  ${j.spec_key} ${j.mo}: UNSCORED (breadth<50)`);continue;}
  console.log(`  ${j.spec_key.padEnd(44)} ${j.mo}  n=${s.n}  L/S net ${(s.ret*100).toFixed(2)}%`);
  if(SELFTEST)continue;                                        // dry-run: never write
  const monthEnd=(()=>{const d=new Date(j.mo+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return d.toISOString().slice(0,10);})();
  const res=await fetch(`${OWNED}/trd_factory_forward_returns`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},
    body:JSON.stringify([{spec_key:j.spec_key,month:monthEnd,ls_return:+s.ret.toFixed(5)}])}).catch(()=>null);
  if(!res||!res.ok)console.log(`WRITE-FAILED trd_factory_forward_returns ${res?res.status:"net"}`); else wrote++;
}
// forward status: per lead, months, mean, t vs the FORWARD ceiling
const fceil=Math.sqrt(2*Math.log(Math.max(2,leads.length)));
const all=await fetch(`${OWNED}/trd_factory_forward_returns?select=spec_key,ls_return`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {spec_key:string;ls_return:number}[];
const byLead=new Map<string,number[]>(); for(const r of (Array.isArray(all)?all:[]))(byLead.get(r.spec_key)??byLead.set(r.spec_key,[]).get(r.spec_key)!).push(+r.ls_return);
console.log(`\nFORWARD STATUS — ${leads.length} leads, forward ceiling ${fceil.toFixed(2)}${SELFTEST?" (SELFTEST — nothing written)":""}`);
for(const l of leads){
  const a=byLead.get(l.spec_key)??[];
  const line=a.length?`n=${a.length}  mean ${(mean(a)*100).toFixed(2)}%/mo  t=${a.length>2?(mean(a)/(sdv(a)/Math.sqrt(a.length))).toFixed(2):"—"}`:"n=0 (accruing)";
  console.log(`  ${l.spec_key.padEnd(44)} ${line}`);
}
if(!SELFTEST)console.log(`wrote ${wrote} score(s)`);
