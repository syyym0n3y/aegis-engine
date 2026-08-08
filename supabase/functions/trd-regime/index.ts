// trd-regime — the live co-pilot: WHAT PHASE we're in, WHAT'S about to hurt, WHERE to hide, and (via the
// scanner) WHAT'S favourable now + HOW MUCH to risk. Regime read from real leading signals (yield curve,
// VIX, trend, credit) + the historical event playbook (crash-type-dependent shelters, D-120) + a live
// conditional-edge scan (vol-regime de-risk + mean-reversion setups). Public, CORS-open, read-only.
import { volRegimeDeRisk } from "../_shared/trd-vol-regime.ts";
import { meanRevSignal, MR_SPEC, type Bar } from "../_shared/trd-meanrev.ts";

async function y(sym: string, days = 300): Promise<{ d: string; o: number; h: number; l: number; c: number }[]> {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - days * 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: any[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o, h, l, c }); }
  return out;
}
const closes = (b: any[]) => b.map((x) => x.c);
const last = (b: any[]) => b[b.length - 1]?.c ?? NaN;
const sma = (a: number[], n: number) => a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : NaN;

// EVENT PLAYBOOK — real history (D-120, trd-regime-engine.ts). Crash-type-dependent shelters. Static (it's history).
const PLAYBOOK = {
  note: "The hiding place depends on the TYPE of crash. Read the driver, not just the drawdown.",
  growth_scare: { examples: "2008 GFC, 2020 COVID", spy: "−34 to −55%", protects: ["TLT/IEF bonds (+14 to +25%)", "GLD gold (+24% in 2008)", "UUP dollar (+4 to +12%)"], hit: ["QQQ", "HYG credit", "DBC commodities", "XLU/XLP"] },
  inflation_rate_shock: { examples: "2022", spy: "−24%", protects: ["UUP dollar (+18%)", "DBC commodities (+21%)"], hit: ["SPY/QQQ", "TLT bonds (−29% — bonds FAIL here)", "GLD", "credit"], warning: "bonds crash WITH stocks in an inflation shock — the classic 60/40 shelter fails" },
};

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const [tnx, irx, vix, spy, hyg, lqd] = await Promise.all([y("^TNX"), y("^IRX"), y("^VIX"), y("SPY"), y("HYG"), y("LQD")]);
    const curve = last(tnx) - last(irx);            // 10y − 3m; <0 inverted
    const vixNow = last(vix);
    const spyC = closes(spy); const trendUp = last(spy) > sma(spyC, 200);
    const credRatioNow = last(hyg) / last(lqd);
    const credSeries = hyg.map((b, i) => lqd[i] ? b.c / lqd[i].c : NaN).filter(Number.isFinite);
    const credMA = sma(credSeries, 60); const credStress = credRatioNow < credMA;
    let score = 0; const signals: string[] = [];
    if (curve < 0) { score += 35; signals.push(`yield curve INVERTED (${curve.toFixed(2)}pp) — #1 recession lead`); }
    else if (curve < 0.5) { score += 15; signals.push(`curve flat (${curve.toFixed(2)}pp) — late cycle`); }
    if (!trendUp) { score += 25; signals.push("SPY below 200d MA — downtrend"); }
    if (vixNow > 25) { score += 20; signals.push(`VIX ${vixNow.toFixed(0)} — stress`); } else if (vixNow > 20) { score += 10; signals.push(`VIX ${vixNow.toFixed(0)} — rising`); }
    if (credStress) { score += 20; signals.push("credit risk-off (HY < IG)"); }
    const phase = score >= 55 ? "CONTRACTION / high recession risk" : score >= 30 ? "LATE-CYCLE / fragile" : trendUp ? "EXPANSION" : "RECOVERY/UNCERTAIN";
    const posture = score >= 55 ? "DEFENSIVE — cut risk, rotate to the crash-type shelter, no new longs" : score >= 30 ? "CAUTION — trim size, favour quality, tighten stops" : "RISK-ON ok — harvest favourable setups, stay alert to the signals";

    // live conditional-edge scan: vol-regime de-risk + mean-reversion favourability across liquid names
    const scanSyms = ["SPY", "QQQ", "IWM", "GLD", "TLT", "HYG"];
    const scan: any[] = [];
    for (const s of scanSyms) {
      const b = s === "SPY" ? spy : await y(s, 800);
      if (b.length < 210) continue;
      const rets: number[] = []; const c = closes(b); for (let i = 1; i < c.length; i++) if (c[i] > 0 && c[i - 1] > 0) rets.push(Math.log(c[i] / c[i - 1]));
      const vr = volRegimeDeRisk(rets);
      const mr = meanRevSignal(b as Bar[], vixNow, MR_SPEC);
      scan.push({ symbol: s, sizeMultiplier: +vr.deRisk.toFixed(2), volElevated: vr.elevated, meanRevSetup: mr ? mr.side : null });
    }
    const favourable = scan.filter((x) => x.meanRevSetup);

    return new Response(JSON.stringify({
      asOf: last(spy) ? spy[spy.length - 1].d : null,
      regime: { phase, recessionRiskScore: score, curve10y3m: +curve.toFixed(2), vix: +vixNow.toFixed(1), spyAbove200MA: trendUp, creditRiskOff: credStress, signals, posture },
      whatsFavourableNow: favourable.length ? favourable : "no mean-reversion setups firing (calm) — size-multipliers below are the vol-regime risk guide",
      sizingGuide: scan,
      eventPlaybook: PLAYBOOK,
      note: "Co-pilot: phase + what's about to hurt + where to hide (by crash type) + what's favourable now + how much to risk. Read-only. Not advice.",
    }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 200) }), { status: 500, headers: cors }); }
});
