// trd-freedata — FREE + KEYLESS data connector (D-283). DOCTRINE: no dollar amount gates excellence; every data
// problem gets a free, keyless solution first. Sources (all keyless, no account):
//   • Stooq   — daily history for a HUGE global universe (US .us, + intl suffixes), keyless CSV.
//   • Binance — crypto klines: MULTI-YEAR 1m intraday, keyless, paginated (the free intraday-history unlock).
//   • Coinbase— crypto candles, keyless (fallback/cross-check).
//   • Yahoo   — daily full history + ~60d intraday, keyless (already used across the stack).
// ?src=probe tests all. ?src=stooq&s=spy.us&i=d | ?src=binance&s=BTCUSDT&interval=1h&limit=1000
async function tryFetch(url:string,opts?:RequestInit){try{const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"},...opts});return{ok:r.ok,status:r.status,text:r.ok?await r.text():""};}catch(e){return{ok:false,status:0,text:String(e).slice(0,80)};}}
Deno.serve(async(req)=>{const cors={"Content-Type":"application/json","Access-Control-Allow-Origin":"*"};try{
  const u=new URL(req.url);const src=u.searchParams.get("src")||"probe";
  if(src==="probe"){
    const stooq=await tryFetch("https://stooq.com/q/d/l/?s=spy.us&i=d");
    const binance=await tryFetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=5");
    const binanceHist=await tryFetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=1514764800000&limit=3"); // 2018-01-01: is deep 1m history there?
    const coinbase=await tryFetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400");
    const parse=(t:string,kind:string)=>kind==="csv"?t.split("\n").length-1:(()=>{try{return JSON.parse(t).length;}catch{return 0;}})();
    return new Response(JSON.stringify({ok:true,doctrine:"free+keyless first — no dollar gate on excellence",sources:{
      stooq:{keyless:true,ok:stooq.ok,rows:stooq.ok?parse(stooq.text,"csv"):0,sample:stooq.text.slice(0,120),covers:"daily, huge global universe"},
      binance:{keyless:true,ok:binance.ok,rows:binance.ok?parse(binance.text,"json"):0,covers:"crypto klines all intervals"},
      binance_1m_2018:{keyless:true,ok:binanceHist.ok,rows:binanceHist.ok?parse(binanceHist.text,"json"):0,sample:binanceHist.text.slice(0,140),covers:"MULTI-YEAR 1m intraday (the free unlock)"},
      coinbase:{keyless:true,ok:coinbase.ok,rows:coinbase.ok?parse(coinbase.text,"json"):0,covers:"crypto candles (fallback)"},
    }},null,2),{headers:cors});
  }
  if(src==="stooq"){const s=u.searchParams.get("s")||"spy.us",i=u.searchParams.get("i")||"d";const r=await tryFetch(`https://stooq.com/q/d/l/?s=${s}&i=${i}`);
    return new Response(JSON.stringify({ok:r.ok,src,rows:r.ok?r.text.split("\n").length-1:0,csv_head:r.text.slice(0,200)}),{headers:cors});}
  if(src==="binance"){const s=u.searchParams.get("s")||"BTCUSDT",iv=u.searchParams.get("interval")||"1h",lim=u.searchParams.get("limit")||"1000",st=u.searchParams.get("startTime");
    const r=await tryFetch(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=${iv}&limit=${lim}${st?`&startTime=${st}`:""}`);
    const rows=r.ok?(()=>{try{return JSON.parse(r.text).length;}catch{return 0;}})():0;
    return new Response(JSON.stringify({ok:r.ok,src,sym:s,interval:iv,rows,first:r.ok?JSON.parse(r.text)[0]?.slice(0,5):null}),{headers:cors});}
  return new Response(JSON.stringify({ok:false,err:"src: probe|stooq|binance"}),{status:400,headers:cors});
}catch(e){return new Response(JSON.stringify({ok:false,err:String(e).slice(0,300)}),{status:500,headers:cors});}});
