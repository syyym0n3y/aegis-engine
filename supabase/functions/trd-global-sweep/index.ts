// trd-global-sweep — resumable per-instrument gate sweep over the ENTIRE global universe (D-239). For each unswept
// name: pull Yahoo daily history, run the rip-short capped-stop setup (RSI>70 & <200MA → short, 2×ATR stop, ≤20-bar
// hold, floored at −1R) and its OWN matched RANDOM-entry control (D-146/D-202), record edge_r = meanR(setup) −
// meanR(random) in currency-NEUTRAL R units (no FX needed). Idempotent; Yahoo 429/5xx → leave unswept, retry.
// FAST: Yahoo fetches run in bounded-concurrency parallel rounds per tick (I/O-bound, free). NO order path.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const MA=200,RSIN=14,ATRN=14,STOP=2,HOLD=20,COST_R=0.05,MINFIRES=10;
interface Bar{h:number;l:number;c:number}
async function bars(sym:string):Promise<{b:Bar[],cur:string}|null|"throttle">{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(r.status===429||r.status>=500)return "throttle";
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;o.push({h,l,c});}
  return{b:o,cur:res.meta?.currency||""};}catch{return null;}}
function rsiAt(c:number[],i:number){let ag=0,al=0;for(let k=i-RSIN+1;k<=i;k++){const ch=c[k]-c[k-1];ag+=Math.max(ch,0);al+=Math.max(-ch,0);}return 100-100/(1+(ag/RSIN)/((al/RSIN)||1e-9));}
function atrAt(b:Bar[],i:number){let s=0;for(let k=i-ATRN+1;k<=i;k++)s+=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));return s/ATRN;}
function shortR(b:Bar[],i:number,entry:number,sd:number){const stop=entry+sd;const end=Math.min(i+HOLD,b.length-1);for(let k=i+1;k<=end;k++){if(b[k].h>=stop)return -1;}return (entry-b[end].c)/sd;}
function mulberry(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// one name -> its verdict record (or "throttle")
async function processOne(row:{yahoo_sym:string,ticker:string,exchange:string},now:string):Promise<Record<string,unknown>|"throttle">{
  const sym=row.yahoo_sym;const data=await bars(sym);
  if(data==="throttle")return "throttle";
  const rec:Record<string,unknown>={yahoo_sym:sym,ticker:row.ticker,exchange:row.exchange,swept:true,swept_at:now,
    has_data:!!data,n_bars:data?data.b.length:0,currency:data?.cur||null,last_close_usd:null,ret_252:null,ripshort_fires:null,edge_r:null,verdict:"no-data"};
  if(data&&data.b.length>=MA+ATRN+HOLD){
    const b=data.b,c=b.map(x=>x.c),n=b.length;
    const rs:number[]=[];
    for(let i=MA;i<n-HOLD;i++){const ma=c.slice(i-MA,i).reduce((a,x)=>a+x,0)/MA;if(!(c[i]<ma))continue;if(!(rsiAt(c,i)>70))continue;const sd=STOP*atrAt(b,i);if(!(sd>0))continue;rs.push(shortR(b,i,c[i],sd)-COST_R);}
    const fires=rs.length;rec.ret_252=n>253?+(c[n-1]/c[n-253]-1).toFixed(4):null;rec.ripshort_fires=fires;rec.last_close_usd=c[n-1];rec.verdict="measured-lowN";
    if(fires>=MINFIRES){const rnd=mulberry(sym.split("").reduce((a,ch)=>a+ch.charCodeAt(0),0)+n);
      const rr:number[]=[];for(let s=0;s<Math.min(fires,50);s++){const i=MA+Math.floor(rnd()*(n-HOLD-MA));const sd=STOP*atrAt(b,i);if(sd>0)rr.push(shortR(b,i,c[i],sd)-COST_R);}
      const mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/(a.length||1);
      rec.edge_r=+(mean(rs)-mean(rr)).toFixed(4);rec.verdict="measured";}
  } else if(data){rec.verdict="insufficient-history";}
  return rec;
}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const N=+(u.searchParams.get("limit")||"300");const CONC=+(u.searchParams.get("conc")||"24");
  const batch=await fetch(`${SB}/rest/v1/trd_global_universe?swept=eq.false&select=yahoo_sym,ticker,exchange&order=yahoo_sym&limit=${N}`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(batch)||!batch.length)return new Response(JSON.stringify({ok:true,done:true,msg:"sweep complete — no unswept names"}),{headers:cors});
  const updates:Record<string,unknown>[]=[];const now=new Date().toISOString();let throttled=0;
  for(let start=0;start<batch.length;start+=CONC){
    const chunk=(batch as {yahoo_sym:string,ticker:string,exchange:string}[]).slice(start,start+CONC);
    const recs=await Promise.all(chunk.map(r=>processOne(r,now)));
    for(const r of recs){if(r==="throttle")throttled++;else updates.push(r);}
    if(throttled>=CONC)break;   // sustained throttling this tick — stop, leave the rest unswept for retry
  }
  if(updates.length){
    const up=await fetch(`${SB}/rest/v1/trd_global_universe?on_conflict=yahoo_sym`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(updates)});
    if(!up.ok)return new Response(JSON.stringify({ok:false,stage:"upsert",status:up.status,err:(await up.text()).slice(0,300)}),{status:500,headers:cors});
  }
  const remain=await fetch(`${SB}/rest/v1/trd_global_universe?swept=eq.false&select=yahoo_sym&limit=1`,{headers:{...H,Prefer:"count=exact",Range:"0-0"}});
  const cr=remain.headers.get("content-range")||"";const left=cr.split("/")[1]||"?";
  return new Response(JSON.stringify({ok:true,processed:updates.length,throttled,remaining:left,done:left==="0"}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
