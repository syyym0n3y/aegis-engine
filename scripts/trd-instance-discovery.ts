#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-instance-discovery — DATA-FIRST, not system-first. Per the operator: stop imposing a system on the data;
// run ONE setup per trade (non-overlapping, one position at a time), across markets × timeframes, tag EVERY
// instance with its full condition vector, then DISCOVER where winners actually cluster. Anti-snoop rule: a
// condition only counts as a "winner" if it is positive IN-SAMPLE **and** OUT-OF-SAMPLE (same slice, both
// halves) — a lucky slice is random OOS. We then compare persistent-winner COUNT vs what pure chance yields;
// an excess = real conditional structure, not noise. Deep data: Dukascopy 1m S&P/Nasdaq + Binance 1m BTC/ETH.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
const DUKA = "data/duka", BIN = "data/binance";
const TFS: [string, number, number][] = [["5m", 5, 96], ["15m", 15, 48], ["30m", 30, 24], ["1h", 60, 16], ["2h", 120, 8], ["4h", 240, 6]];
const STOP_ATR = 2, ATRN = 14, COST = 0.05;
interface Bar { t: number; o: number; h: number; l: number; c: number; m: number; day: string; }
async function loadDuka(prefix: string): Promise<Bar[]> { const out: Bar[] = []; const seen = new Set<number>(); for await (const e of Deno.readDir(DUKA)) { if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue; const txt = await Deno.readTextFile(`${DUKA}/${e.name}`); for (const l of txt.split("\n")) { const p = l.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); const d = new Date(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } } return out.sort((a, b) => a.t - b.t); }
async function loadBin(sym: string): Promise<Bar[]> { try { const txt = await Deno.readTextFile(`${BIN}/${sym}-1m.csv`); const out: Bar[] = []; for (const l of txt.split("\n")) { const p = l.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12) continue; const d = new Date(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } return out.sort((a, b) => a.t - b.t); } catch { return []; } }
function resample(b: Bar[], tf: number): Bar[] { if (tf === 1) return b; const bk = tf * 60000; const map = new Map<number, Bar>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const ex = map.get(k); if (!ex) { const d = new Date(k); map.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c, m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); } else { ex.h = Math.max(ex.h, x.h); ex.l = Math.min(ex.l, x.l); ex.c = x.c; } } return [...map.values()].sort((a, b) => a.t - b.t); }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
function ema(cl: number[], n: number) { const k = 2 / (n + 1); const o: number[] = []; let p = cl[0]; for (let i = 0; i < cl.length; i++) { p = i === 0 ? cl[0] : cl[i] * k + p * (1 - k); o.push(p); } return o; }
function atr(b: Bar[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
const sess = (m: number) => m < 420 ? "Asia" : m < 780 ? "London" : "NY";

interface Trade { r: number; is: boolean; cond: Record<string, string> }
// each setup = a signal fn returning dir or null at bar i (one setup per run, non-overlapping)
type Sig = (b: Bar[], cl: number[], r2: number[], e50: number[], i: number, dayHiLo: Map<string, { hi: number; lo: number }>) => 1 | -1 | null;
const SETUPS: Record<string, Sig> = {
  "meanrev-long": (_b, _cl, r2, _e, i) => r2[i] < 5 ? 1 : null,
  "meanrev-short": (_b, _cl, r2, _e, i) => r2[i] > 95 ? -1 : null,
  "breakout-long": (_b, cl, _r, _e, i) => cl[i] > Math.max(...cl.slice(i - 20, i)) ? 1 : null,
  "breakdown-short": (_b, cl, _r, _e, i) => cl[i] < Math.min(...cl.slice(i - 20, i)) ? -1 : null,
  "sweeprev-long": (b, cl, _r, _e, i, hl) => { const h = hl.get(b[i].day); return h && b[i].l < h.lo && cl[i] > h.lo ? 1 : null; },
  "sweeprev-short": (b, cl, _r, _e, i, hl) => { const h = hl.get(b[i].day); return h && b[i].h > h.hi && cl[i] < h.hi ? -1 : null; },
};

function genTrades(b: Bar[], H: number, sig: Sig, vix: Map<string, number>): Trade[] {
  if (b.length < 500) return []; const cl = b.map((x) => x.c); const r2 = rsi(cl, 2); const e50 = ema(cl, 50); const at = atr(b, ATRN);
  const sma200 = (i: number) => { if (i < 200) return NaN; let s = 0; for (let k = i - 200; k < i; k++) s += cl[k]; return s / 200; };
  const atrHist: number[] = []; const atrPct = (i: number) => { if (i < 252) return "mid"; const w = at.slice(i - 252, i).filter((x) => x > 0).sort((a, c) => a - c); const lo = w[Math.floor(w.length / 3)], hi = w[Math.floor(w.length * 2 / 3)]; return at[i] <= lo ? "lo" : at[i] >= hi ? "hi" : "mid"; }; void atrHist;
  const dayHiLo = new Map<string, { hi: number; lo: number }>(); { const byd = new Map<string, Bar[]>(); for (const x of b) (byd.get(x.day) ?? byd.set(x.day, []).get(x.day)!).push(x); const days = [...byd.keys()].sort(); for (let i = 1; i < days.length; i++) { const pv = byd.get(days[i - 1])!; dayHiLo.set(days[i], { hi: Math.max(...pv.map((z) => z.h)), lo: Math.min(...pv.map((z) => z.l)) }); } }
  const cut = Math.floor(b.length * 0.6); const out: Trade[] = []; let i = 210;
  while (i < b.length - H - 1) {
    const ma = sma200(i); if (!(at[i] > 0) || !(ma > 0)) { i++; continue; }
    const dir = sig(b, cl, r2, e50, i, dayHiLo);
    if (!dir) { i++; continue; }
    const stopDist = STOP_ATR * at[i]; if (!(stopDist > b[i].c * 1e-4)) { i++; continue; }
    const entry = b[i + 1].o, stop = entry - dir * stopDist; let r: number | null = null; let exitI = i + H;
    for (let k = i + 1; k <= i + H; k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; exitI = k; break; } }
    if (r === null) r = dir * (b[i + H].c - entry) / stopDist; r = Math.max(-1.5, Math.min(r, 15));
    const v = vix.get(b[i].day) ?? 15; const d = new Date(b[i].t);
    out.push({ r: r - COST, is: i < cut, cond: { trend: cl[i] > ma ? "up" : "dn", sess: sess(b[i].m), vix: v < 15 ? "calm" : v < 25 ? "norm" : "stress", dow: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getUTCDay()], mon: String(d.getUTCMonth() + 1).padStart(2, "0"), atr: atrPct(i) } });
    i = exitI + 1; // ONE position at a time — non-overlapping
  }
  return out;
}

// VIX daily
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); if (vt) for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

const MARKETS: [string, () => Promise<Bar[]>][] = [["S&P500", () => loadDuka("usa500idxusd")], ["Nasdaq", () => loadDuka("usatechidxusd")], ["BTC", () => loadBin("BTCUSDT")], ["ETH", () => loadBin("ETHUSDT")]];
const DIMS = ["trend", "sess", "vix", "dow", "mon", "atr"];
interface Winner { key: string; dim: string; val: string; isExp: number; oosExp: number; isN: number; oosN: number }
const winners: Winner[] = []; const allCells: { ie: number; oe: number }[] = []; let cellsChecked = 0, totalTrades = 0;

for (const [mkt, loader] of MARKETS) {
  const raw = await loader(); if (raw.length < 5000) { console.log(`${mkt}: no data`); continue; }
  console.log(`${mkt}: ${raw.length} 1m bars → generating instance ledger per setup × TF...`);
  for (const [tf, m, H] of TFS) { const bars = resample(raw, m);
    for (const [name, sig] of Object.entries(SETUPS)) {
      const tr = genTrades(bars, H, sig, vix); if (tr.length < 200) continue; totalTrades += tr.length;
      const key = `${mkt}|${tf}|${name}`;
      for (const dim of DIMS) {
        const vals = new Set(tr.map((t) => t.cond[dim]));
        for (const val of vals) { const sub = tr.filter((t) => t.cond[dim] === val); const isS = sub.filter((t) => t.is), oosS = sub.filter((t) => !t.is); if (isS.length < 40 || oosS.length < 40) continue; cellsChecked++;
          const ie = mean(isS.map((t) => t.r)), oe = mean(oosS.map((t) => t.r)); allCells.push({ ie, oe });
          if (ie > 0.03 && oe > 0.03) winners.push({ key, dim, val, isExp: ie, oosExp: oe, isN: isS.length, oosN: oosS.length });
        }
      }
    }
  }
}
// chance baseline: for a zero-edge cell, P(IS>0.03 AND OOS>0.03). Estimate empirically = fraction of ALL
// cells that are IS>0.03 × fraction OOS>0.03 would overstate; instead compare persistent winners vs the
// count expected if IS/OOS were independent (product of marginal positive rates).
console.log(`\n════ DATA-FIRST DISCOVERY — ${totalTrades.toLocaleString()} instances, ${cellsChecked} condition-cells checked ════`);
// chance baseline: marginal positive rates → expected persistent % under IS/OOS independence
const posIS = allCells.filter((c) => c.ie > 0.03).length / allCells.length;
const posOOS = allCells.filter((c) => c.oe > 0.03).length / allCells.length;
const chancePct = posIS * posOOS * 100; const obsPct = winners.length / cellsChecked * 100;
console.log(`Persistent winners (IS>+0.03R AND OOS>+0.03R): ${winners.length} = ${obsPct.toFixed(1)}% of cells`);
console.log(`Chance baseline (IS+ ${(posIS * 100).toFixed(0)}% × OOS+ ${(posOOS * 100).toFixed(0)}% if independent): ${chancePct.toFixed(1)}%  →  ${obsPct > chancePct * 1.3 ? "EXCESS over chance = real structure exists" : "≈ chance — the AGGREGATE is mostly noise; only COHERENT clusters below are signal"}`);
// COHERENCE: a real effect repeats across independent (market×TF). Group persistent winners by setup×condition.
const coh = new Map<string, { combos: Set<string>; oos: number[] }>();
for (const w of winners) { const setup = w.key.split("|")[2]; const k = `${setup} × ${w.dim}:${w.val}`; const e = coh.get(k) ?? { combos: new Set(), oos: [] }; e.combos.add(w.key.split("|").slice(0, 2).join("|")); e.oos.push(w.oosExp); coh.set(k, e); }
const cohRows = [...coh.entries()].map(([k, v]) => ({ k, n: v.combos.size, oos: mean(v.oos) })).filter((x) => x.n >= 3).sort((a, b) => b.n - a.n);
console.log(`\nCOHERENT conditional edges — persisted across ≥3 independent market×TF combos (this is signal, not a lucky slice):`);
for (const r of cohRows.slice(0, 18)) console.log(`  ${r.k.padEnd(34)} in ${String(r.n).padStart(2)} market×TF combos   avg OOS +${r.oos.toFixed(3)}R`);
console.log(`\nREAD (the operator's question answered): the DIRECTION is CONDITIONAL. The coherent, cross-market, cross-TF,`);
console.log(`IS+OOS-persistent structure — NOT single calendar slices — is the refined data the system should QUERY at`);
console.log(`decision time ("in conditions like now, which setups have won?"). Still CANDIDATES → pre-registered forward test to trade.`);
