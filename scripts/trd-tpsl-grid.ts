#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-tpsl-grid — the operator is right that every trade needs an explicit TP and SL: EVERY test this session
// used a 2ATR stop + a TIME-based exit (close after N bars), never a take-profit. That is a real untested
// dimension — TP/SL changes win-rate, expectancy and the whole payoff distribution. This grids it properly:
//   • SL ∈ {1, 1.5, 2, 3} × ATR      • TP ∈ {0.5, 1, 1.5, 2, 3} × SL (i.e. R:R from 1:2 to 3:1)
//   • BOTH directions, intraday 15m (indices+crypto) AND daily (45-instrument book)
//   • bar-order realism: if a bar's range covers BOTH TP and SL we assume the WORSE fill (SL first)
//   • every cell Rule-7 gated against a matched random-entry control (same regime/direction/mechanics)
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const DUKA = "data/duka", BIN = "data/binance";
const BOOK = ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","GLD","SLV","USO","TLT","HYG","AAPL","MSFT","NVDA","AMZN","GOOGL","META","JPM","XOM","JNJ","KO","INTC","CSCO","BA","GE","F"];
const SLS = [1, 1.5, 2, 3], TPMULT = [0.5, 1, 1.5, 2, 3];
const MAXBARS = 48, ATRN = 14, NCTRL = 2;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 13579; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; } catch { return []; } }
async function load15(dir: string, pfx: string): Promise<B[]> { const out: any[] = []; const seen = new Set<number>(); try { for await (const e of Deno.readDir(dir)) { if (!e.name.startsWith(pfx) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${dir}/${e.name}`); for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4] }); } } } catch { return []; } out.sort((a, b) => a.t - b.t); const bk = 15 * 60000; const m = new Map<number, any>(); for (const x of out) { const k = Math.floor(x.t / bk) * bk; const ex = m.get(k); if (!ex) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t).map((x) => ({ d: new Date(x.t).toISOString().slice(0, 10), o: x.o, h: x.h, l: x.l, c: x.c })); }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

/** Explicit TP/SL exit. Pessimistic: if a bar spans both levels we take the STOP (worse fill). Returns R. */
function tpslTrade(b: B[], i: number, dir: 1 | -1, slDist: number, tpDist: number, reg: string): number | null {
  if (!(slDist > 0) || i + 1 >= b.length) return null;
  const entry = b[i + 1].o; const stop = entry - dir * slDist, target = entry + dir * tpDist;
  const rr = tpDist / slDist;
  for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) {
    const hitSL = dir === 1 ? b[k].l <= stop : b[k].h >= stop;
    const hitTP = dir === 1 ? b[k].h >= target : b[k].l <= target;
    if (hitSL) return -1 - RCOST[reg];          // pessimistic: SL checked first
    if (hitTP) return rr - RCOST[reg];
  }
  const last = b[Math.min(i + MAXBARS, b.length - 1)].c; // timeout at market
  return dir * (last - entry) / slDist - RCOST[reg];
}
interface Cell { s: number[]; c: number[] }
const grid: Record<string, Cell> = {};
const key = (side: string, sl: number, tpm: number) => `${side}|SL${sl}ATR|TP${tpm}x`;
for (const side of ["long", "short"]) for (const sl of SLS) for (const tpm of TPMULT) grid[key(side, sl, tpm)] = { s: [], c: [] };

function scan(b: B[], label: string, useVix: boolean) {
  if (b.length < 400) return;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma200 = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma200[i] = s / 200; } }
  const regOf = (i: number) => { if (!useVix) return "norm"; const v = vix.get(b[i].d) ?? 15; return v < 15 ? "calm" : v < 25 ? "norm" : "stress"; };
  const pool: number[] = []; for (let i = 210; i < b.length - MAXBARS - 1; i++) pool.push(i);
  for (let i = 210; i < b.length - MAXBARS - 1; i++) {
    if (!(at[i] > 0) || !(sma200[i] > 0)) continue; const reg = regOf(i);
    // LONG = the verified dip-buy (oversold in uptrend). SHORT = the mirror the operator wants tested.
    const fireLong = r14[i] < 30 && cl[i] > sma200[i];
    const fireShort = r14[i] > 70 && cl[i] < sma200[i];
    if (!fireLong && !fireShort) continue;
    const dir: 1 | -1 = fireLong ? 1 : -1; const side = fireLong ? "long" : "short";
    for (const sl of SLS) { const slDist = sl * at[i]; if (!(slDist > cl[i] * 1e-4)) continue;
      for (const tpm of TPMULT) {
        const r = tpslTrade(b, i, dir, slDist, slDist * tpm, reg); if (r === null) continue;
        grid[key(side, sl, tpm)].s.push(r);
        for (let k = 0; k < NCTRL; k++) { const j = pool[Math.floor(rnd() * pool.length)]; if (!(at[j] > 0)) continue; const rc = tpslTrade(b, j, dir, sl * at[j], sl * at[j] * tpm, reg); if (rc !== null) grid[key(side, sl, tpm)].c.push(rc); }
      }
    }
  }
  console.log(`  scanned ${label}: ${b.length} bars`);
}
console.log(`TP/SL GRID — explicit take-profit + stop-loss on EVERY trade (the operator's risk framework).`);
console.log(`Previous tests used a TIME exit with no TP — this grids SL ∈ {1,1.5,2,3}ATR × TP ∈ {0.5,1,1.5,2,3}×SL, both directions.\n`);
for (const s of BOOK) scan(await daily(s), s, true);
for (const [nm, dir2, pfx] of [["S&P 15m", DUKA, "usa500idxusd"], ["Nasdaq 15m", DUKA, "usatechidxusd"], ["BTC 15m", BIN, "BTCUSDT-1m"], ["ETH 15m", BIN, "ETHUSDT-1m"]] as [string, string, string][]) { const b = await load15(dir2, pfx.replace("-1m", "")); if (b.length > 1000) scan(b, nm, false); }

console.log(`\n${"cell".padEnd(26)} ${"expR".padStart(7)} ${"win%".padStart(6)} ${"randR".padStart(7)} ${"edge".padStart(7)} ${"t".padStart(6)} ${"n".padStart(8)}  verdict`);
const winners: { k: string; e: number; t: number; win: number; n: number }[] = [];
for (const side of ["long", "short"]) {
  console.log(`── ${side.toUpperCase()} ──`);
  for (const sl of SLS) for (const tpm of TPMULT) {
    const k = key(side, sl, tpm); const cell = grid[k]; if (cell.s.length < 200) continue;
    const g = edgeVsRandom(cell.s, cell.c); const win = cell.s.filter((x) => x > 0).length / cell.s.length * 100;
    const ok = g.passes && g.setupMean > 0; if (ok) winners.push({ k, e: g.setupMean, t: g.tStat, win, n: cell.s.length });
    console.log(`${k.padEnd(26)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(7)} ${win.toFixed(0).padStart(6)} ${((g.controlMean >= 0 ? "+" : "") + g.controlMean.toFixed(3)).padStart(7)} ${((g.edge >= 0 ? "+" : "") + g.edge.toFixed(3)).padStart(7)} ${g.tStat.toFixed(2).padStart(6)} ${String(cell.s.length).padStart(8)}  ${ok ? "✓✓ BEATS RANDOM + PROFITABLE" : g.passes ? "✓ beats random, loses money" : "✗"}`);
  }
}
console.log(`\n════ ${winners.length} TP/SL configurations both beat random AND are profitable ════`);
for (const w of winners.sort((a, b) => b.e - a.e).slice(0, 10)) console.log(`   ${w.k.padEnd(26)} ${(w.e >= 0 ? "+" : "") + w.e.toFixed(3)}R  win ${w.win.toFixed(0)}%  t=${w.t}  n=${w.n}`);
if (!winners.length) console.log(`   none — explicit TP/SL does not create an edge where the time-exit found none.`);
