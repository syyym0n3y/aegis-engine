// trd-decide — THE ANSWER: buy or sell, and how much risk, for any instrument. Composes everything that
// SURVIVED: the one Rule-7-verified signal (dip-buy RSI14<30 while price>200MA) + the per-asset forward-vol
// sizing engine + house-money risk accounting (after the first profit, further risk is funded by banked
// profit so the original deposit stops being exposed).
// ?symbol=SPY&equity=10000&deposit=10000  → decision + sizing + survival math. Free data only.
import { decide, LOCKED_SPEC, LOCKED_UNIVERSE } from "../_shared/trd-decision.ts";
import { volRegimeDeRisk } from "../_shared/trd-vol-regime.ts";
import { assetFwdVolDeRisk, ASSET_VOL_MODELS } from "../_shared/trd-asset-vol.ts";

async function daily(sym: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return null;
  const t = res.timestamp as number[]; const q = res.indicators.quote[0];
  const b: { d: string; o: number; h: number; l: number; c: number }[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; b.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c }); }
  return b.length ? b : null;
}
async function ivLevel(sym: string): Promise<number> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json(); const c = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x: number) => Number.isFinite(x)); return c?.length ? c[c.length - 1] / 100 : NaN; } catch { return NaN; } }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
function atr(b: any[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const P = new URL(req.url).searchParams;
    const equity = +(P.get("equity") ?? "10000"), deposit = +(P.get("deposit") ?? P.get("equity") ?? "10000");
    const openRisk = +(P.get("openRisk") ?? "0");

    // ── SCAN MODE: run the LOCKED spec across the whole verified book, respecting the portfolio heat budget ──
    if (P.get("scan") === "1") {
      const fires: any[] = []; const errs: string[] = []; let heat = openRisk;
      for (const sym of LOCKED_UNIVERSE) {
        const bb = await daily(sym); if (!bb || bb.length < 220) { errs.push(sym); continue; }
        const c2 = bb.map((x) => x.c); const j = c2.length - 1;
        const rr = rsi(c2, LOCKED_SPEC.rsiPeriod), aa = atr(bb, 14);
        const ma = c2.slice(-LOCKED_SPEC.trendMA).reduce((s, x) => s + x, 0) / LOCKED_SPEC.trendMA;
        if (!(rr[j] < LOCKED_SPEC.rsiThreshold && c2[j] > ma) || !(aa[j] > 0)) continue;
        const rets: number[] = []; for (let k = 1; k < c2.length; k++) rets.push(c2[k] / c2[k - 1] - 1);
        const vr = volRegimeDeRisk(rets);
        const stopPct = (LOCKED_SPEC.stopATR * aa[j]) / c2[j] * 100;
        const d = decide({ rsi14: rr[j], price: c2[j], sma200: ma, deRisk: vr.deRisk, equity, originalDeposit: deposit, stopDistancePct: stopPct, openRiskAmount: heat, symbol: sym });
        if (d.action === "BUY" && d.riskAmount > 0) heat += d.riskAmount;
        fires.push({ symbol: sym, price: +c2[j].toFixed(2), rsi14: +rr[j].toFixed(1), action: d.action, risk_amount: d.riskAmount, risk_pct: d.riskPctOfEquity, position_size: d.positionSize, stop_pct: +stopPct.toFixed(2), vol_deRisk: +vr.deRisk.toFixed(3), heat_capped: d.heatCapped });
      }
      return new Response(JSON.stringify({
        ok: true, mode: "scan", asof: new Date().toISOString().slice(0, 10), spec: LOCKED_SPEC, universe_size: LOCKED_UNIVERSE.length,
        firing: fires.length, signals: fires, portfolio_heat_pct: +(heat / equity * 100).toFixed(2), heat_budget_pct: LOCKED_SPEC.maxPortfolioHeatPct,
        note: fires.length === 0 ? `No instrument in the verified ${LOCKED_UNIVERSE.length}-book is oversold within an uptrend today — stand aside, risk nothing. Expected ≈${LOCKED_SPEC.firesPerYear} fires/yr; most days are correctly empty.` : `${fires.length} signal(s) firing. Sized under a ${LOCKED_SPEC.maxPortfolioHeatPct}% total-heat budget.`,
        unavailable: errs.length ? errs : undefined,
      }, null, 2), { headers: cors });
    }

    const symbol = (P.get("symbol") ?? "SPY").toUpperCase();
    const b = await daily(symbol);
    if (!b || b.length < 220) return new Response(JSON.stringify({ ok: false, err: `insufficient history for ${symbol}` }), { status: 404, headers: cors });
    const cl = b.map((x) => x.c); const i = cl.length - 1;
    const r14 = rsi(cl, 14); const at = atr(b, 14);
    const sma200 = cl.slice(-200).reduce((s, x) => s + x, 0) / 200;
    const price = cl[i]; const stopPct = (2 * at[i]) / price * 100;
    // sizing: per-asset implied-vol model if we have one, else trailing-RV vol regime
    const ret: number[] = []; for (let k = 1; k < cl.length; k++) ret.push(cl[k] / cl[k - 1] - 1);
    const vr = volRegimeDeRisk(ret);
    let deRisk = vr.deRisk, sizingSrc = "vol-regime (trailing RV)";
    const m = ASSET_VOL_MODELS[symbol];
    if (m) { const iv = await ivLevel(m.ivSymbol); const a = assetFwdVolDeRisk(symbol, vr.rv * Math.sqrt(252), iv); if (a.model !== "none") { deRisk = a.deRisk; sizingSrc = `${m.ivSymbol} forward-vol model (fwd ${a.forecastVolPct}%)`; } }
    const d = decide({ rsi14: r14[i], price, sma200, deRisk, equity, originalDeposit: deposit, stopDistancePct: stopPct, openRiskAmount: openRisk, symbol });
    return new Response(JSON.stringify({
      ok: true, symbol, asof: b[i].d, price: +price.toFixed(2), spec: LOCKED_SPEC, in_verified_book: !d.offBook,
      portfolio: { open_risk: openRisk, heat_pct: d.portfolioHeatPct, heat_budget_pct: LOCKED_SPEC.maxPortfolioHeatPct, heat_capped: d.heatCapped },
      signal: { rsi14: +r14[i].toFixed(1), sma200: +sma200.toFixed(2), trend: price > sma200 ? "uptrend" : "downtrend" },
      decision: d.action, why: d.reason,
      risk: { risk_amount: d.riskAmount, risk_pct_of_equity: d.riskPctOfEquity, position_size: d.positionSize, position_notional: d.positionNotional, stop_distance_pct: +stopPct.toFixed(2), sizing_source: sizingSrc, vol_deRisk: +deRisk.toFixed(3) },
      house_money: { banked_profit: d.bankedProfit, active: d.houseMoneyActive, explanation: d.capitalAtRisk },
      survival: d.survivalNote,
      evidence: "The ONLY signal permitted to issue a BUY is dip-buy (RSI14<30 within an uptrend): +0.122R vs random −0.051R (t=5.63), OOS-stable (t=3.92), positive in 16/21 instruments, beats a matched random control in calm/normal/stress regimes independently. Every other setup tested (14 families, 45 instruments, full history) failed the random-control gate — D-146. No SHORT setup ever passed, so this engine never issues SELL.",
      disclaimer: "Historical evidence and risk arithmetic, not investment advice. Paper-first; no real-money order path.",
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
