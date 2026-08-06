#!/usr/bin/env -S deno run --allow-net
// trd-housemoney-backtest — run the ACTUAL house-money risk model over the survivor's full trade history
// (dip-buy: RSI14<30 while price>200MA, the only Rule-7 survivor, D-147) and answer the operator's question:
// does risking BANKED PROFIT compound the account while the ORIGINAL DEPOSIT stops being exposed?
// Chronological across 45 instruments, one position at a time, real sizing via _shared/trd-decision.ts,
// vol de-risk applied, regime costs. Compared against flat-risk and against a random-entry control curve.
import { decide } from "../supabase/functions/_shared/trd-decision.ts";
import { volRegimeDeRisk } from "../supabase/functions/_shared/trd-vol-regime.ts";
import { mean, maxDrawdown } from "../supabase/functions/_shared/trd-stats.ts";
const UNIVERSE = ["SPY","QQQ","IWM","DIA","EFA","EEM","FXI","EWZ","XLK","XLF","XLE","XLV","XLU","XLI","XLP","XLY","XLB","SMH","XBI","KRE","GLD","SLV","USO","DBC","TLT","IEF","HYG","LQD","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","KO","PFE","INTC","CSCO","BA","GE","F"];
const H = 5, STOP_ATR = 2, ATRN = 14, DEPOSIT = 10000;
const RCOST: Record<string, number> = { calm: 0.04, norm: 0.08, stress: 0.20 };
let seed = 4242; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
interface B { d: string; o: number; h: number; l: number; c: number }
async function daily(sym: string): Promise<B[]> { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }); const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return []; const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const o: B[] = []; for (let i = 0; i < t.length; i++) { const O = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([O, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue; o.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), o: O, h, l, c }); } return o; }
function atr(b: B[], n: number) { const tr: number[] = []; for (let i = 0; i < b.length; i++) tr.push(i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))); const o = new Array(b.length).fill(NaN); let s = 0; for (let i = 0; i < b.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function rsi(cl: number[], n: number) { const o = new Array(cl.length).fill(NaN); let ag = 0, al = 0; for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + ag / (al || 1e-9)); } } return o; }
const vixJ = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const vt = vixJ?.chart?.result?.[0]?.timestamp as number[]; const vc = vixJ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close as number[]; const vix = new Map<string, number>(); for (let i = 0; i < vt.length; i++) if (Number.isFinite(vc[i])) vix.set(new Date(vt[i] * 1000).toISOString().slice(0, 10), vc[i]);

// build the chronological signal ledger across the universe
interface Sig { date: string; sym: string; r: number; deRisk: number; stopPct: number; rsi: number; price: number; sma200: number; randR: number }
const ledger: Sig[] = [];
for (const sym of UNIVERSE) {
  const b = await daily(sym); if (b.length < 500) continue;
  const cl = b.map((x) => x.c); const at = atr(b, ATRN); const r14 = rsi(cl, 14);
  const sma200 = (i: number) => { if (i < 200) return NaN; let s = 0; for (let k = i - 200; k < i; k++) s += cl[k]; return s / 200; };
  const price = (i: number, vreg: string): number | null => { const sd = STOP_ATR * at[i]; if (!(sd > cl[i] * 1e-4) || i + H + 1 >= b.length) return null; const entry = b[i + 1].o, stop = entry - sd; let r: number | null = null; for (let k = i + 1; k <= i + H; k++) if (b[k].l <= stop) { r = -1; break; } if (r === null) r = (b[i + H].c - entry) / sd; return Math.max(-1.5, Math.min(r, 15)) - RCOST[vreg]; };
  const pool: number[] = []; for (let i = 210; i < b.length - H - 1; i++) pool.push(i);
  for (let i = 210; i < b.length - H - 1; i++) {
    const ma = sma200(i); if (!(at[i] > 0) || !(ma > 0)) continue;
    if (!(r14[i] < 30 && cl[i] > ma)) continue;
    const v = vix.get(b[i].d) ?? 15; const vreg = v < 15 ? "calm" : v < 25 ? "norm" : "stress";
    const r = price(i, vreg); if (r === null) continue;
    const rets: number[] = []; for (let k = Math.max(1, i - 300); k <= i; k++) rets.push(cl[k] / cl[k - 1] - 1);
    const vr = volRegimeDeRisk(rets);
    const j = pool[Math.floor(rnd() * pool.length)]; const rc = price(j, vreg);
    ledger.push({ date: b[i].d, sym, r, deRisk: vr.deRisk, stopPct: (STOP_ATR * at[i]) / cl[i] * 100, rsi: r14[i], price: cl[i], sma200: ma, randR: rc ?? 0 });
  }
}
ledger.sort((a, b) => a.date < b.date ? -1 : 1);
console.log(`HOUSE-MONEY BACKTEST — survivor dip-buy, ${ledger.length} signals, ${ledger[0].date} → ${ledger[ledger.length - 1].date}, ${UNIVERSE.length} instruments\n`);

function runModel(name: string, sizer: (eq: number, s: Sig) => number, useRandom = false) {
  let eq = DEPOSIT, peakEq = DEPOSIT, minDepositEq = DEPOSIT; const curve: number[] = []; let wins = 0, n = 0; let maxDepositExposurePct = 0;
  for (const s of ledger) {
    const risk = sizer(eq, s); if (risk <= 0) continue;
    const rr = useRandom ? s.randR : s.r;
    const pnl = risk * rr; eq += pnl; n++; if (pnl > 0) wins++;
    if (eq > peakEq) peakEq = eq; if (eq < minDepositEq) minDepositEq = eq;
    const depositPortion = Math.min(risk, DEPOSIT * 0.005 * s.deRisk);
    maxDepositExposurePct = Math.max(maxDepositExposurePct, depositPortion / DEPOSIT * 100);
    curve.push(eq);
  }
  const rets: number[] = []; for (let i = 1; i < curve.length; i++) rets.push(curve[i] / curve[i - 1] - 1);
  const dd = maxDrawdown(rets) * 100;
  const yrs = (Date.parse(ledger[ledger.length - 1].date) - Date.parse(ledger[0].date)) / (365.25 * 864e5);
  const cagr = (Math.pow(eq / DEPOSIT, 1 / yrs) - 1) * 100;
  console.log(`${name.padEnd(34)} final $${Math.round(eq).toLocaleString().padStart(12)}  ${(eq / DEPOSIT).toFixed(2).padStart(7)}×  CAGR ${cagr.toFixed(1).padStart(6)}%  maxDD ${dd.toFixed(1).padStart(5)}%  n=${n}  win ${(wins / n * 100).toFixed(0)}%  min-equity $${Math.round(minDepositEq).toLocaleString()}`);
  return { eq, dd, minDepositEq };
}
const D = 0.005, HM = 0.02;
console.log(`${"model".padEnd(34)} ${"final".padStart(19)}  ${"mult".padStart(7)}  ${"CAGR".padStart(11)}  ${"maxDD".padStart(11)}`);
runModel("HOUSE MONEY (0.5% dep + 2% profit)", (eq, s) => { const banked = Math.max(0, eq - DEPOSIT); return Math.min((DEPOSIT * D + banked * HM) * s.deRisk, eq * 0.02); });
runModel("flat 0.5% of EQUITY (compounding)", (eq, s) => Math.min(eq * D * s.deRisk, eq * 0.02));
runModel("flat 2% of EQUITY (aggressive)", (eq, s) => Math.min(eq * 0.02 * s.deRisk, eq * 0.02));
runModel("fixed $50 (no compounding)", (_eq, s) => 50 * s.deRisk);
console.log(`\nSAME MODELS ON RANDOM ENTRIES (the control — does the money model rescue a non-edge?):`);
runModel("HOUSE MONEY on RANDOM entries", (eq, s) => { const banked = Math.max(0, eq - DEPOSIT); return Math.min((DEPOSIT * D + banked * HM) * s.deRisk, eq * 0.02); }, true);
runModel("flat 2% on RANDOM entries", (eq, s) => Math.min(eq * 0.02 * s.deRisk, eq * 0.02), true);
console.log(`\nDEPOSIT SAFETY: house-money model risks at most ${(D * 100).toFixed(2)}% × de-risk of the ORIGINAL deposit per trade,`);
console.log(`regardless of account size — the rest of every trade's risk is banked profit. Min equity reached is the true deposit test.`);
