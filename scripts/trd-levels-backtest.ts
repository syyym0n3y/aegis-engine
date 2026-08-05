#!/usr/bin/env -S deno run --allow-net --allow-read
// trd-levels-backtest — run the SAME honest gate (OOS + deflated Sharpe), now CONDITIONED ON AUCTION LEVELS,
// across MULTIPLE TIMEFRAMES (1h/4h/1d — not 1-min) and multiple setups, both directions. Uses the tested
// _shared/trd-auction.ts valueArea. No look-ahead: each day trades off the PRIOR session's value area.
// Setups: fade-VAH-short / fade-VAL-long (rejection back into balance → target POC) and breakout-long /
// breakdown-short (acceptance beyond value → continuation). Crypto = Binance (real volume). Indices =
// Dukascopy 1-min resampled (time/TPO profile, no volume). Per ANALYSIS_CONTRACT: number+N+OOS+DSR, small-N
// flagged; every setup×TF cell is a trial → deflation over the full grid.
import { valueArea, type PBar } from "../supabase/functions/_shared/trd-auction.ts";
import { mean, sharpe, deflatedSharpe, sampleStd } from "../supabase/functions/_shared/trd-stats.ts";

const TFS: Record<string, number> = { "1h": 60, "4h": 240, "1d": 1440 };
const HORIZON: Record<string, number> = { "1h": 24, "4h": 12, "1d": 5 };
const STOP_ATR = 2, ATRN = 14, COST_R = 0.06;
interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; day: string; }

async function binanceTF(sym: string, interval: string): Promise<Bar[]> {
  const out: any[] = []; let endTime = Date.now();
  for (let p = 0; p < 30; p++) { const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } }); if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break; out.unshift(...k); endTime = k[0][0] - 1; if (k.length < 1000) break; }
  const seen = new Set<number>(); const b: Bar[] = [];
  for (const k of out) { if (seen.has(k[0])) continue; seen.add(k[0]); b.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], day: new Date(k[0]).toISOString().slice(0, 10) }); }
  return b.sort((a, b) => a.t - b.t);
}
async function dukaResample(prefix: string, tfMin: number): Promise<Bar[]> {
  let raw: { t: number; o: number; h: number; l: number; c: number }[] = [];
  try { for await (const e of Deno.readDir("data/duka")) {
    if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue;
    const txt = await Deno.readTextFile(`data/duka/${e.name}`);
    for (const line of txt.split("\n")) { const p = line.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12) continue; raw.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); }
  } } catch { return []; }
  raw.sort((a, b) => a.t - b.t);
  const bucketMs = tfMin * 60000; const map = new Map<number, Bar>();
  for (const r of raw) { const bk = Math.floor(r.t / bucketMs) * bucketMs; const ex = map.get(bk);
    if (!ex) map.set(bk, { t: bk, o: r.o, h: r.h, l: r.l, c: r.c, v: 1, day: new Date(bk - 4 * 3600000).toISOString().slice(0, 10) });
    else { ex.h = Math.max(ex.h, r.h); ex.l = Math.min(ex.l, r.l); ex.c = r.c; ex.v += 1; } }
  return [...map.values()].sort((a, b) => a.t - b.t);
}
function atr(b: Bar[], n: number): number[] { const tr: number[] = []; for (let i = 0; i < b.length; i++) { if (i === 0) { tr.push(b[i].h - b[i].l); continue; } tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); } const out: number[] = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }

interface T { r: number; is: boolean; }
const grid: Record<string, T[]> = {}; // key = `${setup}|${tf}`
function push(setup: string, tf: string, r: number, is: boolean) { const k = `${setup}|${tf}`; (grid[k] ??= []).push({ r: r - COST_R, is }); }

function runTF(bars: Bar[], tf: string) {
  if (bars.length < 200) return;
  const at = atr(bars, ATRN); const H = HORIZON[tf]; const cut = Math.floor(bars.length * 0.6);
  // prior-session value area per day (computed from the fully-closed prior day)
  const days = new Map<string, Bar[]>(); for (const b of bars) (days.get(b.day) ?? days.set(b.day, []).get(b.day)!).push(b);
  const dayKeys = [...days.keys()].sort();
  const priorVA = new Map<string, { vah: number; val: number; poc: number }>();
  for (let i = 1; i < dayKeys.length; i++) { const va = valueArea(days.get(dayKeys[i - 1])! as PBar[], 0.7, 60); if (va) priorVA.set(dayKeys[i], { vah: va.vah, val: va.val, poc: va.poc }); }
  for (let i = ATRN + 1; i < bars.length - H - 1; i++) {
    const b = bars[i]; const va = priorVA.get(b.day); if (!va || !(at[i] > 0)) continue;
    const setups: [string, 1 | -1][] = [];
    if (b.h > va.vah && b.c < va.vah) setups.push(["fade-VAH-short", -1]);   // rejection at value high
    if (b.l < va.val && b.c > va.val) setups.push(["fade-VAL-long", 1]);      // rejection at value low
    if (b.c > va.vah) setups.push(["breakout-VAH-long", 1]);                  // acceptance above value
    if (b.c < va.val) setups.push(["breakdown-VAL-short", -1]);               // acceptance below value
    for (const [name, dir] of setups) {
      const entry = bars[i + 1].o, stop = entry - dir * STOP_ATR * at[i]; let r: number | null = null;
      for (let k = i + 1; k <= i + H; k++) { if (dir === 1 ? bars[k].l <= stop : bars[k].h >= stop) { r = -1; break; } }
      if (r === null) r = dir * (bars[i + H].c - entry) / (STOP_ATR * at[i]);
      push(name, tf, r, i < cut);
    }
  }
}

const MARKETS: [string, "binance" | "duka", string][] = [
  ["BTCUSDT", "binance", "BTCUSDT"], ["ETHUSDT", "binance", "ETHUSDT"], ["BNBUSDT", "binance", "BNBUSDT"], ["SOLUSDT", "binance", "SOLUSDT"],
  ["S&P500", "duka", "usa500idxusd"], ["Nasdaq100", "duka", "usatechidxusd"],
];
for (const [name, src, id] of MARKETS) {
  for (const [tf, tfMin] of Object.entries(TFS)) {
    const bars = src === "binance" ? await binanceTF(id, tf) : await dukaResample(id, tfMin);
    if (bars.length >= 200) { runTF(bars, tf); }
  }
  console.log(`${name}: done`);
}
const agg = (t: T[]) => t.length ? `${(mean(t.map((x) => x.r)) >= 0 ? "+" : "")}${mean(t.map((x) => x.r)).toFixed(3)}R/${(t.filter((x) => x.r > 0).length / t.length * 100).toFixed(0)}%/n=${t.length}${t.length < 80 ? " [small-N]" : ""}` : "—";
const skewKurt = (a: number[]) => { const m = mean(a), s = sampleStd(a); if (!(s > 0)) return [0, 3]; let sk = 0, ku = 0; for (const x of a) { const z = (x - m) / s; sk += z ** 3; ku += z ** 4; } return [sk / a.length, ku / a.length]; };
console.log(`\n════ AUCTION-LEVELS BACKTEST — value-area-conditioned, multi-TF, both directions ════`);
const keys = Object.keys(grid).sort();
const cellSharpes = keys.filter((k) => grid[k].length >= 30).map((k) => sharpe(grid[k].map((x) => x.r)));
for (const setup of ["fade-VAH-short", "fade-VAL-long", "breakout-VAH-long", "breakdown-VAL-short"]) {
  console.log(`\n── ${setup} ──`);
  for (const tf of Object.keys(TFS)) { const t = grid[`${setup}|${tf}`] ?? []; if (!t.length) continue;
    console.log(`  ${tf.padEnd(3)} ALL ${agg(t)}   IS ${agg(t.filter((x) => x.is))} → OOS ${agg(t.filter((x) => !x.is))}`); }
}
// gate the single best cell over the full grid of trials
let best = keys[0]; for (const k of keys) if (grid[k].length >= 50 && sharpe(grid[k].map((x) => x.r)) > sharpe(grid[best].map((x) => x.r))) best = k;
const bt = grid[best].map((x) => x.r); const [sk, ku] = skewKurt(bt); const varT = cellSharpes.length > 1 ? sampleStd(cellSharpes) ** 2 : 0.25;
const dsr = deflatedSharpe(sharpe(bt), bt.length, sk, ku, keys.length, varT);
console.log(`\n════ DEFLATION GATE (best cell = ${best}, over ${keys.length} setup×TF trials) ════`);
console.log(`  N=${bt.length}, Sharpe ${sharpe(bt).toFixed(3)}, skew ${sk.toFixed(2)}, kurt ${ku.toFixed(1)} → DSR ${(dsr * 100).toFixed(1)}%  ${dsr > 0.95 ? "SURVIVES" : "FAILS (>95% to promote)"}`);
console.log(`  GEX-regime conditioning needs HISTORICAL option chains (not free-deep) — flagged, not faked.`);
