#!/usr/bin/env -S deno run --allow-net --allow-env
// nonlinear.ts (D-419) — TIER-2 GAP: every test in this program has been a LINEAR rank-IC or a single-variable decile sort.
// That is a real methodological hole: a linear IC of ~0 is fully compatible with a strong NON-LINEAR or CONDITIONAL
// relationship (e.g. momentum works only in low-vol names, value only among profitable ones, an effect that is monotone in
// the middle and inverts in the tails -- which this program has already observed TWICE).
// So: build the monthly cross-sectional equity panel, then ask whether a GRADIENT-BOOSTED TREE ensemble -- which can
// represent interactions and non-monotonicity that rank-IC cannot see -- beats the linear baselines OUT OF SAMPLE.
// Discipline: strict walk-forward (train on <= year Y-1, predict year Y, never re-using future data), the SAME cost model,
// and the null is stated in advance: if the GBM does not beat the linear composite OOS, non-linearity is NULL for this panel.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"nl",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();

// SURVIVORSHIP STRESS KNOBS. `trd_bars_deep` is a CURRENTLY-LISTED universe: any name that delisted is absent from both
// legs, and that bias is concentrated in cheap, illiquid, high-volatility names. There is no delisted-equity source in this
// stack, so the bias cannot be removed -- but it CAN be starved: large, liquid, higher-priced names delist rarely, so if the
// edge survives at a $5 price floor and a $10M/day liquidity floor it is not primarily a survivorship artifact.
const PRICE_MIN=Number(Deno.env.get("PRICE_MIN")||1);
const DV_MIN=Number(Deno.env.get("DV_MIN")||1e6);
const FEAT=["mom12_1","rev1m","mom6_1","vol12","maxret","dvol","hi52","skew","relvol","amihud"];
type Row={mo:string;sym:string;x:number[];y:number;yraw:number;dv:number};
const panel:Row[]=[];

// --- stream the universe in chunks (a full preload OOM'd this box before) ---
const meta:{symbol:string}[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
console.log(`==> NON-LINEAR / CONDITIONAL TEST — universe ${meta.length} equities | PRICE_MIN=$${PRICE_MIN} DV_MIN=$${(DV_MIN/1e6).toFixed(0)}M/day`);
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};

for(let i=0;i<meta.length;i+=30){
  const part=meta.slice(i,i+30).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){
    const b=r.bars; if(!b||b.length<400)continue;
    // month-end indices
    const idx:number[]=[]; const mos:string[]=[]; let last="";
    for(let k=0;k<b.length;k++){const mo=new Date(b[k][0]*1000).toISOString().slice(0,7); if(mo!==last){ if(k>0){idx.push(k-1);mos.push(last);} last=mo; }}
    idx.push(b.length-1); mos.push(last);
    const c=b.map(x=>x[4]), v=b.map(x=>x[5]);
    const dret:number[]=[]; for(let k=1;k<c.length;k++)dret.push(c[k-1]>0?c[k]/c[k-1]-1:0);
    for(let j=0;j<idx.length-1;j++){
      const k=idx[j]; if(k<273)continue; const kn=idx[j+1];
      const px=c[k]; if(!(px>PRICE_MIN))continue;               // price floor (survivorship stress knob)
      const w252=dret.slice(k-252,k), w21=dret.slice(k-21,k), w126=dret.slice(k-126,k);
      if(w252.length<200)continue;
      const mom12_1=c[k-21]/c[k-252]-1, rev1m=c[k]/c[k-21]-1, mom6_1=c[k-21]/c[k-126]-1;
      const vol12=sdv(w252)*Math.sqrt(252), maxret=Math.max(...w21);
      let dv=0,cn=0; for(let q=k-21;q<k;q++){if(c[q]>0&&v[q]>0){dv+=c[q]*v[q];cn++;}} dv=cn?dv/cn:0;
      if(dv<DV_MIN)continue;                                     // LIQUIDITY FLOOR (D-383) — no micro-cap mirages
      const hi=Math.max(...c.slice(k-252,k+1)); const hi52=px/hi;
      const m3=mean(w126), s3=sdv(w126)||1e-9; const skew=mean(w126.map(x=>((x-m3)/s3)**3));
      // relvol = 21d volume vs its 252d average (volume SURPRISE). This slot previously held a second copy of log(dv) --
      // a duplicated feature shipped by mistake; trees ignore the redundancy but the feature list was lying about itself.
      let v21=0,v252=0,n21=0,n252=0;
      for(let q=k-21;q<k;q++)if(v[q]>0){v21+=v[q];n21++;}
      for(let q=k-252;q<k;q++)if(v[q]>0){v252+=v[q];n252++;}
      const relvol=(n21&&n252&&v252>0)?Math.log(((v21/n21)+1)/((v252/n252)+1)):0;
      const amihud=mean(w21.map((x,q)=>Math.abs(x)/Math.max(1,c[k-21+q]*v[k-21+q])))*1e9;
      const y=c[kn]/c[k]-1;                                      // forward 1-month return
      if(![mom12_1,rev1m,mom6_1,vol12,maxret,hi52,skew,relvol,amihud,y].every(Number.isFinite))continue;
      if(Math.abs(y)>3)continue;                                 // data-corruption guard (Yahoo crypto lesson)
      panel.push({mo:mos[j],sym:r.symbol,x:[mom12_1,rev1m,mom6_1,vol12,maxret,Math.log(dv),hi52,skew,relvol,amihud],y,yraw:y,dv});
    }
  }
  if(i%600===0)Deno.stderr.write(new TextEncoder().encode(`  ..${i}/${meta.length} panel=${panel.length}\r`));
}
console.log(`\n    panel rows: ${panel.length.toLocaleString()}  features: ${FEAT.length}`);
const months=[...new Set(panel.map(p=>p.mo))].sort();
console.log(`    months: ${months.length} (${months[0]} .. ${months.at(-1)})`);
// --- cross-sectional rank-normalise EVERY feature and the target, per month (so nothing is scale/outlier driven) ---
const byMo=new Map<string,Row[]>(); for(const p of panel)(byMo.get(p.mo)??byMo.set(p.mo,[]).get(p.mo)!).push(p);
for(const [,g] of byMo){ if(g.length<30){g.length=0;continue;}
  for(let f=0;f<FEAT.length;f++){const ord=[...g.keys()].sort((a,b)=>g[a].x[f]-g[b].x[f]); ord.forEach((gi,rk)=>{g[gi].x[f]=rk/(g.length-1)-0.5;});}
  const ordY=[...g.keys()].sort((a,b)=>g[a].y-g[b].y); ordY.forEach((gi,rk)=>{g[gi].y=rk/(g.length-1)-0.5;});
}
const clean=[...byMo.entries()].filter(([,g])=>g.length>=30);
console.log(`    usable months (>=30 names): ${clean.length}`);

// ================= models =================
// A compact gradient-boosted regression forest. Depth-3 trees on rank-normalised features can express BOTH interactions
// ("momentum only in low-vol names") and non-monotonicity ("works in the middle, inverts in the tails") -- exactly the two
// shapes a linear rank-IC is blind to and that this program has already observed twice in its tail results.
type Node={leaf?:number;f?:number;bin?:number;l?:Node;r?:Node};
const NBIN=16;
// HISTOGRAM SPLIT FINDING. The naive version (90 full scans per node) was O(90*n) per node and stalled once the expanding
// training window passed ~10k rows. Features are already cross-sectionally rank-normalised, so they bin exactly into NBIN
// equal buckets; one pass per node fills all 10 histograms and every candidate split is then read off cumulative sums.
function fitTreeB(B:Uint8Array[],g:Float64Array,idx:Int32Array,depth:number):Node{
  const n=idx.length;
  let tot=0; for(let q=0;q<n;q++)tot+=g[idx[q]];
  if(depth===0||n<50)return{leaf:tot/Math.max(1,n)};
  const P=B.length; const hs=new Float64Array(P*NBIN), hc=new Int32Array(P*NBIN);
  for(let q=0;q<n;q++){const i=idx[q],gv=g[i];for(let f=0;f<P;f++){const o=f*NBIN+B[f][i];hs[o]+=gv;hc[o]++;}}
  let bg=0,bf=-1,bb=0;
  for(let f=0;f<P;f++){let cs=0,cc=0;
    for(let b=0;b<NBIN-1;b++){cs+=hs[f*NBIN+b];cc+=hc[f*NBIN+b];const cr=n-cc;
      if(cc<25||cr<25)continue;
      const gain=(cs*cs)/cc+((tot-cs)*(tot-cs))/cr-(tot*tot)/n;
      if(gain>bg){bg=gain;bf=f;bb=b;}}}
  if(bf<0)return{leaf:tot/n};
  let nl=0; for(let q=0;q<n;q++)if(B[bf][idx[q]]<=bb)nl++;
  const L=new Int32Array(nl),R=new Int32Array(n-nl); let a=0,c2=0;
  for(let q=0;q<n;q++){const i=idx[q];if(B[bf][i]<=bb)L[a++]=i;else R[c2++]=i;}
  return{f:bf,bin:bb,l:fitTreeB(B,g,L,depth-1),r:fitTreeB(B,g,R,depth-1)};
}
const predB=(t:Node,b:number[]):number=>t.leaf!==undefined?t.leaf:(b[t.f!]<=t.bin!?predB(t.l!,b):predB(t.r!,b));
const toBin=(v:number)=>Math.max(0,Math.min(NBIN-1,Math.floor((v+0.5)*NBIN)));
function fitGBMB(rows:Row[],trees=150,lr=0.06,depth=3){
  const n=rows.length,P=rows[0].x.length;
  const B:Uint8Array[]=Array.from({length:P},()=>new Uint8Array(n));
  for(let i=0;i<n;i++)for(let f=0;f<P;f++)B[f][i]=toBin(rows[i].x[f]);
  const y=Float64Array.from(rows.map(r=>r.y)), F=new Float64Array(n), g=new Float64Array(n);
  const idx=new Int32Array(n); for(let i=0;i<n;i++)idx[i]=i;
  const model:Node[]=[];
  for(let t=0;t<trees;t++){ for(let i=0;i<n;i++)g[i]=y[i]-F[i];
    const tr=fitTreeB(B,g,idx,depth); model.push(tr);
    const bb=new Array(P); for(let i=0;i<n;i++){for(let f=0;f<P;f++)bb[f]=B[f][i];F[i]+=lr*predB(tr,bb);} }
  return (x:number[])=>{const b=x.map(toBin);return model.reduce((s2,t)=>s2+lr*predB(t,b),0);};
}
function fitOLS(X:number[][],y:number[]){ // ridge-regularised linear baseline
  const p=X[0].length, A=Array.from({length:p},()=>new Array(p).fill(0)), bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-6*X.length;
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const d=M[c][c]||1e-12; for(let k=c;k<=p;k++)M[c][k]/=d;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  const w=M.map(r=>r[p]); return (x:number[])=>x.reduce((s,v,i)=>s+v*w[i],0);
}
const spearman=(a:number[],b:number[])=>{const n=a.length;const ra=[...a.keys()].sort((i,j)=>a[i]-a[j]),rb=[...a.keys()].sort((i,j)=>b[i]-b[j]);
  const A=new Array(n),B=new Array(n); ra.forEach((i,r)=>A[i]=r); rb.forEach((i,r)=>B[i]=r);
  const ma=(n-1)/2; let num=0,da=0,db=0; for(let i=0;i<n;i++){num+=(A[i]-ma)*(B[i]-ma);da+=(A[i]-ma)**2;db+=(B[i]-ma)**2;}
  return da&&db?num/Math.sqrt(da*db):0;};

// ================= strict walk-forward =================
// Train on EVERYTHING up to year Y-1, predict year Y. Never touches future data. Same protocol for every model, so the
// comparison is apples-to-apples and the only question is whether non-linearity buys anything.
const years=[...new Set(clean.map(([mo])=>+mo.slice(0,4)))].sort((a,b)=>a-b);
// SURVIVORSHIP FLOOR: `trd_bars_deep` is a currently-listed universe, so pre-1996 rows are firms that survived 30+ years.
// Any conclusion drawn there is about survivors, not about the market. Walk-forward starts where the panel is broad.
const START=Math.max(years[0]+6,1996);
console.log(`\n    walk-forward: train <= Y-1, predict Y, for Y = ${START}..${years.at(-1)}`);
const wf:[number,[string,Row[],number[]][]][]=[];
const res:Record<string,{ic:number[];ls:number[]}>={gbm:{ic:[],ls:[]},lin:{ic:[],ls:[]},mom:{ic:[],ls:[]},rev:{ic:[],ls:[]}};
let rnd=12345; const rand=()=>((rnd=(rnd*1103515245+12345)&0x7fffffff)/0x7fffffff);
for(const Y of years.filter(y=>y>=START)){
  const tr=clean.filter(([mo])=>+mo.slice(0,4)<Y).flatMap(([,g])=>g);
  const te=clean.filter(([mo])=>+mo.slice(0,4)===Y);
  if(tr.length<5000||!te.length)continue;
  const samp=tr.length>120000?tr.filter(()=>rand()<120000/tr.length):tr;
  const X=samp.map(r=>r.x), yv=samp.map(r=>r.y);
  const gbm=fitGBMB(samp), lin=fitOLS(X,yv);
  const packs:[string,Row[],number[]][]=[];
  for(const [mo,g] of te){
    const yy=g.map(r=>r.y);
    packs.push([mo,g,g.map(r=>gbm(r.x))]);
    const preds:Record<string,number[]>={gbm:g.map(r=>gbm(r.x)),lin:g.map(r=>lin(r.x)),mom:g.map(r=>r.x[0]),rev:g.map(r=>-r.x[1])};
    for(const k of Object.keys(preds)){
      res[k].ic.push(spearman(preds[k],yy));
      const ord=[...g.keys()].sort((a,b)=>preds[k][b]-preds[k][a]); const d=Math.max(1,Math.floor(g.length/10));
      const top=ord.slice(0,d).map(i=>yy[i]), bot=ord.slice(-d).map(i=>yy[i]);
      res[k].ls.push(mean(top)-mean(bot));
    }
  }
  wf.push([Y,packs]);
  Deno.stderr.write(new TextEncoder().encode(`  ..${Y} trained on ${samp.length} rows\r`));
}
console.log(`\n`);
console.log(`    ${"model".padEnd(24)}${"OOS rank IC".padEnd(14)}${"t(IC)".padEnd(9)}${"L/S rank-spread".padEnd(18)}n_months`);
for(const [k,v] of Object.entries(res)){ if(!v.ic.length)continue;
  const m=mean(v.ic), t=m/(sdv(v.ic)/Math.sqrt(v.ic.length));
  const nm={gbm:"GBM (non-linear)",lin:"linear composite",mom:"momentum 12-1 alone",rev:"1m reversal alone"}[k];
  console.log(`    ${nm!.padEnd(24)}${m.toFixed(4).padEnd(14)}${t.toFixed(2).padEnd(9)}${mean(v.ls).toFixed(4).padEnd(18)}${v.ic.length}`);
}
const gm=mean(res.gbm.ic), lm=mean(res.lin.ic);
const d=res.gbm.ic.map((x,i)=>x-res.lin.ic[i]); const dt=mean(d)/(sdv(d)/Math.sqrt(d.length));

// ============================================================================================================
// ECONOMICS. A rank IC is not money. This program has now found SEVEN signals that were statistically real and
// economically inaccessible, so the decile spread is re-measured in ACTUAL returns, net of a monthly-rebalance cost, split
// by era and by liquidity tercile. If the GBM edge lives only in the illiquid tercile it is not an edge, it is a fee.
console.log(`\n    ==> ECONOMICS: decile long-short in REAL returns (monthly rebalance)`);
const ERA=(mo:string)=>{const y=+mo.slice(0,4);return y<2005?"1996-2004":y<2013?"2005-2012":y<2021?"2013-2020":"2021-2026";};
const buckets:Record<string,Record<string,number[]>>={};
for(const [Y,packs] of wf){ for(const [mo,g,pred] of packs){
  const ord=[...g.keys()].sort((a,b)=>pred[b]-pred[a]); const d=Math.max(1,Math.floor(g.length/10));
  const dvs=g.map(r=>r.dv).sort((a,b)=>a-b); const lo=dvs[Math.floor(dvs.length/3)], hi=dvs[Math.floor(2*dvs.length/3)];
  const seg=(f:(r:Row)=>boolean)=>{const sub=ord.filter(i=>f(g[i])); if(sub.length<40)return null;
    const dd=Math.max(1,Math.floor(sub.length/10));
    return mean(sub.slice(0,dd).map(i=>g[i].yraw))-mean(sub.slice(-dd).map(i=>g[i].yraw));};
  const all=mean(ord.slice(0,d).map(i=>g[i].yraw))-mean(ord.slice(-d).map(i=>g[i].yraw));
  const put=(k:string,v:number|null)=>{if(v===null||!Number.isFinite(v))return;((buckets[k]??={}).all??=[]).push(v);};
  put("ALL",all); put(ERA(mo),all);
  put("liq:LOW",seg(r=>r.dv<=lo)); put("liq:MID",seg(r=>r.dv>lo&&r.dv<hi)); put("liq:HIGH",seg(r=>r.dv>=hi));
  void Y;
}}
console.log(`    ${"segment".padEnd(14)}${"GROSS %/yr".padEnd(13)}${"@30bp/mo".padEnd(12)}${"@60bp/mo".padEnd(12)}${"SR net30".padEnd(10)}${"t".padEnd(8)}n_mo`);
for(const k of ["ALL","1996-2004","2005-2012","2013-2020","2021-2026","liq:LOW","liq:MID","liq:HIGH"]){
  const a=buckets[k]?.all; if(!a||a.length<24)continue;
  const m=mean(a), sg=sdv(a); const n30=m-0.003, n60=m-0.006;
  console.log(`    ${k.padEnd(14)}${(m*12*100).toFixed(1).padEnd(13)}${(n30*12*100).toFixed(1).padEnd(12)}${(n60*12*100).toFixed(1).padEnd(12)}${((n30/sg)*Math.sqrt(12)).toFixed(2).padEnd(10)}${((m/sg)*Math.sqrt(a.length)).toFixed(2).padEnd(8)}${a.length}`);
}

// ============================================================================================================
// TIER-2 GAP #2: PORTFOLIO CONSTRUCTION. Every result in this program has been an EQUAL-WEIGHT TOP-DECILE sort rebalanced
// monthly -- the crudest possible construction, and the one that pays the most cost. The signal is not the only decision;
// how it is held is. Three alternatives measured against the same GBM score, on the same walk-forward predictions:
//   (a) score-proportional weights (conviction-weighted rather than equal-weight)
//   (b) inverse-vol weights (risk parity within the leg -- stops one volatile name dominating)
//   (c) a NO-TRADE BAND: hold a name until it leaves the top/bottom TERCILE rather than the decile. This is the cheapest
//       real lever available -- it cuts turnover directly, and turnover x spread is what killed several earlier results.
console.log(`\n    ==> PORTFOLIO CONSTRUCTION on the same GBM score (the decile sort is a choice, not a law)`);
type Book={r:number[];to:number[]};
const books:Record<string,Book>={equal:{r:[],to:[]},conviction:{r:[],to:[]},invvol:{r:[],to:[]},band:{r:[],to:[]}};
let prevW:Record<string,Map<string,number>>={equal:new Map(),conviction:new Map(),invvol:new Map(),band:new Map()};
for(const [,packs] of wf) for(const [,g,pred] of packs){
  const n=g.length; const ord=[...g.keys()].sort((a,b)=>pred[b]-pred[a]); const d=Math.max(1,Math.floor(n/10)), t3=Math.max(1,Math.floor(n/3));
  const mk=(pairs:[string,number][]):Map<string,number>=>{const gross=pairs.reduce((s2,x)=>s2+Math.abs(x[1]),0)||1;return new Map(pairs.map(([k,v])=>[k,v/gross*2]));};
  const W:Record<string,Map<string,number>>={};
  W.equal=mk([...ord.slice(0,d).map(i=>[g[i].sym,1] as [string,number]),...ord.slice(-d).map(i=>[g[i].sym,-1] as [string,number])]);
  const pm=mean(pred), ps=sdv(pred)||1e-9;
  W.conviction=mk(ord.filter(i=>Math.abs(pred[i]-pm)/ps>1).map(i=>[g[i].sym,(pred[i]-pm)/ps] as [string,number]));
  W.invvol=mk([...ord.slice(0,d).map(i=>[g[i].sym,1/Math.max(0.1,g[i].x[3]+0.6)] as [string,number]),
               ...ord.slice(-d).map(i=>[g[i].sym,-1/Math.max(0.1,g[i].x[3]+0.6)] as [string,number])]);
  const held=prevW.band; const bandPairs:[string,number][]=[];
  for(let r=0;r<n;r++){const i=ord[r], sym=g[i].sym, was=held.get(sym)||0;
    if(r<d) bandPairs.push([sym,1]); else if(r>=n-d) bandPairs.push([sym,-1]);
    else if(was>0&&r<t3) bandPairs.push([sym,1]);            // stay long until it leaves the top tercile
    else if(was<0&&r>=n-t3) bandPairs.push([sym,-1]);}       // stay short until it leaves the bottom tercile
  W.band=mk(bandPairs);
  const symRet=new Map(g.map(r=>[r.sym,r.yraw]));
  for(const k of Object.keys(books)){
    let ret=0; for(const [sym,w] of W[k]) ret+=w*(symRet.get(sym)??0);
    let to=0; const keys=new Set([...W[k].keys(),...prevW[k].keys()]);
    for(const sym of keys) to+=Math.abs((W[k].get(sym)||0)-(prevW[k].get(sym)||0));
    books[k].r.push(ret); books[k].to.push(to/2);
  }
  prevW=W;
}
console.log(`    ${"construction".padEnd(14)}${"turnover/mo".padEnd(13)}${"GROSS %/yr".padEnd(13)}${"NET @30bp".padEnd(12)}${"NET @60bp".padEnd(12)}${"SR net30".padEnd(10)}t`);
for(const [k,b] of Object.entries(books)){ if(b.r.length<24)continue;
  const m=mean(b.r), sg=sdv(b.r), tu=mean(b.to);
  const n30=m-tu*0.003, n60=m-tu*0.006;
  const nm={equal:"equal-wt decile",conviction:"score-weighted",invvol:"inverse-vol",band:"no-trade band"}[k];
  console.log(`    ${nm!.padEnd(14)}${(tu*100).toFixed(0).padEnd(13)}%${(m*12*100).toFixed(1).padEnd(12)}${(n30*12*100).toFixed(1).padEnd(12)}${(n60*12*100).toFixed(1).padEnd(12)}${((n30/sg)*Math.sqrt(12)).toFixed(2).padEnd(10)}${((m/sg)*Math.sqrt(b.r.length)).toFixed(2)}`);
}
console.log(`\n    GBM - linear: delta IC ${(gm-lm).toFixed(4)}, paired t ${dt.toFixed(2)}  ->  ${Math.abs(dt)>2?(dt>0?"NON-LINEARITY ADDS":"non-linearity HURTS"):"NULL: non-linearity adds NOTHING over linear"}`);
