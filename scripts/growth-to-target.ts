// D-892 — "turn a coffee into a million", computed instead of asserted.
// docs/TENFOLD.md gives a deterministic years-to-10x grid with no ruin barrier, no leverage optimum and no probability.
// This is the stochastic version of the same question, using only Sharpe ratios already measured on this record.
// Model: log-wealth under leverage L is Brownian with drift nu = rf + L*S*sig - L^2*sig^2/2 and vol s = L*sig.
// P(target before ruin) is the two-barrier scale function; median time is the inverse-Gaussian first-passage median.
// The inversion at the end is the part that matters: at the growth-optimal leverage the volatility CANCELS and the
// achievable growth rate is rf + S^2/2 — a function of the SHARPE ALONE. If that holds, leverage is not the lever.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("growth-to-target", [
  { name: "START", def: "10", note: "starting capital, the coffee" },
  { name: "TARGET", def: "1000000" },
  { name: "RF", def: "0.04", note: "risk-free, the same 4% docs/TENFOLD.md uses" },
  { name: "RUIN", def: "0.5", note: "fraction of starting capital at which the attempt is over; 0.5 = a 50% drawdown stops you" },
  { name: "OUT", def: "docs/GROWTH_TO_TARGET.md" },
]);
const RF = +K.RF, M = Math.log(+K.TARGET / +K.START), A = -Math.log(+K.RUIN);
// Every Sharpe here is cited to its ledger row and is net, OOS or modern-era (the registered kill condition).
const BOOKS = [
  { id: "D-873b/875", name: "the pair: timed ISA basket x survivor-free crypto timed", S: 1.29, vol: 0.10 },
  { id: "D-872", name: "timed ISA, class parity, VIX overlay", S: 0.83, vol: 0.10 },
  { id: "D-870", name: "timed ISA, class risk parity", S: 0.76, vol: 0.10 },
  { id: "D-871", name: "spot crypto timed, long-only", S: 0.69, vol: 0.20 },
  { id: "D-863", name: "diversified TSMOM, 110 assets, OOS", S: 0.62, vol: 0.10 },
  { id: "D-527/558", name: "combined factor book, modern era", S: 0.40, vol: 0.10 },
];
// Leverage routes, at levels where the cost was MEASURED. Extrapolating D-880 past 3x is forbidden by the registration.
const ROUTES = [
  { id: "ISA/cash", L: 1, note: "1x by construction; no financing", sharpeAt: (s: number) => s },
  { id: "D-880 perp 1x", L: 1, note: "funding measured; Sharpe 0.54 -> 0.40", sharpeAt: (s: number) => s * 0.40 / 0.54 },
  { id: "D-880 perp 2x", L: 2, note: "funding measured; Sharpe 0.54 -> 0.22", sharpeAt: (s: number) => s * 0.22 / 0.54 },
  { id: "D-880 perp 3x", L: 3, note: "funding measured; Sharpe 0.54 -> 0.16", sharpeAt: (s: number) => s * 0.16 / 0.54 },
];
// two-barrier first passage: P(reach +M before -A) for BM(nu, s). lam = 2 nu / s^2; the nu->0 limit is A/(A+M).
function pHit(nu: number, s: number): number {
  if (s <= 0) return nu > 0 ? 1 : 0;
  const lam = 2 * nu / (s * s);
  if (Math.abs(lam) < 1e-12) return A / (A + M);
  const num = 1 - Math.exp(lam * A), den = Math.exp(-lam * M) - Math.exp(lam * A);
  return Math.max(0, Math.min(1, num / den));
}
// median first-passage time to +M for BM(nu>0, s): inverse Gaussian IG(mu=M/nu, lambda=M^2/s^2); median by bisection on its CDF.
const Phi = (x: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989422804014327 * Math.exp(-x * x / 2); const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p; };
function medianTime(nu: number, s: number): number {
  if (nu <= 0) return Infinity;
  const cdf = (t: number) => { if (t <= 0) return 0; const r = s * Math.sqrt(t); return Phi((nu * t - M) / r) + Math.exp(2 * nu * M / (s * s)) * Phi(-(nu * t + M) / r); };
  let lo = 1e-6, hi = 1e5; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < 0.5) lo = mid; else hi = mid; }
  return hi > 9e4 ? Infinity : hi;
}
const g = (L: number, S: number, sig: number) => RF + L * S * sig - L * L * sig * sig / 2;
const L: string[] = [];
const say = (s = "") => { console.log(s); L.push(s); };
say(`# GROWTH TO TARGET — $${K.START} to $${(+K.TARGET).toLocaleString("en-US")}, computed (D-892)`);
say();
say(`> The question is "turn a coffee into a million". It is a two-barrier first-passage problem and every input below is`);
say(`> a Sharpe already measured on this record. Target ${(+K.TARGET / +K.START).toLocaleString("en-US")}x = ${M.toFixed(2)} nats.`);
say(`> The attempt is declared over at a ${(100 * (1 - +K.RUIN)).toFixed(0)}% drawdown. Risk-free ${(100 * RF).toFixed(0)}%.`);
say();
say(`## 1. At the leverage that is actually purchasable`);
say();
say(`| book | ledger | route | net Sharpe | leverage | growth/yr | P(reach target) | median time |`);
say(`|---|---|---|---|---|---|---|---|`);
for (const b of BOOKS) for (const r of ROUTES) {
  if (r.id !== "ISA/cash" && b.id !== "D-871" && b.id !== "D-873b/875") continue;   // perp routes apply to the crypto-bearing books only
  const S = r.sharpeAt(b.S), nu = g(r.L, S, b.vol) - RF + RF, s = r.L * b.vol;
  const p = pHit(nu, s), mt = medianTime(nu, s);
  say(`| ${b.name} | ${b.id} | ${r.id} | ${S.toFixed(2)} | ${r.L}x | ${(100 * nu).toFixed(1)}% | ${(100 * p).toFixed(2)}% | ${mt === Infinity ? "never" : mt.toFixed(0) + "y"} |`);
}
say();
say(`## 2. At the growth-optimal leverage — the leverage nobody can buy`);
say();
say(`Full Kelly is \`L* = S/sigma\`, and substituting it into the growth rate makes the volatility **cancel**:`);
say(`\`g(L*) = rf + S^2/2\`. The achievable growth rate is therefore a function of the **Sharpe ratio alone**.`);
say();
say(`| book | Sharpe | Kelly leverage | g at full Kelly | median time | g at half Kelly | median time |`);
say(`|---|---|---|---|---|---|---|`);
for (const b of BOOKS) {
  const Lk = b.S / b.vol, nk = g(Lk, b.S, b.vol), sk = Lk * b.vol;
  const Lh = Lk / 2, nh = g(Lh, b.S, b.vol), sh = Lh * b.vol;
  say(`| ${b.name} | ${b.S.toFixed(2)} | ${Lk.toFixed(1)}x | ${(100 * nk).toFixed(0)}% | ${medianTime(nk, sk).toFixed(1)}y | ${(100 * nh).toFixed(0)}% | ${medianTime(nh, sh).toFixed(1)}y |`);
}
say();
say(`## 3. Inverted: the Sharpe required to do it in N years`);
say();
say(`Since \`g(L*) = rf + S^2/2\`, the Sharpe needed to reach the target in median time T is \`S = sqrt(2*(M/T - rf))\`.`);
say(`This is the floor at **unlimited free leverage**. Any real leverage cap makes it strictly worse.`);
say();
say(`| target in | growth/yr needed | Sharpe needed (free leverage) | Kelly leverage that implies at 10% vol | on this record? |`);
say(`|---|---|---|---|---|`);
for (const T of [1, 3, 5, 10, 20, 40]) {
  const need = M / T, S = Math.sqrt(Math.max(0, 2 * (need - RF)));
  say(`| ${T} year${T > 1 ? "s" : ""} | ${(100 * need).toFixed(0)}% | **${S.toFixed(2)}** | ${(S / 0.10).toFixed(0)}x | ${S <= 1.29 ? "**yes — 1.29 measured**" : "no — best measured is 1.29"} |`);
}
say();
say(`## 4. The operator's own targets, inverted`);
say();
say(`Stated targets become required Sharpes by the same identity. These are floors at unlimited free leverage.`);
say();
say(`| stated target | growth/yr it implies | Sharpe required | for scale |`);
say(`|---|---|---|---|`);
for (const [label, gr] of [["100% profit every week", 52 * Math.log(2)], ["100% every month", 12 * Math.log(2)], ["10x in a year", Math.log(10)], ["doubling once a year", Math.log(2)]] as [string, number][]) {
  const S = Math.sqrt(Math.max(0, 2 * (gr - RF)));
  const cmp = S > 10 ? "no fund in history" : S > 4 ? "beyond the best documented funds (Medallion ~2.5 net)" : S > 2 ? "above any book on this record" : S <= 1.29 ? "**inside what this record has measured**" : "above this record's 1.29";
  say(`| ${label} | ${(100 * gr).toFixed(0)}% | **${S.toFixed(2)}** | ${cmp} |`);
}
say();
say(`## 5. What this model assumes, stated so it is visible rather than buried`);
say();
say(`The 70-year and 100-year figures in section 1 assume **the measured edge persists for 70 years**. It will not, and`);
say(`nothing on this record supports that: the Sharpes above are measured over roughly 6 years, several are era-dependent`);
say(`(D-873b's pair drops from 1.40 to 0.90 excluding 2020-21), and this programme has retracted results for era`);
say(`sensitivity before. Read the long horizons as **a statement that the target is out of reach at 1x**, not as a`);
say(`forecast of the year it arrives. The short horizons in section 2 are the more meaningful ones because they assume`);
say(`less persistence — and they are the ones that need leverage nobody sells.`);
say();
say(`The P(reach target) column is high at 1x for the same reason it is uninformative there: with 10% volatility against`);
say(`a 16% drift, the ${(100 * (1 - +K.RUIN)).toFixed(0)}% floor is simply far away. The column earns its keep in the levered rows, where it falls to`);
say(`3% — and that fall is the whole point: **the leverage that shortens the median also makes the attempt fail outright.**`);
say();
say(`Sensitivity to where the floor is put, on the best book taken to the highest MEASURED leverage (the pair at 3x perp):`);
say();
say(`| the attempt is over at | P(reach target) |`);
say(`|---|---|`);
for (const rf2 of [0.9, 0.7, 0.5, 0.1]) {
  const savedA = -Math.log(rf2);
  const b2 = BOOKS[0], S2 = b2.S * 0.16 / 0.54, nu2 = g(3, S2, b2.vol), s2 = 3 * b2.vol;   // D-880 measured the 3x degradation
  const lam = 2 * nu2 / (s2 * s2);
  const p2 = Math.abs(lam) < 1e-12 ? savedA / (savedA + M) : Math.max(0, Math.min(1, (1 - Math.exp(lam * savedA)) / (Math.exp(-lam * M) - Math.exp(lam * savedA))));
  say(`| a ${(100 * (1 - rf2)).toFixed(0)}% drawdown${rf2 === 0.9 ? " — a typical prop-firm rule" : ""} | ${(100 * p2).toFixed(1)}% |`);
}
say();
say(`A prop account's ~10% drawdown rule is not a detail — on the SAME strategy it moves the chance of ever getting there`);
say(`from 82% to 23%. That is the cost of the drawdown rule, and D-807's clock carries the live version of it.`);
say();
const best = BOOKS[0], LkB = best.S / best.vol, nkB = g(LkB, best.S, best.vol);
say(`## 6. What binds`);
say();
say(`At the best Sharpe on this record (**${best.S}**, ${best.id}) the growth-optimal leverage is **${LkB.toFixed(1)}x** and the`);
say(`resulting growth rate is **${(100 * nkB).toFixed(0)}%/yr**, giving a median **${medianTime(nkB, LkB * best.vol).toFixed(1)} years** to the target.`);
say(`Every leverage route measured on this record caps out at **3x**, and at 3x the perp route does not deliver 3x the`);
say(`Sharpe — it delivers **0.16/0.54 = 30%** of it (D-880), because funding scales with notional while edge does not.`);
say();
say(`So the binding constraint is **not** access to leverage, and chasing leverage is chasing the wrong variable: past`);
say(`Kelly, more leverage **lowers** the growth rate and raises the chance of hitting the floor first. The binding`);
say(`constraint is the **Sharpe ratio**, and the gap between ${best.S} and the ~${Math.sqrt(2 * (M / 10 - RF)).toFixed(2)} needed for a ten-year run is the mission,`);
say(`stated as one number.`);
await Deno.writeTextFile(K.OUT, L.join("\n") + "\n");
console.log(`\n  written to ${K.OUT}`);
