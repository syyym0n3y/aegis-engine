#!/usr/bin/env -S deno run --allow-net --allow-env
// holdability-sizer.ts (D-744) — the ONLY "when to start / how much" tool the evidence licenses. Every timing rule
// tested COSTS wealth (D-498/730/735/739); what actually ends deployments is DURATION and DEPTH the holder cannot sit
// through (THE HOLDABILITY LAW, D-565). So the honest question is not "when do I get out" but "what fraction can I
// hold through the worst the history has shown, without selling at the bottom" — and what each step of safety costs.
//
// It does one thing: for equity fractions w = 100%..20% (rest in T-bills, rebalanced monthly, deposits monthly),
// replay the full held history and report terminal wealth, worst drawdown, longest time underwater. The reader picks
// the largest w whose drawdown they will GENUINELY hold — the table shows exactly what the smaller w costs. This is
// the engine's measured output on the held history, not advice; nobody here is a licensed adviser.
// POSITIVE CONTROL: w=100% must reproduce the ladder harvester's buy-and-hold figure (D-735) — same deposit, same dates.
import { assertNonEmpty, declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
declareKnobs("holdability-sizer", [
  { name: "DEPOSIT", def: "150", note: "monthly deposit, $" },
  { name: "START", def: "1993-01-29", note: "first month (SPY inception; matches ladder-harvester)" },
  { name: "TOLERANCE", def: "30", note: "the drawdown %, peak-to-trough, the holder will genuinely sit through" },
]);
const DEPOSIT = Number(Deno.env.get("DEPOSIT") || "150"), START = Deno.env.get("START") || "1993-01-29", TOL = Number(Deno.env.get("TOLERANCE") || "30");

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sizer", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
// D-757: STRICT read. A transport failure now RETRIES and then THROWS with the path and status, instead of
// returning [] — which was indistinguishable from "the market has nothing here" (D-756: a PostgREST OOM
// restart silently shrank a 15,502-symbol universe to 8,600 and the run finished, printing a wrong number).
const { q } = mkStrictRead(OWNED, hdr);

type Bar = [number, number, number, number, number, number];
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const spyRow = (await q(`trd_bars_deep?symbol=eq.SPY&select=bars`))[0];
const bars: Bar[] = (spyRow?.bars || []).filter((b: Bar) => b[4] > 0 && iso(b[0]) >= START);
assertNonEmpty("SPY bars", bars, 5000);
const tb = (await q(`trd_macro_series?series=eq.ust_3m&select=d,v&order=d.asc`)) as { d: string; v: number }[]; // plumbing-ok: ordered single series
assertNonEmpty("ust_3m", tb, 5000);
const tbMap = new Map(tb.map((r) => [r.d, r.v])); let lastTb = tb[0].v;
const tbOn = (d: string) => { const v = tbMap.get(d); if (v != null) lastTb = v; return lastTb; };

// month-end indices
const ym = (d: string) => d.slice(0, 7);
// a SET, not a sequential pointer: bars[0] (1993-01-29) is itself a month-end, and a pointer starting there never
// advanced past index 0 — no deposit was ever made and the control printed $0. Caught by the D-735 control.
const monthEnds = new Set<number>(); for (let i = 0; i < bars.length - 1; i++) if (ym(iso(bars[i][0])) !== ym(iso(bars[i + 1][0]))) monthEnds.add(i); monthEnds.add(bars.length - 1);
assertNonEmpty("month-ends", [...monthEnds], 300);

interface Out { w: number; final: number; deposited: number; worstDD: number; longestUW: number; cagr: number }
function replay(w: number): Out {
  let eq = 0, cash = 0, deposited = 0, peak = 0, worst = 0, uwStart = -1, longest = 0;
  if (monthEnds.has(0)) { deposited += DEPOSIT; eq = DEPOSIT * w; cash = DEPOSIT * (1 - w); }   // first deposit on day 0 if it is a month-end
  for (let i = 1; i < bars.length; i++) {
    const r = bars[i][4] / bars[i - 1][4] - 1; const d = iso(bars[i][0]);
    eq *= 1 + r; cash *= 1 + (tbOn(d) / 100) / 252;
    if (monthEnds.has(i)) {                               // month-end: deposit, rebalance to w
      deposited += DEPOSIT; const tot = eq + cash + DEPOSIT; eq = tot * w; cash = tot * (1 - w);
    }
    const v = eq + cash;
    // drawdown on VALUE net of deposits is misleading for a saver; use value vs its own running peak, standard
    if (v > peak) { peak = v; if (uwStart >= 0) { longest = Math.max(longest, i - uwStart); uwStart = -1; } }
    else { if (uwStart < 0) uwStart = i; const dd = v / peak - 1; if (dd < worst) worst = dd; }
  }
  if (uwStart >= 0) longest = Math.max(longest, bars.length - 1 - uwStart);
  const yrs = bars.length / 252; const final = eq + cash;
  return { w, final, deposited, worstDD: worst, longestUW: longest / 252, cagr: Math.pow(final / deposited, 1 / yrs) - 1 };
}

console.log(`==> HOLDABILITY SIZER (D-744) — SPY + T-bills, $${DEPOSIT}/mo, monthly rebalance, ${iso(bars[0][0])} .. ${iso(bars[bars.length - 1][0])}\n`);
console.log(`  The question the evidence licenses: not WHEN to sell, but HOW MUCH you can hold through the worst the history shows.`);
console.log(`  Your stated tolerance: a ${TOL}% peak-to-trough drawdown you will genuinely sit through without selling.\n`);
console.log(`    equity %   terminal $     x deposits   CAGR    worst DD   longest underwater   wealth given up vs 100%`);
const rows: Out[] = []; for (const w of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]) rows.push(replay(w));
const full = rows[0];
for (const o of rows) console.log(`    ${String(Math.round(o.w * 100)).padStart(6)}%   ${("$" + Math.round(o.final).toLocaleString()).padStart(10)}   ${(o.final / o.deposited).toFixed(2).padStart(9)}x   ${(o.cagr * 100).toFixed(1).padStart(4)}%   ${(o.worstDD * 100).toFixed(0).padStart(6)}%   ${o.longestUW.toFixed(1).padStart(10)}y            ${o.w === 1 ? "—" : "-" + ((1 - o.final / full.final) * 100).toFixed(0) + "%"}`);

// POSITIVE CONTROL vs the ladder harvester's buy-and-hold (D-735): $547,847 at the same deposit/dates. Rebalancing
// at w=1 is identical to buy-and-hold, so a mismatch beyond ~3% means this replay is wrong, not the market.
const REF = 547847; const dev = Math.abs(full.final / REF - 1);
console.log(`\n  CONTROL: w=100% terminal $${Math.round(full.final).toLocaleString()} vs ladder-harvester buy-and-hold $${REF.toLocaleString()} (dev ${(dev * 100).toFixed(1)}%)`);
if (DEPOSIT === 150 && START === "1993-01-29" && dev > 0.03) { console.error("!! control FAILED — replay disagrees with D-735. RED."); Deno.exit(1); }

const fit = rows.filter((o) => -o.worstDD * 100 <= TOL).sort((a, b) => b.w - a.w)[0];
console.log(`\n  AT A ${TOL}% TOLERANCE the largest holdable equity fraction on this history is ${fit ? Math.round(fit.w * 100) + "%" : "below 20% — the tolerance is tighter than any mix here delivered"}${fit ? `, costing ${((1 - fit.final / full.final) * 100).toFixed(0)}% of terminal wealth vs all-equity (${fit.longestUW.toFixed(1)}y longest underwater)` : ""}.`);
console.log(`  READ IT HONESTLY: the history holds ${rows[0].longestUW.toFixed(1)} years underwater at 100% — a saver who WILL hold that should hold 100% and`);
console.log(`  keep depositing; the smaller fractions exist for the saver who would otherwise sell at the bottom (D-680/735). Nothing here times anything.`);
