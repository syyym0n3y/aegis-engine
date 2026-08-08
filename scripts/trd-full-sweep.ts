#!/usr/bin/env -S deno run --allow-read
// trd-full-sweep — the operator's demand: "go across all timeframes, markets, instruments and sessions."
// This is the exhaustive falsification matrix on every intraday market we hold at 1-min resolution:
//   MARKETS:   Nasdaq-100, S&P-500 (Dukascopy index, ~15y), BTC, ETH (Binance 1-min, ~8y, 24h)
//   TIMEFRAMES: 5m, 15m, 30m, 60m, 240m
//   SESSIONS:  Asia(00-07 UTC), London(07-12), NY-am(12-16), NY-pm(16-21), Overnight(21-24) — + crypto 24h
//   DIRECTIONS: long (RSI14<30 & >200MA) AND short (RSI14>70 & <200MA)
// Every cell is judged the ONLY way that has ever mattered (D-146): does the setup beat a matched RANDOM
// control drawn from the SAME market/TF/session/direction? Costs are charged honestly (spread/stop in R).
// A cell is a real edge ONLY if it beats random (t>=2) AND is net-positive after cost. Anything else = noise.
import { mean } from "../supabase/functions/_shared/trd-stats.ts";
import { edgeVsRandom } from "../supabase/functions/_shared/trd-random-control.ts";
const STOP_ATR = 2, TP_MULT = 3, ATRN = 14, NCTRL = 2, SPREAD_FRAC = 0.0001;
let seed = 20260807; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { t: number; o: number; h: number; l: number; c: number }
const norm = (t: number) => t > 1e15 ? Math.floor(t / 1000) : t;   // Binance later rows are µs
async function loadDuka(prefix: string): Promise<B[]> { const out: B[] = []; const seen = new Set<number>(); for await (const e of Deno.readDir("data/duka")) { if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue; for (const l of (await Deno.readTextFile(`data/duka/${e.name}`)).split("\n")) { const p = l.split(","); const t = norm(+p[0]); if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } } return out.sort((a, b) => a.t - b.t); }
async function loadBinance(file: string): Promise<B[]> { const out: B[] = []; const seen = new Set<number>(); for (const l of (await Deno.readTextFile(`data/binance/${file}`)).split("\n")) { const p = l.split(","); const t = norm(+p[0]); if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); out.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4] }); } return out.sort((a, b) => a.t - b.t); }
function resample(b: B[], tf: number): B[] { if (tf === 1) return b; const bk = tf * 60000; const m = new Map<number, B>(); for (const x of b) { const k = Math.floor(x.t / bk) * bk; const e = m.get(k); if (!e) m.set(k, { t: k, o: x.o, h: x.h, l: x.l, c: x.c }); else { e.h = Math.max(e.h, x.h); e.l = Math.min(e.l, x.l); e.c = x.c; } } return [...m.values()].sort((a, b) => a.t - b.t); }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const SESSIONS: [string, (h: number) => boolean][] = [["Asia", (h) => h >= 0 && h < 7], ["London", (h) => h >= 7 && h < 12], ["NY-am", (h) => h >= 12 && h < 16], ["NY-pm", (h) => h >= 16 && h < 21], ["Overnite", (h) => h >= 21], ["ALL-24h", () => true]];
const TFS: [string, number][] = [["5m", 5], ["15m", 15], ["30m", 30], ["60m", 60], ["240m", 240]];
const MARKETS: [string, () => Promise<B[]>][] = [["NASDAQ", () => loadDuka("usatechidxusd")], ["S&P500", () => loadDuka("usa500idxusd")], ["BTC", () => loadBinance("BTCUSDT-1m.csv")], ["ETH", () => loadBinance("ETHUSDT-1m.csv")]];

let cells = 0, edges = 0; const winners: string[] = [];
console.log(`FULL FALSIFICATION SWEEP — markets × timeframes × sessions × directions, each vs its own random control (D-146)`);
console.log(`Edge = beats random (t>=2) AND net-positive after cost. TP=3×SL, 2×ATR stop, ${SPREAD_FRAC * 1e4}bp round-trip spread.\n`);
console.log(`${"market".padEnd(7)} ${"TF".padEnd(5)} ${"session".padEnd(9)} ${"dir".padEnd(5)} ${"n".padStart(6)} ${"netR".padStart(7)} ${"cost".padStart(6)} ${"t".padStart(6)}  verdict`);
for (const [mname, loader] of MARKETS) {
  const raw = await loader();
  if (raw.length < 50000) { console.log(`${mname}: only ${raw.length} bars — skipped`); continue; }
  for (const [tname, tf] of TFS) {
    const b = resample(raw, tf); if (b.length < 5000) continue;
    const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
    const sma = new Array(cl.length).fill(NaN); { let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= 200) s -= cl[i - 200]; if (i >= 200) sma[i] = s / 200; } }
    const MAXBARS = Math.max(12, Math.round(48 * 15 / tf));
    const hour = b.map((x) => new Date(x.t).getUTCHours());
    const trade = (i: number, dir: 1 | -1): { r: number; cost: number } | null => {
      const sd = STOP_ATR * at[i]; if (!(sd > b[i].c * 1e-4) || i + 1 >= b.length) return null;
      const entry = b[i + 1].o, stop = entry - dir * sd, tgt = entry + dir * sd * TP_MULT; let r: number | null = null;
      for (let k = i + 1; k < Math.min(i + 1 + MAXBARS, b.length); k++) { if (dir === 1 ? b[k].l <= stop : b[k].h >= stop) { r = -1; break; } if (dir === 1 ? b[k].h >= tgt : b[k].l <= tgt) { r = TP_MULT; break; } }
      if (r === null) r = dir * (b[Math.min(i + MAXBARS, b.length - 1)].c - entry) / sd;
      return { r, cost: (entry * SPREAD_FRAC * 2) / sd };
    };
    for (const [sname, inSess] of SESSIONS) {
      const isEq = mname === "NASDAQ" || mname === "S&P500";
      if (sname === "ALL-24h" && isEq) continue;          // equities: report per-session, not a 24h blur
      if (sname !== "ALL-24h" && !isEq) continue;          // crypto: 24h only (session tags meaningless)
      const pool: number[] = []; for (let i = 210; i < b.length - MAXBARS - 1; i++) if (inSess(hour[i])) pool.push(i);
      if (pool.length < 500) continue;
      for (const [dname, dir] of [["long", 1], ["short", -1]] as const) {
        const sig: number[] = [], ctrl: number[] = [], costs: number[] = [];
        for (const i of pool) {
          if (!(at[i] > 0) || !(sma[i] > 0)) continue;
          const fire = dir === 1 ? (r14[i] < 30 && cl[i] > sma[i]) : (r14[i] > 70 && cl[i] < sma[i]);
          if (!fire) continue;
          const tr = trade(i, dir); if (!tr) continue;
          sig.push(tr.r - tr.cost); costs.push(tr.cost);
          for (let q = 0; q < NCTRL; q++) { const j = pool[Math.floor(rnd() * pool.length)]; const rc = trade(j, dir); if (rc) ctrl.push(rc.r - rc.cost); }
        }
        if (sig.length < 100) continue;
        cells++;
        const g = edgeVsRandom(sig, ctrl);
        const ok = g.passes && g.setupMean > 0;
        if (ok) { edges++; winners.push(`${mname}/${tname}/${sname}/${dname}`); }
        const v = ok ? "✓✓ EDGE" : g.passes ? "✓ beats-rand loses $" : "✗ noise";
        console.log(`${mname.padEnd(7)} ${tname.padEnd(5)} ${sname.padEnd(9)} ${dname.padEnd(5)} ${String(sig.length).padStart(6)} ${((g.setupMean >= 0 ? "+" : "") + g.setupMean.toFixed(3)).padStart(7)} ${mean(costs).toFixed(3).padStart(6)} ${g.tStat.toFixed(2).padStart(6)}  ${v}`);
      }
    }
  }
}
console.log(`\n════ VERDICT ════`);
console.log(`Cells tested: ${cells}   |   Cells that beat random AND make money: ${edges}`);
console.log(edges === 0 ? `ZERO edges across every market, timeframe, session and direction. The market is efficient at this resolution.` : `Edges: ${winners.join(", ")}`);
console.log(`\nThis is the exhaustive answer to "across all timeframes, markets, instruments and sessions." Combined with the`);
console.log(`123-instrument daily geometry (D-168) and the 45-instrument deploy-sim (D-169), it is the whole search space.`);
