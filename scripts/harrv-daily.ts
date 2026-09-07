#!/usr/bin/env -S deno run --allow-net --allow-env
// harrv-daily.ts (D-819) — the one model class that PASSED (D-814: HAR-RV, OOS R^2 gain +0.12..+0.30 on 11/11 instruments)
// as a LIVE daily input: next-day realised-variance forecast per instrument, written to trd_macro_series as
//   harrv_vol_1d:<SYM>   annualised vol forecast, %   (sqrt(RV_hat * 365))
//   harrv_logrv_1d:<SYM> log RV forecast (the model's native unit)
// Construction exactly as registered: daily RV = sum of squared hourly log returns (>= 12 hours), HAR in log space on lags
// 1 / 5 / 22, fit on the trailing 730 days, forecast for the next day. Inputs: crypto tf=1hSF (one symbol per read, D-812),
// FX/index from trd_fx_hourly. Not a direction claim: this is the "how far / how long" input for SIZING_FRAMEWORK.md.
// Positive controls: >= 10 of 11 instruments forecast; BTC forecast within 0.3x..3x of its trailing-22d realised vol.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("harrv-daily", [{ name: "CRYPTO", def: "BTCUSDT,ETHUSDT,SOLUSDT" }, { name: "FXIDX", def: "EURUSD,GBPUSD,USDJPY,AUDUSD,XAUUSD,USA500IDXUSD,USATECHIDXUSD,BRENTCMDUSD" }, { name: "FIT_DAYS", def: "730" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "har", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
async function hourly(sym: string, crypto: boolean): Promise<{ ts: number; c: number }[]> {
  if (crypto) { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1hSF&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).filter((b) => b.length >= 6 && b[4] > 0 && b[5] > 0).map((b) => ({ ts: b[0], c: b[4] })); }
  const out: { ts: number; c: number }[] = []; for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,c&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; c: number }[]; for (const r of p) if (r.c > 0) out.push(r); if (p.length < 50000) break; } return out;
}
function dailyLogRV(bars: { ts: number; c: number }[]): { d: string; y: number }[] {
  bars.sort((a, b) => a.ts - b.ts); const acc = new Map<string, { s: number; n: number }>();
  for (let i = 1; i < bars.length; i++) { if (bars[i].ts - bars[i - 1].ts !== 3600) continue; const d = new Date(bars[i].ts * 1000).toISOString().slice(0, 10); const r = Math.log(bars[i].c / bars[i - 1].c); const a = acc.get(d) ?? { s: 0, n: 0 }; a.s += r * r; a.n++; acc.set(d, a); }
  return [...acc.entries()].filter(([, a]) => a.n >= 12 && a.s > 0).map(([d, a]) => ({ d, y: Math.log(a.s) })).sort((a, b) => a.d < b.d ? -1 : 1);
}
function ols(X: number[][], y: number[]): number[] { // normal equations, 4 params
  const p = X[0].length; const A = Array.from({ length: p }, () => new Array(p).fill(0)); const b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) for (let j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k]; }
  for (let i = 0; i < p; i++) { let piv = i; for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r; [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]]; for (let r = 0; r < p; r++) { if (r === i) continue; const f = A[r][i] / (A[i][i] || 1e-12); for (let k = i; k < p; k++) A[r][k] -= f * A[i][k]; b[r] -= f * b[i]; } }
  return b.map((v, i) => v / (A[i][i] || 1e-12));
}
const today = new Date().toISOString().slice(0, 10); const rows: { series: string; d: string; v: number }[] = []; const report: string[] = []; let btcOk = false;
for (const [list, crypto] of [[K.CRYPTO, true], [K.FXIDX, false]] as [string, boolean][]) for (const sym of list.split(",")) {
  const s = dailyLogRV(await hourly(sym, crypto)); if (s.length < 300) { report.push(`${sym}: UNTESTED (${s.length} days)`); continue; }
  const rv = s.map((x) => Math.exp(x.y)); const lag = (i: number, k: number) => Math.log(rv.slice(i - k, i).reduce((a, b) => a + b, 0) / k);
  const X: number[][] = [], y: number[] = []; const from = Math.max(22, s.length - +K.FIT_DAYS);
  for (let i = from; i < s.length; i++) { X.push([1, lag(i, 1), lag(i, 5), lag(i, 22)]); y.push(s[i].y); }
  const w = ols(X, y); const n = s.length; const xf = [1, lag(n, 1), lag(n, 5), lag(n, 22)]; const yhat = xf.reduce((a, b, i) => a + b * w[i], 0);
  const volAnn = Math.sqrt(Math.exp(yhat) * 365) * 100; const trail22 = Math.sqrt(rv.slice(-22).reduce((a, b) => a + b, 0) / 22 * 365) * 100;
  rows.push({ series: `harrv_vol_1d:${sym}`, d: today, v: volAnn }, { series: `harrv_logrv_1d:${sym}`, d: today, v: yhat });
  if (sym === "BTCUSDT") btcOk = volAnn > 0.3 * trail22 && volAnn < 3 * trail22;
  report.push(`${sym.padEnd(14)} next-day vol forecast ${volAnn.toFixed(1)}% ann (trailing-22d realised ${trail22.toFixed(1)}%), last RV day ${s[n - 1].d}, fit ${X.length}d`);
}
console.log(`==> HAR-RV DAILY ${today}`); for (const l of report) console.log("  " + l);
assertNonEmpty("forecasts", rows, 20);
if (!btcOk) { console.error("  RED — positive control: BTC forecast outside 0.3x..3x of its trailing realised vol"); Deno.exit(1); }
const w = await fetch(`${OWNED}/trd_macro_series?on_conflict=series,d`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }); if (!w.ok) { console.error(`  RED — write ${w.status}`); Deno.exit(1); }
const back = (await q(`trd_macro_series?series=eq.harrv_vol_1d:BTCUSDT&d=eq.${today}&select=v`) as { v: number }[])[0]; if (!back) { console.error("  RED — read-back failed"); Deno.exit(1); }
console.log(`  ${rows.length / 2} instruments written; positive controls passed (BTC forecast ${back.v.toFixed(1)}% read back)`);
