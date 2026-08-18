// trd-databento-imbalance (D-348) — pulls Databento XNAS.ITCH `imbalance` (closing-auction imbalance) to hunt a REAL
// directional edge: the published MOC imbalance predicts the close→next-open drift (Morand). METERED — always cost-checks
// (FREE) and refuses over ?cap (default $5). ?inspect=1 returns raw sample records (tiny pull) to verify the format before
// the full parse. Stores the per-(symbol,day) CLOSING imbalance in trd_imbalance. Forward returns come from keyless Yahoo.
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
    const symbols = (u.searchParams.get("symbols") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const start = u.searchParams.get("start") || "2025-08-01", end = u.searchParams.get("end") || "2026-08-01";
    const cap = Number(u.searchParams.get("cap") || "5");
    const inspect = u.searchParams.get("inspect") === "1";
    if (!symbols.length) return new Response(JSON.stringify({ ok: false, err: "no symbols" }), { status: 400, headers: cors });

    const costR = await fetch(`${BASE}/metadata.get_cost?dataset=XNAS.ITCH&symbols=${symbols.join(",")}&schema=imbalance&start=${start}&end=${end}&stype_in=raw_symbol&mode=historical`, { headers: AUTH });
    const est = costR.ok ? Number(await costR.text()) : NaN;
    if (!Number.isFinite(est)) return new Response(JSON.stringify({ ok: false, err: "cost check failed" }), { status: 502, headers: cors });
    if (!inspect && est > cap) return new Response(JSON.stringify({ ok: false, blocked: "over cap", est_cost_usd: est, cap }), { headers: cors });

    if (inspect) {
      const body = new URLSearchParams({ dataset: "XNAS.ITCH", symbols: symbols[0], schema: "imbalance", stype_in: "raw_symbol", start, end, encoding: "json" });
      const r = await fetch(`${BASE}/timeseries.get_range`, { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body });
      const txt = await r.text(); const lines = txt.split("\n").filter((l) => l.trim()).slice(0, 3);
      return new Response(JSON.stringify({ ok: r.ok, est_cost_usd: +est.toFixed(4), sample: lines.map((l) => { try { return JSON.parse(l); } catch { return l.slice(0, 300); } }) }, null, 2), { headers: cors });
    }

    let stored = 0;
    for (const sym of symbols) {
      const body = new URLSearchParams({ dataset: "XNAS.ITCH", symbols: sym, schema: "imbalance", stype_in: "raw_symbol", start, end, encoding: "json" });
      const r = await fetch(`${BASE}/timeseries.get_range`, { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body });
      if (!r.ok) continue;
      // keep the CLOSING-auction imbalance per day = the last significant imbalance record of each session
      const byDay = new Map<string, Record<string, unknown>>();
      for (const line of (await r.text()).split("\n")) {
        if (!line.trim()) continue; let rec: Record<string, unknown>; try { rec = JSON.parse(line); } catch { continue; }
        if (String(rec.auction_type) !== "C") continue;   // CLOSING auction only (the MOC imbalance)
        const hd = (rec.hd as Record<string, unknown>) || {};
        const tsRaw = Number(rec.ts_event ?? hd.ts_event); if (!Number.isFinite(tsRaw)) continue;
        const day = new Date(tsRaw / 1e6).toISOString().slice(0, 10); // ns→ms
        byDay.set(day, rec); // last closing-auction snapshot of the day wins
      }
      const rows = [...byDay.entries()].map(([day, rec]) => {
        const side = String(rec.side ?? "N");
        const qty = Number(rec.total_imbalance_qty ?? rec.imbalance_qty ?? 0);
        const signed = side === "B" ? qty : side === "A" ? -qty : 0;  // B=buy(+), A=ask/sell(−)
        const ref = Number(rec.ref_price ?? 0) / 1e9;
        return { symbol: sym, date: day, imb_signed: signed, imb_side: side, ref_price: +ref.toFixed(4), updated_at: new Date().toISOString() };
      }).filter((x) => x.imb_signed !== 0);
      if (rows.length) { await fetch(`${SB}/rest/v1/trd_imbalance?on_conflict=symbol,date`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {}); stored += rows.length; }
    }
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-databento-imbalance", p_outcome: `stored ${stored}; est $${est.toFixed(2)}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, est_cost_usd: +est.toFixed(4), stored }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
