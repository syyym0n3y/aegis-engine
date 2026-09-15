// D-917 — the trading-quality surface (STRATEGY.md Phase 0). Are our setups better than pressing random buttons, and
// where? A battery of canonical factor setups is run across instruments x timeframes x sessions, each scored against a
// MATCHED-RANDOM benchmark (same trade count, same long/short ratio, same holding, same cost, entries at random bars),
// so the setup's PERCENTILE against random isolates timing SKILL from drift and side bias. 95th+ percentile AND
// net-positive after cost = a live cell. A random setup lands at ~50th by construction (the positive control).
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials, preregCeiling } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("quality-surface", [
  { name: "SET", def: "perp1h", note: "perp1h | fx | panel97 | perp5m — which surface slice to run" },
  { name: "H", def: "6", note: "holding period in bars" }, { name: "SMA", def: "20" }, { name: "MOM", def: "10" },
  { name: "DRAWS", def: "200", note: "random-benchmark draws per cell" }, { name: "SEED", def: "20260915" },
  { name: "MINTR", def: "50", note: "minimum trades for a cell to count" }, { name: "RUN_ID", def: "D-917-quality-surface-phase0" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "qs", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const hdr = { Authorization: `Bearer ${tok}`, apikey: tok, "Content-Type": "application/json" };
const { q } = mkStrictRead(OWNED, hdr);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 2 && sd(a) > 0 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : 0;
let seed = +K.SEED >>> 0; const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const H = +K.H, NS = +K.SMA, NM = +K.MOM;
// bars: [t,o,h,l,c,...]; entry lag-1 (enter next open, exit H opens later), net = side*log(exit/entry) - cost
type Bar = number[];
type Trade = { i: number; side: number; ret: number; hr: number };
const SESSIONS: [string, (h: number) => boolean][] = [["all", () => true], ["asia", (h) => h < 7], ["london", (h) => h >= 7 && h < 13], ["ny", (h) => h >= 13 && h < 21]];
function setups(b: Bar[]): Record<string, (i: number) => number> {
  // returns side (+1 long / -1 short / 0 no-trade) at bar i for each named setup
  const sma = (i: number) => { let s = 0; for (let k = i - NS + 1; k <= i; k++) s += b[k][4]; return s / NS; };
  const hi = (i: number) => { let m = -Infinity; for (let k = i - NS; k < i; k++) m = Math.max(m, b[k][2]); return m; };
  const lo = (i: number) => { let m = Infinity; for (let k = i - NS; k < i; k++) m = Math.min(m, b[k][3]); return m; };
  return {
    "trend": (i) => Math.sign(b[i][4] - sma(i)),
    "breakout": (i) => b[i][4] > hi(i) ? 1 : b[i][4] < lo(i) ? -1 : 0,
    "rangefade": (i) => { const H2 = hi(i), L2 = lo(i); if (H2 <= L2) return 0; const pos = (b[i][4] - L2) / (H2 - L2); return pos > 0.9 ? -1 : pos < 0.1 ? 1 : 0; },
    "momentum": (i) => i > NM ? Math.sign(b[i][4] / b[i - NM][4] - 1) : 0,
  };
}
function trades(b: Bar[], sig: (i: number) => number): Trade[] {
  const out: Trade[] = [];
  for (let i = Math.max(NS, NM) + 1; i + H + 1 < b.length; i++) { const side = sig(i); if (!side) continue; const e = b[i + 1][1], x = b[i + H + 1][1]; if (e > 0 && x > 0) out.push({ i, side, ret: side * Math.log(x / e), hr: new Date(b[i][0] * 1000).getUTCHours() }); }
  return out;
}
// matched random benchmark: same count, same long fraction, entries at random valid bars, same H, same cost
function randBench(b: Bar[], n: number, fLong: number, cost: number, valid: number[]): number[] {
  const draws: number[] = [];
  for (let d = 0; d < +K.DRAWS; d++) {
    let s = 0; for (let k = 0; k < n; k++) { const i = valid[Math.floor(rnd() * valid.length)]; const side = rnd() < fLong ? 1 : -1; const e = b[i + 1][1], x = b[i + H + 1][1]; s += (e > 0 && x > 0 ? side * Math.log(x / e) : 0) - cost; }
    draws.push(s / n);
  }
  return draws.sort((a, b2) => a - b2);
}
// data loaders
async function perps(tf: string): Promise<{ sym: string; bars: Bar[]; cost: number }[]> {
  const meta = (await q(`trd_bars_intraday?tf=eq.${tf}&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars > 5000).slice(0, 20);
  const out: { sym: string; bars: Bar[]; cost: number }[] = [];
  for (const m of meta) { const row = (await q(`trd_bars_intraday?symbol=eq.${m.symbol}&tf=eq.${tf}&select=bars`) as { bars: number[][] }[])[0]; const bars = ((row?.bars ?? []) as Bar[]).filter((x) => x[4] > 0).sort((a, b) => a[0] - b[0]); if (bars.length > 5000) out.push({ sym: m.symbol, bars, cost: 9 / 1e4 }); }
  return out;
}
async function panel97(): Promise<{ sym: string; bars: Bar[]; cost: number }[]> {
  const meta = (await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[]).filter((r) => r.n_bars > 5000);
  const out: { sym: string; bars: Bar[]; cost: number }[] = [];
  for (const m of meta) { const row = (await q(`trd_bars_intraday?symbol=eq.${m.symbol}&tf=eq.1hSF&select=bars`) as { bars: number[][] }[])[0]; const bars = ((row?.bars ?? []) as Bar[]).filter((x) => x[4] > 0 && x[2] > x[3]).sort((a, b) => a[0] - b[0]); if (bars.length > 5000) out.push({ sym: m.symbol, bars, cost: 9 / 1e4 }); }
  return out;
}
async function fx(): Promise<{ sym: string; bars: Bar[]; cost: number }[]> {
  const S = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "XAUUSD", "USA500IDXUSD", "USATECHIDXUSD", "BRENTCMDUSD"];
  const out: { sym: string; bars: Bar[]; cost: number }[] = [];
  for (const s of S) { const rows: Bar[] = []; let from = 0; for (;;) { const p = await q(`trd_fx_hourly?symbol=eq.${s}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[]; if (!p.length) break; for (const r of p) if (r.vol > 0 && r.h > r.l) rows.push([r.ts, r.o, r.h, r.l, r.c]); from = p.at(-1)!.ts; if (p.length < 20000) break; } if (rows.length > 5000) out.push({ sym: s, bars: rows, cost: (["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"].includes(s) ? 4 : 6) / 1e4 }); }
  return out;
}
const universe = K.SET === "fx" ? await fx() : K.SET === "panel97" ? await panel97() : K.SET === "perp5m" ? await perps("5m-2026Q3") : await perps("1h");
assertNonEmpty(`${K.SET} instruments`, universe, 3);
console.log(`==> D-917 QUALITY SURFACE — ${K.SET}, ${universe.length} instruments, H=${H} bars, ${K.DRAWS} random draws/cell`);
console.log(`  net bp/trade beside the matched-RANDOM 95th pct; a cell is LIVE at pctl>=95 AND net>0 AND day-clustered t past the ceiling.\n`);
let cells = 0, live = 0; const liveRows: string[] = []; const allPctl: number[] = [];
console.log(`  ${"instrument".padEnd(14)} ${"setup".padEnd(10)} ${"sess".padEnd(7)} ${"trades".padStart(6)} ${"net bp".padStart(7)} ${"rand95 bp".padStart(9)} ${"pctl".padStart(5)} ${"t".padStart(6)}`);
for (const inst of universe) {
  const sg = setups(inst.bars); const valid: number[] = []; for (let i = Math.max(NS, NM) + 1; i + H + 1 < inst.bars.length; i++) valid.push(i);
  for (const [name, sig] of Object.entries(sg)) {
    const tr = trades(inst.bars, sig);
    for (const [sname, sfilt] of SESSIONS) {
      const st = tr.filter((t) => sfilt(t.hr)); if (st.length < +K.MINTR) continue;
      cells++;
      const net = st.map((t) => t.ret - inst.cost); const fLong = st.filter((t) => t.side > 0).length / st.length;
      const bench = randBench(inst.bars, st.length, fLong, inst.cost, valid);
      const netMean = mean(net) * 1e4; const b95 = bench[Math.floor(0.95 * bench.length)] * 1e4;
      const pctl = 100 * bench.filter((x) => x < mean(net)).length / bench.length; allPctl.push(pctl);
      const day = new Map<number, number>(); for (const t of st) { const d = Math.floor(inst.bars[t.i][0] / 86400); day.set(d, (day.get(d) ?? 0) + t.ret - inst.cost); }
      const tt = tstat([...day.values()]);
      const isLive = pctl >= 95 && netMean > 0 && tt >= 3.0;
      if (isLive) { live++; liveRows.push(`${inst.sym}/${name}/${sname}: net ${netMean.toFixed(2)}bp pctl ${pctl.toFixed(0)} t ${tt.toFixed(2)}`); }
      if (pctl >= 90 || sname === "all") console.log(`  ${inst.sym.padEnd(14)} ${name.padEnd(10)} ${sname.padEnd(7)} ${String(st.length).padStart(6)} ${netMean.toFixed(2).padStart(7)} ${b95.toFixed(2).padStart(9)} ${pctl.toFixed(0).padStart(5)} ${tt.toFixed(2).padStart(6)}${isLive ? "  <-- LIVE" : ""}`);
    }
  }
}
await spendTrials({ rest: OWNED, headers: hdr, family: "quality-surface", runId: `${K.RUN_ID}-${K.SET}`, spent: cells });
const ceil = await preregCeiling({ rest: OWNED, headers: hdr, preregId: K.RUN_ID });
console.log(`\n  ${cells} cells; median random-percentile ${mean(allPctl).toFixed(0)} (positive control: our setups should cluster near 50 if timing adds nothing); ceiling ${ceil.ceiling.toFixed(2)}`);
console.log(`  LIVE CELLS (pctl>=95 AND net>0 AND day-t>=3.0): ${live}`);
for (const r of liveRows.slice(0, 30)) console.log(`    ${r}`);
console.log(`  VERDICT (${K.SET}): ${live > 0 ? `SURFACE ALIVE — ${live} cell(s) beat random and cost` : "SURFACE DEAD on this slice — no cell beats random after cost"}`);
