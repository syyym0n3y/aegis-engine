#!/usr/bin/env -S deno run --allow-net
// trd-funding — the SENTIMENT/FUNDING lens (R-003 #11). Perpetual funding rate is a real, persistent
// crypto premium: when longs are crowded, funding is positive and longs PAY shorts. Two edges:
//   (A) CARRY — delta-neutral (long spot / short perp) harvests the funding as a yield.
//   (B) CONTRARIAN — extreme funding = crowded positioning = price tends to mean-revert.
// Tests both on real Binance funding history (keyless, 8h), with a shuffle null. Honest on n + costs.

async function funding(sym: string) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1000`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json() as any[];
  return j.map((x) => ({ t: x.fundingTime as number, f: Number(x.fundingRate), px: Number(x.markPrice) })).filter((x) => Number.isFinite(x.f) && x.px > 0);
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function mulberry32(s: number) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

for (const sym of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
  const d = await funding(sym);
  if (d.length < 200) { console.log(`\n${sym}: only ${d.length} funding points`); continue; }
  const days = (d[d.length - 1].t - d[0].t) / 86400000;
  const fr = d.map((x) => x.f);
  const annCarry = mean(fr) * 3 * 365 * 100; // 3 funding periods/day, annualized, %
  // (A) delta-neutral carry yield = just the funding collected by the short-perp/long-spot (no price risk)
  console.log(`\n══ ${sym} — ${d.length} funding pts over ${days.toFixed(0)}d ══`);
  console.log(`  (A) CARRY: avg funding ${(mean(fr) * 100).toFixed(4)}%/8h → delta-neutral yield ≈ ${annCarry.toFixed(1)}%/yr (before fees; real net lower)`);
  // (B) contrarian: position = -sign(funding - rolling median); forward return over next period
  const fwd: number[] = []; for (let i = 0; i < d.length - 1; i++) fwd.push(d[i + 1].px / d[i].px - 1);
  const COST = 0.0004; // ~4bps round-turn taker-ish per rebalance
  const med = [...fr].sort((a, b) => a - b)[fr.length >> 1];
  const trade: number[] = []; for (let i = 0; i < fwd.length; i++) { const pos = -Math.sign(fr[i] - med); if (pos !== 0) trade.push(pos * fwd[i] - COST); }
  const mu = mean(trade), sd = std(trade) || 1, tstat = mu / (sd / Math.sqrt(trade.length)), sharpe = (mu / sd) * Math.sqrt(3 * 365);
  const mid = Math.floor(trade.length * 0.6);
  const sh = (a: number[]) => (mean(a) / (std(a) || 1)) * Math.sqrt(3 * 365);
  const rnd = mulberry32(9); let beat = 0; const N = 1000; for (let k = 0; k < N; k++) { const rr = trade.map((x) => (rnd() < 0.5 ? x : -x)); if (sh(rr) >= sharpe) beat++; }
  console.log(`  (B) CONTRARIAN (fade funding vs median): n=${trade.length} exp/8h ${mu >= 0 ? "+" : ""}${(mu * 100).toFixed(3)}% annSharpe ${sharpe.toFixed(2)} t=${tstat.toFixed(2)} | OOS ${sh(trade.slice(0, mid)).toFixed(2)}/${sh(trade.slice(mid)).toFixed(2)} | shuffleP ${(beat / N).toFixed(3)} ${mu > 0 && tstat > 2 && sh(trade.slice(0, mid)) > 0 && sh(trade.slice(mid)) > 0 ? "*** REAL" : ""}`);
}
console.log(`\nRead: CARRY is a real yield but delta-neutral (needs spot+perp + fees eat it); CONTRARIAN needs to beat`);
console.log(`the shuffle null AND both OOS halves after cost. Funding is the one alt-data signal with free history.`);
