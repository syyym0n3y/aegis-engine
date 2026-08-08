#!/usr/bin/env -S deno run --allow-read
// trd-crypto-gate — the full sweep flagged 4 crypto 5m cells past the random control; BTC-5m-short hit t=6.81.
// Before ANY of that is called an edge it must clear the anti-fooling gates that killed everything else:
//   1. TRIAL DEFLATION — 92 cells at t>=2 ⇒ ~5 false positives expected. Bonferroni t threshold = ~3.1.
//   2. BOTH-HALVES SIGN STABILITY (D-155) — split the history in two; the edge must be same-sign AND
//      beat random in BOTH halves. A whole-sample t means nothing if it lives in one regime.
//   3. WALK-FORWARD OOS — select on the FIRST 60%, confirm on the untouched LAST 40%.
// Only a cell that survives all three earns forward paper confirmation. Everything else is a sweep artifact.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const STOP_ATR = 2, TP_MULT = 3, NCTRL = 3, SPREAD_FRAC = 0.0001, TF = 5;
let seed = 424242; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { t: number; o: number; h: number; l: number; c: number }
const norm = (t: number) => t > 1e15 ? Math.floor(t / 1000) : t;
async function loadBinance(file: string): Promise<B[]> { const out: B[] = []; const seen = new Set<number>(); for (const l of (await Deno.readTextFile(`data/binance/${file}`)).split("\n")) { const p = l.split(","); const t = norm(+p[0]); if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } return out.sort((a, b) => a.t - b.t); }
function resample(b: B[], tf: number): B[] { const bk = tf * 60000; const m = new Map<number, B>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const e = m.get(k); if (!e) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { e.h = Math.max(e.h, x.h); e.l = Math.min(e.l, x.l); e.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t); }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }

// evaluate the dip/rip setup over a bar-index RANGE [lo,hi); returns setup R-multiples, matched random controls
function evalRange(b: B[], at: number[], r14: number[], sma: number[], dir: 1 | -1, lo: number, hi: number, MAXBARS: number) {
  const pool: number[] = []; for (let i = Math.max(210, lo); i < Math.min(hi, b.length - MAXBARS - 1); i++) pool.push(i);
  const trade = (i: number): number | null => {
    const sd = STOP_ATR * at[i]; if (!(sd > b[i].c * 1e-4) || i + 1 >= b.length) return null;
    const entry = b[i + 1].o, stop = entry - dir * sd, tgt = entry + dir * sd * TP_MULT; let r: number | null = null;
    for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } if (dir === 1 ? b[k].h >= tgt : b[k].l <= tgt) { r = TP_MULT; break; } }
    if (r === null) r = dir * (b[Math.min(i + MAXBARS, b.length - 1)].c - entry) / sd;
    return r - (entry * SPREAD_FRAC * 2) / sd;
  };
  const sig: number[] = [], ctrl: number[] = [];
  for (const i of pool) {
    if (!(at[i] > 0) || !(sma[i] > 0)) continue;
    const fire = dir === 1 ? (r14[i] < 30 && b[i].c > sma[i]) : (r14[i] > 70 && b[i].c < sma[i]);
    if (!fire) continue;
    const tr = trade(i); if (tr === null) continue; sig.push(tr);
    for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = trade(j); if (rc !== null) ctrl.push(rc); }
  }
  return { sig, ctrl };
}

console.log(`CRYPTO GATE — the 4 cells the sweep flagged, put through trial-deflation + both-halves + walk-forward OOS.`);
console.log(`Bonferroni t for 92 trials ≈ 3.1. Both halves must be same-sign AND beat random. OOS = last 40%, untouched.\n`);
console.log(`${"cell".padEnd(16)} ${"full t".padStart(7)} ${"H1 mean/t".padStart(14)} ${"H2 mean/t".padStart(14)} ${"OOS mean/t".padStart(14)}  survives?`);
for (const [file, sym] of [["BTCUSDT-1m.csv", "BTC"], ["ETHUSDT-1m.csv", "ETH"]] as const) {
  const raw = await loadBinance(file); const b = resample(raw, TF);
  const cl = b.map((x) => x.c); const at = atr(b, 14); const r14 = rsi(cl, 14);
  const sma = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma[i] = s / 200; } }
  const MAXBARS = Math.max(12, Math.round(48 * 15 / TF));
  const mid = Math.floor(b.length / 2), oosLo = Math.floor(b.length * 0.6);
  for (const [dname, dir] of [["long", 1], ["short", -1]] as const) {
    const full = evalRange(b, at, r14, sma, dir, 210, b.length, MAXBARS);
    const h1 = evalRange(b, at, r14, sma, dir, 210, mid, MAXBARS);
    const h2 = evalRange(b, at, r14, sma, dir, mid, b.length, MAXBARS);
    const oos = evalRange(b, at, r14, sma, dir, oosLo, b.length, MAXBARS);
    if (full.sig.length < 100) continue;
    const gF = edgeVsRandom(full.sig, full.ctrl), g1 = edgeVsRandom(h1.sig, h1.ctrl), g2 = edgeVsRandom(h2.sig, h2.ctrl), gO = edgeVsRandom(oos.sig, oos.ctrl);
    const sameSign = g1.setupMean > 0 && g2.setupMean > 0;
    const bothBeat = g1.passes && g2.passes;
    const deflated = gF.tStat >= 3.1;
    const oosOk = gO.passes && gO.setupMean > 0;
    const survives = deflated && sameSign && bothBeat && oosOk;
    const cell = `${sym}/5m/${dname}`;
    console.log(`${cell.padEnd(16)} ${gF.tStat.toFixed(2).padStart(7)} ${((g1.setupMean >= 0 ? "+" : "") + g1.setupMean.toFixed(3) + "/" + g1.tStat.toFixed(1)).padStart(14)} ${((g2.setupMean >= 0 ? "+" : "") + g2.setupMean.toFixed(3) + "/" + g2.tStat.toFixed(1)).padStart(14)} ${((gO.setupMean >= 0 ? "+" : "") + gO.setupMean.toFixed(3) + "/" + gO.tStat.toFixed(1)).padStart(14)}  ${survives ? "✓✓ SURVIVES ALL GATES" : !deflated ? "✗ fails deflation" : !sameSign ? "✗ sign flips across halves" : !bothBeat ? "✗ one half is noise" : "✗ OOS fails"}`);
  }
}
console.log(`\nNOTE ON REALISM: crypto 5m ATR is large vs the 1bp spread, so cost-in-R is tiny (~0.06R) — the one place`);
console.log(`the cost wall does NOT bite. The open question a survivor raises: does a REAL crypto taker fee (~5–10bp/side`);
console.log(`on retail spot) reopen it? At 5m that is ~0.3–0.6R — re-charge before believing. Forward paper is the judge.`);
