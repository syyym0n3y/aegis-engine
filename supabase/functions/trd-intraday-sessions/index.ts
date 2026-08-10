// trd-intraday-sessions — intraday (HOURLY) crypto/FX edge tests split by trading SESSION (D-249). ~22 crypto+FX
// majors, 2y of 1h bars. 8 setups; each fire tagged by its entry-bar UTC session (asia 0-7 / london 8-15 / ny 16-23);
// edge_r = meanR(setup in session) − meanR(session-matched random), currency-neutral capped-stop. Completes the
// timeframe×session map (the last untested cell). ?class=crypto|fx to split the work. NO order path.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const MA=50,RSIN=14,ATRN=14,BB=20,DON=20,STOP=2,HOLD=24,COST_R=0.03,MINFIRES=20,START=200;
const CRYPTO=["BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD","AVAX-USD","DOGE-USD","LINK-USD","DOT-USD","LTC-USD"];
const FX=["EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCAD=X","USDCHF=X","NZDUSD=X","EURGBP=X","EURJPY=X","GBPJPY=X"];
interface Bar{h:number;l:number;c:number;hr:number}
async function bars(sym:string):Promise<Bar[]|null>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1h&range=730d`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({h,l,c,hr:new Date(res.timestamp[i]*1000).getUTCHours()});}
  return o;}catch{return null;}}
const sess=(hr:number)=>hr<8?"asia":hr<16?"london":"ny";
function longR(b:Bar[],i:number,e:number,sd:number){const stop=e-sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].l<=stop)return -1;return (b[end].c-e)/sd;}
function shortR(b:Bar[],i:number,e:number,sd:number){const stop=e+sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].h>=stop)return -1;return (e-b[end].c)/sd;}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function roll(arr:number[],W:number,mode:"max"|"min"){const out=new Float64Array(arr.length).fill(NaN);const dq:number[]=[];for(let i=0;i<arr.length;i++){while(dq.length&&dq[0]<i-W)dq.shift();out[i]=dq.length?arr[dq[0]]:NaN;const cmp=mode==="max"?(a:number,x:number)=>a<=x:(a:number,x:number)=>a>=x;while(dq.length&&cmp(arr[dq[dq.length-1]],arr[i]))dq.pop();dq.push(i);}return out;}
function sma(c:number[],W:number){const o=new Float64Array(c.length);let s=0;for(let i=0;i<c.length;i++){s+=c[i];if(i>=W)s-=c[i-W];o[i]=i>=W-1?s/W:NaN;}return o;}
function rsiArr(c:number[],P:number){const o=new Float64Array(c.length).fill(NaN);let ag=0,al=0;for(let i=1;i<c.length;i++){const ch=c[i]-c[i-1];ag+=Math.max(ch,0);al+=Math.max(-ch,0);if(i>P){const p=c[i-P]-c[i-P-1];ag-=Math.max(p,0);al-=Math.max(-p,0);}if(i>=P)o[i]=100-100/(1+(ag/P)/((al/P)||1e-9));}return o;}
const SETUPS:[string,number][]=[["bblo_long",1],["bbhi_short",-1],["mr_short",-1],["mr_long",1],["rsi2_long",1],["rsi2_short",-1],["bo_long",1],["bd_short",-1]];
const SESSIONS=["all","asia","london","ny"];
async function analyze(sym:string,cls:string):Promise<Record<string,unknown>[]>{
  const b=await bars(sym);if(!b||b.length<START+HOLD+5)return [];const c=b.map(x=>x.c),n=b.length;
  const ma=sma(c,MA),ma20=sma(c,BB),rsi=rsiArr(c,RSIN),rsi2=rsiArr(c,2);
  const atr=new Float64Array(n).fill(NaN);{let s=0;for(let i=1;i<n;i++){const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));s+=tr;if(i>ATRN){const p=Math.max(b[i-ATRN].h-b[i-ATRN].l,Math.abs(b[i-ATRN].h-b[i-ATRN-1].c),Math.abs(b[i-ATRN].l-b[i-ATRN-1].c));s-=p;}if(i>=ATRN)atr[i]=s/ATRN;}}
  const bbStd=new Float64Array(n).fill(NaN);{let s=0,ss=0;for(let i=0;i<n;i++){s+=c[i];ss+=c[i]*c[i];if(i>=BB){s-=c[i-BB];ss-=c[i-BB]*c[i-BB];}if(i>=BB-1){const m=s/BB;bbStd[i]=Math.sqrt(Math.max(ss/BB-m*m,0));}}}
  const donH=roll(b.map(x=>x.h),DON,"max"),donL=roll(b.map(x=>x.l),DON,"min");
  // fires[setup][session] = R[]; validBySession[session] = indices for random control
  const fires:Record<string,Record<string,number[]>>={};for(const[k]of SETUPS){fires[k]={all:[],asia:[],london:[],ny:[]};}
  const valid:Record<string,number[]>={all:[],asia:[],london:[],ny:[]};
  const fire=(k:string,i:number,dir:number)=>{const sd=STOP*atr[i];if(!(sd>0))return;const R=(dir>0?longR(b,i,c[i],sd):shortR(b,i,c[i],sd))-COST_R;const s=sess(b[i].hr);fires[k].all.push(R);fires[k][s].push(R);};
  for(let i=START;i<n-HOLD;i++){const sd=STOP*atr[i];if(!(sd>0))continue;const px=c[i],m=ma[i],s=sess(b[i].hr);valid.all.push(i);valid[s].push(i);
    if(px<ma20[i]-2*bbStd[i])fire("bblo_long",i,1); if(px>ma20[i]+2*bbStd[i])fire("bbhi_short",i,-1);
    if(rsi[i]>70&&px<m)fire("mr_short",i,-1); if(rsi[i]<30&&px>m)fire("mr_long",i,1);
    if(rsi2[i]<5&&px>m)fire("rsi2_long",i,1); if(rsi2[i]>95&&px<m)fire("rsi2_short",i,-1);
    if(px>donH[i])fire("bo_long",i,1); if(px<donL[i])fire("bd_short",i,-1);
  }
  const rnd=mulberry(sym.split("").reduce((a,ch)=>a+ch.charCodeAt(0),0)+n);
  const out:Record<string,unknown>[]=[];
  for(const[k,dir]of SETUPS)for(const S of SESSIONS){const fr=fires[k][S];if(fr.length<MINFIRES)continue;
    const pool=valid[S];const rr:number[]=[];for(let s=0;s<Math.min(fr.length,80);s++){const i=pool[Math.floor(rnd()*pool.length)];const sd=STOP*atr[i];if(sd>0)rr.push((dir>0?longR(b,i,c[i],sd):shortR(b,i,c[i],sd))-COST_R);}
    out.push({instrument:sym,asset_class:cls,setup:k,session:S,n:fr.length,edge_r:+(mean(fr)-mean(rr)).toFixed(4)});}
  return out;
}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const cls=new URL(req.url).searchParams.get("class")||"crypto";const list=cls==="fx"?FX:CRYPTO;
  const rows:Record<string,unknown>[]=[];let ok=0;
  for(const sym of list){const r=await analyze(sym,cls);if(r.length){ok++;rows.push(...r);}}
  if(rows.length)await fetch(`${SB}/rest/v1/trd_intraday_sessions?on_conflict=instrument,setup,session`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
  return new Response(JSON.stringify({ok:true,class:cls,instruments:ok,rows:rows.length}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
