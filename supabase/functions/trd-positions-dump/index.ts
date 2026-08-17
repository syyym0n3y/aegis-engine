// trd-positions-dump (D-321) — one-shot surgical view of the LIVE Alpaca paper account: every position with its
// per-position unrealized P&L, so the operator can decide keep-vs-flatten position by position before a reset.
// Read-only. Sorted worst→best by unrealized P&L. $0.
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET, "Content-Type": "application/json" };
const PAPER = "https://paper-api.alpaca.markets";

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const acct = await fetch(`${PAPER}/v2/account`, { headers: AH }).then((r) => r.json()).catch(() => ({}));
    const pos = await fetch(`${PAPER}/v2/positions`, { headers: AH }).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(pos)) return new Response(JSON.stringify({ ok: false, err: "positions not array", raw: String(pos).slice(0, 200) }), { status: 502, headers: cors });
    const rows = pos.map((p: Record<string, string>) => ({
      sym: p.symbol, side: p.side, qty: +p.qty,
      avg_entry: +(+p.avg_entry_price).toFixed(4), current: +(+p.current_price).toFixed(4),
      mv: +(+p.market_value).toFixed(0), upl: +(+p.unrealized_pl).toFixed(2),
      upl_pct: +(100 * +p.unrealized_plpc).toFixed(2),
    })).sort((a, b) => a.upl - b.upl);
    const losers = rows.filter((r) => r.upl < 0), winners = rows.filter((r) => r.upl > 0);
    return new Response(JSON.stringify({
      ok: true, equity: +(+acct.equity).toFixed(2), buying_power: +(+acct.buying_power).toFixed(2),
      n: rows.length, total_upl: +rows.reduce((s, r) => s + r.upl, 0).toFixed(2),
      n_losers: losers.length, sum_loser_upl: +losers.reduce((s, r) => s + r.upl, 0).toFixed(2),
      n_winners: winners.length, sum_winner_upl: +winners.reduce((s, r) => s + r.upl, 0).toFixed(2),
      total_market_value: +rows.reduce((s, r) => s + r.mv, 0).toFixed(0),
      positions: rows,
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
