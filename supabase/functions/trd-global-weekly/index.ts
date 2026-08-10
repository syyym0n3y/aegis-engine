// trd-global-weekly — the setup library at the WEEKLY timeframe (D-247), across the entire universe. Weekly-calibrated
// params (MA30 trend, BB20, Donchian20-week, 52-week hi/lo, HOLD=8 weeks, 2ATR stop). 8 key setups incl. the bblo
// winner — does it survive at weekly, and is there any weekly-only edge? Emits to trd_global_setups with _wk suffix.
// Parallel + resumable (weekly_swept cursor). Currency-neutral R vs own random control. NO order path.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const MA=30,RSIN=14,ATRN=14,BB=20,DON=20,YR=52,STOP=2,HOLD=8,COST_R=0.05,MINFIRES=10,START=52;
interface Bar{h:number;l:number;c:number}
async function bars(sym:string):Promise<{b:Bar[]}|null|"throttle">{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=5y`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(r.status===429||r.status>=500)return "throttle";
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({h,l,c});}
  return{b:o};}catch{return null;}}
function longR(b:Bar[],i:number,e:number,sd:number){const stop=e-sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].l<=stop)return -1;return (b[end].c-e)/sd;}
function shortR(b:Bar[],i:number,e:number,sd:number){const stop=e+sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].h>=stop)return -1;return (e-b[end].c)/sd;}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function roll(arr:number[],W:number,mode:"max"|"min"):Float64Array{const out=new Float64Array(arr.length).fill(NaN);const dq:number[]=[];for(let i=0;i<arr.length;i++){while(dq.length&&dq[0]<i-W)dq.shift();out[i]=dq.length?arr[dq[0]]:NaN;const cmp=mode==="max"?(a:number,x:number)=>a<=x:(a:number,x:number)=>a>=x;while(dq.length&&cmp(arr[dq[dq.length-1]],arr[i]))dq.pop();dq.push(i);}return out;}
function sma(c:number[],W:number):Float64Array{const o=new Float64Array(c.length);let s=0;for(let i=0;i<c.length;i++){s+=c[i];if(i>=W)s-=c[i-W];o[i]=i>=W-1?s/W:NaN;}return o;}
function rsiArr(c:number[],P:number):Float64Array{const o=new Float64Array(c.length).fill(NaN);let ag=0,al=0;for(let i=1;i<c.length;i++){const ch=c[i]-c[i-1];ag+=Math.max(ch,0);al+=Math.max(-ch,0);if(i>P){const p=c[i-P]-c[i-P-1];ag-=Math.max(p,0);al-=Math.max(-p,0);}if(i>=P)o[i]=100-100/(1+(ag/P)/((al/P)||1e-9));}return o;}
const SETUPS:[string,number][]=[["bblo_long_wk",1],["bbhi_short_wk",-1],["mr_short_wk",-1],["mr_long_wk",1],["bo20_long_wk",1],["bd20_short_wk",-1],["hi52_long_wk",1],["lo52_short_wk",-1]];
async function processOne(row:{yahoo_sym:string,exchange:string}):Promise<{rows:Record<string,unknown>[]}|"throttle"|null>{
  const sym=row.yahoo_sym;const data=await bars(sym);if(data==="throttle")return "throttle";
  if(!data||data.b.length<START+HOLD+5)return null;
  const b=data.b,c=b.map(x=>x.c),n=b.length;
  const ma=sma(c,MA),ma20=sma(c,BB),rsi=rsiArr(c,RSIN);
  const atr=new Float64Array(n).fill(NaN);{let s=0;for(let i=1;i<n;i++){const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));s+=tr;if(i>ATRN){const p=Math.max(b[i-ATRN].h-b[i-ATRN].l,Math.abs(b[i-ATRN].h-b[i-ATRN-1].c),Math.abs(b[i-ATRN].l-b[i-ATRN-1].c));s-=p;}if(i>=ATRN)atr[i]=s/ATRN;}}
  const bbStd=new Float64Array(n).fill(NaN);{let s=0,ss=0;for(let i=0;i<n;i++){s+=c[i];ss+=c[i]*c[i];if(i>=BB){s-=c[i-BB];ss-=c[i-BB]*c[i-BB];}if(i>=BB-1){const m=s/BB;bbStd[i]=Math.sqrt(Math.max(ss/BB-m*m,0));}}}
  const donH=roll(b.map(x=>x.h),DON,"max"),donL=roll(b.map(x=>x.l),DON,"min"),max52=roll(c,YR,"max"),min52=roll(c,YR,"min");
  const R:Record<string,number[]>={};for(const[k]of SETUPS)R[k]=[];
  for(let i=START;i<n-HOLD;i++){const sd=STOP*atr[i];if(!(sd>0))continue;const px=c[i],m=ma[i];
    const L=()=>longR(b,i,px,sd)-COST_R,Sh=()=>shortR(b,i,px,sd)-COST_R;
    if(px<ma20[i]-2*bbStd[i])R.bblo_long_wk.push(L()); if(px>ma20[i]+2*bbStd[i])R.bbhi_short_wk.push(Sh());
    if(rsi[i]>70&&px<m)R.mr_short_wk.push(Sh()); if(rsi[i]<30&&px>m)R.mr_long_wk.push(L());
    if(px>donH[i])R.bo20_long_wk.push(L()); if(px<donL[i])R.bd20_short_wk.push(Sh());
    if(px>=max52[i])R.hi52_long_wk.push(L()); if(px<=min52[i])R.lo52_short_wk.push(Sh());
  }
  const seed0=sym.split("").reduce((a,ch)=>a+ch.charCodeAt(0),0)+n;const out:Record<string,unknown>[]=[];
  for(const[key,dir]of SETUPS){const fires=R[key].length;if(fires<MINFIRES)continue;
    const rnd=mulberry(seed0+key.length*7);const rr:number[]=[];
    for(let s=0;s<Math.min(fires,50);s++){const i=START+Math.floor(rnd()*(n-HOLD-START));const sd=STOP*atr[i];if(sd>0)rr.push((dir>0?longR(b,i,c[i],sd):shortR(b,i,c[i],sd))-COST_R);}
    out.push({yahoo_sym:sym,exchange:row.exchange,setup:key,n:fires,edge_r:+(mean(R[key])-mean(rr)).toFixed(4)});}
  return {rows:out};
}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const N=+(u.searchParams.get("limit")||"300");const CONC=+(u.searchParams.get("conc")||"20");
  const batch=await fetch(`${SB}/rest/v1/trd_global_universe?weekly_swept=eq.false&has_data=eq.true&select=yahoo_sym,exchange&order=yahoo_sym&limit=${N}`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(batch)||!batch.length)return new Response(JSON.stringify({ok:true,done:true,msg:"weekly sweep complete"}),{headers:cors});
  const rows:Record<string,unknown>[]=[];const sweptSyms:string[]=[];let throttled=0;
  for(let start=0;start<batch.length;start+=CONC){
    const chunk=(batch as {yahoo_sym:string,exchange:string}[]).slice(start,start+CONC);
    const recs=await Promise.all(chunk.map(r=>processOne(r)));
    for(let k=0;k<recs.length;k++){const r=recs[k];if(r==="throttle"){throttled++;continue;}sweptSyms.push(chunk[k].yahoo_sym);if(r)rows.push(...r.rows);}
    if(throttled>=CONC)break;
  }
  if(rows.length){const up=await fetch(`${SB}/rest/v1/trd_global_setups?on_conflict=yahoo_sym,setup`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
    if(!up.ok)return new Response(JSON.stringify({ok:false,stage:"wk",status:up.status,err:(await up.text()).slice(0,300)}),{status:500,headers:cors});}
  for(let p=0;p<sweptSyms.length;p+=120){const list=sweptSyms.slice(p,p+120).map(s=>`"${s}"`).join(",");
    await fetch(`${SB}/rest/v1/trd_global_universe?yahoo_sym=in.(${encodeURIComponent(list)})`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({weekly_swept:true})});}
  const remain=await fetch(`${SB}/rest/v1/trd_global_universe?weekly_swept=eq.false&has_data=eq.true&select=yahoo_sym&limit=1`,{headers:{...H,Prefer:"count=exact",Range:"0-0"}});
  const left=(remain.headers.get("content-range")||"").split("/")[1]||"?";
  return new Response(JSON.stringify({ok:true,processed:sweptSyms.length,rows:rows.length,throttled,remaining:left,done:left==="0"}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
