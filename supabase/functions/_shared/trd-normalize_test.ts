import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromEquityCurve, fromMetaTrader, ingest, normalize } from "./trd-normalize.ts";

Deno.test("normalize: returns, win-rate, payoff, and risk-frac from a trade list", () => {
  const a = normalize("test", [{ ts: "t1", pnl: 200 }, { ts: "t2", pnl: -100 }, { ts: "t3", pnl: 200 }, { ts: "t4", pnl: -100 }], 10000);
  assertEquals(a.winRate, 0.5);
  assertEquals(a.winLossRatio, 2); // avg win 200 / avg loss 100
  assert(Math.abs(a.avgRiskFrac - 0.01) < 1e-9); // 100 / 10000
  assertEquals(a.returns.length, 4);
});

Deno.test("generic CSV auto-detect: finds the profit column by header name", () => {
  const csv = "Ticket,Symbol,CloseTime,Profit\n1,EURUSD,2026-01-02,150\n2,EURUSD,2026-01-03,-80\n3,EURUSD,2026-01-04,60";
  const a = ingest(csv, { startEquity: 5000 });
  assertEquals(a.trades.length, 3);
  assertEquals(a.trades[0].pnl, 150);
  assertEquals(a.trades[1].pnl, -80);
});

Deno.test("MetaTrader parser: keeps buy/sell trades, skips balance/deposit rows", () => {
  const mt = [
    "1,2026-01-01,balance,,,,,,10000",
    "2,2026-01-02,buy,0.10,EURUSD,,,,150",
    "3,2026-01-03,sell,0.10,EURUSD,,,,-80",
    "4,2026-01-04,deposit,,,,,,500",
  ].join("\n");
  const a = fromMetaTrader(mt, 10000);
  assertEquals(a.trades.length, 2);
  assertEquals(a.trades[0].pnl, 150);
  assertEquals(a.trades[1].pnl, -80);
});

Deno.test("equity curve → returns", () => {
  const a = fromEquityCurve([1000, 1100, 990, 1089]);
  assertEquals(a.returns.length, 3);
  assert(Math.abs(a.returns[0] - 0.1) < 1e-9);
});

Deno.test("tradesPerYear derived from timestamp span", () => {
  const a = normalize("t", [{ ts: "2026-01-01", pnl: 10 }, { ts: "2026-07-01", pnl: -5 }, { ts: "2026-12-31", pnl: 8 }], 1000);
  assert(a.spanDays > 300 && a.spanDays < 370);
  assert(a.tradesPerYear > 2 && a.tradesPerYear < 4); // ~3 trades over ~1yr
});
