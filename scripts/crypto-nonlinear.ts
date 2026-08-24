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
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("PERP_FEE_RT_BP")||9);
const FEAT=["mom30","mom7","rev1","vol30","maxret","dvol","hi60","flow","relvol","trades","fund7"];
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
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.${TF}&select=symbol,n_bars&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
console.log(`==> CRYPTO NON-LINEAR [${TF}] — ${meta.length} contracts${TF==="1dSF"?" (survivorship-free, incl. delisted)":" (SURVIVORSHIP-BIASED: listed only)"}`);
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
const byD=new Map<string,Row[]>(); for(const p of panel)(byD.get(p.d)??byD.set(p.d,[]).get(p.d)!).push(p);
for(const [,g] of byD){ if(g.length<40){g.length=0;continue;}
  for(let f=0;f<FEAT.length;f++){const o=[...g.keys()].sort((a,b)=>g[a].x[f]-g[b].x[f]); o.forEach((gi,rk)=>{g[gi].x[f]=rk/(g.length-1)-0.5;});}
  const oy=[...g.keys()].sort((a,b)=>g[a].y-g[b].y); oy.forEach((gi,rk)=>{g[gi].y=rk/(g.length-1)-0.5;});
}
// D-535 INSTABILITY FIX: the D-451 (328 contracts) vs D-532 (498) gap came from the universe being "whatever we
// happen to hold". A FIXED-N liquid universe is stable across data refreshes by construction, and it is also the only
// universe an operator can actually trade. TOPN=0 keeps the old all-names behaviour for comparison.
const TOPN=Number(Deno.env.get("TOPN")||0);
const INVERT=Deno.env.get("INVERT")==="1";
if(TOPN>0){for(const [,g] of byD){ if(g.length<=TOPN)continue;
  g.sort((a,b)=>INVERT?a.x[5]-b.x[5]:b.x[5]-a.x[5]); g.length=TOPN;                  // feature 5 = log dvol (rank-normalised, higher = more liquid)
  for(let f=0;f<FEAT.length;f++){const o=[...g.keys()].sort((a,b)=>g[a].x[f]-g[b].x[f]);o.forEach((gi,rk)=>{g[gi].x[f]=rk/(g.length-1)-0.5;});}
  const oy=[...g.keys()].sort((a,b)=>g[a].y-g[b].y); oy.forEach((gi,rk)=>{g[gi].y=rk/(g.length-1)-0.5;});
}}
const clean=[...byD.entries()].filter(([,g])=>g.length>=40).sort((a,b)=>a[0]<b[0]?-1:1);
console.log(`    usable days (>=40 names): ${clean.length}, mean breadth ${mean(clean.map(([,g])=>g.length)).toFixed(0)} names`);
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
const HOLD=Number(Deno.env.get("HOLD")||1);
const cohorts:{w:Map<string,number>;left:number}[]=[];
const cohortsL:{w:Map<string,number>;left:number}[]=[];          // live cohorts, each expiring after HOLD days
const books:Record<string,number[]>={gbmEq:[],gbmConv:[],gbmLiq:[],gbmIlliq:[],gbmHold:[],linHold:[]};
const bookDates:string[]=[];
let prevW:Record<string,Map<string,number>>={gbmEq:new Map(),gbmConv:new Map(),gbmLiq:new Map(),gbmIlliq:new Map()};
for(const Y of years.filter(y=>y>=START)){
  const tr=clean.filter(([d])=>+d.slice(0,4)<Y).flatMap(([,g])=>g);
  const te=clean.filter(([d])=>+d.slice(0,4)===Y);
  if(tr.length<3000||!te.length)continue;
  const gbm=fitGBM(tr), lin=fitOLS(tr.map(r=>r.x),tr.map(r=>r.y));
  for(const [DAYDATE,g] of te){
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
      const kH=Math.max(3,Math.floor(g.length/5));
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
      cohortsL.push({w:wL,left:HOLD});
      for(const c of cohortsL)c.left--;
      while(cohortsL.length&&cohortsL[0].left<=0)cohortsL.shift();
      let retL=0,grossL=0;
      for(const c of cohortsL){for(const [sym,w] of c.w){retL+=w*(rmap.get(sym)??0)/cohortsL.length;grossL+=Math.abs(w)/cohortsL.length;}}
      books.linHold.push(retL*(2/Math.max(1e-9,grossL))-(1/Math.max(1,cohortsL.length))*FEE_BP/1e4);
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
// D-532: dump the daily book streams so the pre-registered vol-management overlay can be applied without retraining.
await Deno.writeTextFile(`/Users/ona/aegis-data/crypto_books_${TF}_${Deno.env.get("FEATSET")||Deno.env.get("FEATURE")||"linear"}_top${TOPN}_lag${Number(Deno.env.get("LAG")||0)}_hold${HOLD}.tsv`,
  books.gbmEq.map((v,i)=>`${bookDates[i]??i}\t${v}\t${books.gbmConv[i]??""}\t${books.gbmLiq[i]??""}\t${books.gbmHold[i]??""}\t${books.linHold[i]??""}`).join("\n"));
console.log(`    book streams -> crypto_books_${TF}_${Deno.env.get("FEATSET")||Deno.env.get("FEATURE")||"linear"}_top${TOPN}_lag${Number(Deno.env.get("LAG")||0)}_hold${HOLD}.tsv (${books.gbmEq.length} days)`);
