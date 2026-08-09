// trd-global-setups — comprehensive setup-LIBRARY sweep across the entire global universe (D-243). 24 setups spanning
// mean-reversion (RSI14/RSI2/Bollinger/consecutive/gap-fade), momentum (Donchian 20/55, 52wk hi/lo, golden/death,
// gap-continuation) and volatility/volume (NR7 coil, ATR expansion, inside-bar, volume-capitulation). Each = a
// capped-stop trade (2ATR stop, 20-bar hold, −1R floor) in currency-neutral R vs its OWN random control (D-146/D-202).
// All rolling indicators precomputed O(n). Resumable + parallel. Deflation done in the aggregate. NO order path.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const HOLD=20,STOP=2,COST_R=0.05,MINFIRES=10,START=252;
interface Bar{o:number;h:number;l:number;c:number;v:number}
async function bars(sym:string):Promise<{b:Bar[]}|null|"throttle">{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(r.status===429||r.status>=500)return "throttle";
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const O=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i],v=q.volume[i];if([O,h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({o:O,h,l,c,v:Number.isFinite(v)?v:0});}
  return{b:o};}catch{return null;}}
function longR(b:Bar[],i:number,e:number,sd:number){const stop=e-sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].l<=stop)return -1;return (b[end].c-e)/sd;}
function shortR(b:Bar[],i:number,e:number,sd:number){const stop=e+sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].h>=stop)return -1;return (e-b[end].c)/sd;}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function roll(arr:number[],W:number,mode:"max"|"min"):Float64Array{const out=new Float64Array(arr.length).fill(NaN);const dq:number[]=[];for(let i=0;i<arr.length;i++){while(dq.length&&dq[0]<i-W)dq.shift();out[i]=dq.length?arr[dq[0]]:NaN;const cmp=mode==="max"?(a:number,x:number)=>a<=x:(a:number,x:number)=>a>=x;while(dq.length&&cmp(arr[dq[dq.length-1]],arr[i]))dq.pop();dq.push(i);}return out;}
function sma(c:number[],W:number):Float64Array{const o=new Float64Array(c.length);let s=0;for(let i=0;i<c.length;i++){s+=c[i];if(i>=W)s-=c[i-W];o[i]=i>=W-1?s/W:NaN;}return o;}
function rsiArr(c:number[],P:number):Float64Array{const o=new Float64Array(c.length).fill(NaN);let ag=0,al=0;for(let i=1;i<c.length;i++){const ch=c[i]-c[i-1];ag+=Math.max(ch,0);al+=Math.max(-ch,0);if(i>P){const p=c[i-P]-c[i-P-1];ag-=Math.max(p,0);al-=Math.max(-p,0);}if(i>=P)o[i]=100-100/(1+(ag/P)/((al/P)||1e-9));}return o;}
// 24 setups: [key, dir]
const SETUPS:[string,number][]=[
  ["mr_short14",-1],["mr_short80",-1],["mr_long14",1],["mr_long20",1],["rsi2_long",1],["rsi2_short",-1],
  ["bblo_long",1],["bbhi_short",-1],["down3_long",1],["up3_short",-1],["gapdn_long",1],
  ["bo20_long",1],["bo55_long",1],["bd20_short",-1],["bd55_short",-1],["hi52_long",1],["lo52_short",-1],
  ["golden_long",1],["death_short",-1],["gapup_long",1],
  ["nr7_long",1],["atrexp_long",1],["inside_long",1],["volspike_long",1]];
async function processOne(row:{yahoo_sym:string,exchange:string}):Promise<{rows:Record<string,unknown>[]}|"throttle"|null>{
  const sym=row.yahoo_sym;const data=await bars(sym);if(data==="throttle")return "throttle";
  if(!data||data.b.length<START+HOLD+5)return null;
  const b=data.b,c=b.map(x=>x.c),n=b.length;
  const ma20=sma(c,20),ma50=sma(c,50),ma200=sma(c,200),rsi14=rsiArr(c,14),rsi2=rsiArr(c,2);
  const atr=new Float64Array(n).fill(NaN);{let s=0;for(let i=1;i<n;i++){const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));s+=tr;if(i>14){const p=Math.max(b[i-14].h-b[i-14].l,Math.abs(b[i-14].h-b[i-15].c),Math.abs(b[i-14].l-b[i-15].c));s-=p;}if(i>=14)atr[i]=s/14;}}
  const bbStd=new Float64Array(n).fill(NaN);{let s=0,ss=0;for(let i=0;i<n;i++){s+=c[i];ss+=c[i]*c[i];if(i>=20){s-=c[i-20];ss-=c[i-20]*c[i-20];}if(i>=19){const m=s/20;bbStd[i]=Math.sqrt(Math.max(ss/20-m*m,0));}}}
  const don20H=roll(b.map(x=>x.h),20,"max"),don20L=roll(b.map(x=>x.l),20,"min"),don55H=roll(b.map(x=>x.h),55,"max"),don55L=roll(b.map(x=>x.l),55,"min"),max252=roll(c,252,"max"),min252=roll(c,252,"min");
  const vol20=sma(b.map(x=>x.v),20);const rng=b.map(x=>x.h-x.l);
  const R:Record<string,number[]>={};for(const[k]of SETUPS)R[k]=[];
  for(let i=START;i<n-HOLD;i++){
    const sd=STOP*atr[i];if(!(sd>0))continue;const px=c[i],m2=ma200[i];
    const L=()=>longR(b,i,px,sd)-COST_R,Sh=()=>shortR(b,i,px,sd)-COST_R;
    if(rsi14[i]>70&&px<m2)R.mr_short14.push(Sh()); if(rsi14[i]>80&&px<m2)R.mr_short80.push(Sh());
    if(rsi14[i]<30&&px>m2)R.mr_long14.push(L()); if(rsi14[i]<20&&px>m2)R.mr_long20.push(L());
    if(rsi2[i]<5&&px>m2)R.rsi2_long.push(L()); if(rsi2[i]>95&&px<m2)R.rsi2_short.push(Sh());
    if(px<ma20[i]-2*bbStd[i])R.bblo_long.push(L()); if(px>ma20[i]+2*bbStd[i])R.bbhi_short.push(Sh());
    if(c[i]<c[i-1]&&c[i-1]<c[i-2]&&c[i-2]<c[i-3]&&px>m2)R.down3_long.push(L());
    if(c[i]>c[i-1]&&c[i-1]>c[i-2]&&c[i-2]>c[i-3]&&px<m2)R.up3_short.push(Sh());
    if(b[i].o<c[i-1]*0.98&&px>m2)R.gapdn_long.push(L());
    if(px>don20H[i])R.bo20_long.push(L()); if(px>don55H[i])R.bo55_long.push(L());
    if(px<don20L[i])R.bd20_short.push(Sh()); if(px<don55L[i])R.bd55_short.push(Sh());
    if(px>=max252[i])R.hi52_long.push(L()); if(px<=min252[i])R.lo52_short.push(Sh());
    if(ma50[i-1]<=ma200[i-1]&&ma50[i]>ma200[i])R.golden_long.push(L());
    if(ma50[i-1]>=ma200[i-1]&&ma50[i]<ma200[i])R.death_short.push(Sh());
    if(b[i].o>c[i-1]*1.02&&px>m2)R.gapup_long.push(L());
    if(px>m2&&rng[i]<=Math.min(rng[i-1],rng[i-2],rng[i-3],rng[i-4],rng[i-5],rng[i-6]))R.nr7_long.push(L());
    const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));
    if(tr>2*atr[i]&&px>b[i].o&&px>m2)R.atrexp_long.push(L());
    if(b[i-1].h<b[i-2].h&&b[i-1].l>b[i-2].l&&px>b[i-1].h&&px>m2)R.inside_long.push(L());
    if(b[i].v>3*vol20[i]&&px<c[i-1]&&px>m2)R.volspike_long.push(L());
  }
  const seed0=sym.split("").reduce((a,ch)=>a+ch.charCodeAt(0),0)+n;const out:Record<string,unknown>[]=[];
  for(const[key,dir]of SETUPS){const fires=R[key].length;if(fires<MINFIRES)continue;
    const rnd=mulberry(seed0+key.length*7);const rr:number[]=[];
    for(let s=0;s<Math.min(fires,50);s++){const i=START+Math.floor(rnd()*(n-HOLD-START));const sd=STOP*atr[i];if(sd>0)rr.push((dir>0?longR(b,i,c[i],sd):shortR(b,i,c[i],sd))-COST_R);}
    out.push({yahoo_sym:sym,exchange:row.exchange,setup:key,n:fires,edge_r:+(mean(R[key])-mean(rr)).toFixed(4)});}
  return {rows:out};
}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const N=+(u.searchParams.get("limit")||"200");const CONC=+(u.searchParams.get("conc")||"12");
  const batch=await fetch(`${SB}/rest/v1/trd_global_universe?setups_swept=eq.false&has_data=eq.true&select=yahoo_sym,exchange&order=yahoo_sym&limit=${N}`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(batch)||!batch.length)return new Response(JSON.stringify({ok:true,done:true,msg:"setup sweep complete"}),{headers:cors});
  const rows:Record<string,unknown>[]=[];const sweptSyms:string[]=[];let throttled=0;
  for(let start=0;start<batch.length;start+=CONC){
    const chunk=(batch as {yahoo_sym:string,exchange:string}[]).slice(start,start+CONC);
    const recs=await Promise.all(chunk.map(r=>processOne(r)));
    for(let k=0;k<recs.length;k++){const r=recs[k];if(r==="throttle"){throttled++;continue;}sweptSyms.push(chunk[k].yahoo_sym);if(r)rows.push(...r.rows);}
    if(throttled>=CONC)break;
  }
  if(rows.length){const up=await fetch(`${SB}/rest/v1/trd_global_setups?on_conflict=yahoo_sym,setup`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
    if(!up.ok)return new Response(JSON.stringify({ok:false,stage:"setups",status:up.status,err:(await up.text()).slice(0,300)}),{status:500,headers:cors});}
  for(let p=0;p<sweptSyms.length;p+=120){const list=sweptSyms.slice(p,p+120).map(s=>`"${s}"`).join(",");
    await fetch(`${SB}/rest/v1/trd_global_universe?yahoo_sym=in.(${encodeURIComponent(list)})`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({setups_swept:true})});}
  const remain=await fetch(`${SB}/rest/v1/trd_global_universe?setups_swept=eq.false&has_data=eq.true&select=yahoo_sym&limit=1`,{headers:{...H,Prefer:"count=exact",Range:"0-0"}});
  const left=(remain.headers.get("content-range")||"").split("/")[1]||"?";
  return new Response(JSON.stringify({ok:true,processed:sweptSyms.length,rows:rows.length,throttled,remaining:left,done:left==="0"}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
