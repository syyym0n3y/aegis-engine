#!/usr/bin/env -S deno run --allow-net --allow-env
// tail-cooldown-generality.ts (D-462) — does the post-loss cooldown cap tails GENERALLY, or did it work once?
// D-461 found that a simple rule (go flat for N days after any single-day loss worse than X%) cut SVXY's worst day from
// −83.0% to −18.3%, and that the cap held across all 20 parameter combinations. But it named its own fatal limit: the
// sample contains exactly ONE catastrophe. Parameter-robustness is not event-robustness. A tail rule tested against a
// single tail is a rule that worked once.
// Crypto fixes precisely that. The survivorship-free universe (D-442) holds 328 perps INCLUDING contracts that were
// delisted after collapsing — LUNAUSDT ends 2022-05-13, SRMUSDT and ANTUSDT in 2024 — so the sample contains dozens of
// genuine catastrophes across independent instruments, not one.
// THIS IS NOT AN EDGE TEST. The cooldown cannot add return; it can only remove exposure. The question is narrow and
// mechanical: across many instruments and many crashes, does it cap the left tail, and what does that cost?
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"tc",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const TRIG=Number(Deno.env.get("TRIG")||-0.08), COOL=Number(Deno.env.get("COOL")||10);
const NOW=Math.floor(Date.now()/1000);

const meta=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&select=symbol,n_bars,last_ts&order=n_bars.desc&limit=2000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number;last_ts:number}[];
if(!Array.isArray(meta)||!meta.length){console.error("!! no 1dSF universe");Deno.exit(1);}
const nDead=meta.filter(m=>(NOW-m.last_ts)>10*86400).length;
console.log(`==> TAIL COOLDOWN GENERALITY — ${meta.length} perps (${nDead} DELISTED, i.e. real catastrophes), trigger ${(TRIG*100).toFixed(0)}% / cooldown ${COOL}d`);
const GRID:[number,number][]=[]; for(const t of [-0.05,-0.08,-0.12]) for(const c of [3,5,10,20]) GRID.push([t,c]);
const cache=new Map<string,{cost:number;dd:number[];ddBet:number;srBet:number;n:number}>();
for(const [t,c] of GRID) cache.set(`${t}|${c}`,{cost:0,dd:[],ddBet:0,srBet:0,n:0});
type R={sym:string;dead:boolean;rawWorst:number;cdWorst:number;rawDD:number;cdDD:number;rawAnn:number;cdAnn:number;rawSR:number;cdSR:number;nEvents:number};
const out:R[]=[];
for(let i=0;i<meta.length;i+=25){
  const part=meta.slice(i,i+25).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1dSF&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){
    const b=r.bars; if(!b||b.length<250)continue;
    const ret:number[]=[]; for(let k=1;k<b.length;k++){ if(b[k][4]>0&&b[k-1][4]>0) ret.push(b[k][4]/b[k-1][4]-1); }
    if(ret.length<250)continue;
    const stat=(p:number[])=>{const m=mean(p),sd=sdv(p)||1e-9;let c=1,pk=1,dd=0;
      for(const x of p){c*=1+x;pk=Math.max(pk,c);dd=Math.min(dd,c/pk-1);}
      return {ann:m*365*100,sr:(m/sd)*Math.sqrt(365),dd:dd*100,worst:Math.min(...p)*100};};
    // cooldown uses ONLY prior returns — no look-ahead
    const cd:number[]=[]; let events=0;
    for(let k=0;k<ret.length;k++){
      let flat=false;
      for(let q=Math.max(0,k-COOL);q<k;q++) if(ret[q]<TRIG){flat=true;break;}
      if(!flat&&k>0&&ret[k-1]<TRIG)events++;
      cd.push(flat?0:ret[k]);
    }
    const A=stat(ret), B=stat(cd);
    // same computation at every grid point, so the exchange-rate curve costs one extra pass rather than a re-run
    for(const [t,c] of GRID){
      const g:number[]=[];
      for(let k=0;k<ret.length;k++){ let flat=false;
        for(let q=Math.max(0,k-c);q<k;q++) if(ret[q]<t){flat=true;break;}
        g.push(flat?0:ret[k]); }
      const G=stat(g); const e=cache.get(`${t}|${c}`)!;
      e.cost+=(G.ann-A.ann); e.dd.push(G.dd-A.dd); if(G.dd>A.dd)e.ddBet++; if(G.sr>A.sr)e.srBet++; e.n++;
    }
    const meta1=meta.find(m=>m.symbol===r.symbol)!;
    out.push({sym:r.symbol,dead:(NOW-meta1.last_ts)>10*86400,rawWorst:A.worst,cdWorst:B.worst,rawDD:A.dd,cdDD:B.dd,rawAnn:A.ann,cdAnn:B.ann,rawSR:A.sr,cdSR:B.sr,nEvents:events});
  }
  if(i%500===0)Deno.stderr.write(new TextEncoder().encode(`  ..${i}/${meta.length}\r`));
}
console.log(`\n    instruments tested: ${out.length} (${out.filter(o=>o.dead).length} delisted)`);
const tailBetter=out.filter(o=>o.cdWorst>o.rawWorst).length;
const ddBetter=out.filter(o=>o.cdDD>o.rawDD).length;
const srBetter=out.filter(o=>o.cdSR>o.rawSR).length;
const annCost=mean(out.map(o=>o.cdAnn-o.rawAnn));
console.log(`\n    ${"metric".padEnd(34)}${"improved on".padEnd(16)}median change`);
const med=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
console.log(`    ${"WORST SINGLE DAY".padEnd(34)}${`${tailBetter}/${out.length} (${(100*tailBetter/out.length).toFixed(0)}%)`.padEnd(16)}${med(out.map(o=>o.cdWorst-o.rawWorst)).toFixed(1)}pp`);
console.log(`    ${"max drawdown".padEnd(34)}${`${ddBetter}/${out.length} (${(100*ddBetter/out.length).toFixed(0)}%)`.padEnd(16)}${med(out.map(o=>o.cdDD-o.rawDD)).toFixed(1)}pp`);
console.log(`    ${"Sharpe".padEnd(34)}${`${srBetter}/${out.length} (${(100*srBetter/out.length).toFixed(0)}%)`.padEnd(16)}${med(out.map(o=>o.cdSR-o.rawSR)).toFixed(2)}`);
console.log(`    ${"annual return (the cost)".padEnd(34)}${"".padEnd(16)}${annCost.toFixed(1)}pp/yr`);
// the delisted names are the real catastrophes — report them separately
const dead=out.filter(o=>o.dead);
if(dead.length){
  console.log(`\n    DELISTED CONTRACTS ONLY (${dead.length}) — the instruments that actually died:`);
  console.log(`      worst-day improved on ${dead.filter(o=>o.cdWorst>o.rawWorst).length}/${dead.length}, median ${med(dead.map(o=>o.cdWorst-o.rawWorst)).toFixed(1)}pp`);
  console.log(`      maxDD improved on ${dead.filter(o=>o.cdDD>o.rawDD).length}/${dead.length}, median ${med(dead.map(o=>o.cdDD-o.rawDD)).toFixed(1)}pp`);
  for(const o of dead.sort((a,b)=>a.rawWorst-b.rawWorst).slice(0,6))
    console.log(`      ${o.sym.padEnd(13)} worst ${o.rawWorst.toFixed(1)}% -> ${o.cdWorst.toFixed(1)}%   maxDD ${o.rawDD.toFixed(0)}% -> ${o.cdDD.toFixed(0)}%   ann ${o.rawAnn.toFixed(0)}% -> ${o.cdAnn.toFixed(0)}%`);
}
// ============================================================================================================
// IS 7.3pp AN INVARIANT OR A COINCIDENCE? The cost depends on the trigger/cooldown I happened to pick, so matching D-401's
// 7.3pp/yr "to the decimal" may be luck. The number is only USABLE if the EXCHANGE RATE — return given up per point of
// drawdown removed — is stable across parameters. If the ratio is flat, an operator can pick any point on the curve and
// know the price. If it swings wildly, 7.3 is an anecdote.
console.log(`\n    ==> EXCHANGE RATE: return given up per point of drawdown removed`);
console.log(`    ${"trigger".padEnd(9)}${"cool".padEnd(7)}${"cost %/yr".padEnd(12)}${"median dd gain".padEnd(17)}${"cost per dd pt".padEnd(16)}${"maxDD improved".padEnd(16)}Sharpe improved`);
const ratios:number[]=[];
for(const trig of [-0.05,-0.08,-0.12]) for(const cool of [3,5,10,20]){
  let costSum=0, ddSum:number[]=[], ddBet=0, srBet=0, n=0;
  for(const o of out){
    // recompute per instrument at these parameters — cheap because returns are already derived above
    void o;
  }
  // recomputation needs the raw returns, so redo from the cached per-symbol series
  const per=cache.get(`${trig}|${cool}`);
  if(!per)continue;
  costSum=per.cost; ddSum=per.dd; ddBet=per.ddBet; srBet=per.srBet; n=per.n;
  costSum=costSum/Math.max(1,n);
  const medDD=[...ddSum].sort((a,b)=>a-b)[Math.floor(ddSum.length/2)];
  ratios.push(medDD>0?Math.abs(costSum)/medDD:NaN);
  console.log(`    ${((trig*100).toFixed(0)+"%").padEnd(9)}${(cool+"d").padEnd(7)}${costSum.toFixed(1).padEnd(12)}${(medDD.toFixed(1)+"pp").padEnd(17)}${(medDD>0?(Math.abs(costSum)/medDD).toFixed(2):"—").padEnd(16)}${`${ddBet}/${n} (${(100*ddBet/n).toFixed(0)}%)`.padEnd(16)}${srBet}/${n} (${(100*srBet/n).toFixed(0)}%)`);
}
const clean=ratios.filter(Number.isFinite);
if(clean.length){
  const lo=Math.min(...clean), hi=Math.max(...clean), md=[...clean].sort((a,b)=>a-b)[Math.floor(clean.length/2)];
  console.log(`\n    exchange rate across ${clean.length} parameter settings: ${lo.toFixed(2)} .. ${hi.toFixed(2)}, median ${md.toFixed(2)} pp of return per pp of drawdown`);
  console.log(`    -> ${(hi-lo)/md<0.6?"STABLE: this is a usable exchange rate, not a coincidence of the parameters I chose."
    :"UNSTABLE: the ratio swings with parameters, so 7.3pp/yr is an anecdote, not a price."}`);
}
console.log(`\n    A cooldown cannot ADD return — it can only remove exposure. The question is whether it removes exposure`);
console.log(`    preferentially at the left tail, across many independent instruments and many separate crashes.`);
