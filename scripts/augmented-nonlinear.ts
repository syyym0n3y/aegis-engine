// D-942 — the nonlinear/ML combination on the AUGMENTED equity panel: the 22 audited factors PLUS the three this
// session's work showed the old panel LACKED and that matter for liquid survival — IVOL (residual vol, distinct from the
// panel's total vol12; the one signal that survived the liquid tercile, D-939), a DISTRESS recency flag (going-concern +
// late-filing events, D-936), and DAYS-TO-COVER (short crowding). The old GBM harness (D-513) found "non-linearity adds
// NOTHING and the edge dies in the liquid tercile" on the 22 — but it never had the liquid-surviving signals. This asks
// whether a nonlinear combination that INCLUDES them beats the linear composite OOS and clears the ceiling in liquid.
// Reuses the audited GBM/OLS harness VERBATIM (no from-scratch learner); walk-forward train<=Y-1 predict Y; liquid tercile.
// PREREG D-942: if GBM does not beat the linear composite on a paired t AND no liquid book clears the live ceiling, closed.
import { mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"an",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const tok=await jwt(); const hdr={Authorization:`Bearer ${tok}`,apikey:tok}; const { q }=mkStrictRead(OWNED,hdr);
const AUG = (Deno.env.get("AUG") ?? "1") === "1"; // 0 = 22-feature baseline (reproduce D-513), 1 = augmented
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const dayNum=(iso:string)=>Math.floor(Date.parse(iso+(iso.length<=10?"T00:00:00Z":""))/86400000);
const monthEnd=(mo:string)=>{const[Y,M]=mo.split("-").map(Number);return Math.floor(Date.UTC(Y,M,0)/86400000);}; // last day of month
type Row={mo:string;sym:string;x:number[];y:number;yraw:number;dv:number};
const txt=await Deno.readTextFile("/Users/ona/aegis-data/eqpanel.tsv");
const lines=txt.split("\n"); const header=lines[0].split("\t"); const FEAT=header.slice(4);
const rows:Row[]=[];
for(let i=1;i<lines.length;i++){const p=lines[i].split("\t");if(p.length<5)continue;const fwd=+p[2];if(!Number.isFinite(fwd))continue;
  const x=FEAT.map((_,f)=>{const v=p[4+f];return v===""?NaN:+v;});rows.push({mo:p[0],sym:p[1],x,y:fwd,yraw:fwd,dv:+p[3]});}
console.log(`==> AUGMENTED NON-LINEAR (D-942) — ${rows.length.toLocaleString()} rows, base ${FEAT.length} features, AUG=${AUG?"on":"off"}`);
// ---------- AUGMENTATION: three point-in-time features the panel lacks ----------
if(AUG){
  const syms=[...new Set(rows.map(r=>r.sym))]; const mosBySym=new Map<string,Set<string>>();
  for(const r of rows)(mosBySym.get(r.sym)??mosBySym.set(r.sym,new Set()).get(r.sym)!).add(r.mo);
  // (A) DISTRESS recency: going-concern + late-filing events -> Map<sym, sorted event day-numbers>
  const ev=new Map<string,number[]>();
  for(const f of ["d930-gc-events.json","d935-nt-events.json"]){try{const arr=JSON.parse(await Deno.readTextFile(new URL(`../data/${f}`,import.meta.url)))as{ticker:string;date:string}[];
    for(const e of arr){const t=e.ticker?.toUpperCase();if(!t)continue;(ev.get(t)??ev.set(t,[]).get(t)!).push(dayNum(e.date));}}catch{/* */}}
  for(const[,a]of ev)a.sort((x,y)=>x-y);
  const distress=(sym:string,meDay:number):number=>{const a=ev.get(sym);if(!a)return 0;let best=-1;for(const d of a){if(d<=meDay)best=d;else break;}
    if(best<0)return 0;const since=meDay-best;return since<=180?(180-since)/180:0;};
  // (B) DAYS-TO-COVER: short-interest as-of month-end minus 14d publication lag
  const si=new Map<string,{d:number;dc:number}[]>();
  for(let i=0;i<syms.length;i+=60){const rr=await q(`trd_short_interest?symbol=in.(${syms.slice(i,i+60).map(encodeURIComponent).join(",")})&select=symbol,settlement,days_cover`)as{symbol:string;settlement:string;days_cover:number}[];
    for(const r of rr){if(!r.settlement||r.days_cover==null)continue;const s=r.symbol.toUpperCase();(si.get(s)??si.set(s,[]).get(s)!).push({d:dayNum(r.settlement),dc:+r.days_cover});}}
  for(const[,a]of si)a.sort((x,y)=>x.d-y.d);
  const daysCover=(sym:string,meDay:number):number=>{const a=si.get(sym);if(!a)return NaN;let v=NaN;for(const o of a){if(o.d<=meDay-14)v=o.dc;else break;}return v;};
  // (C) IVOL: residual vol to SPY over trailing 60 sessions, at each panel month-end. Stream bars per batch (memory-safe).
  const spy=await q(`trd_bars_deep?symbol=eq.SPY&select=bars`)as{bars:number[][]}[];
  const spyR=new Map<number,number>();{const b=(spy[0]?.bars??[]).filter(x=>x[4]>0).sort((a,z)=>a[0]-z[0]);for(let j=1;j<b.length;j++)spyR.set(Math.floor(b[j][0]/86400),Math.log(b[j][4]/b[j-1][4]));}
  const ivolMap=new Map<string,Map<string,number>>();
  for(let i=0;i<syms.length;i+=30){const rr=await q(`trd_bars_deep?symbol=in.(${syms.slice(i,i+30).map(encodeURIComponent).join(",")})&select=symbol,bars`)as{symbol:string;bars:number[][]}[];
    for(const r of rr){const b=(r.bars??[]).filter(x=>x[4]>0).sort((a,z)=>a[0]-z[0]);if(b.length<80)continue;
      const d:number[]=[],ret:number[]=[];for(let j=1;j<b.length;j++){d.push(Math.floor(b[j][0]/86400));ret.push(Math.log(b[j][4]/b[j-1][4]));}
      const sym=r.symbol.toUpperCase();const m=new Map<string,number>();
      for(const mo of mosBySym.get(sym)??[]){const me=monthEnd(mo);let hi=-1;for(let j=0;j<d.length;j++){if(d[j]<=me)hi=j;else break;}
        if(hi<60)continue;const sr=ret.slice(hi-59,hi+1),sd2=d.slice(hi-59,hi+1);
        const mr=sd2.map(dd=>spyR.get(dd)??0);const mm=mean(mr),rm=mean(sr);let cov=0,vv=0;for(let z=0;z<sr.length;z++){cov+=(mr[z]-mm)*(sr[z]-rm);vv+=(mr[z]-mm)**2;}
        const beta=vv>0?cov/vv:0;const res=sr.map((rk,z)=>rk-beta*(mr[z]-mm)-rm);m.set(mo,sdv(res)*Math.sqrt(252));}
      if(m.size)ivolMap.set(sym,m);}
    if(i%600===0)Deno.stderr.write(new TextEncoder().encode(`  ivol ${i}/${syms.length}\r`));}
  // append the three features
  FEAT.push("ivol","distress","days_cover");
  let cov={ivol:0,distress:0,dc:0};
  for(const r of rows){const me=monthEnd(r.mo);const iv=ivolMap.get(r.sym)?.get(r.mo)??NaN;const ds=distress(r.sym,me);const dc=daysCover(r.sym,me);
    r.x.push(iv,ds,dc);if(Number.isFinite(iv))cov.ivol++;if(ds>0)cov.distress++;if(Number.isFinite(dc))cov.dc++;}
  const ivC=100*cov.ivol/rows.length, dsC=100*cov.distress/rows.length, dcC=100*cov.dc/rows.length;
  console.log(`    AUGMENTED: +ivol (${ivC.toFixed(0)}% cov) +distress (${dsC.toFixed(1)}% flagged) +days_cover (${dcC.toFixed(0)}% cov) -> ${FEAT.length} features`);
  // COVERAGE LAW: a null here is a market finding only if the added features were adequately present; else UNTESTED.
  if(ivC<40||dsC<0.3||dcC<30){console.error(`!! COVERAGE INADEQUATE (ivol ${ivC.toFixed(0)}%, distress ${dsC.toFixed(1)}%, days_cover ${dcC.toFixed(0)}%) — the augmentation did not land; result is UNTESTED, not a null.`);Deno.exit(1);}
}
// ---------- per-month rank-normalize (identical to equity-nonlinear.ts D-513) ----------
const byMo=new Map<string,Row[]>(); for(const r of rows)(byMo.get(r.mo)??byMo.set(r.mo,[]).get(r.mo)!).push(r);
for(const[,g]of byMo){if(g.length<200){g.length=0;continue;}
  for(let f=0;f<FEAT.length;f++){const have=[...g.keys()].filter(i=>Number.isFinite(g[i].x[f]));have.sort((a,b)=>g[a].x[f]-g[b].x[f]);
    have.forEach((gi,rk)=>{g[gi].x[f]=have.length>1?rk/(have.length-1)-0.5:0;});for(const i of g.keys())if(!Number.isFinite(g[i].x[f]))g[i].x[f]=0;}
  const oy=[...g.keys()].sort((a,b)=>g[a].y-g[b].y);oy.forEach((gi,rk)=>{g[gi].y=rk/(g.length-1)-0.5;});}
const clean=[...byMo.entries()].filter(([,g])=>g.length>=200).sort((a,b)=>a[0]<b[0]?-1:1);
console.log(`    usable months (>=200 names): ${clean.length}, mean breadth ${mean(clean.map(([,g])=>g.length)).toFixed(0)}`);
if(clean.length<60){console.error("!! too few usable months — UNTESTED");Deno.exit(1);}
// ---------- GBM + ridge (VERBATIM from equity-nonlinear.ts D-451/D-513) ----------
type Node={leaf?:number;f?:number;bin?:number;l?:Node;r?:Node};const NBIN=16;
function fitTreeB(B:Uint8Array[],g:Float64Array,idx:Int32Array,depth:number):Node{const n=idx.length;let tot=0;for(let q2=0;q2<n;q2++)tot+=g[idx[q2]];
  if(depth===0||n<50)return{leaf:tot/Math.max(1,n)};const P=B.length,hs=new Float64Array(P*NBIN),hc=new Int32Array(P*NBIN);
  for(let q2=0;q2<n;q2++){const i=idx[q2],gv=g[i];for(let f=0;f<P;f++){const o=f*NBIN+B[f][i];hs[o]+=gv;hc[o]++;}}
  let bg=0,bf=-1,bb=0;for(let f=0;f<P;f++){let cs=0,cc=0;for(let b2=0;b2<NBIN-1;b2++){cs+=hs[f*NBIN+b2];cc+=hc[f*NBIN+b2];const cr=n-cc;
    if(cc<25||cr<25)continue;const gain=(cs*cs)/cc+((tot-cs)*(tot-cs))/cr-(tot*tot)/n;if(gain>bg){bg=gain;bf=f;bb=b2;}}}
  if(bf<0)return{leaf:tot/n};let nl=0;for(let q2=0;q2<n;q2++)if(B[bf][idx[q2]]<=bb)nl++;
  const L=new Int32Array(nl),R=new Int32Array(n-nl);let a=0,c2=0;for(let q2=0;q2<n;q2++){const i=idx[q2];if(B[bf][i]<=bb)L[a++]=i;else R[c2++]=i;}
  return{f:bf,bin:bb,l:fitTreeB(B,g,L,depth-1),r:fitTreeB(B,g,R,depth-1)};}
const predB=(t:Node,b:number[]):number=>t.leaf!==undefined?t.leaf:(b[t.f!]<=t.bin!?predB(t.l!,b):predB(t.r!,b));
const toBin=(v:number)=>Math.max(0,Math.min(NBIN-1,Math.floor((v+0.5)*NBIN)));
function fitGBM(tr:Row[],trees=150,lr=0.06,depth=3){const n=tr.length,P=FEAT.length;const B:Uint8Array[]=Array.from({length:P},()=>new Uint8Array(n));
  for(let i=0;i<n;i++)for(let f=0;f<P;f++)B[f][i]=toBin(tr[i].x[f]);const y=Float64Array.from(tr.map(r=>r.y)),F=new Float64Array(n),g=new Float64Array(n);
  const idx=new Int32Array(n);for(let i=0;i<n;i++)idx[i]=i;const model:Node[]=[];
  for(let t=0;t<trees;t++){for(let i=0;i<n;i++)g[i]=y[i]-F[i];const tr2=fitTreeB(B,g,idx,depth);model.push(tr2);
    const bb=new Array(P);for(let i=0;i<n;i++){for(let f=0;f<P;f++)bb[f]=B[f][i];F[i]+=lr*predB(tr2,bb);}}
  return(x:number[])=>{const b=x.map(toBin);return model.reduce((s,t)=>s+lr*predB(t,b),0);};}
function fitOLS(X:number[][],y:number[]){const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-6*X.length;const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const d=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=d;for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  const w=M.map(r=>r[p]);return(x:number[])=>x.reduce((s,v,i)=>s+v*w[i],0);}
const spear=(a:number[],b:number[])=>{const n=a.length;const ra=[...a.keys()].sort((i,j)=>a[i]-a[j]),rb=[...a.keys()].sort((i,j)=>b[i]-b[j]);
  const A=new Array(n),B2=new Array(n);ra.forEach((i,r)=>A[i]=r);rb.forEach((i,r)=>B2[i]=r);const m=(n-1)/2;let nu=0,da=0,db=0;
  for(let i=0;i<n;i++){nu+=(A[i]-m)*(B2[i]-m);da+=(A[i]-m)**2;db+=(B2[i]-m)**2;}return da&&db?nu/Math.sqrt(da*db):0;};
const FEE_BP=10; const momIdx=FEAT.indexOf("mom12_1");
const years=[...new Set(clean.map(([mo])=>+mo.slice(0,4)))].sort((a,b)=>a-b);const START=years[0]+3;
console.log(`    walk-forward: train <= Y-1, predict Y, Y = ${START}..${years.at(-1)}\n`);
const res:Record<string,number[]>={gbm:[],lin:[],mom:[]};const books:Record<string,number[]>={gbmAll:[],gbmLiq:[],linLiq:[]};
let prevW:Record<string,Map<string,number>>={gbmAll:new Map(),gbmLiq:new Map(),linLiq:new Map()};
for(const Y of years.filter(y=>y>=START)){const tr=clean.filter(([mo])=>+mo.slice(0,4)<Y).flatMap(([,g])=>g);const te=clean.filter(([mo])=>+mo.slice(0,4)===Y);
  if(tr.length<20000||!te.length)continue;const gbm=fitGBM(tr),lin=fitOLS(tr.map(r=>r.x),tr.map(r=>r.y));
  for(const[,g]of te){const yy=g.map(r=>r.y);const pg=g.map(r=>gbm(r.x)),pl=g.map(r=>lin(r.x));
    res.gbm.push(spear(pg,yy));res.lin.push(spear(pl,yy));if(momIdx>=0)res.mom.push(spear(g.map(r=>r.x[momIdx]),yy));
    const mkBook=(kk:string,pred:number[],universe:number[])=>{const ord=universe.sort((a,b)=>pred[b]-pred[a]);const k=Math.max(10,Math.floor(ord.length/10));
      const W=new Map<string,number>();for(const i of ord.slice(0,k))W.set(g[i].sym,1/k);for(const i of ord.slice(-k))W.set(g[i].sym,-(1/k));
      const ymap=new Map(g.map(r=>[r.sym,r.yraw]));let ret=0;for(const[sym,w]of W)ret+=w*(ymap.get(sym)??0);
      let to=0;for(const sym of new Set([...W.keys(),...prevW[kk].keys()]))to+=Math.abs((W.get(sym)||0)-(prevW[kk].get(sym)||0));prevW[kk]=W;books[kk].push(ret-(to/2)*FEE_BP/1e4);};
    const all=[...g.keys()];const dvs=[...g].map(r=>r.dv).sort((a,b)=>a-b);const cut=dvs[Math.floor(dvs.length*2/3)];const liq=[...g.keys()].filter(i=>g[i].dv>=cut);
    mkBook("gbmAll",pg,[...all]);mkBook("gbmLiq",pg,[...liq]);mkBook("linLiq",pl,[...liq]);}
  Deno.stderr.write(new TextEncoder().encode(`  ..${Y}\r`));}
console.log(`\n    ${"model".padEnd(22)}${"OOS rank IC".padEnd(14)}${"t(IC)".padEnd(9)}n_months`);
for(const[k,v]of Object.entries(res)){if(!v.length)continue;const m=mean(v),t=m/(sdv(v)/Math.sqrt(v.length));
  console.log(`    ${({gbm:"GBM (non-linear)",lin:"linear composite",mom:"momentum 12-1 alone"}[k]!).padEnd(22)}${m.toFixed(4).padEnd(14)}${t.toFixed(2).padEnd(9)}${v.length}`);}
const dd=res.gbm.map((x,i)=>x-res.lin[i]);const dt=mean(dd)/(sdv(dd)/Math.sqrt(dd.length));
console.log(`\n    GBM - linear: delta IC ${mean(dd).toFixed(4)}, paired t ${dt.toFixed(2)}  ->  ${Math.abs(dt)>2?(dt>0?"NON-LINEARITY ADDS":"non-linearity HURTS"):"NULL: adds nothing"}`);
console.log(`\n    ${"book (net 10bp rt)".padEnd(30)}${"%/yr".padEnd(10)}${"SR".padEnd(8)}${"t".padEnd(8)}${"maxDD".padEnd(9)}n_months`);
for(const[k,v]of Object.entries(books)){if(v.length<36)continue;const m=mean(v),sd=sdv(v)||1e-9;let cum=1,peak=1,dd2=0,ruined=false;
  for(const x of v){cum*=1+x;if(cum<=0){ruined=true;break;}peak=Math.max(peak,cum);dd2=Math.min(dd2,cum/peak-1);}
  console.log(`    ${({gbmAll:"GBM decile L/S (ALL)",gbmLiq:"GBM decile L/S (LIQ tercile)",linLiq:"linear L/S (LIQ tercile)"}[k]!).padEnd(30)}${((m*12*100).toFixed(1)+"%").padEnd(10)}${((m/sd)*Math.sqrt(12)).toFixed(2).padEnd(8)}${(m/(sd/Math.sqrt(v.length))).toFixed(2).padEnd(8)}${ruined?"RUINED".padEnd(9):((dd2*100).toFixed(0)+"%").padEnd(9)}${v.length}`);}
// plumbing-ok: fail-safe read — a transport failure yields rc=null -> N=NaN -> ceiling "UNREADABLE (no ceiling claimed)", never a false null (same pattern as equity-nonlinear.ts D-513)
{const rc=await fetch(`${OWNED}/trd_trial_counter?select=id`,{headers:{...hdr,Prefer:"count=exact",Range:"0-0"}}).catch(()=>null);
  const N=Number(rc?.headers.get("content-range")?.split("/")[1]??NaN);const ceil=Number.isFinite(N)&&N>1?Math.sqrt(2*Math.log(N)):NaN;
  console.log(`\n    Deflated ceiling: t ~ ${Number.isFinite(ceil)?ceil.toFixed(3):"UNREADABLE"} at N=${Number.isFinite(N)?N.toLocaleString():"?"} (live). Promotable number = the LIQUID book's (Liquidity Law).`);}
console.log(`\n  READ: PREREG D-942 — augmented nonlinearity is real ONLY if GBM beats linear (paired t>2) AND a LIQUID book clears the ceiling. Else the D-513 verdict holds even with the liquid-surviving signals in the panel.`);
