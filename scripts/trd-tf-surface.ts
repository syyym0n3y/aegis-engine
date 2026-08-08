#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-tf-surface — the full CANDLE surface: every timeframe (1m/5m/15m/30m/1h/2h/4h) at the same positions
// across instruments, so a trader on ANY timeframe gets calibrated numbers. Per instrument × TF we report:
//   • annualized realized vol (√-scaling check — should be ~flat if the process is clean)
//   • typical candle move: median |close-to-close %| (what a stop is sized against on that TF)
//   • p90 candle range %: the tail move that blows through a tight stop
//   • bars/day and total bars (how much a TF trader actually gets to work with)
// Indices: 15y Dukascopy 1-min resampled. Crypto: Binance native intervals. Per ANALYSIS_CONTRACT: numbers+N.
const DIR = "data/duka";
const TFS: [string, number][] = [["1m", 1], ["5m", 5], ["15m", 15], ["30m", 30], ["1h", 60], ["2h", 120], ["4h", 240]];
interface OHLC { t: number; o: number; h: number; l: number; c: number; }

async function loadDuka(prefix: string): Promise<OHLC[]> {
  const out: OHLC[] = []; const seen = new Set<number>();
  try { for await (const e of Deno.readDir(DIR)) {
    if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue;
    const txt = await Deno.readTextFile(`${DIR}/${e.name}`);
    for (const line of txt.split("\n")) { const p = line.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); }
  } } catch { /* */ }
  return out.sort((a, b) => a.t - b.t);
}
function resample(bars: OHLC[], tfMin: number): OHLC[] {
  if (tfMin === 1) return bars; const bucket = tfMin * 60000; const map = new Map<number, OHLC>();
  for (const b of bars) { const k = Math.floor(b.t / bucket) * bucket; const ex = map.get(k); if (!ex) map.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c }); else { ex.h = Math.max(ex.h, b.h); ex.l = Math.min(ex.l, b.l); ex.c = b.c; } }
  return [...map.values()].sort((a, b) => a.t - b.t);
}
// pull ONE 1-min window (all TFs then resample from it → identical sample period, no window-mismatch artifact)
async function binance1m(sym: string, maxPages: number): Promise<OHLC[]> {
  const out: OHLC[] = []; const seen = new Set<number>(); let endTime = Date.now();
  for (let p = 0; p < maxPages; p++) { const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&limit=1000&endTime=${endTime}`, { headers: { "User-Agent": "Mozilla/5.0" } }); if (!r.ok) break; const k = await r.json(); if (!Array.isArray(k) || !k.length) break; for (const c of k) { if (seen.has(c[0])) continue; seen.add(c[0]); out.push({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4] }); } endTime = k[0][0] - 1; if (k.length < 1000) break; }
  return out.sort((a, b) => a.t - b.t);
}
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)]; };

// Annualize from the DATA (bars ÷ years spanned) — correct for any trading calendar, no RTH/24h assumption.
function stats(bars: OHLC[], yearsSpanned: number) {
  const ret: number[] = [], move: number[] = [], range: number[] = [];
  for (let i = 1; i < bars.length; i++) { const r = Math.log(bars[i].c / bars[i - 1].c); if (Number.isFinite(r)) ret.push(r); const m = Math.abs(bars[i].c - bars[i - 1].c) / bars[i - 1].c; if (Number.isFinite(m)) move.push(m); const rg = (bars[i].h - bars[i].l) / bars[i].c; if (Number.isFinite(rg)) range.push(rg); }
  const sd = ret.length ? Math.sqrt(ret.reduce((s, x) => s + x * x, 0) / ret.length) : NaN; // per-bar
  const barsPerYear = yearsSpanned > 0 ? bars.length / yearsSpanned : NaN;
  const annVol = sd * Math.sqrt(barsPerYear) * 100;
  return { n: bars.length, annVol, medMove: median(move) * 100, p90Range: pct(range, 0.9) * 100 };
}

async function surface(name: string, get1m: () => Promise<OHLC[]>, is24h: boolean) {
  const oneMin = await get1m();
  if (oneMin.length < 500) { console.log(`\n════ ${name} ════\n  insufficient 1m data (${oneMin.length})`); return; }
  const from = new Date(oneMin[0].t).toISOString().slice(0, 10), to = new Date(oneMin[oneMin.length - 1].t).toISOString().slice(0, 10);
  const days = (oneMin[oneMin.length - 1].t - oneMin[0].t) / 86400000;
  // Annualize by ACTUAL bars per CALENDAR year (bars ÷ wall-clock years). This auto-reflects each instrument's
  // real trading calendar — no RTH/24h guess. (Continuous-session realized vol; excludes overnight-gap variance,
  // the standard intraday-RV understatement, which is fine for a per-candle sizing surface.)
  const wallYears = days / 365.25;
  console.log(`\n════ ${name} — window ${from}→${to} (${wallYears.toFixed(2)}y, ${(oneMin.length / days).toFixed(0)} 1m-bars/day) ════`);
  console.log(`${"TF".padEnd(4)} ${"bars".padStart(9)} ${"ann-vol%".padStart(9)} ${"med move%".padStart(10)} ${"p90 range%".padStart(11)}`);
  void is24h;
  for (const [tf, m] of TFS) {
    const bars = resample(oneMin, m); if (bars.length < 50) { console.log(`${tf.padEnd(4)} — insufficient`); continue; }
    const s = stats(bars, wallYears);
    console.log(`${tf.padEnd(4)} ${String(s.n).padStart(9)} ${s.annVol.toFixed(1).padStart(9)} ${s.medMove.toFixed(3).padStart(10)} ${s.p90Range.toFixed(3).padStart(11)}`);
  }
}

console.log(`MULTI-TIMEFRAME CANDLE SURFACE — every TF resampled from ONE matched 1m base per instrument (no window artifact).`);
await surface("S&P 500 (Dukascopy 1m)", () => loadDuka("usa500idxusd"), false);
await surface("Nasdaq 100 (Dukascopy 1m)", () => loadDuka("usatechidxusd"), false);
await surface("BTC (Binance 1m, matched window)", () => binance1m("BTCUSDT", 30), true);
await surface("ETH (Binance 1m, matched window)", () => binance1m("ETHUSDT", 30), true);
console.log(`\nREAD: ann-vol ~flat down the column = clean √-scaling (the regime de-risk applies at every TF). "med move%" is the`);
console.log(`typical candle a stop is sized against on that TF; "p90 range%" is the tail move that runs a tight stop. Same position, every lens.`);
