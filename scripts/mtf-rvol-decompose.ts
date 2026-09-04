#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-rvol-decompose.ts (D-777) — the four decomposition tests I promised in D-776 before any pre-registration.
// D-776 found: PSL downside sweep + rvol-hi (bar vol >= 1.5x same-hour-of-day trailing median) -> fade LONG K24,
// on 17-instrument mixed panel (10 crypto + 3 idx + 4 FX) gives OOS n 31852, +19.12bp, t 7.86, sign 12/17 —
// nominally clearing the 5.46 ceiling. Before ANY pre-registration this must survive:
//   (D1) PER-ASSET-CLASS breakdown — is the effect universal or driven by one class?
//   (D2) SIGN-LOSER identification — which 5 of 17 instruments are negative, and are they one class?
//   (D3) rvol THRESHOLD SENSITIVITY — the 1.5x threshold is inherited; does 1.3/1.7/2.0 give consistent signs?
//   (D4) ERA STABILITY — is the OOS pooled t carried by one year, or steady across 2023/2024/2025/2026?
// If all four survive, D-776 becomes a candidate for operator-signed pre-registration. If any fails,
// D-776 joins the honest catalogue.
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-rvol-decompose", [
  { name: "MIN_EVENTS", def: "50" }, { name: "CRYPTO_RT_BP", def: "7" }, { name: "IDX_RT_BP", def: "4" },
  { name: "FX_RT_BP", def: "2" }, { name: "SPLIT", def: "2023-01-01" },
]);
const KK = 24, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mrd7", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const CRYPTO = ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"];
const FX = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"];
interface Inst { symbol: string; klass: "crypto" | "idx" | "fx"; rt: number; bars: Bar[] }

async function loadCrypto(sym: string): Promise<Bar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  return ((row?.bars || []) as number[][])
    .filter((b) => Array.isArray(b) && b.length >= 6 && b[5] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }))
    .sort((a, b) => a.ts - b.ts);
}
async function loadFx(sym: string): Promise<Bar[]> {
  const rows = await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.asc`) as
    { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }));
}
function hourRelVol(bars: Bar[]): number[] {
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  const out = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const h = new Date(bars[i].ts * 1000).getUTCHours();
    const win = byHour[h];
    if (win.length >= 10) {
      const s = [...win.slice(-30)].sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)];
      if (med > 0) out[i] = bars[i].v / med;
    }
    win.push(bars[i].v);
  }
  return out;
}

const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", rt: Number(K.CRYPTO_RT_BP), bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", rt: Number(K.IDX_RT_BP), bars: await loadFx(s) });
for (const s of FX) insts.push({ symbol: s, klass: "fx", rt: Number(K.FX_RT_BP), bars: await loadFx(s) });
for (const inst of insts) assertNonEmpty(`bars ${inst.symbol}`, inst.bars, 3000);

interface Evt {
  symbol: string; klass: string; ts: number; train: boolean; net: number; rvol: number; year: number;
}
const events: Evt[] = [];
for (const inst of insts) {
  const psl = priorSessionLevels(inst.bars);
  const rv = hourRelVol(inst.bars);
  const rt = inst.rt / 1e4;
  for (let i = 30; i < inst.bars.length - KK - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(inst.bars[i].c < lvl.low)) continue;
    if (isNaN(rv[i])) continue;
    const entry = inst.bars[i + 1].o; if (!(entry > 0)) continue;
    const net = Math.log(inst.bars[i + 1 + KK].c / entry) - rt;
    events.push({
      symbol: inst.symbol, klass: inst.klass, ts: inst.bars[i].ts, train: inst.bars[i].ts < SPLIT_TS,
      net, rvol: rv[i], year: new Date(inst.bars[i].ts * 1000).getUTCFullYear(),
    });
  }
}
function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

console.log(`==> MTF RVOL DECOMPOSE — D-776 four survival tests`);
console.log(`  events: ${events.length}   test window from ${K.SPLIT}`);

// baseline reproduction
const rvolHi = (e: Evt) => e.rvol >= 1.5;
{
  const te = events.filter((e) => !e.train && rvolHi(e));
  const s = stats(te.map((e) => e.net));
  console.log(`\n  BASELINE (rvol>=1.5, K24, all 17 instruments, OOS): n ${s.n} / ${bp(s.mean)}bp / t ${s.t.toFixed(2)}   (D-776 reported n 31852 / 19.12 / 7.86)`);
}

// D1 per-asset-class breakdown
console.log(`\n  D1 PER-ASSET-CLASS BREAKDOWN (OOS, rvol>=1.5, K24):`);
for (const cls of ["crypto", "idx", "fx"] as const) {
  const te = events.filter((e) => !e.train && rvolHi(e) && e.klass === cls);
  const s = stats(te.map((e) => e.net));
  let pos = 0, tested = 0;
  const list = cls === "crypto" ? CRYPTO : cls === "idx" ? IDX : FX;
  for (const sym of list) {
    const xs = te.filter((e) => e.symbol === sym).map((e) => e.net);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  console.log(`     ${cls.padEnd(6)} n ${String(s.n).padStart(6)} / mean ${bp(s.mean).padStart(7)}bp / t ${s.t.toFixed(2).padStart(6)}   sign ${pos}/${tested}`);
}

// D2 per-symbol OOS sign map
console.log(`\n  D2 PER-SYMBOL OOS SIGN MAP (rvol>=1.5, K24):`);
console.log(`     symbol         klass   n / mean_bp / t     status`);
const losers: string[] = [];
for (const inst of insts) {
  const te = events.filter((e) => !e.train && rvolHi(e) && e.symbol === inst.symbol);
  const s = stats(te.map((e) => e.net));
  const status = s.n < 20 ? "THIN (untested)" : s.mean > 0 ? "positive" : "NEGATIVE";
  if (s.n >= 20 && s.mean < 0) losers.push(inst.symbol);
  console.log(`     ${inst.symbol.padEnd(14)} ${inst.klass.padEnd(6)} ${String(s.n).padStart(5)} / ${bp(s.mean).padStart(7)} / ${s.t.toFixed(2).padStart(6)}   ${status}`);
}
console.log(`     LOSERS: ${losers.join(", ") || "none"}`);

// D3 threshold sensitivity
console.log(`\n  D3 rvol THRESHOLD SENSITIVITY (OOS pooled, K24):`);
for (const th of [1.3, 1.5, 1.7, 2.0, 2.5]) {
  const te = events.filter((e) => !e.train && e.rvol >= th);
  const s = stats(te.map((e) => e.net));
  let pos = 0, tested = 0;
  for (const inst of insts) {
    const xs = te.filter((e) => e.symbol === inst.symbol).map((e) => e.net);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  console.log(`     >=${th.toFixed(1)}  n ${String(s.n).padStart(6)} / mean ${bp(s.mean).padStart(7)}bp / t ${s.t.toFixed(2).padStart(6)}   sign ${pos}/${tested}`);
}

// D4 era stability (per calendar year in OOS)
console.log(`\n  D4 ERA STABILITY BY YEAR (OOS, rvol>=1.5, K24):`);
for (const yr of [2023, 2024, 2025, 2026]) {
  const te = events.filter((e) => !e.train && rvolHi(e) && e.year === yr);
  const s = stats(te.map((e) => e.net));
  let pos = 0, tested = 0;
  for (const inst of insts) {
    const xs = te.filter((e) => e.symbol === inst.symbol).map((e) => e.net);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  console.log(`     ${yr}  n ${String(s.n).padStart(6)} / mean ${bp(s.mean).padStart(7)}bp / t ${s.t.toFixed(2).padStart(6)}   sign ${pos}/${tested}`);
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-rvol-decompose", runId: `mrd7|${K.SPLIT}`, spent: 15 });
console.log(`\n  ================================ VERDICT ================================`);
console.log(`  SURVIVAL RULE: to warrant operator sign-off on a pre-registered forward clock, D-776 must show:`);
console.log(`  (D1) >=2 of 3 asset classes with positive pooled OOS AND >=majority sign`);
console.log(`  (D2) losers not all from one asset class`);
console.log(`  (D3) sign consistent across thresholds 1.3/1.5/1.7/2.0 (all pooled means positive)`);
console.log(`  (D4) at least 3 of 4 years positive OOS pooled`);
console.log(`  Program ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()} (+15 trials).`);
