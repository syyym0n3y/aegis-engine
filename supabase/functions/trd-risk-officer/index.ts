// trd-risk-officer (D-322) — the enforced exposure cap. The Alpaca account jammed to 56 positions / $0 buying power
// because an unvalidated edge (orbfollow) kept ENTERING while its EOD-flatten was broken, and NOTHING capped total
// exposure. This is the durable backstop: a frequently-run cron that, PURELY AUTONOMOUSLY (risk-REDUCING only, per the
// hybrid team mandate — it never opens, only trims), enforces three hard caps on the LIVE broker account:
//   1. PER_EDGE_MAX open positions per edge (oldest-first trim of the overflow)
//   2. ORPHAN control — a broker position with NO matching open trd_trades row is untracked accretion; trimmed once
//      total count crosses the global ceiling
//   3. GLOBAL_MAX total positions + GROSS_NOTIONAL_CAP — the whole-account ceiling that guarantees buying power never
//      hits $0 again
// Attribution: broker sym → edge via open trd_trades rows. Trims close the specific broker symbols and reconcile the DB.
// Logs every action to trd_risk_actions (append-only) + heartbeat. ?dry=1 previews without trading. Paper only, $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET, "Content-Type": "application/json" };
const PAPER = "https://paper-api.alpaca.markets";
const PER_EDGE_MAX = 6;          // no single edge may hold more than this many open broker positions
const GLOBAL_MAX = 24;           // whole-account position ceiling
const GROSS_NOTIONAL_CAP = 80000; // whole-account gross $ exposure ceiling (equity ~$102k)

async function closeSym(sym: string) {
  // Cancel any resting bracket/stop orders FIRST — Alpaca holds the shares for open orders (qty_available=0), so a
  // DELETE-position with orders live returns 403 (this is exactly why 47 positions stranded, D-360). Cancel, then flat.
  const oo = await fetch(`${PAPER}/v2/orders?status=open&symbols=${encodeURIComponent(sym)}&limit=100`, { headers: AH }).then((r) => r.json()).catch(() => []);
  for (const o of (Array.isArray(oo) ? oo : []) as { id: string }[]) await fetch(`${PAPER}/v2/orders/${o.id}`, { method: "DELETE", headers: AH }).catch(() => {});
  const r = await fetch(`${PAPER}/v2/positions/${encodeURIComponent(sym)}?percentage=100`, { method: "DELETE", headers: AH });
  return r.status;
}
Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    // kill-switch respected (if trading is halted, don't touch the account)
    const ks = await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (ks?.[0]?.active) return new Response(JSON.stringify({ ok: true, skipped: "kill-switch" }), { headers: cors });

    const pos = await fetch(`${PAPER}/v2/positions`, { headers: AH }).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(pos)) return new Response(JSON.stringify({ ok: false, err: "positions not array" }), { status: 502, headers: cors });
    const open = await fetch(`${SB}/rest/v1/trd_trades?status=eq.open&select=id,edge,sym,entry_at`, { headers: H }).then((r) => r.json()).catch(() => []);
    const symToEdge = new Map<string, string>(), symToRow = new Map<string, { id: string; entry_at: string }>();
    for (const t of (Array.isArray(open) ? open : []) as { id: string; edge: string; sym: string; entry_at: string }[]) { symToEdge.set(t.sym, t.edge); symToRow.set(t.sym, { id: t.id, entry_at: t.entry_at }); }

    const grossNotional = pos.reduce((s: number, p: Record<string, string>) => s + Math.abs(+p.market_value), 0);
    const nPos = pos.length;
    // broker sym → full position (carries current_price + unrealized_pl → authoritative P&L at trim time, D-360)
    const posBySym = new Map<string, Record<string, string>>();
    for (const p of pos as Record<string, string>[]) posBySym.set(p.symbol, p);
    // group broker positions by attributed edge (or __orphan__)
    const byEdge = new Map<string, { sym: string; mv: number; entry_at: string }[]>();
    for (const p of pos as Record<string, string>[]) {
      const edge = symToEdge.get(p.symbol) ?? "__orphan__";
      (byEdge.get(edge) ?? byEdge.set(edge, []).get(edge)!).push({ sym: p.symbol, mv: Math.abs(+p.market_value), entry_at: symToRow.get(p.symbol)?.entry_at ?? "1970" });
    }
    const toTrim: { sym: string; edge: string; reason: string }[] = [];
    // 1. per-edge overflow (oldest first) — skip orphans here (handled by global rule)
    for (const [edge, list] of byEdge) {
      if (edge === "__orphan__") continue;
      if (list.length > PER_EDGE_MAX) {
        const sorted = [...list].sort((a, b) => a.entry_at.localeCompare(b.entry_at));
        for (const x of sorted.slice(0, list.length - PER_EDGE_MAX)) toTrim.push({ sym: x.sym, edge, reason: `per-edge>${PER_EDGE_MAX}` });
      }
    }
    // 2/3. global ceiling breach — trim orphans first (untracked), then largest-notional, until under caps
    const trimSet = new Set(toTrim.map((t) => t.sym));
    if (nPos - trimSet.size > GLOBAL_MAX || grossNotional > GROSS_NOTIONAL_CAP) {
      const orphans = (byEdge.get("__orphan__") ?? []).map((x) => ({ ...x, edge: "__orphan__" }));
      const tracked = pos.filter((p: Record<string, string>) => !trimSet.has(p.symbol) && symToEdge.has(p.symbol)).map((p: Record<string, string>) => ({ sym: p.symbol, mv: Math.abs(+p.market_value), edge: symToEdge.get(p.symbol)!, entry_at: symToRow.get(p.symbol)?.entry_at ?? "1970" }));
      const queue = [...orphans, ...tracked.sort((a, b) => b.mv - a.mv)]; // orphans first, then biggest exposure
      let remaining = nPos - trimSet.size, gross = grossNotional;
      for (const x of queue) {
        if (remaining <= GLOBAL_MAX && gross <= GROSS_NOTIONAL_CAP) break;
        if (trimSet.has(x.sym)) continue;
        toTrim.push({ sym: x.sym, edge: x.edge, reason: x.edge === "__orphan__" ? "orphan(untracked)" : "global-ceiling" });
        trimSet.add(x.sym); remaining--; gross -= x.mv;
      }
    }
    const actions: Record<string, unknown>[] = [];
    for (const t of toTrim) {
      let status = 0;
      if (!dry) {
        status = await closeSym(t.sym);
        const row = symToRow.get(t.sym);
        // ONLY mark the DB row closed if the BROKER close actually succeeded (2xx). Marking closed on a failed DELETE is
        // exactly what created 47 orphan positions (D-360): the DB said "closed" while the live position kept running,
        // hidden from every risk check. A failed close leaves status='open' so the next tick retries — fail-closed.
        if (row && status >= 200 && status < 300) {
          // a trim is a close → MUST write exit_px + realized_pnl (null P&L = the D-300b silent-write bug that blinded the
          // allocator). Use the position's own current_price + unrealized_pl — exact at the moment of the market flat.
          const pp = posBySym.get(t.sym);
          const patch: Record<string, unknown> = { status: "closed", exit_at: new Date().toISOString() };
          if (pp) { patch.exit_px = +(+pp.current_price).toFixed(4); patch.realized_pnl = +(+pp.unrealized_pl).toFixed(2); }
          await fetch(`${SB}/rest/v1/trd_trades?id=eq.${row.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patch) }).catch(() => {});
        }
        await fetch(`${SB}/rest/v1/trd_risk_actions`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ sym: t.sym, edge: t.edge, reason: t.reason, broker_status: status, acted_at: new Date().toISOString() }) }).catch(() => {});
      }
      actions.push({ sym: t.sym, edge: t.edge, reason: t.reason, broker_status: status });
    }
    if (!dry) await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-risk-officer", p_outcome: `${nPos} pos, gross $${grossNotional.toFixed(0)}; trimmed ${actions.length}` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, dry, n_positions: nPos, gross_notional: +grossNotional.toFixed(0), caps: { PER_EDGE_MAX, GLOBAL_MAX, GROSS_NOTIONAL_CAP }, trimmed: actions.length, actions }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
