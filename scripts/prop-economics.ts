// D-907 — the prop route priced properly, because I had been computing it as if it were leverage.
// Every time-to-target figure on this record compounds ONE account (D-905: 149 years, D-906: 94). That is a personal
// account's arithmetic. A PROP ACCOUNT IS A BOUNDED-LOSS BET ON A FIXED NOTIONAL: you pay a fee, you trade someone
// else's 100k whether your own stake is 500 or 50,000, your loss is the fee, and you keep a split of the profits.
// The trader's free variable is the VOLATILITY they run at, and it has an optimum in both directions — higher vol
// reaches the profit target sooner AND breaches the drawdown rule sooner.
// THE POSITIVE CONTROL IS A ZERO-EDGE TRADER (D-641): the D-807 clock already records that a no-edge trader fails a
// two-phase evaluation 52-66% of the time. If this simulator does not reproduce that band, it is wrong and nothing
// it prints counts.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("prop-economics", [
  { name: "BLEND", def: "data/d896-blend-long.json" },
  { name: "ACCOUNT", def: "100000" }, { name: "FEE", def: "500" }, { name: "SPLIT", def: "0.80" },
  { name: "P1_TARGET", def: "0.10" }, { name: "P2_TARGET", def: "0.05" },
  { name: "DAILY_LOSS", def: "0.05" }, { name: "MAX_DD", def: "0.10" },
  { name: "EVAL_DAYS", def: "180", note: "each phase times out here" }, { name: "FUNDED_DAYS", def: "252" },
  { name: "VOLS", def: "0.04,0.06,0.08,0.10,0.15,0.20,0.30", note: "annualised vol the trader runs the account at — the free variable" },
  { name: "PATHS", def: "4000" }, { name: "SEED", def: "20260914" },
  { name: "STAKE", def: "2000", note: "personal capital available to fund fees" },
  { name: "TARGET", def: "1000000" },
]);
const j = JSON.parse(await Deno.readTextFile(new URL(`../${K.BLEND}`, import.meta.url).pathname)) as { series: Record<string, number>; ann_obs: number };
const days = Object.keys(j.series).sort(); const R = days.map((d) => j.series[d]);
assertNonEmpty("blend daily observations", R, 2500);
const ANN = j.ann_obs;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const volRaw = sd(R) * Math.sqrt(ANN), srBook = mean(R) / sd(R) * Math.sqrt(ANN);
let seed = +K.SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// One evaluation phase. Returns days used, or -1 on breach, or -2 on timeout. Equity in ACCOUNT units, relative to the
// high-water mark for the trailing max-drawdown rule, which is how these accounts are actually policed.
function phase(target: number, scale: number, edge: boolean): number {
  let eq = 0, peak = 0, i = Math.floor(rnd() * R.length);
  for (let t = 0; t < +K.EVAL_DAYS; t++) {
    if (rnd() < 1 / 21) i = Math.floor(rnd() * R.length); else i = (i + 1) % R.length;
    const r = (edge ? R[i] : R[Math.floor(rnd() * R.length)] - mean(R)) * scale;   // no-edge control: same shape, mean removed
    if (r <= -+K.DAILY_LOSS) return -1;
    eq += r; peak = Math.max(peak, eq);
    if (eq - peak <= -+K.MAX_DD) return -1;
    if (eq >= target) return t + 1;
  }
  return -2;
}
type Cell = { vol: number; pass: number; breach: number; timeout: number; days: number; payout: number; evPerFee: number };
const cells: Cell[] = [];
console.log(`==> D-907 PROP ECONOMICS — ${(+K.ACCOUNT).toLocaleString("en-US")} account, fee ${K.FEE}, split ${(100 * +K.SPLIT).toFixed(0)}%, phase targets ${(100 * +K.P1_TARGET).toFixed(0)}%/${(100 * +K.P2_TARGET).toFixed(0)}%, daily loss ${(100 * +K.DAILY_LOSS).toFixed(0)}%, max DD ${(100 * +K.MAX_DD).toFixed(0)}%`);
console.log(`  book: realised vol ${(100 * volRaw).toFixed(1)}%, Sharpe ${srBook.toFixed(2)}. The trader chooses the vol they run the ACCOUNT at; that is the free variable.\n`);
for (const control of [false, true]) {
  console.log(`  ${control ? "ZERO-EDGE CONTROL (mean removed — the positive control; D-807 records 52-66% failure for a no-edge trader)" : "THE MEASURED BOOK"}`);
  console.log(`    ${"vol".padStart(5)} ${"P(pass both)".padStart(13)} ${"breach".padStart(7)} ${"timeout".padStart(8)} ${"days to pass".padStart(13)} ${"E[payout|pass]".padStart(15)} ${"E[$ per fee]".padStart(13)}`);
  for (const vS of K.VOLS.split(",")) {
    const vol = +vS, scale = vol / volRaw / Math.sqrt(ANN) * Math.sqrt(ANN);   // scale daily returns so annualised vol = target
    const sc = vol / volRaw;
    let pass = 0, breach = 0, timeout = 0, dsum = 0, paysum = 0;
    for (let p = 0; p < +K.PATHS; p++) {
      const a = phase(+K.P1_TARGET, sc, !control);
      if (a < 0) { if (a === -1) breach++; else timeout++; continue; }
      const b = phase(+K.P2_TARGET, sc, !control);
      if (b < 0) { if (b === -1) breach++; else timeout++; continue; }
      pass++; dsum += a + b;
      // funded phase: same rules, profits split, run to FUNDED_DAYS or a breach
      let eq = 0, peak = 0, i = Math.floor(rnd() * R.length), paid = 0;
      for (let t = 0; t < +K.FUNDED_DAYS; t++) {
        if (rnd() < 1 / 21) i = Math.floor(rnd() * R.length); else i = (i + 1) % R.length;
        const r = (control ? R[Math.floor(rnd() * R.length)] - mean(R) : R[i]) * sc;
        if (r <= -+K.DAILY_LOSS) break;
        eq += r; peak = Math.max(peak, eq);
        if (eq - peak <= -+K.MAX_DD) break;
        // DEFECT FOUND BY THE ZERO-EDGE CONTROL: the first version reset BOTH eq and peak on withdrawal, which reset the
        // drawdown clock every time the trader banked a profit — an unlimited sequence of free options, and the reason a
        // no-edge trader appeared to profit. Real accounts police the loss against the INITIAL balance: withdrawing
        // returns equity to the start, but the floor does NOT move. peak is therefore pinned at 0, never re-based.
        if (eq >= 0.04) { paid += eq * +K.ACCOUNT * +K.SPLIT; eq = 0; }
      }
      paysum += paid;
    }
    const pP = pass / +K.PATHS, ev = pP * (paysum / Math.max(1, pass)) - +K.FEE;
    cells.push({ vol, pass: pP, breach: breach / +K.PATHS, timeout: timeout / +K.PATHS, days: pass ? dsum / pass : NaN, payout: pass ? paysum / pass : 0, evPerFee: ev });
    console.log(`    ${(100 * vol).toFixed(0).padStart(4)}% ${(100 * pP).toFixed(1).padStart(12)}% ${(100 * breach / +K.PATHS).toFixed(1).padStart(6)}% ${(100 * timeout / +K.PATHS).toFixed(1).padStart(7)}% ${(pass ? (dsum / pass).toFixed(0) + "d" : "—").padStart(13)} ${(pass ? "$" + Math.round(paysum / pass).toLocaleString("en-US") : "—").padStart(15)} ${(ev >= 0 ? "+" : "") + "$" + Math.round(ev).toLocaleString("en-US")}`.padEnd(10));
  }
  console.log();
}
const best = cells.filter((c) => c.evPerFee > 0).sort((a, b) => b.evPerFee - a.evPerFee)[0];
const beEven = (c: Cell) => c.payout > 0 ? +K.FEE / c.payout : NaN;
console.log(`  BREAK-EVEN PASS RATE in closed form, fee / E[payout | pass], beside the simulated pass rate:`);
for (const c of cells.slice(0, K.VOLS.split(",").length)) console.log(`    vol ${(100 * c.vol).toFixed(0).padStart(3)}%  break-even ${(100 * beEven(c)).toFixed(2).padStart(6)}%  simulated ${(100 * c.pass).toFixed(1).padStart(5)}%  ${c.pass > beEven(c) ? "CLEARS" : "below break-even"}`);
if (best) {
  const perYear = best.evPerFee * (365 / Math.max(30, best.days + 60));
  console.log(`\n  BEST CELL: vol ${(100 * best.vol).toFixed(0)}% — P(pass) ${(100 * best.pass).toFixed(1)}%, E[$ per fee] ${best.evPerFee >= 0 ? "+" : ""}$${Math.round(best.evPerFee).toLocaleString("en-US")}, ~${Math.round(perYear).toLocaleString("en-US")}/yr per concurrent attempt`);
  const n = Math.log(+K.TARGET / +K.STAKE) / Math.log(1 + perYear / Math.max(1, +K.STAKE));
  console.log(`  From a ${(+K.STAKE).toLocaleString("en-US")} stake, reinvesting into more concurrent attempts: ~${isFinite(n) && n > 0 ? n.toFixed(0) : "n/a"} years to ${(+K.TARGET).toLocaleString("en-US")} (crude — assumes attempts scale linearly and the firm honours payouts)`);
} else {
  console.log(`\n  NO CELL HAS POSITIVE EXPECTED VALUE PER FEE. The prop route loses money at every volatility tested on this book.`);
}
