// trd-alpaca-paper-exec — DORMANT real-broker PAPER executor for rip-short (PLAYBOOK gap #1: true fills).
//
// SAFETY / STAGE-1 INVARIANT: this is an ORDER PATH. It is built DORMANT and does NOTHING until the operator
// ARMS it. It places PAPER orders only ($0, Alpaca paper account), never real money, and refuses to run unless
// ALL guards pass:
//   1. kill-switch OFF (trd_killswitch.default.active must be false),
//   2. ARM flag ON  (trd_exec_arm.paper.armed must be true — DEFAULTS ABSENT = OFF; operator sets it by hand),
//   3. REGIME gate  (SPY > its 200-day MA — rip-short is a bull-regime edge only, D-191; dead/dangerous in bear),
//   4. per-name liquid + easy-to-borrow (checked via Alpaca asset flags),
//   5. small fixed size (0.5% risk) + a hard cap on concurrent open shorts (portfolio heat, D-189).
// NOT deployed and NOT cronned by Claude — the operator deploys + arms deliberately. No auto-execution.
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

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // GUARD 1: kill-switch
    const ks = await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (ks?.[0]?.active) return new Response(JSON.stringify({ ok: true, skipped: "kill-switch active" }), { headers: cors });
    // GUARD 2: ARM flag (defaults OFF — absent row = not armed)
    const arm = await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (!arm?.[0]?.armed) return new Response(JSON.stringify({ ok: true, skipped: "NOT ARMED — dormant (set trd_exec_arm.paper.armed=true to enable)" }), { headers: cors });
    // GUARD 3: regime
    if (!(await spyBullish())) return new Response(JSON.stringify({ ok: true, skipped: "regime gate: SPY below 200MA — rip-short disabled in bear (D-191)" }), { headers: cors });

    // account + existing positions (portfolio heat cap)
    const acct = await fetch(`${PAPER}/v2/account`, { headers: AH }).then((r) => r.json());
    const equity = Number(acct.equity); if (!(equity > 0)) throw new Error("no account equity");
    const positions = await fetch(`${PAPER}/v2/positions`, { headers: AH }).then((r) => r.json());
    const openShorts = (positions as { side: string }[]).filter((p) => p.side === "short").length;
    const openOrders = await fetch(`${PAPER}/v2/orders?status=open&limit=100`, { headers: AH }).then((r) => r.json()).catch(() => []);
    const held = new Set([                                                            // per-name dedup: never stack —
      ...(positions as { symbol: string }[]).map((p) => p.symbol),                    // filled positions AND
      ...(Array.isArray(openOrders) ? (openOrders as { symbol: string }[]).map((o) => o.symbol) : []),  // pending orders
    ]);
    if (openShorts >= MAX_CONCURRENT) return new Response(JSON.stringify({ ok: true, skipped: `heat cap: ${openShorts}/${MAX_CONCURRENT} shorts open` }), { headers: cors });

    // candidates = the latest NIGHTLY FULL-UNIVERSE SCAN's actionable rip-short names (liquid large-caps firing the
    // signal across all 9,850, D-223) — not a fixed basket. Falls back to the registered forward legs if no scan yet.
    const latest = (await fetch(`${SB}/rest/v1/trd_ripshort_scan?select=scan_date&order=scan_date.desc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0]?.scan_date;
    let legs: { symbol: string }[] = [];
    if (latest) {
      const scan = await fetch(`${SB}/rest/v1/trd_ripshort_scan?scan_date=eq.${latest}&actionable=eq.true&select=ticker&order=rsi.desc&limit=40`, { headers: H }).then((r) => r.json()).catch(() => []);
      legs = (scan as { ticker: string }[]).map((r) => ({ symbol: r.ticker }));
    }
    if (!legs.length) legs = await fetch(`${SB}/rest/v1/trd_forward?candidate=like.ripshort-1d-*&active=eq.true&select=symbol`, { headers: H }).then((r) => r.json());
    const placed: string[] = [];
    for (const leg of legs as { symbol: string }[]) {
      if (openShorts + placed.length >= MAX_CONCURRENT) break;
      const sym = leg.symbol;
      if (held.has(sym)) continue;                            // already short this name — don't stack
      // asset must be shortable + easy-to-borrow
      const a = await fetch(`${PAPER}/v2/assets/${sym}`, { headers: AH }).then((r) => r.json()).catch(() => null);
      if (!a?.shortable || !a?.easy_to_borrow) continue;
      // fresh daily signal: RSI14>70 & close<200MA on daily bars
      const start = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
      const br = await fetch(`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&feed=iex&limit=400`, { headers: AH }).then((r) => r.json()).catch(() => null);
      const bs = br?.bars ?? []; if (bs.length < MALEN + ATRN) continue;
      const cl = bs.map((b: { c: number }) => b.c), hi = bs.map((b: { h: number }) => b.h), lo = bs.map((b: { l: number }) => b.l);
      const ma = cl.slice(-MALEN).reduce((x: number, y: number) => x + y, 0) / MALEN;
      // RSI(14)
      let ag = 0, al = 0; for (let i = cl.length - RSIN; i < cl.length; i++) { const ch = cl[i] - cl[i - 1]; ag += Math.max(ch, 0); al += Math.max(-ch, 0); } const rsi = 100 - 100 / (1 + (ag / RSIN) / ((al / RSIN) || 1e-9));
      const last = cl[cl.length - 1];
      if (!(rsi > 70 && last < ma)) continue;               // not a signal today
      // ATR(14) for stop sizing
      let tr = 0; for (let i = cl.length - ATRN; i < cl.length; i++) tr += Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])); const atr = tr / ATRN;
      const sd = STOP_ATR * atr; if (!(sd > 0)) continue;
      const qty = Math.max(1, Math.floor((equity * RISK_PER) / sd));
      const order = { symbol: sym, qty, side: "sell", type: "market", time_in_force: "day",
        order_class: "bracket",
        stop_loss: { stop_price: +(last + sd).toFixed(2) },
        take_profit: { limit_price: +(last - sd * TP).toFixed(2) } };
      const resp = await fetch(`${PAPER}/v2/orders`, { method: "POST", headers: AH, body: JSON.stringify(order) });
      if (resp.ok) placed.push(`${sym} x${qty}`);
    }
    return new Response(JSON.stringify({ ok: true, armed: true, regime: "bull", equity, openShorts, source: latest ? `scan ${latest}` : "forward-legs (no scan yet)", candidates: legs.length, placed }), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
