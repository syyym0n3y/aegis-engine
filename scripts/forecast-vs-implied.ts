#!/usr/bin/env -S deno run --allow-net --allow-env
// forecast-vs-implied.ts (D-830) — PREREG D-830-forecast-vs-implied-equity.
// WHERE RANGE IS PRICED DIRECTLY. D-828 found range predictable and direction not; D-814 confirmed HAR-RV on 11/11.
// Two attempts to convert that into a return failed. The instrument where range is priced directly is the option
// surface and its price is implied volatility, so the question is whether our forecast carries information the
// market's PRICE of range does not. 9,240 VIX closes since 1990 against the S&P since 1970 - the deepest series here.
// Controls that decide it: the benchmark is the VARIANCE RISK PREMIUM itself (implied exceeds realised on average, so
// zero is the wrong bar), t-statistics are computed on NON-OVERLAPPING windows (the D-416 overlap trap), VIX's own
// z-score is carried as a competing predictor, and every number is RESEARCH-SPACE - VIX is an index, not a security.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("forecast-vs-implied", [
  { name: "RUN_ID", def: "D-830-forecast-vs-implied-equity" },
  { name: "H", def: "21", note: "forward horizon in trading days (~30 calendar, VIX's own tenor)" },
  { name: "FIT", def: "750", note: "trailing days for the causal HAR fit" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fvi", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) || 1e-9) / Math.sqrt(a.length)) : NaN;
function ols(x: number[], y: number[]) { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12), a = my - b * mx; const res = y.map((v, i) => v - (a + b * x[i])); const se = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, x.length - 2) / (sxx || 1e-12)); return { a, b, t: b / (se || 1e-12), n: x.length }; }
const bars = (await q(`trd_bars_deep?symbol=eq.%5EGSPC&select=bars`) as { bars: number[][] }[])[0]?.bars ?? [];
const vixB = (await q(`trd_bars_deep?symbol=eq.%5EVIX&select=bars`) as { bars: number[][] }[])[0]?.bars ?? [];
assertNonEmpty("^GSPC bars", bars, 10000); assertNonEmpty("^VIX bars", vixB, 8000);
const vix = new Map<string, number>();
for (const b of vixB) if (b[4] > 0) vix.set(new Date(b[0] * 1000).toISOString().slice(0, 10), b[4]);
const px = bars.filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
const day = px.map((b) => new Date(b[0] * 1000).toISOString().slice(0, 10));
const r = px.map((b, i) => i ? Math.log(b[4] / px[i - 1][4]) : 0);
const H = +K.H, FIT = +K.FIT;
const rvAnn = (from: number, to: number) => { let s = 0, n = 0; for (let i = from; i < to && i < r.length; i++) { s += r[i] * r[i]; n++; } return n ? Math.sqrt(252 * s / n) * 100 : NaN; };
const lg = (i: number, k: number) => Math.log(Math.max(1e-10, 252 * mean(r.slice(Math.max(1, i - k + 1), i + 1).map((x) => x * x))));
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "forecast-vs-implied", runId: K.RUN_ID, spent: 12 });
console.log(`\n==> D-830 OUR FORECAST vs THE MARKET'S PRICE OF RANGE — ^GSPC realised vs ^VIX, ${H}-trading-day horizon. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()} (mined).`);
interface Row { d: string; vix: number; har: number; rvFwd: number; z: number; }
const rows: Row[] = [];
let w: number[] = [0, 0, 0, 0];
for (let i = Math.max(FIT, 300); i + H < r.length; i++) {
  const v = vix.get(day[i]); if (v === undefined || !(v > 0)) continue;
  /* causal HAR refit every 21 days on pairs whose TARGET was fully observed before i */
  if ((i % 21) === 0) {
    const A: number[][] = [], Y: number[] = [];
    for (let j = Math.max(22, i - FIT); j + H <= i; j++) { A.push([1, lg(j, 1), lg(j, 5), lg(j, 22)]); Y.push(Math.log(Math.max(1e-10, 252 * mean(r.slice(j + 1, j + 1 + H).map((x) => x * x))))); }
    if (A.length > 200) {
      const p = 4; const M = Array.from({ length: p }, () => new Array(p).fill(0)); const bv = new Array(p).fill(0);
      for (let q2 = 0; q2 < A.length; q2++) for (let a = 0; a < p; a++) { bv[a] += A[q2][a] * Y[q2]; for (let c = 0; c < p; c++) M[a][c] += A[q2][a] * A[q2][c]; }
      for (let a = 0; a < p; a++) { let piv = a; for (let rr = a + 1; rr < p; rr++) if (Math.abs(M[rr][a]) > Math.abs(M[piv][a])) piv = rr; [M[a], M[piv]] = [M[piv], M[a]]; [bv[a], bv[piv]] = [bv[piv], bv[a]]; const dg = M[a][a] || 1e-12; for (let rr = 0; rr < p; rr++) { if (rr === a) continue; const f = M[rr][a] / dg; for (let c = a; c < p; c++) M[rr][c] -= f * M[a][c]; bv[rr] -= f * bv[a]; } }
      w = bv.map((v2, a) => v2 / (M[a][a] || 1e-12));
    }
  }
  if (!w[1] && !w[2] && !w[3]) continue;
  const har = Math.sqrt(Math.exp(w[0] + w[1] * lg(i, 1) + w[2] * lg(i, 5) + w[3] * lg(i, 22))) * 100;
  if (!Number.isFinite(har) || har <= 0 || har > 300) continue;
  const hist: number[] = []; for (let j = Math.max(0, i - 250); j <= i; j++) { const vv = vix.get(day[j]); if (vv) hist.push(vv); }
  if (hist.length < 150) continue;
  rows.push({ d: day[i], vix: v, har, rvFwd: rvAnn(i + 1, i + 1 + H), z: (v - mean(hist)) / (sd(hist) || 1e-9) });
}
assertNonEmpty("aligned observations", rows, 3000);
const nonOv = rows.filter((_, i) => i % H === 0);
console.log(`    ${rows.length.toLocaleString()} daily observations ${rows[0].d}..${rows[rows.length - 1].d}; ${nonOv.length} NON-OVERLAPPING ${H}-day windows (the deciding sample).`);
const err = (a: Row[]) => a.map((x) => x.rvFwd - x.vix);
const uAll = mean(err(nonOv));
console.log(`\n  THE BENCHMARK IS NOT ZERO. Unconditional (realised - implied) on non-overlapping windows: ${uAll.toFixed(2)} vol points — the variance risk premium. A long-vol position loses this by construction; the claim must beat it.`);
console.log(`  Forecast accuracy: mean |HAR - RV_fwd| ${mean(nonOv.map((x) => Math.abs(x.har - x.rvFwd))).toFixed(2)} vs mean |VIX - RV_fwd| ${mean(nonOv.map((x) => Math.abs(x.vix - x.rvFwd))).toFixed(2)} vol points — ${mean(nonOv.map((x) => Math.abs(x.har - x.rvFwd))) < mean(nonOv.map((x) => Math.abs(x.vix - x.rvFwd))) ? "HAR is closer" : "VIX is closer"}.`);
const spread = nonOv.map((x) => x.har - x.vix), e = err(nonOv);
const reg = ols(spread, e), regZ = ols(nonOv.map((x) => x.z), e);
console.log(`\n  REGRESSION on ${nonOv.length} non-overlapping windows:`);
console.log(`    (RV_fwd - VIX) on (HAR - VIX):  slope ${reg.b.toFixed(3)}  t ${reg.t.toFixed(2)}`);
console.log(`    (RV_fwd - VIX) on VIX z(250):   slope ${regZ.b.toFixed(3)}  t ${regZ.t.toFixed(2)}   <- the competing predictor (VIX mean reversion)`);
const ovReg = ols(rows.map((x) => x.har - x.vix), err(rows));
console.log(`    same regression on OVERLAPPING daily data: t ${ovReg.t.toFixed(2)} — shown only to name it as the inflated number (D-416).`);
const srt = [...nonOv].sort((a, b) => (a.har - a.vix) - (b.har - b.vix));
const qn = Math.floor(srt.length / 5);
const botQ = srt.slice(0, qn), topQ = srt.slice(-qn);
const qSpread = mean(err(topQ)) - mean(err(botQ));
console.log(`\n  QUINTILES of (HAR - VIX), mean (RV_fwd - VIX) in vol points:`);
for (let i2 = 0; i2 < 5; i2++) { const sl = srt.slice(i2 * qn, (i2 + 1) * qn); console.log(`    Q${i2 + 1} spread ${mean(sl.map((x) => x.har - x.vix)).toFixed(2).padStart(7)} -> realised-implied ${mean(err(sl)).toFixed(2).padStart(7)}  (n ${sl.length}, ${(100 * err(sl).filter((v) => v > 0).length / sl.length).toFixed(0)}% positive)`);}
console.log(`    TOP - BOTTOM = ${qSpread.toFixed(2)} vol points (rule needs >= 2.0)`);
console.log(`\n  BY DECADE (sign must hold in >= 3 of 4):`);
const decades: [string, number, number][] = [["1990s", 1990, 2000], ["2000s", 2000, 2010], ["2010s", 2010, 2020], ["2020s", 2020, 2030]];
let signOk = 0;
for (const [nm, a, b2] of decades) {
  const sl = nonOv.filter((x) => { const y = +x.d.slice(0, 4); return y >= a && y < b2; });
  if (sl.length < 20) { console.log(`    ${nm}: n ${sl.length} (thin)`); continue; }
  const rg = ols(sl.map((x) => x.har - x.vix), err(sl));
  if (rg.b > 0) signOk++;
  console.log(`    ${nm}: n ${sl.length}  slope ${rg.b.toFixed(3)}  t ${rg.t.toFixed(2)}  uncond (RV-VIX) ${mean(err(sl)).toFixed(2)}`);
}
console.log(`\n  SIDES (not symmetric instruments — long vol has bounded loss, short vol is the D-404 blow-up):`);
for (const [nm, sel] of [["HAR > VIX (long-vol side)", nonOv.filter((x) => x.har > x.vix)], ["HAR < VIX (short-vol side)", nonOv.filter((x) => x.har < x.vix)]] as [string, Row[]][]) {
  if (sel.length < 20) { console.log(`    ${nm}: n ${sel.length} (thin)`); continue; }
  const ee = err(sel);
  console.log(`    ${nm.padEnd(28)} n ${String(sel.length).padStart(4)}  mean (RV-VIX) ${mean(ee).toFixed(2).padStart(7)}  vs unconditional ${uAll.toFixed(2)}  excess ${(mean(ee) - uAll).toFixed(2).padStart(6)}  t(excess) ${tstat(ee.map((v) => v - uAll)).toFixed(2).padStart(6)}  ${(100 * ee.filter((v) => v > 0).length / ee.length).toFixed(0)}% positive`);
}
let v: string;
if (nonOv.length < 150) v = `UNDERPOWERED — ${nonOv.length} non-overlapping windows < 150`;
else if (reg.b <= 0) v = `NULL — slope ${reg.b.toFixed(3)} <= 0`;
else if (reg.t < 2.5) v = `NULL — non-overlapping t ${reg.t.toFixed(2)} < 2.5`;
else if (qSpread < 2.0) v = `NULL — quintile spread ${qSpread.toFixed(2)} < 2.0 vol points`;
else if (signOk < 3) v = `NULL — slope sign holds in only ${signOk} of 4 decades`;
else if (Math.abs(regZ.t) >= Math.abs(reg.t)) v = `NULL (FORECAST-ADDS-NOTHING) — VIX's own z-score predicts at t ${regZ.t.toFixed(2)} against the HAR spread's ${reg.t.toFixed(2)}: the signal is VIX mean reversion, not our forecast`;
else v = `SUPPORTED (RESEARCH SPACE ONLY) — slope ${reg.b.toFixed(3)} t ${reg.t.toFixed(2)}, quintile spread ${qSpread.toFixed(2)} vol pts, sign in ${signOk}/4 decades, beats the VIX-z control (t ${regZ.t.toFixed(2)})`;
console.log(`\n  VERDICT: ${v}`);
console.log(`  INSTRUMENT LAW: VIX is an index, not a security. Nothing above is a tradable return; the conversion to VIX futures, SPX options or a UK spread bet is UNMEASURED and must not be assumed (four consecutive failures of exactly that assumption, D-575).`);
