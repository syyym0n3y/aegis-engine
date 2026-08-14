// trd-funding-exec (D-318) — FORWARD PAPER executor for the alt-gated funding carry (D-317). On each run (every 8h,
// aligned to funding): for each NON-MAJOR alt, manage any open paper position (close after ~3 days, realising price
// move + REAL funding collected − fee), then, if flat, compute the 28-day funding z-score and FADE an extreme
// reading (short crowded-long funding / long crowded-short). Internal perp paper broker — real keyless Binance mark
// prices + real funding rates; NOT real money. Guards: killswitch + arm + one-position-per-symbol. $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
// non-major alts = the 16 universe minus the top-4 institutional majors (BTC/ETH/BNB/XRP) — the D-317 gate.
const ALTS = ["SOLUSDT","ADAUSDT","DOGEUSDT","LINKUSDT","AVAXUSDT","DOTUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT","XLMUSDT","BCHUSDT"];
const Z_WIN = 84, HOLD_MS = 9 * 8 * 36e5, FEE_BPS = 10; // 28d window, 3-day hold
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

interface Pt { t: number; price: number; f: number }
// recent aligned funding+price (last ~120 8h periods) — enough for the 84-period z-score + the hold window
async function recent(sym: string): Promise<Pt[]> {
  const fMap = new Map<number, number>();
  const fr = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=200`).then((r) => r.json()).catch(() => []);
  if (Array.isArray(fr)) for (const x of fr) fMap.set(Math.round((x.fundingTime as number) / 36e5) * 36e5, +x.fundingRate);
  const kl = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=8h&limit=200`).then((r) => r.json()).catch(() => []);
  const out: Pt[] = [];
  if (Array.isArray(kl)) for (const k of kl) { const closeT = Math.round((k[6] as number) / 36e5) * 36e5; const f = fMap.get(closeT); if (f !== undefined) out.push({ t: closeT, price: +k[4], f }); }
  out.sort((a, b) => a.t - b.t);
  return out;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const dbg = new URL(req.url).searchParams.get("debug") === "1";
    const ks = await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (ks?.[0]?.active) { return new Response(JSON.stringify({ ok: true, skipped: "kill-switch" }), { headers: cors }); }
    const arm = await fetch(`${SB}/rest/v1/trd_exec_arm?id=eq.paper&select=armed`, { headers: H }).then((r) => r.json()).catch(() => []);
    if (!arm?.[0]?.armed && !dbg) { await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-funding-exec", p_outcome: "skipped: NOT ARMED" }) }).catch(() => {}); return new Response(JSON.stringify({ ok: true, skipped: "NOT ARMED" }), { headers: cors }); }
    const cfg = await fetch(`${SB}/rest/v1/trd_exec_config?edge=eq.funding-carry&select=size_notional,z_thr`, { headers: H }).then((r) => r.json()).catch(() => []);
    const NOTIONAL = Math.max(50, Number((cfg?.[0] as { size_notional?: number })?.size_notional) || 500);
    const Z_THR = Number((cfg?.[0] as { z_thr?: number })?.z_thr) || 1.5;
    const out: Record<string, unknown>[] = [];
    for (const sym of ALTS) {
      const s = await recent(sym); if (s.length < Z_WIN + 2) { out.push({ sym, skip: "thin" }); continue; }
      const last = s[s.length - 1], px = last.price;
      const openRows = await fetch(`${SB}/rest/v1/trd_funding_paper?sym=eq.${sym}&status=eq.open&select=id,side,entry_px,entry_at,notional&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
      const held = Array.isArray(openRows) && openRows.length ? openRows[0] : null;
      if (held) {
        const age = Date.now() - new Date(held.entry_at).getTime();
        if (age >= HOLD_MS) {
          const dir = held.side === "long" ? 1 : -1, entryT = new Date(held.entry_at).getTime();
          let fundSum = 0; for (const p of s) if (p.t > entryT && p.t <= last.t) fundSum += p.f;   // real funding over the hold
          const priceRet = dir * (px / held.entry_px - 1);
          const fundColl = -dir * fundSum;                                                          // short collects positive funding
          const price_pnl = priceRet * held.notional, fund_pnl = fundColl * held.notional, fee = 2 * (FEE_BPS / 1e4) * held.notional;
          const pnl = price_pnl + fund_pnl - fee;
          if (!dbg) await fetch(`${SB}/rest/v1/trd_funding_paper?id=eq.${held.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "closed", exit_px: px, exit_at: new Date().toISOString(), funding_collected_usd: +fund_pnl.toFixed(2), price_pnl_usd: +price_pnl.toFixed(2), fee_usd: +fee.toFixed(2), pnl_usd: +pnl.toFixed(2) }) }).catch(() => {});
          out.push({ sym, action: "CLOSE", side: held.side, pnl: +pnl.toFixed(2), fund: +fund_pnl.toFixed(2) });
        } else out.push({ sym, action: "hold", ageH: +(age / 36e5).toFixed(1) });
        continue;
      }
      // flat → z-score of latest funding; fade if extreme
      const win = s.slice(-1 - Z_WIN, -1).map((p) => p.f); const mu = mean(win);
      const sd = Math.sqrt(Math.max(1e-12, mean(win.map((f) => (f - mu) ** 2))));
      const z = (last.f - mu) / sd;
      if (Math.abs(z) < Z_THR) { out.push({ sym, flat: true, z: +z.toFixed(2) }); continue; }
      const side = z > 0 ? "short" : "long";
      if (dbg) { out.push({ sym, would: "OPEN", side, z: +z.toFixed(2), px }); continue; }
      await fetch(`${SB}/rest/v1/trd_funding_paper`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ sym, side, entry_px: px, notional: NOTIONAL, z_at_entry: +z.toFixed(3), status: "open" }) }).catch(() => {});
      out.push({ sym, action: "OPEN", side, z: +z.toFixed(2) });
    }
    const opens = out.filter((o) => o.action === "OPEN").length, closes = out.filter((o) => o.action === "CLOSE").length;
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-funding-exec", p_outcome: `open ${opens}, close ${closes}, ${out.filter((o) => o.action === "hold").length} held` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, edge: "funding-carry", broker: "internal perp paper (real Binance px+funding)", z_thr: Z_THR, results: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
