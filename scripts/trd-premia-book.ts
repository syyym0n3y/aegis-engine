#!/usr/bin/env -S deno run --allow-net
// trd-premia-book — the honest COMPOUNDING ENGINE: combine UNCORRELATED structural premia into one book so
// the diversification lifts the COMBINED Sharpe toward ~1, then leverage the low-drawdown result safely.
// Sleeves (free data): equity (SPY), duration (TLT), credit (HYG), gold (GLD), commodities (DBC), VRP
// (^PUT put-write) — risk-parity (inverse-vol) weighted — PLUS a time-series-momentum / managed-futures
// overlay (the crisis-diversifying trend premium). Vol-targeted. IS(60%)/OOS(40%). vs SPY buy&hold.

const SLEEVES = [["SPY", "equity"], ["TLT", "duration"], ["HYG", "credit"], ["GLD", "gold"], ["DBC", "commodities"], ["^PUT", "VRP"]] as const;
const ANN = 252, VOLTARGET = 0.12, REBAL = 21, MOM = 63, MAXLEV = 3;

async function daily(sym: string): Promise<Map<string, number>> {
  const p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json().catch(() => null); const res = j?.chart?.result?.[0]; const m = new Map<string, number>();
  if (!res?.timestamp) return m; const t = res.timestamp as number[]; const adj = res.indicators?.adjclose?.[0]?.adjclose ?? res.indicators.quote[0].close;
  for (let i = 0; i < t.length; i++) { const c = adj[i]; if (c > 0 && Number.isFinite(c)) m.set(new Date(t[i] * 1000).toISOString().slice(0, 10), c); }
  return m;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const maxDD = (r: number[]) => { let eq = 1, pk = 1, dd = 0; for (const x of r) { eq *= 1 + x; if (eq > pk) pk = eq; dd = Math.max(dd, (pk - eq) / pk); } return dd; };

const data = new Map<string, Map<string, number>>();
for (const [s] of SLEEVES) { const m = await daily(s); if (m.size > 300) data.set(s, m); }
const dates = [...data.get("SPY")!.keys()].filter((d) => SLEEVES.every(([s]) => data.get(s)!.has(d))).sort();
const N = dates.length; const syms = SLEEVES.map(([s]) => s);
const R = dates.map((d, i) => syms.map((s) => i ? Math.log(data.get(s)!.get(d)! / data.get(s)!.get(dates[i - 1])!) : 0));
console.log(`${syms.length} sleeves, ${dates[0]} → ${dates[N - 1]} (${(N / ANN).toFixed(0)}y)\n`);

const trailVol = (i: number, j: number) => { const w: number[] = []; for (let k = i - 60; k < i; k++) if (k >= 0) w.push(R[k][j]); return std(w) * Math.sqrt(ANN); };
// static risk-parity + trend overlay → combined daily returns, vol-targeted
function buildBook(): { rp: number[]; trend: number[]; combined: number[] } {
  const rp = new Array(N).fill(0), trend = new Array(N).fill(0), combined = new Array(N).fill(0);
  let wRP = new Array(syms.length).fill(0), wTR = new Array(syms.length).fill(0);
  for (let i = 1; i < N; i++) {
    let dRP = 0, dTR = 0; for (let j = 0; j < syms.length; j++) { dRP += wRP[j] * R[i][j]; dTR += wTR[j] * R[i][j]; }
    rp[i] = dRP; trend[i] = dTR;
    if (i % REBAL === 0 && i > 60) {
      const iv = syms.map((_, j) => { const v = trailVol(i, j); return v > 0 ? 1 / v : 0; });
      const sIv = iv.reduce((a, b) => a + b, 0) || 1;
      wRP = iv.map((x) => x / sIv);                                    // risk parity: inverse-vol
      // trend overlay: hold a sleeve only if its 63d momentum > 0 (time-series momentum), inverse-vol weighted
      const mom = syms.map((_, j) => { let s = 0; for (let k = i - MOM; k < i; k++) if (k >= 0) s += R[k][j]; return s; });
      const on = syms.map((_, j) => mom[j] > 0 ? iv[j] : 0); const sOn = on.reduce((a, b) => a + b, 0) || 1;
      wTR = on.map((x) => x / sOn);
    }
  }
  // combined = 60% risk-parity book + 40% trend overlay, then vol-target the whole thing
  for (let i = 0; i < N; i++) combined[i] = 0.6 * rp[i] + 0.4 * trend[i];
  const out = new Array(N).fill(0); let scale = 1;
  for (let i = 1; i < N; i++) { if (i % REBAL === 0 && i > 60) { const rv = std(combined.slice(Math.max(0, i - 60), i)) * Math.sqrt(ANN); scale = rv > 0 ? Math.min(MAXLEV, VOLTARGET / rv) : 1; } out[i] = combined[i] * scale; }
  return { rp, trend, combined: out };
}
const { rp, trend, combined } = buildBook();
const spyR = R.map((r) => r[0]);

const IS = Math.floor(N * 0.6);
const stat = (r: number[], lbl: string) => {
  const cagr = Math.exp(mean(r) * ANN) - 1; const sh = std(r) > 0 ? mean(r) / std(r) * Math.sqrt(ANN) : 0;
  const n = r.length, mr = mean(r), ms = mean(spyR.slice(0, n)); let cov = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { cov += (r[i] - mr) * (spyR[i] - ms); va += (r[i] - mr) ** 2; vb += (spyR[i] - ms) ** 2; }
  const corr = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
  console.log(`  ${lbl.padEnd(30)} CAGR ${(cagr * 100).toFixed(1).padStart(5)}%  Sharpe ${sh.toFixed(2)}  maxDD ${(maxDD(r) * 100).toFixed(0).padStart(3)}%  corr→SPY ${corr.toFixed(2)}`);
};
console.log("── FULL SAMPLE ──");
stat(spyR.slice(1), "SPY buy&hold");
stat(rp.slice(1), "Risk-parity sleeves");
stat(trend.slice(1), "Trend overlay (managed-fut)");
stat(combined.slice(1), "COMBINED book (vol-targ 12%)");
console.log("\n── OUT-OF-SAMPLE (last 40%) — the honest number ──");
stat(spyR.slice(IS), "SPY buy&hold");
stat(combined.slice(IS), "COMBINED book");
console.log("\n── COMBINED book LEVERAGED (drawdown-controlled → leverage-tolerant) ──");
for (const L of [2, 3]) stat(combined.slice(IS).map((x) => x * L), `COMBINED × ${L}  (OOS)`);

// sleeve correlation matrix (the whole point: uncorrelated → combined Sharpe lifts)
console.log("\n── sleeve correlation matrix (why it works: low cross-correlation) ──");
console.log("        " + syms.map((s) => s.replace("^", "").padStart(6)).join(" "));
for (let a = 0; a < syms.length; a++) {
  const row = syms.map((_, b) => { const x = R.map((r) => r[a]), y = R.map((r) => r[b]); const mx = mean(x), my = mean(y); let c = 0, vx = 0, vy = 0; for (let i = 0; i < N; i++) { c += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; } return (c / Math.sqrt(vx * vy)).toFixed(2).padStart(6); });
  console.log(`  ${syms[a].replace("^", "").padEnd(5)} ${row.join(" ")}`);
}
console.log(`\nREAD: if the COMBINED book clears ~Sharpe 1 with low SPY-correlation OOS, THAT is the compounding engine —`);
console.log(`leverage it (drawdown stays controlled) for reasonable-R:R serious returns. This is the honest 'a lot over time'.`);
