// trd-account-reset (D-321) — operator-authorized clean reset of the jammed Alpaca paper account: cancel all open
// orders, close ALL positions (one broker call), then reconcile the DB (mark every still-open trd_trades row closed
// with its realized broker P&L unknown→0). Restores full buying power + DB/broker sync. Paper only, $0. Guarded by
// ?confirm=RESET so it can never fire by accident. After this, the per-edge exposure cap (trd-risk-officer) prevents
// re-accretion.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET, "Content-Type": "application/json" };
const PAPER = "https://paper-api.alpaca.markets";

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    if (new URL(req.url).searchParams.get("confirm") !== "RESET")
      return new Response(JSON.stringify({ ok: false, err: "add ?confirm=RESET to fire" }), { status: 400, headers: cors });
    const before = await fetch(`${PAPER}/v2/positions`, { headers: AH }).then((r) => r.json()).catch(() => []);
    const nBefore = Array.isArray(before) ? before.length : 0;
    // one broker call: close every position + cancel every open order
    const del = await fetch(`${PAPER}/v2/positions?cancel_orders=true`, { method: "DELETE", headers: AH });
    const delBody = await del.json().catch(() => null);
    // reconcile DB: any still-open trd_trades → closed (broker is now flat)
    await fetch(`${SB}/rest/v1/trd_trades?status=eq.open`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "closed", exit_at: new Date().toISOString(), realized_pnl: 0 }) }).catch(() => {});
    const acct = await fetch(`${PAPER}/v2/account`, { headers: AH }).then((r) => r.json()).catch(() => ({}));
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-account-reset", p_outcome: `closed ${nBefore} positions; bp $${(+acct.buying_power).toFixed(0)}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, closed_requested: nBefore, broker_status: del.status, close_results: Array.isArray(delBody) ? delBody.length : delBody, equity: +(+acct.equity).toFixed(2), buying_power: +(+acct.buying_power).toFixed(2) }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
