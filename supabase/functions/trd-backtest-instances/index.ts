// trd-backtest-instances — per-INSTANCE backtests over MAX history (D-251), not pooled. Runs the surviving edges on
// long-history liquid instruments with the EXACT executor geometry (2ATR stop = −1R, 3R target, 20-bar max hold) so
// the backtest predicts live behaviour. Full trade accounting per (instrument, edge): trades, win%, expectancy R,
// total R, profit factor, max drawdown. This is the tradeable equity-curve view, not the vs-random skill metric. No orders.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const MA=200,RSIN=14,ATRN=14,BB=20,DON=20,STOP=2,TP=3,HOLD=20,START=252;
const INSTR=["SPY","QQQ","DIA","IWM","AAPL","MSFT","IBM","INTC","CSCO","ORCL","JNJ","KO","PG","XOM","CVX","JPM","WMT","GE","MCD","HD","DIS","T","VZ","MMM","CAT","BA","AXP","GS","C","AMGN"];
interface Bar{h:number;l:number;c:number}
async function bars(sym:string):Promise<Bar[]|null>{
  const now=Math.floor(Date.now()/1000);
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${now}`; // period1=0 = full history
  for(let attempt=0;attempt<3;attempt++){try{
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
    if(r.status===429||r.status>=500){await new Promise(res=>setTimeout(res,400*(attempt+1)));continue;}  // throttle → back off + retry
    if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
    const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({h,l,c});}
    return o;}catch{await new Promise(res=>setTimeout(res,400));}}
  return null;}
function sma(c:number[],W:number){const o=new Float64Array(c.length);let s=0;for(let i=0;i<c.length;i++){s+=c[i];if(i>=W)s-=c[i-W];o[i]=i>=W-1?s/W:NaN;}return o;}
function rsiArr(c:number[],P:number){const o=new Float64Array(c.length).fill(NaN);let ag=0,al=0;for(let i=1;i<c.length;i++){const ch=c[i]-c[i-1];ag+=Math.max(ch,0);al+=Math.max(-ch,0);if(i>P){const p=c[i-P]-c[i-P-1];ag-=Math.max(p,0);al-=Math.max(-p,0);}if(i>=P)o[i]=100-100/(1+(ag/P)/((al/P)||1e-9));}return o;}
function roll(a:number[],W:number,mode:"max"|"min"){const out=new Float64Array(a.length).fill(NaN);const dq:number[]=[];for(let i=0;i<a.length;i++){while(dq.length&&dq[0]<i-W)dq.shift();out[i]=dq.length?a[dq[0]]:NaN;const cmp=mode==="max"?(x:number,y:number)=>x<=y:(x:number,y:number)=>x>=y;while(dq.length&&cmp(a[dq[dq.length-1]],a[i]))dq.pop();dq.push(i);}return out;}
// bracket-geometry R for a trade entered at i (dir +1 long / -1 short): stop=∓2ATR (−1R), target=±3R, else exit at HOLD
function tradeR(b:Bar[],i:number,e:number,sd:number,dir:number){const stop=e-dir*sd,tgt=e+dir*sd*TP,end=Math.min(i+HOLD,b.length-1);
  for(let k=i+1;k<=end;k++){if(dir>0){if(b[k].l<=stop)return -1;if(b[k].h>=tgt)return TP;}else{if(b[k].h>=stop)return -1;if(b[k].l<=tgt)return TP;}}
  return dir*(b[end].c-e)/sd;}
// capped-stop (the VALIDATED rip-short geometry): −1R stop, NO target, unbounded upside, exit at HOLD
function cappedR(b:Bar[],i:number,e:number,sd:number,dir:number){const stop=e-dir*sd,end=Math.min(i+HOLD,b.length-1);
  for(let k=i+1;k<=end;k++){if(dir>0?b[k].l<=stop:b[k].h>=stop)return -1;}
  return dir*(b[end].c-e)/sd;}
function stats(rs:number[]){const n=rs.length;if(!n)return null;const wins=rs.filter(r=>r>0),losses=rs.filter(r=>r<=0);
  const sum=rs.reduce((a,x)=>a+x,0);const gw=wins.reduce((a,x)=>a+x,0),gl=Math.abs(losses.reduce((a,x)=>a+x,0));
  let cum=0,peak=0,dd=0;for(const r of rs){cum+=r;if(cum>peak)peak=cum;if(peak-cum>dd)dd=peak-cum;}
  return {trades:n,win_pct:+(wins.length/n*100).toFixed(1),expectancy_r:+(sum/n).toFixed(4),total_r:+sum.toFixed(1),
    avg_win_r:+(wins.length?gw/wins.length:0).toFixed(3),avg_loss_r:+(losses.length?-gl/losses.length:0).toFixed(3),
    profit_factor:+(gl>0?gw/gl:gw>0?99:0).toFixed(2),max_dd_r:+dd.toFixed(1)};}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const rows:Record<string,unknown>[]=[];const summ:Record<string,number[]>={bblo_long:[],rip_short:[],rip_short_capped:[],rsi2_long:[],bo20_long:[]};let loaded=0;
  for(const sym of INSTR){const b=await bars(sym);if(!b||b.length<START+HOLD+5)continue;loaded++;const c=b.map(x=>x.c),n=b.length;const years=+(n/252).toFixed(1);
    const ma200=sma(c,MA),ma20=sma(c,BB),rsi14=rsiArr(c,RSIN),rsi2=rsiArr(c,2);
    const atr=new Float64Array(n).fill(NaN);{let s=0;for(let i=1;i<n;i++){const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));s+=tr;if(i>ATRN){const p=Math.max(b[i-ATRN].h-b[i-ATRN].l,Math.abs(b[i-ATRN].h-b[i-ATRN-1].c),Math.abs(b[i-ATRN].l-b[i-ATRN-1].c));s-=p;}if(i>=ATRN)atr[i]=s/ATRN;}}
    const bbStd=new Float64Array(n).fill(NaN);{let s=0,ss=0;for(let i=0;i<n;i++){s+=c[i];ss+=c[i]*c[i];if(i>=BB){s-=c[i-BB];ss-=c[i-BB]*c[i-BB];}if(i>=BB-1){const m=s/BB;bbStd[i]=Math.sqrt(Math.max(ss/BB-m*m,0));}}}
    const donH=roll(b.map(x=>x.h),DON,"max");
    const R:Record<string,number[]>={bblo_long:[],rip_short:[],rip_short_capped:[],rsi2_long:[],bo20_long:[]};
    for(let i=START;i<n-HOLD;i++){const sd=STOP*atr[i];if(!(sd>0))continue;const px=c[i],m=ma200[i];
      if(px<ma20[i]-2*bbStd[i])R.bblo_long.push(tradeR(b,i,px,sd,1));
      if(rsi14[i]>70&&px<m){R.rip_short.push(tradeR(b,i,px,sd,-1));R.rip_short_capped.push(cappedR(b,i,px,sd,-1));}
      if(rsi2[i]<5&&px>m)R.rsi2_long.push(tradeR(b,i,px,sd,1));
      if(px>donH[i])R.bo20_long.push(tradeR(b,i,px,sd,1));
    }
    for(const edge of Object.keys(R)){const st=stats(R[edge]);if(!st||st.trades<20)continue;rows.push({instrument:sym,edge,years,...st});summ[edge].push(st.expectancy_r);}
  }
  if(rows.length)await fetch(`${SB}/rest/v1/trd_backtest_instances?on_conflict=instrument,edge`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
  const mean=(a:number[])=>a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(4):null;
  const posPct=(a:number[])=>a.length?+(a.filter(x=>x>0).length/a.length*100).toFixed(0):null;
  const digest=Object.fromEntries(Object.entries(summ).map(([k,v])=>[k,{instances:v.length,mean_expectancy_r:mean(v),pct_positive:posPct(v)}]));
  return new Response(JSON.stringify({ok:true,instruments:INSTR.length,loaded,rows:rows.length,digest}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
