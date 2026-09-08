#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// harrv-sizing-overlay.ts (D-821) — "lowest-risk entry" as SIZING on the full history of the registered rules: each event sized
// by min(3, TARGET / HAR-RV forecast at the prior close) vs constant size; control: trailing-22d realised-vol scaling.
// Constructions unchanged (D-782 cells on the 17-panel; persist-real K24 on 5 crypto tf=1h). 2024-01..2026-09. Trials 8.
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("harrv-sizing-overlay", [{ name: "FROM", def: "2024-01-01" }, { name: "TARGET_ANN", def: "0.20", note: "annualised vol target for scaling" }, { name: "RUN_ID", def: "D-821-harrv-sizing" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "hso", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr); const FROM_TS = Math.floor(Date.parse(K.FROM + "T00:00:00Z") / 1000); const TARGET = +K.TARGET_ANN;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length); const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
type XB = { ts: number; o: number; h: number; l: number; c: number; v: number; taker?: number };
async function load(sym: string, kind: "1hSF" | "1h" | "fx"): Promise<XB[]> {
  if (kind === "fx") { const out: XB[] = []; for (let off = 0; ; off += 50000) { const p = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc&offset=${off}&limit=50000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; for (const r of p) if (r.c > 0) out.push({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol || 0 }); if (p.length < 50000) break; } return out; }
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.${kind}&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).filter((b) => b.length >= 6 && b[5] > 0).map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], taker: b[7] })).sort((a, b) => a.ts - b.ts);
}
// causal HAR-RV forecast per day (log RV on lags 1/5/22, fit on trailing 730 days ending the prior day) and trailing-22d realised
function volSeries(bars: XB[]): Map<string, { har: number; trail: number }> {
  const acc = new Map<string, { s: number; n: number }>(); for (let i = 1; i < bars.length; i++) { if (bars[i].ts - bars[i - 1].ts !== 3600) continue; const d = new Date(bars[i].ts * 1000).toISOString().slice(0, 10); const r = Math.log(bars[i].c / bars[i - 1].c); const a = acc.get(d) ?? { s: 0, n: 0 }; a.s += r * r; a.n++; acc.set(d, a); }
  const days = [...acc.entries()].filter(([, a]) => a.n >= 12 && a.s > 0).map(([d, a]) => ({ d, rv: a.s })).sort((a, b) => a.d < b.d ? -1 : 1); const out = new Map<string, { har: number; trail: number }>();
  const lag = (i: number, k: number) => Math.log(days.slice(i - k, i).reduce((s, x) => s + x.rv, 0) / k);
  let w = [0, 0, 0, 0]; for (let i = 300; i < days.length; i++) {
    if ((i - 300) % 5 === 0) { const from = Math.max(22, i - 730); const A: number[][] = [], y: number[] = []; for (let j = from; j < i; j++) { A.push([1, lag(j, 1), lag(j, 5), lag(j, 22)]); y.push(Math.log(days[j].rv)); } w = ols4(A, y); }
    const yhat = w[0] + w[1] * lag(i, 1) + w[2] * lag(i, 5) + w[3] * lag(i, 22); out.set(days[i].d, { har: Math.sqrt(Math.exp(yhat) * 365), trail: Math.sqrt(days.slice(i - 22, i).reduce((s, x) => s + x.rv, 0) / 22 * 365) });
  }
  return out;
}
function ols4(X: number[][], y: number[]): number[] { const p = 4; const A = Array.from({ length: p }, () => new Array(p).fill(0)); const b = new Array(p).fill(0); for (let i = 0; i < X.length; i++) for (let j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k]; } for (let i = 0; i < p; i++) { let piv = i; for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r; [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]]; for (let r = 0; r < p; r++) { if (r === i) continue; const f = A[r][i] / (A[i][i] || 1e-12); for (let k = i; k < p; k++) A[r][k] -= f * A[i][k]; b[r] -= f * b[i]; } } return b.map((v, i) => v / (A[i][i] || 1e-12)); }
const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10); const prevDay = (k: string) => { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
type Ev = { con: string; d: string; net: number; har: number; trail: number };
const evs: Ev[] = [];
const CELLS: Record<string, (h: number, b: XB, pdh: number, pdl: number) => boolean> = { "utc01-sweepPDL-reclaim": (h, b, _p, pdl) => h === 1 && b.l < pdl && b.c >= pdl, "utc09to10-belowPDL": (h, b, _p, pdl) => (h === 9 || h === 10) && b.c < pdl, "utc16-abovePDH": (h, b, pdh) => h === 16 && b.c > pdh };
const PANEL: [string, "1hSF" | "fx", number][] = [...["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"].map((s) => [s, "1hSF", 7e-4] as [string, "1hSF", number]), ...["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"].map((s) => [s, "fx", 4e-4] as [string, "fx", number]), ...["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"].map((s) => [s, "fx", 2e-4] as [string, "fx", number])];
for (const [sym, kind, rt] of PANEL) {
  const bars = await load(sym, kind); if (bars.length < 5000) continue; const vs = volSeries(bars);
  const dl = new Map<string, { hi: number; lo: number }>(); for (const b of bars) { const k = dayKey(b.ts); const c = dl.get(k); if (!c) dl.set(k, { hi: b.h, lo: b.l }); else { c.hi = Math.max(c.hi, b.h); c.lo = Math.min(c.lo, b.l); } }
  for (let i = 25; i < bars.length - 6; i++) { const b = bars[i]; if (b.ts < FROM_TS) continue; const pd = dl.get(prevDay(dayKey(b.ts))); if (!pd) continue; const v = vs.get(prevDay(dayKey(b.ts))); if (!v) continue; const h = new Date(b.ts * 1000).getUTCHours(); for (const [name, chk] of Object.entries(CELLS)) if (chk(h, b, pd.hi, pd.lo)) evs.push({ con: name, d: dayKey(b.ts), net: Math.log(bars[i + 6].c / b.c) - rt, har: v.har, trail: v.trail }); }
}
for (const sym of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]) {
  const bars = await load(sym, "1h"); if (bars.length < 5000) continue; const vs = volSeries(bars); const N = 200; const dz = new Array(bars.length).fill(0); const del = bars.map((b) => (b.taker ?? 0) - 0.5 * b.v);
  let s1 = 0, s2 = 0; for (let i = 0; i < bars.length; i++) { const d = del[i]; if (i >= N) { const m = s1 / N, v = Math.max(0, s2 / N - m * m); const sdv = Math.sqrt(v * N / (N - 1)); dz[i] = sdv > 0 ? (d - m) / sdv : 0; s1 -= del[i - N]; s2 -= del[i - N] ** 2; } s1 += d; s2 += d * d; }
  const psl = priorSessionLevels(bars as unknown as Bar[]);
  for (let i = N; i < bars.length - 25; i++) { const b = bars[i]; if (b.ts < FROM_TS) continue; const L = psl[i]; if (!L || i <= L.fromLastIndex || !(b.c < L.low)) continue; const w = [dz[i - 2], dz[i - 1], dz[i]]; if (!(w.every((z) => z >= 1) || w.every((z) => z <= -1))) continue; const entry = bars[i + 1].o; if (!(entry > 0)) continue; const v = vs.get(prevDay(dayKey(b.ts))); if (!v) continue; evs.push({ con: "persist-real-K24", d: dayKey(b.ts), net: Math.log(bars[i + 1 + 24].c / entry) - 7e-4, har: v.har, trail: v.trail }); }
}
assertNonEmpty("events", evs, 2000);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "harrv-sizing", runId: K.RUN_ID, spent: 8 });
console.log(`\n==> HAR-RV SIZING OVERLAY on the registered rules, ${K.FROM}..2026-09, ${evs.length.toLocaleString()} events. Target ${TARGET} ann. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
function book(scale: (e: Ev) => number) { const byDay = new Map<string, number>(); for (const e of evs) byDay.set(e.d, (byDay.get(e.d) ?? 0) + scale(e) * e.net); const days = [...byDay.keys()].sort(); const pnl = days.map((d) => byDay.get(d)!); let eq = 0, peak = 0, mdd = 0; for (const p of pnl) { eq += p; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq - peak); } return { sr: mean(pnl) / (sd(pnl) || 1e-12) * Math.sqrt(252), mdd, n: pnl.length, total: eq }; }
const out: Record<string, unknown> = {};
for (const con of [...new Set(evs.map((e) => e.con)), "ALL"]) {
  const E = con === "ALL" ? evs : evs.filter((e) => e.con === con); const sub = (f: (e: Ev) => number) => { const byDay = new Map<string, number>(); for (const e of E) byDay.set(e.d, (byDay.get(e.d) ?? 0) + f(e) * e.net); const pnl = [...byDay.keys()].sort().map((d) => byDay.get(d)!); let eq = 0, peak = 0, mdd = 0; for (const p of pnl) { eq += p; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq - peak); } return { sr: mean(pnl) / (sd(pnl) || 1e-12) * Math.sqrt(252), mdd, n: pnl.length }; };
  const c = sub(() => 1), hsz = sub((e) => Math.min(3, TARGET / Math.max(0.02, e.har))), tsz = sub((e) => Math.min(3, TARGET / Math.max(0.02, e.trail)));
  console.log(`  ${con.padEnd(24)} n ${E.length.toString().padStart(6)} | constant SR ${c.sr.toFixed(2).padStart(6)} mdd ${(c.mdd * 100).toFixed(1).padStart(6)}% | HAR-scaled SR ${hsz.sr.toFixed(2).padStart(6)} mdd ${(hsz.mdd * 100).toFixed(1).padStart(6)}% | trail-scaled SR ${tsz.sr.toFixed(2).padStart(6)} mdd ${(tsz.mdd * 100).toFixed(1).padStart(6)}%`);
  out[con] = { constant: c, har: hsz, trail: tsz };
}
const a = out["ALL"] as { constant: { sr: number; mdd: number }; har: { sr: number; mdd: number }; trail: { sr: number; mdd: number } };
const sup = a.har.sr - a.constant.sr >= 0.15 && a.har.mdd >= 0.8 * a.constant.mdd && a.har.sr >= a.trail.sr;
console.log(`\n  VERDICT: ${sup ? "SUPPORTED as a sizing overlay" : "NULL"} (SR gain ${(a.har.sr - a.constant.sr).toFixed(2)}, mdd ${(a.constant.mdd * 100).toFixed(1)}% -> ${(a.har.mdd * 100).toFixed(1)}%, trail control SR ${a.trail.sr.toFixed(2)})`);
console.log(`  RESULT_JSON ${JSON.stringify(out)}`);
