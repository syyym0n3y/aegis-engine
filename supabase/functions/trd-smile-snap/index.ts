// trd-smile-snap — daily snapshot of option-smile measures from FREE CBOE delayed chains into trd_smile.
// Implements the 2 OPTIONS-based survivors of the 212-predictor post-publication test (D-159):
//   • Yan (2011) SmileSlope  — orig t=8.168; still |t|>3 since 2015 in the OSAP data
//   • Bali & Hovakimian (2009) CPVolSpread — orig t=4.2  (dCPVolSpread = its monthly change → needs history)
// WHY THIS EXISTS: no free historical option-chain archive is available, so the ONLY honest path to testing
// these on our own data is to accumulate the series forward from today. This function is that accumulator.
// It is NOT a signal generator and nothing reads it for trading decisions.
import { smileSlope, type OptQuote } from "../_shared/trd-smile.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UNIVERSE = ["SPY","QQQ","IWM","DIA","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F","GLD","SLV","TLT","HYG","XLK","XLF","XLE","XLV","XLU","XLP","XLY","XLI","SMH","XBI","KRE","EEM","EFA","FXI","USO"];
// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-smile-snap", p_outcome: o.slice(0, 180) }),
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
  try {
    const asof = new Date().toISOString().slice(0, 10);
    const rows: any[] = []; const errs: string[] = [];
    for (const sym of UNIVERSE) {
      try {
        const r = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) { errs.push(`${sym}:${r.status}`); continue; }
        const j = await r.json();
        const q: OptQuote[] = (j.data?.options ?? []).map((o: any) => ({ option: o.option, iv: o.iv, delta: o.delta }));
        const atm = smileSlope(q, 30, 0.50), otm = smileSlope(q, 30, 0.25);
        if (atm.smileSlope == null) { errs.push(`${sym}:thin`); continue; }
        rows.push({ asof, symbol: sym, call_iv: atm.callIv, put_iv: atm.putIv, smile_slope: atm.smileSlope, skew_25d: otm.smileSlope, cp_vol_spread: atm.cpVolSpread, dte: atm.dteUsed, contracts: atm.contracts });
      } catch (e) { errs.push(`${sym}:${String(e).slice(0, 18)}`); }
    }
    if (rows.length) await fetch(`${SB}/rest/v1/trd_smile`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    const total = await fetch(`${SB}/rest/v1/trd_smile?select=asof&order=asof.asc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
    return new Response(JSON.stringify({
      ok: true, asof, snapshotted: rows.length, errors: errs.length ? errs : undefined,
      history_starts: (total as any[])[0]?.asof ?? asof,
      widest_skew_25d: rows.filter((r) => r.skew_25d != null).sort((a, b) => b.skew_25d - a.skew_25d).slice(0, 5).map((r) => `${r.symbol} ${(r.skew_25d * 100).toFixed(1)}vp`),
      status: "ACCUMULATING — Yan SmileSlope + Bali-Hovakimian CPVolSpread survived the 212-predictor post-publication test (D-159) but are UNTESTED BY US. No free historical chain exists; this builds the history forward. Not a trading signal.",
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
