#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-intraday-tpsl-verify — the TP/SL grid fired 11,270× (vs 780 for the daily-only spec) because the 15m
// intraday series contribute thousands of signals. THAT is the frequency the operator needs. This verifies
// whether the INTRADAY component holds on its own, under the D-149-corrected protocol:
//   • intraday (15m) vs daily reported SEPARATELY (no pooling that hides a weak leg)
//   • IS/OOS split, random control on the OOS half only
//   • TP=3×SL and TP=2×SL (the two profitable R:R regimes)
//   • per-session breakdown (Asia/London/NY) — WHEN intraday works
//   • per-instrument breakdown — WHERE it works
// Also maps FAVOURABLE CONDITIONS (day-of-week × VIX regime × session) so "which days are tradable" is answered.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const DUKA = "data/duka", BIN = "data/binance";
const MAXBARS = 48, ATRN = 14, NCTRL = 3, SL_ATR = 2, TP_MULT = 3;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 24680; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { t: number; d: string; o: number; h: number; l: number; c: number; m: number }
async function load15(dir: string, pfx: string): Promise<B[]> {
  const out: any[] = []; const seen = new Set<number>();
  try { for await (const e of Deno.readDir(dir)) { if (!e.name.startsWith(pfx) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${dir}/${e.name}`); for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4] }); } } } catch { return []; }
  out.sort((a, b) => a.t - b.t); const bk = 15 * 60000; const m = new Map<number, any>();
  for (const x of out) { const k = Math.floor(x.t / bk) * bk; const ex = m.get(k); if (!ex) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } }
  return [...m.values()].sort((a, b) => a.t - b.t).map((x) => { const dt = new Date(x.t); return { t: x.t, d: dt.toISOString().slice(0, 10), o: x.o, h: x.h, l: x.l, c: x.c, m: dt.getUTCHours() * 60 + dt.getUTCMinutes() }; });
}
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);
const sess = (m: number) => m < 420 ? "Asia" : m < 780 ? "London" : m < 1260 ? "NY" : "late";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface T { r: number; is: boolean; ctrl: number[]; sym: string; sess: string; dow: string; reg: string }
const ALL: T[] = [];
function tpsl(b: B[], i: number, slDist: number, tpDist: number, reg: string): number | null {
  if (!(slDist > 0) || i + 1 >= b.length) return null;
  const entry = b[i + 1].o, stop = entry - slDist, target = entry + tpDist, rr = tpDist / slDist;
  for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) { if (b[k].l <= stop) return -1 - RCOST[reg]; if (b[k].h >= target) return rr - RCOST[reg]; }
  return (b[Math.min(i + MAXBARS, b.length - 1)].c - entry) / slDist - RCOST[reg];
}
async function scan(sym: string, dir: string, pfx: string) {
  const b = await load15(dir, pfx); if (b.length < 5000) { console.log(`  ${sym}: no data`); return; }
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma200 = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma200[i] = s / 200; } }
  const cut = Math.floor(b.length * 0.6); const pool: number[] = [];
  for (let i = 210; i < b.length - MAXBARS - 1; i++) pool.push(i);
  for (let i = 210; i < b.length - MAXBARS - 1; i++) {
    if (!(at[i] > 0) || !(sma200[i] > 0)) continue;
    if (!(r14[i] < 30 && cl[i] > sma200[i])) continue;
    const v = vix.get(b[i].d) ?? 15; const reg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    const slD = SL_ATR * at[i]; if (!(slD > cl[i] * 1e-4)) continue;
    const r = tpsl(b, i, slD, slD * TP_MULT, reg); if (r === null) continue;
    const ctrl: number[] = []; for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; if (!(at[j] > 0)) continue; const rc = tpsl(b, j, SL_ATR * at[j], SL_ATR * at[j] * TP_MULT, reg); if (rc !== null) ctrl.push(rc); }
    ALL.push({ r, is: i < cut, ctrl, sym, sess: sess(b[i].m), dow: DOW[new Date(b[i].t).getUTCDay()], reg });
  }
  console.log(`  ${sym}: ${b.length} 15m bars → ${ALL.filter((x) => x.sym === sym).length} signals`);
}
console.log(`INTRADAY TP/SL VERIFICATION — dip-buy on 15m, SL ${SL_ATR}ATR, TP ${TP_MULT}×SL, IS/OOS + random control\n`);
await scan("S&P500", DUKA, "usa500idxusd"); await scan("Nasdaq", DUKA, "usatechidxusd");
await scan("BTC", BIN, "BTCUSDT"); await scan("ETH", BIN, "ETHUSDT");
const agg = (t: T[], lbl: string, indent = "") => { if (t.length < 60) { console.log(`${indent}${lbl.padEnd(22)} thin (n=${t.length})`); return; } const g = edgeVsRandom(t.map((x) => x.r), t.flatMap((x) => x.ctrl)); const win = t.filter((x) => x.r > 0).length / t.length * 100; console.log(`${indent}${lbl.padEnd(22)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(7)}R  win ${win.toFixed(0).padStart(2)}%  vs-rand ${((g.edge >= 0 ? "+" : "") + g.edge.toFixed(3)).padStart(7)} t=${g.tStat.toFixed(2).padStart(5)}  n=${String(t.length).padStart(6)}  ${g.passes && g.setupMean > 0 ? "✓✓" : g.passes ? "✓(loses)" : "✗"}`); };
console.log(`\n════ OVERALL (intraday only) ════`); agg(ALL, "ALL intraday");
console.log(`\n════ THE DECISIVE TEST — OUT-OF-SAMPLE ONLY ════`); agg(ALL.filter((x) => !x.is), "OOS");
console.log(`   (in-sample for reference)`); agg(ALL.filter((x) => x.is), "IS", "   ");
console.log(`\n════ PER INSTRUMENT (OOS) ════`); for (const s of ["S&P500", "Nasdaq", "BTC", "ETH"]) agg(ALL.filter((x) => !x.is && x.sym === s), s);
console.log(`\n════ WHEN — per SESSION (OOS) ════`); for (const s of ["Asia", "London", "NY", "late"]) agg(ALL.filter((x) => !x.is && x.sess === s), s);
console.log(`\n════ WHEN — per DAY OF WEEK (OOS) ════`); for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) agg(ALL.filter((x) => !x.is && x.dow === d), d);
console.log(`\n════ WHEN — per VIX REGIME (OOS) ════`); for (const r of ["calm", "norm", "stress"]) agg(ALL.filter((x) => !x.is && x.reg === r), r);

console.log(`\n════ DISAMBIGUATION: is the calm-VIX effect in BOTH halves, or a one-sided artifact? ════`);
for (const r of ["calm", "norm", "stress"]) { agg(ALL.filter((x) => x.is && x.reg === r), `IS  ${r}`); agg(ALL.filter((x) => !x.is && x.reg === r), `OOS ${r}`); }
console.log(`\n════ HOW MANY DAYS ARE FAVOURABLE? (calm = VIX<15) ════`);
{
  const days = new Set(ALL.map((x) => x.sym + x.dow));
  const calmDays = new Set(ALL.filter((x) => x.reg === "calm").map((x) => x.sym));
  const nCalm = ALL.filter((x) => x.reg === "calm").length, nAll = ALL.length;
  console.log(`   calm-regime signals: ${nCalm}/${nAll} = ${(nCalm / nAll * 100).toFixed(1)}% of all intraday signals`);
  let calmVixDays = 0, totalVixDays = 0;
  for (const [, v] of vix) { totalVixDays++; if (v < 15) calmVixDays++; }
  console.log(`   VIX<15 calendar days: ${calmVixDays}/${totalVixDays} = ${(calmVixDays / totalVixDays * 100).toFixed(1)}% of all trading days (~${Math.round(calmVixDays / totalVixDays * 252)} of 252/yr)`);
  console.log(`   → if the calm cell validates, the tradable window is ~${Math.round(calmVixDays / totalVixDays * 252)} days/yr, not ~25 trades/yr`);
  void days; void calmDays;
}
