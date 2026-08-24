#!/usr/bin/env -S deno run --allow-net --allow-env
// check-missing-force.ts (D-525) — P3 DEEPENING: is the 6-force model MISSING a force?
// If daily residuals across instruments were independent, the leading principal component of the residual correlation
// matrix would explain ~1/N of the variance (N=instruments; here ~4%). PRE-REGISTERED: PC1 >= 25% (>=6x the
// independence null) means a real unmodeled COMMON force. Then — and only then — we try to NAME it by correlating the
// PC1 time series against candidate observables that are NOT already forces (credit, vol-of-vol, term structure, EM,
// Japan, crypto). Naming is descriptive; nothing here is a strategy claim. Trials +1.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"mf",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
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
const FORCES:[string,string][]=[["MKT","^GSPC"],["RATES","TLT"],["USD","EURUSD=X"],["OIL","CL=F"],["GOLD","GC=F"],["VOL","^VIX"]];
const fmaps=new Map<string,Map<string,number>>();
for(const [n,s] of FORCES)fmaps.set(n,await load(s));
const days=[...fmaps.get("MKT")!.keys()].sort();
const fret=(n:string,i:number)=>{const m=fmaps.get(n)!;const a=m.get(days[i]),b=m.get(days[i-1]);
  if(a===undefined||b===undefined)return null;
  return n==="USD"?-(a/b-1):n==="VOL"?(a-b)/100:a/b-1;};
const ols=(X:number[][],y:number[])=>{
  const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-8*X.length;
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const dd=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=dd;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  return M.map(r=>r[p]);};
// residual series per instrument: rolling 250d refit every 21d, residual of each day in the applied block (point-in-time)
const UNIV=["SPY","QQQ","IWM","DIA","GLD","AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","JPM","XOM","AMD",
  "GBPUSD=X","JPY=X","AUDUSD=X","HG=F","SI=F","ZW=F","NG=F","KC=F","BTC-USD"];
const resid=new Map<string,Map<string,number>>();
for(const sym of UNIV){
  const pm=await load(sym); if(pm.size<600)continue;
  const rs=new Map<string,number>();
  for(let start=280;start<days.length-1;start+=21){
    const rows:{x:number[];y:number}[]=[];
    for(let i=start-250;i<start;i++){
      const a=pm.get(days[i]),b=pm.get(days[i-1]); if(a===undefined||b===undefined)continue;
      const x=FORCES.map(([n])=>fret(n,i)); if(x.some(v=>v===null))continue;
      const y=a/b-1; if(!Number.isFinite(y)||Math.abs(y)>0.5)continue;
      rows.push({x:[1,...(x as number[])],y});
    }
    if(rows.length<150)continue;
    const w=ols(rows.map(r=>r.x),rows.map(r=>r.y));
    for(let i=start;i<Math.min(start+21,days.length);i++){
      const a=pm.get(days[i]),b=pm.get(days[i-1]); if(a===undefined||b===undefined)continue;
      const x=FORCES.map(([n])=>fret(n,i)); if(x.some(v=>v===null))continue;
      const y=a/b-1; if(!Number.isFinite(y))continue;
      rs.set(days[i],y-[1,...(x as number[])].reduce((s,v,i2)=>s+v*w[i2],0));
    }
  }
  if(rs.size>1000)resid.set(sym,rs);
}
const syms=[...resid.keys()];
const common=days.filter(d=>syms.every(s=>resid.get(s)!.has(d)));
console.log(`==> MISSING-FORCE TEST (D-525) — ${syms.length} instruments, ${common.length} common days`);
console.log(`    independence null: PC1 would explain ~${(100/syms.length).toFixed(1)}% ; pre-registered threshold 25%`);
// standardize residuals, build correlation matrix, power-iterate for PC1
const Z=syms.map(s=>{const v=common.map(d=>resid.get(s)!.get(d)!);const m=mean(v),sd=sdv(v)||1e-9;return v.map(x=>(x-m)/sd);});
const n=syms.length;
const C=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>corr(Z[i],Z[j])));
let vec=new Array(n).fill(1/Math.sqrt(n));
let lam=0;
for(let it=0;it<500;it++){
  const nv=C.map(row=>row.reduce((s,x,j)=>s+x*vec[j],0));
  const nrm=Math.sqrt(nv.reduce((s,x)=>s+x*x,0))||1e-12;
  vec=nv.map(x=>x/nrm); lam=nrm;
}
const share=lam/n;
console.log(`    PC1 explains ${(share*100).toFixed(1)}% of pooled residual variance  ->  ${share>=0.25?"UNMODELED COMMON FORCE PRESENT":"no dominant missing force (model is not obviously incomplete)"}`);
const loads=syms.map((s,i)=>[s,vec[i]] as [string,number]).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
console.log(`    top loadings: ${loads.slice(0,6).map(([s,v])=>`${s}:${v.toFixed(2)}`).join("  ")}`);
// PC1 time series and candidate naming (candidates are NOT already forces)
const pc=common.map((_,t)=>syms.reduce((s,_s,i)=>s+vec[i]*Z[i][t],0));
const CAND:[string,string][]=[["CREDIT","HYG"],["VOLOFVOL","VVIX"],["EM","EEM"],["JAPAN","^N225"],["SMALLCAP","IWM"],["CRYPTO","BTC-USD"]];
console.log(`    naming (correlation of PC1 with non-force candidates):`);
for(const [nm,sy] of CAND){
  let series:Map<string,number>|null=null;
  if(sy==="VVIX"){const r=await fetch(`${OWNED}/trd_perp_oi?venue=eq.cboe&interval=eq.index_close&symbol=eq.VVIX&select=ts,open_interest&order=ts&limit=100000`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {ts:number;open_interest:number}[];
    series=new Map(r.map(x=>[new Date(x.ts*1000).toISOString().slice(0,10),+x.open_interest]));}
  else series=await load(sy);
  const pairs:[number,number][]=[];
  for(let t=1;t<common.length;t++){
    const a=series.get(common[t]),b=series.get(common[t-1]);
    if(a===undefined||b===undefined)continue;
    pairs.push([pc[t], sy==="VVIX"?(a-b)/100:a/b-1]);
  }
  if(pairs.length<500){console.log(`      ${nm.padEnd(9)} insufficient overlap (${pairs.length})`);continue;}
  const c=corr(pairs.map(p=>p[0]),pairs.map(p=>p[1]));
  console.log(`      ${nm.padEnd(9)} corr ${c>=0?"+":""}${c.toFixed(3)}  (n=${pairs.length})`);
}
{const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},
  body:JSON.stringify({family:"adhoc",run_key:`missing-force-D525`})}).catch(()=>null);
 if(!tw||(!tw.ok&&tw.status!==409))console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
