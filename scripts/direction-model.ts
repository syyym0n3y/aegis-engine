#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// direction-model.ts (D-881) — PREREG: D-881-multifactor-direction-model. ONE walk-forward model of next-bar DIRECTION on
// everything the venue gives per bar plus session, calendar and the leader's move — instead of a menu of set-ups.
// Ridge-logistic (L2, gradient descent), refit every 30 days on the trailing 180, applied to the next 30, no look-ahead.
// SHUFFLED-LABEL CONTROL: the same machinery on permuted labels must return ~50% or the pipeline leaks.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("direction-model", [{ name: "SYMBOLS", def: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT" }, { name: "TF", def: "1h", note: "1h or 5m" }, { name: "TRAIN_D", def: "180" }, { name: "STEP_D", def: "30" }, { name: "TAKER_BP", def: "9" }, { name: "MAKER_BP", def: "2" }, { name: "P_HI", def: "0.55" }, { name: "LAMBDA", def: "1.0" }, { name: "RUN_ID", def: "D-881-multifactor-direction-model" }, { name: "HORIZON", def: "1", note: "bars ahead the label and the trade span; >1 amortises the fixed round trip over a larger move (D-888)" }, { name: "DUMP", def: "0", note: "1 = write every OOS prediction to data/direction-signals-<TF>.json for the D-883 fill study" }]);
const DUMPED: Record<string, number[][]> = {};
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dm", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const be: { sym: string; grossBp: number; beCost: number; ceilCost: number; tAtBp: number[] }[] = [];
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok }; const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const step = K.TF === "5m" ? 300 : 3600, perDay = 86400 / step;
type Bar = number[]; // [t,o,h,l,c,v,qv,tb,n]
const FXH = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
// D-884: the non-crypto hourly panel (Dukascopy via trd_fx_hourly). No aggressor/trade-count fields exist, so those three
// features are constants (taker ratio 0.5, trades = volume) and carry no information; volume itself is real (D-861 audit).
async function fxBars(sym: string): Promise<Bar[]> { const out: Bar[] = []; let from = 0; for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; if (!p.length) break; for (const r of p) if (r.vol > 0 && r.h > r.l) out.push([r.ts, r.o, r.h, r.l, r.c, r.vol, r.vol * r.c, r.vol / 2, r.vol]); from = p.at(-1)!.ts; if (p.length < 20000) break; } return out; }
async function bars(sym: string): Promise<Bar[]> { if (FXH.includes(sym)) return fxBars(sym); const rows = K.TF === "1h" ? await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[] : await q(`trd_bars_intraday?symbol=eq.${sym}&tf=like.${K.TF}-*&select=bars&order=tf`) as { bars: number[][] }[]; const all = rows.flatMap((r) => (r.bars ?? []) as number[][]); const seen = new Set<number>(); return all.filter((b) => b[4] > 0 && b[5] > 0 && !seen.has(b[0]) && seen.add(b[0])).sort((a, b) => a[0] - b[0]); }
// release hours from the BLS calendar (UTC hour buckets)
const rel = new Set<number>(); for (const s of ["bls:consumer-price-index", "bls:employment-situation", "bls:producer-price-index"]) { const rows = await q(`trd_macro_series?series=eq.${s}&select=d,v&limit=5000`) as { d: string; v: number }[]; for (const r of rows) rel.add(Date.parse(r.d + "T00:00:00Z") / 1000 + Math.floor(r.v) * 3600); }
const lead = await bars("BTCUSDT"); const leadRet = new Map<number, number>(); for (let i = 1; i < lead.length; i++) leadRet.set(lead[i][0], Math.log(lead[i][4] / lead[i - 1][4]));
const LAGS = [1, 2, 3, 6, 12, 24];
function features(b: Bar[], i: number, isLeader: boolean): number[] | null {
  if (i < 60) return null; const r = (k: number) => Math.log(b[i - k + 1][4] / b[i - k][4]); const f: number[] = [];
  for (const L of LAGS) f.push(Math.log(b[i][4] / b[i - L][4]));
  const rets12 = Array.from({ length: 12 }, (_, k) => r(k + 1)), rets48 = Array.from({ length: 48 }, (_, k) => r(k + 1)); f.push(sd(rets12), sd(rets48));
  let hi = -Infinity, lo = Infinity; for (let k = i - 23; k <= i; k++) { hi = Math.max(hi, b[k][2]); lo = Math.min(lo, b[k][3]); } f.push(hi > lo ? (b[i][4] - lo) / (hi - lo) - 0.5 : 0);
  const tb = b[i][5] > 0 ? b[i][7] / b[i][5] - 0.5 : 0; f.push(tb); f.push(mean(Array.from({ length: 12 }, (_, k) => b[i - k][5] > 0 ? b[i - k][7] / b[i - k][5] - 0.5 : 0)));
  const nz = (arr: number[], x: number) => { const m = mean(arr), s = sd(arr); return s > 0 ? Math.max(-5, Math.min(5, (x - m) / s)) : 0; };
  f.push(nz(Array.from({ length: 48 }, (_, k) => b[i - 1 - k][8]), b[i][8])); f.push(nz(Array.from({ length: 48 }, (_, k) => b[i - 1 - k][5]), b[i][5]));
  const d = new Date(b[i][0] * 1000), hr = d.getUTCHours(), dow = d.getUTCDay(); for (let h = 0; h < 24; h += 3) f.push(hr >= h && hr < h + 3 ? 1 : 0); for (let w = 0; w < 7; w++) f.push(dow === w ? 1 : 0);
  f.push(rel.has(Math.floor(b[i][0] / 3600) * 3600) ? 1 : 0); f.push(isLeader ? 0 : (leadRet.get(b[i][0]) ?? 0));
  return f;
}
// ridge-logistic via gradient descent on standardised features
function fit(X: number[][], y: number[], lambda: number): { w: number[]; mu: number[]; sg: number[] } {
  const p = X[0].length, n = X.length; const mu = Array(p).fill(0), sg = Array(p).fill(1); for (let j = 0; j < p; j++) { const col = X.map((r) => r[j]); mu[j] = mean(col); sg[j] = sd(col) || 1; }
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sg[j])); const w = Array(p + 1).fill(0); const lr = 0.05;
  for (let it = 0; it < 300; it++) { const g = Array(p + 1).fill(0); for (let i = 0; i < n; i++) { let z = w[p]; for (let j = 0; j < p; j++) z += w[j] * Z[i][j]; const pr = 1 / (1 + Math.exp(-z)); const e = pr - y[i]; for (let j = 0; j < p; j++) g[j] += e * Z[i][j]; g[p] += e; } for (let j = 0; j < p; j++) w[j] -= lr * (g[j] / n + lambda * w[j] / n); w[p] -= lr * g[p] / n; }
  return { w, mu, sg };
}
const predict = (m: { w: number[]; mu: number[]; sg: number[] }, x: number[]) => { let z = m.w[m.w.length - 1]; for (let j = 0; j < x.length; j++) z += m.w[j] * (x[j] - m.mu[j]) / m.sg[j]; return 1 / (1 + Math.exp(-z)); };
console.log(`\n==> D-881 DIRECTION MODEL — tf ${K.TF}, walk-forward ${K.TRAIN_D}d train / ${K.STEP_D}d step, ${LAGS.length + 2 + 1 + 2 + 2 + 8 + 7 + 2} features`);
console.log(`  ${"symbol".padEnd(9)} ${"OOS bars".padStart(9)} ${"acc".padStart(6)} ${"shuffled".padStart(9)} ${"trades".padStart(7)} ${"net@taker bp".padStart(13)} ${"day-t".padStart(6)} ${"net@maker bp".padStart(13)} ${"day-t".padStart(6)}`);
let trials = 0; const summary: { sym: string; acc: number; tT: number; netT: number; netM: number }[] = [];
const ceilPre = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID }); const ceilNow = ceilPre.ceiling;
for (const sym of K.SYMBOLS.split(",")) {
  const takerBp = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"].includes(sym) ? 4 : FXH.includes(sym) ? 6 : +K.TAKER_BP;   // D-884 class costs incl. 2bp slip
  const b = await bars(sym); if (b.length < perDay * 300) { console.log(`  ${sym.padEnd(9)} only ${b.length} bars — skipped`); continue; }
  const H = +K.HORIZON; const F: (number[] | null)[] = b.map((_, i) => i + H < b.length ? features(b, i, sym === "BTCUSDT") : null); const Y = b.map((_, i) => i + H < b.length ? (b[i + H][4] > b[i][4] ? 1 : 0) : 0);
  const fwd = b.map((_, i) => i + H + 1 < b.length ? Math.log(b[i + H + 1][1] / b[i + 1][1]) : 0);   // lag-1: enter next open, exit H bars later
  let correct = 0, total = 0, shufCorrect = 0; const netT: number[] = [], netM: number[] = [], dayT = new Map<number, number>(), dayM = new Map<number, number>(); const dayG = new Map<number, number>(), dayN = new Map<number, number>();
  const T = +K.TRAIN_D * perDay, S = +K.STEP_D * perDay; let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let start = 60 + T; start + S < b.length; start += S) {
    const Xtr: number[][] = [], ytr: number[] = []; for (let i = start - T; i < start; i++) if (F[i]) { Xtr.push(F[i]!); ytr.push(Y[i]); } if (Xtr.length < 100) continue;
    const m = fit(Xtr, ytr, +K.LAMBDA); const ysh = ytr.slice().sort(() => rnd() - 0.5); const ms = fit(Xtr, ysh, +K.LAMBDA); trials++;
    for (let i = start; i < start + S && i + H + 1 < b.length; i++) { if (!F[i]) continue; const p = predict(m, F[i]!), ps = predict(ms, F[i]!); total++; if ((p > 0.5) === (Y[i] === 1)) correct++; if ((ps > 0.5) === (Y[i] === 1)) shufCorrect++;
      if (K.DUMP === "1") (DUMPED[sym] ??= []).push([b[i][0], +p.toFixed(4), b[i][4], b[i + 1][1], b[i + H + 1][1], b[i + H + 1][0]]); const dir = p > +K.P_HI ? 1 : p < 1 - +K.P_HI ? -1 : 0; if (!dir) continue; if (H > 1 && i % H !== 0) continue; /* non-overlapping trades only: consecutive bars share a forward window (D-416 pseudo-replication) */ const g = dir * fwd[i]; const d = Math.floor(b[i][0] / 86400); dayG.set(d, (dayG.get(d) ?? 0) + g); dayN.set(d, (dayN.get(d) ?? 0) + 1); netT.push(g - takerBp / 1e4); netM.push(g - +K.MAKER_BP / 1e4); dayT.set(d, (dayT.get(d) ?? 0) + g - takerBp / 1e4); dayM.set(d, (dayM.get(d) ?? 0) + g - +K.MAKER_BP / 1e4); } }
  const acc = correct / Math.max(1, total), sh = shufCorrect / Math.max(1, total); const tT = tstat([...dayT.values()]), tM = tstat([...dayM.values()]);
  // D-890: the round trip at which this signal would break even, and the round trip at which its day-clustered t would
  // reach the pre-registered ceiling. net_day(c) = gross_day - trades_day * c, so both are one bisection on c. A NEGATIVE
  // answer means no fee clears it and only a REBATE would — which is a fact about venue fee schedules, not about the market.
  const days = [...dayG.keys()];
  const tAt = (c: number) => tstat(days.map((d) => dayG.get(d)! - dayN.get(d)! * c));
  const mAt = (c: number) => mean(days.map((d) => dayG.get(d)! - dayN.get(d)! * c));
  const solve = (f: (c: number) => number, target: number) => { let lo = -0.02, hi = 0.02; if (f(lo) < target) return NaN; for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (f(mid) >= target) lo = mid; else hi = mid; } return lo * 1e4; };
  const beCost = solve(mAt, 0), ceilCost = solve(tAt, ceilNow);
  const grossBp = mean([...dayG.values()]) / Math.max(1, mean([...dayN.values()])) * 1e4;
  const tAtBp = [0, 3.4, 4, 7, 10].map((c) => tAt(c / 1e4));
  be.push({ sym, grossBp, beCost, ceilCost, tAtBp });
  summary.push({ sym, acc, tT, netT: mean(netT) * 1e4, netM: mean(netM) * 1e4 });
  console.log(`  ${sym.padEnd(9)} ${String(total).padStart(9)} ${(100 * acc).toFixed(2).padStart(5)}% ${(100 * sh).toFixed(2).padStart(8)}% ${String(netT.length).padStart(7)} ${(mean(netT) * 1e4).toFixed(2).padStart(13)} ${tT.toFixed(2).padStart(6)} ${(mean(netM) * 1e4).toFixed(2).padStart(13)} ${tM.toFixed(2).padStart(6)}`);
}
assertNonEmpty("symbols modelled", summary, 3);
await spendTrials({ rest: OWNED, headers: hdr, family: "direction-model", runId: `${K.RUN_ID}-${K.TF}`, spent: trials * 2 }); const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const accM = mean(summary.map((s) => s.acc)), posT = summary.filter((s) => s.netT > 0).length, tMax = Math.max(...summary.map((s) => s.tT));
console.log(`\n  mean OOS accuracy ${(100 * accM).toFixed(2)}% (shuffled control ~50% above); ${posT}/${summary.length} perps net positive at taker; best day-t at taker ${tMax.toFixed(2)}; ceiling ${ceil.ceiling.toFixed(2)}; ${trials} refits counted`);
console.log(`  VERDICT (${K.TF}): ${accM > 0.52 && tMax >= ceil.ceiling && posT >= 4 ? "SUPPORTED" : `NULL — ${[accM <= 0.52 && `accuracy ${(100 * accM).toFixed(2)}% <= 52%`, tMax < ceil.ceiling && "no perp's taker day-t clears the ceiling", posT < 4 && `${posT}/5 positive at taker`].filter(Boolean).join("; ")}`}`);
console.log(`  MAKER figures are reported, not claimable: a maker fill is a hypothesis about fills (EXECUTION LAW, D-447) and the fill-conditional return is unmeasured here.`);
if (K.DUMP === "1") { await Deno.writeTextFile(`data/direction-signals-${K.TF}-H${K.HORIZON}.json`, JSON.stringify({ tf: K.TF, columns: ["ts", "p", "signalClose", "nextOpen", "exitOpen", "exitTs"], written: new Date().toISOString(), signals: DUMPED })); console.log(`  dumped ${Object.values(DUMPED).reduce((a, v) => a + v.length, 0)} OOS predictions to data/direction-signals-${K.TF}-H${K.HORIZON}.json`); }
console.log(`\n  BREAKEVEN ROUND TRIP (D-890) — the cost at which this signal pays, from its own gross. Ceiling ${ceilNow.toFixed(2)}.`);
console.log(`  ${"symbol".padEnd(9)} ${"gross bp/trade".padStart(15)} ${"breakeven rt".padStart(13)} ${"rt for t>=ceil".padStart(15)} | day-t at a REAL round trip: ${"0bp".padStart(7)} ${"3.4bp".padStart(7)} ${"4bp".padStart(7)} ${"7bp".padStart(7)} ${"10bp".padStart(7)}`);
for (const r of be) console.log(`  ${r.sym.padEnd(9)} ${r.grossBp.toFixed(3).padStart(15)} ${(isNaN(r.beCost) ? "none" : r.beCost.toFixed(3)).padStart(13)} ${(isNaN(r.ceilCost) ? "none".padStart(15) : r.ceilCost.toFixed(3).padStart(15))} | ${r.tAtBp.map((t) => t.toFixed(2).padStart(7)).join(" ")}`);
console.log(`  Read it against real schedules: Binance USDT-M VIP0 taker 5bp / maker 2bp (round trips 10 / 4), VIP9 taker 1.7 / maker 0 (3.4 / 0), and the deepest maker REBATE tiers are negative-fee for the maker leg only.`);
