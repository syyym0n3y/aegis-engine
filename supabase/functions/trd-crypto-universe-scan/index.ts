// trd-crypto-universe-scan — SELF-EXPANDING scan of the ENTIRE free Binance crypto universe (D-290). Each run: pull
// the full USDT spot list (keyless exchangeInfo), find the next un-scanned symbols, run the US-open ORB on them (via
// trd-crypto-orb → stores to trd_crypto_scan), and AUTO-PROMOTE any Alpaca-supported passer (t>=2 & OOS-hold) into
// trd_crypto_candidates (→ auto-traded by trd-crypto-orb-exec, no redeploy). Cron drives it → the whole universe is
// covered across years of 1m, $0, no key. Systematic accounting of every crypto instrument the free data reaches.
const SB=Deno.env.get("SUPABASE_URL")!,SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H={apikey:SRK,Authorization:`Bearer ${SRK}`,"Content-Type":"application/json"};
const FN="https://glzzoomuhnugsiichnub.supabase.co/functions/v1/trd-crypto-orb";
// Alpaca-tradeable crypto (paper). Passers outside this set are logged but tracked via internal sim later.
const ALPACA=new Set(["AAVE","AVAX","BAT","BCH","BTC","CRV","DOGE","DOT","ETH","GRT","LINK","LTC","MKR","SHIB","SOL","SUSHI","UNI","XTZ","YFI","PEPE"]);
const BATCH=2;
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const batch=+(new URL(req.url).searchParams.get("batch")||BATCH);
  // full universe: USDT spot, TRADING, exclude leveraged/fiat-ish
  const info=await fetch("https://api.binance.com/api/v3/exchangeInfo").then(r=>r.json()).catch(()=>null);
  if(!info?.symbols)throw new Error("no exchangeInfo");
  const universe=(info.symbols as {symbol:string,status:string,quoteAsset:string,baseAsset:string,isSpotTradingAllowed:boolean}[])
    .filter(s=>s.status==="TRADING"&&s.quoteAsset==="USDT"&&s.isSpotTradingAllowed&&!/(UP|DOWN|BULL|BEAR)$/.test(s.baseAsset)&&!/^(USDC|FDUSD|TUSD|BUSD|DAI|EUR|GBP|AEUR)$/.test(s.baseAsset))
    .map(s=>s.symbol).sort();
  const doneRows=await fetch(`${SB}/rest/v1/trd_crypto_scan?win=eq.usopen&select=sym`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const done=new Set((Array.isArray(doneRows)?doneRows:[]).map((r:{sym:string})=>r.sym));
  const next=universe.filter(s=>!done.has(s)).slice(0,batch);
  // SYNCHRONOUS (D-291): await the scan+promote before responding, so a caller that holds the connection (the
  // background sweep driver) reliably completes the store. pg_net/cron can't hold it long enough — a long-running
  // bash driver does, and covers the universe reliably.
  if(next.length)await fetch(`${FN}?symbols=${next.join(",")}&years=1.5`).then(r=>r.json()).catch(()=>null);
  await promote();
  return new Response(JSON.stringify({ok:true,universe:universe.length,scanned_total:done.size+next.length,remaining:universe.length-done.size-next.length,this_run:next},null,2),{headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
async function promote(){
  const passers=await fetch(`${SB}/rest/v1/trd_crypto_scan?win=eq.usopen&t=gte.2&holds_both=eq.true&select=sym,t`,{headers:H}).then(r=>r.json()).catch(()=>[]);
  const existing=new Set((await fetch(`${SB}/rest/v1/trd_crypto_candidates?select=binance_sym`,{headers:H}).then(r=>r.json()).catch(()=>[])as {binance_sym:string}[]).map(c=>c.binance_sym));
  for(const p of (Array.isArray(passers)?passers:[]) as {sym:string,t:number}[]){const base=p.sym.replace(/USDT$/,"");
    if(ALPACA.has(base)&&!existing.has(p.sym)){await fetch(`${SB}/rest/v1/trd_crypto_candidates`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({binance_sym:p.sym,alpaca_order:`${base}/USD`,alpaca_pos:`${base}USD`,tier:"passer",t:p.t})}).catch(()=>{});}}
}
