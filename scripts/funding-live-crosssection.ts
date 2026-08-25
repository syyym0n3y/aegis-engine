#!/usr/bin/env -S deno run --allow-net --allow-env
// funding-live-crosssection.ts (D-603) — is there a LIVE, delta-neutral funding carry today?
//
// The three dormant watches (D-431 basis, D-433 funding, D-435 VRP) all concluded "real, capacity-rich, forecast-free
// — and competed away". All three measured BTC. We hold funding for 512 symbols and 2,291,622 records through
// 2026-08-24, and the cross-section was never examined for a LIVE level.
//
// Why this fits the operator's thesis better than anything else tested today: harvesting funding is DELTA NEUTRAL
// (long spot, short perp). It needs no directional edge, no forecast, and it is many small collections across many
// instruments — which is the shape they described, unlike every directional rule that has died this session.
//
// PRE-REGISTERED as D-603-funding-crosssec-live. The competing explanation is stated up front and is the likely one:
// funding is high exactly where the other leg is expensive or impossible to hold, so the premium may vanish the
// moment you restrict to pairs where BOTH legs are placeable. THE INSTRUMENT LAW decides this, not a t-stat.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("funding-live-crosssection", [
  { name: "LOOKBACK_D", def: "90", note: "trailing days" },
  { name: "HURDLE_PCT", def: "5", note: "net %/yr bar, same as D-431" },
  { name: "TAKER_BP", def: "9", note: "round trip per leg" },
  { name: "REBAL_BP_YR", def: "10", note: "annual rebalancing drag" },
  { name: "MIN_POS_FRAC", def: "0.70", note: "share of days funding must be positive" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "fl", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

// Which symbols have a SPOT leg? D-603 FIRST VERSION USED OUR OWN INGEST AND THAT WAS WRONG: we hold 33 spot
// symbols, all 2017-19 era listings, while Binance lists 484 TRADING USDT spot pairs. Defining "placeable" as
// "what a past ingest happened to fetch" is a COVERAGE failure — it is the research programme's own data gap
// narrated as a market property. The exchange's live listing is the authority, so ask it.
const ex = await fetch("https://api.binance.com/api/v3/exchangeInfo", { headers: { "User-Agent": "Mozilla/5.0" } })
  .then((r) => r.json()).catch(() => null);
const spot = new Set<string>();
for (const s of ex?.symbols ?? []) if (s.status === "TRADING" && s.quoteAsset === "USDT") spot.add(s.symbol);
if (spot.size < 100) { console.error(`!! only ${spot.size} spot pairs resolved from exchangeInfo — refusing to judge placeability on that. RED.`); Deno.exit(1); }
assertNonEmpty("spot symbols from exchangeInfo", [...spot], 100);

// Funding history. trd_perp_oi stores the rate in open_interest for interval='funding' (per 8h).
const LOOK = Number(K.LOOKBACK_D);
const cutoff = Math.floor(Date.now() / 1000) - LOOK * 86400;
const fund = new Map<string, { ts: number; r: number }[]>();
for (let off = 0;; off += 50000) {
  const rows = await fetch(`${OWNED}/trd_perp_oi?venue=eq.binance&interval=eq.funding&ts=gte.${cutoff}&select=symbol,ts,open_interest&order=symbol,ts&offset=${off}&limit=50000`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; ts: number; open_interest: number }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) (fund.get(r.symbol) ?? fund.set(r.symbol, []).get(r.symbol)!).push({ ts: +r.ts, r: +r.open_interest });
  if (rows.length < 50000) break;
}
assertNonEmpty("symbols with funding in the window", [...fund.keys()]);

const TAKER = Number(K.TAKER_BP), REBAL = Number(K.REBAL_BP_YR), HURDLE = Number(K.HURDLE_PCT), MINPOS = Number(K.MIN_POS_FRAC);
// Entering AND exiting a two-leg neutral position: one round trip per leg.
const setupCost = 2 * TAKER / 1e4;
const annualDrag = REBAL / 1e4;

interface Row { sym: string; hasSpot: boolean; grossPct: number; netPct: number; posFrac: number; n: number }
const out: Row[] = [];
for (const [sym, arr] of fund) {
  if (arr.length < LOOK) continue;                       // ~3 prints/day; require at least LOOK prints
  const rates = arr.map((x) => x.r);
  const meanR = rates.reduce((a, b) => a + b, 0) / rates.length;
  const grossPct = meanR * 3 * 365 * 100;                // 3 funding periods per day
  const posFrac = rates.filter((x) => x > 0).length / rates.length;
  // Held for a year: pay setup once, plus the rebalancing drag.
  const netPct = grossPct - (setupCost + annualDrag) * 100;
  out.push({ sym, hasSpot: spot.has(sym), grossPct, netPct, posFrac, n: rates.length });
}
assertNonEmpty("symbols evaluated", out);
out.sort((a, b) => b.netPct - a.netPct);

console.log(`\n==> LIVE FUNDING CROSS-SECTION — trailing ${LOOK}d, ${out.length} symbols, ${spot.size} of which have a spot leg`);
console.log(`    hurdle ${HURDLE}%/yr net; costs ${TAKER}bp round trip per leg + ${REBAL}bp/yr drag; funding must be positive on >= ${(MINPOS * 100).toFixed(0)}% of prints\n`);
console.log(`    ${"symbol".padEnd(16)}${"spot?".padEnd(8)}${"gross%/yr".padEnd(12)}${"net%/yr".padEnd(11)}${"pos frac".padEnd(11)}prints`);
for (const r of out.slice(0, 12)) {
  console.log(`    ${r.sym.padEnd(16)}${(r.hasSpot ? "YES" : "no").padEnd(8)}${r.grossPct.toFixed(2).padEnd(12)}${r.netPct.toFixed(2).padEnd(11)}${r.posFrac.toFixed(2).padEnd(11)}${r.n}`);
}

const placeable = out.filter((r) => r.hasSpot);
const qualify = placeable.filter((r) => r.netPct >= HURDLE && r.posFrac >= MINPOS);
const wouldQualifyNoSpot = out.filter((r) => !r.hasSpot && r.netPct >= HURDLE && r.posFrac >= MINPOS);

console.log(`\n    PLACEABLE (has spot leg): ${placeable.length} symbols. Best net ${placeable.length ? placeable[0].netPct.toFixed(2) : "n/a"}%/yr (${placeable.length ? placeable[0].sym : "-"}).`);
console.log(`    QUALIFYING on the placeable set: ${qualify.length}`);
for (const r of qualify) console.log(`      ${r.sym}: net ${r.netPct.toFixed(2)}%/yr, positive on ${(r.posFrac * 100).toFixed(0)}% of prints`);
console.log(`    Would qualify but have NO SPOT LEG: ${wouldQualifyNoSpot.length}${wouldQualifyNoSpot.length ? " — " + wouldQualifyNoSpot.slice(0, 6).map((r) => `${r.sym} ${r.netPct.toFixed(1)}%`).join(", ") : ""}`);
console.log(`\n    ${qualify.length >= 3 ? "QUALIFIES — a live, forecast-free, delta-neutral carry exists on a placeable set." :
  qualify.length > 0 ? `TOO THIN: ${qualify.length} symbol(s) clear, under the pre-registered floor of 3. Recorded as UNTESTED breadth, not an edge.` :
  "DOES NOT QUALIFY — nothing on the placeable set clears the hurdle."}`);
if (wouldQualifyNoSpot.length > qualify.length) {
  console.log(`    NOTE: more symbols clear WITHOUT a spot leg (${wouldQualifyNoSpot.length}) than with one (${qualify.length}) —`);
  console.log(`    which is the pre-registered competing explanation: the premium sits where the position cannot be held.`);
}
