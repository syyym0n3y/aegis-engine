#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-funding-regime.ts (D-770) — CLOSING the D-769 #7 UNTESTED gap. Funding IS held (ingest-funding-full.ts writes
// Binance funding rates into trd_perp_oi with interval='funding', 8h cadence; the tiny numeric values are the actual
// fractional funding rate per period, not a broken OI scale). Coverage from 2021-01-01 forward on the surviving crypto.
//
// Question: does funding regime CONDITION the D-768 persist(real)+PSL-sweep fade K24 signal? A high positive funding
// rate means the perp trades above spot and longs pay shorts — a crowded-long regime. If the D-768 fade (long the
// dip) works because the bearish sweep is exhausted short pressure, we'd expect the fade to be STRONGER when funding
// is EXTREMELY NEGATIVE (shorts overpaying, "everyone short at the bottom"). Testing on the surviving cell.
//
// Cells: funding percentile bucket (trailing 90 periods = 30 days) of the CONCURRENT funding period for the event's
// symbol. Q1 = most-negative-funding-in-recent-window (shorts crowded); Q5 = most-positive (longs crowded).
// SELECTION LAW: full grid printed, every quintile a counted trial. Also: TRUE OI is not held intraday, only the
// `basis_ann` interval (annualised basis) exists — the OI gap remains; funding closes.
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-funding-regime", [
  { name: "MIN_EVENTS", def: "50" }, { name: "CLIMAX_N", def: "200" }, { name: "PERSIST", def: "3" },
  { name: "DELTA_Z_HI", def: "1.0" }, { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "FUND_WIN", def: "90", note: "trailing funding periods (8h each) for percentile bucketing = ~30 days" },
]);
const KK = 24, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const CLIMAX_N = Number(K.CLIMAX_N), PERSIST = Number(K.PERSIST), DZ_HI = Number(K.DELTA_Z_HI);
const MIN_EVENTS = Number(K.MIN_EVENTS), FW = Number(K.FUND_WIN);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mfr", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
interface RichBar extends Bar { taker: number; delta: number; deltaZ: number }
async function loadCrypto(sym: string): Promise<RichBar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = (row?.bars || []);
  const arr = raw.filter((b) => Array.isArray(b) && b.length >= 8 && b[5] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], taker: b[7], delta: b[7] - 0.5 * b[5], deltaZ: 0 } as RichBar))
    .sort((a, b) => a.ts - b.ts);
  for (let i = CLIMAX_N; i < arr.length; i++) {
    let m = 0; for (let j = i - CLIMAX_N; j < i; j++) m += arr[j].delta; m /= CLIMAX_N;
    let s2 = 0; for (let j = i - CLIMAX_N; j < i; j++) s2 += (arr[j].delta - m) ** 2;
    const sd = Math.sqrt(s2 / (CLIMAX_N - 1));
    arr[i].deltaZ = sd > 0 ? (arr[i].delta - m) / sd : 0;
  }
  return arr;
}
async function loadFunding(sym: string): Promise<{ ts: number; rate: number }[]> {
  const rows = await q(`trd_perp_oi?symbol=eq.${sym}&venue=eq.binance&interval=eq.funding&select=ts,open_interest&order=ts.asc`) as { ts: number; open_interest: number }[];
  return rows.map((r) => ({ ts: r.ts, rate: r.open_interest }));
}

const CBARS = new Map<string, RichBar[]>();
const FUND = new Map<string, { ts: number; rate: number }[]>();
for (const s of CRYPTO) { CBARS.set(s, await loadCrypto(s)); FUND.set(s, await loadFunding(s)); }
for (const s of CRYPTO) {
  assertNonEmpty(`bars ${s}`, CBARS.get(s)!, 5000);
  assertNonEmpty(`funding ${s}`, FUND.get(s)!, 500);
}

// POSITIVE CONTROL: funding series values in a plausible range (-0.01, +0.01) per 8h; funding cadence ~8h
{
  const btc = FUND.get("BTCUSDT")!;
  const gaps: number[] = [];
  for (let i = 1; i < btc.length; i++) gaps.push(btc[i].ts - btc[i - 1].ts);
  gaps.sort((a, b) => a - b);
  const medGapH = gaps[Math.floor(gaps.length / 2)] / 3600;
  const rMin = Math.min(...btc.map((x) => x.rate)), rMax = Math.max(...btc.map((x) => x.rate));
  console.log(`==> MTF FUNDING REGIME — closing D-769 #7 UNTESTED on the D-768 persist(real) K24 cell`);
  console.log(`  POSITIVE CONTROL — BTC funding: ${btc.length} rows, median gap ${medGapH.toFixed(1)}h (expect ~8),`);
  console.log(`    range ${(rMin * 1e4).toFixed(1)}bp .. ${(rMax * 1e4).toFixed(1)}bp per 8h (expect roughly -50..+50bp)`);
  if (medGapH < 6 || medGapH > 12 || Math.abs(rMin) > 0.05 || Math.abs(rMax) > 0.05) {
    console.error(`!! funding sanity failed — check field mapping / scale.`); Deno.exit(1);
  }
}

// funding-percentile lookup: given (sym, ts), find the concurrent funding period's rate and its percentile within
// the trailing FW periods. asof: last funding period with ts <= event ts.
function fundInfo(sym: string, evTs: number): { rate: number; pct: number } | null {
  const arr = FUND.get(sym)!;
  // binary search greatest ts <= evTs
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].ts <= evTs) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < FW) return null;
  const cur = arr[best].rate;
  let rk = 0;
  for (let j = best - FW; j < best; j++) if (arr[j].rate < cur) rk++;
  return { rate: cur, pct: rk / FW };
}

interface Evt {
  symbol: string; ts: number; train: boolean; net: number;   // K24 close net
  fundRate: number; fundPct: number;                          // asof concurrent 8h funding period
}
const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const [sym, bars] of CBARS) {
  const psl = priorSessionLevels(bars);
  for (let i = CLIMAX_N; i < bars.length - KK - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(bars[i].c < lvl.low)) continue;
    const win = [bars[i - 2].deltaZ, bars[i - 1].deltaZ, bars[i].deltaZ];
    const persist = win.every((z) => z >= DZ_HI) || win.every((z) => z <= -DZ_HI);
    if (!persist) continue;
    const entry = bars[i + 1].o; if (!(entry > 0)) continue;
    const net = Math.log(bars[i + 1 + KK].c / entry) - rt;
    const f = fundInfo(sym, bars[i].ts);
    if (!f) continue;                                          // no funding coverage yet
    events.push({ symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, net, fundRate: f.rate, fundPct: f.pct });
  }
}
console.log(`  events with funding coverage: ${events.length} (D-768 cell size was 835; funding starts 2021-01-01 + FW window)`);

function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  return { n, mean: m, t: s2 > 0 ? m / (Math.sqrt(s2) / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

// TABLE 1: base (funding-covered) reproduction
const base = stats(events.filter((e) => !e.train).map((e) => e.net));
console.log(`\n  === BASELINE ON FUNDING-COVERED SUBSET ===`);
console.log(`    OOS n ${base.n} / mean ${bp(base.mean)}bp / t ${base.t.toFixed(2)}   (D-768 pooled reported 57.51bp t 2.59 on n=456; funding excludes 2021+FW months so n < 456)`);

// TABLE 2: funding quintiles (Q1=most-negative funding, Q5=most-positive) + specific "extreme" cells
const CELLS: Array<{ name: string; fn: (e: Evt) => boolean }> = [
  { name: "Q1 fund<=20pct (shorts crowded)", fn: (e) => e.fundPct <= 0.2 },
  { name: "Q2 20-40pct", fn: (e) => e.fundPct > 0.2 && e.fundPct <= 0.4 },
  { name: "Q3 40-60pct", fn: (e) => e.fundPct > 0.4 && e.fundPct <= 0.6 },
  { name: "Q4 60-80pct", fn: (e) => e.fundPct > 0.6 && e.fundPct <= 0.8 },
  { name: "Q5 fund>=80pct (longs crowded)", fn: (e) => e.fundPct > 0.8 },
  { name: "fundRate<0 (backwardation)", fn: (e) => e.fundRate < 0 },
  { name: "fundRate>=0 (contango)", fn: (e) => e.fundRate >= 0 },
  { name: "fundRate<-5bp/8h (extreme neg)", fn: (e) => e.fundRate < -5e-4 },
  { name: "fundRate>+10bp/8h (extreme pos)", fn: (e) => e.fundRate > 10e-4 },
];
let TRIALS = 0;
console.log(`\n  === POOLED OOS BY FUNDING BUCKET — each row a trial ===`);
console.log(`    cell                                     test n / mean / t     sign +/tested`);
for (const c of CELLS) {
  TRIALS++;
  const te = stats(events.filter((e) => !e.train && c.fn(e)).map((e) => e.net));
  let pos = 0, tested = 0;
  for (const s of CRYPTO) {
    const xs = events.filter((e) => e.symbol === s && !e.train && c.fn(e)).map((e) => e.net);
    if (xs.length < 20) continue;
    tested++;
    if (stats(xs).mean > 0) pos++;
  }
  const flag = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 ? "  +OOS" : "";
  console.log(`    ${c.name.padEnd(40)} ${String(te.n).padStart(5)} / ${bp(te.mean).padStart(7)} / ${te.t.toFixed(2).padStart(6)}     ${pos}/${tested}${flag}`);
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-funding-regime", runId: `mfr|${K.SPLIT}`, spent: TRIALS });
console.log(`\n  ================================ VERDICT ================================`);
console.log(`  Funding coverage held (Binance funding since 2021-01, 8h cadence). #7 is now MEASURED, not UNTESTED.`);
console.log(`  TRUE intraday OI remains not held (trd_perp_oi has only 'basis_ann' interval for BTC) — that gap persists.`);
console.log(`  Program ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()} (added ${TRIALS} trials).`);
