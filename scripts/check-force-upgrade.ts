#!/usr/bin/env -S deno run --allow-net --allow-env
// check-force-upgrade.ts (D-526) — PRE-REGISTERED MODEL IMPROVEMENT TEST (not a strategy test).
// The residual-PC1 diagnostic (D-525) named a growth-vs-financials axis and exposed CREDIT as absent from the universe.
// PREDICTION, stated before running: adding CREDIT (HYG-IEF), STYLE (IWF-IWD) and SIZE (IWM-SPY) to the 6-force model
// RAISES mean adj-R2 across instruments (paired t > 2) and LOWERS the residual PC1 share. If it does not, the 6-force
// model was already adequate and the PC1 structure was noise. Descriptive: no tradability claim either way. Trials +1.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"fu",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const corr=(a:number[],b:number[])=>{const ma=mean(a),mb=mean(b);let nu=0,d1=0,d2=0;
  for(let i=0;i<a.length;i++){nu+=(a[i]-ma)*(b[i]-mb);d1+=(a[i]-ma)**2;d2+=(b[i]-mb)**2;}
  return d1&&d2?nu/Math.sqrt(d1*d2):0;};
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[])) if(b[4]>0) m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
const px=new Map<string,Map<string,number>>();
for(const s of ["^GSPC","TLT","EURUSD=X","CL=F","GC=F","^VIX","HYG","IEF","IWF","IWD","IWM","SPY"]) px.set(s,await load(s));
const days=[...px.get("^GSPC")!.keys()].sort();
const r1=(s:string,i:number)=>{const m=px.get(s)!;const a=m.get(days[i]),b=m.get(days[i-1]);return (a===undefined||b===undefined)?null:a/b-1;};
const BASE=(i:number)=>{
  const mkt=r1("^GSPC",i),rat=r1("TLT",i),eur=r1("EURUSD=X",i),oil=r1("CL=F",i),gld=r1("GC=F",i);
  const v=px.get("^VIX")!,va=v.get(days[i]),vb=v.get(days[i-1]);
  if([mkt,rat,eur,oil,gld].some(x=>x===null)||va===undefined||vb===undefined)return null;
  return [mkt!,rat!,-eur!,oil!,gld!,(va-vb)/100];};
const EXTRA=(i:number)=>{
  const hyg=r1("HYG",i),ief=r1("IEF",i),iwf=r1("IWF",i),iwd=r1("IWD",i),iwm=r1("IWM",i),spy=r1("SPY",i);
  if([hyg,ief,iwf,iwd,iwm,spy].some(x=>x===null))return null;
  return [hyg!-ief!, iwf!-iwd!, iwm!-spy!];};   // CREDIT, STYLE(growth-value), SIZE(small-large)
const ols=(X:number[][],y:number[])=>{
  const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-8*X.length;
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const dd=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=dd;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  return M.map(r=>r[p]);};
const UNIV=["QQQ","DIA","GLD","AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","JPM","XOM","AMD","GBPUSD=X","JPY=X","AUDUSD=X","HG=F","SI=F","ZW=F","NG=F","KC=F","BTC-USD"];
const fit=(pm:Map<string,number>,useExtra:boolean)=>{
  const rows:{x:number[];y:number}[]=[];
  for(let i=1;i<days.length;i++){
    const a=pm.get(days[i]),b=pm.get(days[i-1]); if(a===undefined||b===undefined)continue;
    const base=BASE(i); if(!base)continue;
    const ex=useExtra?EXTRA(i):[]; if(useExtra&&!ex)continue;
    const y=a/b-1; if(!Number.isFinite(y)||Math.abs(y)>0.5)continue;
    rows.push({x:[1,...base,...(ex as number[])],y});
  }
  if(rows.length<500)return null;
  const w=ols(rows.map(r=>r.x),rows.map(r=>r.y));
  const yh=rows.map(r=>r.x.reduce((s,v,i2)=>s+v*w[i2],0));
  const yb=mean(rows.map(r=>r.y));
  const ssr=rows.reduce((s,r,i2)=>s+(r.y-yh[i2])**2,0), sst=rows.reduce((s,r)=>s+(r.y-yb)**2,0);
  const p=rows[0].x.length-1;
  const adj=1-(ssr/Math.max(1e-12,sst))*(rows.length-1)/(rows.length-p-1);
  return {adj,resid:rows.map((r,i2)=>r.y-yh[i2]),n:rows.length,betas:w.slice(1)};
};
console.log(`==> FORCE-UPGRADE TEST (D-526) — prediction: mean adj-R2 RISES (paired t>2), residual PC1 FALLS`);
console.log(`    ${"symbol".padEnd(10)}${"adjR2 6f".padEnd(10)}${"adjR2 9f".padEnd(10)}${"delta".padEnd(9)}new betas CREDIT/STYLE/SIZE`);
const d6:number[]=[],d9:number[]=[]; const res9=new Map<string,number[]>(); const res6=new Map<string,number[]>();
for(const sym of UNIV){
  const pm=await load(sym); if(pm.size<800)continue;
  const f6=fit(pm,false),f9=fit(pm,true);
  if(!f6||!f9)continue;
  d6.push(f6.adj); d9.push(f9.adj); res6.set(sym,f6.resid); res9.set(sym,f9.resid);
  const nb=f9.betas.slice(6).map(x=>x.toFixed(2)).join("/");
  console.log(`    ${sym.padEnd(10)}${f6.adj.toFixed(3).padEnd(10)}${f9.adj.toFixed(3).padEnd(10)}${(f9.adj-f6.adj>=0?"+":"")+(f9.adj-f6.adj).toFixed(3).padEnd(8)} ${nb}`);
}
const dd=d9.map((x,i)=>x-d6[i]);
const t=mean(dd)/((sdv(dd)||1e-9)/Math.sqrt(dd.length));
console.log(`\n    mean adj-R2: 6-force ${mean(d6).toFixed(3)} -> 9-force ${mean(d9).toFixed(3)}  (delta ${mean(dd)>=0?"+":""}${mean(dd).toFixed(3)}, paired t ${t.toFixed(2)}, n=${dd.length})`);
const pc1=(m:Map<string,number[]>)=>{
  const syms=[...m.keys()]; const L=Math.min(...syms.map(s=>m.get(s)!.length));
  const Z=syms.map(s=>{const v=m.get(s)!.slice(-L);const mu=mean(v),sd=sdv(v)||1e-9;return v.map(x=>(x-mu)/sd);});
  const n=syms.length;
  const C=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>corr(Z[i],Z[j])));
  let vec=new Array(n).fill(1/Math.sqrt(n)),lam=0;
  for(let it=0;it<400;it++){const nv=C.map(row=>row.reduce((s,x,j)=>s+x*vec[j],0));
    const nrm=Math.sqrt(nv.reduce((s,x)=>s+x*x,0))||1e-12;vec=nv.map(x=>x/nrm);lam=nrm;}
  return lam/n;};
const p6=pc1(res6),p9=pc1(res9);
console.log(`    residual PC1 share: 6-force ${(p6*100).toFixed(1)}% -> 9-force ${(p9*100).toFixed(1)}%`);
console.log(`\n    VERDICT: ${t>2&&p9<p6?"UPGRADE CONFIRMED — adopt the 9-force model (both predictions held)":t>2?"partial: adj-R2 improved but PC1 did not fall":"PREDICTION FAILED — 6-force model was adequate; PC1 structure was not a missing force"}`);
{const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},
  body:JSON.stringify({family:"adhoc",run_key:`force-upgrade-D526`})}).catch(()=>null);
 if(!tw||(!tw.ok&&tw.status!==409))console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
