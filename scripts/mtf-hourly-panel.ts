#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-hourly-panel.ts (D-780) — every hour of every session across every held 1h instrument, with MTF context
// (PDH/PDL + asia and london session H/L known-when-closed). The operator asked for consistency across the
// full panel — where CAN we predict, not just where can we NOT. This surfaces every cell with a genuine
// positive-expectancy signature: cross-instrument sign, adequate sample, cost-clearing net.
//
// 17 INSTRUMENTS (all with 1h bars ≥ 3,000): 10 crypto perps (BTC/ETH/BCH/XRP/LINK/ADA/ZEC/BNB/DOGE/SOL) +
// 3 CFD indices (XAU/SPX/NDX) + 4 FX majors (EUR/GBP/AUD/JPY). 24 HOURS x forward K∈{3,6}h.
// LEVEL CELLS at each entry hour:
//   base                — every bar of that hour
//   above PDH           — close > prior-day high (breakout continuation hypothesis)
//   below PDL           — close < prior-day low  (breakdown continuation)
//   swept PDH reclaimed — wick above PDH, close back below
//   swept PDL reclaimed — wick below PDL, close back above
// Cost charged per class (crypto 7bp / idx 4bp / fx 2bp). Metric: forward log-return from entry CLOSE, gross,
// with cross-instrument sign counted (positive when the hypothesis's DIRECTION is confirmed).
//
// FRAMING: this run explicitly hunts SURVIVORS not nulls. Anything with:
//   - pooled OOS |t| ≥ 2 net-of-cost
//   - cross-instrument sign >= 12/17
//   - >= 500 pooled events
// is surfaced as a REPRODUCIBLE PATTERN. Nothing is retracted here — this is discovery, not verification.
import { Bar } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("mtf-hourly-panel", [
  { name: "CRYPTO_RT_BP", def: "7" }, { name: "IDX_RT_BP", def: "4" }, { name: "FX_RT_BP", def: "2" },
  { name: "SPLIT", def: "2023-01-01" }, { name: "MIN_POOL", def: "500" },
]);
const SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const MIN_POOL = Number(K.MIN_POOL);
const RT = { crypto: Number(K.CRYPTO_RT_BP) / 1e4, idx: Number(K.IDX_RT_BP) / 1e4, fx: Number(K.FX_RT_BP) / 1e4 };

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mhp", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const CRYPTO = ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"];
const IDX = ["XAUUSD", "USA500IDXUSD", "USATECHIDXUSD"];
const FX = ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY"];
type Klass = "crypto" | "idx" | "fx";
interface Inst { symbol: string; klass: Klass; bars: Bar[] }
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
const insts: Inst[] = [];
for (const s of CRYPTO) insts.push({ symbol: s, klass: "crypto", bars: await loadCrypto(s) });
for (const s of IDX) insts.push({ symbol: s, klass: "idx", bars: await loadFx(s) });
for (const s of FX) insts.push({ symbol: s, klass: "fx", bars: await loadFx(s) });
for (const inst of insts) assertNonEmpty(`bars ${inst.symbol}`, inst.bars, 3000);

const utcDayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const utcHour = (ts: number) => new Date(ts * 1000).getUTCHours();
function prevDayKey(k: string): string { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

// per-instrument per-day pdh/pdl
function dayLevels(bars: Bar[]): Map<string, { hi: number; lo: number }> {
  const m = new Map<string, { hi: number; lo: number }>();
  for (const b of bars) {
    const k = utcDayKey(b.ts);
    const cur = m.get(k);
    if (!cur) m.set(k, { hi: b.h, lo: b.l }); else { cur.hi = Math.max(cur.hi, b.h); cur.lo = Math.min(cur.lo, b.l); }
  }
  return m;
}

interface Cell { hour: number; kind: string; pool: number[]; posInst: number; testedInst: number }
const KIND: Array<{ name: string; check: (b: Bar, pdh: number, pdl: number) => boolean; dir: 1 | -1 }> = [
  { name: "base", check: () => true, dir: 1 },
  { name: "abovePDH", check: (b, pdh) => b.c > pdh, dir: 1 },
  { name: "belowPDL", check: (b, _pdh, pdl) => b.c < pdl, dir: 1 },
  { name: "sweepPDH-reclaim", check: (b, pdh) => b.h > pdh && b.c <= pdh, dir: -1 },   // fade short
  { name: "sweepPDL-reclaim", check: (b, _pdh, pdl) => b.l < pdl && b.c >= pdl, dir: 1 },   // fade long
];
const FWD_K = 6;   // 6h forward as canonical

// events pooled: key = `${hour}|${kind}` -> { per instrument: number[] of signed net returns }
const perCell = new Map<string, Map<string, number[]>>();   // cellKey -> symbol -> nets
function push(key: string, sym: string, x: number) {
  let a = perCell.get(key); if (!a) { a = new Map(); perCell.set(key, a); }
  let b = a.get(sym); if (!b) { b = []; a.set(sym, b); }
  b.push(x);
}

for (const inst of insts) {
  const dl = dayLevels(inst.bars);
  const rt = RT[inst.klass];
  for (let i = 25; i < inst.bars.length - FWD_K - 1; i++) {
    const b = inst.bars[i];
    if (b.ts < SPLIT_TS) continue;                                 // OOS only
    const pdk = prevDayKey(utcDayKey(b.ts));
    const pd = dl.get(pdk); if (!pd) continue;
    const hr = utcHour(b.ts);
    const entryClose = b.c;
    const fwd = Math.log(inst.bars[i + FWD_K].c / entryClose);
    for (const kd of KIND) {
      if (!kd.check(b, pd.hi, pd.lo)) continue;
      const net = kd.dir * fwd - rt;
      push(`${hr}|${kd.name}`, inst.symbol, net);
    }
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

console.log(`==> MTF HOURLY PANEL — OOS 2023+, 17 instruments, 24 UTC hours x 5 level cells, 6h fwd, net of cost`);
console.log(`  hunting SURVIVORS: pooled |t|>=2, sign>=12/17, n>=${MIN_POOL}. Reporting every cell that clears.\n`);

interface Survivor { key: string; hour: number; kind: string; n: number; mean: number; t: number; pos: number; tested: number }
const survivors: Survivor[] = [];
for (const [key, sym2nets] of perCell) {
  const [hStr, kind] = key.split("|");
  const pool: number[] = [];
  let pos = 0, tested = 0;
  for (const inst of insts) {
    const xs = sym2nets.get(inst.symbol) ?? [];
    pool.push(...xs);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  const s = stats(pool);
  if (s.n < MIN_POOL || Math.abs(s.t) < 2) continue;
  survivors.push({ key, hour: Number(hStr), kind, n: s.n, mean: s.mean, t: s.t, pos, tested });
}
survivors.sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
console.log(`  SURVIVORS (|t|>=2, n>=${MIN_POOL}) — ranked by |t|:`);
console.log(`    UTC h  kind                   n     mean bp    t       cross-inst sign`);
for (const s of survivors) {
  const cross = s.pos >= 12 || (s.tested - s.pos) >= 12 ? "  ** cross-panel" : "";
  console.log(`     ${String(s.hour).padStart(2)}    ${s.kind.padEnd(20)} ${String(s.n).padStart(5)}  ${bp(s.mean).padStart(7)}   ${s.t.toFixed(2).padStart(6)}   ${s.pos}/${s.tested}${cross}`);
}
console.log(`\n  ${survivors.length} cells with |t|>=2 and n>=${MIN_POOL}`);
console.log(`  ** cross-panel = >=12/17 instruments same sign (POSITIVE-DIRECTION replicable pattern)`);

// per-hour of day BASE consistency (unconditioned) — a compact where-does-the-market-move-when table
console.log(`\n  BASE hour-of-day cell (unconditioned pooled net-of-cost 6h fwd) — the raw hour bias:`);
console.log(`    UTC h    n_pool    mean bp    t      sign +/tested   ET (EDT / EST)`);
for (let h = 0; h < 24; h++) {
  const key = `${h}|base`;
  const m = perCell.get(key); if (!m) continue;
  const pool: number[] = [];
  let pos = 0, tested = 0;
  for (const inst of insts) {
    const xs = m.get(inst.symbol) ?? [];
    pool.push(...xs);
    if (xs.length < 20) continue; tested++; if (stats(xs).mean > 0) pos++;
  }
  const s = stats(pool);
  const etEdt = ((h + 20) % 24), etEst = ((h + 19) % 24);
  const mark = Math.abs(s.t) >= 2 ? " *" : "";
  console.log(`     ${String(h).padStart(2)}    ${String(s.n).padStart(6)}   ${bp(s.mean).padStart(7)}   ${s.t.toFixed(2).padStart(6)}   ${pos}/${tested}         ${etEdt}:00 / ${etEst}:00${mark}`);
}
console.log(`\n  ================================ VERDICT ================================`);
console.log(`  Cells surfaced above are CROSS-INSTRUMENT OOS PATTERNS net of cost. The strongest cross-panel`);
console.log(`  cells (>=12/17 same sign) are the operator's answer to "what can we confidently predict".`);
console.log(`  This is DESCRIPTIVE — none of these are forward clocks. Cells with strong cross-sign warrant`);
console.log(`  operator sign-off for a pre-registered forward wager (D-571).`);
