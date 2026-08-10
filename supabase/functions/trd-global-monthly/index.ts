// trd-global-monthly — pull MONTHLY close series for the entire universe (D-245) to power cross-sectional factor
// tests (momentum/reversal/low-vol) ranked WITHIN each market in SQL. Monthly bars = ~60 points/name (tiny). Parallel
// + resumable (xsec_swept cursor). Cross-sectional long-short is market-neutral → drift confound cancels. NO order path.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
async function monthly(sym:string):Promise<{month:string,close:number}[]|null|"throttle">{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1mo&range=5y`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(r.status===429||r.status>=500)return "throttle";
  if(!r.ok)return null;const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return null;
  const cl=res.indicators.quote[0].close,o:{month:string,close:number}[]=[];
  for(let i=0;i<res.timestamp.length;i++){const c=cl[i];if(c==null||!Number.isFinite(c))continue;const d=new Date(res.timestamp[i]*1000);o.push({month:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-01`,close:c});}
  return o;}catch{return null;}}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const N=+(u.searchParams.get("limit")||"180");const CONC=+(u.searchParams.get("conc")||"30");
  const batch=await fetch(`${SB}/rest/v1/trd_global_universe?xsec_swept=eq.false&has_data=eq.true&select=yahoo_sym,exchange&order=yahoo_sym&limit=${N}`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!Array.isArray(batch)||!batch.length)return new Response(JSON.stringify({ok:true,done:true,msg:"monthly sweep complete"}),{headers:cors});
  const rows:Record<string,unknown>[]=[];const sweptSyms:string[]=[];let throttled=0;
  for(let start=0;start<batch.length;start+=CONC){
    const chunk=(batch as {yahoo_sym:string,exchange:string}[]).slice(start,start+CONC);
    const recs=await Promise.all(chunk.map(async r=>({sym:r.yahoo_sym,ex:r.exchange,m:await monthly(r.yahoo_sym)})));
    for(const rec of recs){if(rec.m==="throttle"){throttled++;continue;}sweptSyms.push(rec.sym);if(rec.m&&rec.m.length>=13)for(const p of rec.m)rows.push({yahoo_sym:rec.sym,exchange:rec.ex,month:p.month,close:p.close});}
    if(throttled>=CONC)break;
  }
  for(let p=0;p<rows.length;p+=8000){const slice=rows.slice(p,p+8000);
    const up=await fetch(`${SB}/rest/v1/trd_monthly?on_conflict=yahoo_sym,month`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(slice)});
    if(!up.ok)return new Response(JSON.stringify({ok:false,stage:"monthly",status:up.status,err:(await up.text()).slice(0,300)}),{status:500,headers:cors});}
  for(let p=0;p<sweptSyms.length;p+=120){const list=sweptSyms.slice(p,p+120).map(s=>`"${s}"`).join(",");
    await fetch(`${SB}/rest/v1/trd_global_universe?yahoo_sym=in.(${encodeURIComponent(list)})`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({xsec_swept:true})});}
  const remain=await fetch(`${SB}/rest/v1/trd_global_universe?xsec_swept=eq.false&has_data=eq.true&select=yahoo_sym&limit=1`,{headers:{...H,Prefer:"count=exact",Range:"0-0"}});
  const left=(remain.headers.get("content-range")||"").split("/")[1]||"?";
  return new Response(JSON.stringify({ok:true,processed:sweptSyms.length,rows:rows.length,throttled,remaining:left,done:left==="0"}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
