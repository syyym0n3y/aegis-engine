#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-robustness — the last honest stone before promotion: is rip-short a robust PLATEAU or an overfit SPIKE?
// We tested ONE param set (RSI70/200MA/2ATR/3R). Here we sweep the neighbourhood on the SAME survivorship-free-ish
// basket (Yahoo daily, incl. names that go below 200MA), charge REAL costs (2bp spread + 8%/yr borrow per hold-day),
// and judge every variant against a matched random control (D-146). Then we run PBO via CSCV (Bailey/López de Prado)
// across all variants — the one gate in the honest-stats core we had never fired. PLATEAU (most variants positive +
// significant, low PBO) => real. SPIKE (only the exact knobs work, high PBO) => overfit, do NOT promote.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { pboCSCV, mean } from "../supabase/functions/_shared/trd-stats.ts";

const BASKET = ["SPY", "QQQ", "IWM", "XLE", "XLF", "SMH", "AAPL", "NVDA", "TSLA", "AMD"];
const RSI_THRESH = [65, 70, 75];
const MA_LEN = [150, 200];
const STOP_ATR = [1.5, 2, 2.5];
const TP_MULT = [2, 3, 4];            // 3×2×3×3 = 54 variants
const ATRN = 14, RSIN = 14, MAX_HOLD = 20, SPREAD_BPS = 2, BORROW_ANNUAL = 0.08;
let seed = 4242; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
    const t = res.timestamp, q = res.indicators.quote[0]; const o: B[] = [];
    for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); }
    return o;
  } catch { return []; }
}
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
function sma(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= n) s -= cl[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }

// one short trade from bar i (entry i+1 open), stop=stopATR*ATR, TP=tp*stop, cap MAX_HOLD; cost = 2bp spread + borrow/hold-day
function simShort(b: B[], at: number[], i: number, stopAtr: number, tp: number): { r: number; month: string } | null {
  const sd = stopAtr * at[i]; if (!(sd > b[i].c * 1e-4) || i + 1 >= b.length) return null;
  const entry = b[i + 1].o, stop = entry + sd, tgt = entry - sd * tp;
  let gross: number | null = null, held = 0;
  for (let k = i + 1; k < Math.min(i + 1 + MAX_HOLD, b.length); k++) { held = k - i; if (b[k].h >= stop) { gross = -1; break; } if (b[k].l <= tgt) { gross = tp; break; } }
  if (gross === null) { const last = Math.min(i + MAX_HOLD, b.length - 1); held = last - i; gross = (entry - b[last].c) / sd; }
  const cost = (entry * (SPREAD_BPS / 10000) * 2) / sd + (entry * BORROW_ANNUAL * (held / 365)) / sd;
  return { r: gross - cost, month: b[i + 1].d.slice(0, 7) };
}

const data: Record<string, { b: B[]; at: number[]; r14: number[]; smas: Record<number, number[]> }> = {};
for (const sym of BASKET) { const b = await daily(sym); if (b.length < 600) continue; const cl = b.map((x) => x.c); const smas: Record<number, number[]> = {}; for (const m of MA_LEN) smas[m] = sma(cl, m); data[sym] = { b, at: atr(b, ATRN), r14: rsi(cl, RSIN), smas }; }
console.log(`ROBUSTNESS + PBO — rip-short daily, ${Object.keys(data).length} names, real cost (2bp + 8%/yr borrow), 54 param variants\n`);

interface V { key: string; rsiT: number; maL: number; stopA: number; tp: number; n: number; edge: number; t: number; monthly: Record<string, number[]> }
const variants: V[] = [];
for (const rsiT of RSI_THRESH) for (const maL of MA_LEN) for (const stopA of STOP_ATR) for (const tp of TP_MULT) {
  const sig: number[] = [], ctrl: number[] = []; const monthly: Record<string, number[]> = {};
  for (const sym of Object.keys(data)) {
    const { b, at, r14, smas } = data[sym]; const ma = smas[maL];
    const pool: number[] = []; for (let i = maL + 1; i < b.length - MAX_HOLD - 1; i++) if (at[i] > 0 && ma[i] > 0) pool.push(i);
    for (const i of pool) {
      if (r14[i] > rsiT && b[i].c < ma[i]) { const t = simShort(b, at, i, stopA, tp); if (t) { sig.push(t.r); (monthly[t.month] ??= []).push(t.r); for (let q = 0; q < 2; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = simShort(b, at, j, stopA, tp); if (rc) ctrl.push(rc.r); } } }
    }
  }
  const g = edgeVsRandom(sig, ctrl);
  variants.push({ key: `RSI${rsiT}/MA${maL}/${stopA}ATR/${tp}R`, rsiT, maL, stopA, tp, n: sig.length, edge: g.edge, t: g.tStat, monthly });
}

// plateau check
const positive = variants.filter((v) => v.edge > 0);
const significant = variants.filter((v) => v.t >= 2 && v.edge > 0);
const strong = variants.filter((v) => v.t >= 3 && v.edge > 0);
variants.sort((a, b) => b.t - a.t);
console.log(`${"variant".padEnd(24)} ${"n".padStart(6)} ${"edgeR".padStart(8)} ${"t".padStart(7)}`);
for (const v of variants.slice(0, 8)) console.log(`${v.key.padEnd(24)} ${String(v.n).padStart(6)} ${(v.edge >= 0 ? "+" : "") + v.edge.toFixed(3).padStart(7)} ${v.t.toFixed(2).padStart(7)}`);
console.log(`... (worst) ...`);
for (const v of variants.slice(-3)) console.log(`${v.key.padEnd(24)} ${String(v.n).padStart(6)} ${(v.edge >= 0 ? "+" : "") + v.edge.toFixed(3).padStart(7)} ${v.t.toFixed(2).padStart(7)}`);
console.log(`\nPLATEAU CHECK: ${positive.length}/54 variants positive; ${significant.length}/54 t>=2; ${strong.length}/54 t>=3.`);

// PBO via CSCV — build a months × variants matrix of monthly mean net R (missing month = 0)
const allMonths = [...new Set(variants.flatMap((v) => Object.keys(v.monthly)))].sort();
const M: number[][] = allMonths.map((m) => variants.map((v) => v.monthly[m] ? mean(v.monthly[m]) : 0));
const { pbo, nCombos } = pboCSCV(M, 10);
console.log(`\nPBO via CSCV: ${(pbo * 100).toFixed(0)}% over ${nCombos} splits, ${allMonths.length} months × ${variants.length} variants.`);
console.log(pbo < 0.5 ? `PBO < 50% → the IS-best variant tends to stay above-median OOS: NOT overfit selection.` : `PBO >= 50% → selecting the best variant is no better than chance: OVERFIT. Do not trust the point estimate.`);
console.log(`\nVERDICT: ${strong.length >= 27 && pbo < 0.5 ? "PLATEAU — rip-short is robust to its parameters; the edge is real, not knob-tuned." : significant.length >= 27 && pbo < 0.5 ? "MOSTLY PLATEAU — broadly robust, some param sensitivity; acceptable." : "SPIKE / FRAGILE — edge concentrates in few params or PBO high; treat rip-short as tentative, do NOT size up."}`);
