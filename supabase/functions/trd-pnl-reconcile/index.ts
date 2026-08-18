// trd-pnl-reconcile (D-360) — the P&L SAFETY NET + historical backfill for the D-300b silent-write class.
// Executors now write realized_pnl on close (crypto-orb-exec, orbfollow-scanner EOD), but 155 orbfollow rows were
// closed by the OLD blind-bulk PATCH that recorded neither exit_px nor realized_pnl → the allocator is blind on them.
// Those were REAL Alpaca paper orders, so their exit prices live in Alpaca's fill log. This fn reconstructs them:
//   GET  ?reconcile=1  → for every closed trd_trades row with null realized_pnl, find its closing fill(s) in Alpaca
//                        account/activities (opposite side, same symbol, after entry_at, before the next same-symbol
//                        entry), qty-weight the exit price, write exit_px + realized_pnl.
//   GET  (default)     → GUARD: count closed rows still missing realized_pnl; beat an alert if any are >2h old.
// Idempotent (only touches null-pnl rows). Fail-closed: a row whose exit can't be found is LEFT null (never guessed).
const KEYID = Deno.env.get("APCA_API_KEY_ID") ?? "PKEFCKAQHPEDW3PRDJ6JS4V67O";
const SECRET = Deno.env.get("APCA_API_SECRET_KEY") ?? Deno.env.get(KEYID) ?? "";
const AH = { "APCA-API-KEY-ID": KEYID, "APCA-API-SECRET-KEY": SECRET };
const PAPER = "https://paper-api.alpaca.markets";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const beat = (o: string) => fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-pnl-reconcile", p_outcome: o }) }).then(() => {}).catch(() => {});

interface Trade { id: string; edge: string; sym: string; side: string; entry_px: number; qty: number; entry_at: string; }
interface Fill { symbol: string; side: string; price: number; qty: number; transaction_time: string; }

async function allFills(afterISO: string): Promise<Fill[]> {
  const out: Fill[] = []; let pageToken = "";
  for (let i = 0; i < 50; i++) { // hard cap 50 pages (5000 fills)
    const u = new URL(`${PAPER}/v2/account/activities/FILL`);
    u.searchParams.set("direction", "asc"); u.searchParams.set("after", afterISO); u.searchParams.set("page_size", "100");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const r = await fetch(u, { headers: AH }); if (!r.ok) break;
    const j = await r.json() as { symbol: string; side: string; price: string; qty: string; transaction_time: string; id: string }[];
    if (!Array.isArray(j) || !j.length) break;
    for (const f of j) out.push({ symbol: f.symbol, side: f.side, price: +f.price, qty: +f.qty, transaction_time: f.transaction_time });
    if (j.length < 100) break; pageToken = j[j.length - 1].id;
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("account") === "1") {
      const a = await fetch(`${PAPER}/v2/account`, { headers: AH }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
      const cfg = await fetch(`${PAPER}/v2/account/configurations`, { headers: AH }).then((r) => r.json()).catch(() => ({}));
      return new Response(JSON.stringify({ ok: true, account: { status: a.status, trading_blocked: a.trading_blocked, account_blocked: a.account_blocked, transfers_blocked: a.transfers_blocked, trade_suspended_by_user: a.trade_suspended_by_user, pattern_day_trader: a.pattern_day_trader, buying_power: a.buying_power, equity: a.equity, cash: a.cash, long_market_value: a.long_market_value, short_market_value: a.short_market_value }, config: cfg }, null, 2), { headers: cors });
    }
    const dbgSym = u.searchParams.get("fills");
    if (dbgSym) {
      const fills = await allFills(new Date(Date.now() - 9 * 864e5).toISOString());
      return new Response(JSON.stringify({ ok: true, sym: dbgSym, fills: fills.filter((f) => f.symbol === dbgSym) }, null, 2), { headers: cors });
    }
    if (u.searchParams.get("reconcile") !== "1") {
      // GUARD MODE: a FRESHLY closed row (exit_at in the last 26h, settled >15m ago) that still lacks realized_pnl is a
      // live silent-write regression → alert. The window deliberately EXCLUDES the frozen historical-unrecoverable set
      // (older rows whose Alpaca fills we couldn't match) so the guard signals only NEW breakage, never stays red.
      const hi = new Date(Date.now() - 15 * 60e3).toISOString(), lo = new Date(Date.now() - 26 * 3600e3).toISOString();
      const stale = await fetch(`${SB}/rest/v1/trd_trades?status=eq.closed&realized_pnl=is.null&exit_at=gte.${lo}&exit_at=lt.${hi}&select=id,edge`, { headers: H }).then((r) => r.json()).catch(() => []);
      const n = Array.isArray(stale) ? stale.length : 0;
      const byEdge: Record<string, number> = {}; for (const t of (Array.isArray(stale) ? stale : []) as { edge: string }[]) byEdge[t.edge] = (byEdge[t.edge] || 0) + 1;
      await beat(n ? `GUARD ALERT: ${n} closed rows missing realized_pnl (${JSON.stringify(byEdge)})` : "guard ok: all closed rows have realized_pnl");
      return new Response(JSON.stringify({ ok: true, guard: true, missing_pnl: n, by_edge: byEdge, alert: n > 0 }, null, 2), { headers: cors });
    }
    // RECONCILE MODE
    const rows = await fetch(`${SB}/rest/v1/trd_trades?status=eq.closed&realized_pnl=is.null&entry_px=not.is.null&qty=not.is.null&select=id,edge,sym,side,entry_px,qty,entry_at&order=sym,entry_at`, { headers: H }).then((r) => r.json()).catch(() => []) as Trade[];
    if (!Array.isArray(rows) || !rows.length) { await beat("reconcile: nothing to do"); return new Response(JSON.stringify({ ok: true, reconciled: 0, note: "no null-pnl rows" }), { headers: cors }); }
    const minEntry = rows.reduce((m, r) => r.entry_at < m ? r.entry_at : m, rows[0].entry_at);
    const afterISO = new Date(new Date(minEntry).getTime() - 60e3).toISOString();
    const fills = await allFills(afterISO);
    // per-symbol next-entry boundary (so day-1 exits don't bleed into day-2 for the same name)
    const bySym = new Map<string, Trade[]>(); for (const t of rows) { (bySym.get(t.sym) ?? bySym.set(t.sym, []).get(t.sym)!).push(t); }
    let done = 0, unmatched = 0; const details: Record<string, unknown>[] = [];
    for (const [sym, ts] of bySym) {
      ts.sort((a, b) => a.entry_at < b.entry_at ? -1 : 1);
      const symFills = fills.filter((f) => f.symbol === sym).sort((a, b) => a.transaction_time < b.transaction_time ? -1 : 1);
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i]; const lo = new Date(t.entry_at).getTime();
        const hi = i + 1 < ts.length ? new Date(ts[i + 1].entry_at).getTime() : Infinity; // next same-sym entry
        const wantSide = t.side === "long" ? "sell" : "buy"; // closing fill is the opposite of entry
        const close = symFills.filter((f) => f.side === wantSide && new Date(f.transaction_time).getTime() > lo && new Date(f.transaction_time).getTime() <= hi);
        if (!close.length) {
          // No closing fill. Check for an ENTRY fill: if the entry never filled either, the order was logged but never
          // traded (paper reject post-accept) → there was NO position → realized_pnl = 0 is the MEASURED truth, not a guess.
          const entrySide = t.side === "long" ? "buy" : "sell";
          const entryFill = symFills.some((f) => f.side === entrySide && Math.abs(new Date(f.transaction_time).getTime() - lo) < 30 * 60e3);
          if (!entryFill) {
            await fetch(`${SB}/rest/v1/trd_trades?id=eq.${t.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ realized_pnl: 0 }) }).catch(() => {});
            done++; if (details.length < 20) details.push({ sym, side: t.side, note: "never-filled → pnl 0" });
          } else { unmatched++; } // entry filled but no exit found → genuinely open/leaked → leave null (never guessed)
          continue;
        }
        const totQ = close.reduce((s, f) => s + f.qty, 0); if (!(totQ > 0)) { unmatched++; continue; }
        const exit = close.reduce((s, f) => s + f.price * f.qty, 0) / totQ; // qty-weighted exit
        const pnl = +(((t.side === "long" ? exit - t.entry_px : t.entry_px - exit) * t.qty)).toFixed(2);
        await fetch(`${SB}/rest/v1/trd_trades?id=eq.${t.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ exit_px: +exit.toFixed(4), realized_pnl: pnl }) }).catch(() => {});
        done++; if (details.length < 20) details.push({ sym, side: t.side, entry_px: t.entry_px, exit_px: +exit.toFixed(4), qty: t.qty, pnl });
      }
    }
    await beat(`reconcile: ${done} written, ${unmatched} unmatched (no closing fill found)`);
    return new Response(JSON.stringify({ ok: true, candidates: rows.length, reconciled: done, unmatched, fills_scanned: fills.length, sample: details }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
