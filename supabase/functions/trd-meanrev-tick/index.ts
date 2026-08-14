// trd-meanrev-tick — forward tracker + live favourability SCANNER for the frozen meanrev-vix-v1 lead
// (D-111). Runs daily: (1) resolves open forward trades, (2) opens new ones ONLY on post-registration
// signals (no look-ahead), (3) accrues R into trd_prereg_state, (4) publishes a SCANNER — which markets
// are in a favourable setup RIGHT NOW (side, RSI, VIX), so we know where the odds are before anyone else.
// Uses the tested _shared/trd-meanrev.ts signal (same code as the backtest). ?scan=1 = scanner only, no write.
import { meanRevSignal, resolveTrade, MR_SPEC, type Bar } from "../_shared/trd-meanrev.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const HYP = "meanrev-vix-v1";
// broadened liquid universe (indices, sectors, intl, commodities, bonds, crypto, mega-cap single names)
const UNIVERSE = [
  "SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV", "XLU", "XLI", "XLP", "XLY", "XLB", "XLRE", "SMH", "XBI",
  "EEM", "EFA", "FXI", "EWZ", "EWJ", "INDA", "GLD", "SLV", "USO", "DBC", "TLT", "HYG", "LQD",
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", "BTC-USD", "ETH-USD",
];
async function bars(sym: string): Promise<Bar[]> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 400 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c }); }
  return out;
}

// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-meanrev-tick", p_outcome: o.slice(0, 180) }),
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

SERVE(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const scanOnly = new URL(req.url).searchParams.get("scan") === "1";
  try {
    const pre = await fetch(`${SB}/rest/v1/trd_prereg?id=eq.${HYP}&select=registered_at`, { headers: hdr }).then((r) => r.json());
    const regDay = String((pre as any[])[0]?.registered_at ?? "").slice(0, 10); if (!regDay) throw new Error("meanrev-vix-v1 not registered");
    const vixB = await bars("^VIX"); const vix = new Map<string, number>(); for (const b of vixB) vix.set(b.d, b.c);
    const vixLast = vixB.length ? vixB[vixB.length - 1].c : NaN;

    const st = await fetch(`${SB}/rest/v1/trd_prereg_state?hyp_id=eq.${HYP}&select=*`, { headers: hdr }).then((r) => r.json()).then((x) => (x as any[])[0] ?? null);
    const store = st?.forward_trades ?? {}; const open: Record<string, any> = store.open ?? {}; const closed: any[] = store.closed ?? [];
    const scanner: any[] = [];
    let opened = 0, resolved = 0;

    for (const sym of UNIVERSE) {
      const b = await bars(sym); if (b.length < MR_SPEC.maLen + 15) continue;
      const last = b[b.length - 1];
      // 1) resolve an open forward trade for this symbol
      if (open[sym]) {
        const t = open[sym]; const ei = b.findIndex((x) => x.d === t.entryDate);
        if (ei >= 0) { const res = resolveTrade(b.slice(ei), t.side, t.entry, t.stopDist, MR_SPEC); if (res) { closed.push({ sym, side: t.side, entryDate: t.entryDate, exitDate: last.d, r: +res.r.toFixed(3), reason: res.reason }); delete open[sym]; resolved++; } }
      }
      // 2) evaluate the frozen signal on the last completed bar (uses the VIX on that bar)
      const sig = meanRevSignal(b, vix.get(last.d) ?? vixLast ?? 0, MR_SPEC);
      if (sig) {
        scanner.push({ sym, side: sig.side, rsi: +sig.rsi.toFixed(1), price: +last.c.toFixed(2), stopPct: +(sig.stopDist / last.c * 100).toFixed(2), vix: +(vix.get(last.d) ?? vixLast).toFixed(1) });
        // open a forward trade only if post-registration, not already open, and a fresh bar
        if (!scanOnly && last.d > regDay && !open[sym] && (!store.lastBarSeen || last.d > store.lastBarSeen)) {
          open[sym] = { side: sig.side, entry: last.c, entryDate: last.d, stopDist: sig.stopDist }; opened++;
        }
      }
    }
    if (scanOnly) return new Response(JSON.stringify({ ok: true, scan: scanner.sort((a, b) => (a.side < b.side ? -1 : 1)), vixNow: +vixLast.toFixed(1), favourable: vixLast >= MR_SPEC.vixMin }, null, 2), { headers: cors });

    const rs = closed.map((c) => c.r); const exp = rs.length ? rs.reduce((a, c) => a + c, 0) / rs.length : 0; const tot = rs.reduce((a, c) => a + c, 0);
    const wins = rs.filter((x) => x > 0).length;
    const forward_trades = { open, closed: closed.slice(-1000), scanner, lastBarSeen: vixB.length ? vixB[vixB.length - 1].d : store.lastBarSeen };
    await fetch(`${SB}/rest/v1/trd_prereg_state?on_conflict=hyp_id`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ hyp_id: HYP, forward_trades, last_entry_ts: closed.length ? closed[closed.length - 1].exitDate : null, fwd_n: rs.length, fwd_expectancy_r: +exp.toFixed(4), fwd_total_r: +tot.toFixed(3), updated_at: new Date().toISOString() }) });
    return new Response(JSON.stringify({ ok: true, regDay, vixNow: +vixLast.toFixed(1), favourableRegime: vixLast >= MR_SPEC.vixMin, openedThisTick: opened, resolvedThisTick: resolved, openPositions: Object.keys(open).length, forwardN: rs.length, forwardWinRate: rs.length ? +(wins / rs.length).toFixed(3) : null, forwardExpectancyR: +exp.toFixed(4), scannerCount: scanner.length, verdict: rs.length < 30 ? `accumulating ${rs.length}/30 forward trades` : exp > 0 ? "forward-positive" : "forward-negative" }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
