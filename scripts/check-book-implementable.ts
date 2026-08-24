#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// check-book-implementable.ts (D-530) — CAN THE PAPER-RUNG BOOK ACTUALLY BE TRADED?
// The frozen book is built from French research portfolios: extreme-decile long-shorts over thousands of names, with
// borrow assumed and only a 5-10bp/month implementation drag. The operator cannot place that. Before any path to real
// money exists, the book must be expressible in LIQUID ETFs they can actually buy and sell.
// PRE-REGISTERED: fit the book on a tradable ETF long-short basket using TRAIN months only (first half), freeze the
// weights, and measure OOS R2 and tracking on the untouched second half. Thresholds declared before running:
//   OOS R2 >= 0.50 AND replica mean >= 50% of book mean  => IMPLEMENTABLE (with stated slippage)
//   otherwise => NOT IMPLEMENTABLE AS SPECIFIED, and the ladder must say so.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"bi",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const load=async(sym:string)=>{
  const rb=await fetch(`${OWNED}/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=bars`,{headers:hdr}).then(x=>x.json()).catch(()=>[]) as {bars:number[][]}[];
  const m=new Map<string,number>();
  for(const b of (rb[0]?.bars||[])) if(b[4]>0) m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
  return m;};
const ETFS=["MTUM","VLUE","QUAL","USMV","IWF","IWD","IWM","SPY","EFA","VGK","EWJ","EEM","HYG","IEF","LQD","XLF","XLK","XLE","XLU","XLP","XLI","XLV","XLY"];
const px=new Map<string,Map<string,number>>();
for(const s of ETFS)px.set(s,await load(s));
const me=new Map<string,Map<string,number>>();
for(const [k,v] of px){const out=new Map<string,number>();for(const d of [...v.keys()].sort())out.set(d.slice(0,7),v.get(d)!);me.set(k,out);}
const r=(s:string,mo:string,prev:string)=>{const m=me.get(s)!;const a=m.get(mo),b=m.get(prev);return (a===undefined||b===undefined)?null:a/b-1;};
// TRADABLE LEGS: long-short ETF pairs an operator can actually place (both sides are liquid ETFs; shorting an ETF is
// ordinary margin, unlike shorting a decile of microcaps).
const LEGS:[string,string,string][]=[
  ["us_mom","MTUM","SPY"],["us_val","VLUE","SPY"],["us_qual","QUAL","SPY"],["lowvol","USMV","SPY"],
  ["growth_value","IWF","IWD"],["size","IWM","SPY"],["intl","EFA","SPY"],["europe","VGK","EFA"],
  ["japan","EWJ","EFA"],["em","EEM","EFA"],["credit","HYG","IEF"],["cyc_def","XLK","XLU"],["fin_tech","XLF","XLK"],
];
const raw=await Deno.readTextFile("/Users/ona/aegis-data/book_p1_core.tsv");
const book=new Map<string,number>(raw.trim().split("\n").map(l=>{const [mo,x]=l.split("\t");return [mo,+x] as [string,number];}));
const mos=[...book.keys()].sort();
const rows:{mo:string;x:number[];y:number}[]=[];
for(let i=1;i<mos.length;i++){
  const legs=LEGS.map(([,a,b])=>{const ra=r(a,mos[i],mos[i-1]),rb=r(b,mos[i],mos[i-1]);return (ra===null||rb===null)?null:ra-rb;});
  if(legs.some(v=>v===null))continue;
  rows.push({mo:mos[i],x:[1,...(legs as number[])],y:book.get(mos[i])!});
}
console.log(`==> BOOK IMPLEMENTABILITY (D-530) — ${rows.length} months where ALL ${LEGS.length} tradable legs exist (${rows[0]?.mo} .. ${rows.at(-1)?.mo})`);
if(rows.length<80){console.log(`    UNTESTED: too few overlapping months (ETF era limits this).`);Deno.exit(0);}
const half=Math.floor(rows.length/2);
const tr=rows.slice(0,half),te=rows.slice(half);
const ols=(X:number[][],y:number[])=>{
  const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*y[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-6*X.length;                 // ridge: 13 collinear legs on ~90 train months
  const M=A.map((r2,i)=>[...r2,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const dd=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=dd;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  return M.map(r2=>r2[p]);};
const w=ols(tr.map(r2=>r2.x),tr.map(r2=>r2.y));
console.log(`    train ${tr[0].mo}..${tr.at(-1)!.mo} (${tr.length}mo)   test ${te[0].mo}..${te.at(-1)!.mo} (${te.length}mo)  [weights frozen on train]`);
console.log(`    fitted leg weights: ${LEGS.map((l,i)=>`${l[0]}:${w[i+1].toFixed(2)}`).join("  ")}`);
const evalSet=(set:typeof rows,label:string)=>{
  const yh=set.map(r2=>r2.x.reduce((s,v,i)=>s+v*w[i],0));
  const y=set.map(r2=>r2.y);
  const yb=mean(y);
  const ssr=y.reduce((s,v,i)=>s+(v-yh[i])**2,0), sst=y.reduce((s,v)=>s+(v-yb)**2,0);
  const R2=1-ssr/Math.max(1e-12,sst);
  const te2=Math.sqrt(mean(y.map((v,i)=>(v-yh[i])**2)))*Math.sqrt(12);
  // gross turnover of the replica: sum |dw| across legs is fixed (weights static) -> monthly rebalance of leg drift only
  console.log(`    ${label.padEnd(6)} R2 ${(R2*100).toFixed(1)}%  book ${(yb*12*100).toFixed(2)}%/yr  replica ${(mean(yh)*12*100).toFixed(2)}%/yr  tracking-error ${(te2*100).toFixed(1)}%/yr`);
  return {R2,bookMean:yb,repMean:mean(yh)};};
evalSet(tr,"TRAIN");
const t2=evalSet(te,"TEST");
const pass=t2.R2>=0.50&&t2.repMean>=0.5*t2.bookMean;
console.log(`\n    VERDICT: ${pass?"IMPLEMENTABLE — the book can be approximated with liquid ETFs (slippage still to be modelled)":"NOT IMPLEMENTABLE AS SPECIFIED — liquid ETFs do NOT reproduce this book; the paper rung is marking a portfolio the operator could not place"}`);
console.log(`    (pre-registered thresholds: OOS R2 >= 50% AND replica mean >= 50% of book mean)`);
{const tw=await fetch(`${OWNED}/trd_trial_counter`,{method:"POST",headers:{...hdr,"Content-Type":"application/json",Prefer:"return=minimal"},
  body:JSON.stringify({family:"adhoc",run_key:`book-implementable-D530`})}).catch(()=>null);
 if(!tw||(!tw.ok&&tw.status!==409))console.log(`WRITE-FAILED trd_trial_counter ${tw?tw.status:"net"}`);}
