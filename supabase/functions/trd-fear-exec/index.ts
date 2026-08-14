// trd-fear-exec — FORWARD-TRACKED candidate (D-277), NOT a validated edge. Consolidated VRP/fear signal: long IVV
// (S&P 500; distinct ticker from orbfollow's SPY to avoid Alpaca position-merge) when fear is elevated —
// VIX >= trailing-252 80th pct OR VIX3M < VIX (backwardation) — hold ~10 trading days OR until fear normalizes.
// Purpose: accumulate INDEPENDENT FORWARD trades so a near-miss (t=2.23 in-sample, sub-DSR) earns an honest verdict.
// Paper only. Guards: killswitch + arm 'paper' + dedup (one open fear position). Daily cron.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const SYM="IVV",HOLD_CAL_DAYS=14,NOTIONAL=0.05; // ~10 trading days ≈ 14 calendar; 5% notional/position
async function closes(sym:string,range:string):Promise<{d:string,c:number}[]>{try{
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:{d:string,c:number}[]=[];
  for(let i=0;i<res.timestamp.length;i++){const c=q.close[i];if(c!=null&&Number.isFinite(c))o.push({d:new Date(res.timestamp[i]*1000).toISOString().slice(0,10),c});}return o;}catch{return[];}}
// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-fear-exec", p_outcome: o.slice(0, 180) }),
  }).catch(() => {});
const SERVE = (h: (r: Request) => Response | Promise<Response>) =>
  Deno.serve(async (r: Request) => {
    let res: Response;
    try { res = await h(r); } catch (e) { await __beat("THREW " + String(e).slice(0, 150)); throw e; }
    let body = "";
    try { body = (await res.clone().text()).replace(/\s+/g, " ").slice(0, 150); } catch { /* unreadable body */ }
    await __beat(`${res.status} ${body}`);
    return res;
  });

SERVE(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const dbg=new URL(req.url).searchParams.get("debug")==="1";
  if(!arm?.[0]?.armed&&!dbg)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  // signal
  const vix=await closes("^VIX","2y"),vix3=await closes("^VIX3M","5d");
  if(vix.length<60)throw new Error("no VIX");
  const v=vix[vix.length-1].c,V3=vix3.length?vix3[vix3.length-1].c:null;
  const w=vix.slice(-252).map(x=>x.c).sort((a,b)=>a-b);const p80=w[Math.floor(w.length*0.8)];
  const backwardation=V3!=null&&V3<v;const elevated=v>=p80;const fear=backwardation||elevated;
  const vmed=w[Math.floor(w.length*0.5)];
  // open fear position?
  const open=await fetch(`${SB}/rest/v1/trd_trades?edge=eq.fear&status=eq.open&select=id,entry_at&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const held=Array.isArray(open)&&open.length?open[0]:null;
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity)||100000;
  if(held){
    const ageDays=(Date.now()-new Date(held.entry_at).getTime())/864e5;const normalized=!fear&&v<vmed;
    if(ageDays>=HOLD_CAL_DAYS||normalized){
      if(!dbg){await fetch(`${PAPER}/v2/positions/${SYM}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>{});
        await fetch(`${SB}/rest/v1/trd_trades?id=eq.${held.id}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({status:"closed",exit_at:new Date().toISOString()})}).catch(()=>{});}
      return new Response(JSON.stringify({ok:true,edge:"fear",action:"EXIT",reason:normalized?"fear normalized":`held ${ageDays.toFixed(1)}d`,vix:v,vix3m:V3}),{headers:cors});
    }
    return new Response(JSON.stringify({ok:true,edge:"fear",action:"hold",ageDays:+ageDays.toFixed(1),vix:v,fear}),{headers:cors});
  }
  if(!fear)return new Response(JSON.stringify({ok:true,edge:"fear",action:"flat",reason:"no elevated fear",vix:v,vix3m:V3,p80:+p80.toFixed(2)}),{headers:cors});
  // ENTRY
  const px=(await closes(SYM,"5d")).slice(-1)[0]?.c;if(!px)throw new Error("no IVV px");
  const qty=Math.max(1,Math.floor((NOTIONAL*equity)/px));
  const trig=backwardation?"backwardation (VIX3M<VIX)":`VIX>=80pct (${v.toFixed(1)}>=${p80.toFixed(1)})`;
  if(dbg)return new Response(JSON.stringify({ok:true,edge:"fear",would:"ENTER",sym:SYM,qty,px,trigger:trig,vix:v,vix3m:V3}),{headers:cors});
  const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify({symbol:SYM,qty,side:"buy",type:"market",time_in_force:"day"})});
  const ok=resp.ok;
  if(ok)await fetch(`${SB}/rest/v1/trd_trades`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({edge:"fear",sym:SYM,side:"long",qty,entry_px:+px.toFixed(2),status:"open"})}).catch(()=>{});
  return new Response(JSON.stringify({ok,edge:"fear",action:ok?"ENTER":"reject",sym:SYM,qty,px,trigger:trig,detail:ok?undefined:(await resp.text()).slice(0,160)}),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
