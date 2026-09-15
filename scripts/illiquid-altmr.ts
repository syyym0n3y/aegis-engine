// D-918 — is the illiquid-alt conditional edge a deployable CLASS or the uncapturable illiquidity premium?
// D-917 found a class of alt x mean-reversion/breakout x session cells at random-percentile 100 with huge nominal edges,
// living in thin markets where 9bp cost is fiction. This selects the class on TRAIN, freezes it, and measures the
// equal-weight PORTFOLIO on TEST at escalating REALISTIC cost — the honest test of whether the edge survives the very
// illiquidity that creates it. Breadth across independent alts should lift the portfolio t far above any single cell.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("illiquid-altmr", [
  { name: "SETUP", def: "rangefade", note: "rangefade | breakout | momentum | trend" },
  { name: "SESSION", def: "asia", note: "asia | london | ny | all" },
  { name: "SPLIT", def: "2025-01-01" }, { name: "N", def: "20" }, { name: "H", def: "6" },
  { name: "COSTS", def: "9,20,40,60,100", note: "round-trip bp swept" }, { name: "DRAWS", def: "200" }, { name: "SEED", def: "20260915" },
  { name: "MIN_BARS", def: "2000" }, { name: "MIN_TR", def: "40", note: "min train trades for a name to be selectable" },
  { name: "RUN_ID", def: "D-918-illiquid-altmr-portfolio" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "im", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 && sd(a) > 0 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0;
let seed = +K.SEED >>> 0; const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const N = +K.N, H = +K.H, splitS = Date.parse(K.SPLIT + "T00:00:00Z") / 1000;
const inSess = (hr: number) => K.SESSION === "all" ? true : K.SESSION === "asia" ? hr < 7 : K.SESSION === "london" ? hr >= 7 && hr < 13 : hr >= 13 && hr < 21;
function sideOf(b: number[][], i: number): number {
  const hi = () => { let m = -Infinity; for (let k = i - N; k < i; k++) m = Math.max(m, b[k][2]); return m; };
  const lo = () => { let m = Infinity; for (let k = i - N; k < i; k++) m = Math.min(m, b[k][3]); return m; };
  if (K.SETUP === "rangefade") { const H2 = hi(), L2 = lo(); if (H2 <= L2) return 0; const p = (b[i][4] - L2) / (H2 - L2); return p > 0.9 ? -1 : p < 0.1 ? 1 : 0; }
  if (K.SETUP === "breakout") return b[i][4] > hi() ? 1 : b[i][4] < lo() ? -1 : 0;
  if (K.SETUP === "momentum") return i > N ? Math.sign(b[i][4] / b[i - N][4] - 1) : 0;
  let s = 0; for (let k = i - N + 1; k <= i; k++) s += b[k][4]; return Math.sign(b[i][4] - s / N);
}
const meta = (await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars >= +K.MIN_BARS);
type Name = { sym: string; trainTr: { ret: number }[]; testTr: { ts: number; ret: number }[]; vol: number };
const names: Name[] = [];
for (const m of meta) {
  const row = (await q(`trd_bars_intraday?symbol=eq.${m.symbol}&tf=eq.1hSF&select=bars`) as { bars: number[][] }[])[0];
  const b = ((row?.bars ?? []) as number[][]).filter((x) => x[4] > 0 && x[2] > x[3]).sort((a, c) => a[0] - c[0]);
  if (b.length < +K.MIN_BARS) continue;
  const trainTr: { ret: number }[] = [], testTr: { ts: number; ret: number }[] = []; let vsum = 0, vn = 0;
  for (let i = N + 1; i + H + 1 < b.length; i++) { const hr = new Date(b[i][0] * 1000).getUTCHours(); if (!inSess(hr)) continue; const side = sideOf(b, i); if (!side) continue; const e = b[i + 1][1], x = b[i + H + 1][1]; if (e <= 0 || x <= 0) continue; const r = side * Math.log(x / e); if (b[i][0] < splitS) trainTr.push({ ret: r }); else testTr.push({ ts: b[i][0], ret: r }); vsum += b[i][5] * b[i][4]; vn++; }
  if (trainTr.length >= +K.MIN_TR) names.push({ sym: m.symbol, trainTr, testTr, vol: vn ? vsum / vn : 0 });
}
assertNonEmpty(`${K.SETUP}/${K.SESSION} names`, names, 10);
// TRAIN selection: keep names with positive train mean return (pre-cost — cost is the sweep variable)
const sel = names.filter((n) => mean(n.trainTr.map((t) => t.ret)) > 0);
console.log(`==> D-918 ILLIQUID ALT ${K.SETUP.toUpperCase()} x ${K.SESSION} — ${names.length} names, ${sel.length} positive on TRAIN (<${K.SPLIT}), measured on TEST`);
if (sel.length < 10) { console.log(`  only ${sel.length} names selected on train — UNTESTED (need >= 10)`); Deno.exit(0); }
// TEST portfolio: pool all selected names' test trades, day-cluster across names
const allTest = sel.flatMap((n) => n.testTr);
assertNonEmpty("test trades", allTest, 500);
const volMed = [...sel.map((n) => n.vol)].sort((a, b) => a - b)[Math.floor(sel.length / 2)];
const liquid = sel.filter((n) => n.vol >= volMed);
console.log(`  test trades ${allTest.length}; median hourly $vol of selected ~$${(volMed).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
console.log(`\n  ${"cost bp".padStart(7)} ${"net bp/trade".padStart(12)} ${"day-t".padStart(7)} ${"rand-pctl".padStart(9)}   ${"liquid-half net".padStart(15)} ${"liq day-t".padStart(9)}`);
function portStats(trades: { ts: number; ret: number }[], costBp: number) {
  const c = costBp / 1e4; const day = new Map<number, number[]>();
  for (const t of trades) { const d = Math.floor(t.ts / 86400); (day.get(d) ?? day.set(d, []).get(d)!).push(t.ret - c); }
  const dayMeans = [...day.values()].map((v) => mean(v)); return { net: mean(trades.map((t) => t.ret)) * 1e4 - costBp, t: tstat(dayMeans), n: trades.length };
}
const liqTest = liquid.flatMap((n) => n.testTr);
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
let breakeven = "never";
for (const cS of K.COSTS.split(",")) {
  const cost = +cS; const ps = portStats(allTest, cost);
  // matched-random: shuffle each test trade's sign, keep timing (isolates timing skill of the mean-reversion rule)
  const draws: number[] = []; for (let d = 0; d < +K.DRAWS; d++) { let s = 0; for (const t of allTest) s += (rnd() < 0.5 ? 1 : -1) * t.ret - cost / 1e4; draws.push(s / allTest.length); } draws.sort((a, b) => a - b);
  const pctl = 100 * draws.filter((x) => x < mean(allTest.map((t) => t.ret)) - cost / 1e4).length / draws.length;
  const lq = portStats(liqTest, cost);
  if (breakeven === "never" && ps.t >= ceil.ceiling && ps.net > 0) breakeven = `${cost}bp`;
  console.log(`  ${cS.padStart(7)} ${ps.net.toFixed(2).padStart(12)} ${ps.t.toFixed(2).padStart(7)} ${pctl.toFixed(0).padStart(9)}   ${lq.net.toFixed(2).padStart(15)} ${lq.t.toFixed(2).padStart(9)}`);
}
await spendTrials({ rest: OWNED, headers: hdr, family: "illiquid-altmr", runId: `${K.RUN_ID}-${K.SETUP}-${K.SESSION}`, spent: K.COSTS.split(",").length });
console.log(`\n  ceiling ${ceil.ceiling.toFixed(2)}; portfolio clears the ceiling net-positive up to a round-trip cost of: ${breakeven}`);
console.log(`  VERDICT: the class is DEPLOYABLE at a real cost the coins do not exceed only if that breakeven is >= ~40bp; below that it is the illiquidity premium (real edge, uncapturable).`);
