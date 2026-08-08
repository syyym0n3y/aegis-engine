// trd-alpaca-shortable — PLAYBOOK gap #1 (capacity): query Alpaca paper-api /v2/assets for the liquid basket and
// report how many are shortable + easy-to-borrow (ETB). Answers whether rip-short's short leg is actually
// executable / how binding borrow availability is. $0, read-only.
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET };
const U = ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","MU","INTC","CSCO","ORCL","CRM","QCOM","NFLX","JPM","BAC","GS","XOM","CVX","JNJ","PFE","WMT","HD","NKE","KO","CAT","BA","GE","F","GM","SPY","QQQ","IWM","XLE","XLF","SMH","GLD","TLT"];
Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  let shortable = 0, etb = 0, checked = 0, http0 = 0; const htb: string[] = [];
  for (const s of U) {
    const r = await fetch(`https://paper-api.alpaca.markets/v2/assets/${s}`, { headers: AH });
    if (!r.ok) { http0 = r.status; continue; } const a = await r.json(); checked++;
    if (a.shortable) shortable++; if (a.easy_to_borrow) etb++;
    if (a.shortable && !a.easy_to_borrow) htb.push(s);
  }
  return new Response(JSON.stringify({ checked, of: U.length, shortable, easy_to_borrow: etb, shortable_but_HTB: htb, last_http_if_fail: http0 }), { headers: cors });
});
