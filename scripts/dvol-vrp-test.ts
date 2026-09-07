#!/usr/bin/env -S deno run --allow-net --allow-env
// dvol-vrp-test.ts (D-817) — PREREG D-817-dvol-vrp. Deribit DVOL (BTC/ETH daily) vs realised vol from the 1dSF daily panel:
// (i) implied variance (DVOL^2) minus subsequent 30-day realised variance — the premium as a MEASUREMENT, NW(30) t and
// fraction of positive months; (ii) DVOL forecasts next-30d realised vol vs HAR-22d, OOS R^2 gain, yearly walk-forward;
// (iii) DVOL z(250) -> next-day return vs the 7bp fee. Trials 6.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("dvol-vrp-test", [{ name: "FEE_BP", def: "7" }, { name: "RUN_ID", def: "D-817-dvol-vrp" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "vrp", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const FEE = +K.FEE_BP;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const nwMeanT = (a: number[], L: number) => { const m = mean(a), n = a.length; let S = 0; for (let l = 0; l <= L; l++) { let g = 0; for (let i = l; i < n; i++) g += (a[i] - m) * (a[i - l] - m); g /= n; S += (l === 0 ? 1 : 2 * (1 - l / (L + 1))) * g; } return m / (Math.sqrt(S / n) || 1e-12); };
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "dvol-vrp", runId: K.RUN_ID, spent: 6 });
console.log(`\n==> DERIBIT DVOL: variance premium, vol forecast, return effect. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
const out: Record<string, unknown> = {};
for (const ccy of ["BTC", "ETH"]) {
  const dv = new Map<string, number>(); for (const r of await q(`trd_macro_series?series=eq.deribit_${ccy.toLowerCase()}_dvol&select=d,v&order=d.asc&limit=20000`) as { d: string; v: number }[]) dv.set(r.d, r.v);
  const bars = ((await q(`trd_bars_intraday?symbol=eq.${ccy}USDT&tf=eq.1dSF&select=bars`) as { bars: number[][] }[])[0]?.bars ?? []).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
  const day = bars.map((b) => new Date(b[0] * 1000).toISOString().slice(0, 10)); const lr = bars.map((b, i) => i ? Math.log(b[4] / bars[i - 1][4]) : 0);
  const idx = new Map(day.map((d, i) => [d, i])); const dates = [...dv.keys()].filter((d) => idx.has(d)).sort(); assertNonEmpty(`${ccy} overlap days`, dates, 1200);
  const rv30 = (i: number) => { let s = 0, n = 0; for (let k = 1; k <= 30; k++) { if (i + k >= lr.length) return NaN; s += lr[i + k] ** 2; n++; } return Math.sqrt(s / n * 365) * 100; };
  const rvPast = (i: number, L: number) => { let s = 0, n = 0; for (let k = 0; k < L; k++) { if (i - k < 1) break; s += lr[i - k] ** 2; n++; } return n ? Math.sqrt(s / n * 365) * 100 : NaN; };
  // (i) premium: DVOL^2 - realised^2 (variance points), monthly averaging for the positive-month fraction
  const prem: number[] = [], months = new Map<string, number[]>();
  const rows = dates.map((d) => { const i = idx.get(d)!; return { d, i, iv: dv.get(d)!, rv: rv30(i), h1: rvPast(i, 1), h5: rvPast(i, 5), h22: rvPast(i, 22) }; }).filter((r) => Number.isFinite(r.rv) && Number.isFinite(r.h22));
  for (const r of rows) { const p = r.iv ** 2 - r.rv ** 2; prem.push(p); (months.get(r.d.slice(0, 7)) ?? months.set(r.d.slice(0, 7), []).get(r.d.slice(0, 7))!).push(p); }
  const mPos = [...months.values()].filter((v) => mean(v) > 0).length / months.size; const tP = nwMeanT(prem, 30);
  console.log(`  ${ccy} (i) premium DVOL^2 - RV30^2: mean ${mean(prem).toFixed(0)} var-pts (in vol terms DVOL ${mean(rows.map((r) => r.iv)).toFixed(1)} vs RV30 ${mean(rows.map((r) => r.rv)).toFixed(1)}), NW(30) t ${tP.toFixed(2)}, positive months ${(mPos * 100).toFixed(0)}% of ${months.size}, n ${prem.length}`);
  // (ii) forecast: log RV30 on log HAR (h1,h5,h22) vs + log DVOL, yearly walk-forward
  const yrs = [2023, 2024, 2025, 2026]; let gsum = 0, gn = 0, clears = 0; const gains: Record<string, number> = {};
  for (const Y of yrs) { const tr = rows.filter((r) => r.d < `${Y}-01-01` && [r.h1, r.h5].every((x) => x > 0)), te = rows.filter((r) => r.d.startsWith(String(Y)) && [r.h1, r.h5].every((x) => x > 0)); if (tr.length < 300 || te.length < 60) continue;
    const X0 = (r: typeof rows[0]) => [1, Math.log(r.h1), Math.log(r.h5), Math.log(r.h22)], X1 = (r: typeof rows[0]) => [...X0(r), Math.log(r.iv)];
    const fit = (X: (r: typeof rows[0]) => number[]) => { const A = tr.map(X), y = tr.map((r) => Math.log(r.rv)); const k = A[0].length; const M = Array.from({ length: k }, () => new Array(k + 1).fill(0)); for (let i = 0; i < A.length; i++) for (let a = 0; a < k; a++) { M[a][k] += A[i][a] * y[i]; for (let c = 0; c < k; c++) M[a][c] += A[i][a] * A[i][c]; } for (let a = 0; a < k; a++) M[a][a] += 1e-6; for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < k; r++) { if (r === c) continue; const f = M[r][c] / (M[c][c] || 1e-12); for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j]; } } const w = M.map((r, i) => r[k] / (r[i] || 1e-12)); return (r: typeof rows[0]) => X(r).reduce((s, v, j) => s + v * w[j], 0); };
    const f0 = fit(X0), f1 = fit(X1); const y = te.map((r) => Math.log(r.rv)); const my = mean(y); const ss = y.reduce((s, v) => s + (v - my) ** 2, 0); const r0 = 1 - te.reduce((s, r, i) => s + (y[i] - f0(r)) ** 2, 0) / ss, r1 = 1 - te.reduce((s, r, i) => s + (y[i] - f1(r)) ** 2, 0) / ss; gains[Y] = r1 - r0; gsum += r1 - r0; gn++; if (r1 - r0 >= 0.05) clears++; console.log(`  ${ccy} (ii) ${Y}: OOS R^2 HAR ${r0.toFixed(3)} -> +DVOL ${r1.toFixed(3)} (gain ${(r1 - r0 >= 0 ? "+" : "")}${(r1 - r0).toFixed(3)})`); }
  // (iii) DVOL z -> next-day return
  const ivs = dates.map((d) => dv.get(d)!); const z = ivs.map((_, i) => { if (i < 250) return NaN; const w = ivs.slice(i - 250, i); const s = sd(w); return s > 0 ? (ivs[i] - mean(w)) / s : NaN; });
  const X: number[] = [], Yv: number[] = []; for (let i = 0; i < dates.length; i++) { const j = idx.get(dates[i])!; if (!Number.isFinite(z[i]) || j + 1 >= lr.length) continue; X.push(z[i]); Yv.push(lr[j + 1] * 1e4); }
  const mx = mean(X), my = mean(Yv); let sxy = 0, sxx = 0; for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Yv[i] - my); sxx += (X[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12); let sse = 0; for (let i = 0; i < X.length; i++) sse += (Yv[i] - my - b * (X[i] - mx)) ** 2; const tb = b / (Math.sqrt(sse / Math.max(1, X.length - 2) / (sxx || 1e-12)) || 1e-12);
  console.log(`  ${ccy} (iii) DVOL z -> next-day return: ${b.toFixed(2)}bp per 1 sd (${(b / FEE).toFixed(2)}x fee), t ${tb.toFixed(2)}, n ${X.length}`);
  out[ccy] = { premium: { mean: mean(prem), t: tP, posMonths: mPos, n: prem.length }, forecast: { gains, meanGain: gn ? gsum / gn : NaN, clears, years: gn }, ret: { bpPerSd: b, t: tb, n: X.length } };
}
const B = out["BTC"] as { premium: { t: number; posMonths: number }; forecast: { clears: number; years: number }; ret: { bpPerSd: number; t: number } }, E = out["ETH"] as typeof B;
const premOK = [B, E].every((x) => x.premium.t >= 2.5 && x.premium.posMonths >= 0.55), fcOK = [B, E].every((x) => x.forecast.years > 0 && x.forecast.clears === x.forecast.years), retOK = [B, E].every((x) => x.ret.bpPerSd >= FEE && x.ret.t >= 2.5);
console.log(`\n  VERDICT (i) premium: ${premOK ? "CONFIRMED (measurement, no capture claim)" : "NULL"} | (ii) DVOL as vol forecast: ${fcOK ? "CONFIRMED as sizing input" : "NULL"} | (iii) return: ${retOK ? "SUPPORTED" : "SUB-FEE / NULL"}`);
console.log(`  RESULT_JSON ${JSON.stringify(out)}`);
