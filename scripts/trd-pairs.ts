#!/usr/bin/env -S deno run --allow-net
// trd-pairs — untested family (D-208): PAIRS / statistical-arbitrage relative value. For same-sector pairs form the
// spread = logA − β·logB (rolling OLS hedge), z-score it, and trade mean-reversion of the SPREAD (fade |z|>2, exit at
// z→0) vs a RANDOM entry on the same spread. Market-neutral by construction → the drift confound is cancelled
// (PLAYBOOK #2), so this is the cleanest possible edge test. Count how many pairs beat random (Binomial null). Cost:
// 2 legs × spread each side. Free (Yahoo daily).
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
let seed=99; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{d:string;c:number}
async function daily(sym:string):Promise<Map<string,number>>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return new Map();const t=res.timestamp,q=res.indicators.quote[0],m=new Map<string,number>();for(let i=0;i<t.length;i++){const c=q.close[i];if(c!=null&&Number.isFinite(c)&&c>0)m.set(new Date(t[i]*1000).toISOString().slice(0,10),c);}return m;}catch{return new Map();}}
function binomUpper(k:number,N:number,p:number){let s=0;for(let x=k;x<=N;x++){let c=0;for(let j=0;j<x;j++)c+=Math.log((N-j)/(j+1));s+=Math.exp(c+x*Math.log(p)+(N-x)*Math.log(1-p));}return s;}
const PAIRS:[string,string][]=[["KO","PEP"],["V","MA"],["XOM","CVX"],["JPM","BAC"],["GS","MS"],["HD","LOW"],["GOOGL","META"],["MSFT","AAPL"],["NVDA","AMD"],["UPS","FDX"],["WMT","TGT"],["CAT","DE"],["T","VZ"],["COP","SLB"],["DUK","SO"],["GLD","SLV"],["XLE","XOP"],["EEM","EFA"],["QQQ","SPY"],["USO","BNO"],["WFC","C"],["ADBE","CRM"],["PFE","MRK"],["NKE","LULU"]];
const WIN=60,Z=2,ZSTOP=3.5,MAXH=20;const COST_Z=Number(Deno.args[0]??'0.25'); // cost in z-units (~2 legs spread)
console.log(`PAIRS / STAT-ARB — spread mean-reversion (fade |z|>${Z}) vs random, market-neutral. ${PAIRS.length} same-sector pairs.\n`);
const cache=new Map<string,Map<string,number>>();
async function get(s:string){if(!cache.has(s))cache.set(s,await daily(s));return cache.get(s)!;}
console.log(`${"pair".padEnd(13)} ${"n".padStart(4)} ${"setupR".padStart(8)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(6)}  verdict`);
const perT:number[]=[];let good=0,tested=0;
for(const[a,bs]of PAIRS){const ma=await get(a),mb=await get(bs);const dates=[...ma.keys()].filter(d=>mb.has(d)).sort();if(dates.length<WIN+120)continue;
  const la=dates.map(d=>Math.log(ma.get(d)!)),lb=dates.map(d=>Math.log(mb.get(d)!));
  const S:number[]=[],C:number[]=[],H1:number[]=[],H2:number[]=[];
  for(let i=WIN;i<dates.length-1;i++){
    // rolling OLS beta over [i-WIN,i)
    let sx=0,sy=0,sxx=0,sxy=0;for(let k=i-WIN;k<i;k++){sx+=lb[k];sy+=la[k];sxx+=lb[k]*lb[k];sxy+=lb[k]*la[k];}
    const beta=(WIN*sxy-sx*sy)/(WIN*sxx-sx*sx||1e-9);
    const spr:number[]=[];for(let k=i-WIN;k<=i;k++)spr.push(la[k]-beta*lb[k]);
    const m=mean(spr.slice(0,WIN)),sd=sampleStd(spr.slice(0,WIN));if(!(sd>0))continue;
    const z=(spr[WIN]-m)/sd;
    const entry=(zz:number,idx:number)=>{const dir=zz>0?-1:1; // fade: z>0 → short spread
      let ret:number|null=null;for(let k=idx+1;k<=Math.min(idx+MAXH,dates.length-1);k++){let s2x=0,s2y=0,s2xx=0,s2xy=0;for(let j=k-WIN;j<k;j++){s2x+=lb[j];s2y+=la[j];s2xx+=lb[j]*lb[j];s2xy+=lb[j]*la[j];}const b2=(WIN*s2xy-s2x*s2y)/(WIN*s2xx-s2x*s2x||1e-9);const spr2=la[k]-b2*lb[k];const z2=(spr2-m)/sd;
        if(dir===1?z2>=0:z2<=0){ret=Math.abs(zz)-COST_Z;break;} // reverted to mean → win |z0| units
        if(Math.abs(z2)>=ZSTOP){ret=-(ZSTOP-Math.abs(zz))-COST_Z;break;}} // widened → loss
      if(ret===null)ret=dir*( (la[Math.min(idx+MAXH,dates.length-1)]-lb[Math.min(idx+MAXH,dates.length-1)]*beta) - spr[WIN])/sd - COST_Z;
      return ret/Math.max(1,Z);}; // normalize to ~R by the entry threshold
    if(Math.abs(z)>=Z){const r=entry(z,i);if(Number.isFinite(r))S.push(r);if(Number.isFinite(r)){(i<dates.length/2?H1:H2).push(r);}}
    if(rnd()<0.15){const zr=(rnd()*2-1)*Z*1.2;const r=entry(zr||0.5,i);if(Number.isFinite(r))C.push(r);}
  }
  if(S.length>=20&&C.length>=20){tested++;const g=edgeVsRandom(S,C,2,20);perT.push(g.tStat);const ok=g.passes&&g.setupMean>0;if(ok)good++;const m1=H1.length?mean(H1):NaN,m2=H2.length?mean(H2):NaN;(globalThis as any).__bh=((globalThis as any).__bh||[]);(globalThis as any).__bh.push([a+"/"+bs,m1,m2,g.setupMean]);
    console.log(`${(a+"/"+bs).padEnd(13)} ${String(S.length).padStart(4)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(8)} ${g.controlMean.toFixed(3).padStart(7)} ${((g.edge>=0?"+":"")+g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)}  ${ok?"✓ beats random":g.setupMean>0?"pos":"✗"}`);}
}
const bh=(globalThis as any).__bh||[];const bothPos=bh.filter((x:any)=>x[1]>0&&x[2]>0).length;console.log(`\nboth-halves net>0: ${bothPos}/${bh.length} pairs (H1 AND H2 both net-positive at cost ${COST_Z})`);const p=binomUpper(good,tested,0.05);
console.log(`\n${good}/${tested} pairs' spread-reversion beats random at t≥2 (expected ~5% by chance). Binomial p=${p.toExponential(1)} → ${p<0.001?"SYSTEMATIC stat-arb edge":p<0.05?"leans real":"NOT systematic (pairs arbitraged out / cost-gated)"}`);
