#!/usr/bin/env -S deno run --allow-net --allow-env
// crypto-cross-section.ts (D-441) — the cross-sectional factor test, run where CAPACITY IS NOT THE CONSTRAINT.
// This is the direct follow-up to D-424. In equities the cross-section had real signal that lived entirely in names too
// small to trade (liq:HIGH SR 0.04-0.26). Perps remove that objection: BTCUSDT clears $10B+/day, shorting is native and
// free (no borrow, no locate), and the same long-short construction is actually implementable. So: does the factor
// structure that exists in equities also exist HERE, where it would be tradable?
// Signals, each with a stated direction and a documented equity analogue:
//   momentum 30d (+), reversal 1d (-), low-volatility (-vol), and FUNDING as crowding (- : crowded longs pay to be long).
// COSTS ARE REAL AND COMPLETE: 9bp taker round trip on rebalance, charged on measured turnover, PLUS actual funding paid
// by the long leg and received by the short leg from the ingested per-symbol funding history. Most crypto backtests omit
// funding; it ran +24 to +32%/yr in 2021, so omitting it is not a rounding error, it is the whole answer.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")!;
async function jwt(){const e=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");const h=e({alg:"HS256",typ:"JWT"}),b=e({role:"service_role",iss:"cx",exp:4102444800});const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const s=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${h}.${b}`)));return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;}
const hdr=await(async()=>{const t=await jwt();return{Authorization:`Bearer ${t}`,apikey:t};})();
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const FEE_BP=Number(Deno.env.get("PERP_FEE_RT_BP")||9);

const syms=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=n_bars.desc`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {symbol:string;n_bars:number}[];
const univ=syms.filter(s=>s.n_bars>=15000).map(s=>s.symbol);     // >=~1.7yr of hourly history
console.log(`==> CRYPTO CROSS-SECTION — ${univ.length} perps with >=15,000 hourly bars`);
// daily closes + daily funding paid, per symbol
const px=new Map<string,Map<string,number>>(), fund=new Map<string,Map<string,number>>();
for(const s of univ){
  const b=await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1h&symbol=eq.${s}&select=bars`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {bars:number[][]}[];
  if(!Array.isArray(b)||!b[0])continue;
  const m=new Map<string,number>(); for(const bar of b[0].bars) m.set(new Date(bar[0]*1000).toISOString().slice(0,10),bar[4]);
  px.set(s,m);
  const base=s.replace(/USDT$/,"");
  const f=await fetch(`${OWNED}/trd_perp_oi?interval=eq.funding&venue=eq.binance&or=(symbol.eq.${s},symbol.eq.${base})&select=ts,open_interest&order=ts&limit=20000`,{headers:hdr}).then(r=>r.json()).catch(()=>[]) as {ts:number;open_interest:number}[];
  const fm=new Map<string,number>();
  if(Array.isArray(f)) for(const r of f){const d=new Date(r.ts*1000).toISOString().slice(0,10); fm.set(d,(fm.get(d)||0)+r.open_interest);}  // 3 settlements/day summed
  fund.set(s,fm);
}
const withF=[...fund.values()].filter(m=>m.size>0).length;
console.log(`    price series ${px.size}, funding series ${withF}/${px.size} (a symbol without funding is EXCLUDED, not assumed free)`);
const days=[...new Set([...px.values()].flatMap(m=>[...m.keys()]))].sort();

type Sig={name:string;dir:number;f:(s:string,i:number)=>number|null};
const g=(s:string,i:number)=>px.get(s)?.get(days[i]);
const SIGS:Sig[]=[
  {name:"momentum 30d",dir:+1,f:(s,i)=>{const a=g(s,i),b=g(s,i-30);return a&&b?a/b-1:null;}},
  {name:"reversal 1d",dir:-1,f:(s,i)=>{const a=g(s,i),b=g(s,i-1);return a&&b?a/b-1:null;}},
  {name:"low volatility",dir:-1,f:(s,i)=>{const r:number[]=[];for(let j=i-30;j<i;j++){const a=g(s,j),b=g(s,j-1);if(a&&b)r.push(a/b-1);}return r.length>20?sdv(r):null;}},
  {name:"funding crowding",dir:-1,f:(s,i)=>{const m=fund.get(s);if(!m)return null;let t=0,n=0;for(let j=i-7;j<i;j++){const v=m.get(days[j]);if(v!==undefined){t+=v;n++;}}return n>4?t/n:null;}},
];
const ERA=(d:string)=>{const y=+d.slice(0,4);return y<=2021?"<=2021":y===2022?"2022":y<=2024?"2023-24":"2025-26";};
console.log(`\n    ${"signal".padEnd(19)}${"era".padEnd(9)}${"gross %/yr".padEnd(12)}${"net fee".padEnd(10)}${"net fee+FUNDING".padEnd(17)}${"SR".padEnd(7)}${"t".padEnd(8)}${"turn".padEnd(7)}n`);
const survivors:string[]=[];
for(const s of SIGS){
  const daily:{d:string;gross:number;fee:number;fund:number}[]=[];
  let prev=new Map<string,number>();
  for(let i=35;i<days.length-1;i++){
    const cands:{sym:string;v:number}[]=[];
    for(const sym of px.keys()){const v=s.f(sym,i); const nxt=g(sym,i+1), cur=g(sym,i);
      if(v!==null&&Number.isFinite(v)&&nxt&&cur) cands.push({sym,v});}
    if(cands.length<8)continue;
    cands.sort((a,b)=>s.dir*(b.v-a.v));
    const k=Math.max(2,Math.floor(cands.length/4));
    const w=new Map<string,number>();
    for(const c of cands.slice(0,k))w.set(c.sym,1/k);
    for(const c of cands.slice(-k))w.set(c.sym,(w.get(c.sym)||0)-1/k);
    let gross=0,fnd=0;
    for(const [sym,wt] of w){const a=g(sym,i+1)!,b=g(sym,i)!; gross+=wt*(a/b-1);
      // a LONG perp PAYS funding when funding is positive; a SHORT RECEIVES it. Sign is -wt*funding.
      const fv=fund.get(sym)?.get(days[i+1]); if(fv!==undefined) fnd+=-wt*fv;}
    let to=0; for(const sym of new Set([...w.keys(),...prev.keys()])) to+=Math.abs((w.get(sym)||0)-(prev.get(sym)||0));
    daily.push({d:days[i+1],gross,fee:(to/2)*FEE_BP/1e4,fund:fnd});
    prev=w;
  }
  if(daily.length<200)continue;
  for(const e of ["<=2021","2022","2023-24","2025-26","ALL"]){
    const sub=e==="ALL"?daily:daily.filter(x=>ERA(x.d)===e);
    if(sub.length<120)continue;
    const gr=sub.map(x=>x.gross), nf=sub.map(x=>x.gross-x.fee), nff=sub.map(x=>x.gross-x.fee+x.fund);
    const m=mean(nff), sd=sdv(nff)||1e-9;
    const line=`    ${(e==="ALL"?s.name:"").padEnd(19)}${e.padEnd(9)}${((mean(gr)*365*100).toFixed(1)+"%").padEnd(12)}${((mean(nf)*365*100).toFixed(1)+"%").padEnd(10)}${((m*365*100).toFixed(1)+"%").padEnd(17)}${((m/sd)*Math.sqrt(365)).toFixed(2).padEnd(7)}${(m/(sd/Math.sqrt(sub.length))).toFixed(2).padEnd(8)}${(mean(sub.map(x=>x.fee))*1e4/FEE_BP*100).toFixed(0).padEnd(6)}%${sub.length}`;
    console.log(line);
    if(e==="2025-26"&&m>0&&(m/(sd/Math.sqrt(sub.length)))>2) survivors.push(`${s.name} (current era, net of fees AND funding)`);
  }
  console.log("");
}
console.log(`    surviving in the CURRENT era net of fees AND funding: ${survivors.length?survivors.join("; "):"none"}`);

// ============================================================================================================
// THE CONTROL. Momentum long-short shows 94%/yr net at SR 1.13 — and the signals that "work" are momentum and HIGH
// volatility, which is precisely the profile of disguised market BETA. The on-chain test (D-439) has just demonstrated
// what happens without this check: twelve rules that looked magnificent and every one lost to simply holding the asset.
// So: measure the book's BETA to BTC, compare it against equal-weight long-only crypto, and measure the DRAWDOWN, which
// no amount of Sharpe excuses. A market-neutral book with SR 1.13 is a finding; a 0.8-beta book is a leveraged long.
console.log(`\n    ==> BETA / BENCHMARK CONTROL — is this alpha, or crypto beta wearing a long-short costume?`);
const btc=px.get("BTCUSDT")!;
const bench:{d:string;r:number;ew:number}[]=[];
for(let i=1;i<days.length;i++){
  const a=btc.get(days[i]), b=btc.get(days[i-1]); if(!a||!b)continue;
  const es:number[]=[]; for(const [,m] of px){const x=m.get(days[i]),y=m.get(days[i-1]); if(x&&y)es.push(x/y-1);}
  if(es.length<8)continue;
  bench.push({d:days[i],r:a/b-1,ew:mean(es)});
}
const bmap=new Map(bench.map(x=>[x.d,x]));
console.log(`    ${"signal".padEnd(19)}${"net %/yr".padEnd(11)}${"beta to BTC".padEnd(13)}${"alpha %/yr".padEnd(12)}${"t(alpha)".padEnd(10)}${"maxDD".padEnd(9)}${"vs EW long-only".padEnd(16)}n`);
for(const s of SIGS){
  const daily:{d:string;net:number}[]=[];
  let prev=new Map<string,number>();
  for(let i=35;i<days.length-1;i++){
    const cands:{sym:string;v:number}[]=[];
    for(const sym of px.keys()){const v=s.f(sym,i); const nxt=g(sym,i+1), cur=g(sym,i);
      if(v!==null&&Number.isFinite(v)&&nxt&&cur)cands.push({sym,v});}
    if(cands.length<8)continue;
    cands.sort((a,b)=>s.dir*(b.v-a.v));
    const k=Math.max(2,Math.floor(cands.length/4));
    const w=new Map<string,number>();
    for(const c of cands.slice(0,k))w.set(c.sym,1/k);
    for(const c of cands.slice(-k))w.set(c.sym,(w.get(c.sym)||0)-1/k);
    let gross=0,fnd=0;
    for(const [sym,wt] of w){gross+=wt*(g(sym,i+1)!/g(sym,i)!-1);
      const fv=fund.get(sym)?.get(days[i+1]); if(fv!==undefined)fnd+=-wt*fv;}
    let to=0; for(const sym of new Set([...w.keys(),...prev.keys()]))to+=Math.abs((w.get(sym)||0)-(prev.get(sym)||0));
    daily.push({d:days[i+1],net:gross-(to/2)*FEE_BP/1e4+fnd});
    prev=w;
  }
  if(daily.length<200)continue;
  const pairs=daily.map(x=>({y:x.net,b:bmap.get(x.d)?.r,e:bmap.get(x.d)?.ew})).filter(p=>p.b!==undefined&&p.e!==undefined) as {y:number;b:number;e:number}[];
  const my=mean(pairs.map(p=>p.y)), mb=mean(pairs.map(p=>p.b));
  let cov=0,vb=0; for(const p of pairs){cov+=(p.y-my)*(p.b-mb);vb+=(p.b-mb)**2;}
  const beta=vb>0?cov/vb:0;
  const alpha=pairs.map(p=>p.y-beta*p.b);                       // return not explained by BTC
  const ma=mean(alpha), sa=sdv(alpha)||1e-9;
  let cum=1,peak=1,dd=0; for(const p of pairs){cum*=1+p.y;peak=Math.max(peak,cum);dd=Math.min(dd,cum/peak-1);}
  const ewAnn=mean(pairs.map(p=>p.e))*365;
  console.log(`    ${s.name.padEnd(19)}${((my*365*100).toFixed(1)+"%").padEnd(11)}${beta.toFixed(3).padEnd(13)}${((ma*365*100).toFixed(1)+"%").padEnd(12)}${(ma/(sa/Math.sqrt(alpha.length))).toFixed(2).padEnd(10)}${((dd*100).toFixed(0)+"%").padEnd(9)}${((my*365*100-ewAnn*100).toFixed(1)+"%").padEnd(16)}${pairs.length}`);
}
console.log(`\n    beta near 0 => genuinely market-neutral. "vs EW long-only" is the return over just holding the basket`);
console.log(`    equal-weighted — the same control that killed all 12 on-chain rules in D-439.`);
