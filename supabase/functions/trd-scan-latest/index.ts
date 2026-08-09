// trd-scan-latest — serves the nightly full-universe rip-short scan for the cockpit (D-224). Returns the latest scan
// session's ACTIONABLE candidates (liquid large-caps firing rip-short) + scan progress. Read-only, service-role.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const cur=(await fetch(`${SB}/rest/v1/trd_scan_cursor?id=eq.ripshort&select=*`,{headers:H}).then(r=>r.json()).catch(()=>[]))?.[0];
  const md=(await fetch(`${SB}/rest/v1/trd_ripshort_scan?select=scan_date&order=scan_date.desc&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]))?.[0]?.scan_date;
  const date=md??cur?.scan_date??null;
  let actionable:unknown[]=[],firingAll=0;
  if(date){
    actionable=await fetch(`${SB}/rest/v1/trd_ripshort_scan?scan_date=eq.${date}&actionable=eq.true&select=ticker,px,tier,rsi,ma200&order=rsi.desc&limit=40`,{headers:H}).then(r=>r.json()).catch(()=>[]);
    const cnt=await fetch(`${SB}/rest/v1/trd_ripshort_scan?scan_date=eq.${date}&select=id`,{headers:{...H,Prefer:"count=exact",Range:"0-0"}});
    firingAll=Number((cnt.headers.get("content-range")||"/0").split("/")[1])||0;
  }
  const pct=cur&&cur.total?Math.round(cur.idx/cur.total*100):0;
  return new Response(JSON.stringify({ok:true,scan_date:date,progress:{idx:cur?.idx??0,total:cur?.total??0,status:cur?.status??"never run",firing_total:cur?.firing_total??0,pct},actionableCount:(actionable as unknown[]).length,firingAll,actionable},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
