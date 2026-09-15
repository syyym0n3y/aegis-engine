// D-928 — do BTC on-chain fundamentals predict forward returns? The first non-price/non-flow variable class.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("onchain-predictors", [
  { name: "GROWTH", def: "30", note: "growth lookback days" }, { name: "SPLIT", def: "2022-01-01" }, { name: "COST_BP", def: "9" }, { name: "RUN_ID", def: "D-928-onchain-predictors" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function corrT(x: number[], y: number[]) { const n = x.length; if (n < 30) return { r: 0, t: 0, n }; const mx = mean(x), my = mean(y); let c = 0, vx = 0, vy = 0; for (let i = 0; i < n; i++) { c += (x[i]-mx)*(y[i]-my); vx += (x[i]-mx)**2; vy += (y[i]-my)**2; } const r = c/(Math.sqrt(vx*vy)||1); return { r, t: r*Math.sqrt(n-2)/Math.sqrt(Math.max(1e-9,1-r*r)), n }; }
async function ser(id: string): Promise<Map<number, number>> { const rows = await q(`trd_macro_series?series=eq.${id}&select=d,v&order=d`) as { d: string; v: number }[]; const m = new Map<number, number>(); for (const r of rows) { const day = Math.floor(Date.parse(r.d + "T00:00:00Z") / 86400000); if (r.v != null && isFinite(+r.v) && +r.v > 0) m.set(day, +r.v); } return m; }
const P = await ser("onchain_btc_market_price");
const days = [...P.keys()].sort((a, b) => a - b);
assertNonEmpty("price days", days, 1000);
const G = +K.GROWTH; const SPLIT = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 86400000);
const METRICS = ["n_unique_addresses", "n_transactions", "estimated_transaction_volume_usd", "hash_rate", "miners_revenue", "transaction_fees_usd", "mempool_size"];
const M: Record<string, Map<number, number>> = {}; for (const m of METRICS) M[m] = await ser("onchain_btc_" + m);
const txv = M["estimated_transaction_volume_usd"];
// NVT proxy: price / MA30(tx_volume_usd), z-scored over trailing 365d (stationary, mean-reversion signal)
function ma(map: Map<number, number>, d: number, w: number) { let s = 0, n = 0; for (let k = d - w + 1; k <= d; k++) { const v = map.get(k); if (v !== undefined) { s += v; n++; } } return n > w * 0.6 ? s / n : null; }
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const fwdRet = (d: number, h: number) => { const p0 = P.get(d); let f = d + h; for (let k = 0; k < 4 && !P.has(f); k++) f++; const p1 = P.get(f); return p0 && p1 ? Math.log(p1 / p0) : null; };
const growth = (map: Map<number, number>, d: number) => { const a = map.get(d), b = map.get(d - G); return a && b ? Math.log(a / b) : null; };
console.log(`==> D-928 ON-CHAIN PREDICTORS (BTC, ${days.length} days 2009-2026) — ${G}d growth, fwd 7/30d, cost ${K.COST_BP}bp, ceiling ${ceil.ceiling.toFixed(2)}\n`);
console.log(`  ${"predictor".padEnd(26)} ${"contemp-r".padStart(9)} ${"fwd7 t".padStart(7)} ${"fwd30 t".padStart(8)} ${"Q5-Q1 30d bp".padStart(12)} ${"train->test 30d".padStart(16)}`);
function buildSig(name: string): (d: number) => number | null {
  if (name === "NVT") return (d) => { const p = P.get(d), tv = ma(txv, d, 30); if (!p || !tv) return null; const raw = p / tv; const hist: number[] = []; for (let k = d - 365; k <= d; k++) { const pk = P.get(k), tk = ma(txv, k, 30); if (pk && tk) hist.push(pk / tk); } if (hist.length < 200) return null; const z = (raw - mean(hist)) / (sd(hist) || 1); return -z; }; // high NVT -> predict lower return
  return (d) => growth(M[name], d);
}
function testSig(sig: (d: number) => number | null, hControl = false) {
  const rec: { d: number; s: number; f7: number | null; f30: number | null; c: number | null }[] = [];
  for (const d of days) { const s = sig(d); if (s === null || !isFinite(s)) continue; const c = growth(P, d); rec.push({ d, s, f7: fwdRet(d, 7), f30: fwdRet(d, 30), c }); }
  const contemp = corrT(rec.filter(r=>r.c!==null).map(r=>r.s), rec.filter(r=>r.c!==null).map(r=>r.c!)); // vs contemporaneous 30d price growth
  // non-overlapping forward: sample every h days
  const nonov = (h: number, key: "f7" | "f30", win: (d: number) => boolean) => { const r = rec.filter((x) => x[key] !== null && win(x.d)); const idx: number[] = []; for (let i = 0; i < r.length; i += h) idx.push(i); const xs = idx.map((i) => r[i].s), ys = idx.map((i) => r[i][key]!); return corrT(xs, ys); };
  const f7 = nonov(7, "f7", () => true), f30 = nonov(30, "f30", () => true);
  // quintile spread on 30d fwd (non-overlapping)
  const r30 = rec.filter((x) => x.f30 !== null); const idx: number[] = []; for (let i = 0; i < r30.length; i += 30) idx.push(i);
  const samp = idx.map((i) => r30[i]); const order = [...samp].sort((a, b) => a.s - b.s); const kq = Math.max(1, Math.floor(order.length / 5));
  const spread = (mean(order.slice(-kq).map((x) => x.f30!)) - mean(order.slice(0, kq).map((x) => x.f30!))) * 1e4;
  const tr = nonov(30, "f30", (d) => d < SPLIT), te = nonov(30, "f30", (d) => d >= SPLIT);
  return { contemp: contemp.r, f7t: f7.t, f30t: f30.t, spread, trT: tr.t, teT: te.t };
}
let spent = 0;
for (const name of [...METRICS, "NVT"]) {
  const r = testSig(buildSig(name)); spent++;
  console.log(`  ${name.padEnd(26)} ${r.contemp.toFixed(3).padStart(9)} ${r.f7t.toFixed(2).padStart(7)} ${r.f30t.toFixed(2).padStart(8)} ${r.spread.toFixed(0).padStart(12)} ${(r.trT.toFixed(2)+"->"+r.teT.toFixed(2)).padStart(16)}`);
}
await spendTrials({ rest: OWNED, headers: hdr, family: "onchain-predictors", runId: K.RUN_ID, spent });
console.log(`\n  READ: contemp-r + = usage tracks price (control). fwd t past ${ceil.ceiling.toFixed(2)} + Q5-Q1 30d > ${+K.COST_BP*3}bp (3x cost for a monthly hold) + train->test both same sign = deployable; else sub-cost/regime.`);
