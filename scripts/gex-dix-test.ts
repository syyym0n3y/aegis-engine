#!/usr/bin/env -S deno run --allow-net --allow-env
// gex-dix-test.ts (D-817) — PREREG D-817-spx-gex-dix. SqueezeMetrics GEX/DIX daily vs SPX: (i) GEX z adds to a HAR+VIX3M
// |return| regression (vol suppression) — OOS R^2 gain per walk-forward year; (ii) GEX z -> next-day return; (iii) DIX z ->
// next-20-day return, Newey-West(20). Trials 6.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("gex-dix-test", [{ name: "FEE_BP", def: "4" }, { name: "Z_WIN", def: "250" }, { name: "RUN_ID", def: "D-817-gex-dix" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gdx", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const W = +K.Z_WIN, FEE = +K.FEE_BP;
const ser = async (s: string) => { const m = new Map<string, number>(); const rows = await q(`trd_macro_series?series=eq.${s}&select=d,v&order=d.asc&limit=20000`) as { d: string; v: number }[]; for (const r of rows) m.set(r.d, r.v); return m; };
const gex = await ser("sqm_gex"), dix = await ser("sqm_dix"), spx = await ser("sqm_spx"), vix3m = await ser("cboe_vix3m");
const days = [...gex.keys()].filter((d) => dix.has(d) && spx.has(d)).sort(); assertNonEmpty("days", days, 3000);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function zs(x: number[]) { const out = new Array(x.length).fill(NaN); for (let i = W; i < x.length; i++) { const w = x.slice(i - W, i); const s = sd(w); out[i] = s > 0 ? (x[i] - mean(w)) / s : NaN; } return out; }
function ols(x: number[], y: number[]) { const n = x.length, mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12); const res = y.map((v, i) => v - my - b * (x[i] - mx)); return { b, res, n }; }
function nwT(b: number, x: number[], res: number[], L: number) { const mx = mean(x); const u = x.map((v, i) => (v - mx) * res[i]); const n = u.length; let S = 0; for (let l = 0; l <= L; l++) { let g = 0; for (let i = l; i < n; i++) g += u[i] * u[i - l]; S += (l === 0 ? 1 : 2 * (1 - l / (L + 1))) * g; } const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0); return b / (Math.sqrt(S) / sxx || 1e-12); }
const ret = days.map((d, i) => i ? Math.log(spx.get(d)! / spx.get(days[i - 1])!) * 1e4 : NaN);
const gz = zs(days.map((d) => Math.log(Math.max(1, gex.get(d)!)))), dz = zs(days.map((d) => dix.get(d)!));
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "gex-dix", runId: K.RUN_ID, spent: 6 });
console.log(`\n==> SPX GEX / DIX (SqueezeMetrics, ${days[0]}..${days[days.length - 1]}, ${days.length} days). Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
// (ii) GEX z -> next-day return; (iii) DIX z -> next-20d return; by era
const eras: [string, string, string][] = [["2011-2017", "2011-01-01", "2018-01-01"], ["2018-2026", "2018-01-01", "2027-01-01"]];
const out: Record<string, unknown> = {};
for (const [label, z, horizon, name] of [["GEX z -> next-day return", gz, 1, "gex_ret"], ["DIX z -> next-20-day return", dz, 20, "dix_ret"]] as [string, number[], number, string][]) {
  console.log(`  ${label}:`); const per: Record<string, unknown> = {};
  for (const [era, a, b] of eras) {
    const X: number[] = [], Y: number[] = []; for (let i = 0; i + horizon < days.length; i++) { if (days[i] < a || days[i] >= b || !Number.isFinite(z[i])) continue; let y = 0; for (let k = 1; k <= horizon; k++) y += ret[i + k]; if (!Number.isFinite(y)) continue; X.push(z[i]); Y.push(y); }
    const o = ols(X, Y); const t = nwT(o.b, X, o.res, horizon); per[era] = { bpPerSd: o.b, t, n: o.n }; console.log(`    ${era}: ${o.b.toFixed(2)}bp per 1 sd (${(o.b / (FEE * (horizon === 1 ? 1 : 1))).toFixed(2)}x ${FEE}bp), NW(${horizon}) t ${t.toFixed(2)}, n ${o.n}`);
  }
  out[name] = per;
}
// (i) vol: |ret| on HAR(1,5,22 of |ret|) + VIX3M z, with and without GEX z, yearly walk-forward
const absr = ret.map((r) => Math.abs(r)); const har = (i: number, L: number) => { let s = 0, n = 0; for (let k = 1; k <= L; k++) { if (i - k < 0 || !Number.isFinite(absr[i - k])) continue; s += absr[i - k]; n++; } return n ? s / n : NaN; };
const vz = zs(days.map((d) => vix3m.get(d) ?? NaN));
const rowsV = days.map((d, i) => ({ d, y: absr[i + 1] ?? NaN, h1: har(i, 1), h5: har(i, 5), h22: har(i, 22), v: vz[i], g: gz[i] })).filter((r) => [r.y, r.h1, r.h5, r.h22, r.v, r.g].every(Number.isFinite));
function fit(rows: typeof rowsV, cols: ((r: typeof rowsV[0]) => number)[]) { const X = rows.map((r) => [1, ...cols.map((c) => c(r))]); const y = rows.map((r) => r.y); const k = X[0].length; const A = Array.from({ length: k }, () => new Array(k).fill(0)); const bv = new Array(k).fill(0); for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { bv[a] += X[i][a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += X[i][a] * X[i][c]; } for (let a = 0; a < k; a++) A[a][a] += 1e-6; const w = solve(A, bv); return (r: typeof rowsV[0]) => { const x = [1, ...cols.map((c) => c(r))]; return x.reduce((s, v, j) => s + v * w[j], 0); }; }
function solve(A: number[][], b: number[]) { const n = b.length; const M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / (M[c][c] || 1e-12); for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / (r[i] || 1e-12)); }
const base = [(r: typeof rowsV[0]) => r.h1, (r: typeof rowsV[0]) => r.h5, (r: typeof rowsV[0]) => r.h22, (r: typeof rowsV[0]) => r.v]; const withG = [...base, (r: typeof rowsV[0]) => r.g];
console.log(`  (i) next-day |return|: OOS R^2 with GEX added to HAR+VIX3M, yearly walk-forward:`); let clears = 0, years = 0; const gains: Record<string, number> = {};
for (let Y = 2019; Y <= 2026; Y++) { const tr = rowsV.filter((r) => r.d < `${Y}-01-01`), te = rowsV.filter((r) => r.d.startsWith(String(Y))); if (tr.length < 500 || te.length < 60) continue; const f0 = fit(tr, base), f1 = fit(tr, withG); const my = mean(te.map((r) => r.y)); const ss = te.reduce((s, r) => s + (r.y - my) ** 2, 0); const r0 = 1 - te.reduce((s, r) => s + (r.y - f0(r)) ** 2, 0) / ss, r1 = 1 - te.reduce((s, r) => s + (r.y - f1(r)) ** 2, 0) / ss; gains[Y] = r1 - r0; years++; if (r1 - r0 >= 0.02) clears++; console.log(`    ${Y}: R^2 HAR+VIX ${r0.toFixed(3)} -> +GEX ${r1.toFixed(3)} (gain ${(r1 - r0 >= 0 ? "+" : "")}${(r1 - r0).toFixed(3)})`); }
out["vol_gains"] = gains; const volOK = years >= 6 && clears >= 6;
const gr = out["gex_ret"] as Record<string, { bpPerSd: number; t: number }>, dr = out["dix_ret"] as Record<string, { bpPerSd: number; t: number }>;
const retOK = (r: Record<string, { bpPerSd: number; t: number }>) => Object.values(r).every((e) => e.bpPerSd >= FEE && e.t >= 2.5); const retMiss = (r: Record<string, { bpPerSd: number; t: number }>) => Object.values(r).some((e) => e.t <= -2.5);
console.log(`\n  VERDICT (i) vol: ${volOK ? "CONFIRMED as sizing input" : `NULL (${clears}/${years} years clear +0.02)`} | (ii) GEX->return: ${retOK(gr) ? "SUPPORTED" : retMiss(gr) ? "SIGN MISSED" : "SUB-FEE / NULL"} | (iii) DIX->20d return: ${retOK(dr) ? "SUPPORTED" : retMiss(dr) ? "SIGN MISSED" : "SUB-FEE / NULL"}`);
console.log(`  RESULT_JSON ${JSON.stringify(out)}`);
