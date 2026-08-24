#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// check-book-attribution.ts (D-527) — ATTACK THE PAPER-RUNG BOOK WITH THE PROGRAM'S OWN BEST MODEL.
// The P1/P2 book was armed on the claim "many small INDEPENDENT premia". If its returns are mostly exposure to the
// nine measured forces (especially STYLE, which the 9-force upgrade showed dominates equity cross-sections), then what
// sits on the paper rung is beta in disguise and the claim must be corrected in public.
// PRE-REGISTERED: regress monthly book returns on monthly force returns. If alpha t < 2 the book is force exposure;
// if alpha t >= 2 AND R2 is modest, the "independent premia" framing survives. Both spans reported (6-force long,
// 9-force short) because credit/style ETFs only exist post-2000. Trials +1.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ba",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{"Content-Type":"application/json",Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[])) if(b[4]>0) m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
// monthly force returns: compound daily, month-end to month-end
const px=new Map<string,Map<string,number>>();
for(const s of ["^GSPC","TLT","EURUSD=X","CL=F","GC=F","^VIX","HYG","IEF","IWF","IWD","IWM","SPY"]) px.set(s,await load(s));
const monthEnd=(m:Map<string,number>)=>{const out=new Map<string,number>();
  const ds=[...m.keys()].sort();
  for(let i=0;i<ds.length;i++){const mo=ds[i].slice(0,7); out.set(mo,m.get(ds[i])!);}   // last value per month wins
  return out;};
const me=new Map<string,Map<string,number>>();
for(const [k,v] of px)me.set(k,monthEnd(v));
const moRet=(s:string,mo:string,prev:string)=>{const m=me.get(s)!;const a=m.get(mo),b=m.get(prev);
  return (a===undefined||b===undefined)?null:a/b-1;};
const F6=(mo:string,prev:string)=>{
  const mkt=moRet("^GSPC",mo,prev),rat=moRet("TLT",mo,prev),eur=moRet("EURUSD=X",mo,prev),oil=moRet("CL=F",mo,prev),gld=moRet("GC=F",mo,prev);
  const v=me.get("^VIX")!,va=v.get(mo),vb=v.get(prev);
  if([mkt,rat,eur,oil,gld].some(x=>x===null)||va===undefined||vb===undefined)return null;
  return [mkt!,rat!,-eur!,oil!,gld!,(va-vb)/100];};
const F3=(mo:string,prev:string)=>{
  const hyg=moRet("HYG",mo,prev),ief=moRet("IEF",mo,prev),iwf=moRet("IWF",mo,prev),iwd=moRet("IWD",mo,prev),iwm=moRet("IWM",mo,prev),spy=moRet("SPY",mo,prev);
  if([hyg,ief,iwf,iwd,iwm,spy].some(x=>x===null))return null;
  return [hyg!-ief!,iwf!-iwd!,iwm!-spy!];};
const ols=(X:number[][],y:number[])=>{
  const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-10*X.length;
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const dd=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=dd;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  return M.map(r=>r[p]);};
const raw=await Deno.readTextFile("/Users/ona/aegis-data/book_p1_core.tsv");
const book=new Map<string,number>(raw.trim().split("\n").map(l=>{const [mo,r]=l.split("\t");return [mo,+r] as [string,number];}));
const mos=[...book.keys()].sort();
const NAMES6=["MKT","RATES","USD","OIL","GOLD","VOL"], NAMES9=[...NAMES6,"CREDIT","STYLE","SIZE"];
const run=(use9:boolean,label:string)=>{
  const X:number[][]=[],y:number[]=[];
  for(let i=1;i<mos.length;i++){
    const f6=F6(mos[i],mos[i-1]); if(!f6)continue;
    const f3=use9?F3(mos[i],mos[i-1]):[]; if(use9&&!f3)continue;
    X.push([1,...f6,...(f3 as number[])]); y.push(book.get(mos[i])!);
  }
  if(X.length<60){console.log(`    ${label}: insufficient overlap (${X.length} months)`);return;}
  const w=ols(X,y);
  const yh=X.map(r=>r.reduce((s,v,i)=>s+v*w[i],0));
  const resid=y.map((v,i)=>v-yh[i]);
  const yb=mean(y);
  const ssr=resid.reduce((s,x)=>s+x*x,0), sst=y.reduce((s,x)=>s+(x-yb)**2,0);
  const r2=1-ssr/Math.max(1e-12,sst);
  const p=X[0].length;
  const se=Math.sqrt(ssr/(X.length-p))/Math.sqrt(X.length);     // se of intercept ~ sigma/sqrt(n) (X centered-ish)
  const alpha=w[0], ta=alpha/se;
  const names=use9?NAMES9:NAMES6;
  const bet=names.map((n,i)=>`${n}:${w[i+1].toFixed(2)}`).join(" ");
  console.log(`    ${label}  n=${X.length}mo  R2 ${(r2*100).toFixed(1)}%  alpha ${(alpha*12*100).toFixed(2)}%/yr  t(alpha) ${ta.toFixed(2)}`);
  console.log(`      betas: ${bet}`);
  console.log(`      raw book mean ${(yb*12*100).toFixed(2)}%/yr -> alpha keeps ${(100*alpha/Math.max(1e-12,yb)).toFixed(0)}% of it`);
  console.log(`      VERDICT: ${ta>=2?"ALPHA SURVIVES the force model — the independent-premia framing holds":"NO ALPHA vs forces — the book is force exposure and the framing must be corrected"}`);
};
console.log(`==> BOOK ATTRIBUTION (D-527) — attacking the paper-rung book with the 6- and 9-force models`);
run(false,"6-force (long span)");
run(true, "9-force (post-2007)");
{const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,Prefer:"return=minimal"},
  body:JSON.stringify({family:"adhoc",run_key:`book-attribution-D527`})}).catch(()=>null);
 if(!tw||!tw.ok)console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
