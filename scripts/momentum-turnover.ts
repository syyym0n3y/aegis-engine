#!/usr/bin/env -S deno run --allow-net --allow-env
// momentum-turnover.ts (D-654) — the number D-653 could not report.
//
// D-653 found EM large-cap momentum at +4.2%/yr over the market (t 3.98), passing the size gate at BIG/SMALL 0.90
// where developed markets failed at 0.31-0.47. Its verdict hangs entirely on one unmeasured quantity: at 60bp
// round-trip the gross figure becomes 3.48%/yr at 10% monthly turnover and 0.60%/yr at 50%. That range spans
// "interesting" to "gone", so quoting the gross number without it is quoting half a result.
//
// WHAT CAN AND CANNOT BE MEASURED HERE, STATED BEFORE THE NUMBER. French publishes portfolio RETURNS, not portfolio
// COMPOSITIONS, so EM turnover cannot be computed from anything we hold. What IS measurable is the turnover of the
// CONSTRUCTION — a 12-2 momentum rank, monthly rebalance, top decile — on our own large-cap panel. That is a PROXY,
// and its bias has a known direction: EM is more volatile than US large caps, momentum ranks reshuffle faster in
// volatile universes, so the US figure is a LOWER BOUND on EM turnover. A lower bound is the useful side here,
// because if the strategy dies even at the lower bound it dies everywhere.
//
// THE INSTRUMENT LAW applies to the answer as much as the question: this measures a research-space construction,
// not a placeable EM portfolio, and the result is reported as such.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("momentum-turnover", [
  { name: "TOP_N", def: "500", note: "large-cap universe by dollar volume, the BIG analogue" },
  { name: "DECILE", def: "10", note: "portfolio is the top 1/DECILE by 12-2 momentum" },
  { name: "SKIP_M", def: "1", note: "the '2' in 12-2: skip the most recent month" },
  { name: "LOOK_M", def: "12", note: "the '12' in 12-2" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mt", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

const syms = await fetch(`${OWNED}/trd_bars_deep?select=symbol&order=symbol`, { headers: hdr })
  .then((r) => r.ok ? r.json() : []).catch(() => []) as { symbol: string }[];
const all = [...new Set((Array.isArray(syms) ? syms : []).map((s) => s.symbol))];
assertNonEmpty("panel symbols", all, 500);

// monthly closes + dollar volume per symbol
const mo = new Map<string, Map<string, { c: number; dv: number }>>();
for (let i = 0; i < all.length; i += 40) {
  const part = all.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
    .then((r) => r.ok ? r.json() : []).catch(() => []) as { symbol: string; bars: unknown }[];
  for (const r of Array.isArray(rows) ? rows : []) {
    const b = r.bars as (number | string)[][]; if (!Array.isArray(b) || b.length < 400) continue;
    const m = new Map<string, { c: number; dv: number }>();
    for (const x of b) {
      const d = typeof x[0] === "string" ? String(x[0]).slice(0, 10) : new Date(Number(x[0]) * 1000).toISOString().slice(0, 10);
      const c = Number(x[4]), v = Number(x[5]) || 0;
      if (c > 0) m.set(d.slice(0, 7), { c, dv: v * c });     // last observation of each month wins
    }
    if (m.size > 24) mo.set(r.symbol, m);
  }
}
assertNonEmpty("symbols with monthly series", [...mo.keys()], 300);

const months = [...new Set([...mo.values()].flatMap((m) => [...m.keys()]))].sort();
const LOOK = Number(K.LOOK_M), SKIP = Number(K.SKIP_M), TOPN = Number(K.TOP_N), DEC = Number(K.DECILE);

let prev: Set<string> | null = null;
const oneWay: number[] = [];
let rebalances = 0, breadth = 0;

for (let t = LOOK + SKIP; t < months.length; t++) {
  const now = months[t], form = months[t - SKIP], base = months[t - SKIP - LOOK];
  // universe: the TOP_N most liquid names that have all three observations — the BIG analogue
  const cand: { s: string; dv: number; mom: number }[] = [];
  for (const [s, m] of mo) {
    const a = m.get(base), b = m.get(form), c = m.get(now);
    if (!a || !b || !c) continue;
    if (!(a.c > 0) || !(b.c > 0)) continue;
    cand.push({ s, dv: b.dv, mom: b.c / a.c - 1 });
  }
  if (cand.length < TOPN) continue;
  cand.sort((x, y) => y.dv - x.dv);
  const uni = cand.slice(0, TOPN);
  uni.sort((x, y) => y.mom - x.mom);
  const k = Math.floor(uni.length / DEC); if (k < 10) continue;
  const cur = new Set(uni.slice(0, k).map((x) => x.s));
  if (prev) {
    // one-way turnover: the fraction of the portfolio replaced this month
    let leavers = 0;
    for (const s of prev) if (!cur.has(s)) leavers++;
    oneWay.push(leavers / prev.size);
    rebalances++;
  }
  breadth += cur.size;
  prev = cur;
}
assertNonEmpty("rebalances measured", oneWay, 24);

const ow = mean(oneWay);
console.log(`\n==> 12-${SKIP + 1} MOMENTUM TURNOVER — top decile of the ${TOPN} most liquid names`);
console.log(`    ${rebalances} monthly rebalances | mean portfolio ${(breadth / (rebalances + 1)).toFixed(0)} names`);
console.log(`    ONE-WAY monthly turnover: mean ${(100 * ow).toFixed(1)}%  (min ${(100 * Math.min(...oneWay)).toFixed(1)}%, max ${(100 * Math.max(...oneWay)).toFixed(1)}%)`);
console.log(`    round-trip equivalent:   ${(200 * ow).toFixed(1)}% of portfolio value traded per month\n`);

console.log(`    COST APPLIED TO D-653's GROSS +4.2%/yr (t 3.98) EM long-only excess:`);
for (const bp of [20, 40, 60, 100]) {
  const annCost = 2 * ow * 12 * (bp / 1e4) * 100;      // round trip, annualised, in %
  const net = 4.2 - annCost;
  console.log(`      @${String(bp).padStart(3)}bp round trip -> cost ${annCost.toFixed(2)}%/yr, net ${net.toFixed(2)}%/yr, implied t ${(3.98 * net / 4.2).toFixed(2)}`);
}
console.log(`\n    THIS IS A LOWER BOUND ON EM. Measured on US large caps because French publishes returns, not`);
console.log(`    compositions. Momentum ranks reshuffle faster in more volatile universes, and EM is more volatile,`);
console.log(`    so real EM turnover is HIGHER and the net figures above are correspondingly OPTIMISTIC.`);
