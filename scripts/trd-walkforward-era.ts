#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-walkforward-era — GAP 1+2 of the D-145 audit: (a) rolling WALK-FORWARD by calendar era — did the
// registered candidates hold in EVERY era, or is one crisis wearing a costume? (b) OVERNIGHT/GAP risk — the
// intraday backtest never charges a gap against a held position; here we mark every trade that spans a
// session gap and re-price it including the gap move, so the expectancy is gap-honest.
// Same regime-cost model as D-145 (calm .04 / norm .08 / stress .20 R). Per ANALYSIS_CONTRACT: numbers + N.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const DUKA = "data/duka", BIN = "data/binance";
const TF = 15, HORIZON = 48, STOP_ATR = 2, ATRN = 14;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
interface Bar { t: number; o: number; h: number; l: number; c: number; day: string; }
async function loadDuka(p: string): Promise<Bar[]> { const out: Bar[] = []; const seen = new Set<number>(); for await (const e of Deno.readDir(DUKA)) { if (!e.name.startsWith(p) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DUKA}/${e.name}`); for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4], day: new Date(t).toISOString().slice(0, 10) }); } } return out.sort((a, b) => a.t - b.t); }
async function loadBin(s: string): Promise<Bar[]> { try { const txt = await Deno.readTextFile(`${BIN}/${s}-1m.csv`); const out: Bar[] = []; for (const l of txt.split("\n")) { const q = l.split(","); const t = +q[0]; if (!Number.isFinite(t) || t < 1e12) continue; out.push({ t, o: +q[1], h: +q[2], l: +q[3], c: +q[4], day: new Date(t).toISOString().slice(0, 10) }); } return out.sort((a, b) => a.t - b.t); } catch { return []; } }
function resample(b: Bar[], tf: number): Bar[] { const bk = tf * 60000; const map = new Map<number, Bar>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const ex = map.get(k); if (!ex) map.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c, day: new Date(k).toISOString().slice(0, 10) }); else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } } return [...map.values()].sort((a, b) => a.t - b.t); }
function atr(b: Bar[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi2(cl: number[]) { const n = 2; const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }

interface T { yr: number; r: number; spannedGap: boolean; gapR: number }
function run(bars: Bar[], kind: string, vix: Map<string, number>, gapThreshMin: number): T[] {
  if (bars.length < 500) return []; const cl = bars.map((x) => x.c); const at = atr(bars, ATRN); const r2 = rsi2(cl);
  const dayHiLo = new Map<string, { hi: number; lo: number }>(); { const byd = new Map<string, Bar[]>(); for (const x of bars) (byd.get(x.day) ?? byd.set(x.day, []).get(x.day)!).push(x); const days = [...byd.keys()].sort(); for (let i = 1; i < days.length; i++) { const pv = byd.get(days[i - 1])!; dayHiLo.set(days[i], { hi: Math.max(...pv.map((z) => z.h)), lo: Math.min(...pv.map((z) => z.l)) }); } }
  const atrPct = (i: number) => { if (i < 200) return "mid"; const w = at.slice(i - 200, i).filter((x) => x > 0).sort((a, c) => a - c); return at[i] <= w[Math.floor(w.length / 3)] ? "lo" : "hi"; };
  const out: T[] = []; let i = 210;
  while (i < bars.length - HORIZON - 1) {
    if (!(at[i] > 0)) { i++; continue; }
    const v = vix.get(bars[i].day) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress"; const hl = dayHiLo.get(bars[i].day);
    let dir: 1 | -1 | null = null;
    if (kind === "sweeprev-short-stress" && hl && bars[i].h > hl.hi && cl[i] < hl.hi && vreg === "stress") dir = -1;
    else if (kind === "sweeprev-long-calm" && hl && bars[i].l < hl.lo && cl[i] > hl.lo && vreg === "calm") dir = 1;
    else if (kind === "meanrev-long-calm" && r2[i] < 5 && vreg === "calm") dir = 1;
    else if (kind === "sweeprev-long-lowvol" && hl && bars[i].l < hl.lo && cl[i] > hl.lo && atrPct(i) === "lo") dir = 1;
    if (!dir) { i++; continue; }
    const stopDist = STOP_ATR * at[i]; if (!(stopDist > bars[i].c * 1e-4)) { i++; continue; }
    const entry = bars[i + 1].o, stop = entry - dir * stopDist; let r: number | null = null, exitI = i + HORIZON;
    for (let k = i + 1; k <= i + HORIZON; k++) { if (dir === 1 ? bars[k].l <= stop : bars[k].h >= stop) { r = -1; exitI = k; break; } }
    if (r === null) r = dir * (bars[i + HORIZON].c - entry) / stopDist; r = Math.max(-1.5, Math.min(r, 15));
    // GAP accounting: did the holding period span a session gap (bar spacing >> TF)? measure the worst gap move against us
    let spanned = false, worstGap = 0;
    for (let k = i + 1; k <= exitI; k++) { const dt = (bars[k].t - bars[k - 1].t) / 60000; if (dt > gapThreshMin) { spanned = true; const gapMove = dir * (bars[k].o - bars[k - 1].c) / stopDist; if (gapMove < worstGap) worstGap = gapMove; } }
    out.push({ yr: new Date(bars[i].t).getUTCFullYear(), r: r - RCOST[vreg], spannedGap: spanned, gapR: worstGap });
    i = exitI + 1;
  }
  return out;
}
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); if (vt) for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

const spx = resample(await loadDuka("usa500idxusd"), TF); const ndx = resample(await loadDuka("usatechidxusd"), TF); const btc = resample(await loadBin("BTCUSDT"), TF);
const CANDS: [string, Bar[][], number][] = [
  ["sweeprev-short-stress", [spx, ndx], 30], ["sweeprev-long-calm", [spx, ndx], 30],
  ["meanrev-long-calm", [spx, ndx], 30], ["sweeprev-long-lowvol", [btc], 30],
];
console.log(`WALK-FORWARD BY ERA + GAP ACCOUNTING — the 4 pre-registered candidates (D-145), 15m, regime costs.\n`);
for (const [name, sets, gapMin] of CANDS) {
  const all: T[] = []; for (const s of sets) all.push(...run(s, name, vix, gapMin));
  if (all.length < 50) { console.log(`${name}: thin (n=${all.length})\n`); continue; }
  const years = [...new Set(all.map((t) => t.yr))].sort();
  const perYear = years.map((y) => { const s = all.filter((t) => t.yr === y); return { y, n: s.length, e: mean(s.map((t) => t.r)) }; }).filter((x) => x.n >= 15);
  const posYears = perYear.filter((x) => x.e > 0).length;
  const gapped = all.filter((t) => t.spannedGap); const gapDrag = gapped.length ? mean(gapped.map((t) => t.gapR)) : 0;
  const gapHonest = mean(all.map((t) => t.r + (t.spannedGap ? Math.min(0, t.gapR) * 0.5 : 0))); // charge half the worst adverse gap
  console.log(`══ ${name} ══  overall ${(mean(all.map((t) => t.r)) >= 0 ? "+" : "")}${mean(all.map((t) => t.r)).toFixed(3)}R  n=${all.length}`);
  console.log(`   per-era: ${perYear.map((x) => `${x.y}:${(x.e >= 0 ? "+" : "") + x.e.toFixed(2)}`).join(" ")}`);
  console.log(`   POSITIVE IN ${posYears}/${perYear.length} eras (${(posYears / perYear.length * 100).toFixed(0)}%)  ${posYears / perYear.length >= 0.6 ? "✓ persists across regimes" : "✗ CONCENTRATED — likely one-era artifact"}`);
  console.log(`   gap exposure: ${(gapped.length / all.length * 100).toFixed(0)}% of trades span a session gap; mean worst adverse gap ${gapDrag.toFixed(3)}R → gap-honest expectancy ${(gapHonest >= 0 ? "+" : "") + gapHonest.toFixed(3)}R ${gapHonest > 0 ? "✓ still positive" : "✗ turns negative"}\n`);
}
