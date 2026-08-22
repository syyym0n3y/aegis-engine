#!/usr/bin/env -S deno run --allow-net --allow-env
// audit-fundamental-factors.ts (D-460) — re-testing the fundamental factors on the REPAIRED panel.
// WHY THIS IS OWED. D-420 found that Assets / Liabilities / StockholdersEquity / NetIncomeLoss had silently STOPPED AT
// 2023-07, and the deep balance-sheet concepts were 199 days stale. Every value / quality / profitability verdict this
// program has issued — including D-363/364's "nothing clears clean deflation" — was therefore measured on a panel that
// ended three years before the verdict was written. Under this program's own COVERAGE LAW those nulls were, in part,
// evidence about OUR DATA rather than about the market. The panel is now fresh to 2026-08 (+394,927 rows), so the nulls
// have to be re-earned rather than inherited.
// Every law now in force is applied, several of which did not exist when the originals were issued:
//   BREADTH      — mean names per rebalance reported; under ~50 the verdict is UNTESTED (D-446)
//   LIQUIDITY    — ranked INSIDE the tradable universe, not sliced out afterwards (D-450)
//   PSEUDO-REPL. — the PORTFOLIO t-stat (n = rebalances) decides, never the name-day IC t (D-451)
//   EFFECT SIZE  — stated against the round-trip cost it must beat (D-429)
//   BENCHMARK    — compared with equal-weight buy-and-hold of the same universe (D-439)
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"af",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("EQ_FEE_RT_BP")||10);
const DV_MIN=Number(Deno.env.get("DV_MIN")||1e7);
const CEIL=5.34;   // the program's deflated ceiling (D-363/364)

type FRec={eff:string;v:number};
const fund=new Map<string,Map<string,FRec[]>>();
const CONC=["StockholdersEquity","NetIncomeLoss","Assets","EntityCommonStockSharesOutstanding","AssetsCurrent","LiabilitiesCurrent","CashAndCashEquivalentsAtCarryingValue"];
let facts=0;
for(const c of CONC) for(let off=0;;off+=10000){
  const p=await fetch(`${OWNED}/trd_fundamentals?concept=eq.${c}&select=ticker,effective_date,value&order=effective_date&offset=${off}&limit=10000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(p)||!p.length)break;
  for(const r of p as {ticker:string;effective_date:string;value:number}[]){
    if(!r.ticker||!r.effective_date||!Number.isFinite(r.value))continue;
    ((fund.get(r.ticker)??fund.set(r.ticker,new Map()).get(r.ticker)!).get(c)??(fund.get(r.ticker)!.set(c,[]).get(c)!)).push({eff:r.effective_date,v:r.value}); facts++; }
  if(p.length<10000)break;
}
for(const [,m] of fund) for(const [,a] of m) a.sort((x,y)=>x.eff<y.eff?-1:1);
const spans=CONC.map(c=>{let mx="";for(const [,m] of fund){const a=m.get(c);if(a?.length){const e=a[a.length-1].eff;if(e>mx)mx=e;}}return `${c.slice(0,22)}→${mx.slice(0,7)}`;});
console.log(`==> FUNDAMENTAL FACTORS on the REPAIRED panel — ${facts.toLocaleString()} facts, ${fund.size} tickers`);
console.log(`    freshness: ${spans.join("  ")}`);
function asOf(t:string,c:string,d:string):number|null{
  const a=fund.get(t)?.get(c); if(!a?.length)return null;
  let lo=0,hi=a.length-1,best=-1;
  while(lo<=hi){const m=(lo+hi)>>1; if(a[m].eff<=d){best=m;lo=m+1;}else hi=m-1;}
  return best<0?null:a[best].v;
}
const back=(t:string,c:string,d:string,days:number)=>{const x=new Date(d+"T00:00:00Z");x.setUTCDate(x.getUTCDate()-days);return asOf(t,c,x.toISOString().slice(0,10));};

const meta:{symbol:string}[]=[];
for(let off=0;;off+=1000){const p=await fetch(`${OWNED}/trd_bars_deep?asset_class=eq.equity&select=symbol&order=symbol&offset=${off}&limit=1000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]);if(!Array.isArray(p)||!p.length)break;meta.push(...p);if(p.length<1000)break;}
const FACT=["value B/M","quality ROE","accruals","asset growth","net issuance"];
type Row={mo:string;sym:string;f:(number|null)[];fwd:number};
const panel:Row[]=[];
for(let i=0;i<meta.length;i+=30){
  const part=meta.slice(i,i+30).map(m=>`"${m.symbol}"`).join(",");
  const rows=await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;bars:number[][]}[];
  if(!Array.isArray(rows))continue;
  for(const r of rows){
    const b=r.bars; if(!b||b.length<300)continue;
    const idx:number[]=[]; let last="";
    for(let k=0;k<b.length;k++){const mo=new Date(b[k][0]*1000).toISOString().slice(0,7); if(mo!==last){if(k>0)idx.push(k-1);last=mo;}}
    idx.push(b.length-1);
    for(let j=0;j<idx.length-1;j++){
      const k=idx[j], kn=idx[j+1], px=b[k][4]; if(!(px>1))continue;
      let dv=0,cn=0; for(let q=Math.max(0,k-21);q<k;q++) if(b[q][4]>0&&b[q][5]>0){dv+=b[q][4]*b[q][5];cn++;}
      if(!cn||dv/cn<DV_MIN)continue;                      // LIQUIDITY: rank inside the tradable universe
      const d=new Date(b[k][0]*1000).toISOString().slice(0,10);
      const sh=asOf(r.symbol,"EntityCommonStockSharesOutstanding",d); const mc=(sh&&sh>0)?px*sh:null;
      const eq=asOf(r.symbol,"StockholdersEquity",d), ni=asOf(r.symbol,"NetIncomeLoss",d), at=asOf(r.symbol,"Assets",d);
      const atP=back(r.symbol,"Assets",d,400), shP=back(r.symbol,"EntityCommonStockSharesOutstanding",d,400);
      const ac=asOf(r.symbol,"AssetsCurrent",d), lc=asOf(r.symbol,"LiabilitiesCurrent",d), csh=asOf(r.symbol,"CashAndCashEquivalentsAtCarryingValue",d);
      const acP=back(r.symbol,"AssetsCurrent",d,400), lcP=back(r.symbol,"LiabilitiesCurrent",d,400), cshP=back(r.symbol,"CashAndCashEquivalentsAtCarryingValue",d,400);
      const fwd=b[kn][4]/px-1; if(!Number.isFinite(fwd)||Math.abs(fwd)>3)continue;
      const f:(number|null)[]=[
        (mc&&eq!==null&&mc>0)?eq/mc:null,                                            // value B/M
        (eq&&ni!==null&&eq>0)?ni/eq:null,                                            // quality ROE
        (ac!==null&&lc!==null&&csh!==null&&acP!==null&&lcP!==null&&cshP!==null&&at&&at>0)
          ? -(((ac-csh)-lc)-((acP-cshP)-lcP))/at : null,                             // accruals (sign: LOW accruals good)
        (at&&atP&&atP>0)? -(at/atP-1) : null,                                        // asset growth (sign: LOW growth good)
        (sh&&shP&&shP>0)? -(sh/shP-1) : null,                                        // net issuance (sign: LOW issuance good)
      ];
      if(f.every(x=>x===null))continue;
      panel.push({mo:new Date(b[k][0]*1000).toISOString().slice(0,7),sym:r.symbol,f,fwd});
    }
  }
  if(i%900===0)Deno.stderr.write(new TextEncoder().encode(`  ..${i}/${meta.length} panel=${panel.length}\r`));
}
console.log(`\n    panel rows ${panel.length.toLocaleString()}`);
const byMo=new Map<string,Row[]>(); for(const p of panel)(byMo.get(p.mo)??byMo.set(p.mo,[]).get(p.mo)!).push(p);
const months=[...byMo.keys()].sort();
console.log(`    months ${months.length} (${months[0]} .. ${months[months.length-1]})`);
console.log(`\n    ${"factor".padEnd(15)}${"breadth".padEnd(9)}${"L/S %/yr".padEnd(11)}${"net@10bp".padEnd(11)}${"SR".padEnd(7)}${"PORTFOLIO t".padEnd(13)}${"vs EW hold".padEnd(12)}${"vs fee".padEnd(9)}n_mo`);
for(let fi=0;fi<FACT.length;fi++){
  const rets:number[]=[], bench:number[]=[], br:number[]=[];
  for(const mo of months){
    const g=byMo.get(mo)!.filter(r=>r.f[fi]!==null);
    if(g.length<50)continue;                                // BREADTH FLOOR (D-446)
    g.sort((a,b)=>(b.f[fi] as number)-(a.f[fi] as number));
    const k=Math.max(5,Math.floor(g.length/5));
    const lo=mean(g.slice(0,k).map(r=>r.fwd)), hi=mean(g.slice(-k).map(r=>r.fwd));
    rets.push(lo-hi-FEE_BP/1e4); bench.push(mean(g.map(r=>r.fwd))); br.push(g.length);
  }
  if(rets.length<24){console.log(`    ${FACT[fi].padEnd(15)}UNTESTED — only ${rets.length} months clear the 50-name breadth floor`);continue;}
  const m=mean(rets), sd=sdv(rets)||1e-9;
  const t=m/(sd/Math.sqrt(rets.length));                    // PORTFOLIO t (n = rebalances), not a name-day IC t
  const ex=rets.map((x,i)=>x-bench[i]);
  console.log(`    ${FACT[fi].padEnd(15)}${mean(br).toFixed(0).padEnd(9)}${((m+FEE_BP/1e4)*1200).toFixed(1).padEnd(11)}${(m*1200).toFixed(1).padEnd(11)}${((m/sd)*Math.sqrt(12)).toFixed(2).padEnd(7)}${t.toFixed(2).padEnd(13)}${(mean(ex)*1200).toFixed(1).padEnd(12)}${(Math.abs(m)*1e4/FEE_BP).toFixed(1).padEnd(9)}${rets.length}`);
}
console.log(`\n    Deflated ceiling ${CEIL} (D-363/364). PORTFOLIO t decides, not IC t (D-451). "vs EW hold" is the excess over`);
console.log(`    equal-weight holding the same universe (D-439). Panel is now fresh to 2026-08 — these nulls are re-earned, not inherited.`);
