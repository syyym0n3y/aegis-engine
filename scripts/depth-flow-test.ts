#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// depth-flow-test.ts (D-808) — two pre-registered order-flow claims on the free Binance mirror data (ingest-binance-mirror.ts):
//   PREREG D-808-book-depth-imbalance : hourly mean (bid-ask)/(bid+ask) notional within +/-1% and +/-5% -> next-hour return
//   PREREG D-808-flow-metrics         : (i) 1h change in top-trader long/short ACCOUNT ratio, (ii) 1h taker buy/sell volume
//                                       ratio, (iii) 5-minute FOOTPRINT proxy: share of the hour's taker delta in the top
//                                       third of the hour's range minus the bottom third -> next-hour return
// EFFECT-SIZE LAW: the deciding statistic is the OLS/mean effect in bp per 1 sd of the (trailing-720h z-scored) signal,
// against the 7bp taker round trip; rank IC is reported beside it and never decides (D-426). Signal from hour h (bars
// closed), return = hour h+1 close-to-close (strictly after). Footprint proxy must also beat plain hourly delta (excess).
// Trials 6 + 9 = 15. Symbols BTCUSDT/ETHUSDT/SOLUSDT. Equities/FX L2 and flow: no free source — BLOCKED (paid), stated.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("depth-flow-test", [{ name: "SYMBOLS", def: "BTCUSDT,ETHUSDT,SOLUSDT" }, { name: "DIR", def: "data/binance-mirror" }, { name: "Z_WIN", def: "720" }, { name: "FEE_BP", def: "7" }, { name: "RUN_ID", def: "D-808-depth-flow" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "dft", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const REPO = new URL("..", import.meta.url).pathname; const DIR = K.DIR.startsWith("/") ? K.DIR : `${REPO}${K.DIR}`;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
async function jsonl<T>(p: string): Promise<T[]> { try { return (await Deno.readTextFile(p)).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.missing) as T[]; } catch (e) { if (e instanceof Deno.errors.NotFound) return []; throw e; } }
const hourTs = (d: string, hr: number) => Math.floor(Date.parse(d + "T00:00:00Z") / 1000) + hr * 3600;
// OLS of y (bp) on z-scored x, plus rank IC
function ols(x: number[], y: number[]) { const n = x.length; const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxy / (sxx || 1e-12); let sse = 0; for (let i = 0; i < n; i++) sse += (y[i] - my - b * (x[i] - mx)) ** 2; const se = Math.sqrt(sse / Math.max(1, n - 2) / (sxx || 1e-12)); return { b, t: b / (se || 1e-12), n }; }
function rankIC(x: number[], y: number[]) { const r = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const out = new Array(a.length); idx.forEach(([, i], k) => out[i] = k); return out as number[]; }; const rx = r(x), ry = r(y); const mx = mean(rx), my = mean(ry); let s = 0, sx = 0, sy = 0; for (let i = 0; i < x.length; i++) { s += (rx[i] - mx) * (ry[i] - my); sx += (rx[i] - mx) ** 2; sy += (ry[i] - my) ** 2; } return s / Math.sqrt(sx * sy || 1e-12); }
function zs(x: number[], W: number) { const out = new Array(x.length).fill(NaN); let s = 0, s2 = 0; for (let i = 0; i < x.length; i++) { s += x[i]; s2 += x[i] * x[i]; if (i >= W) { s -= x[i - W]; s2 -= x[i - W] ** 2; } if (i >= W) { const m = s / W, v = Math.max(0, s2 / W - m * m); out[i] = v > 0 ? (x[i] - m) / Math.sqrt(v) : NaN; } } return out; }
type Res = { sym: string; sig: string; bpPerSd: number; t: number; ic: number; n: number };
const results: Res[] = []; const W = +K.Z_WIN, FEE = +K.FEE_BP;
for (const sym of K.SYMBOLS.split(",")) {
  // hourly bars from 5m klines (also gives hourly return, plain delta, footprint proxy)
  const k5 = await jsonl<{ d: string; bars: number[][] }>(`${DIR}/klines5m/${sym}.jsonl`); assertNonEmpty(`${sym} 5m records (monthly archives)`, k5, 12);
  assertNonEmpty(`${sym} 5m bars`, k5.flatMap((r) => r.bars), 100000);
  const hours = new Map<number, { o: number; h: number; l: number; c: number; v: number; delta: number; fp: number }>();
  for (const day of k5) { const byH = new Map<number, number[][]>(); for (const b of day.bars) { const ht = Math.floor(b[0] / 3600) * 3600; (byH.get(ht) ?? byH.set(ht, []).get(ht)!).push(b); } for (const [ht, bs] of byH) { if (bs.length < 10) continue; const o = bs[0][1], c = bs[bs.length - 1][4], h = Math.max(...bs.map((b) => b[2])), l = Math.min(...bs.map((b) => b[3])); let v = 0, delta = 0, top = 0, bot = 0; const t1 = l + (h - l) / 3, t2 = l + 2 * (h - l) / 3; for (const b of bs) { const d = 2 * b[6] - b[5]; v += b[5]; delta += d; const mid = (b[2] + b[3]) / 2; if (mid >= t2) top += d; else if (mid < t1) bot += d; } hours.set(ht, { o, h, l, c, v, delta: v > 0 ? delta / v : 0, fp: v > 0 ? (top - bot) / v : 0 }); } }
  const ts = [...hours.keys()].sort((a, b) => a - b); const ret = new Map<number, number>(); for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] === 3600) ret.set(ts[i - 1], Math.log(hours.get(ts[i])!.c / hours.get(ts[i - 1])!.c) * 1e4);
  // depth
  const dep = await jsonl<{ d: string; hours: { hr: number; n: number; imb1: number; imb5: number }[] }>(`${DIR}/bookDepth/${sym}.jsonl`);
  const imb1 = new Map<number, number>(), imb5 = new Map<number, number>(); for (const day of dep) for (const h of day.hours) if (h.n >= 30) { imb1.set(hourTs(day.d, h.hr), h.imb1); imb5.set(hourTs(day.d, h.hr), h.imb5); }
  // metrics (5-min rows: [time, OI, OI value, top count L/S, top pos L/S, all count L/S, taker L/S vol]) -> hourly last/means
  const met = await jsonl<{ d: string; rows: (string | number)[][] }>(`${DIR}/metrics/${sym}.jsonl`);
  const topLS = new Map<number, number>(), takerLS = new Map<number, number[]>();
  for (const day of met) for (const r of day.rows) { const t0 = Math.floor(Date.parse(String(r[0]).replace(" ", "T") + "Z") / 1000); if (!Number.isFinite(t0)) continue; const ht = Math.floor(t0 / 3600) * 3600; if (Number.isFinite(+r[3])) topLS.set(ht, +r[3]); if (Number.isFinite(+r[6]) && +r[6] > 0) (takerLS.get(ht) ?? takerLS.set(ht, []).get(ht)!).push(+r[6]); }
  const signals: Record<string, (t: number) => number> = {
    "depth imb +/-1%": (t) => imb1.get(t) ?? NaN, "depth imb +/-5%": (t) => imb5.get(t) ?? NaN,
    "top-trader L/S 1h change": (t) => { const a = topLS.get(t), b = topLS.get(t - 3600); return a != null && b != null ? a - b : NaN; },
    "taker buy/sell vol ratio": (t) => { const a = takerLS.get(t); return a?.length ? Math.log(mean(a)) : NaN; },
    "plain hourly taker delta": (t) => hours.get(t)?.delta ?? NaN,
    "footprint proxy (top-bottom third delta)": (t) => hours.get(t)?.fp ?? NaN,
  };
  for (const [name, f] of Object.entries(signals)) {
    const xs = ts.map(f); const z = zs(xs.map((v) => Number.isFinite(v) ? v : 0), W);
    const X: number[] = [], Y: number[] = []; for (let i = 0; i < ts.length; i++) { if (!Number.isFinite(xs[i]) || !Number.isFinite(z[i])) continue; const y = ret.get(ts[i]); if (y == null) continue; X.push(z[i]); Y.push(y); }
    if (X.length < 2000) { console.log(`  ${sym} ${name}: UNTESTED (n ${X.length})`); continue; }
    const o = ols(X, Y); results.push({ sym, sig: name, bpPerSd: o.b, t: o.t, ic: rankIC(X, Y), n: o.n });
  }
}
assertNonEmpty("results", results, 6);
const T = await spendTrials({ rest: OWNED, headers: hdr, family: "depth-flow", runId: K.RUN_ID, spent: 15 });
console.log(`\n==> ORDER-BOOK DEPTH + FLOW METRICS -> next-hour return (OLS bp per 1 sd decides; rank IC reported). Fee ${FEE}bp RT. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    ${"symbol".padEnd(8)} ${"signal".padEnd(42)} ${"bp/sd".padStart(7)} ${"t".padStart(7)} ${"x fee".padStart(6)} ${"rankIC".padStart(7)} ${"n".padStart(7)}`);
for (const r of results) console.log(`    ${r.sym.padEnd(8)} ${r.sig.padEnd(42)} ${r.bpPerSd.toFixed(2).padStart(7)} ${r.t.toFixed(2).padStart(7)} ${(r.bpPerSd / FEE).toFixed(2).padStart(6)} ${r.ic.toFixed(3).padStart(7)} ${String(r.n).padStart(7)}`);
const verdict = (sigs: string[], label: string) => { const rs = results.filter((r) => sigs.includes(r.sig)); const bySig = sigs.map((s) => results.filter((r) => r.sig === s)); const sup = bySig.some((g) => g.length === 3 && g.every((r) => r.bpPerSd >= FEE && r.t >= 2.5)); const missed = bySig.some((g) => g.length === 3 && g.every((r) => r.t <= -2.5)); const maxAbs = Math.max(...rs.map((r) => Math.abs(r.bpPerSd))); console.log(`  VERDICT ${label}: ${sup ? "SUPPORTED" : missed ? "SIGN MISSED" : `SUB-FEE / NULL (largest |effect| ${maxAbs.toFixed(2)}bp per sd = ${(maxAbs / FEE).toFixed(2)}x fee)`}`); };
verdict(["depth imb +/-1%", "depth imb +/-5%"], "book-depth imbalance");
verdict(["top-trader L/S 1h change", "taker buy/sell vol ratio", "footprint proxy (top-bottom third delta)"], "flow metrics");
const fpEx = ["BTCUSDT", "ETHUSDT", "SOLUSDT"].map((s) => { const a = results.find((r) => r.sym === s && r.sig.startsWith("footprint")), b = results.find((r) => r.sym === s && r.sig.startsWith("plain")); return a && b ? `${s} ${(a.bpPerSd - b.bpPerSd).toFixed(2)}bp/sd` : `${s} n/a`; });
console.log(`  footprint proxy EXCESS over plain hourly delta (rule needs >= +2bp/sd): ${fpEx.join(" | ")}`);
console.log(`  RESULT_JSON ${JSON.stringify(results)}`);
