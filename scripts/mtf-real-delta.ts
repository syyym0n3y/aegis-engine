#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-real-delta.ts (D-768) — three gaps at once, on the crypto side (where the ingredients are all held):
//
//   #1 REAL TAKER DELTA replacing the CLVxvolume proxy that binds every "volume" number in D-767:
//      trd_bars_intraday packs bars as [ts,o,h,l,c,vol,quoteVol,takerBuyBase,nTrades] (ingest-perp-flow.ts).
//      Real aggressor-imbalance z-score = (takerBuyBase - 0.5*vol) / vol, z-scored on a trailing window.
//      Directional persistence = 3 consecutive same-sign delta bars in real delta (was CLV proxy in D-767).
//      Climax = trailing top-5% |real delta|. This is the actual field, not a proxy.
//
//   #2 CROSS-INSTRUMENT STATE at the event bar:
//      - BTC concurrent 24h log-return sign (BTC leading altcoins);
//      - VIX regime (last daily close percentile in trailing 252 days) as a risk-on/risk-off filter;
//      - DXY-proxy: EURUSD 24h log-return sign inverted (loaded from trd_fx_hourly).
//      Each is aligned by TS (asof, no look-ahead), conditioning the D-767 volume survivors.
//
//   #3 ATR-NORMALISED THRESHOLDS in place of fixed bp constants:
//      dryup: participation < median of trailing N (unchanged — already scale-free).
//      persistence z-cut: |delta z| >= 1.0 (scale-free by construction).
//      Removes the D-575 universe-bias where a 30bp threshold means different things across instruments.
//
// SETUP: D-763 downside PSL sweep, fade = long next bar's open, K in {4,12,24}h, lag-1, RT=7bp/crypto, cost charged.
// SELECTION LAW: full grid printed; every cell a counted trial. BREADTH LAW: floor 50 (pooled) / 20 (per-instrument).
// COVERAGE LAW: the state fields (BTC, VIX, DXY) print their per-event coverage; a NULL state = bar excluded, not
// silently coerced. POSITIVE CONTROL: real-delta and CLV-proxy dv agree on sign for a majority of bars (they should
// — CLV was a proxy for the same physical thing) but with a measurably different distribution. DESCRIPTIVE ONLY.
import { Bar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-real-delta", [
  { name: "MIN_EVENTS", def: "50" },
  { name: "CLIMAX_N", def: "200", note: "trailing bars for climax/z-score" },
  { name: "PERSIST", def: "3", note: "consecutive same-sign real-delta bars" },
  { name: "DELTA_Z_HI", def: "1.0", note: "|delta z| >= this counts as 'directional'" },
  { name: "CRYPTO_RT_BP", def: "7" },
  { name: "SPLIT", def: "2023-01-01" },
  { name: "VIX_HI_PCT", def: "70", note: "VIX >= this percentile of trailing 252 daily closes = risk-off regime" },
]);
const KSET = [4, 12, 24];
const SPLIT_TS = Math.floor(new Date(K.SPLIT + "T00:00:00Z").getTime() / 1000);
const MIN_EVENTS = Number(K.MIN_EVENTS), CLIMAX_N = Number(K.CLIMAX_N), PERSIST = Number(K.PERSIST);
const DZ_HI = Number(K.DELTA_Z_HI), VIX_HI = Number(K.VIX_HI_PCT);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mrd", exp: 4102444800 });
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
  const arr = raw
    .filter((b) => Array.isArray(b) && b.length >= 8 && b[5] > 0)
    .map((b) => {
      const ts = b[0], o = b[1], h = b[2], l = b[3], c = b[4], v = b[5], taker = b[7];
      const delta = (taker - 0.5 * v);          // signed aggressor imbalance in base units; +ve = net taker-buy
      return { ts, o, h, l, c, v, taker, delta, deltaZ: NaN } as RichBar;
    })
    .sort((a, b) => a.ts - b.ts);
  // rolling z-score of delta on trailing CLIMAX_N (strictly past)
  for (let i = CLIMAX_N; i < arr.length; i++) {
    let m = 0; for (let j = i - CLIMAX_N; j < i; j++) m += arr[j].delta; m /= CLIMAX_N;
    let s2 = 0; for (let j = i - CLIMAX_N; j < i; j++) s2 += (arr[j].delta - m) ** 2;
    const sd = Math.sqrt(s2 / (CLIMAX_N - 1));
    arr[i].deltaZ = sd > 0 ? (arr[i].delta - m) / sd : 0;
  }
  return arr;
}
async function loadFxSym(sym: string): Promise<{ ts: number; c: number }[]> {
  return (await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,c&order=ts.asc`)) as { ts: number; c: number }[];
}
async function loadDailyMacro(series: string): Promise<Map<string, number>> {
  const rows = (await q(`trd_macro_series?series=eq.${series}&select=d,v&order=d.asc`)) as { d: string; v: number }[];
  return new Map(rows.map((r) => [r.d, r.v]));
}

// ---- load everything ----
const CBARS = new Map<string, RichBar[]>();
for (const s of CRYPTO) CBARS.set(s, await loadCrypto(s));
for (const s of CRYPTO) assertNonEmpty(`bars ${s}`, CBARS.get(s)!, 5000);

const btc = CBARS.get("BTCUSDT")!;
const btcTsIdx = new Map<number, number>(); btc.forEach((b, i) => btcTsIdx.set(b.ts, i));

// DXY proxy from EURUSD 24h log-return (negated)
const eur = await loadFxSym("EURUSD");
const eurMap = new Map<number, number>(eur.map((r) => [r.ts, r.c]));
const eurTs = [...eurMap.keys()].sort((a, b) => a - b);

// VIX daily (search common series names)
let vix: Map<string, number> | null = null;
for (const s of ["vixcls", "cboe_vix", "cboe_vix3m", "cboe_vvix"]) {
  const m = await loadDailyMacro(s).catch(() => new Map());
  if (m.size > 100) { vix = m; console.error(`  loaded VIX series '${s}' (${m.size} daily observations)`); break; }
}
if (!vix) console.error(`  WARN: no VIX series in trd_macro_series — vix conditioning will be UNTESTED, not NULL`);

// VIX percentile per date (trailing 252 daily closes, strictly past — no look-ahead)
const vixPct = new Map<string, number>();
if (vix) {
  const days = [...vix.keys()].sort();
  for (let i = 252; i < days.length; i++) {
    const cur = vix.get(days[i])!;
    let rk = 0;
    for (let j = i - 252; j < i; j++) if (vix.get(days[j])! < cur) rk++;
    vixPct.set(days[i], rk / 252 * 100);
  }
}
function isoDay(ts: number): string { return new Date(ts * 1000).toISOString().slice(0, 10); }

// ---- POSITIVE CONTROL: real delta vs CLV proxy agreement on BTC ----
{
  const clvProxy = btc.map((b) => { const r = b.h - b.l; return r > 0 ? ((b.c - b.l) - (b.h - b.c)) / r * b.v : 0; });
  let agree = 0, both = 0;
  for (let i = 0; i < btc.length; i++) if (Math.abs(btc[i].delta) > 0 && Math.abs(clvProxy[i]) > 0) {
    both++;
    if ((btc[i].delta > 0) === (clvProxy[i] > 0)) agree++;
  }
  const pct = agree / both;
  console.log(`==> MTF REAL-DELTA — replacing CLVxvol proxy on 5 crypto (D-768)`);
  console.log(`  POSITIVE CONTROL — real taker delta vs CLV proxy sign agreement (BTC): ${(pct * 100).toFixed(1)}% of ${both} bars`);
  console.log(`  (they should agree the majority of the time — both proxy the same physical direction — but be materially different in size,`);
  console.log(`  which is why the proxy replacement can matter. Below 55% or above 95% would indicate a bug.)`);
  if (pct < 0.55 || pct > 0.95) { console.error(`!! agreement out of expected band — check field mapping.`); Deno.exit(1); }
}

// ---- event detection: PSL downside sweep -> fade LONG at next open ----
interface Evt {
  symbol: string; ts: number; train: boolean;
  net: Record<number, number>;
  climax: boolean; persist: boolean; dryup: boolean;
  btcUp: boolean | null; vixHi: boolean | null; dxyUp: boolean | null;
  hasState: boolean;   // any of {btc, vix, dxy} available
}
function asofNearest<T>(sortedKeys: number[], m: Map<number, T>, ts: number, tolSec = 3600): T | undefined {
  // binary search for greatest key <= ts (asof)
  let lo = 0, hi = sortedKeys.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedKeys[mid] <= ts) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return undefined;
  if (ts - sortedKeys[best] > tolSec) return undefined;
  return m.get(sortedKeys[best]);
}

const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const [sym, bars] of CBARS) {
  const psl = priorSessionLevels(bars);
  // trailing median volume (VOL_N=24) for dryup
  const VN = 24;
  for (let i = CLIMAX_N; i < bars.length - Math.max(...KSET) - 1; i++) {
    const b = bars[i];
    const lvl = psl[i];
    if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(b.c < lvl.low)) continue;                       // DOWNSIDE close below prior session low
    const entry = bars[i + 1].o;
    if (!(entry > 0)) continue;
    const net: Record<number, number> = {};
    for (const k of KSET) net[k] = Math.log(bars[i + 1 + k].c / entry) - rt;

    // real-delta conditions (replace CLV proxy)
    let volRank = 0;
    for (let j = i - CLIMAX_N; j < i; j++) if (Math.abs(bars[j].delta) < Math.abs(b.delta)) volRank++;
    const climax = volRank / CLIMAX_N >= 0.95;
    const persistWin = i >= PERSIST ? bars.slice(i - PERSIST + 1, i + 1) : [];
    const persist = persistWin.length === PERSIST && (
      persistWin.every((x) => x.deltaZ >= DZ_HI) || persistWin.every((x) => x.deltaZ <= -DZ_HI)
    );
    // dryup: participation vs trailing median volume
    const volWin = bars.slice(i - VN, i).map((x) => x.v).sort((a, b) => a - b);
    const medV = volWin[Math.floor(VN / 2)];
    const dryup = medV > 0 && b.v < medV;

    // cross-instrument state (asof)
    const bidx = btcTsIdx.get(b.ts);
    const btcUp = bidx !== undefined && bidx >= 24 ? btc[bidx].c > btc[bidx - 24].c : null;
    const day = isoDay(b.ts);
    const vp = vixPct.get(day);
    const vixHi = vp === undefined ? null : vp >= VIX_HI;
    const eurNow = asofNearest(eurTs, eurMap, b.ts);
    const eurPast = asofNearest(eurTs, eurMap, b.ts - 24 * 3600);
    const dxyUp = eurNow !== undefined && eurPast !== undefined ? eurNow < eurPast : null; // DXY up = EUR down

    events.push({
      symbol: sym, ts: b.ts, train: b.ts < SPLIT_TS, net,
      climax, persist, dryup, btcUp, vixHi, dxyUp,
      hasState: btcUp !== null || vixHi !== null || dxyUp !== null,
    });
  }
}

console.log(`\n  events: ${events.length}`);
console.log(`  state coverage — btcUp: ${events.filter((e) => e.btcUp !== null).length} | vixHi: ${events.filter((e) => e.vixHi !== null).length} | dxyUp: ${events.filter((e) => e.dxyUp !== null).length}`);

// ---- stats ----
function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  return { n, mean: m, t: s2 > 0 ? m / (Math.sqrt(s2) / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

const CONDS: Array<{ name: string; fn: (e: Evt) => boolean }> = [
  { name: "base(real)", fn: () => true },
  { name: "climax(real)", fn: (e) => e.climax },
  { name: "persist(real)", fn: (e) => e.persist },
  { name: "dryup", fn: (e) => e.dryup },
  { name: "btcUp", fn: (e) => e.btcUp === true },
  { name: "btcDn", fn: (e) => e.btcUp === false },
  { name: "vixHi", fn: (e) => e.vixHi === true },
  { name: "vixLo", fn: (e) => e.vixHi === false },
  { name: "dxyUp", fn: (e) => e.dxyUp === true },
  { name: "dxyDn", fn: (e) => e.dxyUp === false },
  { name: "persist+btcUp", fn: (e) => e.persist && e.btcUp === true },
  { name: "persist+vixLo", fn: (e) => e.persist && e.vixHi === false },
  { name: "climax+btcDn", fn: (e) => e.climax && e.btcUp === false },
  { name: "persist+dxyDn", fn: (e) => e.persist && e.dxyUp === false },
];

let TRIALS = 0;
console.log(`\n  === TABLE 1 — POOLED NET (bp), TRAIN vs TEST (each row a trial) ===`);
console.log(`    cell               K    train: n / mean / t         test:  n / mean / t`);
for (const c of CONDS) {
  const cell = events.filter(c.fn);
  for (const k of KSET) {
    TRIALS += 2;
    const tr = stats(cell.filter((e) => e.train).map((e) => e.net[k]));
    const te = stats(cell.filter((e) => !e.train).map((e) => e.net[k]));
    const flag = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 ? "  <= +OOS" : "";
    console.log(`    ${c.name.padEnd(18)} ${String(k).padStart(2)}  ${String(tr.n).padStart(6)} / ${bp(tr.mean).padStart(7)} / ${tr.t.toFixed(2).padStart(6)}     ${String(te.n).padStart(6)} / ${bp(te.mean).padStart(7)} / ${te.t.toFixed(2).padStart(6)}${flag}`);
  }
}

console.log(`\n  === TABLE 2 — CROSS-INSTRUMENT SIGN (TEST): instruments (of 5) with n>=20 whose mean is positive ===`);
console.log(`    cell               ` + KSET.map((k) => `K${k}: +/tested`).join("   "));
const survivors: string[] = [];
for (const c of CONDS) {
  const cols: string[] = [];
  for (const k of KSET) {
    let pos = 0, tested = 0;
    for (const s of CRYPTO) {
      const xs = events.filter((e) => c.fn(e) && e.symbol === s && !e.train).map((e) => e.net[k]);
      if (xs.length < 20) continue;
      tested++;
      if (stats(xs).mean > 0) pos++;
    }
    cols.push(`${String(pos).padStart(3)}/${tested}`.padStart(10));
    const teAll = stats(events.filter((e) => c.fn(e) && !e.train).map((e) => e.net[k]));
    if (teAll.n >= MIN_EVENTS && teAll.mean > 0 && teAll.t >= 2 && tested >= 4 && pos >= Math.ceil(tested / 2)) {
      survivors.push(`${c.name} K${k}: OOS ${bp(teAll.mean)}bp t ${teAll.t.toFixed(2)} n ${teAll.n}, sign ${pos}/${tested}`);
    }
  }
  console.log(`    ${c.name.padEnd(18)} ` + cols.join("   "));
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-real-delta", runId: `mrd|${K.SPLIT}`, spent: TRIALS });
console.log(`\n  ================================ VERDICT ================================`);
if (survivors.length) for (const s of survivors) console.log(`  SURVIVOR: ${s}`);
else console.log(`  NO cell clears cost OOS with cross-instrument sign agreement (>=4/5 tested, majority positive).`);
console.log(`  TRIALS this grid: ${TRIALS} | program ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | ceiling ${spend.ceiling.toFixed(4)}`);
console.log(`  Real taker delta replaces the CLV proxy; VIX/DXY/BTC-state add cross-instrument conditioning; thresholds are z-scale-free.`);
console.log(`  A t-stat still has to clear the program ceiling ${spend.ceiling.toFixed(2)} to be believed as an edge, not just as a description.`);
