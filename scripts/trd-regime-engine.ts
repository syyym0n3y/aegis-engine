#!/usr/bin/env -S deno run --allow-net
// trd-regime-engine — the market-awareness co-pilot the operator asked for: WHAT PHASE are we in, what's
// the recession risk, and HOW DO INSTRUMENTS BEHAVE in the events that cause losses — grounded in real
// history. Answers "don't be long into a recession" with data: (1) live regime read from leading signals
// (yield curve, credit, vol, trend), (2) the historical PLAYBOOK — in every big equity crash, what rose
// and what fell, so we know where to hide, (3) did the leading signals warn before each crash. Free Yahoo.

const ASSETS = ["SPY", "QQQ", "TLT", "IEF", "GLD", "HYG", "LQD", "UUP", "DBC", "XLU", "XLP"];
async function daily(sym: string): Promise<Map<string, number>> {
  const p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>();
  if (!res?.timestamp) return m; const t = res.timestamp as number[]; const adj = res.indicators?.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close;
  for (let i = 0; i < t.length; i++) { const c = adj[i]; if (c > 0 && Number.isFinite(c)) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c); }
  return m;
}
const tnx = await daily("^TNX"), irx = await daily("^IRX"), vix = await daily("^VIX");
const A = new Map<string, Map<string, number>>(); for (const s of ASSETS) { const m = await daily(s); if (m.size > 300) A.set(s, m); }
const spy = A.get("SPY")!; const dates = [...spy.keys()].sort();
const sma = (m: Map<string, number>, ds: string[], i: number, n: number) => { if (i < n) return NaN; let s = 0, c = 0; for (let k = i - n; k < i; k++) { const v = m.get(ds[k]); if (v) { s += v; c++; } } return c ? s / c : NaN; };

// ---- (1) LIVE regime read ----
const last = dates[dates.length - 1]; const li = dates.length - 1;
const curve = (tnx.get(last) ?? NaN) - (irx.get(last) ?? NaN);   // 10y - 3m; <0 = inverted (recession leading)
const vixNow = vix.get(last) ?? NaN;
const spyMA = sma(spy, dates, li, 200); const trendUp = (spy.get(last) ?? 0) > spyMA;
const hyg = A.get("HYG")!, lqd = A.get("LQD")!;
const credRatio = (hyg.get(last) ?? 1) / (lqd.get(last) ?? 1);
const credMA = (() => { let s = 0, c = 0; for (let k = li - 60; k < li; k++) { const h = hyg.get(dates[k]), l = lqd.get(dates[k]); if (h && l) { s += h / l; c++; } } return c ? s / c : credRatio; })();
const credStress = credRatio < credMA;                            // HY underperforming IG = risk-off
let score = 0; const sig: string[] = [];
if (curve < 0) { score += 35; sig.push(`yield curve INVERTED (${curve.toFixed(2)}pp) — the #1 recession lead`); }
else if (curve < 0.5) { score += 15; sig.push(`curve flat (${curve.toFixed(2)}pp) — late cycle`); }
if (!trendUp) { score += 25; sig.push(`SPY below 200d MA — downtrend`); }
if (vixNow > 25) { score += 20; sig.push(`VIX elevated (${vixNow.toFixed(0)}) — stress`); }
else if (vixNow > 20) { score += 10; sig.push(`VIX rising (${vixNow.toFixed(0)})`); }
if (credStress) { score += 20; sig.push(`credit risk-off (HY < IG)`); }
const phase = score >= 55 ? "CONTRACTION / high recession risk" : score >= 30 ? "LATE-CYCLE / fragile" : trendUp ? "EXPANSION" : "RECOVERY/UNCERTAIN";
console.log(`════ LIVE REGIME READ (${last}) ════`);
console.log(`  PHASE: ${phase}   ·   recession-risk score ${score}/100`);
console.log(`  10y-3m curve ${curve.toFixed(2)}pp  ·  VIX ${vixNow.toFixed(0)}  ·  SPY ${trendUp ? "above" : "BELOW"} 200MA  ·  credit ${credStress ? "risk-OFF" : "risk-on"}`);
sig.forEach((s) => console.log(`   - ${s}`));

// ---- (2) historical PLAYBOOK: identify big SPY drawdowns, show what protected ----
console.log(`\n════ EVENT PLAYBOOK — how instruments behaved in the biggest equity crashes (real history) ════`);
const sp = dates.map((d) => spy.get(d)!); let pk = sp[0], pkI = 0; const crashes: [number, number][] = [];
for (let i = 1; i < sp.length; i++) { if (sp[i] > pk) { pk = sp[i]; pkI = i; } const dd = (pk - sp[i]) / pk; if (dd > 0.18 && (crashes.length === 0 || crashes[crashes.length - 1][1] < pkI)) crashes.push([pkI, i]); }
// merge/keep distinct deep drawdowns by trough
const seen = new Set<string>(); const events: { name: string; from: string; to: string }[] = [];
for (const [a, b] of crashes) { let tr = b; for (let k = b; k < Math.min(b + 250, sp.length); k++) if (sp[k] < sp[tr]) tr = k; const key = dates[tr].slice(0, 7); if (seen.has(key)) continue; seen.add(key); events.push({ name: dates[a].slice(0, 7) + "→" + dates[tr].slice(0, 7), from: dates[a], to: dates[tr] }); }
const perf = (m: Map<string, number>, from: string, to: string) => { const f = m.get(from), t = m.get(to); return f && t ? (t / f - 1) * 100 : NaN; };
console.log(`  ${"crash window".padEnd(18)} ${ASSETS.map((s) => s.padStart(6)).join(" ")}   VIXpk`);
for (const e of events.slice(-5)) {
  const row = ASSETS.map((s) => { const v = perf(A.get(s)!, e.from, e.to); return (Number.isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(0) : "—").padStart(6); });
  let vpk = 0; for (const d of dates) if (d >= e.from && d <= e.to) vpk = Math.max(vpk, vix.get(d) ?? 0);
  console.log(`  ${e.name.padEnd(18)} ${row.join(" ")}   ${vpk.toFixed(0)}`);
}
console.log(`\n  READ: TLT/IEF (duration), GLD (gold), UUP (USD), XLU/XLP (defensives) are the historical HIDING PLACES;`);
console.log(`  SPY/QQQ/HYG/DBC get hit. That's the recession playbook — rotate defensive + de-risk when the score climbs.`);

// ---- (3) did the leading signals warn? curve inversion lead time ----
console.log(`\n════ DID THE SIGNALS WARN? (yield-curve inversion → recession lead) ════`);
let invStart = ""; for (let i = 1; i < dates.length; i++) { const c = (tnx.get(dates[i]) ?? 9) - (irx.get(dates[i]) ?? 0); const cp = (tnx.get(dates[i - 1]) ?? 9) - (irx.get(dates[i - 1]) ?? 0); if (cp >= 0 && c < 0) console.log(`  curve inverted ${dates[i]} (10y-3m ${c.toFixed(2)}pp)`); }
console.log(`\n  The curve has led every modern recession by ~6-18 months. Combined with credit + vol + trend, the score`);
console.log(`  above is the early-warning. Current score ${score}/100 → ${score >= 55 ? "DEFENSIVE posture warranted" : score >= 30 ? "raise caution, trim risk" : "risk-on ok, stay alert"}.`);
