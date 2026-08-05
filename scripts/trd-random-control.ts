#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-random-control — GAP 4 (final): is the candidate's edge SIGNAL, or just drift/beta that ANY entry in
// that regime would have captured? The only honest test: a matched RANDOM-ENTRY control. For every real
// signal we take, fire N random entries in the SAME instrument, SAME regime, SAME direction, SAME stop/target
// mechanics — and compare. If the setup does not beat its own random control, the "setup" adds nothing and
// the number is regime drift. Deterministic PRNG (seeded) so the result is reproducible.
import { mean, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";
const DUKA = "data/duka";
const TF = 15, HORIZON = 48, STOP_ATR = 2, ATRN = 14, NCTRL = 5;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
interface Bar { t: number; o: number; h: number; l: number; c: number; day: string }
let seed = 20260805; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
async function loadDuka(p: string): Promise<Bar[]> { const out: Bar[] = []; const seen = new Set<number>(); for await (const e of Deno.readDir(DUKA)) { if (!e.name.startsWith(p) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DUKA}/${e.name}`); for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4], day: new Date(t).toISOString().slice(0, 10) }); } } return out.sort((a, b) => a.t - b.t); }
function resample(b: Bar[], tf: number): Bar[] { const bk = tf * 60000; const m = new Map<number, Bar>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const e = m.get(k); if (!e) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c, day: new Date(k).toISOString().slice(0, 10) }); else { e.h = Math.max(e.h, x.h); e.l = Math.min(e.l, x.l); e.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t); }
function atr(b: Bar[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi2(cl: number[]) { const n = 2; const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }

function priceTrade(b: Bar[], i: number, dir: 1 | -1, at: number[], vreg: string): number | null {
  const sd = STOP_ATR * at[i]; if (!(sd > b[i].c * 1e-4) || i + HORIZON + 1 >= b.length) return null;
  const entry = b[i + 1].o, stop = entry - dir * sd; let r: number | null = null;
  for (let k = i + 1; k <= i + HORIZON; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } }
  if (r === null) r = dir * (b[i + HORIZON].c - entry) / sd;
  return Math.max(-1.5, Math.min(r, 15)) - RCOST[vreg];
}
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

console.log(`RANDOM-ENTRY CONTROL — does the SETUP beat a random entry in the SAME regime/direction? (${NCTRL}× controls/signal)\n`);
for (const [mkt, pfx] of [["S&P500", "usa500idxusd"], ["Nasdaq", "usatechidxusd"]] as [string, string][]) {
  const b = resample(await loadDuka(pfx), TF); if (b.length < 1000) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r2 = rsi2(cl);
  const dayHiLo = new Map<string, { hi: number; lo: number }>(); { const byd = new Map<string, Bar[]>(); for (const x of b) (byd.get(x.day) ?? byd.set(x.day, []).get(x.day)!).push(x); const days = [...byd.keys()].sort(); for (let i = 1; i < days.length; i++) { const pv = byd.get(days[i - 1])!; dayHiLo.set(days[i], { hi: Math.max(...pv.map((z) => z.h)), lo: Math.min(...pv.map((z) => z.l)) }); } }
  // index bars by regime for control sampling
  const byReg: Record<string, number[]> = { calm: [], norm: [], stress: [] };
  for (let i = 210; i < b.length - HORIZON - 1; i++) { const v = vix.get(b[i].day) ?? 15; byReg[v < 15 ? "calm" : v < 25 ? "norm" : "stress"].push(i); }
  for (const [name, want, dir] of [["sweeprev-short-stress", "stress", -1], ["sweeprev-long-calm", "calm", 1], ["meanrev-long-calm", "calm", 1]] as [string, string, 1 | -1][]) {
    const sig: number[] = [], ctrl: number[] = []; let i = 210;
    while (i < b.length - HORIZON - 1) {
      const v = vix.get(b[i].day) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress"; const hl = dayHiLo.get(b[i].day);
      let fire = false;
      if (name === "sweeprev-short-stress") fire = !!hl && b[i].h > hl.hi && cl[i] < hl.hi && vreg === "stress";
      else if (name === "sweeprev-long-calm") fire = !!hl && b[i].l < hl.lo && cl[i] > hl.lo && vreg === "calm";
      else fire = r2[i] < 5 && vreg === "calm";
      if (!fire) { i++; continue; }
      const r = priceTrade(b, i, dir, at, vreg); if (r === null) { i++; continue; }
      sig.push(r);
      const pool = byReg[want]; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = priceTrade(b, j, dir, at, want); if (rc !== null) ctrl.push(rc); }
      i += HORIZON;
    }
    if (sig.length < 50) { console.log(`${mkt} ${name}: thin (n=${sig.length})`); continue; }
    const se = Math.sqrt(sampleStd(sig) ** 2 / sig.length + sampleStd(ctrl) ** 2 / ctrl.length);
    const diff = mean(sig) - mean(ctrl); const t = diff / se;
    console.log(`${mkt.padEnd(7)} ${name.padEnd(22)} setup ${(mean(sig) >= 0 ? "+" : "") + mean(sig).toFixed(3)}R (n=${sig.length})  vs RANDOM ${(mean(ctrl) >= 0 ? "+" : "") + mean(ctrl).toFixed(3)}R (n=${ctrl.length})  edge ${(diff >= 0 ? "+" : "") + diff.toFixed(3)}R  t=${t.toFixed(2)}  ${t > 2 ? "✓ SETUP ADDS VALUE" : "✗ NO EDGE over random entry in the same regime"}`);
  }
}
console.log(`\nREAD: if setup ≈ random, the number was REGIME DRIFT, not a setup. This is the final honesty gate before any capital.`);
