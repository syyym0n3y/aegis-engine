// trd-fundamentals-load (D-358) — the FUNDAMENTALS pipeline (free/keyless EDGAR XBRL). Unlocks the durable factor family
// (value/quality/investment) we couldn't test. Two modes:
//   ?ciks=1                                  → load the CIK→ticker map (SEC company_tickers.json)
//   ?concept=Assets&period=CY2023Q1I         → pull that us-gaap concept across ALL companies for the period (frames API),
//                                              join ticker, store point-in-time (effective_date = period_end + 75d filing lag)
// Concepts: StockholdersEquity/Assets/Liabilities (instant, use ...I), NetIncomeLoss/Revenues (duration, no I suffix).
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UA = { "User-Agent": "Aegis Research ona@revitalise.io" };
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("ciks") === "1") {
      const j = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA }).then((r) => r.json());
      const rows = Object.values(j as Record<string, { cik_str: number; ticker: string; title: string }>).map((c) => ({ cik: String(c.cik_str), ticker: (c.ticker || "").toUpperCase(), name: c.title, updated_at: new Date().toISOString() }));
      let n = 0; for (let i = 0; i < rows.length; i += 1000) { await fetch(`${SB}/rest/v1/trd_cik_ticker?on_conflict=cik`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) }).catch(() => {}); n += Math.min(1000, rows.length - i); }
      return new Response(JSON.stringify({ ok: true, cik_map_rows: n }), { headers: cors });
    }
    const concept = u.searchParams.get("concept"), period = u.searchParams.get("period"); // e.g. Assets, CY2023Q1I
    const ns = u.searchParams.get("ns") || "us-gaap";   // namespace: us-gaap (default) | dei (shares outstanding)
    const unit = u.searchParams.get("unit") || "USD";   // USD (default) | shares (for dei:EntityCommonStockSharesOutstanding)
    if (!concept || !period) return new Response(JSON.stringify({ ok: false, err: "need ?concept & ?period" }), { status: 400, headers: cors });
    // CIK→ticker map — PAGINATE (PostgREST caps at 1000/req; the map has ~10k rows, so a single fetch silently truncates)
    const c2t = new Map<string, string>();
    for (let off = 0; ; off += 1000) {
      const page = await fetch(`${SB}/rest/v1/trd_cik_ticker?select=cik,ticker&order=cik&offset=${off}&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
      if (!Array.isArray(page) || !page.length) break;
      for (const r of page as { cik: string; ticker: string }[]) if (r.ticker) c2t.set(r.cik, r.ticker);
      if (page.length < 1000) break;
    }
    const fr = await fetch(`https://data.sec.gov/api/xbrl/frames/${ns}/${concept}/${unit}/${period}.json`, { headers: UA });
    if (!fr.ok) return new Response(JSON.stringify({ ok: false, err: `frames ${fr.status}`, ns, concept, unit, period }), { headers: cors });
    const data = (await fr.json())?.data as { cik: number; end: string; val: number }[] | undefined;
    if (!Array.isArray(data)) return new Response(JSON.stringify({ ok: false, err: "no data" }), { headers: cors });
    const rows = data.filter((d) => Number.isFinite(d.val) && d.end).map((d) => ({ cik: String(d.cik), ticker: c2t.get(String(d.cik)) ?? null, concept, fy: +period.slice(2, 6), fp: period.slice(6), period_end: d.end, effective_date: addDays(d.end, 75), value: d.val, updated_at: new Date().toISOString() }));
    let stored = 0; for (let i = 0; i < rows.length; i += 1000) { await fetch(`${SB}/rest/v1/trd_fundamentals?on_conflict=cik,concept,period_end`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 1000)) }).catch(() => {}); stored += Math.min(1000, rows.length - i); }
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-fundamentals-load", p_outcome: `${concept} ${period}: ${stored} rows` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, concept, period, companies: data.length, stored, with_ticker: rows.filter((r) => r.ticker).length }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
