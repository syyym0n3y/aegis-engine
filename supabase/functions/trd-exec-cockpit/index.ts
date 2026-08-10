// trd-exec-cockpit — READ-ONLY aggregator (D-236) for the app cockpit: the 4-edge executor fleet in one call.
// Alpaca creds are server-only, so the static app can't read the broker directly — this joins account+positions with
// the durable state (trd_pairs_pos, trd_exec_arm, trd_killswitch) and the live signal snapshot (trd_edge_snapshot),
// attributes every open position to its edge, and returns per-edge {armed, signal, positions, pnl}. NO order path.
const KEYID=Deno.env.get("APCA_API_KEY_ID")??"PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET=Deno.env.get("APCA_API_SECRET_KEY")??Deno.env.get(KEYID)??"";
const AH={"APCA-API-KEY-ID":KEYID,"APCA-API-SECRET-KEY":SECRET,"Content-Type":"application/json"};
const PAPER="https://paper-api.alpaca.markets";
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const DEPOSIT=100000;
Deno.serve(async()=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const [arm,ks,pairsOpen,xsecOpen,snapArr,disArr]=await Promise.all([
    fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_pairs_pos?open=eq.true&select=pair,leg_a,leg_b,dir,entry_z`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_xsec_pos?open=eq.true&select=sym,side`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_edge_snapshot?select=edges,generated_at&order=generated_at.desc&limit=1`,{headers:H}).then(r=>r.json()).catch(()=>[]),
    fetch(`${SB}/rest/v1/trd_edge_disable?disabled=eq.true&select=edge`,{headers:H}).then(r=>r.json()).catch(()=>[]),
  ]);
  const armed=!!arm?.[0]?.armed, killed=!!ks?.[0]?.active;
  const disabledSet=new Set((disArr as {edge:string}[]).map(d=>d.edge));  // edge keys w/o punctuation, e.g. 'ripshort'
  const e=(snapArr?.[0]?.edges)||{};
  const acct=await fetch(`${PAPER}/v2/account`,{headers:AH}).then(r=>r.json()).catch(()=>({}));
  const equity=Number(acct.equity)||0, cash=Number(acct.cash)||0, bp=Number(acct.buying_power)||0;
  const positions=await fetch(`${PAPER}/v2/positions`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const openOrders=await fetch(`${PAPER}/v2/orders?status=open&limit=200`,{headers:AH}).then(r=>r.json()).catch(()=>[]);
  const pairLegs=new Map<string,string>();for(const p of (pairsOpen as {pair:string,leg_a:string,leg_b:string}[]))for(const s of [p.leg_a,p.leg_b])pairLegs.set(s,p.pair);
  const xsecSyms=new Set((xsecOpen as {sym:string}[]).map(x=>x.sym));
  // attribute by symbol + side: crypto→momentum, SVXY→vrp, pair-leg→pairs, xsec-basket→xsec-momentum,
  // else equity SHORT→rip-short, equity LONG→bblo (the two per-name equity edges)
  const attribute=(sym:string,asset:string,side:string):string=>{
    if(asset==="crypto")return "crypto-momentum";
    if(sym==="SVXY")return "vrp";
    if(pairLegs.has(sym))return "pairs";
    if(xsecSyms.has(sym))return "xsec-momentum";
    return side==="short"||side==="sell"?"rip-short":"bblo";
  };
  const posOut=(Array.isArray(positions)?positions:[]).map((p:{symbol:string,side:string,qty:string,avg_entry_price:string,current_price:string,unrealized_pl:string,unrealized_plpc:string,asset_class?:string})=>({
    sym:p.symbol,edge:attribute(p.symbol,p.asset_class||"us_equity",p.side),side:p.side,qty:+p.qty,
    entry:+p.avg_entry_price,px:+p.current_price,pnl:+(+p.unrealized_pl).toFixed(2),pnlPct:+(+p.unrealized_plpc*100).toFixed(2),
    pair:pairLegs.get(p.symbol)||null}));
  const pend=(Array.isArray(openOrders)?openOrders:[]).map((o:{symbol:string,side:string,qty:string,asset_class?:string})=>({sym:o.symbol.replace("/",""),edge:attribute(o.symbol.replace("/",""),o.asset_class||"us_equity",o.side),side:o.side,qty:+o.qty}));
  const sumP=(edge:string)=>posOut.filter(p=>p.edge===edge).reduce((a,p)=>a+p.pnl,0);
  const cntP=(edge:string)=>posOut.filter(p=>p.edge===edge).length;
  const cntPend=(edge:string)=>pend.filter(p=>p.edge===edge).length;
  const contango=e?.termStructure?.contango;
  const edges=[
    {key:"rip-short",label:"Rip-short",kind:"equity short · narrow US",
     signal:`${e?.regime?.state||"?"} · ${e?.ripShort?.note||"—"} (${e?.ripShort?.firing??0}/${e?.ripShort?.of??20})`,
     live:!!e?.ripShort?.actionable, positions:posOut.filter(p=>p.edge==="rip-short"), n:cntP("rip-short"), pending:cntPend("rip-short"), pnl:+sumP("rip-short").toFixed(2)},
    {key:"crypto-momentum",label:"Crypto momentum",kind:"Donchian long · crypto",
     signal:`${e?.cryptoMomentum?.note||"—"} (${e?.cryptoMomentum?.firing??0}/${e?.cryptoMomentum?.of??8} breaking out)`,
     live:(e?.cryptoMomentum?.firing??0)>0, positions:posOut.filter(p=>p.edge==="crypto-momentum"), n:cntP("crypto-momentum"), pending:cntPend("crypto-momentum"), pnl:+sumP("crypto-momentum").toFixed(2)},
    {key:"pairs",label:"Pairs / stat-arb",kind:"market-neutral · broad",
     signal:`${e?.pairs?.note||"—"}${e?.pairs?.which?.length?" — "+e.pairs.which.join(", "):""}`,
     live:(e?.pairs?.diverged??0)>0||cntP("pairs")>0, positions:posOut.filter(p=>p.edge==="pairs"), n:cntP("pairs"), pending:cntPend("pairs"), pnl:+sumP("pairs").toFixed(2)},
    {key:"vrp",label:"VRP short-vol (SVXY proxy)",kind:"vol carry · broad",
     signal:`${contango?"contango":"backwardation"} — VIX ${e?.termStructure?.vix??"?"} / 3M ${e?.termStructure?.vix3m??"?"} · ${e?.vrp?.note||""}`,
     live:!!contango, positions:posOut.filter(p=>p.edge==="vrp"), n:cntP("vrp"), pending:cntPend("vrp"), pnl:+sumP("vrp").toFixed(2)},
    {key:"bblo",label:"Bollinger-fade long",kind:"mean-reversion · global",
     signal:`buy 2σ lower band — the 24-setup survivor (58% beat-random, 16/16 markets, timeframe-invariant)`,
     live:cntP("bblo")>0||cntPend("bblo")>0, positions:posOut.filter(p=>p.edge==="bblo"), n:cntP("bblo"), pending:cntPend("bblo"), pnl:+sumP("bblo").toFixed(2)},
    {key:"xsec-momentum",label:"Cross-sectional momentum",kind:"factor L/S · monthly",
     signal:`12-1 momentum long-short quintile basket (NASDAQ t=6.0)`,
     live:cntP("xsec-momentum")>0||cntPend("xsec-momentum")>0, positions:posOut.filter(p=>p.edge==="xsec-momentum"), n:cntP("xsec-momentum"), pending:cntPend("xsec-momentum"), pnl:+sumP("xsec-momentum").toFixed(2)},
  ].map(ed=>({...ed,disabled:disabledSet.has(ed.key.replace(/[^a-z0-9]/gi,""))}));  // D-252: reflect per-edge disable (rip-short paused)
  return new Response(JSON.stringify({ok:true,armed,killed,equity:+equity.toFixed(2),cash:+cash.toFixed(2),buyingPower:+bp.toFixed(2),
    totalPnl:+(equity-DEPOSIT).toFixed(2),totalPnlPct:+(((equity-DEPOSIT)/DEPOSIT)*100).toFixed(2),
    openPositions:posOut.length,pendingOrders:pend.length,pending:pend,edges,generated_at:new Date().toISOString()}),{headers:cors});
}catch(err){return new Response(JSON.stringify({ok:false,err:String(err).slice(0,300)}),{status:500,headers:cors});}});
