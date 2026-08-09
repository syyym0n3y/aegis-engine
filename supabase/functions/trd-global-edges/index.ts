// trd-global-edges — multi-setup edge DISCOVERY across the entire global universe (D-241). Per name, run 5 orthogonal
// setups (mean-reversion + momentum, both directions), each as a capped-stop trade in currency-neutral R vs its OWN
// matched random-entry control (D-146/D-202). edge_r = meanR(setup) − meanR(random). Resumable + parallel. All rolling
// indicators precomputed in O(n) (deques for the max-windows) so the per-day scan is O(1). NO order path.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const MA=200,RSIN=14,ATRN=14,STOP=2,HOLD=20,DON=20,YR=252,COST_R=0.05,MINFIRES=10,START=252;
interface Bar{h:number;l:number;c:number}
async function bars(sym:string):Promise<{b:Bar[]}|null|"throttle">{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(r.status===429||r.status>=500)return "throttle";
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({h,l,c});}
  return{b:o};}catch{return null;}}
function longR(b:Bar[],i:number,e:number,sd:number){const stop=e-sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].l<=stop)return -1;return (b[end].c-e)/sd;}
function shortR(b:Bar[],i:number,e:number,sd:number){const stop=e+sd,end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++)if(b[k].h>=stop)return -1;return (e-b[end].c)/sd;}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
// rolling max/min of window W ending at i-1 (exclusive of i), via monotonic deque — O(n)
function rollWin(arr:number[],W:number,mode:"max"|"min"):Float64Array{const out=new Float64Array(arr.length).fill(NaN);const dq:number[]=[];for(let i=0;i<arr.length;i++){while(dq.length&&dq[0]<i-W)dq.shift();out[i]=dq.length?arr[dq[0]]:NaN;const cmp=mode==="max"?(a:number,x:number)=>a<=x:(a:number,x:number)=>a>=x;while(dq.length&&cmp(arr[dq[dq.length-1]],arr[i]))dq.pop();dq.push(i);}return out;}
type SetupKey="mr_short"|"mr_long"|"bo_long"|"bd_short"|"hi52";
async function processOne(row:{yahoo_sym:string,exchange:string}):Promise<Record<string,unknown>|"throttle"|null>{
  const sym=row.yahoo_sym;const data=await bars(sym);if(data==="throttle")return "throttle";
  if(!data||data.b.length<START+HOLD+5)return null;
  const b=data.b,c=b.map(x=>x.c),n=b.length;
  // O(n) rolling indicators
  const ma=new Float64Array(n);{let s=0;for(let i=0;i<n;i++){s+=c[i];if(i>=MA)s-=c[i-MA];if(i>=MA-1)ma[i]=s/MA;}}
  const rsi=new Float64Array(n);{let ag=0,al=0;for(let i=1;i<n;i++){const ch=c[i]-c[i-1];const g=Math.max(ch,0),l=Math.max(-ch,0);ag+=g;al+=l;if(i>RSIN){const pch=c[i-RSIN]-c[i-RSIN-1];ag-=Math.max(pch,0);al-=Math.max(-pch,0);}if(i>=RSIN)rsi[i]=100-100/(1+(ag/RSIN)/((al/RSIN)||1e-9));}}
  const atr=new Float64Array(n);{let s=0;for(let i=1;i<n;i++){const tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-b[i-1].c),Math.abs(b[i].l-b[i-1].c));s+=tr;if(i>ATRN)s-=Math.max(b[i-ATRN].h-b[i-ATRN].l,Math.abs(b[i-ATRN].h-b[i-ATRN-1].c),Math.abs(b[i-ATRN].l-b[i-ATRN-1].c));if(i>=ATRN)atr[i]=s/ATRN;}}
  const donH=rollWin(b.map(x=>x.h),DON,"max"),donL=rollWin(b.map(x=>x.l),DON,"min"),max252=rollWin(c,YR,"max");
  const S:Record<SetupKey,{r:number[],dir:number}>={mr_short:{r:[],dir:-1},mr_long:{r:[],dir:1},bo_long:{r:[],dir:1},bd_short:{r:[],dir:-1},hi52:{r:[],dir:1}};
  for(let i=START;i<n-HOLD;i++){
    const sd=STOP*atr[i];if(!(sd>0))continue;const m=ma[i],rs=rsi[i];
    if(rs>70&&c[i]<m)S.mr_short.r.push(shortR(b,i,c[i],sd)-COST_R);
    if(rs<30&&c[i]>m)S.mr_long.r.push(longR(b,i,c[i],sd)-COST_R);
    if(c[i]>donH[i])S.bo_long.r.push(longR(b,i,c[i],sd)-COST_R);
    if(c[i]<donL[i])S.bd_short.r.push(shortR(b,i,c[i],sd)-COST_R);
    if(c[i]>=max252[i])S.hi52.r.push(longR(b,i,c[i],sd)-COST_R);
  }
  const rec:Record<string,unknown>={yahoo_sym:sym,exchange:row.exchange};
  const seed0=sym.split("").reduce((a,ch)=>a+ch.charCodeAt(0),0)+n;
  for(const key of Object.keys(S) as SetupKey[]){
    const fires=S[key].r.length;rec[`${key}_n`]=fires;
    if(fires<MINFIRES){rec[`${key}_r`]=null;continue;}
    const dir=S[key].dir;const rnd=mulberry(seed0+key.length);const rr:number[]=[];
    for(let s=0;s<Math.min(fires,50);s++){const i=START+Math.floor(rnd()*(n-HOLD-START));const sd=STOP*atr[i];if(sd>0)rr.push((dir>0?longR(b,i,c[i],sd):shortR(b,i,c[i],sd))-COST_R);}
    rec[`${key}_r`]=+(mean(S[key].r)-mean(rr)).toFixed(4);
  }
  return rec;
}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const N=+(u.searchParams.get("limit")||"300");const CONC=+(u.searchParams.get("conc")||"20");
  const batch=await fetch(`${SB}/rest/v1/trd_global_universe?edges_swept=eq.false&has_data=eq.true&select=yahoo_sym,exchange&order=yahoo_sym&limit=${N}`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(batch)||!batch.length)return new Response(JSON.stringify({ok:true,done:true,msg:"edge sweep complete"}),{headers:cors});
  const edgeRows:Record<string,unknown>[]=[];const sweptSyms:string[]=[];let throttled=0;
  for(let start=0;start<batch.length;start+=CONC){
    const chunk=(batch as {yahoo_sym:string,exchange:string}[]).slice(start,start+CONC);
    const recs=await Promise.all(chunk.map(r=>processOne(r)));
    for(let k=0;k<recs.length;k++){const r=recs[k];if(r==="throttle"){throttled++;continue;}sweptSyms.push(chunk[k].yahoo_sym);if(r)edgeRows.push(r);}
    if(throttled>=CONC)break;
  }
  if(edgeRows.length){const up=await fetch(`${SB}/rest/v1/trd_global_edges?on_conflict=yahoo_sym`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(edgeRows)});
    if(!up.ok)return new Response(JSON.stringify({ok:false,stage:"edges",status:up.status,err:(await up.text()).slice(0,300)}),{status:500,headers:cors});}
  for(let p=0;p<sweptSyms.length;p+=120){const list=sweptSyms.slice(p,p+120).map(s=>`"${s}"`).join(",");
    await fetch(`${SB}/rest/v1/trd_global_universe?yahoo_sym=in.(${encodeURIComponent(list)})`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({edges_swept:true})});}
  const remain=await fetch(`${SB}/rest/v1/trd_global_universe?edges_swept=eq.false&has_data=eq.true&select=yahoo_sym&limit=1`,{headers:{...H,Prefer:"count=exact",Range:"0-0"}});
  const left=(remain.headers.get("content-range")||"").split("/")[1]||"?";
  return new Response(JSON.stringify({ok:true,processed:sweptSyms.length,measured:edgeRows.length,throttled,remaining:left,done:left==="0"}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
