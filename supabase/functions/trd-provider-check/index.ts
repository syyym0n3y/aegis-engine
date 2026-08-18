// trd-provider-check — verifies the vaulted provider keys work against the exact endpoints we need before building on them.
// FMP delisted-companies (survivorship), AlphaVantage LISTING_STATUS (survivorship) + HISTORICAL_OPTIONS (GEX), EODHD delisted.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const sec = async (n: string) => (await fetch(`${SB}/rest/v1/trd_secrets?name=eq.${n}&select=value`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0]?.value;

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const out: Record<string, unknown> = {};
  try {
    const fmp = await sec("fmp_key"), eod = await sec("eodhd_key"), av = await sec("alphavantage_key");
    // FMP delisted list
    try { const r = await fetch(`https://financialmodelingprep.com/api/v3/delisted-companies?page=0&apikey=${fmp}`); const j = await r.json(); out.fmp_delisted = { ok: r.ok, n: Array.isArray(j) ? j.length : 0, sample: Array.isArray(j) ? j[0] : String(j).slice(0, 120) }; } catch (e) { out.fmp_delisted = { err: String(e).slice(0, 80) }; }
    // AlphaVantage LISTING_STATUS (delisted)
    try { const r = await fetch(`https://www.alphavantage.co/query?function=LISTING_STATUS&state=delisted&apikey=${av}`); const t = await r.text(); const lines = t.split("\n").filter((l) => l.trim()); out.av_listing = { ok: r.ok, rows: lines.length, header: lines[0]?.slice(0, 80), sample: lines[1]?.slice(0, 80) }; } catch (e) { out.av_listing = { err: String(e).slice(0, 80) }; }
    // AlphaVantage HISTORICAL_OPTIONS (GEX inputs: per-strike gamma + OI)
    try { const r = await fetch(`https://www.alphavantage.co/query?function=HISTORICAL_OPTIONS&symbol=SPY&apikey=${av}`); const j = await r.json(); const data = j?.data; out.av_options = { ok: r.ok, n_contracts: Array.isArray(data) ? data.length : 0, fields: Array.isArray(data) && data[0] ? Object.keys(data[0]) : (j?.Information || j?.Note || String(j).slice(0, 120)) }; } catch (e) { out.av_options = { err: String(e).slice(0, 80) }; }
    // EODHD delisted (backup)
    try { const r = await fetch(`https://eodhd.com/api/exchange-symbol-list/US?delisted=1&api_token=${eod}&fmt=json`); const j = await r.json(); out.eodhd_delisted = { ok: r.ok, n: Array.isArray(j) ? j.length : String(j).slice(0, 100) }; } catch (e) { out.eodhd_delisted = { err: String(e).slice(0, 80) }; }
    return new Response(JSON.stringify({ ok: true, providers: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300), out }), { status: 500, headers: cors }); }
});
