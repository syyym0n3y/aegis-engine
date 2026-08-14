// trd-futures-orb-exec — deploys the VALIDATED 8:15 ET ORB-FOLLOW (D-287, ES +0.086R OOS-stable) to the futures
// candidate family, executed on the INTERNAL keyless+free futures paper-broker (D-288): signal + fills from real
// KEYLESS Yahoo futures prices (ES=F/NQ=F/GC=F). 08:15-08:30 ET opening range → follow the first break after 08:30;
// stop=opposite extreme, target=+1 width; poll-managed. P&L in $ (points×multiplier). Forward-tracks futures edges
// with zero broker, zero key, zero cost. NOT live money. Guards: killswitch + arm + per-day dedup. Cron ~every 15m 8:30-11 ET.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const INSTR:[string,number][]=[["ES=F",50],["NQ=F",20],["GC=F",100]]; // yahoo sym, $ per point
const WS=495,WE=510; // 08:15-08:30 ET
interface Bar{h:number;l:number;c:number;m:number;d:string}
function etOf(t:number){const y=new Date(t*1000).getUTCFullYear();const mar1=new Date(Date.UTC(y,2,1)).getUTCDay();const ds=Date.UTC(y,2,1+((7-mar1)%7)+7,7)/1000;const nov1=new Date(Date.UTC(y,10,1)).getUTCDay();const de=Date.UTC(y,10,1+((7-nov1)%7),6)/1000;const off=(t>=ds&&t<de)?-4:-5;const d=new Date((t+off*3600)*1000);return{m:d.getUTCHours()*60+d.getUTCMinutes(),d:d.toISOString().slice(0,10)};}
async function y5m(sym:string):Promise<Bar[]>{try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=5d`,{headers:{"User-Agent":"Mozilla/5.0"}});if(!r.ok)return[];const j=await r.json();const res=j?.chart?.result?.[0];if(!res?.timestamp)return[];const q=res.indicators.quote[0],o:Bar[]=[];for(let i=0;i<res.timestamp.length;i++){const h=q.high[i],l=q.low[i],c=q.close[i];if([h,l,c].some((x:number)=>x==null||!Number.isFinite(x)))continue;const e=etOf(res.timestamp[i]);o.push({h,l,c,m:e.m,d:e.d});}return o;}catch{return[];}}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch"}),{headers:cors});
  const dbg=new URL(req.url).searchParams.get("debug")==="1";
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed&&!dbg)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const cfg=await fetch(`${SB}/rest/v1/trd_exec_config?edge=eq.futures-orb815&select=size_notional`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const LOTS=Math.max(1,Math.round(Number(cfg?.[0]?.size_notional)||1)); // config-driven lot size (D-294); scale = update trd_exec_config
  const out:Record<string,unknown>[]=[];
  for(const [sym,mult] of INSTR){const b=await y5m(sym);if(b.length<5){out.push({sym,skip:"no bars"});continue;}
    const px=b[b.length-1].c,today=b[b.length-1].d;
    // MANAGE open
    const openRows=await fetch(`${SB}/rest/v1/trd_futures_paper?edge=eq.futures-orb815&sym=eq.${encodeURIComponent(sym)}&status=eq.open&select=id,side,entry_px,stop,target,qty&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]);
    const held=Array.isArray(openRows)&&openRows.length?openRows[0]:null;
    if(held){const hitStop=held.side==="long"?px<=held.stop:px>=held.stop,hitTgt=held.side==="long"?px>=held.target:px<=held.target;
      if(hitStop||hitTgt){const exit=hitStop?held.stop:held.target;const pnl=(held.side==="long"?exit-held.entry_px:held.entry_px-exit)*mult*held.qty;
        if(!dbg)await fetch(`${SB}/rest/v1/trd_futures_paper?id=eq.${held.id}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({status:"closed",exit_px:exit,exit_at:new Date().toISOString(),pnl_usd:+pnl.toFixed(2)})}).catch(()=>{});
        out.push({sym,action:"EXIT",reason:hitStop?"stop":"target",pnl:+pnl.toFixed(2)});continue;}
      out.push({sym,action:"hold",px});continue;}
    // ENTRY after 08:30 on first break of the 08:15-08:30 range, once/day
    const rB=b.filter(x=>x.d===today&&x.m>=WS&&x.m<WE),post=b.filter(x=>x.d===today&&x.m>=WE);
    if(rB.length<2){out.push({sym,skip:"range forming/pre-8:15"});continue;}
    if(post.length<1){out.push({sym,skip:"pre-8:30 ET"});continue;}
    const fired=await fetch(`${SB}/rest/v1/trd_futures_paper?edge=eq.futures-orb815&sym=eq.${encodeURIComponent(sym)}&entry_at=gte.${today}T00:00:00Z&select=id&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]);
    if(Array.isArray(fired)&&fired.length){out.push({sym,skip:"fired today"});continue;}
    const rH=Math.max(...rB.map(x=>x.h)),rL=Math.min(...rB.map(x=>x.l)),w=rH-rL;if(!(w>0)){out.push({sym,skip:"zero width"});continue;}
    let dir=0;for(const x of post){if(x.h>rH){dir=1;break;}if(x.l<rL){dir=-1;break;}}
    if(dir===0){out.push({sym,skip:"no break yet"});continue;}
    const entry=dir>0?rH:rL,stop=dir>0?rL:rH,tgt=dir>0?entry+w:entry-w;
    // CONVICTION SIZING (D-295): flex lots by MEASURED setup quality (D-271 OOS-validated: tight range +0.126R most
    // stable, up-break +0.148R holds; wide/down weaker). tight+up → up to 1.8x base; wide+down → ~0.5x.
    const dHi=new Map<string,number>(),dLo=new Map<string,number>();
    for(const x of b){if(x.d!==today&&x.m>=WS&&x.m<WE){dHi.set(x.d,Math.max(dHi.get(x.d)??-1e18,x.h));dLo.set(x.d,Math.min(dLo.get(x.d)??1e18,x.l));}}
    const priorW=[...dHi.keys()].map(d=>dHi.get(d)!-dLo.get(d)!).filter(v=>v>0).sort((a,b)=>a-b);
    const medW=priorW.length?priorW[Math.floor(priorW.length/2)]:w;
    // D-298: conviction backtest on ES cash_open showed the DIRECTION axis is validated (up-breaks
    // +0.048R > down +0.039R → up×1.2/down×0.85 = +5.4% P&L) but the RANGE-tightness multiplier (tuned
    // on crypto D-271) is NOT validated on futures — tight-range ES buckets are noisy/negative. So range
    // stays NEUTRAL (1.0) here until per-instrument-validated; only the validated direction axis sizes.
    const tightMult=1.0;
    const dirMult=dir>0?1.2:0.85;
    const conv=tightMult*dirMult;const lots=Math.max(1,Math.min(LOTS*2,Math.round(LOTS*conv)));
    const rangeQ=w<0.8*medW?"tight":w>1.3*medW?"wide":"normal";
    if(dbg){out.push({sym,would:"ENTER",dir:dir>0?"long":"short",lots,base:LOTS,conviction:+conv.toFixed(2),range:rangeQ,entry:+entry.toFixed(2),stop:+stop.toFixed(2),tgt:+tgt.toFixed(2),w:+w.toFixed(2)});continue;}
    await fetch(`${SB}/rest/v1/trd_futures_paper`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({edge:"futures-orb815",sym,side:dir>0?"long":"short",qty:lots,entry_px:+entry.toFixed(2),stop:+stop.toFixed(2),target:+tgt.toFixed(2),status:"open"})}).catch(()=>{});
    out.push({sym,action:"ENTER",dir:dir>0?"long":"short",lots,conviction:+conv.toFixed(2),range:rangeQ});
  }
  await fetch(`${SB}/rest/v1/rpc/trd_beat`,{method:"POST",headers:H,body:JSON.stringify({p_fn:"trd-futures-orb-exec",p_outcome:out.map(o=>o.action||o.skip||"?").join(",").slice(0,180)||"ran"})}).catch(()=>{}); // D-304 completion heartbeat
  return new Response(JSON.stringify({ok:true,edge:"futures-orb815",broker:"internal keyless paper (Yahoo fills)",results:out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
