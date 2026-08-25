#!/usr/bin/env -S deno run --allow-net --allow-env
// grammar-passive-fill.ts (D-592) — THE EXECUTION LAW applied to the one escape route left open by D-591.
//
// D-591 measured a real, drift-adjusted timing component in the grammar's `swing` geometry (~0.10R on BOTH sides,
// 77.6% OOS persistence gross) and killed it on cost: median stop 0.54% of price => 0.167R taker round trip => the
// effect is 0.60x its own fee. The obvious rescue is to stop paying the taker fee. At Binance maker (~2bp) the cost
// falls to 0.037R and the same effect becomes 2.7x — it CLEARS.
//
// That rescue is exactly what the EXECUTION LAW forbids asserting. D-445/447: a 2-hour perp window ranked #1 of 22,
// t 10.92, 14/14 symbols agreeing, failed at taker and cleared at maker — and measured on 5m bars the maker
// assumption was FALSE. The passive order filled 92% of the time, those days returned -1.85bp, and the entire
// +68bp lived in the 8% that never filled. You are filled when the market comes back to you, which is when the move
// is not happening.
//
// THIS TESTS THE SAME THING HERE. The grammar signals on a closed bar and enters at the NEXT bar's open (taker).
// The passive version rests a limit at the signal bar's CLOSE and is filled only if the next bar trades through it:
//   long  filled if next.low  <= limit      short filled if next.high >= limit
// Then we measure, separately: the FILL RATE, the forward return ON FILLED signals, and the forward return on
// signals that were NOT filled. If the D-447 pattern repeats, the unfilled set carries the move and the maker
// rescue is dead.
//
// PRE-REGISTERED before running:
//   - filled-signal forward return >= unfilled, and >= the taker-entry return  -> maker rescue is LIVE, re-test at 2bp
//   - filled-signal return materially BELOW unfilled                           -> D-447 pattern repeats; rescue DEAD
//   - fill rate near 100%                                                      -> the limit is not really passive;
//                                                                                 the test says nothing, report that
import { type Bar } from "../supabase/functions/_shared/trd-grammar.ts";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gpf", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const NSYM = Number(Deno.env.get("NSYM") || 6);
const HOLD = Number(Deno.env.get("HOLDBARS") || 6);   // forward horizon in bars, comparable to a short swing trade
// D-592 FIRST ATTEMPT WAS INVALID, recorded rather than discarded: resting the limit AT the signal bar's close gave a
// 99.7% fill rate, because an hourly bar nearly always trades back through the prior close. That is a market order
// wearing a limit order's name, and it hit the pre-registered "fill rate near 100% => the test says nothing" branch.
// A genuinely passive order rests at a BETTER price than the market: below the close to buy, above it to sell. EDGE
// is that improvement in basis points; the fill rate then falls and the fill-conditional question becomes real.
const EDGE_BP = Number(Deno.env.get("EDGE_BP") || 25);

const meta = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1hSF&select=symbol,n_bars&order=n_bars.desc&limit=${NSYM}`, { headers: hdr })
  .then((r) => r.json()).catch(() => []) as { symbol: string; n_bars: number }[];
if (!Array.isArray(meta) || !meta.length) { console.error("!! no bars. RED."); Deno.exit(1); }

// The `sweep` trigger, which is the swing geometry's most-populated signal in D-588's output: a wick beyond the
// recent range that closes back inside. Reimplemented here standalone so this test does not depend on, or perturb,
// the shared grammar runner.
function sweepSignals(bars: Bar[], look = 20): { i: number; side: "long" | "short" }[] {
  const out: { i: number; side: "long" | "short" }[] = [];
  for (let i = look + 1; i < bars.length - HOLD - 2; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - look; j < i; j++) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
    const b = bars[i];
    if (b.low < lo && b.close > lo) out.push({ i, side: "long" });        // swept the lows, closed back above
    else if (b.high > hi && b.close < hi) out.push({ i, side: "short" }); // swept the highs, closed back below
  }
  return out;
}

let fillN = 0, noFillN = 0, takerN = 0;
let fillSum = 0, noFillSum = 0, takerSum = 0;
const fillRs: number[] = [], noFillRs: number[] = [], achRs: number[] = [];
let achN = 0, achSum = 0;

for (const m of meta) {
  const rows = await fetch(`${OWNED}/trd_bars_intraday?tf=eq.1hSF&symbol=eq.${m.symbol}&select=bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { bars: number[][] }[];
  const raw = rows?.[0]?.bars; if (!raw?.length) continue;
  const bars: Bar[] = [];
  for (const b of raw) { const [ts, o, h, l, c] = b; if ([o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) bars.push({ ts: new Date(ts * 1000).toISOString(), open: o, high: h, low: l, close: c }); }
  if (bars.length < 2000) continue;

  for (const s of sweepSignals(bars)) {
    const dir = s.side === "long" ? 1 : -1;
    const limit = bars[s.i].close * (1 - dir * EDGE_BP / 1e4);   // rest BETTER than the market by EDGE_BP
    const next = bars[s.i + 1];
    const exit = bars[s.i + 1 + HOLD].close;
    // TAKER: cross the spread at next open, always fills
    takerN++; takerSum += dir * (exit / next.open - 1);
    // PASSIVE: filled only if the next bar trades through our resting price
    const filled = s.side === "long" ? next.low <= limit : next.high >= limit;
    const r = dir * (exit / limit - 1);
    if (filled) { fillN++; fillSum += r; fillRs.push(r); } else { noFillN++; noFillSum += r; noFillRs.push(r); }
    // D-593 ACHIEVABLE VARIANT: non-retracement is observable by this bar's CLOSE, so acting on it is implementable
    // — unlike the counterfactual above, which is measured from a limit price that was never transacted. Entering at
    // the close means first paying the runaway that caused the miss.
    if (!filled) { const ra = dir * (exit / next.close - 1); achN++; achSum += ra; achRs.push(ra); }
  }
}

const bp = (x: number) => (x * 1e4).toFixed(2) + "bp";
const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return m / (sd(a) / Math.sqrt(a.length)); };

console.log(`==> PASSIVE FILL TEST — sweep trigger, ${meta.length} symbols, ${HOLD}-bar forward hold, limit ${EDGE_BP}bp better than close`);
console.log(`    signals ${takerN.toLocaleString()}   fill rate ${(100 * fillN / Math.max(1, takerN)).toFixed(1)}%`);
console.log(`    TAKER  (enter next open, always fills) : ${bp(takerSum / Math.max(1, takerN))}  n=${takerN.toLocaleString()}`);
console.log(`    PASSIVE, FILLED                        : ${bp(fillSum / Math.max(1, fillN))}  n=${fillN.toLocaleString()}  t=${fillRs.length > 30 ? tstat(fillRs).toFixed(2) : "n/a"}`);
console.log(`    PASSIVE, NOT FILLED (counterfactual)   : ${bp(noFillSum / Math.max(1, noFillN))}  n=${noFillN.toLocaleString()}  t=${noFillRs.length > 30 ? tstat(noFillRs).toFixed(2) : "n/a"}`);
console.log(`    ACHIEVABLE (not filled -> enter at that bar's CLOSE): ${bp(achSum / Math.max(1, achN))}  n=${achN.toLocaleString()}  t=${achRs.length > 30 ? tstat(achRs).toFixed(2) : "n/a"}  [vs 9bp taker cost]`);
console.log(`\n    The D-447 signature is FILLED << NOT-FILLED: you are filled when the market comes back to you,`);
console.log(`    which is exactly when the move is not happening. If that holds here, the maker rescue is dead.`);
