#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-grand-sweep — the exhaustive matrix: every core METHOD × every TIMEFRAME (1m→4h) × both DIRECTIONS ×
// CONDITIONS (trend, session, VIX regime) × instruments, on the deep intraday data. Each cell gated by
// deflated Sharpe over the FULL trial count — because searching harder without deflation IS how retail fools
// itself. Output: which (if any) setups survive, and under what condition/direction. Indices: 15y Dukascopy
// 1m resampled. Per ANALYSIS_CONTRACT: number + N + OOS + DSR over all trials; small-N flagged.
import { mean, sharpe, sampleStd, deflatedSharpe } from "../supabase/functions/_shared/trd-stats.ts";
const DIR = "data/duka";
const TFS: [string, number, number][] = [["1m", 1, 480], ["5m", 5, 96], ["15m", 15, 48], ["30m", 30, 24], ["1h", 60, 16], ["2h", 120, 8], ["4h", 240, 6]]; // tf,min,horizon(bars)
const STOP_ATR = 2, ATRN = 14, COST = 0.05;
interface Bar { t: number; o: number; h: number; l: number; c: number; m: number; day: string; }

async function loadDuka(prefix: string): Promise<Bar[]> {
  const out: Bar[] = []; const seen = new Set<number>();
  for await (const e of Deno.readDir(DIR)) { if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DIR}/${e.name}`); for (const l of txt.split("\n")) { const p = l.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); const d = new Date(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } }
  return out.sort((a, b) => a.t - b.t);
}
function resample(b: Bar[], tf: number): Bar[] { if (tf === 1) return b; const bk = tf * 60000; const map = new Map<number, Bar>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const ex = map.get(k); if (!ex) { const d = new Date(k); map.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c, m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } } return [...map.values()].sort((a, b) => a.t - b.t); }
function rsi(cl: number[], n: number): number[] { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
function ema(cl: number[], n: number): number[] { const k = 2 / (n + 1); const o: number[] = []; let p = cl[0]; for (let i = 0; i < cl.length; i++) { p = i === 0 ? cl[0] : cl[i] * k + p * (1 - k); o.push(p); } return o; }
function atr(b: Bar[], n: number): number[] { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
const sess = (m: number) => m < 420 ? "Asia" : m < 780 ? "London" : "NY";

interface T { r: number; is: boolean; }
const cells = new Map<string, T[]>();
function add(key: string, r: number, is: boolean) { let a = cells.get(key); if (!a) { a = []; cells.set(key, a); } a.push({ r: r - COST, is }); }

function runTF(inst: string, b: Bar[], tf: string, H: number, vix: Map<string, number>) {
  if (b.length < 500) return; const cl = b.map((x) => x.c); const r2 = rsi(cl, 2); const e50 = ema(cl, 50); const at = atr(b, ATRN);
  const sma200 = (i: number) => { if (i < 200) return NaN; let s = 0; for (let k = i - 200; k < i; k++) s += cl[k]; return s / 200; };
  const cut = Math.floor(b.length * 0.6);
  // prior-session hi/lo for the TBR sweep (per day)
  const dayHiLo = new Map<string, { hi: number; lo: number }>(); { const byd = new Map<string, Bar[]>(); for (const x of b) (byd.get(x.day) ?? byd.set(x.day, []).get(x.day)!).push(x); const days = [...byd.keys()].sort(); for (let i = 1; i < days.length; i++) { const pv = byd.get(days[i - 1])!; dayHiLo.set(days[i], { hi: Math.max(...pv.map((z) => z.h)), lo: Math.min(...pv.map((z) => z.l)) }); } }
  for (let i = 210; i < b.length - H - 1; i++) {
    if (!(at[i] > 0)) continue; const ma = sma200(i); if (!(ma > 0)) continue;
    const trend = cl[i] > ma ? "up" : "dn"; const ss = sess(b[i].m); const v = vix.get(b[i].day) ?? 15; const vreg = v < 15 ? "calmVIX" : v < 25 ? "normVIX" : "stressVIX";
    const fire: [string, 1 | -1][] = [];
    if (r2[i] < 5) fire.push(["meanrev", 1]); if (r2[i] > 95) fire.push(["meanrev", -1]);
    if (cl[i] > Math.max(...cl.slice(i - 20, i))) fire.push(["breakout", 1]); if (cl[i] < Math.min(...cl.slice(i - 20, i))) fire.push(["breakout", -1]);
    if (cl[i] > e50[i] && cl[i] < cl[i - 1]) fire.push(["pullback", 1]); if (cl[i] < e50[i] && cl[i] > cl[i - 1]) fire.push(["pullback", -1]);
    const hl = dayHiLo.get(b[i].day); if (hl) { if (b[i].h > hl.hi && cl[i] < hl.hi) fire.push(["sweeprev", -1]); if (b[i].l < hl.lo && cl[i] > hl.lo) fire.push(["sweeprev", 1]); }
    const stopDist = STOP_ATR * at[i];
    if (!(stopDist > b[i].c * 1e-4)) continue; // reject degenerate near-zero stops (tiny-ATR R-explosion)
    for (const [strat, dir] of fire) {
      const entry = b[i + 1].o, stop = entry - dir * stopDist; let r: number | null = null;
      for (let k = i + 1; k <= i + H; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } }
      if (r === null) r = dir * (b[i + H].c - entry) / stopDist;
      r = Math.max(-1.5, Math.min(r, 15)); // cap: no single fill counts beyond +15R (slippage/gap realism)
      const d = dir === 1 ? "L" : "S";
      // record at several condition granularities (each is a legitimately-counted trial)
      add(`${strat}|${tf}|${d}|ALL`, r, i < cut);
      add(`${strat}|${tf}|${d}|trend:${trend}`, r, i < cut);
      add(`${strat}|${tf}|${d}|sess:${ss}`, r, i < cut);
      add(`${strat}|${tf}|${d}|${vreg}`, r, i < cut);
    }
  }
}

// VIX daily
const vixB = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixB?.chart?.result?.[0]?.timestamp as number[]; const vc = vixB?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); if (vt) for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

for (const [inst, prefix] of [["S&P500", "usa500idxusd"], ["Nasdaq", "usatechidxusd"]]) {
  const raw = await loadDuka(prefix); console.log(`${inst}: ${raw.length} 1m bars — sweeping ${TFS.length} TFs...`);
  for (const [tf, m, H] of TFS) runTF(inst, resample(raw, m), tf, H, vix);
}

// aggregate + gate
const agg = (t: T[]) => `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}R/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/n=${t.length}`;
const rows = [...cells.entries()].filter(([, t]) => t.length >= 100).map(([k, t]) => { const oos = t.filter((x) => !x.is); return { k, t, exp: mean(t.map((x) => x.r)), oosExp: oos.length ? mean(oos.map((x) => x.r)) : NaN, sr: sharpe(t.map((x) => x.r)), n: t.length, oosN: oos.length }; });
const nTrials = rows.length;
console.log(`\n════ GRAND SWEEP — ${nTrials} cells (strategy×TF×direction×condition), each n≥100 ════`);
console.log(`Top 15 by OOS expectancy (of ${nTrials} trials):`);
for (const r of [...rows].sort((a, b) => b.oosExp - a.oosExp).slice(0, 15)) console.log(`  ${r.k.padEnd(30)} ALL ${agg(r.t)}  OOS ${(r.oosExp >= 0 ? "+" : "") + r.oosExp.toFixed(3)}R/n=${r.oosN}`);
// deflate the best-Sharpe cell over ALL trials
const skewKurt = (a: number[]) => { const mm = mean(a), s = sampleStd(a); if (!(s > 0)) return [0, 3]; let sk = 0, ku = 0; for (const x of a) { const z = (x - mm) / s; sk += z ** 3; ku += z ** 4; } return [sk / a.length, ku / a.length]; };
const trialSharpes = rows.map((r) => r.sr); const varT = sampleStd(trialSharpes) ** 2 || 0.25;
const best = [...rows].sort((a, b) => b.sr - a.sr)[0]; const bt = best.t.map((x) => x.r); const [sk, ku] = skewKurt(bt);
const dsr = deflatedSharpe(sharpe(bt), bt.length, sk, ku, nTrials, varT);
console.log(`\n════ DEFLATION over ALL ${nTrials} trials — best cell = ${best.k} ════`);
console.log(`  Sharpe ${best.sr.toFixed(3)}, n=${best.n} → DSR ${(dsr * 100).toFixed(1)}%  ${dsr > 0.95 ? "SURVIVES — a real conditional edge" : "FAILS — no setup survives the multiple-testing correction"}`);
const survivors = rows.filter((r) => r.oosExp > 0.05 && r.oosN > 200).length;
console.log(`  cells with OOS>+0.05R & n>200: ${survivors} (candidates for pre-registered forward test, NOT yet edges)`);
