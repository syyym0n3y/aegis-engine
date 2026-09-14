// D-889 — the cross-sectional form of the direction question, at breadth.
// Every direction result on this record (D-881, D-884, D-888) is per-instrument: it predicts one asset's own sign, so it
// carries that asset's drift and pays a full round trip for a 1-2bp edge. The cross-sectional form asks a different
// question — which names beat the others — and its information ratio scales as IC x sqrt(breadth). The survivor-free
// hourly panel holds 97 deep names against the 5 used so far, so sqrt(breadth) is about 10x larger here.
// Construction: features are cross-sectionally z-scored each hour (the model can only see relative information), the
// label is whether the name beats the cross-sectional MEDIAN over the next H hours, so the excess THE BENCHMARK LAW asks
// for is the thing being predicted rather than something subtracted afterwards. One POOLED ridge-logistic, walk-forward.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("cross-sectional-direction", [
  { name: "PANEL", def: "1hSF" }, { name: "H", def: "4", note: "hold and rebalance in hours" },
  { name: "TRAIN_D", def: "180" }, { name: "STEP_D", def: "30" }, { name: "LAMBDA", def: "1.0" },
  { name: "SPLIT", def: "decile", note: "decile | quintile | top20 — the universe variants THE UNIVERSE LAW requires" },
  { name: "COST_BP", def: "9", note: "taker round trip per name per rebalance" },
  { name: "MIN_NAMES", def: "50", note: "THE BREADTH LAW floor; hours below it are dropped, not pooled" },
  { name: "RUN_ID", def: "D-889-cross-sectional-direction" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function mkJwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "xs", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await mkJwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 ? mean(a) / (sd(a) / Math.sqrt(a.length) || 1e-12) : 0;
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
const H = +K.H, NF = 11;

const syms = (await q(`trd_bars_intraday?tf=eq.${K.PANEL}&select=symbol,n_bars&order=symbol`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars > 5000).map((r) => r.symbol);
assertNonEmpty(`${K.PANEL} deep symbols`, syms, +K.MIN_NAMES);
console.log(`==> D-889 CROSS-SECTIONAL DIRECTION — panel ${K.PANEL}, ${syms.length} deep names, H=${H}h, split ${K.SPLIT}, cost ${K.COST_BP}bp/name/rebalance`);

// per symbol: map from hour-index -> [features, forward return]. Features are RAW here and z-scored cross-sectionally below.
const close = new Map<string, Map<number, number>>(), open = new Map<string, Map<number, number>>(), feat = new Map<string, Map<number, number[]>>();
let loaded = 0;
for (const s of syms) {
  const row = (await q(`trd_bars_intraday?symbol=eq.${s}&tf=eq.${K.PANEL}&select=bars`) as { bars: number[][] }[])[0];
  const bars = ((row?.bars ?? []) as number[][]).filter((b) => b[4] > 0 && b[2] > b[3]).sort((a, b) => a[0] - b[0]);
  if (bars.length < 3000) continue;
  const c = new Map<number, number>(), o = new Map<number, number>(), f = new Map<number, number[]>();
  const lr: number[] = bars.map((b, i) => i ? Math.log(b[4] / bars[i - 1][4]) : 0);
  for (let i = 48; i < bars.length; i++) {
    const t = Math.floor(bars[i][0] / 3600);
    const r = (n: number) => Math.log(bars[i][4] / bars[i - n][4]);
    const v = (n: number) => sd(lr.slice(i - n + 1, i + 1));
    const rng = bars[i][2] > bars[i][3] ? (bars[i][4] - bars[i][3]) / (bars[i][2] - bars[i][3]) : 0.5;
    const vol = bars.slice(i - 24, i).map((b) => b[5]); const vz = sd(vol) > 0 ? (bars[i][5] - mean(vol)) / sd(vol) : 0;
    f.set(t, [r(1), r(2), r(3), r(6), r(12), r(24), v(12), v(48), rng, vz, bars[i][5] > 0 && bars[i][6] ? bars[i][7] / bars[i][5] - 0.5 : 0]);
    c.set(t, bars[i][4]); o.set(t, bars[i][1]);
  }
  close.set(s, c); open.set(s, o); feat.set(s, f); loaded++;
}
console.log(`  loaded ${loaded} of ${syms.length} names`);

// the common hourly grid, restricted to hours meeting the breadth floor
const hourCount = new Map<number, number>(); for (const f of feat.values()) for (const t of f.keys()) hourCount.set(t, (hourCount.get(t) ?? 0) + 1);
const hours = [...hourCount.entries()].filter(([, n]) => n >= +K.MIN_NAMES).map(([t]) => t).sort((a, b) => a - b);
assertNonEmpty(`hours with >= ${K.MIN_NAMES} names`, hours, 5000);
const breadth = hours.map((t) => hourCount.get(t)!);
console.log(`  ${hours.length} hours clear the ${K.MIN_NAMES}-name breadth floor; breadth mean ${mean(breadth).toFixed(1)} median ${median(breadth)}; span ${new Date(hours[0] * 3.6e6).toISOString().slice(0, 10)}..${new Date(hours.at(-1)! * 3.6e6).toISOString().slice(0, 10)}`);

// cross-sectional z-scores + the median-relative label, built once per hour
type Row = { sym: string; x: number[]; y: number; fwd: number };
const byHour = new Map<number, Row[]>();
for (const t of hours) {
  const names: string[] = [], X: number[][] = [], fw: number[] = [];
  for (const [s, f] of feat) {
    const x = f.get(t); const o1 = open.get(s)!.get(t + 1), o2 = open.get(s)!.get(t + 1 + H);
    if (!x || o1 === undefined || o2 === undefined) continue;
    names.push(s); X.push(x); fw.push(Math.log(o2 / o1));
  }
  if (names.length < +K.MIN_NAMES) continue;
  const z: number[][] = X.map(() => new Array(NF).fill(0));
  for (let j = 0; j < NF; j++) { const col = X.map((r) => r[j]); const m = mean(col), s2 = sd(col) || 1e-12; for (let i = 0; i < X.length; i++) z[i][j] = Math.max(-5, Math.min(5, (X[i][j] - m) / s2)); }
  const med = median(fw);
  byHour.set(t, names.map((s, i) => ({ sym: s, x: z[i], y: fw[i] > med ? 1 : 0, fwd: fw[i] })));
}
const tradeHours = [...byHour.keys()].sort((a, b) => a - b);
assertNonEmpty("labelled hours", tradeHours, 5000);

function fit(X: number[][], y: number[], lam: number): number[] {
  const n = NF + 1; const w = new Array(n).fill(0);
  for (let it = 0; it < 25; it++) {
    const g = new Array(n).fill(0); const hss = new Array(n).fill(0);
    for (let i = 0; i < X.length; i++) { let z = w[n - 1]; for (let j = 0; j < NF; j++) z += w[j] * X[i][j]; const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const e = p - y[i], v = Math.max(1e-6, p * (1 - p));
      for (let j = 0; j < NF; j++) { g[j] += e * X[i][j]; hss[j] += v * X[i][j] * X[i][j]; } g[n - 1] += e; hss[n - 1] += v; }
    let mx = 0; for (let j = 0; j < n; j++) { const step = (g[j] + (j < NF ? lam * w[j] : 0)) / (hss[j] + lam + 1e-9); w[j] -= step; mx = Math.max(mx, Math.abs(step)); }
    if (mx < 1e-7) break;
  }
  return w;
}
const predict = (w: number[], x: number[]) => { let z = w[NF]; for (let j = 0; j < NF; j++) z += w[j] * x[j]; return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); };

const TRAIN = +K.TRAIN_D * 24, STEP = +K.STEP_D * 24;
const grossDay = new Map<number, number>(), netDay = new Map<number, number>();
const gross: number[] = [], net: number[] = [], longLeg: number[] = [], shortLeg: number[] = [], uniMean: number[] = [], turn: number[] = [];
let refits = 0, rebals = 0; const yrG = new Map<number, number[]>();
let prevLong = new Set<string>(), prevShort = new Set<string>();
for (let si = TRAIN; si + STEP < tradeHours.length; si += STEP) {
  const trHours = tradeHours.slice(si - TRAIN, si);
  const Xtr: number[][] = [], ytr: number[] = [];
  for (const t of trHours) { const rows = byHour.get(t)!; for (const r of rows) { Xtr.push(r.x); ytr.push(r.y); } }
  if (Xtr.length < 5000) continue;
  const step = Math.max(1, Math.floor(Xtr.length / 120000));   // cap the training matrix; the sample is stratified by taking every k-th row in time order
  const Xs = step > 1 ? Xtr.filter((_, i) => i % step === 0) : Xtr, ys = step > 1 ? ytr.filter((_, i) => i % step === 0) : ytr;
  const w = fit(Xs, ys, +K.LAMBDA); refits++;
  for (let k = si; k < si + STEP && k < tradeHours.length; k++) {
    const t = tradeHours[k]; if ((t % H) !== 0) continue;   // rebalance every H hours on a fixed clock, so trades do not overlap
    const rows = byHour.get(t)!; const ps = rows.map((r) => ({ ...r, p: predict(w, r.x) })).sort((a, b) => b.p - a.p);
    const n = ps.length; const take = K.SPLIT === "top20" ? 20 : K.SPLIT === "quintile" ? Math.floor(n / 5) : Math.floor(n / 10);
    if (take < 5) continue;
    const L = ps.slice(0, take), S = ps.slice(n - take);
    const gL = mean(L.map((r) => r.fwd)), gS = mean(S.map((r) => r.fwd)), g = gL - gS;
    const Ls = new Set(L.map((r) => r.sym)), Ss = new Set(S.map((r) => r.sym));
    const changed = [...Ls].filter((s) => !prevLong.has(s)).length + [...Ss].filter((s) => !prevShort.has(s)).length;
    const to = changed / (2 * take); turn.push(to);
    const cost = 2 * to * (+K.COST_BP / 1e4);   // both legs, entry and exit, on the fraction actually replaced
    prevLong = Ls; prevShort = Ss;
    const d = Math.floor(t / 24), y = new Date(t * 3.6e6).getUTCFullYear();
    gross.push(g * 1e4); net.push((g - cost) * 1e4); longLeg.push(gL * 1e4); shortLeg.push(gS * 1e4); uniMean.push(mean(rows.map((r) => r.fwd)) * 1e4);
    grossDay.set(d, (grossDay.get(d) ?? 0) + g * 1e4); netDay.set(d, (netDay.get(d) ?? 0) + (g - cost) * 1e4);
    (yrG.get(y) ?? yrG.set(y, []).get(y)!).push((g - cost) * 1e4); rebals++;
  }
}
await spendTrials({ rest: OWNED, headers: hdr, family: "cross-sectional-direction", runId: `${K.RUN_ID}-H${H}-${K.SPLIT}`, spent: 1 });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const perYr = 8760 / H, toM = mean(turn);
const yrsPos = [...yrG.entries()].filter(([, v]) => mean(v) > 0).length;
console.log(`\n  refits ${refits}; rebalances ${rebals}; breadth mean ${mean(breadth).toFixed(1)}`);
console.log(`  GROSS (before cost) ${mean(gross).toFixed(2)}bp per rebalance, day-clustered t ${tstat([...grossDay.values()]).toFixed(2)}`);
console.log(`  NET at ${K.COST_BP}bp      ${mean(net).toFixed(2)}bp per rebalance, day-clustered t ${tstat([...netDay.values()]).toFixed(2)}`);
console.log(`  TURNOVER ${(100 * toM).toFixed(1)}% of the book per rebalance, ${perYr.toFixed(0)} rebalances/yr -> drag ${(2 * toM * perYr * +K.COST_BP / 100).toFixed(1)}%/yr; gross annualised ${(mean(gross) * perYr / 100).toFixed(1)}%/yr`);
console.log(`  LEGS long ${mean(longLeg).toFixed(2)}bp / short ${mean(shortLeg).toFixed(2)}bp vs UNIVERSE MEAN ${mean(uniMean).toFixed(2)}bp — long excess ${(mean(longLeg) - mean(uniMean)).toFixed(2)}bp, short excess ${(mean(uniMean) - mean(shortLeg)).toFixed(2)}bp`);
console.log(`  years net positive ${yrsPos}/${yrG.size}; ceiling ${ceil.ceiling.toFixed(2)}`);
console.log(`  VERDICT H=${H} ${K.SPLIT}: ${mean(net) > 0 && tstat([...netDay.values()]) >= ceil.ceiling ? "clears net" : mean(gross) > 0 && tstat([...grossDay.values()]) >= ceil.ceiling ? "COST-BOUND — gross clears, turnover eats it" : "NULL"}`);
