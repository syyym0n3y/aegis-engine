#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// check-crypto-attribution.ts (D-563) — IS THE CRYPTO BOOK JUST BETA? The equity book was attacked this way in D-527
// (alpha survived, t 3.56-3.94); the crypto candidate has never faced it. A quintile long-short is neutral by
// construction only if the two legs have equal factor exposure — high-momentum, low-vol names can carry systematically
// different beta, so neutrality must be MEASURED, not assumed.
// Factors: crypto market (equal-weight universe), BTC, ETH, and a size tilt (equal-weight minus BTC = alt premium).
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ca",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
// book stream (date, ..., linHold at col 5)
const raw=await Deno.readTextFile("/Users/ona/aegis-data/crypto_books_1dSF_lit5_top50_lag1_hold5.tsv");
const book=new Map<string,number>();
for(const l of raw.trim().split("\n")){const f=l.split("\t"); const v=+f[5]; if(f[0]&&Number.isFinite(v))book.set(f[0],v);}
// factors from the panel itself
const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()) as {symbol:string}[];
const perDay=new Map<string,number[]>(); const btc=new Map<string,number>(), eth=new Map<string,number>();
for(let i=0;i<meta.length;i+=25){
  const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  for(const r of rows){
    const b=r.bars; if(!b)continue;
    for(let k=1;k<b.length;k++){
      if(!(b[k][4]>0)||!(b[k-1][4]>0))continue;
      const d=new Date(b[k][0]*1000).toISOString().slice(0,10);
      const ret=b[k][4]/b[k-1][4]-1;
      if(Math.abs(ret)>2)continue;
      (perDay.get(d)??perDay.set(d,[]).get(d)!).push(ret);
      if(r.symbol==="BTCUSDT")btc.set(d,ret);
      if(r.symbol==="ETHUSDT")eth.set(d,ret);
    }}}
const days=[...book.keys()].filter(d=>perDay.has(d)&&btc.has(d)&&eth.has(d)&&(perDay.get(d)!.length>=20)).sort();
console.log(`==> CRYPTO BOOK ATTRIBUTION (D-563) — ${days.length} overlapping days`);
const y=days.map(d=>book.get(d)!);
const mkt=days.map(d=>mean(perDay.get(d)!));
const B=days.map(d=>btc.get(d)!), E=days.map(d=>eth.get(d)!);
const alt=days.map((d,i)=>mkt[i]-B[i]);
const ols=(X:number[][],yy:number[])=>{
  const p=X[0].length,A=Array.from({length:p},()=>new Array(p).fill(0)),bv=new Array(p).fill(0);
  for(let i=0;i<X.length;i++){for(let a=0;a<p;a++){bv[a]+=X[i][a]*yy[i];for(let b2=0;b2<p;b2++)A[a][b2]+=X[i][a]*X[i][b2];}}
  for(let a=0;a<p;a++)A[a][a]+=1e-10*X.length;
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<p;c++){let pv=c;for(let r2=c;r2<p;r2++)if(Math.abs(M[r2][c])>Math.abs(M[pv][c]))pv=r2;[M[c],M[pv]]=[M[pv],M[c]];
    const dd=M[c][c]||1e-12;for(let k=c;k<=p;k++)M[c][k]/=dd;
    for(let r2=0;r2<p;r2++)if(r2!==c){const fq=M[r2][c];for(let k=c;k<=p;k++)M[r2][k]-=fq*M[c][k];}}
  return M.map(r=>r[p]);};
const run=(cols:number[][],names:string[])=>{
  const X=days.map((_,i)=>[1,...cols.map(c=>c[i])]);
  const w=ols(X,y);
  const yh=X.map(r=>r.reduce((s,v,i)=>s+v*w[i],0));
  const res=y.map((v,i)=>v-yh[i]);
  const yb=mean(y);
  const ssr=res.reduce((s,x)=>s+x*x,0), sst=y.reduce((s,x)=>s+(x-yb)**2,0);
  const r2=1-ssr/Math.max(1e-12,sst);
  const se=Math.sqrt(ssr/(X.length-X[0].length))/Math.sqrt(X.length);
  console.log(`    ${names.join("+").padEnd(26)} R2 ${(r2*100).toFixed(1).padStart(5)}%  alpha ${(w[0]*365*100).toFixed(1).padStart(6)}%/yr  t(alpha) ${(w[0]/se).toFixed(2).padStart(5)}  betas ${names.map((n,i)=>`${n}:${w[i+1].toFixed(3)}`).join(" ")}`);
};
// D-644 POSITIVE CONTROL (THE POSITIVE-CONTROL RULE, D-641). This script's headline is a ZERO: "R2 0.0-0.5% across
// every specification", which is the basis for claiming the crypto book is not merely crypto beta. A near-zero R2
// everywhere is ALSO exactly what a broken regression produces, and the two are indistinguishable from the output
// alone. So before believing the zero, the estimator is handed a series with a KNOWN beta and must recover it.
{
  const TRUE_BETA = 1.7, TRUE_ALPHA = 0.0004;
  const synth = mkt.map((m, i) => TRUE_ALPHA + TRUE_BETA * m + ((i * 2654435761) % 1000 - 500) / 1e6);  // deterministic pseudo-noise
  const Xc = days.map((_, i) => [1, mkt[i]]);
  const wc = ols(Xc, synth);
  const yhc = Xc.map((r) => r.reduce((s2, v, i2) => s2 + v * wc[i2], 0));
  const resc = synth.map((v, i2) => v - yhc[i2]);
  const ybc = mean(synth);
  const r2c = 1 - resc.reduce((s2, x) => s2 + x * x, 0) / Math.max(1e-12, synth.reduce((s2, x) => s2 + (x - ybc) ** 2, 0));
  const betaOK = Math.abs(wc[1] - TRUE_BETA) < 0.05, r2OK = r2c > 0.9;
  console.log(`    POSITIVE CONTROL — synthetic series built as ${TRUE_ALPHA} + ${TRUE_BETA}*mkt + noise:`);
  console.log(`      recovered beta ${wc[1].toFixed(3)} (true ${TRUE_BETA})  R2 ${(100 * r2c).toFixed(1)}%  -> ${betaOK && r2OK ? "ESTIMATOR OK" : "ESTIMATOR BROKEN"}`);
  if (!betaOK || !r2OK) { console.log(`      !! the regression cannot recover a known exposure, so a measured R2 of ~0 is EVIDENCE ABOUT THIS CODE, not about the book. RED.`); Deno.exit(1); }
}
console.log(`    raw book: ${(mean(y)*365*100).toFixed(1)}%/yr, SR ${((mean(y)/(sdv(y)||1e-9))*Math.sqrt(365)).toFixed(2)}`);
run([mkt],["mkt"]);
run([B],["BTC"]);
run([mkt,B,E],["mkt","BTC","ETH"]);
run([mkt,B,E,alt],["mkt","BTC","ETH","alt"]);
