// trd-pnl-snapshot (D-310) — durable HOURLY P&L snapshot, independent of the flaky cloud "execution driver"
// routine. Fetches trd-pnl-daily and writes one row to trd_pnl_snapshot (the existing table, already written
// twice-daily by trd_manager_daily — this adds market-hour granularity). Reporting becomes as reliable as the
// pg_cron execution already is. Writes a completion heartbeat (D-304) so the health view can verify it ran.
// $0, read-only against paper state. Cron: hourly during market hours.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const beat = (o: string) => fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-pnl-snapshot", p_outcome: o.slice(0, 180) }) }).catch(() => {});
  try {
    const p = await fetch(`${SB}/functions/v1/trd-pnl-daily`, { headers: { Authorization: `Bearer ${SRK}` } }).then((r) => r.json()).catch(() => null);
    if (!p || p.equity == null) { await beat("pnl-daily unreachable"); return new Response(JSON.stringify({ ok: false, err: "pnl-daily unreachable" }), { status: 502, headers: cors }); }
    const row = {
      id: crypto.randomUUID(),
      equity: p.equity, cash: p.buying_power ?? null, unrealized_pl: p.total_unrealized ?? null,
      total_pnl: p.total_pnl, positions: p.open_positions ?? null,
      detail: p, actions: p.futures_8_15 ?? null, created_at: new Date().toISOString(),
    };
    const r = await fetch(`${SB}/rest/v1/trd_pnl_snapshot`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(row) });
    const wrote = r.ok;
    await beat(`equity ${p.equity} pnl ${p.total_pnl} pos ${p.open_positions ?? "?"}${wrote ? "" : " WRITE-FAILED:" + (await r.text()).slice(0, 80)}`);
    return new Response(JSON.stringify({ ok: wrote, equity: p.equity, total_pnl: p.total_pnl, positions: p.open_positions, wrote }, null, 2), { headers: cors });
  } catch (e) { await beat("error " + String(e).slice(0, 100)); return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
