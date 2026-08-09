// trd-position-manager — risk overlay for the paper book (D-230). (1) P&L: equity, unrealized, total-vs-deposit,
// per-position; persisted to trd_pnl_snapshot. (2) THESIS EXITS: close a position when price crosses its 200MA AGAINST
// it (short recovers >200MA / long breaks <200MA) — "analysis no longer on our side directionally", beyond the hard
// bracket SL/TP. (3) KILL-SWITCH = true FLATTEN (closes everything). Paper only. Bracket SL/TP (2ATR stop, 3R target)
// stay attached at entry; this manages the SOFT exit. ?flat=1 forces a full flatten.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets",DATA="https://data.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const MALEN=200,DEPOSIT=100000;
async function ma200(sym:string):Promise<{close:number,ma:number}|null>{const start=new Date(Date.now()-400*864e5).toISOString().slice(0,10);const r=await fetch(`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&feed=iex&limit=400`,{headers:AH}).then(x=>x.json()).catch(()=>null);const bs=r?.bars??[];if(bs.length<MALEN+1)return null;const cl=bs.map((b:{c:number})=>b.c);const ma=cl.slice(-MALEN).reduce((a:number,x:number)=>a+x,0)/MALEN;return{close:cl[cl.length-1],ma};}
async function closePos(sym:string){return (await fetch(`${PAPER}/v2/positions/${sym}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>null))?.ok;}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const flatParam=new URL(req.url).searchParams.get("flat")==="1";
  const ks=await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const killed=!!ks?.[0]?.active;
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const actions:string[]=[];
  // KILL-SWITCH or ?flat=1 → flatten everything
  if((killed||flatParam)&&Array.isArray(positions)&&positions.length){
    await fetch(`${PAPER}/v2/positions?cancel_orders=true`,{method:"DELETE",headers:AH}).catch(()=>null);
    for(const p of positions)actions.push(`FLATTEN ${p.symbol} (${killed?"kill-switch":"manual flat"})`);
  } else if(Array.isArray(positions)){
    // thesis exits: close when price crosses 200MA against the position
    for(const p of positions as {symbol:string,side:string,unrealized_pl:string}[]){
      const m=await ma200(p.symbol);if(!m)continue;
      const against = p.side==="short" ? m.close>m.ma : m.close<m.ma;   // short wants downtrend; long wants uptrend
      if(against){const ok=await closePos(p.symbol);if(ok)actions.push(`EXIT ${p.symbol} ${p.side} — thesis flipped (close ${m.close.toFixed(2)} ${p.side==="short"?">":"<"} 200MA ${m.ma.toFixed(2)}), P&L ${(+p.unrealized_pl).toFixed(2)}`);}
    }
  }
  // P&L snapshot (re-read positions after any closes)
  const pos2=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const equity=Number(acct.equity),cash=Number(acct.cash);
  const unreal=Array.isArray(pos2)?pos2.reduce((a:number,p:{unrealized_pl:string})=>a+ +p.unrealized_pl,0):0;
  const totalPnl=equity-DEPOSIT;
  const detail=Array.isArray(pos2)?pos2.map((p:{symbol:string,side:string,qty:string,avg_entry_price:string,current_price:string,unrealized_pl:string,unrealized_plpc:string})=>({sym:p.symbol,side:p.side,qty:+p.qty,entry:+p.avg_entry_price,px:+p.current_price,pnl:+(+p.unrealized_pl).toFixed(2),pnlPct:+(+p.unrealized_plpc*100).toFixed(2)})):[];
  await fetch(`${SB}/rest/v1/trd_pnl_snapshot`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({equity:+equity.toFixed(2),cash:+cash.toFixed(2),unrealized_pl:+unreal.toFixed(2),total_pnl:+totalPnl.toFixed(2),positions:detail.length,detail,actions})}).catch(()=>{});
  return new Response(JSON.stringify({ok:true,killed,equity:+equity.toFixed(2),totalPnl:+totalPnl.toFixed(2),totalPnlPct:+((totalPnl/DEPOSIT)*100).toFixed(2),unrealized_pl:+unreal.toFixed(2),positions:detail,actions},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
