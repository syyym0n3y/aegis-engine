// trd-macro-pump — autonomous macro-regime pump. Uses KEYLESS Yahoo market data (edge-reachable;
// FRED's CDN blocks the Supabase datacenter) for the two fastest, most-watched fragility signals:
//   • the yield curve (10y ^TNX minus 3m ^IRX) — inversion is the classic leading fragility signal
//   • the vol regime (^VIX percentile over 5y) — the coincident risk-off signal
// It classifies the regime with the tested trd-macro engine and writes trd_macro_state, emitting a
// de-risk MULTIPLIER the paper bot reads to SHRINK size when fragile. It never predicts direction.
// Credit-spread / unemployment / CPI (FRED-only) are added best-effort by scripts/trd-macro-refresh.ts
// when FRED is reachable; whichever source ran last wins in trd_macro_state.
import { blendDeRisk, classifyRegime, type MacroIndicators } from "./trd-macro.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UA = { "User-Agent": "Mozilla/5.0 (aegis-macro-pump)" };

async function yahooMeta(sym: string): Promise<number | undefined> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`, { headers: UA });
  if (!r.ok) return undefined;
  const j = await r.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return Number.isFinite(p) ? p : undefined;
}
async function yahooCloses(sym: string, range = "5y"): Promise<number[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=${range}`, { headers: UA });
  if (!r.ok) return [];
  const j = await r.json();
  const c = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return (c as (number | null)[]).filter((x): x is number => x !== null && Number.isFinite(x));
}
const percentile = (xs: number[], v: number) => xs.length ? xs.filter((x) => x <= v).length / xs.length : undefined;

// D-314 completion probe — wraps the handler so trd_cron_health_v can verify this fn actually COMPLETED,
// not merely that pg_cron dispatched it. Fire-and-forget: it can never alter the response or raise.
const __SBB = Deno.env.get("SUPABASE_URL") ?? "", __SRKB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __beat = (o: string) =>
  fetch(`${__SBB}/rest/v1/rpc/trd_beat`, {
    method: "POST",
    headers: { apikey: __SRKB, Authorization: `Bearer ${__SRKB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_fn: "trd-macro-pump", p_outcome: o.slice(0, 180) }),
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
    // 10y and 3m yields (percent), and the VIX level + its 5y history for a regime percentile.
    const tnx = await yahooMeta("%5ETNX"); // 10-year
    const irx = await yahooMeta("%5EIRX"); // 13-week (3m)
    const vixNow = await yahooMeta("%5EVIX");
    const vixHist = await yahooCloses("%5EVIX", "5y");

    const ind: MacroIndicators = {
      economy: "US",
      asOf: new Date().toISOString().slice(0, 10),
      yieldCurve10y3m: (tnx !== undefined && irx !== undefined) ? +(tnx - irx).toFixed(3) : undefined,
      volPercentile: (vixNow !== undefined && vixHist.length > 50) ? percentile(vixHist, vixNow) : undefined,
    };
    const us = classifyRegime(ind);
    const regimes = [us];
    const { deRiskFactor, drivers } = blendDeRisk(regimes);

    await fetch(`${SB}/rest/v1/trd_macro_state?on_conflict=id`, {
      method: "POST",
      headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: "default", economies: regimes, blended_de_risk: deRiskFactor, drivers, as_of: us.asOf, updated_at: new Date().toISOString() }),
    });
    await fetch(`${SB}/rest/v1/trd_macro_history`, { method: "POST", headers: { ...hdr, Prefer: "return=minimal" }, body: JSON.stringify({ economy: "US", as_of: us.asOf, phase: us.phase, fragility: us.fragility, de_risk: us.deRiskFactor, regime: us }) });

    return new Response(JSON.stringify({ ok: true, source: "yahoo", blended_de_risk: deRiskFactor, drivers, economies: regimes, indicators: { US: ind, raw: { tnx, irx, vixNow, vixHistN: vixHist.length } } }, null, 2), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors });
  }
});
