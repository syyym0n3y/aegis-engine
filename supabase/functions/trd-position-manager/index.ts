// trd-position-manager — risk overlay (D-230/D-252). (1) P&L snapshot → trd_pnl_snapshot. (2) SCOPED thesis exits:
// crypto → Donchian-20-low trail; rip-short SHORTS → 200MA cover. Every other edge (pairs/xsec/vrp/bblo) manages its
// OWN exit — the manager skips those symbols so it can't corrupt a pair, a factor basket, SVXY, or a bblo MR long.
// (3) KILL-SWITCH/?flat=1 = universal FLATTEN. ?flatcrypto=1 closes all crypto. ?cancelsyms=A,B cancels open orders.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets",DATA="https://data.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const MALEN=200,DEPOSIT=100000;
async function ma200(sym:string):Promise<{close:number,ma:number}|null>{const start=new Date(Date.now()-400*864e5).toISOString().slice(0,10);const r=await fetch(`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&feed=iex&limit=400`,{headers:AH}).then(x=>x.json()).catch(()=>null);const bs=r?.bars??[];if(bs.length<MALEN+1)return null;const cl=bs.map((b:{c:number})=>b.c);const ma=cl.slice(-MALEN).reduce((a:number,x:number)=>a+x,0)/MALEN;return{close:cl[cl.length-1],ma};}
async function closePos(sym:string){return (await fetch(`${PAPER}/v2/positions/${sym}?percentage=100`,{method:"DELETE",headers:AH}).catch(()=>null))?.ok;}
async function donchianLow(sym:string):Promise<{close:number,dl:number}|null>{const y=sym.replace(/USD$/,"-USD");const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?interval=1d&range=3mo`,{headers:{"User-Agent":"Mozilla/5.0"}}).then(x=>x.json()).catch(()=>null);const res=r?.chart?.result?.[0];if(!res?.timestamp)return null;const q=res.indicators.quote[0];const lows:number[]=[],closes:number[]=[];for(let i=0;i<res.timestamp.length;i++){const l=q.low[i],c=q.close[i];if(l!=null&&c!=null&&Number.isFinite(l)&&Number.isFinite(c)){lows.push(l);closes.push(c);}}if(closes.length<21)return null;const close=closes[closes.length-1];let dl=1e18;for(let k=lows.length-1-20;k<lows.length-1;k++)dl=Math.min(dl,lows[k]);return{close,dl};}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const flatParam=new URL(req.url).searchParams.get("flat")==="1";
  const flatCrypto=new URL(req.url).searchParams.get("flatcrypto")==="1";
  const cancelSyms=(new URL(req.url).searchParams.get("cancelsyms")||"").split(",").map(s=>s.trim()).filter(Boolean);
  if(cancelSyms.length){const oo=await fetch(`${PAPER}/v2/orders?status=open&limit=200`,{headers:AH}).then(r=>r.json()).catch(()=>[]);const cancelled:string[]=[];
    for(const o of (Array.isArray(oo)?oo:[]) as {id:string,symbol:string}[]){if(cancelSyms.includes(o.symbol)){const ok=(await fetch(`${PAPER}/v2/orders/${o.id}`,{method:"DELETE",headers:AH}).catch(()=>null))?.ok;if(ok)cancelled.push(o.symbol);}}
    return new Response(JSON.stringify({ok:true,cancelled}),{headers:cors});}
  const [ks,pairsOpen,xsecOpen,ripDis]=await Promise.all([
    fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_pairs_pos?open=eq.true&select=leg_a,leg_b`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_xsec_pos?open=eq.true&select=sym`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_edge_disable?edge=eq.ripshort&select=disabled`,{headers:H}).then(r=>r.json()).catch(()=>[]),
  ]);
  const killed=!!ks?.[0]?.active;
  // D-278: rip-short is disabled → NO rip-short positions should exist, so any equity SHORT is an orbfollow-scanner
  // short that self-exits via its bracket. Skip 200MA short-cover entirely when rip-short is off (avoids over-reach).
  const ripDisabled=!!(ripDis?.[0]?.disabled);
  const ownedElsewhere=new Set<string>(["SVXY","SPY","QQQ","DIA","GLD"]);  // SVXY=vrp; SPY/QQQ/DIA/GLD=orbfollow (own bracket exit)
  for(const p of (pairsOpen as {leg_a:string,leg_b:string}[]))for(const s of [p.leg_a,p.leg_b])ownedElsewhere.add(s);
  for(const x of (xsecOpen as {sym:string}[]))ownedElsewhere.add(x.sym);
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json());
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const actions:string[]=[];
  if((killed||flatParam)&&Array.isArray(positions)&&positions.length){
    await fetch(`${PAPER}/v2/positions?cancel_orders=true`,{method:"DELETE",headers:AH}).catch(()=>null);
    for(const p of positions)actions.push(`FLATTEN ${p.symbol} (${killed?"kill-switch":"manual flat"})`);
  } else if(Array.isArray(positions)){
    for(const p of positions as {symbol:string,side:string,unrealized_pl:string,asset_class?:string}[]){
      if(p.asset_class==="crypto"){
        if(flatCrypto){const ok=await closePos(p.symbol);if(ok)actions.push(`FLATTEN ${p.symbol} crypto — operator thesis-exit, P&L ${(+p.unrealized_pl).toFixed(2)}`);continue;}
        const d=await donchianLow(p.symbol);if(!d)continue;
        if(d.close<d.dl){const ok=await closePos(p.symbol);if(ok)actions.push(`EXIT ${p.symbol} crypto — momentum trail broke (close ${d.close.toFixed(2)} < 20d-low ${d.dl.toFixed(2)}), P&L ${(+p.unrealized_pl).toFixed(2)}`);}
        continue;
      }
      if(ownedElsewhere.has(p.symbol))continue;
      if(p.side!=="short"||ripDisabled)continue;  // orbfollow shorts self-exit via bracket; no rip-short when disabled
      const m=await ma200(p.symbol);if(!m)continue;
      if(m.close>m.ma){const ok=await closePos(p.symbol);if(ok)actions.push(`EXIT ${p.symbol} short — rip-short thesis flipped (close ${m.close.toFixed(2)} > 200MA ${m.ma.toFixed(2)}), P&L ${(+p.unrealized_pl).toFixed(2)}`);}
    }
  }
  const pos2=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const equity=Number(acct.equity),cash=Number(acct.cash);
  const unreal=Array.isArray(pos2)?pos2.reduce((a:number,p:{unrealized_pl:string})=>a+ +p.unrealized_pl,0):0;
  const totalPnl=equity-DEPOSIT;
  const detail=Array.isArray(pos2)?pos2.map((p:{symbol:string,side:string,qty:string,avg_entry_price:string,current_price:string,unrealized_pl:string,unrealized_plpc:string})=>({sym:p.symbol,side:p.side,qty:+p.qty,entry:+p.avg_entry_price,px:+p.current_price,pnl:+(+p.unrealized_pl).toFixed(2),pnlPct:+(+p.unrealized_plpc*100).toFixed(2)})):[];
  await fetch(`${SB}/rest/v1/trd_pnl_snapshot`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({equity:+equity.toFixed(2),cash:+cash.toFixed(2),unrealized_pl:+unreal.toFixed(2),total_pnl:+totalPnl.toFixed(2),positions:detail.length,detail,actions})}).catch(()=>{});
  return new Response(JSON.stringify({ok:true,killed,equity:+equity.toFixed(2),totalPnl:+totalPnl.toFixed(2),totalPnlPct:+((totalPnl/DEPOSIT)*100).toFixed(2),unrealized_pl:+unreal.toFixed(2),positions:detail,actions},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
