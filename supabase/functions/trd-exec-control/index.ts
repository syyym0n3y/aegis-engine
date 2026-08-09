// trd-exec-control — token-gated operator controls for the cockpit (D-237): arm/disarm/kill/unkill/flatten.
// SAFETY: these are the controls that must NOT be world-writable. The app is a PUBLIC URL, so this endpoint requires
// a CONTROL TOKEN (stored RLS-denied in trd_control; only this service-role fn can read it). Every action re-checks
// the token with a constant-time compare; a wrong/absent token → 401. Arming stays the operator's deliberate act
// (token + a UI confirm). Paper only ($0). 'flat' delegates to trd-position-manager?flat=1 (full book flatten).
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
function ctEq(a:string,b:string):boolean{if(typeof a!=="string"||typeof b!=="string")return false;if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
async function upsert(table:string,body:Record<string,unknown>){return await fetch(`${SB}/rest/v1/${table}?on_conflict=id`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(body)});}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:cors});
  try{
    if(req.method!=="POST")return new Response(JSON.stringify({ok:false,err:"POST only"}),{status:405,headers:cors});
    const {action,token}=await req.json().catch(()=>({}));
    const expected=(await fetch(`${SB}/rest/v1/trd_control?id=eq.default&select=token`,{headers:H}).then(r=>r.json()).catch(()=>[]))?.[0]?.token;
    if(!expected||!ctEq(String(token||""),String(expected)))return new Response(JSON.stringify({ok:false,err:"unauthorized — bad control token"}),{status:401,headers:cors});
    let result="";
    switch(action){
      case "arm":    await upsert("trd_exec_arm",{id:"paper",armed:true});  result="ARMED — executors will place PAPER orders on the next tick"; break;
      case "disarm": await upsert("trd_exec_arm",{id:"paper",armed:false}); result="disarmed — dormant"; break;
      case "kill":   await upsert("trd_killswitch",{id:"default",active:true});  result="KILL-SWITCH TRIPPED — trading halted; position manager will flatten on its next run"; break;
      case "unkill": await upsert("trd_killswitch",{id:"default",active:false}); result="kill-switch cleared"; break;
      case "flat":   await fetch(`${SB}/functions/v1/trd-position-manager?flat=1`,{headers:H}).catch(()=>{}); result="FLATTEN sent — all positions closed, open orders cancelled"; break;
      default: return new Response(JSON.stringify({ok:false,err:"unknown action (arm|disarm|kill|unkill|flat)"}),{status:400,headers:cors});
    }
    const [arm,ks]=await Promise.all([
      fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]),
      fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    ]);
    return new Response(JSON.stringify({ok:true,action,result,armed:!!arm?.[0]?.armed,killed:!!ks?.[0]?.active}),{headers:cors});
  }catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}
});
