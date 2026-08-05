#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-cost-regime — accuracy gate BEFORE pre-registration: do the top R-007 conditional candidates survive
// REALISTIC regime-dependent costs? Discovery used a flat 0.05R; but the headline edge (short into VIX stress)
// occurs exactly when spreads/slippage are worst. Re-run the sweeprev/meanrev setups tracking GROSS R (pre-cost)
// tagged by regime, then net under a realistic model: calm 0.04R / normal 0.08R / stress 0.20R (spreads widen
// with vol). If the stress-short still nets positive under 0.20R, it is robust enough to forward-test. Per
// ANALYSIS_CONTRACT: numbers, OOS, honest.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const DUKA = "data/duka", BIN = "data/binance";
const TFS: [string, number, number][] = [["5m", 5, 96], ["15m", 15, 48], ["30m", 30, 24], ["1h", 60, 16]];
const STOP_ATR = 2, ATRN = 14;
const REGIME_COST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
interface Bar { t: number; o: number; h: number; l: number; c: number; m: number; day: string; }
async function loadDuka(p: string): Promise<Bar[]> { const out: Bar[] = []; const seen = new Set<number>(); for await (const e of Deno.readDir(DUKA)) { if (!e.name.startsWith(p) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DUKA}/${e.name}`); for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); const d = new Date(t); out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } } return out.sort((a, b) => a.t - b.t); }
async function loadBin(s: string): Promise<Bar[]> { try { const txt = await Deno.readTextFile(`${BIN}/${s}-1m.csv`); const out: Bar[] = []; for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12) continue; const d = new Date(t); out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } return out.sort((a, b) => a.t - b.t); } catch { return []; } }
function resample(b: Bar[], tf: number): Bar[] { if (tf === 1) return b; const bk = tf * 60000; const map = new Map<number, Bar>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const ex = map.get(k); if (!ex) { const d = new Date(k); map.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c, m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } } return [...map.values()].sort((a, b) => a.t - b.t); }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
function atr(b: Bar[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }

interface G { gross: number; is: boolean; regime: string; }
const cand: Record<string, G[]> = { "sweeprev-short|stress": [], "sweeprev-long|calm": [], "meanrev-long|calm": [], "sweeprev-long|lowvol": [] };
function gen(b: Bar[], H: number, vix: Map<string, number>) {
  if (b.length < 500) return; const cl = b.map((x) => x.c); const r2 = rsi(cl, 2); const at = atr(b, ATRN);
  const sma200 = (i: number) => { if (i < 200) return NaN; let s = 0; for (let k = i - 200; k < i; k++) s += cl[k]; return s / 200; };
  const atrPct = (i: number) => { if (i < 252) return "mid"; const w = at.slice(i - 252, i).filter((x) => x > 0).sort((a, c) => a - c); return at[i] <= w[Math.floor(w.length / 3)] ? "lo" : "hi"; };
  const dayHiLo = new Map<string, { hi: number; lo: number }>(); { const byd = new Map<string, Bar[]>(); for (const x of b) (byd.get(x.day) ?? byd.set(x.day, []).get(x.day)!).push(x); const days = [...byd.keys()].sort(); for (let i = 1; i < days.length; i++) { const pv = byd.get(days[i - 1])!; dayHiLo.set(days[i], { hi: Math.max(...pv.map((z) => z.h)), lo: Math.min(...pv.map((z) => z.l)) }); } }
  const cut = Math.floor(b.length * 0.6); let i = 210;
  while (i < b.length - H - 1) {
    const ma = sma200(i); if (!(at[i] > 0) || !(ma > 0)) { i++; continue; }
    const stopDist = STOP_ATR * at[i]; if (!(stopDist > b[i].c * 1e-4)) { i++; continue; }
    const v = vix.get(b[i].day) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress"; const hl = dayHiLo.get(b[i].day);
    let dir: 1 | -1 | null = null, bucket = "";
    if (hl && b[i].h > hl.hi && cl[i] < hl.hi && vreg === "stress") { dir = -1; bucket = "sweeprev-short|stress"; }
    else if (hl && b[i].l < hl.lo && cl[i] > hl.lo && vreg === "calm") { dir = 1; bucket = "sweeprev-long|calm"; }
    else if (hl && b[i].l < hl.lo && cl[i] > hl.lo && atrPct(i) === "lo") { dir = 1; bucket = "sweeprev-long|lowvol"; }
    else if (r2[i] < 5 && vreg === "calm") { dir = 1; bucket = "meanrev-long|calm"; }
    if (!dir) { i++; continue; }
    const entry = b[i + 1].o, stop = entry - dir * stopDist; let r: number | null = null, exitI = i + H;
    for (let k = i + 1; k <= i + H; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; exitI = k; break; } }
    if (r === null) r = dir * (b[i + H].c - entry) / stopDist; r = Math.max(-1.5, Math.min(r, 15));
    cand[bucket].push({ gross: r, is: i < cut, regime: vreg });
    i = exitI + 1;
  }
}
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); if (vt) for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);
for (const [, loader] of [["S&P", () => loadDuka("usa500idxusd")], ["Nasdaq", () => loadDuka("usatechidxusd")], ["BTC", () => loadBin("BTCUSDT")], ["ETH", () => loadBin("ETHUSDT")]] as [string, () => Promise<Bar[]>][]) { const raw = await loader(); if (raw.length < 5000) continue; for (const [, m, H] of TFS) gen(resample(raw, m), H, vix); }

console.log(`COST-REALISM GATE — top R-007 candidates, GROSS vs net under regime costs (calm .04 / norm .08 / stress .20 R):\n`);
console.log(`${"candidate".padEnd(24)} ${"OOS gross".padStart(10)} ${"OOS @flat.05".padStart(12)} ${"OOS @regime".padStart(12)} ${"n".padStart(6)}  verdict`);
for (const [name, arr] of Object.entries(cand)) {
  const oos = arr.filter((x) => !x.is); if (oos.length < 40) { console.log(`${name.padEnd(24)} thin (n=${oos.length})`); continue; }
  const gross = mean(oos.map((x) => x.gross));
  const flat = gross - 0.05;
  const regime = mean(oos.map((x) => x.gross - REGIME_COST[x.regime]));
  const verdict = regime > 0.03 ? "SURVIVES realistic cost → pre-register" : regime > 0 ? "marginal — register but low priority" : "DIES under realistic cost → do NOT register";
  console.log(`${name.padEnd(24)} ${("+" + gross.toFixed(3)).padStart(10)} ${("+" + flat.toFixed(3)).padStart(12)} ${((regime >= 0 ? "+" : "") + regime.toFixed(3)).padStart(12)} ${String(oos.length).padStart(6)}  ${verdict}`);
}
console.log(`\nThis is the accuracy refinement the operator asked for: the flat-cost expectancy overstates the stress-short`);
console.log(`edge because stress = widest spreads. Only candidates net-positive under REGIME costs earn the forward clock.`);
