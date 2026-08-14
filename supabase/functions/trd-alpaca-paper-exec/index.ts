// trd-alpaca-paper-exec — rip-short PAPER executor. GUARDS: killswitch OFF + arm ON + per-edge DISABLE (D-252) + SPY
// regime + per-name shortable/ETB + dedup + 0.5% risk + 8-cap + bracket (2ATR stop, 3R target). PAPER only ($0).
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET, "Content-Type": "application/json" };
const PAPER = "https://paper-api.alpaca.markets", DATA = "https://data.alpaca.markets";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const RISK_PER = 0.005, MAX_CONCURRENT = 8, RSIN = 14, MALEN = 200, ATRN = 14, STOP_ATR = 2, TP = 3;
async function spyBullish(): Promise<boolean> {
  const start = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const r = await fetch(`${DATA}/v2/stocks/SPY/bars?timeframe=1Day&start=${start}&feed=iex&limit=400`, { headers: AH });
  if (!r.ok) return false; const j = await r.json(); const bs = j?.bars ?? []; if (bs.length < MALEN + 1) return false;
  const cl = bs.map((b: { c: number }) => b.c); const ma = cl.slice(-MALEN).reduce((a: number, x: number) => a + x, 0) / MALEN;
  return cl[cl.length - 1] > ma;
}
// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-alpaca-paper-exec", p_outcome: o.slice(0, 180) }),
  }).catch(() => {});
const SERVE = (h: (r: Request) => Response | Promise<Response>) =>
  Deno.serve(async (r: Request) => {
    let res: Response;
    try { res = await h(r); } catch (e) { await __beat("THREW " + String(e).slice(0, 150)); throw e; }
    let body = "";
    try { body = (await res.clone().text()).replace(/\s+/g, " ").slice(0, 150); } catch { /* unreadable body */ }
    await __beat(`${res.status} ${body}`);
    return res;
  });

SERVE(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const ks = await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (ks?.[0]?.active) return new Response(JSON.stringify({ ok: true, skipped: "kill-switch active" }), { headers: cors });
    const arm = await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (!arm?.[0]?.armed) return new Response(JSON.stringify({ ok: true, skipped: "NOT ARMED" }), { headers: cors });
    const dis = await fetch(`${SB}/rest/v1/trd_edge_disable?edge=eq.ripshort&select=disabled`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (dis?.[0]?.disabled) return new Response(JSON.stringify({ ok: true, skipped: "edge DISABLED (D-252: rip-short did not survive the 47y per-instance backtest / vs-random) — re-enable via trd_edge_disable" }), { headers: cors });
    if (!(await spyBullish())) return new Response(JSON.stringify({ ok: true, skipped: "regime gate: SPY below 200MA (D-191)" }), { headers: cors });
    const acct = await fetch(`${PAPER}/v2/account`, { headers: AH }).then((r) => r.json());
    const equity = Number(acct.equity); if (!(equity > 0)) throw new Error("no account equity");
    const positions = await fetch(`${PAPER}/v2/positions`, { headers: AH }).then((r) => r.json());
    const openShorts = (positions as { side: string }[]).filter((p) => p.side === "short").length;
    const openOrders = await fetch(`${PAPER}/v2/orders?status=open&limit=100`, { headers: AH }).then((r) => r.json()).catch(() => []);
    const held = new Set([...(positions as { symbol: string }[]).map((p) => p.symbol), ...(Array.isArray(openOrders) ? (openOrders as { symbol: string }[]).map((o) => o.symbol) : [])]);
    if (openShorts >= MAX_CONCURRENT) return new Response(JSON.stringify({ ok: true, skipped: `heat cap: ${openShorts}/${MAX_CONCURRENT}` }), { headers: cors });
    const latest = (await fetch(`${SB}/rest/v1/trd_ripshort_scan?select=scan_date&order=scan_date.desc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0]?.scan_date;
    let legs: { symbol: string }[] = [];
    if (latest) { const scan = await fetch(`${SB}/rest/v1/trd_ripshort_scan?scan_date=eq.${latest}&actionable=eq.true&select=ticker&order=rsi.desc&limit=40`, { headers: H }).then((r) => r.json()).catch(() => []); legs = (scan as { ticker: string }[]).map((r) => ({ symbol: r.ticker })); }
    if (!legs.length) legs = await fetch(`${SB}/rest/v1/trd_forward?candidate=like.ripshort-1d-*&active=eq.true&select=symbol`, { headers: H }).then((r) => r.json());
    const placed: string[] = [];
    for (const leg of legs as { symbol: string }[]) {
      if (openShorts + placed.length >= MAX_CONCURRENT) break;
      const sym = leg.symbol; if (held.has(sym)) continue;
      const a = await fetch(`${PAPER}/v2/assets/${sym}`, { headers: AH }).then((r) => r.json()).catch(() => null);
      if (!a?.shortable || !a?.easy_to_borrow) continue;
      const start = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
      const br = await fetch(`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&feed=iex&limit=400`, { headers: AH }).then((r) => r.json()).catch(() => null);
      const bs = br?.bars ?? []; if (bs.length < MALEN + ATRN) continue;
      const cl = bs.map((b: { c: number }) => b.c), hi = bs.map((b: { h: number }) => b.h), lo = bs.map((b: { l: number }) => b.l);
      const ma = cl.slice(-MALEN).reduce((x: number, y: number) => x + y, 0) / MALEN;
      let ag = 0, al = 0; for (let i = cl.length - RSIN; i < cl.length; i++) { const ch = cl[i] - cl[i - 1]; ag += Math.max(ch, 0); al += Math.max(-ch, 0); } const rsi = 100 - 100 / (1 + (ag / RSIN) / ((al / RSIN) || 1e-9));
      const last = cl[cl.length - 1]; if (!(rsi > 70 && last < ma)) continue;
      let tr = 0; for (let i = cl.length - ATRN; i < cl.length; i++) tr += Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])); const atr = tr / ATRN;
      const sd = STOP_ATR * atr; if (!(sd > 0)) continue;
      const qty = Math.max(1, Math.floor((equity * RISK_PER) / sd));
      const order = { symbol: sym, qty, side: "sell", type: "market", time_in_force: "day", order_class: "bracket", stop_loss: { stop_price: +(last + sd).toFixed(2) }, take_profit: { limit_price: +(last - sd * TP).toFixed(2) } };
      const resp = await fetch(`${PAPER}/v2/orders`, { method: "POST", headers: AH, body: JSON.stringify(order) });
      if (resp.ok) placed.push(`${sym} x${qty}`);
    }
    return new Response(JSON.stringify({ ok: true, armed: true, regime: "bull", equity, openShorts, source: latest ? `scan ${latest}` : "forward-legs", candidates: legs.length, placed }), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
