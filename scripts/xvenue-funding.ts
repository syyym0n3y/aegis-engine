#!/usr/bin/env -S deno run --allow-net --allow-env
// xvenue-funding.ts (D-604) — cross-venue funding differential: the one neutral trade that needs no spot leg.
//
// D-603 died because the delta-neutral funding harvest requires holding spot, and the premium sits overwhelmingly on
// perps with NO spot market (11 of the top 12, verified against exchangeInfo). This construction sidesteps that
// entirely: long the perp where funding is negative, short the SAME perp where funding is positive, on two different
// venues. Delta-neutral by construction, no borrow, no spot.
//
// PRE-REGISTERED as D-604-xvenue-funding, and the out-of-sample clause is written IN ADVANCE this time because
// D-603 passed as a snapshot and died to exactly that test. Selecting on trailing funding and then reporting
// trailing funding is circular; only the forward number counts.
//
// Venue symbol conventions differ (Binance "BTCUSDT" vs Bybit/OKX "BTC"), so they are normalised to a base asset.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("xvenue-funding", [
  { name: "HURDLE_PCT", def: "5" },
  { name: "TAKER_BP", def: "9", note: "round trip per leg" },
  { name: "REBAL_BP_YR", def: "10" },
  { name: "MIN_OVERLAP", def: "300", note: "min shared funding prints per pair" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "xv", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

// Normalise to a base asset. Binance uses BTCUSDT; Bybit/OKX/Deribit use BTC in this store.
const base = (s: string) => s.replace(/USDT$|USD$|-PERPETUAL$/i, "") || s;
// Funding intervals differ by venue: Binance/Bybit/OKX are 8-hourly (3/day), Deribit perpetual funding accrues
// continuously and is stored here as an 8h-equivalent rate. Annualise consistently at 3 periods/day.
const PER_DAY = 3;

const venues = ["binance", "bybit", "deribit", "okx"];
const data = new Map<string, Map<string, { ts: number; r: number }[]>>();   // venue -> base -> series
for (const v of venues) {
  const m = new Map<string, { ts: number; r: number }[]>();
  for (let off = 0;; off += 50000) {
    const rows = await fetch(`${OWNED}/trd_perp_oi?venue=eq.${v}&interval=eq.funding&select=symbol,ts,open_interest&order=symbol,ts&offset=${off}&limit=50000`, { headers: hdr })
      .then((r) => r.json()).catch(() => []) as { symbol: string; ts: number; open_interest: number }[];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) { const b2 = base(r.symbol); (m.get(b2) ?? m.set(b2, []).get(b2)!).push({ ts: +r.ts, r: +r.open_interest }); }
    if (rows.length < 50000) break;
  }
  data.set(v, m);
  console.log(`    ${v.padEnd(10)} ${m.size} base assets, ${[...m.values()].reduce((a, x) => a + x.length, 0).toLocaleString()} prints`);
}

const TAKER = Number(K.TAKER_BP), REBAL = Number(K.REBAL_BP_YR), HURDLE = Number(K.HURDLE_PCT), MINO = Number(K.MIN_OVERLAP);
const costPct = (2 * 2 * TAKER / 1e4 + REBAL / 1e4) * 100;   // round trip on BOTH legs, plus drag
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

interface Pair { a: string; b: string; sym: string; n: number; meanDiff: number; medDiff: number; trDiff: number; teDiff: number }
const pairs: Pair[] = [];

for (let i = 0; i < venues.length; i++) {
  for (let j = i + 1; j < venues.length; j++) {
    const A = data.get(venues[i])!, B = data.get(venues[j])!;
    for (const [sym, arrA] of A) {
      const arrB = B.get(sym); if (!arrB) continue;
      // Align on funding timestamp, bucketed to the hour to absorb small clock differences between venues.
      const mb = new Map<number, number>();
      for (const x of arrB) mb.set(Math.round(x.ts / 3600) * 3600, x.r);
      const diffs: { ts: number; d: number }[] = [];
      for (const x of arrA) {
        const kk = Math.round(x.ts / 3600) * 3600;
        const y = mb.get(kk); if (y === undefined) continue;
        diffs.push({ ts: x.ts, d: x.r - y });        // captured by being short the richer leg and long the cheaper
      }
      if (diffs.length < MINO) continue;
      diffs.sort((p, q) => p.ts - q.ts);
      const ann = (xs: number[]) => mean(xs.map(Math.abs)) * PER_DAY * 365 * 100;
      const half = Math.floor(diffs.length / 2);
      pairs.push({
        a: venues[i], b: venues[j], sym, n: diffs.length,
        meanDiff: ann(diffs.map((x) => x.d)),
        medDiff: Math.abs(med(diffs.map((x) => x.d))) * PER_DAY * 365 * 100,
        // SELECTION LAW: the sign to trade is chosen on the first half, then applied blind to the second.
        trDiff: mean(diffs.slice(0, half).map((x) => x.d)),
        teDiff: mean(diffs.slice(half).map((x) => x.d)),
      });
    }
  }
}
assertNonEmpty("venue pairs with adequate overlap", pairs);
pairs.sort((a, b) => b.meanDiff - a.meanDiff);

console.log(`\n==> CROSS-VENUE FUNDING DIFFERENTIAL — ${pairs.length} venue x symbol pairs, cost floor ${costPct.toFixed(2)}%/yr\n`);
console.log(`    ${"pair".padEnd(24)}${"sym".padEnd(7)}${"mean|d|%/yr".padEnd(13)}${"med|d|%/yr".padEnd(12)}${"OOS signed%/yr".padEnd(16)}n`);
let qualifying = 0;
for (const p of pairs) {
  // Apply the first-half sign to the second half. If the differential is persistent this is positive.
  const oos = Math.sign(p.trDiff) * p.teDiff * PER_DAY * 365 * 100;
  const net = oos - costPct;
  if (net >= HURDLE) qualifying++;
  console.log(`    ${`${p.a} vs ${p.b}`.padEnd(24)}${p.sym.padEnd(7)}${p.meanDiff.toFixed(2).padEnd(13)}${p.medDiff.toFixed(2).padEnd(12)}${oos.toFixed(2).padEnd(16)}${p.n.toLocaleString()}`);
}
console.log(`\n    QUALIFYING (OOS net >= ${HURDLE}%/yr after ${costPct.toFixed(2)}%/yr costs): ${qualifying}`);
console.log(`    ${qualifying >= 3 ? "QUALIFIES — a venue-neutral funding spread survives out of sample." :
  `DOES NOT QUALIFY — ${qualifying} pair(s) clear, pre-registered floor is 3.`}`);
console.log(`\n    Note the mean-vs-median columns: a mean far above the median means the differential lives in a few`);
console.log(`    extreme prints — stressed moments, when both legs are least likely to be simultaneously tradable.`);
