#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-nonlinear.ts (D-451) — the program's best METHOD applied to its most capacity-rich market at adequate BREADTH.
// The three ingredients have never been combined:
//   GBM (D-419) beat linear rank-IC on equities by +0.0098 IC — real signal a linear test structurally cannot see.
//   Perps (D-424 answer) have capacity: shorting is native and free, and the liquid names clear billions a day.
//   The survivorship-free universe (D-442) gives 328 contracts / ~162 names per day — above the BREADTH LAW floor, and
//   10x the 14 names whose concentration produced the false 94%/yr in D-441.
// Pre-registered null, stated before running: if the GBM does not beat the linear composite OOS on a paired t, and does
// not clear the deflated ceiling of t~5.34 (D-363/364), non-linearity adds nothing here and crypto is closed.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cn",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
// D-598: declare every knob so the effective configuration is PRINTED and a near-miss variable name refuses to run.
// This script produced three of today's ten self-inflicted defects — a SYMBOLS filter that matched 0 of 31 names, a
// stale dump read as a result, and an AGEBAND comparison whose confound was only caught by a later control.
declareKnobs("crypto-nonlinear", [
  { name: "TF" },
  { name: "TOPN" },
  { name: "MINNAMES" },
  { name: "MINNAMES_LIQ" },
  { name: "HOLD" },
  { name: "LAG" },
  { name: "FEATSET" },
  { name: "FEATURE" },
  { name: "FULLSPAN" },
  { name: "QWIDTH" },
  { name: "INVERT" },
  { name: "LIQBAND" },
  { name: "AGEBAND" },
  { name: "SYMBOLS" },
  { name: "FROM" },
  { name: "UNTIL" },
  { name: "NULLTEST" },
  { name: "EXHAUST" },
  { name: "PERP_FEE_RT_BP" }
]);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("PERP_FEE_RT_BP")||9);
const FEAT=["mom30","mom7","rev1","vol30","maxret","dvol","hi60","flow","relvol","trades","fund7"];
const MINNAMES_N=Number(Deno.env.get("MINNAMES")||40);   // used by BOTH the normalisation gate and the clean filter
type Row={d:string;sym:string;x:number[];y:number;yraw:number};
const panel:Row[]=[];
// funding history for the whole universe (D-549), keyed symbol -> sorted [ts, rate]
const fundMap=new Map<string,{ts:number;r:number}[]>();
{let off=0;for(;;){
  const p=await fetch(`${OWNED}/trd_perp_oi?venue=eq.binance&interval=eq.funding&select=symbol,ts,open_interest&order=symbol,ts&offset=${off}&limit=50000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break;
  for(const r of p as {symbol:string;ts:number;open_interest:number}[])
    (fundMap.get(r.symbol)??fundMap.set(r.symbol,[]).get(r.symbol)!).push({ts:+r.ts,r:+r.open_interest});
  if(p.length<50000)break; off+=50000;}
console.log(`    funding loaded: ${fundMap.size} symbols, ${[...fundMap.values()].reduce((a,x)=>a+x.length,0).toLocaleString()} records`);}
const fund7=(sym:string,tsEnd:number)=>{                       // mean funding over the trailing 7 days, known at tsEnd
  const a=fundMap.get(sym); if(!a)return null;
  const lo=tsEnd-7*86400; let s2=0,n2=0;
  let i=a.length-1; while(i>=0&&a[i].ts>tsEnd)i--;
  for(;i>=0&&a[i].ts>=lo;i--){s2+=a[i].r;n2++;}
  return n2>=10?s2/n2:null;};
const TF=Deno.env.get("TF")||"1dSF";
let meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&select=symbol,n_bars&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
const ONLY=(Deno.env.get("SYMBOLS")||"").split(",").map(x=>x.trim()).filter(Boolean);
if(ONLY.length){meta=meta.filter(m=>ONLY.includes(m.symbol));console.log(`    SYMBOL-MATCHED: restricted to ${meta.length} of ${ONLY.length} requested names`);assertNonEmpty("SYMBOLS filter matches",meta);}
const AGEBAND=Deno.env.get("AGEBAND")||"";
if(AGEBAND){
  const firsts:{symbol:string;first:number}[]=[];
  for(let i=0;i<meta.length;i+=25){
    const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
    const rr=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
    for(const r of rr) if(r.bars?.length) firsts.push({symbol:r.symbol,first:r.bars[0][0]});
  }
  firsts.sort((a,b)=>a.first-b.first);
  const half=Math.floor(firsts.length/2);
  const keep=new Set((AGEBAND==="old"?firsts.slice(0,half):firsts.slice(half)).map(x=>x.symbol));
  meta=meta.filter(m=>keep.has(m.symbol));
  const dates=firsts.filter(f=>keep.has(f.symbol));
  console.log(`    AGEBAND=${AGEBAND}: ${meta.length} names, first listings ${new Date(dates[0].first*1000).toISOString().slice(0,10)} .. ${new Date(dates[dates.length-1].first*1000).toISOString().slice(0,10)}`);
}
console.log(`==> CRYPTO NON-LINEAR [${TF}] — ${meta.length} contracts${TF==="1dSF"?` (partially survivorship-corrected: ${meta.length} contracts, delisted cohort recovered to 19 — NOT survivorship-free, see D-561/562)`:" (SURVIVORSHIP-BIASED: listed only)"}`);
for(let i=0;i<meta.length;i+=25){
  const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){
    const b=r.bars; if(!b||b.length<120)continue;
    // [ts,o,h,l,c,vol,quoteVol,takerBuyBase,nTrades]
    for(let k=61;k<b.length-1;k++){
      const c=b[k][4], cP7=b[k-7][4], cP30=b[k-30][4], cP1=b[k-1][4];
      if(!(c>0)||!(cP7>0)||!(cP30>0)||!(cP1>0))continue;
      const rets:number[]=[]; for(let j=k-30;j<k;j++) if(b[j][4]>0&&b[j-1][4]>0) rets.push(b[j][4]/b[j-1][4]-1);
      if(rets.length<25)continue;
      const dv=mean(b.slice(k-30,k).map(x=>x[6]).filter(Number.isFinite));
      if(!(dv>1e6))continue;                                        // $1M/day floor
      const hi=Math.max(...b.slice(k-60,k+1).map(x=>x[2]));
      const flowW=b.slice(k-7,k); let tb=0,tv=0; for(const x of flowW){tb+=x[7];tv+=x[5];}
      const flow=tv>0?(2*tb-tv)/tv:0;                               // 7d aggressor imbalance
      const v7=mean(b.slice(k-7,k).map(x=>x[5])), v30=mean(b.slice(k-30,k).map(x=>x[5]));
      const relvol=(v7>0&&v30>0)?Math.log(v7/v30):0;
      const trades=mean(b.slice(k-7,k).map(x=>x[8]).filter(Number.isFinite));
      const LAG=Number(Deno.env.get("LAG")||0);
      if(k+1+LAG>=b.length)continue;
      const entry=b[k+LAG][4], exit=b[k+1+LAG][4];
      if(!(entry>0)||!(exit>0))continue;
      const y=exit/entry-1;
      const fr=fund7(r.symbol,b[k][0]);
      const x=[c/cP30-1,c/cP7-1,c/cP1-1,sdv(rets),Math.max(...rets),Math.log(dv),c/hi,flow,relvol,Math.log(1+trades),fr??0];
      if(!x.every(Number.isFinite)||!Number.isFinite(y)||Math.abs(y)>2)continue;
      panel.push({d:new Date(b[k][0]*1000).toISOString().slice(0,10),sym:r.symbol,x,y,yraw:y});
    }
  }
}
console.log(`    panel rows: ${panel.length.toLocaleString()}  features: ${FEAT.length}`);
// D-586: a run that built NO panel must die here rather than fall through to the dump step, where it would leave the
// PREVIOUS run's .tsv in place — which then reads as this run's result. That is how a mistyped SYMBOLS filter
// ("restricted to 0 of 31 requested names") nearly got recorded as a measured 5.6-year underwater stretch. Same
// defect class as D-546/547, where an unstamped dump path let one venue's file silently stand in for another's.
if(panel.length===0){console.error("!! EMPTY PANEL — no rows survived the filters (check SYMBOLS/TF/AGEBAND). Refusing to run: a stale dump from a previous run would otherwise be read as this run's result.");Deno.exit(1);}
const byD=new Map<string,Row[]>(); for(const p of panel)(byD.get(p.d)??byD.set(p.d,[]).get(p.d)!).push(p);
for(const [,g] of byD){ if(g.length<MINNAMES_N){g.length=0;continue;}
  for(let f=0;f<FEAT.length;f++){const o=[...g.keys()].sort((a,b)=>g[a].x[f]-g[b].x[f]); o.forEach((gi,rk)=>{g[gi].x[f]=rk/(g.length-1)-0.5;});}
  const oy=[...g.keys()].sort((a,b)=>g[a].y-g[b].y); oy.forEach((gi,rk)=>{g[gi].y=rk/(g.length-1)-0.5;});
}
// D-535 INSTABILITY FIX: the D-451 (328 contracts) vs D-532 (498) gap came from the universe being "whatever we
// happen to hold". A FIXED-N liquid universe is stable across data refreshes by construction, and it is also the only
// universe an operator can actually trade. TOPN=0 keeps the old all-names behaviour for comparison.
const TOPN=Number(Deno.env.get("TOPN")||0);
const INVERT=Deno.env.get("INVERT")==="1";
// D-638: record who is actually IN the traded universe, so the survivorship mitigation can be TESTED rather than
// asserted. crypto-survivorship-audit argues the bias is tolerable because "the frozen specification trades the
// top-50 by dollar volume, where majors essentially never delist". Binance's own exchangeInfo says 129 of 654 USDT
// perps (19.7%) are in SETTLING right now, including MKRUSDT and FTMUSDT — names that were not minor.
const universeMembers=new Map<string,number>();   // symbol -> days present in the traded universe
if(TOPN>0){for(const [,g] of byD){ if(g.length<=TOPN)continue;
  g.sort((a,b)=>INVERT?a.x[5]-b.x[5]:b.x[5]-a.x[5]); g.length=TOPN;                  // feature 5 = log dvol (rank-normalised, higher = more liquid)
  for(const r of g) universeMembers.set(r.sym,(universeMembers.get(r.sym)??0)+1);
  for(let f=0;f<FEAT.length;f++){const o=[...g.keys()].sort((a,b)=>g[a].x[f]-g[b].x[f]);o.forEach((gi,rk)=>{g[gi].x[f]=rk/(g.length-1)-0.5;});}
  const oy=[...g.keys()].sort((a,b)=>g[a].y-g[b].y); oy.forEach((gi,rk)=>{g[gi].y=rk/(g.length-1)-0.5;});
}}
const MINNAMES=MINNAMES_N;
const FROM=Deno.env.get("FROM")||"", UNTIL=Deno.env.get("UNTIL")||"";
const clean=[...byD.entries()].filter(([d,g])=>g.length>=MINNAMES&&(!FROM||d>=FROM)&&(!UNTIL||d<UNTIL)).sort((a,b)=>a[0]<b[0]?-1:1);
if(FROM||UNTIL)console.log(`    WINDOW: ${FROM||"start"} .. ${UNTIL||"end"}`);
console.log(`    usable days (>=${MINNAMES} names): ${clean.length}, mean breadth ${mean(clean.map(([,g])=>g.length)).toFixed(0)} names`);
if(clean.length<400){console.error("!! too few usable days — UNTESTED, not null");Deno.exit(1);}
// --- models (histogram GBM + ridge, same as D-419) ---
type Node={leaf?:number;f?:number;bin?:number;l?:Node;r?:Node};
const NBIN=16;
function fitTreeB(B:Uint8Array[],g:Float64Array,idx:Int32Array,depth:number):Node{
  const n=idx.length; let tot=0; for(let q=0;q<n;q++)tot+=g[idx[q]];
  if(depth===0||n<50)return{leaf:tot/Math.max(1,n)};
  const P=B.length,hs=new Float64Array(P*NBIN),hc=new Int32Array(P*NBIN);
  for(let q=0;q<n;q++){const i=idx[q],gv=g[i];for(let f=0;f<P;f++){const o=f*NBIN+B[f][i];hs[o]+=gv;hc[o]++;}}
  let bg=0,bf=-1,bb=0;
  for(let f=0;f<P;f++){let cs=0,cc=0;for(let b2=0;b2<NBIN-1;b2++){cs+=hs[f*NBIN+b2];cc+=hc[f*NBIN+b2];const cr=n-cc;
    if(cc<25||cr<25)continue;const gain=(cs*cs)/cc+((tot-cs)*(tot-cs))/cr-(tot*tot)/n;
    if(gain>bg){bg=gain;bf=f;bb=b2;}}}
  if(bf<0)return{leaf:tot/n};
  let nl=0;for(let q=0;q<n;q++)if(B[bf][idx[q]]<=bb)nl++;
  const L=new Int32Array(nl),R=new Int32Array(n-nl);let a=0,c2=0;
  for(let q=0;q<n;q++){const i=idx[q];if(B[bf][i]<=bb)L[a++]=i;else R[c2++]=i;}
  return{f:bf,bin:bb,l:fitTreeB(B,g,L,depth-1),r:fitTreeB(B,g,R,depth-1)};
}
const predB=(t:Node,b:number[]):number=>t.leaf!==undefined?t.leaf:(b[t.f!]<=t.bin!?predB(t.l!,b):predB(t.r!,b));
const toBin=(v:number)=>Math.max(0,Math.min(NBIN-1,Math.floor((v+0.5)*NBIN)));
function fitGBM(rows:Row[],trees=150,lr=0.06,depth=3){
  const n=rows.length,P=rows[0].x.length;
  const B:Uint8Array[]=Array.from({length:P},()=>new Uint8Array(n));
  for(let i=0;i<n;i++)for(let f=0;f<P;f++)B[f][i]=toBin(rows[i].x[f]);
  const y=Float64Array.from(rows.map(r=>r.y)),F=new Float64Array(n),g=new Float64Array(n);
  const idx=new Int32Array(n);for(let i=0;i<n;i++)idx[i]=i;
  const model:Node[]=[];
  for(let t=0;t<trees;t++){for(let i=0;i<n;i++)g[i]=y[i]-F[i];
    const tr=fitTreeB(B,g,idx,depth);model.push(tr);
    const bb=new Array(P);for(let i=0;i<n;i++){for(let f=0;f<P;f++)bb[f]=B[f][i];F[i]+=lr*predB(tr,bb);}}
  return (x:number[])=>{const b=x.map(toBin);return model.reduce((s,t)=>s+lr*predB(t,b),0);};
}
function fitOLS(X:number[][],y:number[]){
  const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-6*X.length;
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const d=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=d;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  const w=M.map(r=>r[p]);return (x:number[])=>x.reduce((s,v,i)=>s+v*w[i],0);
}
const spear=(a:number[],b:number[])=>{const n=a.length;const ra=[...a.keys()].sort((i,j)=>a[i]-a[j]),rb=[...a.keys()].sort((i,j)=>b[i]-b[j]);
  const A=new Array(n),B2=new Array(n);ra.forEach((i,r)=>A[i]=r);rb.forEach((i,r)=>B2[i]=r);
  const m=(n-1)/2;let nu=0,da=0,db=0;for(let i=0;i<n;i++){nu+=(A[i]-m)*(B2[i]-m);da+=(A[i]-m)**2;db+=(B2[i]-m)**2;}
  return da&&db?nu/Math.sqrt(da*db):0;};
// walk-forward by YEAR
const years=[...new Set(clean.map(([d])=>+d.slice(0,4)))].sort((a,b)=>a-b);
const START=years[0]+2;
console.log(`    walk-forward: train <= Y-1, predict Y, for Y = ${START}..${years.at(-1)}\n`);
const res:Record<string,number[]>={gbm:[],lin:[],mom:[]};
// D-534: the Liquidity Law asked of this program's best PLACEABLE candidate. dvol is feature index 5 (log dollar
// volume) — rank-normalised per day, so the top tercile is >= +1/6 in the [-0.5,+0.5] rank space.
const LIQBAND=(Deno.env.get("LIQBAND")||"").toLowerCase();   // D-584: "liq" | "illiq" | ""
const MINNAMES_LIQ=Number(Deno.env.get("MINNAMES_LIQ")||12);  // rank floor inside a tercile
const HOLD=Number(Deno.env.get("HOLD")||1);
const cohorts:{w:Map<string,number>;left:number}[]=[];
const cohortsL:{w:Map<string,number>;left:number}[]=[];          // live cohorts, each expiring after HOLD days
const books:Record<string,number[]>={gbmEq:[],gbmConv:[],gbmLiq:[],gbmIlliq:[],gbmHold:[],linHold:[]};
const legLong:number[]=[],legShort:number[]=[];   // D-637
let prevCohortSigned:Map<string,number>|null=null; const cohortOverlap:number[]=[]; const cohortFlip:number[]=[];   // D-657
const bookDates:string[]=[];
let prevW:Record<string,Map<string,number>>={gbmEq:new Map(),gbmConv:new Map(),gbmLiq:new Map(),gbmIlliq:new Map()};
const FULLSPAN=Deno.env.get("FULLSPAN")==="1"&&!!Deno.env.get("FEATSET");
if(FULLSPAN)console.log(`    FULLSPAN: parameter-free spec, evaluating ALL ${clean.length} usable days (no training window needed)`);
for(const Y of (FULLSPAN?[years[0]]:years.filter(y=>y>=START))){
  const tr=FULLSPAN?clean.slice(0,Math.max(1,Math.floor(clean.length*0.1))).flatMap(([,g])=>g):clean.filter(([d])=>+d.slice(0,4)<Y).flatMap(([,g])=>g);
  const te=FULLSPAN?clean:clean.filter(([d])=>+d.slice(0,4)===Y);
  const NEEDS_TRAINING=!Deno.env.get("FEATSET")&&!Deno.env.get("FEATURE");
  if((NEEDS_TRAINING&&tr.length<3000)||!te.length)continue;   // lit/single-feature specs fit nothing — no training floor
  const gbm=fitGBM(tr), lin=fitOLS(tr.map(r=>r.x),tr.map(r=>r.y));   // unused when FEATSET is set; kept for the IC lines
  for(const [DAYDATE,g0] of te){
    // D-584: THE LIQUIDITY LAW, applied to the path this book actually REPORTS. The gbmLiq/gbmIlliq books
    // above decompose only the GBM path; the headline number is linHold, which has never been decomposed.
    // LIQBAND=liq|illiq re-runs the identical book INSIDE one dollar-volume tercile (feature 5 = log dvol,
    // rank-normalised per day to [-0.5,+0.5], so the terciles are >= +1/6 and <= -1/6).
    const g=LIQBAND==="liq"?g0.filter(r=>r.x[5]>=1/6):LIQBAND==="illiq"?g0.filter(r=>r.x[5]<=-1/6):g0;
    if(LIQBAND&&g.length<MINNAMES_LIQ)continue;   // a tercile too thin to rank is UNTESTED, not zero
    const yy=g.map(r=>r.y);
    res.gbm.push(spear(g.map(r=>gbm(r.x)),yy));
    res.lin.push(spear(g.map(r=>lin(r.x)),yy));
    res.mom.push(spear(g.map(r=>r.x[0]),yy));
    const pred=g.map(r=>gbm(r.x));
    const ord=[...g.keys()].sort((a,b)=>pred[b]-pred[a]);
    const k=Math.max(3,Math.floor(g.length/5));
    const mk=(pairs:[string,number][]):Map<string,number>=>{const gr=pairs.reduce((s,x)=>s+Math.abs(x[1]),0)||1;return new Map(pairs.map(([kk,v])=>[kk,v/gr*2]));};
    const W:Record<string,Map<string,number>>={};
    W.gbmEq=mk([...ord.slice(0,k).map(i=>[g[i].sym,1] as [string,number]),...ord.slice(-k).map(i=>[g[i].sym,-1] as [string,number])]);
    const pm=mean(pred),ps=sdv(pred)||1e-9;
    W.gbmConv=mk(ord.filter(i=>Math.abs(pred[i]-pm)/ps>1).map(i=>[g[i].sym,(pred[i]-pm)/ps] as [string,number]));
    const DV=5;                                                  // feature 5 = log dvol, rank-normalised to [-0.5,0.5]
    const liqIdx=[...g.keys()].filter(i=>g[i].x[DV]>=1/6), illIdx=[...g.keys()].filter(i=>g[i].x[DV]<=-1/6);
    for(const [bk,idxs] of [["gbmLiq",liqIdx],["gbmIlliq",illIdx]] as [string,number[]][]){
      if(idxs.length<12){W[bk]=new Map();continue;}
      const o2=[...idxs].sort((a,b)=>pred[b]-pred[a]);
      const k2=Math.max(3,Math.floor(idxs.length/5));
      W[bk]=mk([...o2.slice(0,k2).map(i=>[g[i].sym,1] as [string,number]),...o2.slice(-k2).map(i=>[g[i].sym,-1] as [string,number])]);
    }
    const rmap=new Map(g.map(r=>[r.sym,r.yraw]));
    // ---- HOLD-period book (D-538): 1/HOLD of capital rebalances each day; turnover falls ~HOLD-fold ----
    {
      for(const c of cohorts)c.left--;
      while(cohorts.length&&cohorts[0].left<=0)cohorts.shift();
      const QW=Number(Deno.env.get("QWIDTH")||5);   // D-567: 5=quintiles (default), 3=terciles, 2=halves
      const kH=Math.max(3,Math.floor(g.length/QW));
      const newW=new Map<string,number>();
      for(const i of ord.slice(0,kH))newW.set(g[i].sym,1/(2*kH));
      for(const i of ord.slice(-kH))newW.set(g[i].sym,-1/(2*kH));
      cohorts.push({w:newW,left:HOLD});
      let ret=0,gross=0;
      for(const c of cohorts){for(const [sym,w] of c.w){ret+=w*(rmap.get(sym)??0)/cohorts.length;gross+=Math.abs(w)/cohorts.length;}}
      const turnoverFrac=1/Math.max(1,cohorts.length);            // fraction of book replaced today
      books.gbmHold.push(ret*(2/Math.max(1e-9,gross))-turnoverFrac*FEE_BP/1e4);
      // same construction driven by the LINEAR composite, or by ONE feature when FEATURE is set (D-542)
      const FEATNAME=Deno.env.get("FEATURE")||"";
      const SET=Deno.env.get("FEATSET")||"";
      const fi=FEATNAME?FEAT.indexOf(FEATNAME):-1;
      const LIT3:[string,number][]=[["hi60",1],["vol30",-1],["maxret",-1]];
      const LIT5:[string,number][]=[...LIT3,["mom7",1],["flow",1]];
      const LIT6:[string,number][]=[...LIT5,["fund7",-1]];      // PRE-REGISTERED: short crowded longs (high funding)
      const litSet=SET==="lit3"?LIT3:SET==="lit5"?LIT5:SET==="lit6"?LIT6:null;
      const predL=litSet
        ? g.map(r=>litSet.reduce((s2,[nm,sg])=>{const j=FEAT.indexOf(nm);return j>=0?s2+sg*r.x[j]:s2;},0)/litSet.length)
        : (fi>=0?g.map(r=>r.x[fi]):g.map(r=>lin(r.x)));
      const ordL=[...g.keys()].sort((a,b)=>predL[b]-predL[a]);
      const wL=new Map<string,number>();
      for(const i of ordL.slice(0,kH))wL.set(g[i].sym,1/(2*kH));
      for(const i of ordL.slice(-kH))wL.set(g[i].sym,-1/(2*kH));
      // D-657 TURNOVER MEASUREMENT (THE TURNOVER LAW, D-656). The fee model charges FEE_BP/cohorts every day, which
      // assumes every position is closed and reopened each cycle — 73 round trips a year at HOLD=5, or 6.57%/yr at
      // 9bp. That is only correct if consecutive cohorts share no names. Where a name IS re-selected you would net
      // the position rather than trade it, so persistence makes the charge CONSERVATIVE. Measuring it says whether
      // the book is overcharged (and its true return higher) or the assumption is right.
      // SIGN MATTERS AND THE FIRST VERSION IGNORED IT. Counting bare name overlap treats a name that flips from
      // long to short as if it were held — but a flip is a DOUBLE trade, the most expensive move in the book, not a
      // netted one. Overlap must be counted only where the SIGN is unchanged, and flips counted as extra turnover.
      if(prevCohortSigned){
        let held=0, flipped=0;
        for(const [s2,w2] of wL){
          const prev=prevCohortSigned.get(s2);
          if(prev===undefined) continue;
          if(Math.sign(prev)===Math.sign(w2)) held++; else flipped++;
        }
        const n=Math.max(1,wL.size);
        cohortOverlap.push(held/n);      // fraction carried at the SAME sign — genuinely nettable
        cohortFlip.push(flipped/n);      // fraction present but REVERSED — costs a double trade
      }
      prevCohortSigned=new Map(wL);
      cohortsL.push({w:wL,left:HOLD});
      for(const c of cohortsL)c.left--;
      while(cohortsL.length&&cohortsL[0].left<=0)cohortsL.shift();
      // D-637: LEG DECOMPOSITION. Line 210 has said since D-538 that "the headline number is linHold, which has
      // never been decomposed", and it is the largest claim on this board. Note first what the benchmark law does
      // and does not require here: wL puts +1/(2k) on the top cohort and -1/(2k) on the bottom, so the book is
      // dollar-neutral BY CONSTRUCTION and universe drift cancels exactly. That is why this book does not have the
      // D-627 defect, where a "spread" turned out to be two positive legs. What is still unknown, and is what the
      // legs answer, is whether the SHORT side contributes anything or the whole result is a long-side tilt.
      let retL=0,grossL=0,retLong=0,retShort=0,grossLong=0,grossShort=0;
      for(const c of cohortsL){for(const [sym,w] of c.w){
        const r=(rmap.get(sym)??0)/cohortsL.length;
        retL+=w*r;grossL+=Math.abs(w)/cohortsL.length;
        if(w>0){retLong+=w*r;grossLong+=w/cohortsL.length;}else{retShort+=w*r;grossShort+=(-w)/cohortsL.length;}
      }}
      books.linHold.push(retL*(2/Math.max(1e-9,grossL))-(1/Math.max(1,cohortsL.length))*FEE_BP/1e4);
      // Each leg scaled to unit gross so the two are directly comparable. Fees are charged to the book line only,
      // not double-charged onto each leg.
      legLong.push(retLong/Math.max(1e-9,grossLong));
      legShort.push(retShort/Math.max(1e-9,grossShort));   // sign kept: a NEGATIVE value here means shorting PAID
      bookDates.push(DAYDATE);
    }
    for(const kk of Object.keys(books)){
      if(!W[kk])continue;                                          // gbmHold is computed separately (D-538)
      let ret=0; for(const [sym,w] of W[kk]) ret+=w*(rmap.get(sym)??0);
      let to=0; for(const sym of new Set([...W[kk].keys(),...prevW[kk].keys()])) to+=Math.abs((W[kk].get(sym)||0)-(prevW[kk].get(sym)||0));
      books[kk].push(ret-(to/2)*FEE_BP/1e4);
    }
    prevW=W;
  }
  Deno.stderr.write(new TextEncoder().encode(`  ..${Y}\r`));
}
console.log(`\n    ${"model".padEnd(22)}${"OOS rank IC".padEnd(14)}${"t(IC)".padEnd(9)}n_days`);
for(const [k,v] of Object.entries(res)){ if(!v.length)continue;
  const m=mean(v),t=m/(sdv(v)/Math.sqrt(v.length));
  console.log(`    ${({gbm:"GBM (non-linear)",lin:"linear composite",mom:"momentum 30d alone"}[k]!).padEnd(22)}${m.toFixed(4).padEnd(14)}${t.toFixed(2).padEnd(9)}${v.length}`);}
const d=res.gbm.map((x,i)=>x-res.lin[i]); const dt=mean(d)/(sdv(d)/Math.sqrt(d.length));
console.log(`\n    GBM - linear: delta IC ${mean(d).toFixed(4)}, paired t ${dt.toFixed(2)}  ->  ${Math.abs(dt)>2?(dt>0?"NON-LINEARITY ADDS":"non-linearity HURTS"):"NULL: adds nothing"}`);
console.log(`\n    ${"book (net of fees)".padEnd(22)}${"%/yr".padEnd(10)}${"SR".padEnd(8)}${"t".padEnd(8)}${"maxDD".padEnd(9)}n`);
for(const [k,v] of Object.entries(books)){ if(v.length<300)continue;
  const m=mean(v),sd=sdv(v)||1e-9; let cum=1,peak=1,dd=0;
  for(const x of v){cum*=1+x;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  console.log(`    ${({gbmEq:"GBM equal-weight",gbmConv:"GBM conviction-wt",gbmLiq:"GBM LIQUID tercile",gbmIlliq:"GBM ILLIQUID tercile",gbmHold:`GBM ${HOLD}d-HOLD`,linHold:`LINEAR ${HOLD}d-HOLD`}[k]!).padEnd(22)}${((m*365*100).toFixed(1)+"%").padEnd(10)}${((m/sd)*Math.sqrt(365)).toFixed(2).padEnd(8)}${(m/(sd/Math.sqrt(v.length))).toFixed(2).padEnd(8)}${((dd*100).toFixed(0)+"%").padEnd(9)}${v.length}`);}
console.log(`\n    Deflated ceiling (D-363/364, ~1.53M trials): t ~ 5.34. Anything below that is not evidence.`);
if(Deno.env.get("EXHAUST")==="1"){
  const LITSIGNED:[string,number][]=[["hi60",1],["vol30",-1],["maxret",-1],["mom7",1],["flow",1],["mom30",1],["rev1",-1]];
  const HOLDE=HOLD;
  const evalSet2=(set:[string,number][])=>{
    const coh:{w:Map<string,number>;left:number}[]=[]; const out:number[]=[];
    for(const [,g] of clean){
      const pred=g.map(r=>set.reduce((s2,[nm,sg])=>{const j=FEAT.indexOf(nm);return j>=0?s2+sg*r.x[j]:s2;},0)/set.length);
      const ord=[...g.keys()].sort((a,b)=>pred[b]-pred[a]);
      const kk=Math.max(3,Math.floor(g.length/5));
      const w=new Map<string,number>();
      for(const i of ord.slice(0,kk))w.set(g[i].sym,1/(2*kk));
      for(const i of ord.slice(-kk))w.set(g[i].sym,-(1/(2*kk)));
      coh.push({w,left:HOLDE});
      for(const c of coh)c.left--;
      while(coh.length&&coh[0].left<=0)coh.shift();
      const rmap=new Map(g.map(r=>[r.sym,r.yraw]));
      let ret=0,gr=0;
      for(const c of coh){for(const [sym,ww] of c.w){ret+=ww*(rmap.get(sym)??0)/coh.length;gr+=Math.abs(ww)/coh.length;}}
      out.push(ret*(2/Math.max(1e-9,gr))-(1/Math.max(1,coh.length))*FEE_BP/1e4);
    }
    if(out.length<300)return null;
    const m=mean(out),s3=sdv(out)||1e-9;
    return {t:m/(s3/Math.sqrt(out.length)),ann:m*365*100,sr:(m/s3)*Math.sqrt(365)};};
  const combos:[string,number][][]=[];
  const idx=[0,1,2,3,4,5,6];
  for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)for(let c=b+1;c<7;c++)for(let d=c+1;d<7;d++)for(let e=d+1;e<7;e++)
    combos.push([idx[a],idx[b],idx[c],idx[d],idx[e]].map(i=>LITSIGNED[i]));
  const res:{names:string;t:number;ann:number;sr:number}[]=[];
  for(const set of combos){
    const r=evalSet2(set);
    if(r)res.push({names:set.map(x=>x[0]).join("+"),t:r.t,ann:r.ann,sr:r.sr});
  }
  res.sort((a,b)=>b.t-a.t);
  console.log(`\n==> EXHAUSTIVE LITERATURE SUBSETS (D-560): all ${res.length} five-subsets of the 7 literature-signed features`);
  console.log(`    ${"rank".padEnd(6)}${"subset".padEnd(44)}${"%/yr".padEnd(9)}${"SR".padEnd(7)}t`);
  res.forEach((r,i)=>{
    const isLit5=r.names.split("+").sort().join("+")===["hi60","vol30","maxret","mom7","flow"].sort().join("+");
    if(i<5||i>=res.length-3||isLit5)
      console.log(`    ${String(i+1).padEnd(6)}${(r.names+(isLit5?"  <== lit5":"")).padEnd(44)}${r.ann.toFixed(1).padEnd(9)}${r.sr.toFixed(2).padEnd(7)}${r.t.toFixed(2)}`);
  });
  const lit5r=res.findIndex(r=>r.names.split("+").sort().join("+")===["hi60","vol30","maxret","mom7","flow"].sort().join("+"));
  console.log(`\n    lit5 ranks ${lit5r+1} of ${res.length}. median subset t ${res[Math.floor(res.length/2)].t.toFixed(2)}, worst ${res[res.length-1].t.toFixed(2)}`);
  console.log(`    -> ${lit5r===0?"lit5 is the BEST subset — which means my choice, not the literature, is doing the work":lit5r<res.length*0.25?"lit5 is in the top quartile: my selection helped, so part of its t is selection":"lit5 is UNREMARKABLE among literature subsets — the effect belongs to the literature set as a whole, not to my choice"}`);
}
if(Deno.env.get("NULLTEST")==="1"){
  // deterministic LCG so the null is repeatable
  let sd2=20260825; const rnd=()=>{sd2=(sd2*1103515245+12345)&0x7fffffff;return sd2/0x7fffffff;};
  const HOLDN=HOLD;
  const evalSet=(set:[string,number][])=>{
    const coh:{w:Map<string,number>;left:number}[]=[]; const out:number[]=[];
    for(const [,g] of clean){
      const pred=g.map(r=>set.reduce((s2,[nm,sg])=>{const j=FEAT.indexOf(nm);return j>=0?s2+sg*r.x[j]:s2;},0)/set.length);
      const ord=[...g.keys()].sort((a,b)=>pred[b]-pred[a]);
      const kk=Math.max(3,Math.floor(g.length/5));
      const w=new Map<string,number>();
      for(const i of ord.slice(0,kk))w.set(g[i].sym,1/(2*kk));
      for(const i of ord.slice(-kk))w.set(g[i].sym,-(1/(2*kk)));
      coh.push({w,left:HOLDN});
      for(const c of coh)c.left--;
      while(coh.length&&coh[0].left<=0)coh.shift();
      const rmap=new Map(g.map(r=>[r.sym,r.yraw]));
      let ret=0,gr=0;
      for(const c of coh){for(const [sym,ww] of c.w){ret+=ww*(rmap.get(sym)??0)/coh.length;gr+=Math.abs(ww)/coh.length;}}
      out.push(ret*(2/Math.max(1e-9,gr))-(1/Math.max(1,coh.length))*FEE_BP/1e4);
    }
    if(out.length<300)return null;
    const m=mean(out),s3=sdv(out)||1e-9;
    return m/(s3/Math.sqrt(out.length));};
  const ts:number[]=[];
  for(let trial=0;trial<300;trial++){
    const pool=[...FEAT];
    const set:[string,number][]=[];
    while(set.length<5&&pool.length){
      const nm=pool.splice(Math.floor(rnd()*pool.length),1)[0];
      set.push([nm,rnd()<0.5?1:-1]);
    }
    const t=evalSet(set); if(t!==null&&Number.isFinite(t))ts.push(t);
  }
  ts.sort((a,b)=>a-b);
  const q=(p:number)=>ts[Math.min(ts.length-1,Math.floor(p*ts.length))];
  console.log(`\n==> NULL DISTRIBUTION (D-559): ${ts.length} RANDOM 5-feature signed books, identical construction`);
  console.log(`    median |t| ${q(0.5).toFixed(2)}   90th ${q(0.9).toFixed(2)}   95th ${q(0.95).toFixed(2)}   99th ${q(0.99).toFixed(2)}   max ${ts[ts.length-1].toFixed(2)}`);
  const abs=ts.map(Math.abs).sort((a,b)=>a-b);
  const qa=(p:number)=>abs[Math.min(abs.length-1,Math.floor(p*abs.length))];
  console.log(`    two-sided |t|: median ${qa(0.5).toFixed(2)}  95th ${qa(0.95).toFixed(2)}  99th ${qa(0.99).toFixed(2)}`);
  const LIT5T=3.04;
  const beat=abs.filter(x=>x>=LIT5T).length;
  console.log(`    lit5 scored t ${LIT5T}; ${beat} of ${abs.length} random signed books reached that in absolute value (${(100*beat/abs.length).toFixed(1)}%)`);
}
// D-532: dump the daily book streams so the pre-registered vol-management overlay can be applied without retraining.
// D-637 LEG REPORT. A dollar-neutral book nets the universe out by construction, so this is NOT the D-627 test —
// it answers a different question the headline cannot: does the SHORT side contribute, or is the result a long tilt?
if(legLong.length>30){
  // SIGN CONVENTION, and the first version of this block got it wrong. legShort holds the return TO SHORTING the
  // bottom cohort, so the bottom cohort's OWN return is -legShort. Averaging (legLong + legShort) therefore added
  // two quantities pointing opposite ways and produced a "universe" of -35.2%/yr with both excesses identical and a
  // share formula dividing by ~0 (it printed 3.5e12%). The cohort drift is (long + (-short))/2.
  const uni=legLong.map((v,i)=>(v-legShort[i])/2);
  const st=(v:number[])=>{const m=mean(v),sd=sdv(v)||1e-9;return{yr:m*365*100,sr:(m/sd)*Math.sqrt(365),t:m/(sd/Math.sqrt(v.length))};};
  const L=st(legLong),S=st(legShort),U=st(uni);
  console.log(`\n    LEG DECOMPOSITION (D-637) — n=${legLong.length} days, gross-normalised, fees on the book line only:`);
  console.log(`      LONG cohort        ${L.yr.toFixed(1).padStart(8)}%/yr  SR ${L.sr.toFixed(2).padStart(5)}  t ${L.t.toFixed(2).padStart(5)}`);
  console.log(`      SHORT cohort (return TO shorting) ${S.yr.toFixed(1).padStart(8)}%/yr  SR ${S.sr.toFixed(2).padStart(5)}  t ${S.t.toFixed(2).padStart(5)}   (negative = shorting these PAID)`);
  console.log(`      traded universe    ${U.yr.toFixed(1).padStart(8)}%/yr  (the drift a dollar-neutral book cancels by construction)`);
  const longExc=L.yr-U.yr, shortExc=U.yr-(-S.yr);
  console.log(`      long excess vs cohort drift ${longExc.toFixed(1).padStart(8)}%/yr   short excess ${shortExc.toFixed(1).padStart(8)}%/yr`);
  const denom=longExc+shortExc;
  const longShare=Math.abs(denom)<1e-6?NaN:longExc/denom;
  console.log(Number.isFinite(longShare)
    ? `      => ${(100*longShare).toFixed(0)}% of the spread comes from the LONG side, ${(100*(1-longShare)).toFixed(0)}% from the SHORT side`
    : `      => split UNDEFINED (the two excesses cancel); reported rather than printed as a spurious ratio`);
}
// D-657 TURNOVER REPORT
if(cohortOverlap.length>30){
  const ov=mean(cohortOverlap);
  const perDay=FEE_BP/HOLD/1e4, chargedYr=perDay*365*100;
  const fl=mean(cohortFlip);
  // A held name trades 0; a new name trades 1; a FLIPPED name trades 2 (close the old side, open the other).
  const trueTurn=Math.min(2,(1-ov-fl)+2*fl);
  const trueYr=trueTurn*(365/HOLD)*(FEE_BP/1e4)*100;
  console.log(`\n    TURNOVER (D-657, THE TURNOVER LAW) — ${cohortOverlap.length} consecutive cohort pairs:`);
  console.log(`      name overlap between consecutive cohorts: ${(100*ov).toFixed(1)}%`);
  console.log(`      of which SIGN-UNCHANGED (genuinely nettable): ${(100*ov).toFixed(1)}%  |  SIGN-FLIPPED (double trade): ${(100*fl).toFixed(1)}%`);
  console.log(`      => traded per cycle: ${(100*trueTurn).toFixed(1)}%  (new names 1x, flips 2x, held 0x)`);
  console.log(`      fee CHARGED by the model: ${chargedYr.toFixed(2)}%/yr (assumes 100% turnover every cycle)`);
  console.log(`      fee IMPLIED by measured turnover: ${trueYr.toFixed(2)}%/yr`);
  console.log(`      => the book is ${chargedYr>trueYr?"OVERCHARGED":"UNDERCHARGED"} by ${Math.abs(chargedYr-trueYr).toFixed(2)}%/yr`);
}
// D-638 SURVIVORSHIP REACH: does the delisting cohort touch the TRADED universe, or only the tail?
if(universeMembers.size){
  const settling=new Set((Deno.env.get("SETTLING_LIST")||"").split(",").map(x=>x.trim()).filter(Boolean));
  const rows=[...universeMembers.entries()].sort((a,b)=>b[1]-a[1]);
  const totDays=rows.reduce((s2,[,n])=>s2+n,0);
  const hit=rows.filter(([sym])=>settling.has(sym));
  const hitDays=hit.reduce((s2,[,n])=>s2+n,0);
  console.log(`\n    SURVIVORSHIP REACH (D-638) — traded universe = top-${TOPN} by dollar volume:`);
  console.log(`      distinct symbols that ever entered the traded universe: ${rows.length}`);
  if(settling.size){
    console.log(`      of those, now in SETTLING on the exchange: ${hit.length} (${(100*hit.length/rows.length).toFixed(1)}%)`);
    console.log(`      share of traded universe-days held by now-settling names: ${(100*hitDays/Math.max(1,totDays)).toFixed(1)}%`);
    console.log(`      worst offenders (symbol:days-in-universe): ${hit.slice(0,10).map(([s2,n])=>`${s2}:${n}`).join(" ")}`);
    console.log(`      => the mitigation "majors essentially never delist" is ${hit.length===0?"SUPPORTED":"NOT SUPPORTED"} at TOPN=${TOPN}`);
  } else console.log(`      SETTLING_LIST not supplied — reach UNTESTED, not zero.`);
}
// NOWRITE=1 skips the dump. A previous run of this script overwrote production streams with a variant
// configuration and the damage was undone only by luck of run ordering; a diagnostic re-run must not be able to
// mutate the frozen candidate's data.
if(Deno.env.get("NOWRITE")==="1"){console.log(`    NOWRITE=1 — dump skipped, production streams untouched.`);}
else await Deno.writeTextFile(`/Users/ona/aegis-data/crypto_books_${TF}_${Deno.env.get("FEATSET")||Deno.env.get("FEATURE")||"linear"}_top${TOPN}_lag${Number(Deno.env.get("LAG")||0)}_hold${HOLD}.tsv`,
  books.gbmEq.map((v,i)=>`${bookDates[i]??i}\t${v}\t${books.gbmConv[i]??""}\t${books.gbmLiq[i]??""}\t${books.gbmHold[i]??""}\t${books.linHold[i]??""}`).join("\n"));
console.log(`    book streams -> crypto_books_${TF}_${Deno.env.get("FEATSET")||Deno.env.get("FEATURE")||"linear"}_top${TOPN}_lag${Number(Deno.env.get("LAG")||0)}_hold${HOLD}.tsv (${books.gbmEq.length} days)`);
