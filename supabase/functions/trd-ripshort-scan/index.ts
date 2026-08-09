// trd-ripshort-scan — nightly FULL-UNIVERSE rip-short scanner (D-223). Cursor-driven chunker: walks the whole SEC US
// universe (~9,850) in 200-name chunks; a cron fires it every few minutes after US close so it completes the full
// universe nightly, then idles until the next night. Writes names currently firing rip-short (RSI>70 & close<200MA in
// bull regime) to trd_ripshort_scan, flagged actionable ONLY where the edge lives (liquid large-caps, D-220). $0.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const CHUNK=200, START_HOUR=23; // reset the scan at/after 23:00 UTC (after US close)
async function bars(sym:string):Promise<{c:number,h:number,l:number}[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o=[];for(let i=0;i<res.timestamp.length;i++){const c=q.close[i],h=q.high[i],l=q.low[i];if(c!=null&&Number.isFinite(c))o.push({c,h:h??c,l:l??c});}return o;}catch{return[];}}
const sma=(a:number[],n:number)=>a.length<n?NaN:a.slice(-n).reduce((x,y)=>x+y,0)/n;
function rsi(a:number[],n=14){if(a.length<n+1)return NaN;let ag=0,al=0;for(let i=a.length-n;i<a.length;i++){const ch=a[i]-a[i-1];ag+=Math.max(ch,0);al+=Math.max(-ch,0);}return 100-100/(1+(ag/n)/((al/n)||1e-9));}
async function universe():Promise<string[]>{try{const r=await fetch("https://www.sec.gov/files/company_tickers.json",{headers:{"User-Agent":"aegis-research ona@revitalise.io"}});const j=await r.json();return (Object.values(j) as {ticker:string}[]).map(x=>x.ticker).filter(t=>/^[A-Z]{1,5}$/.test(t));}catch{return[];}}

Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const force=new URL(req.url).searchParams.get("force")==="1";
  const now=new Date();const hour=now.getUTCHours();
  // session date: the night spans 23:00 (day D) → ~02:00 (day D+1); label the whole window by day D so the scan
  // does NOT reset at midnight. Early-morning hours (<3 UTC) belong to the previous day's session.
  const anchor=new Date(now);if(hour<3)anchor.setUTCDate(anchor.getUTCDate()-1);
  const session=anchor.toISOString().slice(0,10);
  const inWindow=hour>=START_HOUR||hour<3||force;
  const cur=(await fetch(`${SB}/rest/v1/trd_scan_cursor?id=eq.ripshort&select=*`,{headers:H}).then(r=>r.json()).catch(()=>[]))?.[0];
  // cheap no-op outside the nightly window or when this session is already done — skip the universe fetch
  if(cur&&cur.scan_date===session&&(cur.idx>=cur.total)&&cur.total>0)return new Response(JSON.stringify({ok:true,done:true,session,scanned:cur.total,firing:cur.firing_total}),{headers:cors});
  if(!inWindow&&(!cur||cur.scan_date!==session))return new Response(JSON.stringify({ok:true,skipped:`outside nightly window (runs ${START_HOUR}:00-02:59 UTC); hour=${hour}`}),{headers:cors});
  const uni=await universe();if(uni.length<1000)return new Response(JSON.stringify({ok:false,err:"universe fetch failed"}),{headers:cors});
  const total=uni.length;
  let idx=cur?.idx??0, scanDate=cur?.scan_date??null, firingTotal=cur?.firing_total??0;
  // reset for a new nightly session
  if(!cur||((scanDate!==session)&&inWindow)){idx=0;scanDate=session;firingTotal=0;
    await fetch(`${SB}/rest/v1/trd_scan_cursor?on_conflict=id`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:"ripshort",scan_date:session,idx:0,total,firing_total:0,status:"running",updated_at:now.toISOString()})});}
  if(scanDate!==session)return new Response(JSON.stringify({ok:true,skipped:`waiting for nightly window (>=${START_HOUR}:00 UTC or ?force=1)`,hour}),{headers:cors});
  if(idx>=total)return new Response(JSON.stringify({ok:true,done:true,scanned:total,firing:firingTotal}),{headers:cors});
  // regime
  const spy=(await bars("SPY")).map(x=>x.c);const bull=spy.at(-1)!>sma(spy,200);
  const slice=uni.slice(idx,idx+CHUNK);const rows=[];
  for(const sym of slice){const b=(await bars(sym)).map(x=>x.c);if(b.length<200)continue;const ma=sma(b,200),r=rsi(b),px=b.at(-1)!;
    if(r>70&&px<ma){const tier=px<5?"micro":px<20?"small":px<100?"mid":"large";const actionable=bull&&px>=50;
      rows.push({scan_date:session,ticker:sym,px:+px.toFixed(2),tier,rsi:+r.toFixed(1),ma200:+ma.toFixed(2),actionable});}}
  if(rows.length)await fetch(`${SB}/rest/v1/trd_ripshort_scan`,{method:"POST",headers:{...H,Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(rows)});
  const newIdx=idx+CHUNK;firingTotal+=rows.length;
  await fetch(`${SB}/rest/v1/trd_scan_cursor?on_conflict=id`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:"ripshort",scan_date:session,idx:newIdx,total,firing_total:firingTotal,status:newIdx>=total?"done":"running",updated_at:new Date().toISOString()})});
  return new Response(JSON.stringify({ok:true,regime:bull?"bull":"bear",processed:slice.length,firingThisChunk:rows.length,idx:newIdx,of:total,firingTotal,pct:Math.round(newIdx/total*100)}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
