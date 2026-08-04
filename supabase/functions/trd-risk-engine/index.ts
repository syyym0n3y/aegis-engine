// trd-risk-engine — the broker-agnostic portfolio risk X-ray. Works for ANY trader on ANY broker on
// earth: they send a positions list (symbol, side, notional) + equity, we pull REAL history and return
// what no free tool does well — correlation-adjusted, FAT-TAILED joint risk of ruin, their REAL number
// of bets, and a sizing prescription. No signals, no direction calls. Pure risk. POST JSON:
//   { equity: 25000, positions: [ {symbol:"NVDA", side:"long", notional:12000}, ... ] }
// Public + CORS-open (a global risk seatbelt). No auth, no writes, no orders.
import { bootstrapRuin, corrMatrix, effectiveBets, type Position } from "../_shared/trd-portfolio-risk.ts";
import { volRegimeDeRisk } from "../_shared/trd-vol-regime.ts";

const YMAP: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", DOGE: "DOGE-USD", GOLD: "GC=F", OIL: "CL=F", SPX: "^GSPC", NDX: "^IXIC" };
async function dailyReturns(symbol: string): Promise<number[]> {
  const sym = YMAP[symbol.toUpperCase()] ?? symbol;
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 800 * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const adj = res.indicators?.adjclose?.[0]?.adjclose as number[] | undefined; const c = adj ?? res.indicators.quote[0].close as number[];
  const out: number[] = []; for (let i = 1; i < c.length; i++) if (c[i] > 0 && c[i - 1] > 0 && Number.isFinite(c[i]) && Number.isFinite(c[i - 1])) out.push(Math.log(c[i] / c[i - 1]));
  return out;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const equity = +body.equity; const raw = Array.isArray(body.positions) ? body.positions : [];
    if (!(equity > 0) || !raw.length) return new Response(JSON.stringify({ error: "send { equity>0, positions:[{symbol,side,notional}] }" }), { status: 400, headers: cors });
    const ruinThreshold = Math.min(0.9, Math.max(0.1, +body.ruinThreshold || 0.5));
    const horizonDays = Math.min(756, Math.max(21, +body.horizonDays || 252));

    // resolve each position → weight + real returns
    const syms: string[] = [], cols: number[][] = [], pos: Position[] = [], perSym: any[] = [], dropped: string[] = [];
    for (const p of raw) {
      const symbol = String(p.symbol || "").trim(); if (!symbol) continue;
      const side: 1 | -1 = /short|sell|-1/i.test(String(p.side)) ? -1 : 1;
      const notional = Math.abs(+p.notional || (+p.weight || 0) * equity);
      if (!(notional > 0)) continue;
      const rets = await dailyReturns(symbol);
      if (rets.length < 120) { dropped.push(symbol); continue; }
      const vr = volRegimeDeRisk(rets);
      syms.push(symbol); cols.push(rets); pos.push({ symbol, side, weight: notional / equity });
      perSym.push({ symbol, side: side === 1 ? "long" : "short", weight: +(notional / equity).toFixed(3), volRegimeDeRisk: +vr.deRisk.toFixed(3), volElevated: vr.elevated });
    }
    if (pos.length < 1) return new Response(JSON.stringify({ error: "no positions had enough price history", dropped }), { status: 400, headers: cors });

    // align columns to a common length (Monte-Carlo needs equal-length aligned returns)
    const T = Math.min(...cols.map((c) => c.length)); const aligned = cols.map((c) => c.slice(c.length - T));
    const ruin = bootstrapRuin(aligned, pos, { horizonDays, ruinThreshold, nSims: 4000, seed: 20260804 });
    const cm = corrMatrix(aligned); const ebets = ruin.effectiveBets, nominal = pos.length;

    // sizing prescription: scale gross exposure to bring pRuin under a 10% target (risk is ~ linear-ish in exposure at the tail)
    const TARGET = 0.10; let suggestScale = 1;
    if (ruin.pRuin > TARGET && ruin.grossExposure > 0) {
      const test = bootstrapRuin(aligned, pos.map((p) => ({ ...p, weight: p.weight * 0.5 })), { horizonDays, ruinThreshold, nSims: 2000, seed: 20260804 });
      // interpolate a scale between 0.5 and 1 toward the target
      suggestScale = test.pRuin <= TARGET ? +(0.5 + 0.5 * (ruin.pRuin - TARGET) / Math.max(1e-6, ruin.pRuin - test.pRuin)).toFixed(2) : 0.5;
      suggestScale = Math.max(0.1, Math.min(1, suggestScale));
    }

    const verdict = ruin.pRuin >= 0.25 ? "RUINOUS SIZING" : ruin.pRuin >= 0.10 ? "OVER-SIZED" : ruin.pRuin >= 0.03 ? "AGGRESSIVE" : "SURVIVABLE";
    const hiddenConc = ebets < nominal * 0.6;
    const plainEnglish =
      `You hold ${nominal} position${nominal > 1 ? "s" : ""} but only ~${ebets} independent bet${ebets < 1.5 ? "" : "s"}${hiddenConc ? " — they move together, so your real risk is far more concentrated than it looks" : ""}. ` +
      `At ${(ruin.grossExposure * 100).toFixed(0)}% gross exposure, the account has a ${(ruin.pRuin * 100).toFixed(1)}% chance of a ${(ruinThreshold * 100).toFixed(0)}%+ drawdown over ${horizonDays} trading days (fat-tailed, real history). ` +
      (suggestScale < 1 ? `Cut every position to ~${(suggestScale * 100).toFixed(0)}% of current size to bring ruin risk toward ${(TARGET * 100).toFixed(0)}%.` : `Sizing is within a survivable band — the job now is to not add correlated risk.`);

    return new Response(JSON.stringify({
      verdict, plainEnglish,
      probRuin: ruin.pRuin, ruinThreshold, horizonDays,
      nominalPositions: nominal, effectiveBets: ebets, hiddenConcentration: hiddenConc,
      grossExposure: ruin.grossExposure, annualizedVol: ruin.annVol,
      horizonReturn: { median: ruin.medianReturn, p05: ruin.p05, p95: ruin.p95 }, medianMaxDrawdown: ruin.medianMaxDD,
      suggestedScale: suggestScale, positions: perSym, correlationMatrix: { symbols: syms, matrix: cm },
      droppedNoHistory: dropped, alignedDays: T,
      note: "Correlation-adjusted, fat-tailed (block-bootstrap on real history) portfolio ruin. No signals, no direction. Risk only.",
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ error: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
