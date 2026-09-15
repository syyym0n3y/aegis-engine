// D-919 — does CONFLUENCE (K of 4 chart factors agreeing) lift the real-but-sub-cost timing edge past cost?
// D-917 found trend & momentum beat a matched-random benchmark on perps by ~1-3bp/trade, below the ~5-10bp round-trip.
// The operator's core claim: an edge can be identified by MULTIPLE factors agreeing even when no single one clears cost.
// This sweeps K = number of the 4 setups agreeing on direction, on the liquid majors (real cost ~6bp) and the 1hSF panel,
// and asks whether net-of-cost per-trade return rises with K and clears cost at K>=3, still beating matched-random.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("confluence", [
  { name: "SET", def: "liquid", note: "liquid (top perps by $vol) | panel97 (1hSF survivor-free)" },
  { name: "TOPN", def: "20", note: "how many top-$vol names when SET=liquid" },
  { name: "N", def: "20" }, { name: "H", def: "6" }, { name: "MOM", def: "10", note: "momentum lookback bars" },
  { name: "COSTS", def: "6,9,15", note: "round-trip bp reported" }, { name: "DRAWS", def: "200" }, { name: "SEED", def: "20260915" },
  { name: "MIN_BARS", def: "2000" }, { name: "RUN_ID", def: "D-919-confluence-liftpastcost" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 && sd(a) > 0 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0;
let seed = +K.SEED >>> 0; const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const N = +K.N, H = +K.H, MOM = +K.MOM;
// four setups -> signed vote in {-1,0,1}; K = |sum of votes that agree| via net direction & agreement count
function votes(b: number[][], i: number): number[] {
  let sma = 0; for (let k = i - N + 1; k <= i; k++) sma += b[k][4]; sma /= N;
  let hi = -Infinity, lo = Infinity; for (let k = i - N; k < i; k++) { hi = Math.max(hi, b[k][2]); lo = Math.min(lo, b[k][3]); }
  const trend = Math.sign(b[i][4] - sma);
  const mom = i > MOM ? Math.sign(b[i][4] / b[i - MOM][4] - 1) : 0;
  const brk = b[i][4] > hi ? 1 : b[i][4] < lo ? -1 : 0;
  const pos = hi > lo ? (b[i][4] - lo) / (hi - lo) : 0.5; const fade = pos > 0.9 ? -1 : pos < 0.1 ? 1 : 0;
  return [trend, mom, brk, fade];
}
// meta: choose universe
let syms: string[];
if (K.SET === "liquid") {
  const meta = await q(`trd_bars_intraday?tf=eq.1h&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
  // rank by dollar volume: pull a cheap vol proxy = n_bars filter then compute $vol below; first take the long-history names
  syms = meta.filter((r) => r.n_bars >= +K.MIN_BARS).map((r) => r.symbol);
} else {
  const meta = await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
  syms = meta.filter((r) => r.n_bars >= +K.MIN_BARS).map((r) => r.symbol);
}
const tf = K.SET === "liquid" ? "1h" : "1hSF";
// load bars, compute per-name $vol to rank when liquid
type Row = { sym: string; b: number[][]; vol: number };
const loaded: Row[] = [];
for (const s of syms) {
  const row = (await q(`trd_bars_intraday?symbol=eq.${s}&tf=eq.${tf}&select=bars`) as { bars: number[][] }[])[0];
  const b = ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0 && x[2] > x[3]).sort((a, c) => a[0] - c[0]);
  if (b.length < +K.MIN_BARS) continue;
  let vs = 0, vn = 0; for (const x of b) { vs += (x[5] ?? 0) * x[4]; vn++; }
  loaded.push({ sym: s, b, vol: vn ? vs / vn : 0 });
}
assertNonEmpty(`${K.SET} names`, loaded, 5);
const use = K.SET === "liquid" ? loaded.sort((a, c) => c.vol - a.vol).slice(0, +K.TOPN) : loaded;
console.log(`==> D-919 CONFLUENCE — SET=${K.SET} tf=${tf}, ${use.length} names (median hourly $vol $${use[Math.floor(use.length/2)].vol.toLocaleString("en-US",{maximumFractionDigits:0})})`);
// collect per-K trades: for each bar with a net direction, agreement count = votes matching net sign
type Tr = { ts: number; ret: number; kk: number };
const trades: Tr[] = [];
for (const r of use) { const b = r.b; for (let i = N + 1; i + H + 1 < b.length; i++) {
  const v = votes(b, i); const sum = v.reduce((a, c) => a + c, 0); const dir = Math.sign(sum); if (!dir) continue;
  const agree = v.filter((x) => x === dir).length; // K in 1..4
  const e = b[i + 1][1], x = b[i + H + 1][1]; if (e <= 0 || x <= 0) continue;
  trades.push({ ts: b[i][0], ret: dir * Math.log(x / e), kk: agree });
} }
assertNonEmpty("trades", trades, 500);
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
const costs = K.COSTS.split(",").map(Number); const c0 = costs[0];
console.log(`  ceiling ${ceil.ceiling.toFixed(2)}; cost bar (liquid) = ${c0}bp round-trip\n`);
console.log(`  ${"K agree".padStart(7)} ${"trades".padStart(8)} ${"gross bp".padStart(9)} ${("net@"+c0+"bp").padStart(9)} ${"day-t".padStart(7)} ${"rand-pctl".padStart(9)}  ${"net@9/15".padStart(12)}`);
function cell(sub: Tr[], cost: number) {
  const day = new Map<number, number[]>(); const c = cost / 1e4;
  for (const t of sub) { const d = Math.floor(t.ts / 86400); (day.get(d) ?? day.set(d, []).get(d)!).push(t.ret - c); }
  return { net: mean(sub.map((t) => t.ret)) * 1e4 - cost, t: tstat([...day.values()].map(mean)), gross: mean(sub.map((t) => t.ret)) * 1e4 };
}
for (let kk = 1; kk <= 4; kk++) {
  const sub = trades.filter((t) => t.kk === kk); if (sub.length < 100) { console.log(`  ${String(kk).padStart(7)} ${String(sub.length).padStart(8)}   (<100 trades — UNTESTED)`); continue; }
  const s0 = cell(sub, c0);
  const draws: number[] = []; for (let d = 0; d < +K.DRAWS; d++) { let s = 0; for (const t of sub) s += (rnd() < 0.5 ? 1 : -1) * t.ret - c0 / 1e4; draws.push(s / sub.length); } draws.sort((a, b) => a - b);
  const pctl = 100 * draws.filter((x) => x < mean(sub.map((t) => t.ret)) - c0 / 1e4).length / draws.length;
  const n9 = cell(sub, costs[1] ?? c0).net, n15 = cell(sub, costs[2] ?? c0).net;
  console.log(`  ${String(kk).padStart(7)} ${String(sub.length).padStart(8)} ${s0.gross.toFixed(2).padStart(9)} ${s0.net.toFixed(2).padStart(9)} ${s0.t.toFixed(2).padStart(7)} ${pctl.toFixed(0).padStart(9)}  ${(n9.toFixed(1)+"/"+n15.toFixed(1)).padStart(12)}`);
}
// also cumulative K>=3 (the deploy test)
const hi3 = trades.filter((t) => t.kk >= 3);
if (hi3.length >= 100) { const s = cell(hi3, c0); const draws: number[] = []; for (let d = 0; d < +K.DRAWS; d++) { let acc = 0; for (const t of hi3) acc += (rnd() < 0.5 ? 1 : -1) * t.ret - c0 / 1e4; draws.push(acc / hi3.length); } draws.sort((a, b) => a - b); const pctl = 100 * draws.filter((x) => x < mean(hi3.map((t) => t.ret)) - c0 / 1e4).length / draws.length;
  console.log(`\n  K>=3 (deploy) ${hi3.length} trades: gross ${s.gross.toFixed(2)}bp  net@${c0}bp ${s.net.toFixed(2)}  day-t ${s.t.toFixed(2)}  rand-pctl ${pctl.toFixed(0)}`);
  console.log(`  DEPLOYABLE MULTI-FACTOR EDGE requires net>0 at ${c0}bp AND pctl>=95 AND day-t>=${ceil.ceiling.toFixed(2)}.`); }
await spendTrials({ rest: OWNED, headers: hdr, family: "confluence", runId: `${K.RUN_ID}-${K.SET}`, spent: 4 });
