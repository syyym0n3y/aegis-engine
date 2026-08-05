#!/usr/bin/env -S deno run --allow-read --allow-net
// trd-session-tf-vol — don't neglect candles/sessions. The sizing models are daily→5d-vol; intraday traders
// live on 1m/5m/15m/1h candles and in Asia/London/NY sessions. This measures, on the deep 1-min data:
//   (1) realized vol BY SESSION (is NY riskier than Asia?) — the session risk profile.
//   (2) realized vol BY TIMEFRAME (the scaling a scalper vs swing trader must size against).
//   (3) does the DAILY regime (SqueezeMetrics GEX tercile) carry INTO each session's intraday vol?
//       — i.e., does the daily sizing signal generalise down to the session a trader is actually in.
// Free: Dukascopy 1-min S&P500 (usa500idxusd), 15y. Per ANALYSIS_CONTRACT: numbers, N, honest.
const DIR = "data/duka";
interface Bar { t: number; c: number; m: number; day: string; }
async function load1m(prefix: string): Promise<Bar[]> {
  const bars: Bar[] = []; const seen = new Set<number>();
  try { for await (const e of Deno.readDir(DIR)) {
    if (!e.name.startsWith(prefix) || !e.name.endsWith(".csv")) continue;
    const txt = await Deno.readTextFile(`${DIR}/${e.name}`);
    for (const line of txt.split("\n")) { const p = line.split(","); const t = +p[0]; if (!Number.isFinite(t) || t < 1e12 || seen.has(t)) continue; seen.add(t); const d = new Date(t); bars.push({ t, c: +p[4], m: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) }); }
  } } catch { /* */ }
  return bars.sort((a, b) => a.t - b.t);
}
// sessions in UTC minutes (non-overlapping cores)
const SESSIONS: Record<string, [number, number]> = { Asia: [0, 420], London: [420, 780], NY: [780, 1260] };
const ann = (x: number) => x * Math.sqrt(252) * 100; // session-daily vol → annualized %

async function main() {
  const bars = await load1m("usa500idxusd");
  if (bars.length < 10000) { console.log(`only ${bars.length} bars — need data/duka pull`); return; }
  console.log(`S&P500 1-min: ${bars.length} bars, ${bars[0].day}→${bars[bars.length - 1].day}\n`);
  // GEX regime by date (SqueezeMetrics), trailing-252 tercile
  const sq = (await (await fetch("https://squeezemetrics.com/monitor/static/DIX.csv", { headers: { "User-Agent": "Mozilla/5.0" } })).text()).trim().split("\n").slice(1).map((l) => l.split(","));
  const gexByDay = new Map<string, number>(); const gexArr: { d: string; g: number }[] = [];
  for (const p of sq) { gexByDay.set(p[0], +p[3]); gexArr.push({ d: p[0], g: +p[3] }); }
  const gexRank = new Map<string, number>(); // 0 low,1 mid,2 high tercile vs trailing 252
  for (let i = 252; i < gexArr.length; i++) { const w = gexArr.slice(i - 252, i).map((x) => x.g).sort((a, b) => a - b); const lo = w[84], hi = w[168]; gexRank.set(gexArr[i].d, gexArr[i].g <= lo ? 0 : gexArr[i].g >= hi ? 2 : 1); }

  // (1)+(3): per-day per-session realized vol from 1-min log returns
  const byDay = new Map<string, Bar[]>(); for (const b of bars) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b);
  const sessVol: Record<string, number[]> = { Asia: [], London: [], NY: [] };
  const sessVolByReg: Record<string, Record<number, number[]>> = { Asia: { 0: [], 1: [], 2: [] }, London: { 0: [], 1: [], 2: [] }, NY: { 0: [], 1: [], 2: [] } };
  for (const [day, ds] of byDay) {
    ds.sort((a, b) => a.t - b.t); const reg = gexRank.get(day);
    for (const [name, [s, e]] of Object.entries(SESSIONS)) {
      const win = ds.filter((b) => b.m >= s && b.m < e); if (win.length < 30) continue;
      let ss = 0, k = 0; for (let i = 1; i < win.length; i++) { const r = Math.log(win[i].c / win[i - 1].c); if (Number.isFinite(r)) { ss += r * r; k++; } }
      if (k < 20) continue; const rv = Math.sqrt(ss); // session realized vol (daily units)
      sessVol[name].push(rv); if (reg != null) sessVolByReg[name][reg].push(rv);
    }
  }
  const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  console.log(`(1) Realized vol BY SESSION (annualized %, from 1-min):`);
  for (const s of ["Asia", "London", "NY"]) console.log(`   ${s.padEnd(7)} ${ann(mean(sessVol[s])).toFixed(1)}%   n=${sessVol[s].length} days`);
  console.log(`\n(3) Does the DAILY GEX regime carry into each session's intraday vol? (ann %, low→high gamma)`);
  for (const s of ["Asia", "London", "NY"]) {
    const lo = ann(mean(sessVolByReg[s][0])), mid = ann(mean(sessVolByReg[s][1])), hi = ann(mean(sessVolByReg[s][2]));
    console.log(`   ${s.padEnd(7)} low-γ ${lo.toFixed(1)}%  mid ${mid.toFixed(1)}%  high-γ ${hi.toFixed(1)}%   ratio ${(lo / hi).toFixed(2)}× ${lo > hi ? "✓ regime carries into session" : "✗"}`);
  }
  // (2) timeframe scaling: realized vol computed on resampled candles (whole-day, NY session)
  console.log(`\n(2) Realized vol BY TIMEFRAME (NY session, ann %): shows the scaling a scalper vs swing trader sizes against`);
  for (const tf of [1, 5, 15, 60]) {
    const rvs: number[] = [];
    for (const [, ds] of byDay) {
      const win = ds.filter((b) => b.m >= 780 && b.m < 1260); if (win.length < 60) continue;
      const samp = win.filter((_, i) => i % tf === 0); if (samp.length < 5) continue;
      let ss = 0; for (let i = 1; i < samp.length; i++) { const r = Math.log(samp[i].c / samp[i - 1].c); if (Number.isFinite(r)) ss += r * r; }
      rvs.push(Math.sqrt(ss));
    }
    console.log(`   ${String(tf + "m").padEnd(4)} ${ann(mean(rvs)).toFixed(1)}%   n=${rvs.length}`);
  }
  console.log(`\nREAD: session vol profile + whether the daily sizing regime generalises intraday (if low-γ raises session vol, the`);
  console.log(`daily de-risk is valid for intraday sizing too). TF scaling ≈ √horizon absent microstructure noise.`);
}
await main();
