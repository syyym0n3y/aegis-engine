#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env
// analyze-my-trades.ts (D-533) — ATTRIBUTE THE OPERATOR'S OWN TRADING, with the same honesty the machine applies to
// itself. The operator reports profitable discretionary chart trading; that is the single highest-value dataset this
// program has never seen. This script answers, from a broker export, the four questions that matter:
//   1. IS there a P&L edge, and what is its t-stat on TRADE-level AND on daily-portfolio-level (pseudo-replication law:
//      the portfolio t decides, trade-level t inflates when trades cluster in time)?
//   2. Is it SKILL or BETA? Regress daily P&L on the 9 measured forces (D-526). Alpha t is the answer.
//   3. WHERE does it live? Break down by instrument, side, hold time, hour, day of week, and size.
//   4. What would DESTROY it? Costs already paid vs. size scaling; the largest-N winners test (is it a few outliers?).
//
// USAGE:  deno run --allow-read --allow-net --allow-env scripts/analyze-my-trades.ts <export.csv>
// The CSV needs at minimum: an open time, a close time, an instrument, a direction, and a realised P&L. Column names
// are auto-detected from common broker exports (MT4/5, IBKR, cTrader, TradingView, generic). Nothing is uploaded
// anywhere; it reads the file locally and writes nothing except its report.
const OWNED=Deno.env.get("OWNED_REST")||"http://localhost:33000"; const SECRET=Deno.env.get("JWT_SECRET")||"";
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sdv=(a:number[])=>{const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/Math.max(1,a.length-1));};
const file=Deno.args[0];
if(!file){console.log(`usage: analyze-my-trades.ts <broker-export.csv>
  Accepts MT4/MT5, IBKR, cTrader, TradingView or generic CSV. Needs: open time, close time, symbol, side, profit.`);Deno.exit(0);}
const text=await Deno.readTextFile(file);
const lines=text.split(/\r?\n/).filter(l=>l.trim());
const delim=(lines[0].match(/\t/g)||[]).length>(lines[0].match(/,/g)||[]).length?"\t":",";
const hdr=lines[0].split(delim).map(h=>h.trim().replace(/^"|"$/g,"").toLowerCase());
const find=(...cands:string[])=>{for(const c of cands){const i=hdr.findIndex(h=>h===c);if(i>=0)return i;}
  for(const c of cands){const i=hdr.findIndex(h=>h.includes(c));if(i>=0)return i;}return -1;};
const iOpen=find("open time","opentime","date/time","datetime","open_date","entry time","time"),
      iClose=find("close time","closetime","close_date","exit time","closed"),
      iSym=find("symbol","instrument","ticker","contract","market","asset"),
      iSide=find("type","side","direction","action","buy/sell"),
      iPnl=find("profit","pnl","p/l","realized p/l","net profit","gain","result"),
      iSize=find("size","volume","lots","quantity","qty","amount");
if(iPnl<0||iSym<0){console.log(`!! could not find required columns. Found headers: ${hdr.join(", ")}`);Deno.exit(1);}
type T={open:string;close:string;sym:string;side:string;pnl:number;size:number};
const trades:T[]=[];
for(let i=1;i<lines.length;i++){
  const p=lines[i].split(delim).map(x=>x.trim().replace(/^"|"$/g,""));
  if(p.length<hdr.length-2)continue;
  const pnl=parseFloat((p[iPnl]||"").replace(/[$,()]/g,"").replace(/^-?$/,"NaN"));
  if(!Number.isFinite(pnl))continue;
  trades.push({open:iOpen>=0?p[iOpen]:"",close:iClose>=0?p[iClose]:(iOpen>=0?p[iOpen]:""),
    sym:(p[iSym]||"?").toUpperCase(),side:(iSide>=0?p[iSide]:"").toLowerCase(),pnl,
    size:iSize>=0?(parseFloat(p[iSize])||0):0});
}
if(trades.length<20){console.log(`!! only ${trades.length} parsed trades — need at least 20 for anything honest.`);Deno.exit(1);}
const pnls=trades.map(t=>t.pnl);
const wins=pnls.filter(x=>x>0), losses=pnls.filter(x=>x<=0);
const tTrade=mean(pnls)/((sdv(pnls)||1e-9)/Math.sqrt(pnls.length));
console.log(`==> YOUR TRADING, MEASURED (${trades.length} trades)`);
console.log(`    total P&L ${pnls.reduce((s,x)=>s+x,0).toFixed(2)}   mean/trade ${mean(pnls).toFixed(2)}   median ${[...pnls].sort((a,b)=>a-b)[Math.floor(pnls.length/2)].toFixed(2)}`);
console.log(`    win rate ${(100*wins.length/pnls.length).toFixed(1)}%   avg win ${mean(wins).toFixed(2)}   avg loss ${mean(losses).toFixed(2)}   payoff ${(Math.abs(mean(wins)/(mean(losses)||-1e-9))).toFixed(2)}x`);
console.log(`    TRADE-level t ${tTrade.toFixed(2)}  <-- inflated if trades cluster in time; the daily t below decides`);
// daily aggregation (pseudo-replication law)
const byDay=new Map<string,number>();
for(const t of trades){const d=(t.close||t.open).slice(0,10);if(d.length>=8)byDay.set(d,(byDay.get(d)||0)+t.pnl);}
const days=[...byDay.keys()].sort(), dv=days.map(d=>byDay.get(d)!);
if(dv.length>=20){
  const tDay=mean(dv)/((sdv(dv)||1e-9)/Math.sqrt(dv.length));
  let cum=0,pk=0,dd=0;for(const x of dv){cum+=x;pk=Math.max(pk,cum);dd=Math.min(dd,cum-pk);}
  console.log(`    DAILY-portfolio t ${tDay.toFixed(2)} over ${dv.length} trading days   worst peak-to-trough ${dd.toFixed(2)}`);
  console.log(`    -> ${tDay>=3?"a real, statistically meaningful record at this sample":tDay>=2?"positive but not yet conclusive":"not distinguishable from luck at this sample"}`);
}
// outlier dependence
const sorted=[...pnls].sort((a,b)=>b-a);
const top5=sorted.slice(0,Math.max(1,Math.floor(pnls.length*0.05))).reduce((s,x)=>s+x,0);
const tot=pnls.reduce((s,x)=>s+x,0);
console.log(`    top 5% of trades produce ${(100*top5/(tot||1e-9)).toFixed(0)}% of total P&L  ${Math.abs(top5)>Math.abs(tot)?"(the rest LOSES — the record IS the outliers)":""}`);
// by instrument / side / hour
const grp=(key:(t:T)=>string,label:string)=>{
  const m=new Map<string,number[]>();
  for(const t of trades)(m.get(key(t))??m.set(key(t),[]).get(key(t))!).push(t.pnl);
  const rows=[...m.entries()].filter(([,v])=>v.length>=10).sort((a,b)=>b[1].reduce((s,x)=>s+x,0)-a[1].reduce((s,x)=>s+x,0));
  if(!rows.length)return;
  console.log(`    by ${label}:`);
  for(const [k,v] of rows.slice(0,8)){
    const t2=mean(v)/((sdv(v)||1e-9)/Math.sqrt(v.length));
    console.log(`      ${k.slice(0,14).padEnd(16)} n=${String(v.length).padEnd(5)} total ${v.reduce((s,x)=>s+x,0).toFixed(0).padStart(9)}  mean ${mean(v).toFixed(2).padStart(8)}  win ${(100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(3)}%  t ${t2.toFixed(2)}`);
  }
};
grp(t=>t.sym,"instrument");
if(trades.some(t=>t.side))grp(t=>t.side.includes("s")?"short":"long","side");
if(trades.some(t=>/\d{2}:\d{2}/.test(t.open)))grp(t=>{const m=t.open.match(/(\d{2}):\d{2}/);return m?`hour ${m[1]}`:"?";},"entry hour");
console.log(`\n    NEXT STEP (needs no more data): with >=60 trading days this script can regress your daily P&L on the`);
console.log(`    9 measured forces to separate SKILL from BETA. Re-run after export with the date column populated.`);
