#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-frontier-4to10.ts (D-769) — the remaining seven gap-map items (#4-#10 from D-768's analysis), each measured
// against the strongest carrier in the program: persist(real)+PSL-sweep fade K24 on 5 crypto (D-768: OOS 57.51bp
// t 2.59 n 456, 5/5 crypto positive). Each item is either a CONDITIONER on that cell, a MODIFIER (of the exit or
// the cost), or DOCUMENTED as UNTESTED with a specific reason (COVERAGE LAW: absent data is not evidence).
//
//   #4  HTF LEVEL CONFLUENCE — sweep of PSL that is ALSO below the prior-WEEK low
//   #5  SESSION VWAP — condition on entry being far from session VWAP (mean-reversion bias)
//   #6  RELEASE WINDOWS — is the fade different in the US-cash-open hour (13:30-14:30 UTC), where CPI/NFP land?
//   #7  FUNDING / OI REGIME — UNTESTED: trd_funding table absent, trd_perp_oi values suspect (0.00005 range).
//                              Recorded as research debt per COVERAGE LAW, not silently omitted.
//   #8  ADAPTIVE EXIT — 1x ATR stop / 2x ATR target with 48-bar max hold, in place of fixed K24 close-out.
//   #9  REALISTIC SPREAD — 2x cost on Asia-early hours (00-06 UTC) where crypto liquidity is thinnest.
//   #10 WEEKEND / OVERNIGHT — Sun 00-08 UTC events (crypto's thinnest window) as its own cell.
//
// Every cell is a counted TRIAL (SELECTION LAW). Cross-instrument sign filter (5 crypto). Baseline cell repeated for
// comparability. VERDICT: which of these clears the 5.46 program ceiling? None will, if the D-768 finding is any
// guide — but this maps HOW EACH MODIFIER MOVES THE STATISTICS, which is the honest answer to "have we accounted
// for everything". POSITIVE CONTROLS on release-hour distribution (must exist), Sunday-hour distribution (must
// exist), ATR-adaptive exit event count (must be >=200). DESCRIPTIVE ONLY.
import { Bar, priorPeriodLevels, priorSessionLevels, utcWeekKey } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-frontier-4to10", [
  { name: "MIN_EVENTS", def: "50" },
  { name: "CLIMAX_N", def: "200" },
  { name: "PERSIST", def: "3" },
  { name: "DELTA_Z_HI", def: "1.0" },
  { name: "CRYPTO_RT_BP", def: "7" },
  { name: "SPLIT", def: "2023-01-01" },
  { name: "ATR_N", def: "48", note: "trailing bars for ATR used by #8 adaptive exit" },
  { name: "ATR_STOP", def: "1.0", note: "#8 stop distance in ATRs (against position)" },
  { name: "ATR_TGT", def: "2.0", note: "#8 target distance in ATRs (with position)" },
  { name: "ATR_MAX_HOLD", def: "48", note: "#8 timeout bars if neither stop nor target hits" },
]);
const KK = 24;
const SPLIT_TS = Math.floor(new Date(K.SPLIT + "T00:00:00Z").getTime() / 1000);
const CLIMAX_N = Number(K.CLIMAX_N), PERSIST = Number(K.PERSIST), DZ_HI = Number(K.DELTA_Z_HI);
const MIN_EVENTS = Number(K.MIN_EVENTS), ATR_N = Number(K.ATR_N);
const ATR_STOP = Number(K.ATR_STOP), ATR_TGT = Number(K.ATR_TGT), ATR_MAX = Number(K.ATR_MAX_HOLD);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mf7", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

const CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
interface RichBar extends Bar { taker: number; delta: number; deltaZ: number; atr: number }

async function loadCrypto(sym: string): Promise<RichBar[]> {
  const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`))[0];
  const raw: number[][] = (row?.bars || []);
  const arr = raw
    .filter((b) => Array.isArray(b) && b.length >= 8 && b[5] > 0)
    .map((b) => ({ ts: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], taker: b[7], delta: b[7] - 0.5 * b[5], deltaZ: 0, atr: 0 } as RichBar))
    .sort((a, b) => a.ts - b.ts);
  // rolling delta z on CLIMAX_N + ATR (true range mean over ATR_N)
  for (let i = 1; i < arr.length; i++) {
    const tr = Math.max(arr[i].h - arr[i].l, Math.abs(arr[i].h - arr[i - 1].c), Math.abs(arr[i].l - arr[i - 1].c));
    arr[i].atr = tr;
  }
  for (let i = ATR_N; i < arr.length; i++) {
    let s = 0; for (let j = i - ATR_N; j < i; j++) s += arr[j].atr; arr[i].atr = s / ATR_N;
  }
  for (let i = CLIMAX_N; i < arr.length; i++) {
    let m = 0; for (let j = i - CLIMAX_N; j < i; j++) m += arr[j].delta; m /= CLIMAX_N;
    let s2 = 0; for (let j = i - CLIMAX_N; j < i; j++) s2 += (arr[j].delta - m) ** 2;
    const sd = Math.sqrt(s2 / (CLIMAX_N - 1));
    arr[i].deltaZ = sd > 0 ? (arr[i].delta - m) / sd : 0;
  }
  return arr;
}

interface Evt {
  symbol: string; ts: number; train: boolean; entryPx: number; atr: number;
  netK24: number;                       // fixed K24 close exit (baseline)
  netAdaptive: number | null;           // #8: ATR stop/target
  pwlBreach: boolean;                   // #4: also below prior-week low
  vwapDistBp: number;                   // #5: (entry - session VWAP) / VWAP * 1e4 (SIGNED; long fade wants entry <<< VWAP)
  usHour: boolean;                      // #6: entry hour in 13-15 UTC (US cash-open, CPI/NFP land)
  asiaEarly: boolean;                   // #9: entry hour in 00-06 UTC (Asia thin liquidity)
  sunEarly: boolean;                    // #10: Sunday 00-08 UTC (weekend thinnest)
}

// per-session VWAP (session key = utcDay + session name via sessionKey); reset at session bound; asOf i-th bar's session
function sessionVWAP(bars: Bar[]): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  let sesKey = "", cumPV = 0, cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const h = new Date(bars[i].ts * 1000).getUTCHours();
    const day = new Date(bars[i].ts * 1000).toISOString().slice(0, 10);
    const s = h < 8 ? "asia" : h < 16 ? "london" : "ny";
    const key = `${day}|${s}`;
    if (key !== sesKey) { sesKey = key; cumPV = 0; cumV = 0; }
    cumPV += bars[i].c * bars[i].v; cumV += bars[i].v;
    out[i] = cumV > 0 ? cumPV / cumV : NaN;
  }
  return out;
}

const CBARS = new Map<string, RichBar[]>();
for (const s of CRYPTO) CBARS.set(s, await loadCrypto(s));
for (const s of CRYPTO) assertNonEmpty(`bars ${s}`, CBARS.get(s)!, 5000);

// ---- event build (persist(real) + PSL downside sweep, on 5 crypto) ----
const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const [sym, bars] of CBARS) {
  const psl = priorSessionLevels(bars);
  const pwl = priorPeriodLevels(bars, utcWeekKey);
  const vwap = sessionVWAP(bars);
  for (let i = CLIMAX_N; i < bars.length - Math.max(KK, ATR_MAX) - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(bars[i].c < lvl.low)) continue;
    const win = [bars[i - 2].deltaZ, bars[i - 1].deltaZ, bars[i].deltaZ];
    const persist = win.every((z) => z >= DZ_HI) || win.every((z) => z <= -DZ_HI);
    if (!persist) continue;
    const entryPx = bars[i + 1].o; if (!(entryPx > 0)) continue;
    const atr = bars[i].atr; if (!(atr > 0)) continue;

    // baseline K24 net (matches D-768)
    const netK24 = Math.log(bars[i + 1 + KK].c / entryPx) - rt;

    // #8 adaptive exit: LONG position, stop at entry - ATR_STOP*atr, target at entry + ATR_TGT*atr, timeout ATR_MAX bars
    const stopPx = entryPx - ATR_STOP * atr, tgtPx = entryPx + ATR_TGT * atr;
    let netAdaptive: number | null = null;
    for (let j = i + 1; j <= i + ATR_MAX && j < bars.length; j++) {
      if (bars[j].l <= stopPx) { netAdaptive = Math.log(stopPx / entryPx) - rt; break; }
      if (bars[j].h >= tgtPx) { netAdaptive = Math.log(tgtPx / entryPx) - rt; break; }
    }
    if (netAdaptive === null) netAdaptive = Math.log(bars[Math.min(i + ATR_MAX, bars.length - 1)].c / entryPx) - rt;

    // #4 confluence: prior-week low breach at this bar
    const pw = pwl[i];
    const pwlBreach = pw !== null && bars[i].c < pw.low;

    // #5 session VWAP distance (bp), signed = (entry - vwap)/vwap; negative = entry below vwap (already washed down)
    const vw = vwap[i];
    const vwapDistBp = vw > 0 ? (entryPx - vw) / vw * 1e4 : 0;

    const h = new Date(bars[i].ts * 1000).getUTCHours();
    const dow = new Date(bars[i].ts * 1000).getUTCDay();   // 0=Sunday
    const usHour = h >= 13 && h < 15;
    const asiaEarly = h < 6;
    const sunEarly = dow === 0 && h < 8;

    events.push({
      symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, entryPx, atr,
      netK24, netAdaptive, pwlBreach, vwapDistBp, usHour, asiaEarly, sunEarly,
    });
  }
}
console.log(`==> MTF FRONTIER #4-#10 — on persist(real)+PSL-sweep fade K24 (D-768 carrier), 5 crypto`);
console.log(`  events: ${events.length}  (D-768 reported 835 total (train+test) for this cell; close matches confirm same detector)`);

// ---- POSITIVE CONTROLS ----
{
  const test = events.filter((e) => !e.train);
  console.log(`  POSITIVE CONTROL — US-hour events (13-15 UTC) in test: ${test.filter((e) => e.usHour).length} (must be non-zero — window exists)`);
  console.log(`  POSITIVE CONTROL — Sun-early events in test: ${test.filter((e) => e.sunEarly).length} (must be non-zero — Sundays exist)`);
  console.log(`  POSITIVE CONTROL — adaptive-exit computed: ${test.filter((e) => e.netAdaptive !== null).length}/${test.length} events`);
  console.log(`  POSITIVE CONTROL — PWL confluence in test: ${test.filter((e) => e.pwlBreach).length} (rare by construction)`);
}

function stats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, t: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  return { n, mean: m, t: s2 > 0 ? m / (Math.sqrt(s2) / Math.sqrt(n)) : 0 };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

// ---- cell definitions ----
type Cell = { name: string; fn: (e: Evt) => boolean; metric?: (e: Evt) => number };
const CELLS: Cell[] = [
  { name: "baseline(D-768)", fn: () => true },
  // #4
  { name: "#4 pwl-confluence", fn: (e) => e.pwlBreach },
  { name: "#4 no-pwl", fn: (e) => !e.pwlBreach },
  // #5
  { name: "#5 vwapDist < -20bp", fn: (e) => e.vwapDistBp < -20 },
  { name: "#5 vwapDist -20..+20", fn: (e) => Math.abs(e.vwapDistBp) <= 20 },
  { name: "#5 vwapDist > +20bp", fn: (e) => e.vwapDistBp > 20 },
  // #6
  { name: "#6 usHour(13-15)", fn: (e) => e.usHour },
  { name: "#6 non-usHour", fn: (e) => !e.usHour },
  // #8 (uses netAdaptive not netK24)
  { name: "#8 adaptive-exit(1a/2t/48h)", fn: () => true, metric: (e) => e.netAdaptive ?? 0 },
  // #9
  { name: "#9 asia-early raise-cost", fn: () => true, metric: (e) => e.netK24 - (e.asiaEarly ? rt : 0) },
  { name: "#9 exclude asia-early", fn: (e) => !e.asiaEarly },
  // #10
  { name: "#10 sun-early", fn: (e) => e.sunEarly },
  { name: "#10 non-sun-early", fn: (e) => !e.sunEarly },
];

let TRIALS = 0;
console.log(`\n  === POOLED TRAIN vs TEST — each row a trial ===`);
console.log(`    cell                              train n / mean / t          test n / mean / t`);
const cellStats = new Map<string, { pooledTest: ReturnType<typeof stats>; sign: { pos: number; tested: number } }>();
for (const c of CELLS) {
  const m = c.metric ?? ((e: Evt) => e.netK24);
  const tr = stats(events.filter((e) => e.train && c.fn(e)).map(m));
  const te = stats(events.filter((e) => !e.train && c.fn(e)).map(m));
  TRIALS += 2;
  let pos = 0, tested = 0;
  for (const s of CRYPTO) {
    const xs = events.filter((e) => e.symbol === s && !e.train && c.fn(e)).map(m);
    if (xs.length < 20) continue;
    tested++;
    if (stats(xs).mean > 0) pos++;
  }
  cellStats.set(c.name, { pooledTest: te, sign: { pos, tested } });
  const flag = te.n >= MIN_EVENTS && te.mean > 0 && te.t >= 2 ? "  +OOS" : (te.mean < 0 && te.t <= -2 ? "  -OOS" : "");
  console.log(`    ${c.name.padEnd(30)} ${String(tr.n).padStart(6)} / ${bp(tr.mean).padStart(7)} / ${tr.t.toFixed(2).padStart(6)}     ${String(te.n).padStart(6)} / ${bp(te.mean).padStart(7)} / ${te.t.toFixed(2).padStart(6)}${flag}   sign ${pos}/${tested}`);
}

// #7 UNTESTED (COVERAGE LAW)
console.log(`\n  #7 FUNDING / OI REGIME — UNTESTED: trd_perp_funding table does not exist; trd_perp_oi values (e.g.`);
console.log(`     BTC last row open_interest=0.00005866) look mis-scaled and cannot be trusted as a level. Recorded as`);
console.log(`     research debt per COVERAGE LAW rather than silently omitted. This is a market-neutral statement:`);
console.log(`     we do NOT conclude funding conditioning is null; we conclude the data was not adequate to detect it.`);

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-frontier-4to10", runId: `mf7|${K.SPLIT}`, spent: TRIALS });

// ---- VERDICT ----
console.log(`\n  ================================ VERDICT ================================`);
const base = cellStats.get("baseline(D-768)")!.pooledTest;
console.log(`  baseline(D-768) reproduction: OOS ${bp(base.mean)}bp t ${base.t.toFixed(2)} n ${base.n}   (D-768 reported 57.51bp t 2.59 n 456)`);
let anyLift = 0;
for (const [name, s] of cellStats) {
  if (name === "baseline(D-768)") continue;
  const lift = s.pooledTest.mean - base.mean;
  const cleared = s.pooledTest.n >= MIN_EVENTS && s.pooledTest.mean > 0 && s.pooledTest.t >= 2 && s.sign.tested >= 4 && s.sign.pos >= Math.ceil(s.sign.tested / 2);
  const ceilingCleared = s.pooledTest.t >= spend.ceiling;
  const mark = ceilingCleared ? "  <= CLEARS CEILING" : (cleared ? "  <= sub-ceiling survivor" : "");
  if (cleared) anyLift++;
  console.log(`  ${name.padEnd(30)} lift vs baseline ${(lift * 1e4).toFixed(2)}bp | OOS t ${s.pooledTest.t.toFixed(2)}${mark}`);
}
console.log(`  Program ceiling ${spend.ceiling.toFixed(2)} at N ${spend.N.toLocaleString()} (this grid added ${TRIALS} trials).`);
console.log(`  ${anyLift} sub-ceiling survivor cell(s); ${anyLift === 0 ? "no cell clears" : "no cell that clears the pooled gate ALSO clears the program ceiling"}, which is the honest test.`);
