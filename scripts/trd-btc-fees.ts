#!/usr/bin/env -S deno run --allow-read
// trd-btc-fees — BTC/5m/short survived every statistical gate at a 1bp spread. The ONLY question left before
// it is real: does it survive a REALISTIC crypto fee? Retail spot taker ≈ 10bp/side; BNB-discounted ≈ 7.5bp;
// futures taker ≈ 4-5bp; patient maker (limit entry) ≈ 1-2bp. We recharge the SAME trades at each level and
// re-test vs the random control. If it dies at taker fees, it needs limit execution to live — say so plainly.
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const STOP_ATR = 2, TP_MULT = 3, NCTRL = 3, TF = 5, MAXBARS = Math.max(12, Math.round(48 * 15 / TF));
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { t: number; o: number; h: number; l: number; c: number }
const norm = (t: number) => t > 1e15 ? Math.floor(t / 1000) : t;
const raw: B[] = []; { const seen = new Set<number>(); for (const l of (await Deno.readTextFile("data/binance/BTCUSDT-1m.csv")).split("\n")) { const p = l.split(","); const t = norm(+p[0]); if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); raw.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } raw.sort((a, b) => a.t - b.t); }
const bk = TF * 60000, m = new Map<number, B>(); for (const x of raw) { const k = Math.floor(x.t / bk) * bk; const e = m.get(k); if (!e) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { e.h = Math.max(e.h, x.h); e.l = Math.min(e.l, x.l); e.c = x.c; } }
const b = [...m.values()].sort((a, z) => a.t - z.t); const cl = b.map((x) => x.c);
const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const at = new Array(b.length).fill(NaN); { let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= 14) s -= tr[i - 14]; if (i >= 13) at[i] = s / 14; } }
const r14 = new Array(cl.length).fill(NaN); { let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= 14) { ag += g; al += l; if (i === 14) { ag /= 14; al /= 14; r14[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; r14[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } }
const sma = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma[i] = s / 200; } }
const dir = -1; // short
const pool: number[] = []; for (let i = 210; i < b.length - MAXBARS - 1; i++) pool.push(i);
function grossTrade(i: number): { r: number; stopFrac: number } | null {
  const sd = STOP_ATR * at[i]; if (!(sd > b[i].c * 1e-4) || i + 1 >= b.length) return null;
  const entry = b[i + 1].o, stop = entry - dir * sd, tgt = entry + dir * sd * TP_MULT; let r: number | null = null;
  for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } if (dir === 1 ? b[k].h >= tgt : b[k].l <= tgt) { r = TP_MULT; break; } }
  if (r === null) r = dir * (b[Math.min(i + MAXBARS, b.length - 1)].c - entry) / sd;
  return { r, stopFrac: sd / entry };  // stopFrac lets us convert a %-fee into R
}
const sigRaw: { r: number; stopFrac: number }[] = []; const ctrlRaw: { r: number; stopFrac: number }[] = [];
for (const i of pool) { if (!(at[i] > 0) || !(sma[i] > 0)) continue; if (!(r14[i] > 70 && cl[i] < sma[i])) continue; const t = grossTrade(i); if (!t) continue; sigRaw.push(t); for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = grossTrade(j); if (rc) ctrlRaw.push(rc); } }
console.log(`BTC/5m/short — recharge at realistic fees. n=${sigRaw.length} setups, ${sigRaw.length / (b.length / (525600 / TF))} … over ${(b.length * TF / 525600).toFixed(1)}y`);
console.log(`Gross (0 fee): mean ${mean(sigRaw.map(s => s.r)).toFixed(3)}R\n`);
console.log(`${"fee/side".padStart(9)} ${"costR".padStart(7)} ${"net mean".padStart(9)} ${"vs-rand t".padStart(10)} ${"trades/yr".padStart(10)}  verdict`);
const yrs = b.length * TF / 525600;
for (const bpSide of [0, 2, 5, 7.5, 10]) {
  const f = bpSide / 10000; // fraction per side
  const cost = (s: { stopFrac: number }) => (2 * f) / s.stopFrac; // round-trip fee as fraction of stop = R cost
  const sig = sigRaw.map(s => s.r - cost(s)); const ctrl = ctrlRaw.map(s => s.r - cost(s));
  const g = edgeVsRandom(sig, ctrl); const avgCost = mean(sigRaw.map(cost));
  const ok = g.passes && g.setupMean > 0;
  console.log(`${(bpSide + "bp").padStart(9)} ${avgCost.toFixed(3).padStart(7)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(9)} ${g.tStat.toFixed(2).padStart(10)} ${(sigRaw.length / yrs).toFixed(0).padStart(10)}  ${ok ? "✓ still an edge" : "✗ fee kills it"}`);
}
console.log(`\nREAD: 10bp/side = Binance retail spot taker. 7.5bp = with BNB discount. 4-5bp ≈ futures taker. 1-2bp = patient`);
console.log(`limit (maker) fills — but a mean-reversion SHORT that needs to hit at RSI>70 may not get filled passively.`);
