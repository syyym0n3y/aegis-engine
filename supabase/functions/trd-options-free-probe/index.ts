// trd-options-free-probe — hunt a KEYLESS per-name options-chain source (OI + strike → per-name GEX, free). Tries Nasdaq's
// public option-chain API and the Yahoo crumb handshake. Whichever returns strikes+OI keyless is the free GEX source.
Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", "Accept": "application/json, text/plain, */*" };
  const out: Record<string, unknown> = {};
  // 1) Nasdaq public option-chain
  try {
    const r = await fetch("https://api.nasdaq.com/api/quote/AAPL/option-chain?assetclass=stocks&limit=8&fromdate=all&excode=oprac&callput=callput&money=all&type=all", { headers: UA });
    const t = await r.text(); let j: Record<string, unknown> | null = null; try { j = JSON.parse(t); } catch { /* */ }
    const rows = (j?.data as Record<string, unknown>)?.table as Record<string, unknown> | undefined;
    out.nasdaq = { status: r.status, has_rows: !!(rows?.rows), sample_keys: rows?.rows && (rows.rows as unknown[])[0] ? Object.keys((rows.rows as Record<string, unknown>[])[0]) : t.slice(0, 120) };
  } catch (e) { out.nasdaq = { err: String(e).slice(0, 90) }; }
  // 2) Yahoo crumb handshake → options
  try {
    const c1 = await fetch("https://fc.yahoo.com/", { headers: UA }); const cookie = c1.headers.get("set-cookie") || "";
    const crumbR = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...UA, cookie } }); const crumb = await crumbR.text();
    const optR = await fetch(`https://query1.finance.yahoo.com/v7/finance/options/AAPL?crumb=${encodeURIComponent(crumb)}`, { headers: { ...UA, cookie } });
    const oj = await optR.json().catch(() => null); const res = oj?.optionChain?.result?.[0];
    out.yahoo_crumb = { crumb_ok: crumb.length > 0 && crumb.length < 40, opt_status: optR.status, calls: res?.options?.[0]?.calls?.length ?? 0, sample_keys: res?.options?.[0]?.calls?.[0] ? Object.keys(res.options[0].calls[0]).filter((k: string) => ["strike", "openInterest", "impliedVolatility", "expiration"].includes(k)) : null };
  } catch (e) { out.yahoo_crumb = { err: String(e).slice(0, 90) }; }
  return new Response(JSON.stringify({ ok: true, probe: out }, null, 2), { headers: cors });
});
