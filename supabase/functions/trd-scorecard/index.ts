// trd-scorecard — the "judge from it" view (D-253): per-edge FORWARD performance + the weekly P&L curve + gate
// progress, so each edge is on display and separable from legacy positions. Reconciles closed trades from Alpaca
// fills (matches a SELL fill to the open logged long per symbol), aggregates per edge, and reports vs the ≥30-trade
// PAPER→MICRO gate. READ + reconcile only; NO new orders.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const DEPOSIT=100000,LEGACY=2239.25;  // one-time gain from the two pre-existing crypto longs (D-235) — NOT edge alpha
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const [positions,openTradesRaw,fillsRaw,acct,hist,pairsOpen,xsecOpen]=await Promise.all([
    fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_trades?status=eq.open&select=id,edge,sym,side,qty,entry_px`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${PAPER}/v2/account/activities?activity_types=FILL&direction=desc&page_size=500`,{headers:AH}).then(r=>r.json()).catch(()=>[]),
    fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json()).catch(()=>({})),
    fetch(`${PAPER}/v2/account/portfolio/history?period=1W&timeframe=1D`,{headers:AH}).then(r=>r.json()).catch(()=>({})),
    fetch(`${SB}/rest/v1/trd_pairs_pos?open=eq.true&select=leg_a,leg_b`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_xsec_pos?open=eq.true&select=sym`,{headers:H}).then(r=>r.json()).catch(()=>[]),
  ]);
  const posSet=new Set((positions as {symbol:string}[]).map(p=>p.symbol));
  // sell fills per symbol (for reconciling closed longs) — most recent first
  const sellsBySym=new Map<string,{price:number,time:string}[]>();
  for(const f of (Array.isArray(fillsRaw)?fillsRaw:[]) as {symbol:string,side:string,price:string,transaction_time:string}[]){
    if(f.side==="sell"){const a=sellsBySym.get(f.symbol)||[];a.push({price:+f.price,time:f.transaction_time});sellsBySym.set(f.symbol,a);}}
  // RECONCILE: open logged trade whose symbol is no longer held → closed; realized from the matching sell fill
  let reconciled=0;
  for(const t of (openTradesRaw as {id:string,sym:string,qty:number,entry_px:number,side:string}[])){
    if(posSet.has(t.sym))continue;const sells=sellsBySym.get(t.sym);if(!sells||!sells.length)continue;
    const exit=sells[0].price;const realized=+((exit-t.entry_px)*t.qty).toFixed(2);
    await fetch(`${SB}/rest/v1/trd_trades?id=eq.${t.id}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({status:"closed",exit_px:exit,exit_at:sells[0].time,realized_pnl:realized})}).catch(()=>{});
    reconciled++;}
  // per-edge from trd_trades (closed + open)
  const closed=await fetch(`${SB}/rest/v1/trd_trades?status=eq.closed&select=edge,realized_pnl`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const openNow=await fetch(`${SB}/rest/v1/trd_trades?status=eq.open&select=edge`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const byEdge:Record<string,{closed:number,wins:number,realized:number,open:number}>={};
  const get=(e:string)=>byEdge[e]||(byEdge[e]={closed:0,wins:0,realized:0,open:0});
  for(const c of closed as {edge:string,realized_pnl:number}[]){const g=get(c.edge);g.closed++;g.realized+=c.realized_pnl||0;if((c.realized_pnl||0)>0)g.wins++;}
  for(const o of openNow as {edge:string}[])get(o.edge).open++;
  // also attribute LIVE Alpaca positions per edge (covers edges that don't log to trd_trades yet)
  const pairLegs=new Set<string>();for(const p of (pairsOpen as {leg_a:string,leg_b:string}[]))for(const s of [p.leg_a,p.leg_b])pairLegs.add(s);
  const xsecSyms=new Set((xsecOpen as {sym:string}[]).map(x=>x.sym));
  const liveByEdge:Record<string,{n:number,unreal:number}>={};
  for(const p of (positions as {symbol:string,side:string,unrealized_pl:string,asset_class?:string}[])){
    const edge=p.asset_class==="crypto"?"crypto-momentum":p.symbol==="SVXY"?"vrp":pairLegs.has(p.symbol)?"pairs":xsecSyms.has(p.symbol)?"xsec-momentum":p.side==="short"?"rip-short":"bblo";
    const g=liveByEdge[edge]||(liveByEdge[edge]={n:0,unreal:0});g.n++;g.unreal+=+p.unrealized_pl||0;}
  const equity=Number(acct.equity)||0;
  const perEdge=Object.keys({...byEdge,...liveByEdge}).sort().map(e=>({edge:e,
    closed_trades:byEdge[e]?.closed||0, win_pct:byEdge[e]?.closed?+(byEdge[e].wins/byEdge[e].closed*100).toFixed(0):null,
    realized_pnl:+(byEdge[e]?.realized||0).toFixed(2), open_positions:liveByEdge[e]?.n||0, open_unreal:+(liveByEdge[e]?.unreal||0).toFixed(2)}));
  const totalClosed=(closed as unknown[]).length;const realizedTotal=+(equity-DEPOSIT-((positions as {unrealized_pl:string}[]).reduce((a,p)=>a+ +p.unrealized_pl,0))).toFixed(2);
  const weekly=(hist?.timestamp||[]).map((t:number,i:number)=>({d:new Date(t*1000).toISOString().slice(0,10),pl:+(hist.profit_loss?.[i]||0).toFixed(2)}));
  return new Response(JSON.stringify({ok:true,equity:+equity.toFixed(2),
    edge_realized_excl_legacy:+(realizedTotal-LEGACY).toFixed(2), legacy_crypto_gain:LEGACY,
    reconciled_this_run:reconciled, gate:{closed_edge_trades:totalClosed, target:30, pct:+(totalClosed/30*100).toFixed(0)},
    perEdge, weekly},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
