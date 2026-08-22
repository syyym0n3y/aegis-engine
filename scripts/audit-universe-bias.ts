#!/usr/bin/env -S deno run --allow-net --allow-env
// audit-universe-bias.ts (D-466) — the equity leg of the recommended book is 150 tickers that ALL BEGIN WITH "A".
// Found while chasing an unexplained residual in D-465's reconciliation. `combined-book.ts` builds its universe with:
//     trd_bars_deep?asset_class=eq.equity&select=symbol,bars&limit=150
// There is no `order=` clause. Postgres returns rows in unspecified order, which here is physical/insertion order, which
// is alphabetical — so the fetch takes the first 150 tickers, A through AHRT, out of **4,184 available equities**.
// This is not a sampling choice anyone made; it is a missing ORDER BY. The consequence is that the program's HEADLINE
// recommendation — "diversified passive is the best risk-adjusted book" — has an equity leg that is 3.6% of the universe
// sharing an initial letter, and its absolute Sharpe is therefore not a statement about holding equities at all.
// THE QUESTION THAT MATTERS is not whether the number moves — it will — but whether the RECOMMENDATION survives: does
// passive still look the way it did on a universe chosen deliberately rather than by accident?
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ub",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const LB=100;
type Inst={sym:string;cls:string;m:Map<string,number>};
async function load(cls:string,syms:string[]){
  const out:Inst[]=[];
  for(let i=0;i<syms.length;i+=25){
    const part=syms.slice(i,i+25).map(s=>`"${s}"`).join(",");
    const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
    if(!Array.isArray(rows))continue;
    for(const r of rows){ const c=r.bars.map(b=>b[4]); if(c.length<LB+400)continue;
      let mx=0,mn=Infinity; for(let k=1;k<c.length;k++){ if(c[k-1]>0){const q=Math.abs(c[k]/c[k-1]-1); if(q>mx)mx=q;} if(c[k]>0&&c[k]<mn)mn=c[k]; }
      if(mx>10||mn<0.01)continue;                        // identical data-quality filter to combined-book.ts
      out.push({sym:r.symbol,cls,m:new Map(r.bars.map(b=>[new Date(b[0]*1000).toISOString().slice(0,10),b[4]] as [string,number]))}); }
  }
  return out;
}
// ---- three equity universes, same size, same filters ----
const allEq=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&limit=5000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string}[];
const sorted=allEq.map(r=>r.symbol);
console.log(`==> UNIVERSE BIAS — ${sorted.length} equities available; the book uses 150`);
const asIs=sorted.slice(0,150);                                                     // what the book actually holds
const spread:string[]=[]; const step=Math.floor(sorted.length/150);                 // evenly across the alphabet
for(let i=0;i<sorted.length&&spread.length<150;i+=step) spread.push(sorted[i]);
// liquidity-selected: the 150 most tradable, which is what a real book would hold
const liq:{s:string;dv:number}[]=[];
for(let i=0;i<sorted.length;i+=40){
  const part=sorted.slice(i,i+40).map(s=>`"${s}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){ const b=r.bars; if(!b||b.length<LB+400)continue;
    let dv=0,n=0; for(let k=Math.max(0,b.length-260);k<b.length;k++) if(b[k][4]>0&&b[k][5]>0){dv+=b[k][4]*b[k][5];n++;}
    if(n) liq.push({s:r.symbol,dv:dv/n}); }
}
liq.sort((a,b)=>b.dv-a.dv);
const byLiq=liq.slice(0,150).map(x=>x.s);
console.log(`    A-only universe : ${asIs[0]} .. ${asIs[asIs.length-1]}  (all initials: ${[...new Set(asIs.map(s=>s[0]))].join("")})`);
console.log(`    alphabet spread : ${spread.length} names, initials ${[...new Set(spread.map(s=>s[0]))].join("")}`);
console.log(`    most liquid 150 : ${byLiq.slice(0,6).join(", ")} ...`);
// ---- non-equity classes are identical across all three books ----
const OTHER=["etf","index","sector","commodity","fx","crypto_ex"];
const base:Inst[]=[];
for(const cls of OTHER){
  const rows=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.${cls}&select=symbol&order=symbol&limit=200`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string}[];
  base.push(...await load(cls,rows.map(r=>r.symbol)));
}
console.log(`    shared non-equity legs: ${OTHER.map(c=>`${c}(${base.filter(b=>b.cls===c).length})`).join(" ")}`);
const stat=(a:number[])=>{const m=mean(a),sd=sdv(a)||1e-9;let c=1,p=1,dd=0;
  for(const r of a){c*=1+r;p=Math.max(p,c);dd=Math.min(dd,c/p-1);}
  return {sr:(m/sd)*Math.sqrt(252),ann:m*252*100,dd:dd*100};};
async function bookFor(eqSyms:string[]){
  const insts=[...base,...await load("equity",eqSyms)];
  const dates=[...new Set(insts.flatMap(i=>[...i.m.keys()]))].sort();
  const out:number[]=[];
  for(let d=LB+30;d<dates.length-1;d++){
    const day=dates[d],nxt=dates[d+1];
    let acc=0,nc=0;
    for(const cls of [...OTHER,"equity"]){
      let rp=0,n=0;
      for(const i of insts){ if(i.cls!==cls)continue; const p0=i.m.get(day),p1=i.m.get(nxt);
        if(!p0||!p1||!(p0>0))continue; const r=p1/p0-1; if(!Number.isFinite(r))continue; rp+=r; n++; }
      if(n<3)continue; acc+=rp/n; nc++;
    }
    if(nc>=3) out.push(acc/nc);
  }
  return out;
}
const books:[string,number[]][]=[
  ["A-only (as the book runs)",await bookFor(asIs)],
  ["alphabet spread",await bookFor(spread)],
  ["most liquid 150",await bookFor(byLiq)],
];
console.log(`\n    ${"equity universe".padEnd(28)}${"days".padEnd(8)}${"FULL SR".padEnd(10)}${"ann".padEnd(9)}${"maxDD".padEnd(10)}${"OOS SR".padEnd(9)}${"OOS ann".padEnd(10)}OOS maxDD`);
for(const [lab,b] of books){
  const sp=Math.floor(b.length/1.667);
  const F=stat(b), O=stat(b.slice(sp));
  console.log(`    ${lab.padEnd(28)}${String(b.length).padEnd(8)}${F.sr.toFixed(2).padEnd(10)}${(F.ann.toFixed(1)+"%").padEnd(9)}${(F.dd.toFixed(1)+"%").padEnd(10)}${O.sr.toFixed(2).padEnd(9)}${(O.ann.toFixed(1)+"%").padEnd(10)}${O.dd.toFixed(1)}%`);
}
const srs=books.map(([,b])=>{const sp=Math.floor(b.length/1.667);return stat(b.slice(sp)).sr;});
console.log(`\n    OOS Sharpe across the three universes: ${srs.map(x=>x.toFixed(2)).join(" / ")}  — spread ${(Math.max(...srs)-Math.min(...srs)).toFixed(2)}`);
console.log(`    -> ${Math.max(...srs)-Math.min(...srs)<0.25?"the RECOMMENDATION is robust to the universe accident, even though the absolute number is not."
  :"the recommendation MOVES materially with the universe: the headline number is an artefact of which 150 tickers were fetched."}`);
