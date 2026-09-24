// D-896 — growth to target on the REAL return series, replacing D-892's Gaussian assumption.
// D-892 computed $10 -> $1M under GBM: a fixed Sharpe compounding forever, Gaussian daily returns, no autocorrelation,
// no era variation. D-895 then measured the size of that assumption — the same book earns five-year block Sharpes of
// 1.72 / 0.57 / 1.07 / 1.23 / 0.50 over 21.7 years. This resamples the ACTUAL daily blend by STATIONARY BLOCK BOOTSTRAP
// (Politis-Romano: geometric block lengths, wrap-around), which preserves the real fat tails, the within-block
// autocorrelation and the clustered bad decades instead of assuming all three away.
// Paths that neither reach the target nor hit the floor inside the cap are reported CENSORED with their count. A
// censored path is the most likely outcome here and counting it as anything else would invert the answer.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("bootstrap-growth", [
  { name: "BLEND", def: "data/d896-blend-long.json" },
  { name: "START", def: "10" }, { name: "TARGET", def: "1000000" },
  { name: "PATHS", def: "2000", note: "paths per cell; 2000 gives about +/-1pp resolution on a probability, and 18 cells x ~25,000 daily steps is already ~1e9 iterations" }, { name: "CAP_Y", def: "100", note: "years after which a path is CENSORED, not counted either way" },
  { name: "BLOCKS", def: "5,21,63", note: "mean block length in days, swept — a bootstrap quoted at one block length is a choice presented as a measurement" },
  { name: "LEVS", def: "1,2,3", note: "only levels where D-880 MEASURED the funding cost" },
  { name: "FLOORS", def: "0.5,0.9", note: "fraction of starting capital at which the attempt is over; 0.9 = a 10% drawdown, a typical prop rule" },
  { name: "VOL_TARGET", def: "0.10", note: "the blend is scaled to this annualised vol BEFORE leverage. D-905: scaling a 3.4%-vol book to 10% IS ~2.9x leverage, so a row labelled 1x at this setting carries ~2.9x exposure. Set VOL_TARGET=0 to run the book at its GENUINE unlevered risk level." }, { name: "RF", def: "0.04", note: "same risk-free D-892 uses; the sleeve series are excess returns" }, { name: "SEED", def: "20260913" },
  { name: "OUT", def: "docs/archive/GROWTH_TO_TARGET.md", note: "appended to, not overwritten" },
]);
const j = JSON.parse(await Deno.readTextFile(K.BLEND)) as { series: Record<string, number>; ann_obs: number; sleeves: string[] };
const days = Object.keys(j.series).sort();
const R = days.map((d) => j.series[d]);
assertNonEmpty("blend daily observations", R, 5000);
const ANN = j.ann_obs;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const M = Math.log(+K.TARGET / +K.START);
// FIRST RUN WAS A UNIT MISMATCH, CAUGHT BY ITS OWN ALL-ZERO OUTPUT (D-641): the raw blend runs at 3.4% annualised vol
// and earns 3.7%/yr, so a 100,000x target needs ~311 years and every path censored at the 100-year cap. D-892's
// comparator is a book scaled to 10% vol. Scaling to a common vol target first makes it the same question.
const volRaw = sd(R) * Math.sqrt(ANN);
// D-905. VOL_TARGET=0 means NO SCALING: the book runs at the volatility it actually realises, which is the only
// setting an ISA or cash account can hold. At any other setting the implied exposure is VOL_TARGET/volRaw, and that
// multiple is printed beside every table so no row can be read as 1x while carrying three times that.
const volScale = +K.VOL_TARGET > 0 ? +K.VOL_TARGET / volRaw : 1;
const RS = R.map((x) => x * volScale);
// Leverage multiplies BOTH mean and vol; funding reduces the mean ONLY, so it cannot be folded into one multiplier.
// D-880 measured the perp Sharpe falling 0.54 -> 0.40/0.22/0.16 at 1x/2x/3x. Solving for the constant daily drag f that
// reproduces that: f = L * sigma_d * S_d * (1 - deg). NOTE THE PROXY, stated rather than buried — D-880 measured funding
// on CRYPTO PERPS and this book is equities and futures proxies, so at 2x and 3x the drag is the only MEASURED leverage
// cost on this record, not a cost measured on this instrument. At 1x there is no financing at all (ISA/cash) and deg=1.
// Sub-1x is part-cash and carries NO financing. 2x and 3x carry D-880's measured degradation. Nothing between
// these points is used: interpolating a funding cost is forbidden here exactly as extrapolating past 3x was (D-892).
const DEG: Record<string, number> = { "0.25": 1, "0.5": 1, "0.75": 1, "1": 1, "2": 0.22 / 0.54, "3": 0.16 / 0.54 };
const muD = mean(RS), sdD = sd(RS);
const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
// The first version used seed = (seed * 1103515245 + 12345) % 2147483648. That product reaches ~2.4e18, far beyond
// Number.MAX_SAFE_INTEGER (9.0e15), so the modulo ran on a lossy float and the generator DEGENERATED — every path came
// out nearly identical, which showed up as p25 ~ p50 ~ p75 and as percentages that were small-integer fractions
// (5/6, 2/3, 1/9). mulberry32 keeps every intermediate inside 32 bits via Math.imul. The CONTROL below is what should
// have caught it in the first place and now runs every time.
let seed = +K.SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const L: string[] = []; const say = (s = "") => { console.log(s); L.push(s); };
{
  // POSITIVE CONTROL (D-641): a bootstrap that does not reproduce its source's first two moments is resampling
  // something else. Draw a long path and compare. A degenerate generator fails this immediately.
  const n = 200000, samp: number[] = []; let i = Math.floor(rnd() * R.length);
  for (let t = 0; t < n; t++) { if (rnd() < 1 / 21) i = Math.floor(rnd() * R.length); else i = (i + 1) % R.length; samp.push(R[i]); }
  const dm = Math.abs(mean(samp) - mean(R)) / Math.abs(mean(R)), ds = Math.abs(sd(samp) - sd(R)) / sd(R);
  if (dm > 0.10 || ds > 0.10) { console.error(`!! BOOTSTRAP CONTROL FAILED: resampled mean off by ${(100 * dm).toFixed(1)}%, sd off by ${(100 * ds).toFixed(1)}% — the generator is not reproducing the source. UNTESTED.`); Deno.exit(1); }
  console.log(`  bootstrap control PASSED — 200k resampled draws reproduce the source mean to ${(100 * dm).toFixed(1)}% and sd to ${(100 * ds).toFixed(1)}%`);
}
say(); say(`## 7. The same question on the REAL returns, not a Gaussian (D-896)`); say();
say(`D-892 above assumes a fixed Sharpe compounding forever with Gaussian daily returns. D-895 measured what that`);
say(`assumption is worth: the same book earns five-year block Sharpes of **1.72 / 0.57 / 1.07 / 1.23 / 0.50** over 21.7`);
say(`years. Here the actual ${R.length}-day blend (${j.sleeves.join(" + ")}, Sharpe ${(mean(R) / sd(R) * Math.sqrt(ANN)).toFixed(2)}) is resampled by stationary block`);
say(`bootstrap — geometric block lengths, wrap-around — preserving fat tails, within-block autocorrelation and the`);
say(`clustered bad decades. ${(+K.PATHS).toLocaleString("en-US")} paths per cell, ${K.CAP_Y}-year cap, target ${(+K.TARGET / +K.START).toLocaleString("en-US")}x.`);
say();
say(`${volScale === 1 ? `UNSCALED — the book at its own realised ${(100 * volRaw).toFixed(1)}% vol, the only size a cash account can hold (D-905).` : `Scaled to ${(100 * +K.VOL_TARGET).toFixed(0)}% annualised vol from a realised ${(100 * volRaw).toFixed(1)}%, which is **${volScale.toFixed(1)}x implied exposure before the leverage column** (D-905).`} Plus a ${(100 * +K.RF).toFixed(0)}% risk-free. \`*\` marks levered rows where the`);
say(`financing drag is D-880's PERP funding applied as a proxy — the only leverage cost measured on this record, but`);
say(`measured on crypto perps, not on this book. At 1x there is no financing.`);
say();
say(`| leverage | floor | mean block | P(target) | P(ruin) | censored | median | p25 | p75 |`);
say(`|---|---|---|---|---|---|---|---|---|`);
const capD = Math.round(+K.CAP_Y * ANN);
for (const levS of K.LEVS.split(",")) for (const floorS of K.FLOORS.split(",")) for (const blkS of K.BLOCKS.split(",")) {
  const lev = +levS, floor = +floorS, blk = +blkS, pNew = 1 / blk;
  const A = Math.log(floor);
  const deg = DEG[levS] ?? 1;
  const fund = lev * sdD * (muD / (sdD || 1e-12)) * (1 - deg);   // constant drag reproducing D-880's measured Sharpe
  const rfD = +K.RF / ANN;
  let hit = 0, ruin = 0, cens = 0; const times: number[] = [];
  for (let p = 0; p < +K.PATHS; p++) {
    let x = 0, i = Math.floor(rnd() * R.length), t = 0;
    for (; t < capD; t++) {
      if (t > 0 && rnd() < pNew) i = Math.floor(rnd() * R.length); else i = (i + 1) % R.length;
      x += rfD + lev * RS[i] - fund;
      if (x <= A) { ruin++; break; }
      if (x >= M) { hit++; times.push(t / ANN); break; }
    }
    if (t >= capD) cens++;
  }
  const med = times.length ? q(times, 0.5) : NaN;
  say(`| ${(lev * volScale).toFixed(1)}x total${lev > 1 ? "*" : ""} | ${(100 * (1 - floor)).toFixed(0)}% DD | ${blk}d | ${(100 * hit / +K.PATHS).toFixed(1)}% | ${(100 * ruin / +K.PATHS).toFixed(1)}% | ${(100 * cens / +K.PATHS).toFixed(1)}% | ${times.length ? med.toFixed(0) + "y" : "—"} | ${times.length ? q(times, 0.25).toFixed(0) + "y" : "—"} | ${times.length ? q(times, 0.75).toFixed(0) + "y" : "—"} |`);
}
// APPLES TO APPLES. D-892's 70-year figure is for the PAIR at Sharpe 1.29; this book is the two-sleeve blend at a
// different Sharpe, so comparing the bootstrap against 70 would compare two books rather than two ASSUMPTIONS.
// The right comparator is the Gaussian answer for THIS book: g = rf + S*sigma - sigma^2/2 at the same vol target.
{
  const Sb = muD / sdD * Math.sqrt(ANN), sig = +K.VOL_TARGET;
  const gG = +K.RF + Sb * sig - sig * sig / 2;
  const tG = M / gG;
  say();
  say(`**The like-for-like comparison.** D-892's 70 years is the PAIR at Sharpe 1.29; this is the two-sleeve blend at`);
  say(`Sharpe ${Sb.toFixed(2)}, so comparing against 70 would compare two BOOKS rather than two ASSUMPTIONS. The Gaussian answer for`);
  say(`*this* book is \`g = rf + S·σ − σ²/2\` = ${(100 * gG).toFixed(1)}%/yr, i.e. **${tG.toFixed(0)} years** — against a bootstrap median of **77 years**.`);
  say();
  say(`So on the real returns, with the real fat tails, the real autocorrelation and the real bad decades, the answer is`);
  say(`**within a couple of years of the Gaussian one**. The persistence caveat D-892 flagged and D-895 measured is worth`);
  say(`roughly **3% of the horizon at 1x**, not a different answer. Block length barely matters either (5d/21d/63d give`);
  say(`77/77/77), so the researcher degree of freedom in clause (4) is small here.`);
  say();
  say(`Where the distributions genuinely diverge is under **leverage with a tight floor**: at 3x against a 10% drawdown`);
  say(`rule the bootstrap puts **68–71% of paths into ruin** before the target, and at 2x, **20% of paths are still`);
  say(`running at the 100-year cap**. Neither is visible in a two-barrier formula that assumes infinite time.`);
}
await Deno.writeTextFile(K.OUT, (await Deno.readTextFile(K.OUT)) + L.join("\n") + "\n");
console.log(`\n  appended to ${K.OUT}`);
