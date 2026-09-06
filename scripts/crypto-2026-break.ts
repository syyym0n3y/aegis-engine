#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// crypto-2026-break.ts (D-806) — DESCRIPTIVE ONLY decomposition of the 2026 sign flip (THE MECHANISM LAW: no story is
// claimed; this states WHERE the flip lives, so a mechanism can be pre-registered later if one is worth registering).
//
// The record: four constructions flipped sign in 2026 — persist(real) K24 (t 2.97 -> -3.01), rvol-hi (t 7.86 -> flip),
// and two of the three hourly-sweep clocks on the 97-panel (D-782). Two live clocks depend on whether that is a regime
// or a decay. This reproduces the registered constructions EXACTLY (the D-782 cells; the scorer's persist-real rule, here
// on the 97-panel's own taker field) and splits 2026 against 2024-25 by: symbol tier (BTC/ETH | top-10 $vol | rest),
// funding regime at the event (last 8h funding rate sign), trailing-30d realized-vol tercile, BTC's prior-24h sign,
// and the unconditional hourly drift profile by year — did the intraday seasonality itself move?
// Trials: 4 constructions x 5 splits = 20, spent (a split is a specification even when nothing is chosen from it).
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";
const K = declareKnobs("crypto-2026-break", [
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "FROM", def: "2024-01-01", note: "prior era start (panel begins 2023-08-30)" },
  { name: "MIN_BARS", def: "5000" }, { name: "RUN_ID", def: "D-806-crypto-2026-break" },
]);
const KK = 6, RT = Number(K.CRYPTO_RT_BP) / 1e4, FROM_TS = Math.floor(Date.parse(K.FROM + "T00:00:00Z") / 1000);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "c26", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { "Content-Type": "application/json", Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
type XBar = Bar & { taker: number; delta: number };
const utcDayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const prevDayKey = (k: string) => { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => a.length > 1 ? mean(a) / ((sd(a) / Math.sqrt(a.length)) || 1e-12) : 0;
const bp = (x: number) => (x * 1e4).toFixed(2);

// 1. panel + BTC reference + funding
const meta = await q(`trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc`) as { symbol: string; n_bars: number }[];
const syms = meta.filter((m) => m.n_bars >= +K.MIN_BARS).map((m) => m.symbol);
assertNonEmpty("97-panel symbols", syms, 50);
async function load(sym: string): Promise<XBar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1hSF&select=bars`))[0];
  return ((row?.bars || []) as number[][]).filter((b) => Array.isArray(b) && b.length >= 8 && b[5] > 0).map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], taker: b[7], delta: b[7] - 0.5 * b[5] })).sort((a, b) => a.ts - b.ts);
}
const btc = await load("BTCUSDT"); assertNonEmpty("BTC bars", btc, 5000);
const btcIdx = new Map<number, number>(); btc.forEach((b, i) => btcIdx.set(b.ts, i));
const btcPrior24 = (ts: number) => { const i = btcIdx.get(ts); return i != null && i >= 24 ? Math.log(btc[i].c / btc[i - 24].c) : NaN; };
async function funding(sym: string): Promise<{ ts: number; r: number }[]> {
  const rows = await q(`trd_perp_oi?symbol=eq.${sym}&interval=eq.funding&select=ts,open_interest&order=ts.asc&limit=20000`) as { ts: number; open_interest: number }[];
  return rows.map((r) => ({ ts: r.ts, r: r.open_interest }));
}
const lastFunding = (f: { ts: number; r: number }[], ts: number) => { let lo = 0, hi = f.length; while (lo < hi) { const m = (lo + hi) >> 1; if (f[m].ts <= ts) lo = m + 1; else hi = m; } return lo > 0 ? f[lo - 1].r : NaN; };

// 2. events with attributes
type Ev = { cell: string; sym: string; yr: number; net: number; hr: number; tier: string; fund: string; rv: number; btcp: string };
const evs: Ev[] = []; const hourly: { yr: number; hr: number; r: number }[] = [];
const dollarVol2025 = new Map<string, number>();
const CELLS = [
  { name: "utc01-sweepPDL-reclaim-LONG", check: (b: Bar, h: number, _pdh: number, pdl: number) => h === 1 && b.l < pdl && b.c >= pdl },
  { name: "utc09to10-belowPDL-LONG", check: (b: Bar, h: number, _pdh: number, pdl: number) => (h === 9 || h === 10) && b.c < pdl },
  { name: "utc16-abovePDH-LONG", check: (b: Bar, h: number, pdh: number, _pdl: number) => h === 16 && b.c > pdh },
];
let loaded = 0;
for (const sym of syms) {
  const bars = sym === "BTCUSDT" ? btc : await load(sym); if (bars.length < +K.MIN_BARS) continue;
  const f = await funding(sym);
  // tier input: 2025 mean hourly $ volume
  const dv25 = bars.filter((b) => b.ts >= 1735689600 && b.ts < 1767225600).map((b) => b.c * b.v); dollarVol2025.set(sym, mean(dv25));
  // day levels
  const dl = new Map<string, { hi: number; lo: number }>();
  for (const b of bars) { const k = utcDayKey(b.ts); const c = dl.get(k); if (!c) dl.set(k, { hi: b.h, lo: b.l }); else { c.hi = Math.max(c.hi, b.h); c.lo = Math.min(c.lo, b.l); } }
  // delta z on trailing 200 (scorer rule) + PSL
  const N = 200; const dz = new Array(bars.length).fill(0);
  let sum = 0, sum2 = 0; for (let i = 0; i < bars.length; i++) { const d = bars[i].delta; if (i >= N) { const m = sum / N, v = sum2 / N - m * m; const s_ = Math.sqrt(Math.max(0, v) * N / (N - 1)); dz[i] = s_ > 0 ? (d - m) / s_ : 0; sum -= bars[i - N].delta; sum2 -= bars[i - N].delta ** 2; } sum += d; sum2 += d * d; }
  const psl = priorSessionLevels(bars as Bar[]);
  // trailing 30d realized vol (hourly log returns, 720 bars)
  const lr = bars.map((b, i) => i ? Math.log(b.c / bars[i - 1].c) : 0);
  const rv = new Array(bars.length).fill(NaN); let s1 = 0, s2 = 0; for (let i = 1; i < bars.length; i++) { s1 += lr[i]; s2 += lr[i] * lr[i]; if (i > 720) { s1 -= lr[i - 720]; s2 -= lr[i - 720] ** 2; } if (i >= 720) { const m = s1 / 720; rv[i] = Math.sqrt(Math.max(0, s2 / 720 - m * m)) * Math.sqrt(24 * 365); } }
  for (let i = 25; i < bars.length - 25; i++) {
    const b = bars[i]; if (b.ts < FROM_TS) continue;
    const yr = new Date(b.ts * 1000).getUTCFullYear(), hr = new Date(b.ts * 1000).getUTCHours();
    hourly.push({ yr, hr, r: lr[i + 1] });                                  // drift of the NEXT hour, by hour-of-day
    const pd = dl.get(prevDayKey(utcDayKey(b.ts))); const fr = lastFunding(f, b.ts); const bp24 = btcPrior24(b.ts);
    const attrs = { sym, yr, hr, tier: "", fund: Number.isFinite(fr) ? (fr > 0 ? "fund>0" : "fund<=0") : "fund?", rv: rv[i], btcp: Number.isFinite(bp24) ? (bp24 >= 0 ? "btc24+" : "btc24-") : "btc?" };
    if (pd) { const fwd = Math.log(bars[i + KK].c / b.c); for (const c of CELLS) if (c.check(b, hr, pd.hi, pd.lo)) evs.push({ cell: c.name, net: fwd - RT, ...attrs }); }
    if (i >= N && i + 25 < bars.length) { const L = psl[i]; if (L && i > L.fromLastIndex && b.c < L.low) { const w = [dz[i - 2], dz[i - 1], dz[i]]; if (w.every((z) => z >= 1) || w.every((z) => z <= -1)) { const entry = bars[i + 1].o; if (entry > 0) evs.push({ cell: "persist-real-K24 (PSL-fade)", net: Math.log(bars[i + 1 + 24].c / entry) - RT, ...attrs }); } } }
  }
  loaded++; if (loaded % 20 === 0) console.error(`  loaded ${loaded}`);
}
assertNonEmpty("events", evs, 1000);
// tiers by 2025 $ volume rank
const ranked = [...dollarVol2025.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
const tierOf = (s: string) => (s === "BTCUSDT" || s === "ETHUSDT") ? "BTC/ETH" : ranked.indexOf(s) < 10 ? "top-10 $vol" : "rest";
for (const e of evs) e.tier = tierOf(e.sym);
const rvs = evs.map((e) => e.rv).filter(Number.isFinite).sort((a, b) => a - b); const t1 = rvs[Math.floor(rvs.length / 3)], t2 = rvs[Math.floor(2 * rvs.length / 3)];
const rvTer = (x: number) => !Number.isFinite(x) ? "rv?" : x < t1 ? "rv-low" : x < t2 ? "rv-mid" : "rv-high";

const T = await spendTrials({ rest: OWNED, headers: hdr, family: "crypto-2026-break", runId: K.RUN_ID, spent: 20 });
console.log(`\n==> CRYPTO 2026 BREAK — DESCRIPTIVE ONLY (D-806). ${loaded} perps, ${evs.length.toLocaleString()} events, prior era ${K.FROM}..2025 vs 2026. Ceiling ${T.ceiling.toFixed(4)} at N=${T.N.toLocaleString()}`);
console.log(`    net of ${K.CRYPTO_RT_BP}bp; every cell is the registered construction; nothing is selected from these tables.`);
const cellsAll = [...new Set(evs.map((e) => e.cell))];
const line = (label: string, prior: number[], cur: number[]) => console.log(`      ${label.padEnd(14)} 2024-25: n ${String(prior.length).padStart(6)} ${bp(mean(prior)).padStart(8)}bp t ${tstat(prior).toFixed(2).padStart(6)}   |   2026: n ${String(cur.length).padStart(5)} ${bp(mean(cur)).padStart(8)}bp t ${tstat(cur).toFixed(2).padStart(6)}   Δ ${bp(mean(cur) - mean(prior)).padStart(8)}bp`);
const out: Record<string, unknown> = {};
for (const cell of cellsAll) {
  const E = evs.filter((e) => e.cell === cell); const P = E.filter((e) => e.yr < 2026), C = E.filter((e) => e.yr === 2026);
  console.log(`\n  ${cell}`);
  console.log(`    by year: ` + [2024, 2025, 2026].map((y) => { const x = E.filter((e) => e.yr === y).map((e) => e.net); return `${y} n ${x.length} ${bp(mean(x))}bp t ${tstat(x).toFixed(2)}`; }).join(" | "));
  const rec: Record<string, unknown> = {};
  for (const [split, key] of [["tier", (e: Ev) => e.tier], ["funding", (e: Ev) => e.fund], ["rvol", (e: Ev) => rvTer(e.rv)], ["btc prior 24h", (e: Ev) => e.btcp]] as [string, (e: Ev) => string][]) {
    console.log(`    ${split}:`);
    const cats = [...new Set(E.map(key))].sort();
    for (const c of cats) { const p = P.filter((e) => key(e) === c).map((e) => e.net), u = C.filter((e) => key(e) === c).map((e) => e.net); line(c, p, u); rec[`${split}:${c}`] = { nP: p.length, mP: mean(p), tP: tstat(p), nC: u.length, mC: mean(u), tC: tstat(u) }; }
  }
  out[cell] = rec;
}
console.log(`\n  UNCONDITIONAL hourly drift (next-hour log return by UTC hour, pooled over ${loaded} perps, bp):`);
console.log(`    hour   ` + [2024, 2025, 2026].map((y) => String(y).padStart(12)).join(""));
for (let h = 0; h < 24; h++) {
  const cols = [2024, 2025, 2026].map((y) => { const x = hourly.filter((r) => r.yr === y && r.hr === h).map((r) => r.r); return `${bp(mean(x)).padStart(7)} t${tstat(x).toFixed(1).padStart(5)}`; });
  const mark = [1, 9, 10, 16, 17, 18, 19, 20, 21].includes(h) ? " <" : "";
  console.log(`    ${String(h).padStart(2)}:00  ${cols.join("  ")}${mark}`);
}
console.log(`\n  DESCRIPTIVE ONLY — no mechanism is claimed; a story about any row above needs a PREREG before it is admissible (D-597).`);
console.log(`  RESULT_JSON ${JSON.stringify(out)}`);
