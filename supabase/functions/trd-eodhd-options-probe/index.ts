// trd-eodhd-options-probe — does our EODHD key include options (OI + gamma → per-name GEX, free)? Tries the endpoints.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const key = (await fetch(`${SB}/rest/v1/trd_secrets?name=eq.eodhd_key&select=value`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0]?.value;
  const out: Record<string, unknown> = {};
  const tries: [string, string][] = [
    ["legacy", `https://eodhd.com/api/options/AAPL.US?api_token=${key}&fmt=json`],
    ["mp_unicornbay", `https://eodhd.com/api/mp/unicornbay/options/contracts?filter[underlying_symbol]=AAPL&api_token=${key}`],
    ["mp_eod", `https://eodhd.com/api/mp/unicornbay/options/eod?filter[underlying_symbol]=AAPL&api_token=${key}`],
  ];
  for (const [name, url] of tries) {
    try { const r = await fetch(url); const txt = await r.text(); let j: unknown = null; try { j = JSON.parse(txt); } catch { /* */ }
      out[name] = { status: r.status, ok: r.ok, shape: Array.isArray((j as Record<string, unknown>)?.data) ? `data[${((j as Record<string, unknown>).data as unknown[]).length}]` : (j ? Object.keys(j as Record<string, unknown>).slice(0, 6) : txt.slice(0, 140)) };
    } catch (e) { out[name] = { err: String(e).slice(0, 80) }; }
  }
  return new Response(JSON.stringify({ ok: true, probe: out }, null, 2), { headers: cors });
});
