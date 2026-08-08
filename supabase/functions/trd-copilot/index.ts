// trd-copilot — THE PRODUCT. A trader tells us the trade they are ABOUT TO PLACE; we return the complete
// risk answer. It works for ANY instrument, ANY direction, ANY strategy — it does not require our signal,
// because the durable value we actually verified is risk machinery, not entries.
//
// Every number below traces to a measured result in DECISIONS.md:
//   • TP = 3×SL            — D-154: TP 0.5×SL wins 64% of the time and LOSES money; TP 3×SL wins 29% and MAKES it
//   • per-asset vol sizing — D-135/137: implied-vol beats trailing RV in EVERY asset class (GVZ t=27.7, VXN 38.8,
//                            OVX 27.5, MOVE 13.7, DVOL 4.8) — so size by the right vol signal per instrument
//   • 6% portfolio heat    — D-154: 45 instruments = 2.6 EFFECTIVE bets; correlations RISE in selloffs
//   • house money          — D-148: 0.5% of deposit + 2% of banked profit → 2.02× with the deposit never touched
//   • stress avoidance     — D-155: intraday dip-buying in VIX>25 loses in BOTH sample halves (−0.44R)
//   • session vol          — D-141: NY ≈3× Asia; regime carries into every session
// GET ?symbol=NVDA&side=long&equity=25000&deposit=10000&openRisk=200[&entry=][&stopPct=]
import { volRegimeDeRisk } from "../_shared/trd-vol-regime.ts";
import { assetFwdVolDeRisk, ASSET_VOL_MODELS } from "../_shared/trd-asset-vol.ts";
import { sessionExpectedVol } from "../_shared/trd-session-vol.ts";
import { evaluate as scaleEval, minViableDeposit, EXPECTANCY_R, WIN_RATE, RR, EFFECTIVE_BETS } from "../_shared/trd-scale.ts";
import { estimateCost } from "../_shared/trd-cost.ts";
import { geometryFor, RR_GEOMETRY } from "../_shared/trd-geometry-table.ts";

const MAX_HEAT = 0.06, MAX_RISK = 0.02, BASE_RISK = 0.005, HOUSE_RISK = 0.02, TP_MULT = 3;
async function bars(sym: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return null;
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: any[] = [];
  for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume?.[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c, v: Number.isFinite(v) ? v : 0 }); }
  return o.length ? o : null;
}
async function last(sym: string): Promise<number> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json(); const c = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x: number) => Number.isFinite(x)); return c?.length ? c[c.length - 1] : NaN; } catch { return NaN; } }
function atr(b: any[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const P = new URL(req.url).searchParams;
    const symbol = (P.get("symbol") ?? "SPY").toUpperCase().trim();
    const side = (P.get("side") ?? "long").toLowerCase() === "short" ? "short" : "long";
    const equity = Math.max(1, +(P.get("equity") ?? "10000"));
    const deposit = Math.max(1, +(P.get("deposit") ?? P.get("equity") ?? "10000"));
    const openRisk = Math.max(0, +(P.get("openRisk") ?? "0"));
    const b = await bars(symbol);
    if (!b || b.length < 60) return new Response(JSON.stringify({ ok: false, err: `no usable price history for ${symbol}` }), { status: 404, headers: cors });
    const cl = b.map((x: any) => x.c); const i = cl.length - 1;
    const at = atr(b, 14); const entry = +(P.get("entry") ?? "") || cl[i];
    const dir = side === "long" ? 1 : -1;

    // ── VOLATILITY & SIZING (the verified core) ──
    const ret: number[] = []; for (let k = 1; k < cl.length; k++) ret.push(cl[k] / cl[k - 1] - 1);
    const vr = volRegimeDeRisk(ret);
    let deRisk = vr.deRisk, volSrc = "trailing realized vol (no implied-vol index for this instrument)";
    const m = ASSET_VOL_MODELS[symbol];
    if (m) { const iv = await last(m.ivSymbol); const a = assetFwdVolDeRisk(symbol, vr.rv * Math.sqrt(252), iv / 100); if (a.model !== "none") { deRisk = a.deRisk; volSrc = `${m.ivSymbol} implied-vol model (forecast ${a.forecastVolPct}% fwd vol)`; } }

    // ── STOP & TARGET ──
    const stopPctIn = +(P.get("stopPct") ?? "");
    const atrStop = 2 * at[i];
    const stopDist = stopPctIn > 0 ? entry * stopPctIn / 100 : atrStop;
    const stop = entry - dir * stopDist;
    const target = entry + dir * stopDist * TP_MULT;
    const stopPct = stopDist / entry * 100;

    // ── RISK BUDGET (house money + heat cap) ──
    const banked = Math.max(0, equity - deposit);
    const raw = (deposit * BASE_RISK + banked * HOUSE_RISK) * deRisk;
    const perTradeCap = equity * MAX_RISK;
    const heatRoom = Math.max(0, equity * MAX_HEAT - openRisk);
    const riskAmt = Math.max(0, Math.min(raw, perTradeCap, heatRoom));
    const heatCapped = Math.min(raw, perTradeCap) > heatRoom;
    const size = stopDist > 0 ? riskAmt / stopDist : 0;
    const notional = size * entry;
    const depositPortion = raw > 0 ? riskAmt * (deposit * BASE_RISK * deRisk) / raw : 0;

    // ── CONTEXT & WARNINGS ──
    const vix = await last("^VIX");
    const regime = vix < 15 ? "calm" : vix < 25 ? "normal" : "STRESS";
    const warn: string[] = [];
    if (heatCapped) warn.push(riskAmt > 0 ? `Size REDUCED by the portfolio heat cap — you already have ${(openRisk / equity * 100).toFixed(1)}% at risk of a ${MAX_HEAT * 100}% budget.` : `BLOCKED: ${(openRisk / equity * 100).toFixed(1)}% already at risk vs the ${MAX_HEAT * 100}% cap. This trade cannot be taken without closing something.`);
    if (regime === "STRESS") warn.push(`VIX ${vix.toFixed(1)} = STRESS regime. Measured: intraday dip-buying in stress LOSES in both sample halves (−0.44R). Size is already cut to ×${deRisk.toFixed(2)}; consider sitting out.`);
    if (side === "short") warn.push(`SHORT side: across our entire corpus (14 strategy families, 1.7M ICT instances, a 20-cell TP/SL grid) NO short setup ever beat a random entry. Shorts are not forbidden — but no evidence supports a systematic short edge.`);
    if (stopPct > 15) warn.push(`Stop is ${stopPct.toFixed(1)}% away — very wide. Position size is correspondingly tiny; consider a closer structural stop.`);
    // ── R:R GEOMETRY (D-168): does THIS instrument actually travel 3R before 1R? ──
    const geo = geometryFor(symbol);
    const dirHit = geo ? (side === "long" ? geo.hL : geo.hS) : null;
    const dirNet = geo ? (side === "long" ? geo.nL : geo.nS) : null;
    if (geo && dirHit != null && dirHit < 25) warn.push(`GEOMETRY: ${symbol} reaches a 3R target before a 1R stop only ${dirHit}% of the time going ${side} (25% is break-even on the clean win). Measured over ~1,669 samples of full history. Consider an instrument whose geometry pays — the leaders are ${Object.entries(RR_GEOMETRY).filter(([, v]) => v.hL > 27).sort((a, b) => b[1].nL - a[1].nL).slice(0, 5).map(([k, v]) => `${k} ${v.hL}%`).join(", ")}.`);
    const lossesToHalve = riskAmt > 0 ? Math.floor(Math.log(0.5) / Math.log(1 - riskAmt / equity)) : Infinity;
    const sess = sessionExpectedVol(Number.isFinite(vr.rv) ? vr.rv * Math.sqrt(252) * 100 : 13.4);

    // ── CAPITAL LADDER: what changes as the account grows, from minimum viable to institutional ──
    const advShares = (() => { const v = (b as any[]).slice(-60).map((x: any) => x.v ?? 0).filter((x: number) => x > 0); return v.length ? v.reduce((a: number, c: number) => a + c, 0) / v.length : 2e6; })();
    const isCrypto = /USD$|USDT$/.test(symbol) || symbol.includes("-USD");
    const cost = estimateCost(b as any, (P.get("broker") ?? "zero-commission"), isCrypto);   // MEASURED, not asked for
    const scaleBase = { price: entry, stopPct, advShares, minLot: isCrypto ? 0.0001 : 1, costPerTradeUsd: cost.commissionUsd, spreadPct: cost.spreadPct };
    const minDep = minViableDeposit(scaleBase);
    const LADDER = [500, 2000, 10000, 50000, 250000, 1000000, 10000000];
    const ladder = LADDER.map((e) => { const t = scaleEval({ ...scaleBase, equity: e, deposit: Math.min(e, deposit) }); return { equity: e, lot: t.lot, notional: t.notional, risk: t.riskPerTrade, risk_pct: t.riskPct, concurrent_positions: t.positions, cost_in_R: t.costInR, edge_after_cost_R: t.edgeAfterCostR, viable: t.viable, binding: t.bindingConstraint, expected_annual_pct: t.expectedAnnualPct }; });
    const here = scaleEval({ ...scaleBase, equity, deposit });

    return new Response(JSON.stringify({
      ok: true, symbol, side, asof: b[i].d,
      trade: {
        entry: +entry.toFixed(4), stop: +stop.toFixed(4), target: +target.toFixed(4),
        stop_distance_pct: +stopPct.toFixed(2), reward_risk: `1:${TP_MULT}`,
        position_size: +size.toFixed(4), position_notional: +notional.toFixed(2),
        risk_amount: +riskAmt.toFixed(2), risk_pct_of_equity: +(riskAmt / equity * 100).toFixed(3),
      },
      why_this_size: {
        vol_signal: volSrc, vol_derisk_multiplier: +deRisk.toFixed(3),
        house_money: banked > 0 ? `$${banked.toFixed(0)} banked profit — $${(riskAmt - depositPortion).toFixed(2)} of this trade's risk is PROFIT, only $${depositPortion.toFixed(2)} is your original deposit` : `no banked profit yet — risk held to ${(BASE_RISK * 100).toFixed(2)}% of deposit × vol-derisk`,
        portfolio_heat: `${((openRisk + riskAmt) / equity * 100).toFixed(2)}% of a ${MAX_HEAT * 100}% budget`,
        heat_capped: heatCapped,
      },
      survival: {
        consecutive_losses_to_halve_account: Number.isFinite(lossesToHalve) ? lossesToHalve : null,
        note: `A 45-instrument book is only ~2.6 INDEPENDENT bets (measured) — correlations rise in selloffs, so concurrent positions share one ${MAX_HEAT * 100}% budget rather than each getting their own.`,
      },
      context: { vix: Number.isFinite(vix) ? +vix.toFixed(2) : null, regime, instrument_ann_vol_pct: Number.isFinite(vr.rv) ? +(vr.rv * Math.sqrt(252) * 100).toFixed(1) : null, session_expected_vol: sess },
      cost: { measured_spread_pct_round_trip: cost.spreadPct, commission_usd_round_trip: cost.commissionUsd, broker_assumed: cost.broker, cost_in_R: here.costInR, how: cost.source },
      capital_scaling: {
        minimum_viable_deposit: minDep,
        your_tier: { viable: here.viable, binding_constraint: here.bindingConstraint, cost_in_R: here.costInR, edge_after_cost_R: here.edgeAfterCostR, concurrent_positions_supported: here.positions, expected_annual_pct: here.expectedAnnualPct },
        ladder,
        how_it_scales: `As equity grows, TWO things scale: LOT SIZE and the NUMBER of concurrent positions. Both are capped. Positions cap at ~${Math.round(EFFECTIVE_BETS * 4)} names (a 45-instrument book is only ~${EFFECTIVE_BETS} EFFECTIVE bets, so more names add risk, not breadth). Lot size caps at 1% of average daily volume. Below the minimum viable deposit, fixed costs exceed the ${EXPECTANCY_R}R edge and no amount of skill recovers it.`,
        probability_math: `The measured reference edge is ${(WIN_RATE * 100).toFixed(0)}% win rate at 1:${RR} = +${(WIN_RATE * RR - (1 - WIN_RATE)).toFixed(2)}R per trade BEFORE costs. Your round-trip cost here is ${here.costInR}R, leaving ${here.edgeAfterCostR}R.`,
        expected_return_is_conditional: `CRITICAL: "expected_annual_pct" assumes YOUR entries carry that same +${EXPECTANCY_R}R edge and that you find that many qualifying trades. If your entries are no better than random, your edge is ZERO and you simply pay the cost — the sizing still protects you, but it cannot manufacture an edge. This is a calculator, not a promise.`,
      },
      instrument_geometry: geo ? {
        direction_tested: side, hit_3R_before_1R_pct: dirHit, net_expectancy_R: dirNet,
        break_even_pct: 25, favourable: (dirHit ?? 0) >= 25,
        long_hit_pct: geo.hL, short_hit_pct: geo.hS,
        note: "Measured from every 5th bar over full history (~1,669 samples), 2×ATR stop, 3R target, pessimistic fills, net of the measured spread. This is a property of the INSTRUMENT, independent of any entry signal — it tells you whether a 1:3 target is realistic here at all.",
        best_long_geometry: Object.entries(RR_GEOMETRY).filter(([, v]) => v.hL > 27).sort((a, b) => b[1].nL - a[1].nL).slice(0, 8).map(([k, v]) => ({ symbol: k, hit_pct: v.hL, net_R: v.nL })),
        shorts_note: `Only ${Object.values(RR_GEOMETRY).filter((v) => v.hS >= 25).length} of ${Object.keys(RR_GEOMETRY).length} instruments have short geometry at or above break-even — the structural reason short setups keep failing our tests.`,
      } : null,
      warnings: warn,
      evidence: {
        target_rule: "TP = 3×SL. Measured on ~11k trades: TP at 0.5×SL wins 64% of the time and still LOSES money (−0.10R); TP at 3×SL wins 29% and MAKES money (+0.058R). Cutting winners short is what kills accounts.",
        sizing_rule: "Implied-vol indices beat trailing realized vol at forecasting forward vol in every asset class tested (gold GVZ t=27.7 with RV insignificant; Nasdaq VXN t=38.8; oil OVX t=27.5; bonds MOVE t=13.7; crypto DVOL t=4.8).",
        heat_rule: "45 instruments = 2.6 effective bets; average pairwise correlation rises from 0.283 in calm markets to 0.357 in selloffs.",
        house_money_rule: "0.5% of original deposit + 2% of banked profit: 2.02× over the test history with minimum equity $9,978 on a $10,000 deposit — the deposit is never meaningfully exposed.",
      },
      disclaimer: "Risk arithmetic and historical evidence — not investment advice, not a recommendation to take this trade. Sizing math only; you choose the trade.",
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
