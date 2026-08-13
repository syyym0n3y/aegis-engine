// trd-crypto-orb-exec — FORWARD candidate (D-285): ETH/SOL US-open ORB-follow (validated free on Binance 2.5yr,
// ETH/SOL t=2.35 OOS-hold, D-284). Signal from FREE Binance; execution on Alpaca crypto (paper). 24/7 so no EOD
// flatten — poll-managed bracket (stop=opposite range extreme, target=+1 width, 48h time-stop). NOT validated;
// small size, forward-tracked. Guards: killswitch + arm + per-day dedup. Cron ~every 30m across/after the US open.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const SYMS:[string,string,string][]=[["ETHUSDT","ETH/USD","ETHUSD"],["SOLUSDT","SOL/USD","SOLUSD"]]; // binance, alpaca-order, alpaca-pos
const NOTIONAL=0.02,WS=810,WE=870; // 13:30-14:30 UTC opening range
async function bnb(sym:string){try{const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=120`);if(!r.ok)return[];const j=await r.json();
  return (j as number[][]).map(k=>{const dt=new Date(k[0]);return{h:+k[2],l:+k[3],c:+k[4],m:dt.getUTCHours()*60+dt.getUTCMinutes(),d:dt.toISOString().slice(0,10)};});}catch{return[];}}
async function closePos(sym:string){await fetch(`${PAPER}/v2/positions/${encodeURIComponent(sym)}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>{});}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(ks?.[0]?.active)return new Response(JSON.stringify({ok:true,skipped:"kill-switch active"}),{headers:cors});
  const dbg=new URL(req.url).searchParams.get("debug")==="1";
  const arm=await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  if(!arm?.[0]?.armed&&!dbg)return new Response(JSON.stringify({ok:true,skipped:"NOT ARMED"}),{headers:cors});
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());const equity=Number(acct.equity)||100000;
  const today=new Date().toISOString().slice(0,10);const utcMin=new Date().getUTCHours()*60+new Date().getUTCMinutes();
  const out:Record<string,unknown>[]=[];
  for(const [bsym,osym,psym] of SYMS){
    const b=await bnb(bsym);if(b.length<10){out.push({sym:psym,skip:"no bars"});continue;}
    const px=b[b.length-1].c;
    // MANAGE open position (poll-bracket): stop / target / 48h
    const openRows=await fetch(`${SB}/rest/v1/trd_trades?edge=eq.crypto-orb&sym=eq.${psym}&status=eq.open&select=id,side,entry_px,stop,target,entry_at&order=entry_at.desc&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]);
    const held=Array.isArray(openRows)&&openRows.length?openRows[0]:null;
    if(held){const age=(Date.now()-new Date(held.entry_at).getTime())/36e5;
      const hitStop=held.side==="long"?px<=held.stop:px>=held.stop, hitTgt=held.side==="long"?px>=held.target:px<=held.target;
      if(hitStop||hitTgt||age>=48){if(!dbg){await closePos(psym);await fetch(`${SB}/rest/v1/trd_trades?id=eq.${held.id}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({status:"closed",exit_px:px,exit_at:new Date().toISOString()})}).catch(()=>{});}
        out.push({sym:psym,action:"EXIT",reason:hitStop?"stop":hitTgt?"target":"48h",px});continue;}
      out.push({sym:psym,action:"hold",px,age:+age.toFixed(1)});continue;}
    // ENTRY: after the window, on the first break, once/day
    const rangeB=b.filter(x=>x.d===today&&x.m>=WS&&x.m<WE),post=b.filter(x=>x.d===today&&x.m>=WE);
    if(rangeB.length<2){out.push({sym:psym,skip:"range forming/pre-open"});continue;}
    if(post.length<1){out.push({sym:psym,skip:"pre-14:30 UTC"});continue;}
    const fired=await fetch(`${SB}/rest/v1/trd_trades?edge=eq.crypto-orb&sym=eq.${psym}&entry_at=gte.${today}T00:00:00Z&select=id&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]);
    if(Array.isArray(fired)&&fired.length){out.push({sym:psym,skip:"fired today"});continue;}
    const rH=Math.max(...rangeB.map(x=>x.h)),rL=Math.min(...rangeB.map(x=>x.l)),w=rH-rL;if(!(w>0)){out.push({sym:psym,skip:"zero width"});continue;}
    let dir=0;for(const x of post){if(x.h>rH){dir=1;break;}if(x.l<rL){dir=-1;break;}}
    if(dir===0){out.push({sym:psym,skip:"no break yet"});continue;}
    const entry=dir>0?rH:rL,stop=dir>0?rL:rH,tgt=dir>0?entry+w:entry-w,qty=+((NOTIONAL*equity)/px).toFixed(4);
    if(dbg){out.push({sym:psym,would:"ENTER",dir:dir>0?"long":"short",qty,entry:+entry.toFixed(2),stop:+stop.toFixed(2),tgt:+tgt.toFixed(2)});continue;}
    const resp=await fetch(`${PAPER}/v2/orders`,{method:"POST",headers:AH,body:JSON.stringify({symbol:osym,qty:String(qty),side:dir>0?"buy":"sell",type:"market",time_in_force:"gtc"})});
    const ok=resp.ok;
    if(ok)await fetch(`${SB}/rest/v1/trd_trades`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({edge:"crypto-orb",sym:psym,side:dir>0?"long":"short",qty,entry_px:+px.toFixed(2),stop:+stop.toFixed(2),target:+tgt.toFixed(2),status:"open"})}).catch(()=>{});
    out.push({sym:psym,action:ok?"ENTER":"reject",dir:dir>0?"long":"short",qty,detail:ok?undefined:(await resp.text()).slice(0,140)});
  }
  return new Response(JSON.stringify({ok:true,edge:"crypto-orb",utcMin,results:out},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
