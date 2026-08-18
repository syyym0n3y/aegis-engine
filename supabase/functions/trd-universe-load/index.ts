// trd-universe-load (D-350) — the SURVIVORSHIP FIX data. Pulls AlphaVantage LISTING_STATUS (delisted + optionally active)
// into trd_universe: every US security incl. the DEAD ones, with delisting dates. This is the membership that survivor-only
// datasets silently drop — the root of survivorship bias. One AV call per state (well within the 25/day free limit).
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const av = (await fetch(`${SB}/rest/v1/trd_secrets?name=eq.alphavantage_key&select=value`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0]?.value;
    if (!av) return new Response(JSON.stringify({ ok: false, err: "no av key" }), { status: 500, headers: cors });
    const state = new URL(req.url).searchParams.get("state") || "delisted";
    const r = await fetch(`https://www.alphavantage.co/query?function=LISTING_STATUS&state=${state}&apikey=${av}`);
    const txt = await r.text();
    const lines = txt.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
    if (!lines.length || !lines[0].startsWith("symbol")) return new Response(JSON.stringify({ ok: false, err: "unexpected response", head: txt.slice(0, 160) }), { headers: cors });
    const rows: Record<string, unknown>[] = [];
    const dt = (s: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    for (const line of lines.slice(1)) {
      const p = line.split(",");
      if (p.length < 7) continue;
      const ticker = p[0].trim(); if (!ticker) continue;
      const status = p[p.length - 1].trim(), delist = dt(p[p.length - 2].trim()), ipo = dt(p[p.length - 3].trim());
      const assetType = p[p.length - 4].trim(), exchange = p[p.length - 5].trim(), name = p.slice(1, p.length - 5).join(",").trim();
      rows.push({ ticker, name, exchange, asset_type: assetType, ipo_date: ipo, delisting_date: delist, status, source: "alphavantage", updated_at: new Date().toISOString() });
    }
    let stored = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      await fetch(`${SB}/rest/v1/trd_universe?on_conflict=ticker`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) }).catch(() => {});
      stored += Math.min(1000, rows.length - i);
    }
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-universe-load", p_outcome: `${state}: ${stored} rows` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, state, parsed: rows.length, stored }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
