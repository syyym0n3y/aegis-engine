#!/usr/bin/env -S deno run --allow-read
// trd-sr-charts — the operator's chart-analysis pass: build CAUSAL support/resistance across every candle,
// cut sessions at real day-end/weekend gaps, test S/R rejection AND breakout vs a matched random control
// (D-146 — chart patterns get NO exemption from the gate), and measure the Max-Favorable-Excursion
// distribution to answer "you can make a ton on one candle" with the actual tail, not a feeling.
//
// NO LOOK-AHEAD (the thing that makes every chart backtest lie): a swing pivot at bar j is only usable once
// bar j+W has printed; a level at bar i is built ONLY from pivots confirmed strictly before i. Sessions are
// runs of bars spaced <= GAP_MIN apart; no trade is opened that cannot resolve, and every trade is forced flat
// at the session's last bar (the day/week cut-off the operator asked for).
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const norm = (t: number) => t > 1e15 ? Math.floor(t / 1000) : t;
interface B { t: number; o: number; h: number; l: number; c: number }
async function loadDuka(prefix: string): Promise<B[]> { const out: B[] = []; const seen = new Set<number>(); for await (const e of Deno.readDir("data/duka")) { if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue; for (const l of (await Deno.readTextFile(`data/duka/${e.name}`)).split("\n")) { const p = l.split(","); const t = norm(+p[0]); if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } } return out.sort((a, b) => a.t - b.t); }
async function loadBin(f: string): Promise<B[]> { const out: B[] = []; const seen = new Set<number>(); for (const l of (await Deno.readTextFile(`data/binance/${f}`)).split("\n")) { const p = l.split(","); const t = norm(+p[0]); if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } return out.sort((a, b) => a.t - b.t); }
function resample(b: B[], tf: number): B[] { if (tf === 1) return b; const bk = tf * 60000; const m = new Map<number, B>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const e = m.get(k); if (!e) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { e.h = Math.max(e.h, x.h); e.l = Math.min(e.l, x.l); e.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t); }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }

const W = 3;                 // fractal half-window for a swing pivot (needs W bars each side)
const ATRN = 14, STOP_ATR = 2, TP_MULT = 3, NCTRL = 2;
const TOUCH_MIN = 2;         // a price zone must be hit >=2 times to count as S/R
const NEAR_ATR = 0.5;        // "at" a level = within 0.5 ATR
let seed = 13579; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface Level { price: number; touches: number }
const maxOf = (a: number[]) => { let m = -Infinity; for (const x of a) if (x > m) m = x; return m; };

function sessions(b: B[], tf: number): { sess: number[]; lastOf: boolean[]; gapPct: number[] } {
  const sess = new Array(b.length).fill(0); const lastOf = new Array(b.length).fill(false); const gapPct = new Array(b.length).fill(0);
  let s = 0;
  for (let i = 1; i < b.length; i++) { const dm = (b[i].t - b[i - 1].t) / 60000; if (dm > tf * 1.5) { s++; lastOf[i - 1] = true; gapPct[i] = (b[i].o - b[i - 1].c) / b[i - 1].c * 100; } sess[i] = s; }
  lastOf[b.length - 1] = true;
  return { sess, lastOf, gapPct };
}

function simulate(b: B[], lastOf: boolean[], e: number, dir: 1 | -1, sd: number): { r: number; mfe: number } | null {
  if (!(sd > 0) || e >= b.length) return null;
  const entry = b[e].o, stop = entry - dir * sd, tgt = entry + dir * sd * TP_MULT;
  let r: number | null = null, mfe = 0;
  for (let k = e; k < b.length; k++) {
    const fav = dir === 1 ? (b[k].h - entry) / sd : (entry - b[k].l) / sd; if (fav > mfe) mfe = fav;
    if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; }
    if (dir === 1 ? b[k].h >= tgt : b[k].l <= tgt) { r = TP_MULT; break; }
    if (lastOf[k]) { r = dir * (b[k].c - entry) / sd; break; }   // forced flat at the day/week cut-off
  }
  if (r === null) r = dir * (b[b.length - 1].c - entry) / sd;
  return { r, mfe };
}

async function analyse(name: string, load: () => Promise<B[]>, tf: number, gapMin: number) {
  const raw = await load(); const b = resample(raw, tf);
  const at = atr(b, ATRN);
  const { sess, lastOf, gapPct } = sessions(b, tf); const cut = gapMin < 1e9;
  const nSess = sess[sess.length - 1] + 1;

  // ---- CAUSAL S/R: confirm pivots as we advance; nearest active level PRICE above/below each close ----
  const resLevels: Level[] = [], supLevels: Level[] = [];
  const nrPrice = new Array(b.length).fill(NaN), nsPrice = new Array(b.length).fill(NaN);
  const addLevel = (arr: Level[], price: number, tol: number) => { for (const L of arr) { if (Math.abs(L.price - price) <= tol) { L.price = (L.price * L.touches + price) / (L.touches + 1); L.touches++; return; } } arr.push({ price, touches: 1 }); };
  for (let i = 0; i < b.length; i++) {
    const j = i - W;
    if (j >= W) {
      const tol = NEAR_ATR * (at[i] > 0 ? at[i] : b[i].c * 0.002);
      let isHigh = true, isLow = true;
      for (let k = j - W; k <= j + W; k++) { if (k === j) continue; if (b[k].h >= b[j].h) isHigh = false; if (b[k].l <= b[j].l) isLow = false; }
      if (isHigh) addLevel(resLevels, b[j].h, tol);
      if (isLow) addLevel(supLevels, b[j].l, tol);
    }
    let rBest = Infinity, rP = NaN, sBest = Infinity, sP = NaN;
    for (const L of resLevels) if (L.touches >= TOUCH_MIN && L.price >= b[i].c && L.price - b[i].c < rBest) { rBest = L.price - b[i].c; rP = L.price; }
    for (const L of supLevels) if (L.touches >= TOUCH_MIN && L.price <= b[i].c && b[i].c - L.price < sBest) { sBest = b[i].c - L.price; sP = L.price; }
    nrPrice[i] = rP; nsPrice[i] = sP;
  }

  const tradeable: number[] = []; for (let i = ATRN + 1; i < b.length - 1; i++) if (sess[i] === sess[i + 1] && at[i] > 0) tradeable.push(i);
  const sig: Record<string, number[]> = { rejShort: [], bncLong: [], brkLong: [], brkShort: [] };
  const ctrl: Record<string, number[]> = { rejShort: [], bncLong: [], brkLong: [], brkShort: [] };
  const mfe: Record<string, number[]> = { rejShort: [], bncLong: [], brkLong: [], brkShort: [], random: [] };
  const randSim = (dir: 1 | -1) => { const j = tradeable[Math.floor(rnd() * tradeable.length)]; return simulate(b, lastOf, j + 1, dir, STOP_ATR * at[j]); };

  for (const i of tradeable) {
    const sd = STOP_ATR * at[i];
    const rP = nrPrice[i], sP = nsPrice[i];
    // REJECTION short: high pierced the overhead resistance but the bar closed back below it (rejection wick)
    if (Number.isFinite(rP) && b[i].h >= rP && b[i].c < rP && b[i].c < b[i].o) { const t = simulate(b, lastOf, i + 1, -1, sd); if (t) { sig.rejShort.push(t.r); mfe.rejShort.push(t.mfe); for (let q = 0; q < NCTRL; q++) { const rc = randSim(-1); if (rc) ctrl.rejShort.push(rc.r); } } }
    // BOUNCE long: low pierced the support below but closed back above it
    if (Number.isFinite(sP) && b[i].l <= sP && b[i].c > sP && b[i].c > b[i].o) { const t = simulate(b, lastOf, i + 1, 1, sd); if (t) { sig.bncLong.push(t.r); mfe.bncLong.push(t.mfe); for (let q = 0; q < NCTRL; q++) { const rc = randSim(1); if (rc) ctrl.bncLong.push(rc.r); } } }
    // BREAKOUT long: this bar CLOSED above a resistance that was overhead on the prior bar (level crossed up)
    if (i > 0 && Number.isFinite(nrPrice[i - 1]) && b[i - 1].c <= nrPrice[i - 1] && b[i].c > nrPrice[i - 1] && b[i].c > b[i].o) { const t = simulate(b, lastOf, i + 1, 1, sd); if (t) { sig.brkLong.push(t.r); mfe.brkLong.push(t.mfe); for (let q = 0; q < NCTRL; q++) { const rc = randSim(1); if (rc) ctrl.brkLong.push(rc.r); } } }
    // BREAKOUT short: closed below a support that was underneath on the prior bar
    if (i > 0 && Number.isFinite(nsPrice[i - 1]) && b[i - 1].c >= nsPrice[i - 1] && b[i].c < nsPrice[i - 1] && b[i].c < b[i].o) { const t = simulate(b, lastOf, i + 1, -1, sd); if (t) { sig.brkShort.push(t.r); mfe.brkShort.push(t.mfe); for (let q = 0; q < NCTRL; q++) { const rc = randSim(-1); if (rc) ctrl.brkShort.push(rc.r); } } }
  }
  for (let q = 0; q < 4000; q++) { const rc = randSim(rnd() < 0.5 ? 1 : -1); if (rc) mfe.random.push(rc.mfe); }

  console.log(`\n══════ ${name}  (tf=${tf}m, ${b.length.toLocaleString()} candles, ${nSess} sessions, gap-cut>${gapMin}m) ══════`);
  const activeRes = resLevels.filter((L) => L.touches >= TOUCH_MIN).length, activeSup = supLevels.filter((L) => L.touches >= TOUCH_MIN).length;
  console.log(`Causal S/R levels (touches>=${TOUCH_MIN}): ${activeRes} resistance, ${activeSup} support`);
  if (cut) { const g = gapPct.filter((x) => x !== 0).map(Math.abs); if (g.length) console.log(`Session opening gaps: n=${g.length}, mean |gap| ${mean(g).toFixed(2)}%, max ${maxOf(g).toFixed(1)}%`); }
  console.log(`${"setup".padEnd(10)} ${"n".padStart(6)} ${"meanR".padStart(7)} ${"vs-rand t".padStart(9)} ${"MFE p50".padStart(8)} ${"MFE p95".padStart(8)} ${"MFE max".padStart(8)}  verdict`);
  const pct = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(p / 100 * (s.length - 1))]; };
  for (const key of ["rejShort", "bncLong", "brkLong", "brkShort"]) {
    if (sig[key].length < 100) { console.log(`${key.padEnd(10)} ${String(sig[key].length).padStart(6)}  too few`); continue; }
    const g = edgeVsRandom(sig[key], ctrl[key]); const ok = g.passes && g.setupMean > 0;
    console.log(`${key.padEnd(10)} ${String(sig[key].length).padStart(6)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(9)} ${pct(mfe[key], 50).toFixed(2).padStart(8)} ${pct(mfe[key], 95).toFixed(2).padStart(8)} ${maxOf(mfe[key]).toFixed(1).padStart(8)}  ${ok ? "✓✓ EDGE" : g.passes ? "✓ beats-rand≤0" : "✗ noise"}`);
  }
  const rm = mfe.random; const allSig = [...mfe.rejShort, ...mfe.bncLong, ...mfe.brkLong, ...mfe.brkShort];
  if (rm.length) console.log(`MFE random baseline: p50 ${pct(rm, 50).toFixed(2)}R  p95 ${pct(rm, 95).toFixed(2)}R  p99 ${pct(rm, 99).toFixed(2)}R  max ${maxOf(rm).toFixed(1)}R`);
  if (allSig.length) { const sorted = [...allSig].sort((a, b) => b - a); const top1 = sorted.slice(0, Math.ceil(sorted.length * 0.01)); const share = top1.reduce((a, b) => a + b, 0) / sorted.reduce((a, b) => a + b, 0) * 100; console.log(`"one big candle": top 1% of S/R entries by MFE hold ${share.toFixed(0)}% of ALL favourable movement — the tail is real; the t-stats say whether S/R TIMES it better than random.`); }
}

await analyse("NASDAQ", () => loadDuka("usatechidxusd"), 15, 10);
await analyse("S&P500", () => loadDuka("usa500idxusd"), 15, 10);
await analyse("BTC (24/7 no cut)", () => loadBin("BTCUSDT-1m.csv"), 5, 1e9);
await analyse("BTC 15m", () => loadBin("BTCUSDT-1m.csv"), 15, 1e9);
console.log(`\nREAD: S/R is judged by the SAME random control as everything else (D-146). "MFE max" is the biggest`);
console.log(`one-candle run that WAS available; "vs-rand t" is whether entering AT the level captured it better than`);
console.log(`a random entry with the same stop/target. Big MFE + t<=2 = the money was real, the S/R read was not.`);
