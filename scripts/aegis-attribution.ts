#!/usr/bin/env -S deno run --allow-net --allow-env
// aegis-attribution.ts (D-520, P3) — THE CAUSAL ATTRIBUTION ENGINE (the program's original north star).
// For every liquid instrument: decompose daily returns into observable FORCES (market, rates, dollar, oil, gold,
// vol-change) by rolling 250d regression; store betas, adj-R², era stability, and today's residual. The output is
// measured explanation AND measured ignorance — the anti-guru: "X% of this instrument's move is these forces; the
// rest we do not explain." The engagement gate (what to trade, when) reads THIS table, never vibes.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"at",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[])) if(b[4]>0) m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
const FORCES:[string,string][]=[["MKT","^GSPC"],["RATES","TLT"],["USD","EURUSD=X"],["OIL","CL=F"],["GOLD","GC=F"],["VOL","^VIX"]];
const fmaps=new Map<string,Map<string,number>>();
for(const [n,s] of FORCES)fmaps.set(n,await load(s));
const UNIVERSE=["SPY","QQQ","IWM","DIA","TLT","GLD","AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","JPM","XOM","AMD","EURUSD=X","GBPUSD=X","JPY=X","AUDUSD=X","CL=F","GC=F","HG=F","SI=F","ZW=F","NG=F","KC=F","BTC-USD"];
const days=[...fmaps.get("MKT")!.keys()].sort();
const fret=(n:string,i:number)=>{const m=fmaps.get(n)!;const a=m.get(days[i]),b=m.get(days[i-1]);
  if(a===undefined||b===undefined)return null;
  return n==="USD"?-(a/b-1):n==="VOL"?(a-b)/100:a/b-1;};       // USD = inverse EURUSD; VOL = VIX point change /100
function ols(X:number[][],y:number[]){
  const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-8*X.length;
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const dd=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=dd;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  return M.map(r=>r[p]);
}
const asof=days[days.length-1];
const out:Record<string,unknown>[]=[];
console.log(`==> CAUSAL ATTRIBUTION — ${UNIVERSE.length} instruments, forces: ${FORCES.map(f=>f[0]).join(" ")}, asof ${asof}`);
console.log(`    ${"symbol".padEnd(10)}${"adjR2".padEnd(8)}${"stab".padEnd(7)}${"top forces (beta)".padEnd(46)}resid_today`);
for(const sym of UNIVERSE){
  const pm=await load(sym); if(pm.size<400)continue;
  // rolling window = last 250 common days
  const rows:{x:number[];y:number}[]=[];
  for(let i=days.length-250;i<days.length;i++){
    if(i<1)continue;
    const a=pm.get(days[i]),b=pm.get(days[i-1]); if(a===undefined||b===undefined)continue;
    const x=FORCES.map(([n])=>fret(n,i));
    if(x.some(v=>v===null))continue;
    const y=a/b-1; if(!Number.isFinite(y)||Math.abs(y)>0.5)continue;
    rows.push({x:[1,...(x as number[])],y});
  }
  if(rows.length<150)continue;
  const w=ols(rows.map(r=>r.x),rows.map(r=>r.y));
  const yhat=rows.map(r=>r.x.reduce((s,v,i2)=>s+v*w[i2],0));
  const ybar=mean(rows.map(r=>r.y));
  const ssr=rows.reduce((s,r,i2)=>s+(r.y-yhat[i2])**2,0), sst=rows.reduce((s,r)=>s+(r.y-ybar)**2,0);
  const r2=1-ssr/Math.max(1e-12,sst);
  const adj=1-(1-r2)*(rows.length-1)/(rows.length-FORCES.length-1);
  // era stability: refit on halves, mean |beta correlation|
  const half=Math.floor(rows.length/2);
  const w1=ols(rows.slice(0,half).map(r=>r.x),rows.slice(0,half).map(r=>r.y));
  const w2=ols(rows.slice(half).map(r=>r.x),rows.slice(half).map(r=>r.y));
  const b1=w1.slice(1),b2v=w2.slice(1);
  const m1=mean(b1),m2=mean(b2v);
  const stab=(()=>{let nu=0,d1=0,d2=0;for(let i2=0;i2<b1.length;i2++){nu+=(b1[i2]-m1)*(b2v[i2]-m2);d1+=(b1[i2]-m1)**2;d2+=(b2v[i2]-m2)**2;}return d1&&d2?nu/Math.sqrt(d1*d2):0;})();
  const last=rows[rows.length-1];
  const resid=last.y-last.x.reduce((s,v,i2)=>s+v*w[i2],0);
  const betas:Record<string,number>={}; FORCES.forEach(([n],i2)=>betas[n]=+w[i2+1].toFixed(4));
  const top=Object.entries(betas).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,3).map(([n,v])=>`${n}:${v.toFixed(2)}`).join(" ");
  console.log(`    ${sym.padEnd(10)}${adj.toFixed(2).padEnd(8)}${stab.toFixed(2).padEnd(7)}${top.padEnd(46)}${(resid*100).toFixed(2)}%`);
  out.push({symbol:sym,asof,r2:+r2.toFixed(4),adj_r2:+adj.toFixed(4),residual:+resid.toFixed(6),n:rows.length,
    betas,era_stability:+stab.toFixed(3),n_factors:FORCES.length,cluster:null});
}
const wres=await fetch(`${OWNED}/trd_attribution?on_conflict=symbol,asof`,{method:"POST",
  headers:{...hdr,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(out)}).catch(()=>null);
if(!wres||!wres.ok){console.log(`WRITE-FAILED trd_attribution ${wres?wres.status:"net"}`);Deno.exit(1);}
console.log(`==> ${out.length} attribution rows written for ${asof}. High adj-R2 = force-driven (engage via forces); low = idiosyncratic (engage via residual structure or NOT AT ALL - measured ignorance).`);
