// trade-journal.ts (D-956) — the measurement layer for the operator's OWN discretionary trades (Route B). D-955 found a
// REAL but THIN zone-fade edge whose real-world frictions (whipsaw, tail, slippage) are untestable in a model. The only
// honest settle is real fills. Log each trade; the scorer computes the HONEST running edge — hit rate vs the break-even
// implied by YOUR OWN win/loss sizes, expectancy with its t, and whether the edge is STATISTICALLY REAL yet (+ how many
// trades you still need). Claude never executes; this MEASURES what you do. Generalises the D-807 signed-prop clock.
//
//   log a trade:  LOG=1 SIDE=long ENTRY=25010 EXIT=25034 INSTRUMENT=NQ NOTE="fade pdL reclaim" deno run ... trade-journal.ts
//   score:        deno run ... trade-journal.ts     (no LOG -> prints the scorecard)
import { declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("trade-journal", [
  { name: "LOG", def: "0", note: "1 = append a trade from the fields below; 0 = print the scorecard" },
  { name: "SIDE", def: "", note: "long | short" }, { name: "ENTRY", def: "" }, { name: "EXIT", def: "" }, { name: "INSTRUMENT", def: "NQ" }, { name: "NOTE", def: "" },
  { name: "PT_VALUE", def: "20", note: "$/point (NQ 20, MNQ 2)" }, { name: "COST_PT", def: "0.5", note: "round-trip cost in points already-or-to-be applied" },
  { name: "BREAKEVEN", def: "0.507", note: "the D-955 zone-scalp theoretical break-even hit rate (for reference)" },
]);
const STORE = new URL("../data/trade-journal.json", import.meta.url);
type T = { ts: string; instrument: string; side: string; entry: number; exit: number; pts: number; note: string };
let trades: T[] = []; try { trades = JSON.parse(await Deno.readTextFile(STORE)); } catch { /* first run */ }
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
if (K.LOG === "1") {
  const side = K.SIDE.toLowerCase(); const entry = +K.ENTRY, exit = +K.EXIT;
  if (!["long", "short"].includes(side) || !isFinite(entry) || !isFinite(exit)) { console.error("!! LOG needs SIDE=long|short, ENTRY, EXIT (numbers)."); Deno.exit(1); }
  const gross = side === "long" ? exit - entry : entry - exit; const pts = gross - +K.COST_PT;   // net points after round-trip cost
  const t: T = { ts: new Date().toISOString(), instrument: K.INSTRUMENT, side, entry, exit, pts: +pts.toFixed(2), note: K.NOTE };
  trades.push(t); await Deno.writeTextFile(STORE, JSON.stringify(trades, null, 1));
  console.log(`  logged: ${side} ${K.INSTRUMENT} ${entry}->${exit} = ${pts >= 0 ? "+" : ""}${pts.toFixed(1)}pt net (${trades.length} trades on record)`);
  Deno.exit(0);
}
// SCORE
if (!trades.length) { console.log("  trade-journal empty. Log trades with LOG=1 SIDE=.. ENTRY=.. EXIT=.. — then the scorecard tells you if your edge is real."); Deno.exit(0); }
const PT = +K.PT_VALUE, be = +K.BREAKEVEN; const pts = trades.map((t) => t.pts);
const wins = pts.filter((p) => p > 0), losses = pts.filter((p) => p <= 0);
const hit = wins.length / trades.length; const avgWin = wins.length ? mean(wins) : 0, avgLoss = losses.length ? -mean(losses) : 0;
const exp = mean(pts); const tstat = pts.length > 2 ? exp / (sd(pts) / Math.sqrt(pts.length) || 1e-12) : 0;
const beReal = (avgWin + avgLoss) > 0 ? avgLoss / (avgWin + avgLoss) : 0.5;   // break-even hit rate implied by YOUR win/loss sizes
const netPts = pts.reduce((s, p) => s + p, 0);
console.log(`\n==> D-956 TRADE JOURNAL — ${trades.length} trades, ${trades[0].ts.slice(0, 10)}..${trades[trades.length - 1].ts.slice(0, 10)}`);
console.log(`  hit rate ${(100 * hit).toFixed(1)}%  |  avg win +${avgWin.toFixed(1)}pt  avg loss -${avgLoss.toFixed(1)}pt  (R ${avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "inf"})`);
console.log(`  YOUR break-even hit rate (from your win/loss sizes): ${(100 * beReal).toFixed(1)}%  ->  ${hit > beReal ? "ABOVE = profitable so far" : "BELOW = losing so far"}  (D-955 theoretical ${(100 * be).toFixed(1)}%)`);
console.log(`  expectancy ${exp >= 0 ? "+" : ""}${exp.toFixed(2)}pt/trade = $${(exp * PT).toFixed(0)}/trade  |  net ${netPts >= 0 ? "+" : ""}${netPts.toFixed(0)}pt = $${(netPts * PT).toFixed(0)}`);
console.log(`  expectancy t-stat ${tstat.toFixed(2)} ${Math.abs(tstat) < 2 ? "(NOT yet significant — |t|<2)" : tstat >= 2 ? "(significant EDGE)" : "(significant LOSS)"}`);
// how many trades to KNOW: n to detect the observed per-trade edge at |t|=2 (95%): n = (2*sd/exp)^2
const sdp = sd(pts); const nNeeded = exp !== 0 ? Math.ceil((2 * sdp / exp) ** 2) : Infinity;
console.log(`  VERDICT: ${Math.abs(tstat) >= 2 ? (exp > 0 ? "edge is statistically real at this sample — keep going, it holds." : "you are significantly LOSING — this process does not work, stop.") : `UNPROVEN — need ~${isFinite(nNeeded) ? nNeeded : "many more"} trades total (have ${trades.length}) to know at 95%. Do NOT scale size until then.`}`);
console.log(`  Honest note: this counts REAL fills only, so it already includes your slippage, whipsaw and tail losses — the frictions D-955's model could not. The number here is the truth; the backtest was the hope.`);
