// trd-databento — Databento Historical connector (D-258). Reads the key from trd_secrets (never in git). Actions:
//   ?action=test  → GET metadata.list_datasets (FREE) — verifies key + auth + API format.
//   ?action=schemas&dataset=GLBX.MDP3 → list schemas (FREE).
//   ?action=cost&dataset=&symbols=&schema=&start=&end=&stype_in= → metadata.get_cost (FREE $ estimate BEFORE pulling).
//   ?action=load&... → timeseries.get_range ohlcv-1m → store into trd_futures_1m (COST-BEARING; only after a cost check).
// Auth: HTTP Basic, key as username (empty password). Base https://hist.databento.com.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const BASE="https://hist.databento.com/v0";
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const key=(await fetch(`${SB}/rest/v1/trd_secrets?name=eq.databento_key&select=value`,{headers:H}).then(r=>r.json()).catch(()=>[]))?.[0]?.value;
  if(!key)return new Response(JSON.stringify({ok:false,err:"no databento key in trd_secrets"}),{status:500,headers:cors});
  const AUTH={Authorization:`Basic ${btoa(key+":")}`};
  const u=new URL(req.url);const action=u.searchParams.get("action")||"test";
  const qp=(names:string[])=>names.filter(n=>u.searchParams.get(n)!=null).map(n=>`${n}=${encodeURIComponent(u.searchParams.get(n)!)}`).join("&");
  if(action==="test"){
    const r=await fetch(`${BASE}/metadata.list_datasets`,{headers:AUTH});const txt=await r.text();
    return new Response(JSON.stringify({ok:r.ok,status:r.status,action:"test",datasets:r.ok?JSON.parse(txt):txt.slice(0,300)}),{headers:cors});
  }
  if(action==="schemas"){
    const r=await fetch(`${BASE}/metadata.list_schemas?${qp(["dataset"])}`,{headers:AUTH});const txt=await r.text();
    return new Response(JSON.stringify({ok:r.ok,status:r.status,schemas:r.ok?JSON.parse(txt):txt.slice(0,300)}),{headers:cors});
  }
  if(action==="cost"){
    const r=await fetch(`${BASE}/metadata.get_cost?${qp(["dataset","symbols","schema","start","end","stype_in","mode"])}`,{headers:AUTH});const txt=await r.text();
    return new Response(JSON.stringify({ok:r.ok,status:r.status,action:"cost",cost_usd:r.ok?JSON.parse(txt):txt.slice(0,400)}),{headers:cors});
  }
  if(action==="peek"){   // pull a tiny range to VERIFY the record format before the big pull
    const body=new URLSearchParams({dataset:u.searchParams.get("dataset")||"GLBX.MDP3",symbols:u.searchParams.get("symbols")||"ES.c.0",schema:"ohlcv-1m",stype_in:"continuous",start:u.searchParams.get("start")||"2026-08-04",end:u.searchParams.get("end")||"2026-08-05",encoding:"json"});
    const r=await fetch(`${BASE}/timeseries.get_range`,{method:"POST",headers:{...AUTH,"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});
    const txt=await r.text();
    return new Response(JSON.stringify({ok:r.ok,status:r.status,action:"peek",sample:txt.slice(0,900)}),{headers:cors});
  }
  return new Response(JSON.stringify({ok:false,err:"unknown action (test|schemas|cost|peek|load)"}),{status:400,headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
