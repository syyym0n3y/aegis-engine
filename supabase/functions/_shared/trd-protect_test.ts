import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { riskXray } from "./trd-protect.ts";

Deno.test("PROTECT: negative expectancy => RUIN-LIKELY, no size saves it", () => {
  const r = riskXray({ equity: 10000, riskPerTradeFrac: 0.02, winRate: 0.4, winLossRatio: 1.0 });
  assert(r.expectancyR < 0);
  assertEquals(r.verdict, "RUIN-LIKELY");
  assert(/NEGATIVE/i.test(r.plainEnglish));
});

Deno.test("PROTECT: real edge but overbet => high ruin probability + overbet flag", () => {
  // edge: p=0.5, b=2 => expectancy +0.5R, half-Kelly = 0.125; risking 40% is a huge overbet
  const r = riskXray({ equity: 10000, riskPerTradeFrac: 0.40, winRate: 0.5, winLossRatio: 2 });
  assert(r.expectancyR > 0);
  assert(r.overbetRatio > 1.5, `should be overbetting, got ${r.overbetRatio}`);
  assert(r.probRuin > 0.2, `overbetting should make ruin likely, got ${r.probRuin}`);
});

Deno.test("PROTECT: same edge sized at half-Kelly is survivable with far lower ruin", () => {
  const hot = riskXray({ equity: 10000, riskPerTradeFrac: 0.40, winRate: 0.5, winLossRatio: 2 });
  const sane = riskXray({ equity: 10000, riskPerTradeFrac: 0.06, winRate: 0.5, winLossRatio: 2 });
  assert(sane.probRuin < hot.probRuin, "smaller size => less ruin");
  assertEquals(sane.verdict, "SURVIVABLE");
});

Deno.test("PROTECT: Kelly fraction is correct for p=0.6,b=1 (edge 0.2)", () => {
  const r = riskXray({ equity: 1, riskPerTradeFrac: 0.01, winRate: 0.6, winLossRatio: 1 });
  // kelly = (p*b-(1-p))/b = (0.6-0.4)/1 = 0.2
  assert(Math.abs(r.kellyFraction - 0.2) < 1e-9);
});

Deno.test("PROTECT: leverage liquidation distance = 100/leverage", () => {
  const r = riskXray({ equity: 1, riskPerTradeFrac: 0.01, winRate: 0.55, winLossRatio: 1.5, leverage: 20 });
  assertEquals(r.liquidationMovePct, 5); // 20x => 5% adverse move wipes out
});
