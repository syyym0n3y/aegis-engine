#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-robustness-dipbuy — the deferred D-184 sub-stone: is dip-buy HOURLY a robust plateau or an overfit spike?
// Mirror of trd-robustness.ts but for the hourly long setup (RSI<low & close>MA). Yahoo 1h, basket, real spread
// cost (long → no borrow), each variant vs matched random control, then PBO via CSCV. Completes robustness for
// BOTH survivors.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { pboCSCV, mean } from "../supabase/functions/_shared/trd-stats.ts";
const BASKET = ["SPY","QQQ","IWM","XLE","XLF","SMH","AAPL","NVDA","TSLA","AMD"];
const RSI_LOW = [25,30,35], MA_LEN = [100,200], STOP_ATR = [1.5,2,2.5], TP_MULT = [2,3,4]; // 54 variants
const ATRN=14, RSIN=14, MAX_HOLD=20, SPREAD_BPS=2;
let seed=99; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
interface B{t:number;o:number;h:number;l:number;c:number}
async function hourly(sym:string):Promise<B[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1h&range=2y`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json().catch(()=>null);const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const t=res.timestamp,q=res.indicators.quote[0],o:B[]=[];for(let i=0;i<t.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([O,h,l,c].some(x=>x==null||!Number.isFinite(x)))continue;o.push({t:t[i]*1000,o:O,h,l,c});}return o;}catch{return[];}}
function atr(b:B[],n:number){const tr:number[]=[];for(let i=0;i<b.length;i++)tr.push(i===0?b[i].h-b[i].l:Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c)));const o=new Array(b.length).fill(NaN);let s=0;for(let i=0;i<b.length;i++){s+=tr[i];if(i>=n)s-=tr[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function rsi(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let ag=0,al=0;for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;o[i]=100-100/(1+ag/(al||1e-9));}}else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;o[i]=100-100/(1+ag/(al||1e-9));}}return o;}
function sma(cl:number[],n:number){const o=new Array(cl.length).fill(NaN);let s=0;for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=n)s-=cl[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function simLong(b:B[],at:number[],i:number,stopAtr:number,tp:number):{r:number;month:string}|null{const sd=stopAtr*at[i];if(!(sd>b[i].c*1e-4)||i+1>=b.length)return null;const entry=b[i+1].o,stop=entry-sd,tgt=entry+sd*tp;let g:number|null=null;for(let k=i+1;k<Math.min(i+1+MAX_HOLD,b.length);k++){if(b[k].l<=stop){g=-1;break;}if(b[k].h>=tgt){g=tp;break;}}if(g===null)g=(b[Math.min(i+MAX_HOLD,b.length-1)].c-entry)/sd;const cost=(entry*(SPREAD_BPS/10000)*2)/sd;return{r:g-cost,month:new Date(b[i+1].t).toISOString().slice(0,7)};}
const data:Record<string,{b:B[];at:number[];r14:number[];smas:Record<number,number[]>}>={};
for(const sym of BASKET){const b=await hourly(sym);if(b.length<500)continue;const cl=b.map(x=>x.c);const smas:Record<number,number[]>={};for(const m of MA_LEN)smas[m]=sma(cl,m);data[sym]={b,at:atr(b,ATRN),r14:rsi(cl,RSIN),smas};}
console.log(`ROBUSTNESS + PBO — dip-buy HOURLY, ${Object.keys(data).length} names, real spread cost, 54 variants (Yahoo 1h/2y)\n`);
interface V{key:string;n:number;edge:number;t:number;monthly:Record<string,number[]>}
const variants:V[]=[];
for(const low of RSI_LOW)for(const maL of MA_LEN)for(const stopA of STOP_ATR)for(const tp of TP_MULT){const sig:number[]=[],ctrl:number[]=[];const monthly:Record<string,number[]>={};for(const sym of Object.keys(data)){const{b,at,r14,smas}=data[sym];const ma=smas[maL];const pool:number[]=[];for(let i=maL+1;i<b.length-MAX_HOLD-1;i++)if(at[i]>0&&ma[i]>0)pool.push(i);for(const i of pool){if(r14[i]<low&&b[i].c>ma[i]){const t=simLong(b,at,i,stopA,tp);if(t){sig.push(t.r);(monthly[t.month]??=[]).push(t.r);for(let q=0;q<2;q++){const j=pool[Math.floor(rnd()*pool.length)];const rc=simLong(b,at,j,stopA,tp);if(rc)ctrl.push(rc.r);}}}}}const g=edgeVsRandom(sig,ctrl);variants.push({key:`RSI<${low}/MA${maL}/${stopA}ATR/${tp}R`,n:sig.length,edge:g.edge,t:g.tStat,monthly});}
const positive=variants.filter(v=>v.edge>0),sig2=variants.filter(v=>v.t>=2&&v.edge>0),strong=variants.filter(v=>v.t>=3&&v.edge>0);
variants.sort((a,b)=>b.t-a.t);
console.log(`${"variant".padEnd(24)} ${"n".padStart(6)} ${"edgeR".padStart(8)} ${"t".padStart(7)}`);
for(const v of variants.slice(0,8))console.log(`${v.key.padEnd(24)} ${String(v.n).padStart(6)} ${((v.edge>=0?"+":"")+v.edge.toFixed(3)).padStart(8)} ${v.t.toFixed(2).padStart(7)}`);
console.log(`... (worst) ...`);
for(const v of variants.slice(-3))console.log(`${v.key.padEnd(24)} ${String(v.n).padStart(6)} ${((v.edge>=0?"+":"")+v.edge.toFixed(3)).padStart(8)} ${v.t.toFixed(2).padStart(7)}`);
console.log(`\nPLATEAU CHECK: ${positive.length}/54 positive; ${sig2.length}/54 t>=2; ${strong.length}/54 t>=3.`);
const allMonths=[...new Set(variants.flatMap(v=>Object.keys(v.monthly)))].sort();
const M:number[][]=allMonths.map(m=>variants.map(v=>v.monthly[m]?mean(v.monthly[m]):0));
const{pbo,nCombos}=pboCSCV(M,10);
console.log(`\nPBO via CSCV: ${(pbo*100).toFixed(0)}% over ${nCombos} splits, ${allMonths.length} months × ${variants.length} variants.`);
console.log(`VERDICT: ${sig2.length>=27&&pbo<0.5?"PLATEAU — robust":positive.length>=40&&pbo<0.5?"SIGN-ROBUST breadth edge (like rip-short D-184): real but modest per-name, PBO-clean":"FRAGILE — treat as tentative"}`);
