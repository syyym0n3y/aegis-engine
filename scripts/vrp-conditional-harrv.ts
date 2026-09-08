#!/usr/bin/env -S deno run --allow-net --allow-env
// vrp-conditional-harrv.ts (D-822) — PREREG D-822-vrp-conditional-harrv.
// The only confirmed model class here is variance forecasting (HAR-RV, D-814/819). This asks the one question that
// model can answer for an OPTIONS trader: does selling the 30-day ATM straddle ONLY when implied (DVOL) sits above the
// causal HAR forecast of the next 30 days' realised vol beat selling every month? Instrument = the D-574 MODEL of the
// placeable straddle (Black-Scholes at DVOL, 3.3% of premium round trip measured live in D-573, 9bp per hedge step,
// delta-hedged daily against the perp). A MODEL, not option data — stated on every line that reports a number.
// Threshold theta is never searched: it is the median of the spread over all windows BEFORE the test year (expanding
// walk-forward from 2023). Control: the same selection keyed on the DVOL level (z over 250 days) — if the level alone
// selects as well, the forecast adds nothing. Primary BTC; ETH replication. Trials 8.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("vrp-conditional-harrv", [
  { name: "RUN_ID", def: "D-822-vrp-conditional-harrv" },
  { name: "SPREAD_PCT", def: "0.033", note: "round-trip cost as a fraction of premium (measured, D-573)" },
  { name: "HEDGE_BP", def: "9", note: "perp round trip per hedge adjustment" },
  { name: "OOS_FROM", def: "2023-01-01", note: "first test year; theta re-fixed each year on prior windows only" },
  { name: "FIT_DAYS", def: "730" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "vch", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const SPREAD_PCT = +K.SPREAD_PCT, HEDGE_BP = +K.HEDGE_BP, FIT = +K.FIT_DAYS;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sdv = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const ncdf = (x: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const bs = (S: number, Kk: number, T: number, sig: number) => {
  if (T <= 0 || sig <= 0) return { call: Math.max(0, S - Kk), put: Math.max(0, Kk - S), dCall: S > Kk ? 1 : 0, dPut: S > Kk ? 0 : -1 };
  const d1 = (Math.log(S / Kk) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T)), d2 = d1 - sig * Math.sqrt(T);
  return { call: S * ncdf(d1) - Kk * ncdf(d2), put: Kk * ncdf(-d2) - S * ncdf(-d1), dCall: ncdf(d1), dPut: ncdf(d1) - 1 };
};
function ols4(X: number[][], y: number[]): number[] {
  const p = 4; const A = Array.from({ length: p }, () => new Array(p).fill(0)); const b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) for (let j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k]; }
  for (let i = 0; i < p; i++) { let piv = i; for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r; [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]]; const d = A[i][i] || 1e-12; for (let r = 0; r < p; r++) { if (r === i) continue; const f = A[r][i] / d; for (let c = i; c < p; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
  return b.map((v, i) => v / (A[i][i] || 1e-12));
}
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "vrp-conditional", runId: K.RUN_ID, spent: 8 });
console.log(`\n==> CONDITIONAL VRP (D-822): sell the modelled 30d straddle only when DVOL > HAR forecast. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    MODEL, NOT DATA: Black-Scholes at DVOL; ${(SPREAD_PCT * 100).toFixed(1)}% of premium per round trip + ${HEDGE_BP}bp per hedge step; per unit of SPOT notional.\n`);
interface W { d0: string; year: number; spread: number; z: number; naked: number; hedged: number; hedgedGross: number; }
const report: Record<string, unknown> = {};
for (const ccy of ["BTC", "ETH"]) {
  const dv = new Map<string, number>();
  for (const r of await q(`trd_macro_series?series=eq.deribit_${ccy.toLowerCase()}_dvol&select=d,v&order=d.asc&limit=20000`) as { d: string; v: number }[]) dv.set(r.d, +r.v);
  const bars = ((await q(`trd_bars_intraday?symbol=eq.${ccy}USDT&tf=eq.1dSF&select=bars`) as { bars: number[][] }[])[0]?.bars ?? []).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
  const day = bars.map((b) => new Date(b[0] * 1000).toISOString().slice(0, 10)); const px = bars.map((b) => b[4]);
  const r2 = px.map((c, i) => i ? Math.log(c / px[i - 1]) ** 2 : 0);
  assertNonEmpty(`${ccy} daily bars`, bars, 1500); assertNonEmpty(`${ccy} DVOL days`, [...dv.keys()], 1200);
  /* causal HAR forecast of the NEXT-30-DAY realised variance at day i: target log(mean r2 over i+1..i+30), lags log-mean r2 over 1/5/22 */
  const lagv = (i: number, k: number) => Math.log(Math.max(1e-12, mean(r2.slice(i - k + 1, i + 1))));
  const harVol = (i: number): number => {
    const A: number[][] = [], y: number[] = [];
    for (let j = Math.max(22, i - FIT); j + 30 <= i; j++) { A.push([1, lagv(j, 1), lagv(j, 5), lagv(j, 22)]); y.push(Math.log(Math.max(1e-12, mean(r2.slice(j + 1, j + 31))))); }
    if (A.length < 200) return NaN;
    const w = ols4(A, y); const yhat = w[0] + w[1] * lagv(i, 1) + w[2] * lagv(i, 5) + w[3] * lagv(i, 22);
    return Math.sqrt(Math.exp(yhat) * 365) * 100;
  };
  const dvolAt = (i: number) => dv.get(day[i]);
  /* non-overlapping 30-day windows from the first day with DVOL and >= 250 prior DVOL days for the z control */
  let i0 = day.findIndex((d) => dv.has(d)); i0 += 250;
  const wins: W[] = [];
  for (let i = i0; i + 30 < day.length; i += 30) {
    const iv = dvolAt(i); if (iv === undefined) continue;
    const har = harVol(i); if (!Number.isFinite(har)) continue;
    const hist: number[] = []; for (let j = i - 250; j < i; j++) { const v = dvolAt(j); if (v !== undefined) hist.push(v); }
    if (hist.length < 150) continue;
    const z = (iv - mean(hist)) / (sdv(hist) || 1e-9);
    const S0 = px[i], sig = iv / 100, Tt = 30 / 365, Kk = S0; const o = bs(S0, Kk, Tt, sig); const prem = o.call + o.put; const cost = prem * SPREAD_PCT;
    const ST = px[i + 30]; const naked = (prem - Math.abs(ST - Kk) - cost) / S0;
    let cash = prem - cost, hp = -(o.dCall + o.dPut); let hc = Math.abs(hp) * S0 * HEDGE_BP / 1e4 / 2;
    for (let k = 1; k <= 30; k++) { const S = px[i + k]; const ok = bs(S, Kk, Math.max(0, (30 - k) / 365), sig); const want = -(ok.dCall + ok.dPut); hc += Math.abs(want - hp) * S * HEDGE_BP / 1e4 / 2; cash += hp * (S - px[i + k - 1]); hp = want; }
    const hedged = (cash - Math.abs(ST - Kk) - hc) / S0;
    /* gross = the same path with no spread cost and no hedge cost (D-661/662: a flat cost shifts the mean, not the variance) */
    const hedgedGross = (cash + cost - Math.abs(ST - Kk)) / S0;
    wins.push({ d0: day[i], year: +day[i].slice(0, 4), spread: iv - har, z, naked, hedged, hedgedGross });
  }
  assertNonEmpty(`${ccy} windows`, wins, 40);
  const oos = wins.filter((w) => w.d0 >= K.OOS_FROM);
  /* expanding walk-forward thresholds: median of the key over windows strictly before the test year */
  const sel = (key: (w: W) => number) => oos.filter((w) => { const prior = wins.filter((p) => p.year < w.year).map(key); return prior.length >= 10 && key(w) >= median(prior); });
  const st = (v: number[]) => ({ n: v.length, mean: mean(v), sr: v.length > 1 ? mean(v) / (sdv(v) || 1e-9) * Math.sqrt(12) : NaN, t: v.length > 1 ? mean(v) / ((sdv(v) || 1e-9) / Math.sqrt(v.length)) : NaN, worst: v.length ? Math.min(...v) : NaN, win: v.length ? v.filter((x) => x > 0).length / v.length : NaN });
  const rows: [string, W[]][] = [["unconditional (benchmark)", oos], ["spread >= theta (HAR)", sel((w) => w.spread)], ["DVOL z >= theta (control)", sel((w) => w.z)]];
  console.log(`--- ${ccy}: ${wins.length} windows ${wins[0].d0} .. ${wins.at(-1)!.d0}; OOS ${oos.length} windows from ${K.OOS_FROM}; theta re-fixed yearly on prior windows`);
  console.log(`    ${"selection".padEnd(28)} ${"n".padStart(3)}  ${"hedged %/mo".padStart(11)} ${"SR".padStart(6)} ${"t".padStart(6)} ${"win".padStart(5)} ${"worst".padStart(7)} | ${"naked %/mo".padStart(10)} ${"SR".padStart(6)} ${"t".padStart(6)}`);
  const out: Record<string, unknown> = {};
  for (const [label, ws] of rows) {
    const h = st(ws.map((w) => w.hedged)), nk = st(ws.map((w) => w.naked)), g = st(ws.map((w) => w.hedgedGross));
    out[label] = { h, nk, g, frac: ws.length / Math.max(1, oos.length) };
    console.log(`    ${label.padEnd(28)} ${String(h.n).padStart(3)}  ${(h.mean * 100).toFixed(2).padStart(11)} ${h.sr.toFixed(2).padStart(6)} ${h.t.toFixed(2).padStart(6)} ${(h.win * 100).toFixed(0).padStart(4)}% ${(h.worst * 100).toFixed(1).padStart(7)} | ${(nk.mean * 100).toFixed(2).padStart(10)} ${nk.sr.toFixed(2).padStart(6)} ${nk.t.toFixed(2).padStart(6)} | hedged GROSS ${(g.mean * 100).toFixed(2)}%/mo t ${g.t.toFixed(2)}`);
  }
  const u = (out["unconditional (benchmark)"] as { h: ReturnType<typeof st> }).h, s = (out["spread >= theta (HAR)"] as { h: ReturnType<typeof st> }).h, c = (out["DVOL z >= theta (control)"] as { h: ReturnType<typeof st> }).h;
  const excess = s.mean - u.mean;
  console.log(`    EXCESS of the spread rule over the unconditional seller: ${(excess * 100).toFixed(2)}%/mo (hedged); selected ${s.n}/${oos.length} OOS windows; spread median over all windows ${median(wins.map((w) => w.spread)).toFixed(1)} vol pts`);
  /* the registered clauses, computed mechanically */
  let verdict: string;
  if (s.n < 15) verdict = `INCONCLUSIVE — only ${s.n} selected OOS windows (< 15); a decision needs ~${Math.max(15, Math.ceil((2 / Math.max(1e-9, Math.abs(s.t / Math.sqrt(Math.max(1, s.n))))) ** 2))} at this effect`;
  else if (s.sr <= u.sr || s.t <= 0) verdict = `NULL — spread-conditioned hedged SR ${s.sr.toFixed(2)} vs unconditional ${u.sr.toFixed(2)}, t ${s.t.toFixed(2)}`;
  else if (c.sr >= s.sr - 0.15) verdict = `NULL (FORECAST-ADDS-NOTHING) — DVOL-level control SR ${c.sr.toFixed(2)} within 0.15 of / above the spread rule ${s.sr.toFixed(2)}`;
  else if (s.sr >= u.sr + 0.30 && s.t >= 2.0 && s.mean > 0 && s.sr - c.sr >= 0.15) verdict = `SUPPORTED — SR ${s.sr.toFixed(2)} vs unconditional ${u.sr.toFixed(2)} (+${(s.sr - u.sr).toFixed(2)}), t ${s.t.toFixed(2)}, control ${c.sr.toFixed(2)}`;
  else verdict = `INCONCLUSIVE — between clauses: SR ${s.sr.toFixed(2)} vs ${u.sr.toFixed(2)}, t ${s.t.toFixed(2)}, control ${c.sr.toFixed(2)}`;
  console.log(`    ${ccy} VERDICT (${ccy === "BTC" ? "DECIDES" : "replication only"}): ${verdict}\n`);
  report[ccy] = { verdict, out, oos: oos.length };
}
console.log("==> SIGN prior (implied above forecast pays the seller): " + (((report.BTC as { out: Record<string, { h: { mean: number } }> }).out["spread >= theta (HAR)"].h.mean > 0) ? "MATCHED on the selected-window mean" : "MISSED on the selected-window mean"));
console.log(JSON.stringify(report));
