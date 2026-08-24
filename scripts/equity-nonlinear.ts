#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// equity-nonlinear.ts (D-513) — the crypto-proven GBM harness (D-451: paired t 8.12 for non-linearity) applied to the
// EQUITY panel, the highest-value untested computation in the repo. Panel comes from the factory's own export
// (PASS=gbmexport) so features are exactly the audited 22. Walk-forward train<=Y-1 predict Y, monthly.
// LIQUIDITY LAW built in: books reported for ALL and for the liquid TOP TERCILE — the promotable number is the liquid one.
// Pre-registered: if GBM does not beat the linear composite on a paired t AND no liquid book clears t 5.34, closed.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"en",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=10;
type Row={mo:string;sym:string;x:number[];y:number;yraw:number;dv:number};
const txt=await Deno.readTextFile("/Users/ona/aegis-data/eqpanel.tsv");
const lines=txt.split("\n"); const header=lines[0].split("\t"); const FEAT=header.slice(4);
const rows:Row[]=[];
for(let i=1;i<lines.length;i++){
  const p=lines[i].split("\t"); if(p.length<5)continue;
  const fwd=+p[2]; if(!Number.isFinite(fwd))continue;
  const x=FEAT.map((_,f)=>{const v=p[4+f];return v===""?NaN:+v;});
  rows.push({mo:p[0],sym:p[1],x,y:fwd,yraw:fwd,dv:+p[3]});
}
console.log(`==> EQUITY NON-LINEAR — ${rows.length.toLocaleString()} rows, ${FEAT.length} features`);
// per-month rank-normalize features (nulls -> 0 = cross-sectional median) and rank y
const byMo=new Map<string,Row[]>(); for(const r of rows)(byMo.get(r.mo)??byMo.set(r.mo,[]).get(r.mo)!).push(r);
for(const [,g] of byMo){ if(g.length<200){g.length=0;continue;}
  for(let f=0;f<FEAT.length;f++){
    const have=[...g.keys()].filter(i=>Number.isFinite(g[i].x[f]));
    have.sort((a,b)=>g[a].x[f]-g[b].x[f]);
    have.forEach((gi,rk)=>{g[gi].x[f]=have.length>1?rk/(have.length-1)-0.5:0;});
    for(const i of g.keys()) if(!Number.isFinite(g[i].x[f])) g[i].x[f]=0;
  }
  const oy=[...g.keys()].sort((a,b)=>g[a].y-g[b].y); oy.forEach((gi,rk)=>{g[gi].y=rk/(g.length-1)-0.5;});
}
const clean=[...byMo.entries()].filter(([,g])=>g.length>=200).sort((a,b)=>a[0]<b[0]?-1:1);
console.log(`    usable months (>=200 names): ${clean.length}, mean breadth ${mean(clean.map(([,g])=>g.length)).toFixed(0)}`);
if(clean.length<60){console.error("!! too few usable months — UNTESTED");Deno.exit(1);}
// --- GBM + ridge (identical machinery to D-451) ---
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
function fitGBM(tr:Row[],trees=150,lr=0.06,depth=3){
  const n=tr.length,P=FEAT.length;
  const B:Uint8Array[]=Array.from({length:P},()=>new Uint8Array(n));
  for(let i=0;i<n;i++)for(let f=0;f<P;f++)B[f][i]=toBin(tr[i].x[f]);
  const y=Float64Array.from(tr.map(r=>r.y)),F=new Float64Array(n),g=new Float64Array(n);
  const idx=new Int32Array(n);for(let i=0;i<n;i++)idx[i]=i;
  const model:Node[]=[];
  for(let t=0;t<trees;t++){for(let i=0;i<n;i++)g[i]=y[i]-F[i];
    const tr2=fitTreeB(B,g,idx,depth);model.push(tr2);
    const bb=new Array(P);for(let i=0;i<n;i++){for(let f=0;f<P;f++)bb[f]=B[f][i];F[i]+=lr*predB(tr2,bb);}}
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
const momIdx=FEAT.indexOf("mom12_1");
const years=[...new Set(clean.map(([mo])=>+mo.slice(0,4)))].sort((a,b)=>a-b);
const START=years[0]+3;
console.log(`    walk-forward: train <= Y-1, predict Y, Y = ${START}..${years.at(-1)}\n`);
const res:Record<string,number[]>={gbm:[],lin:[],mom:[]};
const books:Record<string,number[]>={gbmAll:[],gbmLiq:[],linLiq:[]};
let prevW:Record<string,Map<string,number>>={gbmAll:new Map(),gbmLiq:new Map(),linLiq:new Map()};
for(const Y of years.filter(y=>y>=START)){
  const tr=clean.filter(([mo])=>+mo.slice(0,4)<Y).flatMap(([,g])=>g);
  const te=clean.filter(([mo])=>+mo.slice(0,4)===Y);
  if(tr.length<20000||!te.length)continue;
  const gbm=fitGBM(tr), lin=fitOLS(tr.map(r=>r.x),tr.map(r=>r.y));
  for(const [,g] of te){
    const yy=g.map(r=>r.y);
    const pg=g.map(r=>gbm(r.x)), pl=g.map(r=>lin(r.x));
    res.gbm.push(spear(pg,yy)); res.lin.push(spear(pl,yy));
    if(momIdx>=0)res.mom.push(spear(g.map(r=>r.x[momIdx]),yy));
    const mkBook=(kk:string,pred:number[],universe:number[])=>{
      const ord=universe.sort((a,b)=>pred[b]-pred[a]);
      const k=Math.max(10,Math.floor(ord.length/10));
      const W=new Map<string,number>();
      for(const i of ord.slice(0,k))W.set(g[i].sym,1/k);
      for(const i of ord.slice(-k))W.set(g[i].sym,-(1/k));
      const ymap=new Map(g.map(r=>[r.sym,r.yraw]));
      let ret=0; for(const [sym,w] of W) ret+=w*(ymap.get(sym)??0);
      // turnover
      let to=0; for(const sym of new Set([...W.keys(),...prevW[kk].keys()])) to+=Math.abs((W.get(sym)||0)-(prevW[kk].get(sym)||0));
      prevW[kk]=W;
      books[kk].push(ret-(to/2)*FEE_BP/1e4);
    };
    const all=[...g.keys()];
    const dvs=[...g].map(r=>r.dv).sort((a,b)=>a-b);
    const cut=dvs[Math.floor(dvs.length*2/3)];
    const liq=[...g.keys()].filter(i=>g[i].dv>=cut);
    mkBook("gbmAll",pg,[...all]);
    mkBook("gbmLiq",pg,[...liq]);
    mkBook("linLiq",pl,[...liq]);
  }
  Deno.stderr.write(new TextEncoder().encode(`  ..${Y}\r`));
}
console.log(`\n    ${"model".padEnd(22)}${"OOS rank IC".padEnd(14)}${"t(IC)".padEnd(9)}n_months`);
for(const [k,v] of Object.entries(res)){ if(!v.length)continue;
  const m=mean(v),t=m/(sdv(v)/Math.sqrt(v.length));
  console.log(`    ${({gbm:"GBM (non-linear)",lin:"linear composite",mom:"momentum 12-1 alone"}[k]!).padEnd(22)}${m.toFixed(4).padEnd(14)}${t.toFixed(2).padEnd(9)}${v.length}`);}
const d=res.gbm.map((x,i)=>x-res.lin[i]); const dt=mean(d)/(sdv(d)/Math.sqrt(d.length));
console.log(`\n    GBM - linear: delta IC ${mean(d).toFixed(4)}, paired t ${dt.toFixed(2)}  ->  ${Math.abs(dt)>2?(dt>0?"NON-LINEARITY ADDS":"non-linearity HURTS"):"NULL: adds nothing"}`);
console.log(`\n    ${"book (net 10bp rt)".padEnd(22)}${"%/yr".padEnd(10)}${"SR".padEnd(8)}${"t".padEnd(8)}${"maxDD".padEnd(9)}n_months`);
for(const [k,v] of Object.entries(books)){ if(v.length<36)continue;
  const m=mean(v),sd=sdv(v)||1e-9; let cum=1,peak=1,dd=0,ruined=false;
  for(const x of v){cum*=1+x;if(cum<=0){ruined=true;break;}peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  console.log(`    ${({gbmAll:"GBM decile L/S (ALL)",gbmLiq:"GBM decile L/S (LIQ tercile)",linLiq:"linear L/S (LIQ tercile)"}[k]!).padEnd(28)}${((m*12*100).toFixed(1)+"%").padEnd(10)}${((m/sd)*Math.sqrt(12)).toFixed(2).padEnd(8)}${(m/(sd/Math.sqrt(v.length))).toFixed(2).padEnd(8)}${ruined?"RUINED".padEnd(9):((dd*100).toFixed(0)+"%").padEnd(9)}${v.length}`);}
console.log(`\n    Deflated ceiling: t ~ 5.34 at N~1.53M. The promotable number is the LIQUID book's, per the Liquidity Law.`);
// trials: 3 models x 2 universes examined
{const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},
  body:JSON.stringify({family:"adhoc",run_key:`equity-nonlinear-D513`})}).catch(()=>null);
 if(!tw||(!tw.ok&&tw.status!==409))console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
