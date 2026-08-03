#!/usr/bin/env -S deno run --allow-read
// trd-session-sweep — run the session ORB sweep on real intraday bars and push every
// segment through the honest gate: DSR deflated by the TOTAL session×weekday×direction
// grid, so a data-mined "Tuesday London" is judged against the whole surface it was
// picked from. BARS_FILE = { "BTC/USD":[{ts,open,high,low,close,volume}...], ... }.

import { IntradayBar } from "../supabase/functions/_shared/trd-session.ts";
import { sweepSessions } from "../supabase/functions/_shared/trd-session-strategy.ts";
import { deflatedSharpe, kurtosis, sharpe, skewness } from "../supabase/functions/_shared/trd-stats.ts";

const FILE = Deno.env.get("BARS_FILE")!;
const OR_MIN = Number(Deno.env.get("OR_MIN") ?? "30");
const TARGET_R = Number(Deno.env.get("TARGET_R") ?? "2");
const RISK_FRAC = Number(Deno.env.get("RISK_FRAC") ?? "0.01");

const raw = JSON.parse(await Deno.readTextFile(FILE)) as Record<string, IntradayBar[]>;
import { Session } from "../supabase/functions/_shared/trd-session.ts";
import { Direction } from "../supabase/functions/_shared/trd-session-strategy.ts";
const sessions: Session[] = ["asia", "london", "ny"];
const weekdays = [1, 2, 3, 4, 5]; // Mon..Fri
const directions: Direction[] = ["breakout", "fade"];

// gather every segment across every symbol; the trial count is the whole grid × symbols
type Row = { symbol: string; segment: string; nTrades: number; winRate: number; avgR: number; sharpe: number; rets: number[] };
const rows: Row[] = [];
for (const [symbol, bars] of Object.entries(raw)) {
  const { stats } = sweepSessions(bars, { sessions: [...sessions], weekdays, directions, openingRangeMin: OR_MIN, targetR: TARGET_R, riskFraction: RISK_FRAC });
  for (const s of stats) rows.push({ symbol, segment: s.segment, nTrades: s.nTrades, winRate: s.winRate, avgR: s.avgR, sharpe: s.sharpePerTrade, rets: s.perTradeReturns });
}

const nTrials = rows.length; // the honest multiple-testing surface
const varTrialSharpes = (() => {
  const xs = rows.map((r) => r.sharpe).filter(Number.isFinite);
  if (xs.length < 2) return 0.04;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
})();

// rank by raw per-trade Sharpe, then deflate the leaders by the full grid
rows.sort((a, b) => b.sharpe - a.sharpe);
console.log(`\n[session-sweep] ${Object.keys(raw).length} instruments, ${nTrials} segments tested (the trial surface)`);
console.log(`  grid: sessions=${sessions.join("/")} × weekdays=Mon-Fri × dir=breakout/fade | OR=${OR_MIN}m targetR=${TARGET_R} risk=${RISK_FRAC}`);
console.log(`\n  top 6 segments by raw per-trade Sharpe — then DEFLATED by ${nTrials} trials:`);
let anyPass = false;
for (const r of rows.slice(0, 6)) {
  const dsr = r.rets.length >= 2
    ? deflatedSharpe(sharpe(r.rets), r.rets.length, skewness(r.rets), kurtosis(r.rets), nTrials, varTrialSharpes)
    : 0;
  const pass = dsr >= 0.95;
  anyPass = anyPass || pass;
  console.log(
    `   ${r.symbol} ${r.segment.padEnd(20)} n=${String(r.nTrades).padStart(3)}  win=${(r.winRate * 100).toFixed(0)}%  avgR=${r.avgR.toFixed(2)}  rawSharpe=${r.sharpe.toFixed(3)}  →  DSR=${dsr.toFixed(3)}  ${pass ? "PASS" : "reject"}`,
  );
}
const totalTrades = rows.reduce((a, r) => a + r.nTrades, 0);
console.log(`\n  VERDICT: ${anyPass ? "a segment cleared DSR — investigate out-of-sample" : "NOTHING cleared the deflated gate"} (${totalTrades} trades across all segments; median segment n≈${rows.map((r) => r.nTrades).sort((a, b) => a - b)[Math.floor(rows.length / 2)]})`);
console.log(`  Honest note: 90 days of data → most segments are n<15. Small-sample by construction; the gate is doing its job.`);
