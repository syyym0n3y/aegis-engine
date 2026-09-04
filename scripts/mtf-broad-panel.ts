#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-broad-panel.ts (D-773) — the BREADTH LAW test on D-768/771/772. The refined R2 cell
// (downside PSL sweep + persist(real) + no-pwl + vwapFar + contango, K24) gives t 4.92 5/5 on 5 crypto.
// Question: does the sign SURVIVE at broader breadth? 5 names is thin; the BREADTH LAW warns any cross-sectional
// result on <50 names is likely UNTESTED. Perp panel isn't 50, but going 5 → 10 doubles it and includes
// beta-heavy alts (DOGE, XRP) and quality alts (BCH, LINK, ADA, ZEC) — real independent replication if it holds.
//
// Panel = top 10 by n_bars in trd_bars_intraday tf=1h with real taker delta:
//   BTCUSDT, ETHUSDT, BCHUSDT, XRPUSDT, LINKUSDT, ADAUSDT, ZECUSDT, BNBUSDT, DOGEUSDT, SOLUSDT
// All have 50k+ 1h bars. Same event definition (D-768), same conditioners (D-769/770), same K24 exit.
// Reports both the D-768 BASELINE and the D-772 REFINED cell on the expanded panel — direct comparison to
// the 5-name results. If the sign holds at 10/10 or ≥7/10, D-768 is genuinely cross-sectional. If it collapses
// to 5/10 (only the original 5 work), the D-768 finding was 5-name selection.
// SELECTION LAW: no new choices are made; every conditioner is the SAME threshold as D-772.
import { Bar, priorPeriodLevels, priorSessionLevels, utcWeekKey } from "../supabase/functions/_shared/mtf-structure.ts";
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("mtf-broad-panel", [
  { name: "MIN_EVENTS", def: "50" }, { name: "CLIMAX_N", def: "200" }, { name: "PERSIST", def: "3" },
  { name: "DELTA_Z_HI", def: "1.0" }, { name: "CRYPTO_RT_BP", def: "7" }, { name: "SPLIT", def: "2023-01-01" },
  { name: "VWAP_BP", def: "-20" },
]);
const KK = 24, SPLIT_TS = Math.floor(Date.parse(K.SPLIT + "T00:00:00Z") / 1000);
const CLIMAX_N = Number(K.CLIMAX_N), DZ_HI = Number(K.DELTA_Z_HI);
const MIN_EVENTS = Number(K.MIN_EVENTS), VWAP_BP = Number(K.VWAP_BP);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mbp", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

// D-768 5 + D-773 5 more (added: BCHUSDT, LINKUSDT, ADAUSDT, ZECUSDT, DOGEUSDT — all with 50k+ 1h bars, real taker)
const CRYPTO = ["BTCUSDT", "ETHUSDT", "BCHUSDT", "XRPUSDT", "LINKUSDT", "ADAUSDT", "ZECUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT"];
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
function sessionVWAP(bars: Bar[]): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  let sk = "", cpv = 0, cv = 0;
  for (let i = 0; i < bars.length; i++) {
    const h = new Date(bars[i].ts * 1000).getUTCHours();
    const day = new Date(bars[i].ts * 1000).toISOString().slice(0, 10);
    const s = h < 8 ? "asia" : h < 16 ? "london" : "ny";
    const key = `${day}|${s}`;
    if (key !== sk) { sk = key; cpv = 0; cv = 0; }
    cpv += bars[i].c * bars[i].v; cv += bars[i].v;
    out[i] = cv > 0 ? cpv / cv : NaN;
  }
  return out;
}

const CBARS = new Map<string, RichBar[]>();
const FUND = new Map<string, { ts: number; rate: number }[]>();
for (const s of CRYPTO) {
  CBARS.set(s, await loadCrypto(s));
  const f = await loadFunding(s).catch(() => [] as { ts: number; rate: number }[]);
  FUND.set(s, f);
}
for (const s of CRYPTO) assertNonEmpty(`bars ${s}`, CBARS.get(s)!, 5000);

function fundRateAsof(sym: string, evTs: number): number | null {
  const arr = FUND.get(sym); if (!arr || arr.length === 0) return null;
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].ts <= evTs) { best = m; lo = m + 1; } else hi = m - 1; }
  return best < 0 ? null : arr[best].rate;
}

interface Evt {
  symbol: string; ts: number; train: boolean; entryPx: number;
  netK24: number; hasFund: boolean; fundRate: number; noPwl: boolean; vwapFar: boolean;
}
const events: Evt[] = [];
const rt = Number(K.CRYPTO_RT_BP) / 1e4;
for (const [sym, bars] of CBARS) {
  const psl = priorSessionLevels(bars);
  const pwl = priorPeriodLevels(bars, utcWeekKey);
  const vwap = sessionVWAP(bars);
  for (let i = CLIMAX_N; i < bars.length - KK - 1; i++) {
    const lvl = psl[i]; if (!lvl || i <= lvl.fromLastIndex) continue;
    if (!(bars[i].c < lvl.low)) continue;
    const win = [bars[i - 2].deltaZ, bars[i - 1].deltaZ, bars[i].deltaZ];
    const persist = win.every((z) => z >= DZ_HI) || win.every((z) => z <= -DZ_HI);
    if (!persist) continue;
    const entry = bars[i + 1].o; if (!(entry > 0)) continue;
    const sesV = vwap[i]; if (!(sesV > 0)) continue;
    const netK24 = Math.log(bars[i + 1 + KK].c / entry) - rt;
    const pw = pwl[i]; const noPwl = !(pw !== null && bars[i].c < pw.low);
    const vwapFar = (entry - sesV) / sesV * 1e4 < VWAP_BP;
    const fRate = fundRateAsof(sym, bars[i].ts);
    events.push({
      symbol: sym, ts: bars[i].ts, train: bars[i].ts < SPLIT_TS, entryPx: entry, netK24,
      hasFund: fRate !== null, fundRate: fRate ?? 0, noPwl, vwapFar,
    });
  }
}
console.log(`==> MTF BROAD PANEL — D-768/772 replication on ${CRYPTO.length} crypto (5 new: BCH, LINK, ADA, ZEC, DOGE)`);
console.log(`  events: ${events.length}   POSITIVE CONTROL — all ${CRYPTO.length} symbols must appear in events`);
{
  const missing = CRYPTO.filter((s) => !events.some((e) => e.symbol === s));
  if (missing.length) { console.error(`!! missing symbols in events: ${missing.join(",")} — detector broken.`); Deno.exit(1); }
}

function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0, sd: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, sd };
}
function signMap(evs: Evt[], metric: (e: Evt) => number): { pos: number; tested: number; perSym: Array<{ sym: string; n: number; mean: number; t: number }> } {
  let pos = 0, tested = 0;
  const perSym: Array<{ sym: string; n: number; mean: number; t: number }> = [];
  for (const s of CRYPTO) {
    const xs = evs.filter((e) => e.symbol === s).map(metric);
    const st = stats(xs);
    perSym.push({ sym: s, n: st.n, mean: st.mean, t: st.t });
    if (st.n < 20) continue; tested++; if (st.mean > 0) pos++;
  }
  return { pos, tested, perSym };
}
const bp = (x: number) => (x * 1e4).toFixed(2);

// R1: D-768 baseline on broader panel
{
  const te = events.filter((e) => !e.train);
  const s = stats(te.map((e) => e.netK24));
  const sm = signMap(te, (e) => e.netK24);
  console.log(`\n  R1 D-768 BASELINE (broad panel):  OOS n ${s.n} / ${bp(s.mean)}bp / t ${s.t.toFixed(2)}   sign ${sm.pos}/${sm.tested}`);
  console.log(`     per-symbol OOS:`);
  for (const p of sm.perSym) console.log(`       ${p.sym.padEnd(10)} n ${String(p.n).padStart(4)}  mean ${bp(p.mean).padStart(7)}bp  t ${p.t.toFixed(2).padStart(6)}${p.n >= 20 && p.mean > 0 ? "  +" : ""}`);
}

// R2: D-772 refined joint cell on broader panel
{
  const R2 = (e: Evt) => e.noPwl && e.vwapFar && e.hasFund && e.fundRate >= 0;
  const te = events.filter((e) => !e.train && R2(e));
  const s = stats(te.map((e) => e.netK24));
  const sm = signMap(te, (e) => e.netK24);
  console.log(`\n  R2 D-772 REFINED (broad panel, joint no-pwl+vwapFar+contango): OOS n ${s.n} / ${bp(s.mean)}bp / t ${s.t.toFixed(2)}   sign ${sm.pos}/${sm.tested}`);
  console.log(`     per-symbol OOS:`);
  for (const p of sm.perSym) console.log(`       ${p.sym.padEnd(10)} n ${String(p.n).padStart(4)}  mean ${bp(p.mean).padStart(7)}bp  t ${p.t.toFixed(2).padStart(6)}${p.n >= 20 && p.mean > 0 ? "  +" : ""}`);
}

const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "mtf-broad-panel", runId: `mbp|${K.SPLIT}`, spent: 2 });
console.log(`\n  ================================ VERDICT ================================`);
console.log(`  If R1 sign holds ≥7/10 and R2 sign holds ≥7/10, D-768 REPLICATES cross-sectionally on the broader panel`);
console.log(`  and the 5-name D-768/772 result was not selection. If R2 collapses (≤6/10 with the new 5 mostly negative),`);
console.log(`  the D-768 finding was 5-name-specific and the ceiling honest-adjustment gets worse. Ceiling ${spend.ceiling.toFixed(2)}.`);
