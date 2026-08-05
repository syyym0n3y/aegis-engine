// trd-gex — LIVE dealer gamma-exposure levels for the co-pilot (FREE, no SpotGamma). Pulls the CBOE free
// delayed options chain (gamma+OI+IV) and returns net-GEX regime, call/put walls, and the BS-repriced gamma
// flip via the tested _shared/trd-gex.ts core. AWARENESS context, not a signal. ?symbol=SPY (or _SPX), &dte=45.
import { buildGexProfile, type OptContract } from "../_shared/trd-gex.ts";

function parseOcc(sym: string): { type: "C" | "P"; strike: number; dte: number } | null {
  const m = sym.match(/^[A-Z]+?(\d{6})([CP])(\d{8})$/); if (!m) return null;
  const y = 2000 + +m[1].slice(0, 2), mo = +m[1].slice(2, 4) - 1, d = +m[1].slice(4, 6);
  const dte = (Date.UTC(y, mo, d) - Date.now()) / 86400000;
  return { type: m[2] as "C" | "P", strike: +m[3] / 1000, dte };
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const P = new URL(req.url).searchParams;
    const symbol = (P.get("symbol") ?? "SPY").toUpperCase();
    const maxDte = Math.min(365, +P.get("dte")! || 45);
    const cboe = symbol.startsWith("_") ? symbol : symbol; // pass _SPX for index
    const r = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${cboe}.json`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return new Response(JSON.stringify({ ok: false, err: `CBOE HTTP ${r.status} for ${cboe}` }), { status: 502, headers: cors });
    const j = await r.json(); const d = j.data; const spot = d?.current_price ?? d?.close;
    const contracts: OptContract[] = [];
    for (const o of d?.options ?? []) {
      const p = parseOcc(o.option); if (!p || p.dte < 0 || p.dte > maxDte) continue;
      const oi = o.open_interest ?? 0, iv = o.iv ?? 0; if (!(oi > 0) || !(iv > 0)) continue;
      contracts.push({ strike: p.strike, type: p.type, iv, oi, dte: p.dte });
    }
    if (!spot || contracts.length < 10) return new Response(JSON.stringify({ ok: false, err: "insufficient chain", spot, contracts: contracts.length }), { status: 502, headers: cors });
    const g = buildGexProfile(contracts, spot);
    const out = {
      ok: true, symbol, spot, asof_note: "CBOE delayed; OI is prior-session EOD (OCC)",
      regime: g.regime, regime_read: g.regime === "positive"
        ? "dealers dampen moves — vol suppressed, price gravitates to value/POC"
        : "dealers amplify moves — vol expansion, trend/breakout risk",
      total_gex_bn: +(g.totalGEX / 1e9).toFixed(3),
      call_wall: g.callWall.strike, put_wall: g.putWall.strike, gamma_flip: g.gammaFlip,
      flip_read: g.gammaFlip == null ? "n/a" : spot > g.gammaFlip ? "spot ABOVE flip = positive-gamma/stable" : "spot BELOW flip = negative-gamma/unstable",
      contracts_used: contracts.length, max_dte: maxDte,
      disclaimer: "AWARENESS context (where dealers hedge), not investment advice or a signal. Dealer side = standard long-call/short-put assumption.",
    };
    return new Response(JSON.stringify(out, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
