#!/usr/bin/env -S deno run --allow-read
// trd-btc-exit — the operator's "make a ton on one candle" applied where it can matter: the ONE setup that
// beats random (BTC/5m/short, D-170). The S/R pass (D-172) proved the tail is real but untimed. Here we keep
// the SAME entry and vary only the EXIT, to see if letting the winner run captures more tail without killing
// the edge. All net of 5bp/side (the survival gate), vs a matched random control with the identical exit.
import { detectTrades, atr, rsi, sma, type Bar } from "../supabase/functions/_shared/trd-forward-setup.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const norm = (t: number) => t > 1e15 ? Math.floor(t / 1000) : t;
const raw: Bar[] = []; { const seen = new Set<number>(); for (const l of (await Deno.readTextFile("data/binance/BTCUSDT-1m.csv")).split("\n")) { const p = l.split(","); const t = norm(+p[0]); if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); raw.push({ ts: new Date(t).toISOString(), o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } raw.sort((a,b)=>a.ts<b.ts?-1:1); }
const bk = 5*60000, m = new Map<number, Bar>(); for (const x of raw) { const k = Math.floor(Date.parse(x.ts)/bk)*bk; const e = m.get(k); if(!e) m.set(k,{ts:new Date(k).toISOString(),o:x.o,h:x.h,l:x.l,c:x.c}); else {e.h=Math.max(e.h,x.h);e.l=Math.min(e.l,x.l);e.c=x.c;} }
const b = [...m.values()].sort((a,z)=>a.ts<z.ts?-1:1);
const cl = b.map(x=>x.c), at = atr(b,14), r14 = rsi(cl,14), ma = sma(cl,200);
const FEE = 5/10000, STOP_ATR = 2, MAXBARS = 144;
let seed = 999; const rnd = () => { seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };

// exit policies, all SHORT (dir=-1), entry at bar e open, stop = 2ATR. Returns net R (after 5bp round-trip).
type Exit = (e:number, entry:number, sd:number)=>number;
const fixed = (mult:number):Exit => (e,entry,sd) => { const stop=entry+sd, tgt=entry-sd*mult; for(let k=e;k<Math.min(e+MAXBARS,b.length);k++){ if(b[k].h>=stop) return -1; if(b[k].l<=tgt) return mult; } return (entry-b[Math.min(e+MAXBARS,b.length-1)].c)/sd; };
// trail: once price has moved `arm`×sd in favour, trail the stop `dist`×sd behind the best price
const trail = (arm:number, dist:number):Exit => (e,entry,sd) => { let best=entry, stop=entry+sd, armed=false; for(let k=e;k<Math.min(e+MAXBARS,b.length);k++){ if(b[k].l<best) best=b[k].l; const fav=(entry-best)/sd; if(fav>=arm) armed=true; if(armed) stop=Math.min(stop, best+dist*sd); if(b[k].h>=stop) return (entry-stop)/sd; } return (entry-b[Math.min(e+MAXBARS,b.length-1)].c)/sd; };

const policies: [string, Exit][] = [["fixed 3R", fixed(3)], ["fixed 5R", fixed(5)], ["fixed 10R", fixed(10)], ["trail 2R/1ATR", trail(2,0.5)], ["trail 3R/1ATR", trail(3,0.5)], ["trail 2R/2ATR", trail(2,1)]];
// entry indices = the D-170 short signals (RSI>70 & close<MA), and a random pool for control
const sigIdx:number[]=[], pool:number[]=[];
for(let i=201;i<b.length-1;i++){ if(!(at[i]>0)||!(ma[i]>0)) continue; pool.push(i); if(r14[i]>70 && cl[i]<ma[i] && (STOP_ATR*at[i])>b[i].c*1e-4) sigIdx.push(i); }
console.log(`BTC/5m/short EXIT STUDY — ${sigIdx.length} signals, ${(b.length*5/525600).toFixed(1)}y, all net 5bp/side, vs random control\n`);
console.log(`${"exit".padEnd(14)} ${"netR".padStart(7)} ${"win%".padStart(6)} ${"totalR".padStart(9)} ${"vs-rand t".padStart(9)}  verdict`);
for(const [nm,ex] of policies){
  const sig:number[]=[], ctrl:number[]=[];
  for(const i of sigIdx){ const sd=STOP_ATR*at[i], entry=b[i+1].o; const cost=(entry*FEE*2)/sd; sig.push(ex(i+1,entry,sd)-cost); }
  for(let q=0;q<sigIdx.length*2;q++){ const i=pool[Math.floor(rnd()*pool.length)]; const sd=STOP_ATR*at[i], entry=b[i+1].o; const cost=(entry*FEE*2)/sd; ctrl.push(ex(i+1,entry,sd)-cost); }
  const g=edgeVsRandom(sig,ctrl); const win=sig.filter(x=>x>0).length/sig.length*100; const tot=sig.reduce((a,c)=>a+c,0);
  const ok=g.passes&&g.setupMean>0;
  console.log(`${nm.padEnd(14)} ${((g.setupMean>=0?"+":"")+g.setupMean.toFixed(3)).padStart(7)} ${win.toFixed(0).padStart(6)} ${(tot>=0?"+":"")+tot.toFixed(0).padStart(8)} ${g.tStat.toFixed(2).padStart(9)}  ${ok?"✓ edge":"✗"}`);
}
console.log(`\nREAD: netR is per-trade after cost; totalR is cumulative over all signals. If a runner exit RAISES total R`);
console.log(`while staying t>2 vs random, the "one big candle" is real AND harvestable on THIS entry. If it lowers it,`);
console.log(`the fat tail is noise the fixed 3R was right to bank.`);
