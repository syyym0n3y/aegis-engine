// D-916 — why the stake dominates the edge, modelled on this record's own numbers.
// T(S, g) = ln(W/S) / g. The stake moves the log-distance ln(W/S) and is unbounded up (deposits/income). The edge moves
// g, which at optimal leverage is rf + S_excess^2/2 (the Sharpe alone) and is bounded above and enters quadratically.
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("stake-vs-edge", [
  { name: "W", def: "1000000" }, { name: "RF", def: "0.04" },
  { name: "BOOK_VOL", def: "0.034", note: "the honest book's realised vol (D-905/913)" },
  { name: "DD_UNLEV", def: "0.055", note: "the book's unlevered maxDD (D-912); leverage capped so L*DD <= 0.50 (D-897)" },
  { name: "OUT", def: "docs/STAKE_VS_EDGE.md" },
]);
const W = +K.W, RF = +K.RF, ln = Math.log;
// achievable geometric growth at a given EXCESS Sharpe, using the leverage a -50% drawdown floor permits (not Kelly,
// which is unholdable — this is the realistic cap, D-897).
const Lcap = 0.50 / +K.DD_UNLEV;                       // leverage a -50% floor allows on the book's unlevered drawdown
function gOf(Se: number): number {
  const sig = +K.BOOK_VOL, muEx = Se * sig;             // excess return at this Sharpe and the book's vol
  const Lkelly = muEx / (sig * sig);                    // = Se/sig
  const L = Math.min(Lkelly, Lcap);                     // realistic: min of Kelly and the drawdown-capped leverage
  return RF + L * muEx - (L * sig) ** 2 / 2;
}
const yrs = (S: number, Se: number) => { const g = gOf(Se); return g > 0 ? ln(W / S) / g : Infinity; };
const L: string[] = []; const say = (s = "") => { console.log(s); L.push(s); };
say(`# WHY THE STAKE DOMINATES THE EDGE (D-916)`);
say();
say(`\`T = ln(W/S) / g\`. Target W = £${W.toLocaleString("en-US")}. The book's honest leverageable excess Sharpe is ~0.45`);
say(`(D-913); leverage is capped at ${Lcap.toFixed(1)}x by a −50% drawdown floor on its ${(100*+K.BOOK_VOL).toFixed(1)}% vol (D-897), not Kelly.`);
say();
say(`## Years to £1M — stake (rows) × edge Sharpe (columns)`);
say();
const stakes = [10, 100, 1000, 10000, 50000, 200000];
const edges = [0.30, 0.45, 0.60, 0.90, 1.30, 2.50];
say(`| stake \\\\ Sharpe | ` + edges.map((e) => `${e.toFixed(2)}${e===0.45?" (ours)":e===2.50?" (Medallion)":""}`).join(" | ") + ` |`);
say(`|---|` + edges.map(() => "---").join("|") + `|`);
for (const S of stakes) say(`| £${S.toLocaleString("en-US")} | ` + edges.map((e) => { const y = yrs(S, e); return y === Infinity ? "never" : y < 1 ? "<1y" : `${y.toFixed(0)}y`; }).join(" | ") + ` |`);
say();
say(`## The two levers, priced against each other at our edge (Sharpe 0.45, from £10)`);
say();
const base = yrs(10, 0.45);
say(`- Base case, £10 at Sharpe 0.45: **${base.toFixed(0)} years.**`);
say(`- **Raise the stake 100× (£10 → £1,000):** ${yrs(1000, 0.45).toFixed(0)} years — a **${(base - yrs(1000, 0.45)).toFixed(0)}-year** cut, and the stake is a lever you *control*.`);
say(`- **Raise the stake to £50,000** (income/capital): ${yrs(50000, 0.45).toFixed(0)} years.`);
say(`- **Improve the edge +0.2 Sharpe (0.45 → 0.65)** — a 44% edge gain, near the limit of what the record could ever add: ${yrs(10, 0.65).toFixed(0)} years, a ${(base - yrs(10, 0.65)).toFixed(0)}-year cut.`);
say(`- **Double the edge (0.45 → 0.90)** — essentially impossible on this record: ${yrs(10, 0.90).toFixed(0)} years.`);
say();
// per-unit the levers are comparable near our regime; the honest reason the stake matters more is RANGE, not per-unit power.
say(`## Per unit, the levers are comparable — the stake matters more because of RANGE`);
say();
say(`At our Sharpe 0.45, a 100× stake (£10→£1,000) cuts ${(base - yrs(1000, 0.45)).toFixed(0)} years and a +0.2 Sharpe cuts ${(base - yrs(10, 0.65)).toFixed(0)} — **comparable per unit.**`);
say(`So the stake does not out-punch the edge one-for-one. It matters more for a different, decisive reason:`);
say();
say(`- **The edge is CAPPED and this record proved the ceiling.** 900+ tests found ~0.45 leverageable excess Sharpe and`);
say(`  no more; a holdable retail Sharpe tops out near 1.0–1.3 anywhere. You cannot move it by an order of magnitude.`);
say(`- **The stake is UNBOUNDED and movable by orders of magnitude.** £10 → £200,000 is 20,000×; income, savings and`);
say(`  capital formation move it freely. The table's realisable improvement down each column dwarfs the one across each row.`);
say(`- So the *achievable* gain from the stake (many multiples) vastly exceeds the *achievable* gain from the edge (maybe`);
say(`  +0.1–0.2 Sharpe, at the limit of possibility). The stake is the lever you can actually pull, and pull hard.`);
say();
say(`## The uncomfortable truth the model makes explicit`);
say();
say(`**Both levers are weak at retail scale, and the stake matters more only because the edge is weak and capped.** \`g\``);
say(`at capped leverage is ~0.31·S, so a big edge changes everything: at Medallion Sharpe 2.5 any stake reaches £1M in`);
say(`~${yrs(10, 2.5).toFixed(0)} years and the EDGE becomes the lever. At our honest 0.45, g is ~${(100*gOf(0.45)).toFixed(0)}%/yr and £1M from a coffee is ~${yrs(10, 0.45).toFixed(0)} years no`);
say(`matter how you cut it. Stake-dominance is a SYMPTOM of a ~0.45 edge, not a law — and the strategic consequence is`);
say(`that value creation must come from CAPITAL FORMATION (the stake), with the book as a survival-and-compounding vehicle,`);
say(`because the record has proven the edge cannot be the engine.`);
await Deno.writeTextFile(K.OUT, L.join("\n") + "\n");
console.log(`\n  written to ${K.OUT}`);
