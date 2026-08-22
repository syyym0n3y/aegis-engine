#!/usr/bin/env -S deno run --allow-net --allow-env
// audit-btc5m.ts (D-468) — the LAST unaudited claim: BTC/5m/short, "the ONE strategy that cleared every gate" (D-170,
// t=8.07, both-halves, OOS, fee-laddered). Its equity twin (rip-short: same RSI>70-below-200MA family) was REFUTED by
// portfolio accounting; its stated viable execution ("patient maker fills ~1-2bp") is a maker assumption that was never
// fill-tested — now forbidden by the EXECUTION LAW. The rule logic below is copied VERBATIM from
// supabase/functions/_shared/trd-forward-setup.ts (Wilder RSI, ATR sma, stop-first pessimistic), so any divergence in
// results is the data window or the accounting, never the rule.
// WHAT THE ORIGINAL COUNTED: detectTrades fires on EVERY qualifying bar — an RSI>70 streak stacks many overlapping,
// near-identical trades that are counted as independent. That is the exact clustering that flipped rip-short's sign.
// This audit reports: (a) exact replication as-counted; (b) ONE-AT-A-TIME (the tradable version — no new entry while a
// position is open); (c) DAILY-aggregated portfolio t (n = days, the honest denominator); (d) per-era; (e) the fee
// ladder at real tiers; (f) the EXECUTION-LAW maker test — a sell-limit at next-bar open fills only if that bar's HIGH
// reaches it; return conditional on fill vs the fills you miss.
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
type Bar={ts:number;o:number;h:number;l:number;c:number};
// ---- verbatim indicator logic (trd-forward-setup.ts) ----
function atr(b:Bar[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));
  const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;
  for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);
    if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}
    else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;
  for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
// ---- data: full Binance spot 5m history ----
console.log("==> AUDIT: BTC/5m/short (D-170) — fetching full spot 5m history");
const bars:Bar[]=[]; let start=Date.parse("2017-08-17T00:00:00Z");
for(let g=0;g<1400;g++){
  const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${start}&limit=1000`).then(x=>x.json()).catch(()=>null);
  await sleep(100);
  if(!Array.isArray(r)||!r.length)break;
  for(const k of r as (string|number)[][]){const ts=Math.floor(Number(k[0])/1000);
    if(bars.length&&ts<=bars[bars.length-1].ts)continue;
    bars.push({ts,o:+k[1],h:+k[2],l:+k[3],c:+k[4]});}
  if(r.length<1000)break; start=Number((r[r.length-1] as (string|number)[])[0])+1;
}
console.log(`    ${bars.length.toLocaleString()} bars  ${new Date(bars[0].ts*1000).toISOString().slice(0,10)} .. ${new Date(bars[bars.length-1].ts*1000).toISOString().slice(0,10)}`);
if(bars.length<500_000){console.error("!! short history — UNTESTED, not null");Deno.exit(1);}
const cl=bars.map(b=>b.c), A=atr(bars,14), R=rsi(cl,14), MA=sma(cl,200);
type T={ei:number;entryTs:number;netR:(fee:number)=>number;grossR:number;stopFrac:number;entry:number;sigClose:number};
function run(oneAtATime:boolean){
  const out:T[]=[]; let busyUntil=-1;
  for(let i=201;i<bars.length-1;i++){
    if(!(A[i]>0)||!(MA[i]>0)||!Number.isFinite(R[i]))continue;
    if(!(R[i]>70&&cl[i]<MA[i]))continue;
    const sd=2*A[i]; if(!(sd>bars[i].c*1e-4))continue;
    if(oneAtATime&&i+1<=busyUntil)continue;
    const entry=bars[i+1].o, stop=entry+sd, target=entry-3*sd;
    let grossR:number|null=null, held=0;
    const last=Math.min(i+144,bars.length-1);
    for(let k=i+1;k<=last;k++){
      if(bars[k].h>=stop){grossR=-1;held=k-i;break;}                    // pessimistic: stop first
      if(bars[k].l<=target){grossR=3;held=k-i;break;}
    }
    if(grossR===null){grossR=-(bars[last].c-entry)/sd;held=last-i;}
    if(oneAtATime)busyUntil=i+held;
    const stopFrac=sd/entry;
    out.push({ei:i,entryTs:bars[i+1].ts,grossR,stopFrac,entry,sigClose:cl[i],netR:(feeSide:number)=>grossR!-(feeSide/1e4*2)/stopFrac});
  }
  return out;
}
const CEIL=5.34;
const era=(ts:number)=>{const y=new Date(ts*1000).getUTCFullYear();return y<=2020?"2017-2020":y<=2022?"2021-2022":y<=2024?"2023-2024":"2025-2026";};
function report(label:string,tr:T[],feeSide:number){
  const r=tr.map(t=>t.netR(feeSide));
  const m=mean(r),sd=sdv(r)||1e-9,t=m/(sd/Math.sqrt(r.length));
  // daily portfolio view: sum R per UTC day, t over days with activity
  const byDay=new Map<string,number>();
  for(let i=0;i<tr.length;i++){const d=new Date(tr[i].entryTs*1000).toISOString().slice(0,10);byDay.set(d,(byDay.get(d)||0)+r[i]);}
  const dd=[...byDay.values()],md=mean(dd),sdd=sdv(dd)||1e-9;
  console.log(`    ${label.padEnd(30)} trades ${String(tr.length).padStart(6)}  mean ${m>=0?"+":""}${m.toFixed(3)}R  trade-t ${t.toFixed(2).padStart(6)}  |  days ${dd.length}  portfolio-t ${(md/(sdd/Math.sqrt(dd.length))).toFixed(2).padStart(6)}`);
  return {m,t,portT:md/(sdd/Math.sqrt(dd.length))};
}
console.log(`\n    ---- (a) EXACT replication: overlapping fires, 5bp/side (the D-170 headline configuration) ----`);
const over=run(false); report("as-counted (overlapping)",over,5);
console.log(`\n    ---- (b) ONE-AT-A-TIME (tradable) + (c) daily portfolio t, fee ladder ----`);
const one=run(true);
for(const f of [0,2,4.5,5,7.5,10]) report(`one-at-a-time @${f}bp/side`,one,f);
console.log(`\n    ---- (d) per-era, one-at-a-time @4.5bp/side (Binance futures taker) ----`);
for(const e of ["2017-2020","2021-2022","2023-2024","2025-2026"]){
  const g=one.filter(t=>era(t.entryTs)===e); if(g.length<30){console.log(`    ${e}: (thin, n=${g.length})`);continue;}
  report(`  ${e}`,g,4.5);
}
console.log(`\n    ---- (f) EXECUTION LAW: the "patient maker ~1-2bp" assumption, fill-tested ----`);
// FIRST DESIGN WAS VACUOUS AND WAS CAUGHT PRE-RUN: "fill iff entry-bar high >= entry-bar open" is ALWAYS true (a bar's
// high is >= its open by definition) — 100% fill rate, measuring nothing. Honest design, mirroring D-448: the maker rests
// a sell-limit at the SIGNAL bar's CLOSE (the last price seen when deciding). It fills only if the entry bar's HIGH trades
// back up to that level; the whole trade is then re-simulated from that entry (same ATR stop distance, stop-first).
let filled=0; const fillR:number[]=[], missGross:number[]=[];
for(const t of one){
  const i=t.ei, eb=bars[i+1], lim=t.sigClose, sd=t.stopFrac*t.entry;
  if(eb.h>=lim){
    filled++;
    const stop=lim+sd, target=lim-3*sd;
    let g:number|null=null; const last=Math.min(i+144,bars.length-1);
    for(let k=i+1;k<=last;k++){
      if(bars[k].h>=stop){g=-1;break;}
      if(bars[k].l<=target){g=3;break;}
    }
    if(g===null)g=-(bars[Math.min(i+144,bars.length-1)].c-lim)/sd;
    fillR.push(g-(1/1e4*2)/(sd/lim));                                   // 1bp/side maker, both legs
  } else missGross.push(t.netR(0));                                     // the trade you never got
}
console.log(`    fill rate ${(100*filled/one.length).toFixed(1)}%  |  net on FILLED trades @1bp/side maker: ${fillR.length?`${mean(fillR)>=0?"+":""}${mean(fillR).toFixed(3)}R (t ${(mean(fillR)/(sdv(fillR)/Math.sqrt(fillR.length))).toFixed(2)}, n=${fillR.length})`:"-"}`);
console.log(`    mean gross R of the trades you MISS by resting: ${missGross.length?mean(missGross).toFixed(3):"-"}R (n=${missGross.length})`);
console.log(`\n    Deflated ceiling for this program: t ~ ${CEIL} (D-363/364). The PORTFOLIO t decides (D-451).`);
