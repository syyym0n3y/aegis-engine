#!/usr/bin/env -S deno run --allow-net --allow-env
// audit-bbfade.ts (D-453) — the last of the three claimed "verified" edges, audited against the laws that postdate it.
// RULE (verbatim from supabase/functions/trd-bblo-exec/index.ts): close < MA20 - 2*sigma(20) -> LONG, unconditional,
// with a bracket of 2ATR stop (= -1R) and a 3R target. Prior record: "the 5th edge, the ONE survivor of the 24-setup
// global sweep, robust on 16/16 major liquid markets".
// Two corrections the original could not have applied:
//   PSEUDO-REPLICATION (D-451/452) — Bollinger-lower breaches cluster hard: on a broad down-day, hundreds of names breach
//     at once. They are one bet, not hundreds of independent draws. The portfolio t-stat (n = days) is the honest one,
//     and rip-short's sign FLIPPED between the two views, so this is not a theoretical concern.
//   BENCHMARK (D-439) — this is a LONG-ONLY rule in a market with a large secular uptrend. Twelve on-chain rules looked
//     magnificent until measured against buy-and-hold. So every trade is compared against simply holding the SAME name
//     over the SAME window: the excess is the only thing the rule can claim credit for.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"ab",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("EQ_FEE_RT_BP")||10);
const DV_MIN=Number(Deno.env.get("DV_MIN")||1e7);
const MAXH=Number(Deno.env.get("MAX_HOLD")||40);        // bracket trades still need a time-out

const meta:{symbol:string}[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
console.log(`==> AUDIT: BBFADE (close < MA20 - 2sigma -> LONG, 2ATR stop = -1R, 3R target), $${(DV_MIN/1e6).toFixed(0)}M/day floor, ${FEE_BP}bp`);
const tr:{d:string;r:number;bh:number}[]=[];
for(let i=0;i<meta.length;i+=30){
  const part=meta.slice(i,i+30).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const row of rows){
    const b=row.bars; if(!b||b.length<120)continue;
    const c=b.map(x=>x[4]), v=b.map(x=>x[5]);
    for(let k=25;k<b.length-MAXH-1;k++){
      if(!(c[k]>0))continue;
      const w=c.slice(k-20,k); const m20=mean(w), s20=sdv(w);
      if(!(s20>0)||!(c[k]<m20-2*s20))continue;                      // below the lower band
      let dv=0,n=0; for(let j=k-21;j<k;j++) if(c[j]>0&&v[j]>0){dv+=c[j]*v[j];n++;}
      if(!n||dv/n<DV_MIN)continue;                                   // LIQUIDITY FLOOR
      let atr=0,an=0;
      for(let j=k-13;j<=k;j++){const t=Math.max(b[j][2]-b[j][3],Math.abs(b[j][2]-c[j-1]),Math.abs(b[j][3]-c[j-1]));
        if(Number.isFinite(t)){atr+=t;an++;}}
      if(!an)continue;
      const R=2*(atr/an);                                            // 2ATR = 1R, as specified
      if(!(R>0))continue;
      const stopPx=c[k]-R, tgtPx=c[k]+3*R;                           // -1R stop, +3R target
      const d=new Date(b[k][0]*1000).toISOString().slice(0,10);
      let ex:number|null=null;
      for(let q=1;q<=MAXH;q++){
        const hi=b[k+q][2], lo=b[k+q][3];
        if(lo<=stopPx){ ex=stopPx; break; }                          // stop assumed first when both touched (pessimistic)
        if(hi>=tgtPx){ ex=tgtPx; break; }
      }
      if(ex===null) ex=c[k+MAXH];
      if(!(ex>0))continue;
      tr.push({d,r:(ex/c[k]-1)-FEE_BP/1e4, bh:c[k+MAXH]/c[k]-1});    // bh = simply holding the SAME name, same window
    }
  }
  if(i%900===0)Deno.stderr.write(new TextEncoder().encode(`  ..${i}/${meta.length} n=${tr.length}\r`));
}
console.log("");
if(tr.length<500){console.error("!! too few signals");Deno.exit(1);}
const rs=tr.map(x=>x.r), bh=tr.map(x=>x.bh), ex=tr.map(x=>x.r-x.bh);
const byDay=new Map<string,number[]>(), byDayEx=new Map<string,number[]>();
for(const t of tr){(byDay.get(t.d)??byDay.set(t.d,[]).get(t.d)!).push(t.r);(byDayEx.get(t.d)??byDayEx.set(t.d,[]).get(t.d)!).push(t.r-t.bh);}
const dd=[...byDay.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([,v])=>mean(v));
const de=[...byDayEx.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([,v])=>mean(v));
const tstat=(a:number[])=>mean(a)/(sdv(a)/Math.sqrt(a.length));
console.log(`    signals: ${tr.length.toLocaleString()} across ${dd.length.toLocaleString()} distinct entry days`);
console.log(`    ${"view".padEnd(34)}${"mean".padEnd(12)}${"t".padEnd(9)}n`);
console.log(`    ${"TRADE-level, raw".padEnd(34)}${((mean(rs)*100).toFixed(3)+"%").padEnd(12)}${tstat(rs).toFixed(2).padEnd(9)}${rs.length}`);
console.log(`    ${"TRADE-level, vs buy-and-hold".padEnd(34)}${((mean(ex)*100).toFixed(3)+"%").padEnd(12)}${tstat(ex).toFixed(2).padEnd(9)}${ex.length}`);
console.log(`    ${"PORTFOLIO (per entry-day), raw".padEnd(34)}${((mean(dd)*100).toFixed(3)+"%").padEnd(12)}${tstat(dd).toFixed(2).padEnd(9)}${dd.length}`);
console.log(`    ${"PORTFOLIO, vs buy-and-hold".padEnd(34)}${((mean(de)*100).toFixed(3)+"%").padEnd(12)}${tstat(de).toFixed(2).padEnd(9)}${de.length}`);
console.log(`\n    buy-and-hold over the same windows: ${(mean(bh)*100).toFixed(3)}% per signal.`);
console.log(`    The rule can only claim the EXCESS over holding the same name. Deflated ceiling for this program: t ~ 5.34.`);
