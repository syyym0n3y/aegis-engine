// trd-databento-intraday (D-346) — the DATABENTO intraday loader. Takes the engine BELOW daily: pulls minute (ohlcv-1m)
// bars for US equities and stores them in trd_bars_intraday, so attribution can run at 1-min/5-min/hourly. METERED (real
// money): it ALWAYS cost-checks first (metadata.get_cost, FREE) and REFUSES to pull if the estimate exceeds ?cap (default
// $2) — a hard spend gate. Per symbol, sequentially (never parallel). Idempotent per (symbol,tf). Prices are Databento
// fixed-point (÷1e9); ts_event ns→s.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const BASE = "https://hist.databento.com/v0";

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const key = (await fetch(`${SB}/rest/v1/trd_secrets?name=eq.databento_key&select=value`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0]?.value;
    if (!key) return new Response(JSON.stringify({ ok: false, err: "no databento key" }), { status: 500, headers: cors });
    const AUTH = { Authorization: `Basic ${btoa(key + ":")}` };
    const u = new URL(req.url);
    const dataset = u.searchParams.get("dataset") || "DBEQ.BASIC";
    const symbols = (u.searchParams.get("symbols") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const start = u.searchParams.get("start") || "2026-07-01", end = u.searchParams.get("end") || "2026-08-01";
    const cap = Number(u.searchParams.get("cap") || "2");
    if (!symbols.length) return new Response(JSON.stringify({ ok: false, err: "no symbols" }), { status: 400, headers: cors });

    // 1) FREE cost check — the spend gate
    const costR = await fetch(`${BASE}/metadata.get_cost?dataset=${dataset}&symbols=${symbols.join(",")}&schema=ohlcv-1m&start=${start}&end=${end}&stype_in=raw_symbol&mode=historical`, { headers: AUTH });
    const estCost = costR.ok ? Number(await costR.text()) : NaN;
    if (!Number.isFinite(estCost)) return new Response(JSON.stringify({ ok: false, err: "cost check failed" }), { status: 502, headers: cors });
    if (estCost > cap) return new Response(JSON.stringify({ ok: false, blocked: "over cap", est_cost_usd: estCost, cap }), { status: 200, headers: cors });

    // 2) pull per symbol (sequential), parse, store
    const out: Record<string, unknown>[] = [];
    for (const sym of symbols) {
      const body = new URLSearchParams({ dataset, symbols: sym, schema: "ohlcv-1m", stype_in: "raw_symbol", start, end, encoding: "json" });
      const r = await fetch(`${BASE}/timeseries.get_range`, { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body });
      if (!r.ok) { out.push({ sym, err: `http ${r.status}`, detail: (await r.text()).slice(0, 120) }); continue; }
      const txt = await r.text(); const bars: number[][] = [];
      for (const line of txt.split("\n")) {
        if (!line.trim()) continue; let rec: Record<string, unknown>; try { rec = JSON.parse(line); } catch { continue; }
        const hd = (rec.hd as Record<string, unknown>) || {};
        const tsRaw = Number(rec.ts_event ?? hd.ts_event); if (!Number.isFinite(tsRaw)) continue;
        const ts = Math.floor(tsRaw / 1e9);
        const o = Number(rec.open) / 1e9, h = Number(rec.high) / 1e9, l = Number(rec.low) / 1e9, c = Number(rec.close) / 1e9, v = Number(rec.volume) || 0;
        if (![o, h, l, c].every(Number.isFinite)) continue;
        bars.push([ts, +o.toFixed(4), +h.toFixed(4), +l.toFixed(4), +c.toFixed(4), v]);
      }
      if (!bars.length) { out.push({ sym, err: "no bars parsed" }); continue; }
      bars.sort((a, b) => a[0] - b[0]);
      await fetch(`${SB}/rest/v1/trd_bars_intraday?on_conflict=symbol,tf`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ symbol: sym, tf: "1m", first_ts: bars[0][0], last_ts: bars[bars.length - 1][0], n_bars: bars.length, bars, cost_usd: +(estCost / symbols.length).toFixed(4), updated_at: new Date().toISOString() }) }).catch(() => {});
      out.push({ sym, n: bars.length, first: new Date(bars[0][0] * 1000).toISOString().slice(0, 16), last: new Date(bars[bars.length - 1][0] * 1000).toISOString().slice(0, 16), sample_close: bars[bars.length - 1][4] });
    }
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-databento-intraday", p_outcome: `loaded ${out.filter((o) => o.n).length}/${symbols.length}; est $${estCost.toFixed(3)}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, dataset, est_cost_usd: +estCost.toFixed(4), window: `${start}..${end}`, results: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
