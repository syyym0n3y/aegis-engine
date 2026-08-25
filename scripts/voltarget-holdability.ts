#!/usr/bin/env -S deno run --allow-net --allow-env
// voltarget-holdability.ts (D-600) — does the RISK GATE actually earn its keep on real instruments?
//
// WHY THIS AND NOT ANOTHER EDGE HUNT. This programme's own thesis states that the only component with near-certain
// positive expected value is the risk gate. That claim has never been measured on the eight FX/metal/index/energy
// instruments we hold — `voltiming` is VIX-signal timing on SPY/QQQ, and `volmanaged-book-p2` is the equity factor
// book. It is also the one test whose usefulness does not depend on finding an edge: position sizing applies to
// whatever is eventually held, and the operator's stated goal is scaling with managed risk.
//
// PRE-REGISTERED as D-600-voltarget-fx (immutable, kill condition written before the data), including the trap:
// a Sharpe improvement with LONGER time underwater is NOT a pass. D-565/566 established that duration, not depth,
// is what ends deployments — and that vol targeting helps equities but NOT crypto, so it is asset-class dependent
// and must be measured here rather than assumed.
//
// HONEST CONSTRUCTION:
//   - realised vol from a TRAILING window only (no look-ahead); position for day t uses vol through t-1
//   - leverage capped, because an uncapped target buys unbounded size in quiet regimes
//   - the turnover vol targeting INDUCES is charged at the instrument's own round-trip cost
//   - time underwater measured explicitly, not just drawdown depth
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("voltarget-holdability", [
  { name: "TARGET_VOL", def: "0.10", note: "annualised target" },
  { name: "VOL_WINDOW", def: "500", note: "trailing hours for realised vol" },
  { name: "MAX_LEV", def: "3", note: "leverage cap" },
  { name: "FX_FEE_BP", def: "1" },
  { name: "IDX_FEE_BP", def: "3" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "vt", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const FXSET = new Set(["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]);
const HRS_PER_YR = 24 * 365;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/** Longest stretch below a prior equity peak, and max drawdown depth. Duration is the number D-565/566 says matters. */
function underwater(rets: number[]): { days: number; maxdd: number } {
  let eq = 1, peak = 1, cur = 0, worst = 0, dd = 0, maxdd = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq >= peak) { peak = eq; if (cur > worst) worst = cur; cur = 0; }
    else { cur++; dd = eq / peak - 1; if (dd < maxdd) maxdd = dd; }
  }
  if (cur > worst) worst = cur;
  return { days: worst / 24, maxdd };
}

const symRows = await fetch(`${OWNED}/trd_fx_hourly?select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
const syms = assertNonEmpty("symbols", [...new Set((Array.isArray(symRows) ? symRows : []).map((x) => x.symbol))]);

console.log(`==> VOL TARGETING vs BUY-AND-HOLD — target ${Number(K.TARGET_VOL) * 100}% annualised, ${K.VOL_WINDOW}h trailing vol, ${K.MAX_LEV}x cap`);
console.log(`    turnover charged at the instrument's own round-trip cost. Time underwater in DAYS.\n`);
console.log(`    ${"instrument".padEnd(15)}${"BH Sharpe".padEnd(11)}${"VT Sharpe".padEnd(11)}${"BH uw(d)".padEnd(10)}${"VT uw(d)".padEnd(10)}${"BH maxDD".padEnd(10)}${"VT maxDD".padEnd(10)}${"cost%/yr".padEnd(10)}verdict`);

let better = 0, tested = 0;
const halves: { sym: string; h1: boolean; h2: boolean }[] = [];

for (const sym of syms) {
  const px: number[] = [];
  for (let off = 0;; off += 50000) {
    const rows = await fetch(`${OWNED}/trd_fx_hourly?symbol=eq.${sym}&select=ts,c&order=ts&offset=${off}&limit=50000`, { headers: hdr })
      .then((r) => r.json()).catch(() => []) as { ts: number; c: number }[];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) if (r.c > 0) px.push(r.c);
    if (rows.length < 50000) break;
  }
  if (px.length < 20000) continue;
  const rets: number[] = [];
  for (let i = 1; i < px.length; i++) rets.push(px[i] / px[i - 1] - 1);

  const W = Number(K.VOL_WINDOW), TGT = Number(K.TARGET_VOL), CAP = Number(K.MAX_LEV);
  const feeBp = FXSET.has(sym) ? Number(K.FX_FEE_BP) : Number(K.IDX_FEE_BP);

  const bh: number[] = [], vt: number[] = [];
  let prevW = 1, costSum = 0;
  for (let i = W; i < rets.length; i++) {
    // vol from the TRAILING window ending at i-1 — the position for hour i knows nothing about hour i.
    const win = rets.slice(i - W, i);
    const rv = sd(win) * Math.sqrt(HRS_PER_YR);
    const w = Math.min(CAP, rv > 1e-9 ? TGT / rv : CAP);
    const turn = Math.abs(w - prevW);
    const cost = turn * feeBp / 1e4;         // rebalancing the exposure costs the spread on the traded delta
    costSum += cost;
    bh.push(rets[i]);
    vt.push(w * rets[i] - cost);
    prevW = w;
  }
  if (bh.length < 10000) continue;
  tested++;

  const shp = (a: number[]) => mean(a) / (sd(a) || 1e-12) * Math.sqrt(HRS_PER_YR);
  const b = underwater(bh), v = underwater(vt);
  const sB = shp(bh), sV = shp(vt);
  const costPct = costSum / (bh.length / HRS_PER_YR) * 100;

  // both halves, for the stability clause
  const h = Math.floor(bh.length / 2);
  const h1 = shp(vt.slice(0, h)) > shp(bh.slice(0, h));
  const h2 = shp(vt.slice(h)) > shp(bh.slice(h));
  halves.push({ sym, h1, h2 });

  // PRE-REGISTERED PASS CONDITION: Sharpe up AND time underwater down. Sharpe alone is explicitly not a pass.
  const ok = sV > sB && v.days < b.days;
  if (ok) better++;
  console.log(`    ${sym.padEnd(15)}${sB.toFixed(2).padEnd(11)}${sV.toFixed(2).padEnd(11)}${b.days.toFixed(0).padEnd(10)}${v.days.toFixed(0).padEnd(10)}${(b.maxdd * 100).toFixed(0).padEnd(10)}${(v.maxdd * 100).toFixed(0).padEnd(10)}${costPct.toFixed(2).padEnd(10)}${ok ? "BETTER" : sV > sB ? "sharpe-up, uw-WORSE" : "worse"}`);
}

console.log(`\n    PASS on ${better} of ${tested} instruments (pre-registered bar: >= 6 of 8, Sharpe UP and time-underwater DOWN).`);
const stable = halves.filter((x) => x.h1 === x.h2).length;
console.log(`    Sharpe direction consistent across BOTH halves on ${stable} of ${halves.length}.`);
console.log(`    ${better >= 6 && stable >= 6 ? "QUALIFIES — the risk gate earns its keep here." : "DOES NOT QUALIFY under the pre-registered rule."}`);
