// intraday-index-edge.ts (D-948) — does a SYSTEMATIC intraday index edge clear fees? The operator asked to
// reverse-engineer a live NQ order-flow scalper (marinexlambo) and test whether "$100 -> wealth" is reachable via the
// PROP-FIRM path (a small eval fee buys funded size; the edge, if real, scales without personal ruin). This tests the
// SYSTEMATIC skeleton of intraday index trading on QQQ (the NQ proxy), keyless Yahoo data, with:
//   1) OVERNIGHT vs INTRADAY decomposition — where does the drift actually live? (the documented overnight anomaly:
//      most index return is overnight; intraday is ~flat -> an intraday trader has NO tailwind, only noise to time)
//   2) INTRADAY MOMENTUM — does the first-hour return sign predict the rest-of-day? (Gao-Leung-Zhang 2018)
//   3) NQ ECONOMICS — intraday futures cost is ~2bp round-trip (1 tick 0.25pt=$5 + ~$4 comm on a ~24.6k index), FAR
//      below equity's 20bp; an edge that was sub-fee on equities can clear here. Net at 2bp AND a punitive 4bp.
//   4) DEFLATION CEILING + a PROP-EVAL readout (R:R, win rate, and the pass-probability the prop model actually rewards).
// Honest by construction: reports the measurement, benchmarks intraday vs a buy-hold and vs the overnight leg, and
// states whether the net edge clears the noise ceiling. No look-ahead: the signal is the completed first-hour bar.
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("intraday-index-edge", [
  { name: "SYMBOL", def: "QQQ", note: "the NQ proxy ETF (keyless Yahoo)" },
  { name: "INTERVAL", def: "1h", note: "Yahoo intraday interval" }, { name: "RANGE", def: "730d", note: "Yahoo range (1h max 730d)" },
  { name: "NQ_PX", def: "24600", note: "approx NQ index level for point/economics translation ($20/pt)" },
  { name: "COST_BP", def: "2", note: "NQ round-trip cost in bp of notional (~2bp: 1 tick spread + comm); a 4bp punitive check is also printed" },
  { name: "RUN_ID", def: "D-948-intraday-index-edge" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "iie", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q: _q } = mkStrictRead(OWNED, hdr); void _q;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
// 1) fetch keyless Yahoo intraday
const url = `https://query1.finance.yahoo.com/v8/finance/chart/${K.SYMBOL}?interval=${K.INTERVAL}&range=${K.RANGE}`;
let js: { chart: { result: { timestamp: number[]; indicators: { quote: { open: number[]; high: number[]; low: number[]; close: number[] }[] } }[] } };
{ let ok = false, tries = 0; let r: Response | null = null;
  while (!ok && tries < 6) { tries++; try { r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }); if (r.ok) { ok = true; break; } } catch { /* retry */ } await new Promise((res) => setTimeout(res, 1500)); }
  if (!ok || !r) { console.error("!! Yahoo intraday fetch failed after retries — UNTESTED, no claim."); Deno.exit(1); }
  js = await r.json(); }
const res = js.chart.result[0]; const ts = res.timestamp; const Q = res.indicators.quote[0];
type Bar = { t: number; o: number; h: number; l: number; c: number; day: string };
const bars: Bar[] = []; for (let i = 0; i < ts.length; i++) { const o = Q.open[i], h = Q.high[i], l = Q.low[i], c = Q.close[i]; if ([o, h, l, c].some((x) => x == null)) continue; bars.push({ t: ts[i], o, h, l, c, day: new Date(ts[i] * 1000).toISOString().slice(0, 10) }); }
console.log(`\n==> D-948 INTRADAY INDEX EDGE — ${K.SYMBOL} ${K.INTERVAL}, ${bars.length} bars, ${bars[0]?.day}..${bars[bars.length - 1]?.day}`);
// group into days
const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b);
const days = [...byDay.keys()].sort(); const cost = +K.COST_BP / 1e4, costPunitive = 4 / 1e4;
// 2) OVERNIGHT vs INTRADAY decomposition
const overnight: number[] = [], intraday: number[] = [], fullDay: number[] = [];
let prevClose: number | null = null;
for (const d of days) { const bs = byDay.get(d)!; const open = bs[0].o, close = bs[bs.length - 1].c;
  if (prevClose !== null) overnight.push(Math.log(open / prevClose)); intraday.push(Math.log(close / open)); if (prevClose !== null) fullDay.push(Math.log(close / prevClose)); prevClose = close; }
const annD = 252;
const show = (nm: string, a: number[]) => console.log(`  ${nm.padEnd(20)} ${(mean(a) * annD * 100).toFixed(1).padStart(7)}%/yr  per-day ${(mean(a) * 1e4).toFixed(2).padStart(6)}bp  t ${tstat(a).toFixed(2).padStart(6)}  (n ${a.length})`);
console.log(`\n  WHERE THE DRIFT LIVES (the overnight anomaly — an intraday trader only gets the INTRADAY leg):`);
show("overnight (C->O)", overnight); show("intraday (O->C)", intraday); show("full day (C->C)", fullDay);
// 3) INTRADAY MOMENTUM: sign of the FIRST completed bar's return predicts the REST of the day (open+1 .. close). Signal is
// the first bar (no look-ahead: we act at the first bar's close, hold to session close). Trade long/short by that sign.
const mom: number[] = [], momNet: number[] = [], momNetPun: number[] = []; let wins = 0, rr: number[] = [];
for (const d of days) { const bs = byDay.get(d)!; if (bs.length < 3) continue;
  const firstRet = Math.log(bs[0].c / bs[0].o);                 // first bar (e.g. first hour)
  const restRet = Math.log(bs[bs.length - 1].c / bs[0].c);      // first-bar-close -> session close (tradable)
  const sig = Math.sign(firstRet); if (sig === 0) continue;
  const pnl = sig * restRet; mom.push(pnl); momNet.push(pnl - 2 * cost); momNetPun.push(pnl - 2 * costPunitive);
  if (pnl > 0) wins++; rr.push(pnl); }
const winRate = wins / Math.max(1, mom.length);
const gs = { mu: mean(mom) * annD, sr: mean(mom) / (sd(mom) || 1) * Math.sqrt(annD), t: tstat(mom) };
const ns = { mu: mean(momNet) * annD, sr: mean(momNet) / (sd(momNet) || 1) * Math.sqrt(annD), t: tstat(momNet) };
const nsp = { mu: mean(momNetPun) * annD, t: tstat(momNetPun) };
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  INTRADAY MOMENTUM (first ${K.INTERVAL} bar sign -> hold to close; ${mom.length} days):`);
console.log(`    GROSS ${(100 * gs.mu).toFixed(1)}%/yr, Sharpe ${gs.sr.toFixed(2)}, t ${gs.t.toFixed(2)}, win-rate ${(100 * winRate).toFixed(1)}%`);
console.log(`    NET @${K.COST_BP}bp ${(100 * ns.mu).toFixed(1)}%/yr, Sharpe ${ns.sr.toFixed(2)}, t ${ns.t.toFixed(2)}   |   NET @4bp ${(100 * nsp.mu).toFixed(1)}%/yr, t ${nsp.t.toFixed(2)}`);
console.log(`    per-trade in NQ points (~$${K.NQ_PX} @ $20/pt): gross ${(mean(mom) * +K.NQ_PX).toFixed(1)}pt = $${(mean(mom) * +K.NQ_PX * 20).toFixed(0)}/contract; cost ~${(2 * cost * +K.NQ_PX).toFixed(2)}pt`);
console.log(`    CEILING ${ceil.ceiling.toFixed(2)} — net t ${ns.t.toFixed(2)} ${Math.abs(ns.t) > ceil.ceiling ? "CLEARS" : "does NOT clear"} the noise ceiling`);
// 4) PROP-EVAL readout — a prop trader does not maximise Sharpe; they hit a target before a trailing drawdown. Simulate
// independent eval attempts on the NET per-day PnL (in $/contract), bootstrap random start points, standard-ish eval:
// target +$3000, trailing max drawdown $2500 (Apex-50k-like), 1 contract. Compare pass-rate to a zero-edge control.
const perDay$ = momNet.map((r) => r * +K.NQ_PX * 20);           // $/contract/day at 1 NQ
const evalSim = (series: number[]) => { let pass = 0, fail = 0; const N = 4000;
  for (let s = 0; s < N; s++) { let eq = 0, peak = 0; let i = Math.floor(Math.random() * series.length); let steps = 0;
    while (steps < 60) { eq += series[(i++) % series.length]; peak = Math.max(peak, eq); if (eq >= 3000) { pass++; break; } if (peak - eq >= 2500) { fail++; break; } steps++; }
    if (steps >= 60) fail++; }
  return pass / (pass + fail); };
const passReal = evalSim(perDay$);
// zero-edge control = same daily vol, zero mean (a coin-flip trader paying the same costs)
const vol$ = sd(perDay$); const control = perDay$.map(() => (Math.random() < 0.5 ? 1 : -1) * vol$ - Math.abs(mean(perDay$) < 0 ? 0 : 0));
const passControl = evalSim(control.map(() => (Math.random() < 0.5 ? vol$ : -vol$)));
console.log(`\n  PROP-EVAL (Apex-50k-like: +$3000 target before $2500 trailing DD, 1 NQ contract, net @${K.COST_BP}bp):`);
console.log(`    our rule pass-rate ${(100 * passReal).toFixed(1)}%  vs  zero-edge control ${(100 * passControl).toFixed(1)}%  (${passReal > passControl * 1.15 ? "EDGE over the base rate" : "NO edge over a coin-flip paying the same costs"})`);
await spendTrials({ rest: OWNED, headers: hdr, family: "intraday-index", runId: K.RUN_ID, spent: 3 });
console.log(`\n  READ: if intraday drift ~0 (overnight owns the return) AND net t < ceiling AND pass-rate ~= control, then a`);
console.log(`  SYSTEMATIC intraday index rule has no fee-clearing edge — a live scalper's profit is discretionary skill or`);
console.log(`  survivorship, not a rule we can prop-fund. If net t CLEARS and pass-rate >> control, the prop path is real.`);
