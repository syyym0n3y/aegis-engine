import { parseTwelveData, twelveDataError } from "./trd-twelvedata.ts";
import { assert, assertEquals } from "./trd-test-helpers.ts";

Deno.test("parseTwelveData: documented shape (string values, newest-first) → ascending PriceBars", () => {
  const j = JSON.stringify({
    meta: { symbol: "SRCE", interval: "1day" },
    values: [
      { datetime: "2026-06-05", open: "50.0", high: "51", low: "49", close: "50.5", volume: "1000" },
      { datetime: "2026-06-04", open: "49", high: "50", low: "48.5", close: "49.5", volume: "900" },
    ],
    status: "ok",
  });
  const bars = parseTwelveData(j);
  assertEquals(bars.length, 2);
  assertEquals(bars[0].ts, "2026-06-04T00:00:00Z"); // sorted ascending
  assertEquals(bars[1].close, 50.5);
  assertEquals(bars[0].volume, 900);
});

Deno.test("parseTwelveData: error payload → [] + surfaced message (rate limit / bad key)", () => {
  const e = JSON.stringify({ code: 429, message: "You have run out of API credits", status: "error" });
  assertEquals(parseTwelveData(e).length, 0);
  assert((twelveDataError(e) ?? "").includes("API credits"));
  assertEquals(twelveDataError(JSON.stringify({ status: "ok", values: [] })), null);
});
