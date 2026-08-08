#!/usr/bin/env -S deno run --allow-net
// trd-tail-study — the honest, real-data study of "huge move" days across many markets.
// Question: find every big-move day, and test whether those days are DISTINGUISHABLE / PREDICTABLE
// vs normal days — so we can tell traders how to react to the riskiest days. Real Yahoo daily data
// (decades). Every predictor is STRICTLY CAUSAL (only ever sees trailing data). Every claim prints N.
//
// This version incorporates an adversarial audit (D-100 verification pass):
//  - HEADLINE predictability uses a CAUSAL tail label (|r_t| > 3*trailing-σ), which removes the
//    fixed-full-sample-σ threshold that interacts with heteroskedasticity to inflate the effect.
//    The fixed-σ version is reported too, marked as the (inflated) descriptive figure.
//  - Level series (yields ^TNX, dollar index) are EXCLUDED from pooled tail/regime aggregates —
//    their log-"returns" are not tradeable asset P&L and have a different generating process.
//    They remain in the per-market table (marked ‡) for context.
//  - adjClose (dividend-adjusted) is used where available.
//  - The "big-up-day near a crash" window is BACKWARD-ONLY (causal): a crash in the PRIOR 3 days.
//  - The below-200MA share counts numerator and denominator over the SAME i>=200 window.

const MARKETS: [string, string, boolean][] = [ // [name, symbol, isLevelSeries]
  ["S&P500", "^GSPC", false], ["Nasdaq", "^IXIC", false], ["Russell2k", "^RUT", false], ["FTSE100", "^FTSE", false],
  ["DAX", "^GDAXI", false], ["Nikkei", "^N225", false], ["HangSeng", "^HSI", false], ["BTC", "BTC-USD", false],
  ["ETH", "ETH-USD", false], ["Gold", "GC=F", false], ["Oil", "CL=F", false], ["Silver", "SI=F", false],
  ["TLT", "TLT", false], ["HYG", "HYG", false], ["EEM", "EEM", false],
  ["US10yYld", "^TNX", true], ["Dollar", "DX-Y.NYB", true],
];

interface Row { d: string; c: number; }
async function daily(sym: string): Promise<Row[]> {
  const p2 = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0].close as number[];
  const adj = res.indicators?.adjclose?.[0]?.adjclose as number[] | undefined; // dividend-adjusted when present
  const c = adj && adj.length === t.length ? adj : q; const out: Row[] = [];
  for (let i = 0; i < t.length; i++) { if (c[i] == null || !Number.isFinite(c[i]) || c[i] <= 0) continue; out.push({ d: new Date(t[i] * 1000).toISOString().slice(0, 10), c: c[i] }); }
  return out;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const dow = (d: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(d + "T00:00:00Z").getUTCDay()];

const tailDatesByMkt = new Map<string, Set<string>>();
// pooled aggregates — CAUSAL tail label, tradeable markets only
let cElevTail = 0, cCalmTail = 0, cElevDays = 0, cCalmDays = 0;   // causal (trailing-σ) label
let fElevTail = 0, fCalmTail = 0;                                  // fixed-σ label, same denominators (for contrast)
let upInDowntrend = 0, upTotal = 0, upAfterCrash = 0;
const dowTail: Record<string, number> = {}; let dowTotalTail = 0;

console.log("MARKET        N      from        annVol%  kurt   tail(|r|>3σfull)  worstDown          bestUp");
for (const [name, sym, isLevel] of MARKETS) {
  const rows = await daily(sym); if (rows.length < 300) { console.log(`${name}: too few rows (${rows.length})`); continue; }
  const r: number[] = [], dates: string[] = [], closes: number[] = [];
  for (let i = 1; i < rows.length; i++) { r.push(Math.log(rows[i].c / rows[i - 1].c)); dates.push(rows[i].d); closes.push(rows[i].c); }
  const n = r.length; const sigFull = std(r); const m = mean(r);
  const kurt = r.reduce((s, x) => s + ((x - m) / sigFull) ** 4, 0) / n;
  const annVol = sigFull * Math.sqrt(252) * 100;
  const down = [...r.keys()].sort((a, b) => r[a] - r[b])[0], up = [...r.keys()].sort((a, b) => r[b] - r[a])[0];

  // descriptive tail set (fixed full-sample σ) — for the biggest-days table + systemic-day coincidence
  const tset = new Set<string>();
  for (let i = 0; i < n; i++) if (Math.abs(r[i]) > 3 * sigFull) { tset.add(dates[i]); if (!isLevel) { dowTail[dow(dates[i])] = (dowTail[dow(dates[i])] ?? 0) + 1; dowTotalTail++; } }
  tailDatesByMkt.set(name + (isLevel ? "‡" : ""), tset);
  const tailNfull = tset.size;

  // trailing realized vol (causal): RV[i] uses r[i-20..i-1]
  const RV: number[] = new Array(n).fill(NaN);
  for (let i = 20; i < n; i++) RV[i] = std(r.slice(i - 20, i));

  if (!isLevel) { // pooled predictability only over TRADEABLE assets
    for (let i = 272; i < n; i++) {
      if (!Number.isFinite(RV[i])) continue;
      const sigTrail = std(r.slice(i - 252, i)); if (!(sigTrail > 0)) continue;
      const hist = RV.slice(i - 252, i).filter(Number.isFinite); if (hist.length < 100) continue;
      const elevated = RV[i] > median(hist);           // causal regime, knowable before day i
      const tailCausal = Math.abs(r[i]) > 3 * sigTrail; // causal tail label (local σ) — artifact-free
      const tailFixed = Math.abs(r[i]) > 3 * sigFull;   // fixed-σ label (for contrast)
      if (elevated) { cElevDays++; if (tailCausal) cElevTail++; if (tailFixed) fElevTail++; }
      else { cCalmDays++; if (tailCausal) cCalmTail++; if (tailFixed) fCalmTail++; }
    }
    // anatomy of biggest UP days — numerator & denominator over the SAME i>=200 window; crash window BACKWARD-only
    const thrUp = [...r].sort((a, b) => b - a)[Math.floor(n * 0.01)];
    for (let i = 200; i < n; i++) {
      if (r[i] < thrUp) continue; upTotal++;
      if (closes[i] < mean(closes.slice(i - 200, i))) upInDowntrend++;
      let crashPrior = false; for (let j = i - 3; j < i; j++) if (r[j] < -3 * sigFull) crashPrior = true; // PRIOR 3 days only
      if (crashPrior) upAfterCrash++;
    }
  }

  console.log(
    `${(name + (isLevel ? "‡" : "")).padEnd(11)} ${String(n).padStart(6)} ${dates[0]}  ${annVol.toFixed(1).padStart(6)}  ${kurt.toFixed(1).padStart(5)}  ` +
    `${String(tailNfull).padStart(4)} (${(tailNfull / n * 100).toFixed(2)}%)   ${dates[down]} ${(r[down] * 100).toFixed(1)}%   ${dates[up]} +${(r[up] * 100).toFixed(1)}%`
  );
}

const pElevC = cElevTail / cElevDays, pCalmC = cCalmTail / cCalmDays;
const pElevF = fElevTail / cElevDays, pCalmF = fCalmTail / cCalmDays;
console.log(`\n══ CAUSAL predictability (tradeable assets only, ${(cElevDays + cCalmDays).toLocaleString()} market-days, look-ahead-free) ══`);
console.log(`  HEADLINE — causal tail label |r|>3·trailing-σ (artifact-free):`);
console.log(`    P(tail | vol ELEVATED)=${(pElevC * 100).toFixed(3)}% (${cElevTail}/${cElevDays})   P(tail | CALM)=${(pCalmC * 100).toFixed(3)}% (${cCalmTail}/${cCalmDays})   ratio=${(pElevC / pCalmC).toFixed(1)}×`);
console.log(`    share of causal tails in elevated regime: ${(cElevTail / (cElevTail + cCalmTail) * 100).toFixed(1)}%`);
console.log(`  CONTRAST — fixed full-sample-σ label (inflated by heteroskedasticity, do NOT headline):`);
console.log(`    ratio=${(pElevF / pCalmF).toFixed(1)}×   share in elevated: ${(fElevTail / (fElevTail + fCalmTail) * 100).toFixed(1)}%`);

console.log(`\n══ Anatomy of the biggest UP days (pooled top-1%, i≥200, ${upTotal} days, tradeable assets) ══`);
console.log(`  occurred while price BELOW its 200d MA (bear-market rallies): ${(upInDowntrend / upTotal * 100).toFixed(1)}%`);
console.log(`  occurred within 3 days AFTER a >3σ crash day (causal):        ${(upAfterCrash / upTotal * 100).toFixed(1)}%`);

console.log(`\n══ Day-of-week of tail days (pooled ${dowTotalTail}, tradeable) ══`);
for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"]) console.log(`  ${d}: ${((dowTail[d] ?? 0) / dowTotalTail * 100).toFixed(1)}%`);

const coincide = new Map<string, string[]>();
for (const [mkt, set] of tailDatesByMkt) for (const d of set) (coincide.get(d) ?? coincide.set(d, []).get(d)!).push(mkt);
const systemic = [...coincide.entries()].filter(([, ms]) => ms.length >= 5).sort((a, b) => b[1].length - a[1].length);
console.log(`\n══ SYSTEMIC days — ≥5 markets had a >3σ move on the SAME date (${systemic.length} such days) ══`);
for (const [d, ms] of systemic.slice(0, 12)) console.log(`  ${d}: ${ms.length} [${ms.join(", ")}]`);

console.log(`\nNOTE: predictors are strictly causal (trailing only). Sign of the move is NOT predicted. ‡=level series`);
console.log(`(yield/FX), shown for context but EXCLUDED from pooled tail/regime stats. Futures (GC/CL/SI) carry mild roll artifacts.`);
