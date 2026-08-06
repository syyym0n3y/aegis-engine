#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-nasdaq-hf — the frequency lever. D-166/tenfold-math showed 10× is CERTAIN at safe risk but needs
// ~1,200+ trades; at 25/yr that is 49 years. The ONLY fix is more trades → high frequency. Nasdaq's
// volatility is the operator's target. This tests, on 15y of Dukascopy Nasdaq 1-min (usatechidxusd):
//   • the verified dip-buy (RSI<30 in uptrend) at 1m / 5m / 15m / 30m
//   • BOTH long and short (operator wants shorts too)
//   • TP = 3×SL, 2×ATR stop, pessimistic fills
//   • MEASURED cost per timeframe — the killer at high frequency: as the timeframe shrinks the ATR shrinks,
//     so a FIXED spread becomes a LARGER fraction of the stop (cost-in-R explodes). We compute it honestly.
//   • matched RANDOM control per D-146 — the only gate that has ever mattered
// Output: trades/YEAR (the whole point), hit%, gross R, cost R, NET R, and vs-random t.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const DIR = "data/duka";
// Nasdaq E-mini / index CFD realistic round-trip spread ≈ 0.25-0.75 index points on ~20000 level ≈ 0.5-1.5 bps.
// We use 1 bp (0.0001) of price as the round-trip spread — generous-to-us on a liquid index, honest to test.
const SPREAD_FRAC = 0.0001;
const TF = [["1m", 1], ["5m", 5], ["15m", 15], ["30m", 30]] as const;
const STOP_ATR = 2, TP_MULT = 3, ATRN = 14, NCTRL = 2;
let seed = 999983; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { t: number; o: number; h: number; l: number; c: number }
async function load1m(prefix: string): Promise<B[]> { const out: B[] = []; const seen = new Set<number>(); for await (const e of Deno.readDir(DIR)) { if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DIR}/${e.name}`); for (const l of txt.split("\n")) { const p = l.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } } return out.sort((a, b) => a.t - b.t); }
function resample(b: B[], tf: number): B[] { if (tf === 1) return b; const bk = tf * 60000; const m = new Map<number, B>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const e = m.get(k); if (!e) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { e.h = Math.max(e.h, x.h); e.l = Math.min(e.l, x.l); e.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t); }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }

const raw = await load1m("usatechidxusd");
if (raw.length < 100000) { console.log(`only ${raw.length} bars — need the Dukascopy Nasdaq pull`); Deno.exit(0); }
const years = (raw[raw.length - 1].t - raw[0].t) / (365.25 * 864e5);
console.log(`NASDAQ HIGH-FREQUENCY TEST — ${raw.length.toLocaleString()} 1-min bars, ${years.toFixed(1)}y, dip-buy RSI<30 in-trend, both directions\n`);
console.log(`${"TF".padEnd(4)} ${"dir".padEnd(5)} ${"trades".padStart(8)} ${"/year".padStart(7)} ${"hit%".padStart(6)} ${"grossR".padStart(7)} ${"costR".padStart(7)} ${"netR".padStart(7)} ${"vs-rand t".padStart(9)}  verdict`);
for (const [name, tf] of TF) {
  const b = resample(raw, tf); const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma[i] = s / 200; } }
  const MAXBARS = Math.max(12, Math.round(48 * 15 / tf)); // ~ same wall-clock hold across TFs
  const pool: number[] = []; for (let i = 210; i < b.length - MAXBARS - 1; i++) pool.push(i);
  const trade = (i: number, dir: 1 | -1): { r: number; costR: number } | null => {
    const sd = STOP_ATR * at[i]; if (!(sd > b[i].c * 1e-4) || i + 1 >= b.length) return null;
    const entry = b[i + 1].o, stop = entry - dir * sd, tgt = entry + dir * sd * TP_MULT;
    let r: number | null = null;
    for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } if (dir === 1 ? b[k].h >= tgt : b[k].l <= tgt) { r = TP_MULT; break; } }
    if (r === null) r = dir * (b[Math.min(i + MAXBARS, b.length - 1)].c - entry) / sd;
    const costR = (entry * SPREAD_FRAC * 2) / sd;   // round-trip spread as a fraction of the stop distance
    return { r, costR };
  };
  for (const [dname, dir] of [["long", 1], ["short", -1]] as const) {
    const sig: number[] = [], ctrl: number[] = []; const costs: number[] = [];
    for (let i = 210; i < b.length - MAXBARS - 1; i++) {
      if (!(at[i] > 0) || !(sma[i] > 0)) continue;
      const fire = dir === 1 ? (r14[i] < 30 && cl[i] > sma[i]) : (r14[i] > 70 && cl[i] < sma[i]);
      if (!fire) continue;
      const tr = trade(i, dir); if (!tr) continue;
      sig.push(tr.r - tr.costR); costs.push(tr.costR);
      for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = trade(j, dir); if (rc) ctrl.push(rc.r - rc.costR); }
    }
    if (sig.length < 100) { console.log(`${name.padEnd(4)} ${dname.padEnd(5)} ${String(sig.length).padStart(8)}  too few`); continue; }
    const g = edgeVsRandom(sig, ctrl);
    const hit = sig.filter((x) => x > TP_MULT - 1).length / sig.length * 100;
    const gross = mean(sig.map((x, i) => x + costs[i]));
    const ok = g.passes && g.setupMean > 0;
    console.log(`${name.padEnd(4)} ${dname.padEnd(5)} ${String(sig.length).padStart(8)} ${(sig.length / years).toFixed(0).padStart(7)} ${hit.toFixed(1).padStart(6)} ${((gross >= 0 ? "+" : "") + gross.toFixed(3)).padStart(7)} ${mean(costs).toFixed(3).padStart(7)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(9)}  ${ok ? "✓✓ beats random + profitable" : g.passes ? "✓ beats random, loses money" : "✗ no edge"}`);
  }
}
console.log(`\nREAD: "/year" is the frequency lever — the whole reason for going high-frequency (10× needs ~1,200 trades).`);
console.log(`But watch "costR": as the timeframe shrinks the ATR shrinks and the fixed spread eats a LARGER share of`);
console.log(`each trade. A setup can beat random AND still lose money once the real cost of trading fast is charged.`);
