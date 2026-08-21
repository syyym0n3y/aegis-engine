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

const FEAT=["mom12_1","rev1m","mom6_1","vol12","maxret","dvol","hi52","skew","turnpx","amihud"];
type Row={mo:string;sym:string;x:number[];y:number};
const panel:Row[]=[];

// --- stream the universe in chunks (a full preload OOM'd this box before) ---
const meta:{symbol:string}[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
console.log(`==> NON-LINEAR / CONDITIONAL TEST — universe ${meta.length} equities`);
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
      const px=c[k]; if(!(px>1))continue;                       // penny-stock floor
      const w252=dret.slice(k-252,k), w21=dret.slice(k-21,k), w126=dret.slice(k-126,k);
      if(w252.length<200)continue;
      const mom12_1=c[k-21]/c[k-252]-1, rev1m=c[k]/c[k-21]-1, mom6_1=c[k-21]/c[k-126]-1;
      const vol12=sdv(w252)*Math.sqrt(252), maxret=Math.max(...w21);
      let dv=0,cn=0; for(let q=k-21;q<k;q++){if(c[q]>0&&v[q]>0){dv+=c[q]*v[q];cn++;}} dv=cn?dv/cn:0;
      if(dv<1e6)continue;                                        // LIQUIDITY FLOOR (D-383) — no micro-cap mirages
      const hi=Math.max(...c.slice(k-252,k+1)); const hi52=px/hi;
      const m3=mean(w126), s3=sdv(w126)||1e-9; const skew=mean(w126.map(x=>((x-m3)/s3)**3));
      const turnpx=Math.log(dv); const amihud=mean(w21.map((x,q)=>Math.abs(x)/Math.max(1,c[k-21+q]*v[k-21+q])))*1e9;
      const y=c[kn]/c[k]-1;                                      // forward 1-month return
      if(![mom12_1,rev1m,mom6_1,vol12,maxret,hi52,skew,turnpx,amihud,y].every(Number.isFinite))continue;
      if(Math.abs(y)>3)continue;                                 // data-corruption guard (Yahoo crypto lesson)
      panel.push({mo:mos[j],sym:r.symbol,x:[mom12_1,rev1m,mom6_1,vol12,maxret,Math.log(dv),hi52,skew,turnpx,amihud],y});
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
type Node={leaf?:number;f?:number;thr?:number;l?:Node;r?:Node};
function fitTree(X:number[][],g:number[],idx:number[],depth:number):Node{
  if(depth===0||idx.length<50){let s=0;for(const i of idx)s+=g[i];return{leaf:s/Math.max(1,idx.length)};}
  let best={gain:0,f:-1,thr:0}; const tot=idx.reduce((a,i)=>a+g[i],0), n=idx.length;
  for(let f=0;f<X[0].length;f++) for(const thr of [-0.4,-0.3,-0.2,-0.1,0,0.1,0.2,0.3,0.4]){
    let sl=0,nl=0; for(const i of idx){ if(X[i][f]<=thr){sl+=g[i];nl++;} }
    const nr=n-nl; if(nl<25||nr<25)continue;
    const gain=(sl*sl)/nl+((tot-sl)*(tot-sl))/nr-(tot*tot)/n;
    if(gain>best.gain)best={gain,f,thr};
  }
  if(best.f<0){let s=0;for(const i of idx)s+=g[i];return{leaf:s/n};}
  const L:number[]=[],R:number[]=[]; for(const i of idx)(X[i][best.f]<=best.thr?L:R).push(i);
  return{f:best.f,thr:best.thr,l:fitTree(X,g,L,depth-1),r:fitTree(X,g,R,depth-1)};
}
const predTree=(t:Node,x:number[]):number=>t.leaf!==undefined?t.leaf:(x[t.f!]<=t.thr!?predTree(t.l!,x):predTree(t.r!,x));
function fitGBM(X:number[][],y:number[],trees=120,lr=0.06,depth=3){
  const F=new Array(X.length).fill(0); const model:Node[]=[]; const idx=[...X.keys()];
  for(let t=0;t<trees;t++){ const g=y.map((yv,i)=>yv-F[i]); const tr=fitTree(X,g,idx,depth); model.push(tr);
    for(let i=0;i<X.length;i++)F[i]+=lr*predTree(tr,X[i]); }
  return (x:number[])=>model.reduce((s,t)=>s+lr*predTree(t,x),0);
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
const START=years[0]+6;
console.log(`\n    walk-forward: train <= Y-1, predict Y, for Y = ${START}..${years.at(-1)}`);
const res:Record<string,{ic:number[];ls:number[]}>={gbm:{ic:[],ls:[]},lin:{ic:[],ls:[]},mom:{ic:[],ls:[]},rev:{ic:[],ls:[]}};
let rnd=12345; const rand=()=>((rnd=(rnd*1103515245+12345)&0x7fffffff)/0x7fffffff);
for(const Y of years.filter(y=>y>=START)){
  const tr=clean.filter(([mo])=>+mo.slice(0,4)<Y).flatMap(([,g])=>g);
  const te=clean.filter(([mo])=>+mo.slice(0,4)===Y);
  if(tr.length<5000||!te.length)continue;
  const samp=tr.length>120000?tr.filter(()=>rand()<120000/tr.length):tr;
  const X=samp.map(r=>r.x), yv=samp.map(r=>r.y);
  const gbm=fitGBM(X,yv), lin=fitOLS(X,yv);
  for(const [,g] of te){
    const yy=g.map(r=>r.y);
    const preds:Record<string,number[]>={gbm:g.map(r=>gbm(r.x)),lin:g.map(r=>lin(r.x)),mom:g.map(r=>r.x[0]),rev:g.map(r=>-r.x[1])};
    for(const k of Object.keys(preds)){
      res[k].ic.push(spearman(preds[k],yy));
      const ord=[...g.keys()].sort((a,b)=>preds[k][b]-preds[k][a]); const d=Math.max(1,Math.floor(g.length/10));
      const top=ord.slice(0,d).map(i=>yy[i]), bot=ord.slice(-d).map(i=>yy[i]);
      res[k].ls.push(mean(top)-mean(bot));
    }
  }
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
console.log(`\n    GBM - linear: delta IC ${(gm-lm).toFixed(4)}, paired t ${dt.toFixed(2)}  ->  ${Math.abs(dt)>2?(dt>0?"NON-LINEARITY ADDS":"non-linearity HURTS"):"NULL: non-linearity adds NOTHING over linear"}`);
