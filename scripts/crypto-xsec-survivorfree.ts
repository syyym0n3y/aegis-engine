#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-xsec-survivorfree.ts (D-443) — the momentum result, re-run on a universe that INCLUDES DELISTED CONTRACTS.
// D-441 found crypto cross-sectional momentum market-neutral (beta -0.03) with alpha t 2.93 net of fees and funding —
// the only signal in this program to survive that far. It was measured on 14 currently-listed perps, and that is exactly
// the universe a momentum rule is most flattered by: it excludes the coins that pumped, would have been BOUGHT by the
// rule, and then died. LUNA is the canonical case and LUNA was absent.
// DELISTING TREATMENT (stated, because it drives the answer): when a contract disappears the position is closed at its
// LAST AVAILABLE PRICE. Binance force-settles at mark, so assuming a -100% wipeout would be too harsh and dropping the
// symbol retroactively would be the bias we are removing. The collapse that PRECEDED delisting is fully in the price
// series and is therefore fully charged to the strategy.
// FUNDING: not applied here. Funding history was not fetched for delisted contracts, and imputing it would be inventing
// data. D-441 measured funding's effect on momentum at +1.3pp/yr, so this compares GROSS+FEES against GROSS+FEES on the
// listed-only universe — an apples-to-apples isolation of the survivorship effect.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"sx",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("PERP_FEE_RT_BP")||9);
const NOW=Math.floor(Date.now()/1000);

const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars,last_ts&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number;last_ts:number}[];
if(!Array.isArray(meta)||!meta.length){console.error("!! no 1dSF rows — run ingest-perp-survivorfree.ts");Deno.exit(1);}
const dead=meta.filter(m=>(NOW-m.last_ts)>10*86400);
console.log(`==> SURVIVORSHIP-FREE CRYPTO CROSS-SECTION`);
console.log(`    universe ${meta.length} contracts: ${meta.length-dead.length} live, ${dead.length} DELISTED (${(100*dead.length/meta.length).toFixed(0)}%)`);
console.log(`    a current-listings-only test silently discards those ${dead.length} contracts\n`);
const px=new Map<string,Map<string,number>>();
for(let i=0;i<meta.length;i+=25){
  const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){const m=new Map<string,number>();
    for(const b of r.bars) if(b[4]>0) m.set(new Date(b[0]*1000).toISOString().slice(0,10),b[4]);
    px.set(r.symbol,m);}
}
const days=[...new Set([...px.values()].flatMap(m=>[...m.keys()]))].sort();
const deadSet=new Set(dead.map(d=>d.symbol));

function backtest(universe:Set<string>,label:string){
  const g=(s:string,d:string)=>px.get(s)?.get(d);
  const out:{d:string;net:number;n:number}[]=[]; let prev=new Map<string,number>();
  for(let i=31;i<days.length-1;i++){
    const d=days[i], dn=days[i+1];
    const cands:{sym:string;v:number}[]=[];
    for(const sym of universe){
      const a=g(sym,d), b=g(sym,days[i-30]), nx=g(sym,dn);
      if(a&&b&&nx) cands.push({sym,v:a/b-1});
    }
    if(cands.length<10)continue;
    cands.sort((x,y)=>y.v-x.v);
    const k=Math.max(3,Math.floor(cands.length/5));
    const w=new Map<string,number>();
    for(const c of cands.slice(0,k))w.set(c.sym,1/k);
    for(const c of cands.slice(-k))w.set(c.sym,(w.get(c.sym)||0)-1/k);
    let gross=0; for(const [sym,wt] of w) gross+=wt*(g(sym,dn)!/g(sym,d)!-1);
    let to=0; for(const sym of new Set([...w.keys(),...prev.keys()])) to+=Math.abs((w.get(sym)||0)-(prev.get(sym)||0));
    out.push({d:dn,net:gross-(to/2)*FEE_BP/1e4,n:cands.length}); prev=w;
  }
  if(out.length<200)return null;
  const r=out.map(x=>x.net), m=mean(r), sd=sdv(r)||1e-9;
  let cum=1,peak=1,dd=0; for(const x of r){cum*=1+x;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  return {label,ann:m*365,sr:(m/sd)*Math.sqrt(365),t:m/(sd/Math.sqrt(r.length)),dd,n:r.length,breadth:mean(out.map(x=>x.n))};
}
const all=new Set(px.keys());
const liveOnly=new Set([...px.keys()].filter(s=>!deadSet.has(s)));
const rA=backtest(all,"SURVIVORSHIP-FREE (incl. delisted)");
const rL=backtest(liveOnly,"currently-listed ONLY (biased)");
console.log(`    ${"universe".padEnd(36)}${"net %/yr".padEnd(11)}${"SR".padEnd(7)}${"t".padEnd(8)}${"maxDD".padEnd(9)}${"breadth".padEnd(9)}n`);
for(const r of [rA,rL]) if(r)
  console.log(`    ${r.label.padEnd(36)}${((r.ann*100).toFixed(1)+"%").padEnd(11)}${r.sr.toFixed(2).padEnd(7)}${r.t.toFixed(2).padEnd(8)}${((r.dd*100).toFixed(0)+"%").padEnd(9)}${r.breadth.toFixed(0).padEnd(9)}${r.n}`);
if(rA&&rL){
  console.log(`\n    SURVIVORSHIP EFFECT: ${((rA.ann-rL.ann)*100).toFixed(1)}pp/yr, SR ${(rA.sr-rL.sr).toFixed(2)}, t ${(rA.t-rL.t).toFixed(2)}`);
  console.log(`    ${rA.t>rL.t?"Including dead contracts HELPED — the bias was against the strategy (missing profitable shorts)."
    :"Including dead contracts HURT — the listed-only result was flattered, as feared."}`);
  // The program's own deflation standard (D-363/364): with ~1.53M trials the honest noise ceiling is t ~ 5.34.
  const CEIL=5.34;
  console.log(`\n    DEFLATION (this program's own standard, D-363/364): the noise ceiling across ~1.53M trials is t ~ ${CEIL}.`);
  console.log(`    survivorship-free t = ${rA.t.toFixed(2)} -> ${rA.t>CEIL?"CLEARS the deflated bar":"DOES NOT clear the deflated bar"}.`);
}
