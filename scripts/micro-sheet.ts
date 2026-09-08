#!/usr/bin/env -S deno run --allow-net --allow-env
// micro-sheet.ts (D-823) — TODAY'S MICRO-RUNG SHEET. The one rule admitted to LADDER stage 2 (gate row micro_entry):
// the prior-session-low sweep fade at K24, with the rvol-hi conditioner (trd_strategy_specs micro-psl-fade-k24).
// Prints, per instrument, whether the LAST COMPLETED hourly bar closed below its prior-session low (prior close above)
// and whether that bar's volume was >= 1.5x its same-hour median — a CANDIDATE is a lag-1 LONG at the next bar's open,
// exit at the close 24 bars later, at most 0.10x of the micro budget. Fills are the operator's, by hand; this prints.
// A stale panel prints STALE and NO candidate for that instrument (a signal on frozen bars is a signal about nothing).
import { declareKnobs, mkStrictRead } from "../supabase/functions/_shared/run-preconditions.ts";
import { Bar, decodeBar, priorSessionLevels } from "../supabase/functions/_shared/mtf-structure.ts";
const K = declareKnobs("micro-sheet", [
  { name: "MICRO_BUDGET", def: "0", note: "the capped, fully-losable micro budget in USD; 0 = sizing not printed" },
  { name: "RVOL_HI", def: "1.5", note: "same-UTC-hour relative volume threshold (D-767)" },
  { name: "STALE_H", def: "6", note: "hours after which an instrument's last bar is STALE (FX/index are closed at weekends: stated, not hidden)" },
  { name: "LOOKBACK_H", def: "48", note: "recent sweeps to list for context" },
]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mic", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);
const RT: Record<string, number> = { BTCUSDT: 7, ETHUSDT: 7, SOLUSDT: 7, BNBUSDT: 7, XRPUSDT: 7, XAUUSD: 4, USA500IDXUSD: 4, USATECHIDXUSD: 4, EURUSD: 2, GBPUSD: 2, AUDUSD: 2, USDJPY: 2 };
const CRYPTO = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]);
/* D-823f — CAN A UK RETAIL OPERATOR ACTUALLY PLACE THIS? Verified from the FCA handbook and IG's own pages, 2026-09-08.
   NO for every crypto perp: COBS 22.6 bans the sale/marketing/distribution of cryptoasset DERIVATIVES (CFDs, options,
   futures) to UK retail clients, in force since 2021-01-06 and explicitly retained when crypto ETNs were opened up.
   Spot crypto on an exchange is not a derivative and is a different instrument from the perp this rule was measured on.
   YES for gold, the two index proxies and the FX majors — but the SIZE only works on a spread bet (from 1p/point, ~£5
   to open), not a CFD: IG's FX CFD minimum is one mini contract = 10,000 base currency, ~100x the £100 a £1,000 budget
   allows per position. Spread bets and CFDs are different products with different treatment; that is the operator's to
   verify, not mine to advise on. */
/* D-825 — MEASURED expectancy on the three instruments that can actually be placed here, OOS >= 2023, net of the
   measured venue cost, from scripts/placeable-subset-test.ts. These replace the 12-instrument pooled figures for those
   three, and they carry the finding that matters for a fill: the rvol-hi conditioner FAILS on this subset (pooled
   t 0.92; gold outright negative at -1.36bp), so the UNCONDITIONED fade is the variant with the measured number. */
const D825: Record<string, { net: number; t: number; excess: number }> = {
  XAUUSD: { net: 4.72, t: 1.27, excess: -3.14 }, USA500IDXUSD: { net: 5.64, t: 1.90, excess: 0.00 }, USATECHIDXUSD: { net: 8.22, t: 2.10, excess: -1.03 },
};
const UK_PLACEABLE: Record<string, string> = {
  BTCUSDT: "NO — FCA COBS 22.6 bans crypto derivatives for UK retail (spot is a different instrument)",
  ETHUSDT: "NO — FCA COBS 22.6", SOLUSDT: "NO — FCA COBS 22.6", BNBUSDT: "NO — FCA COBS 22.6", XRPUSDT: "NO — FCA COBS 22.6",
  XAUUSD: "yes, spread bet from 1p/pt (~£44 notional)", USA500IDXUSD: "yes, spread bet from 1p/pt (~£77 notional)",
  USATECHIDXUSD: "yes, spread bet from 1p/pt (~£295 notional)", EURUSD: "yes, spread bet (CFD min ~100x too big)",
  GBPUSD: "yes, spread bet (CFD min ~100x too big)", AUDUSD: "yes, spread bet (CFD min ~100x too big)", USDJPY: "yes, spread bet (CFD min ~100x too big)",
};
const budget = +K.MICRO_BUDGET, RVOL_HI = +K.RVOL_HI, STALE_S = +K.STALE_H * 3600, LOOK = +K.LOOKBACK_H;
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
async function loadBars(sym: string): Promise<Bar[]> {
  if (CRYPTO.has(sym)) { const row = (await q(`trd_bars_intraday?symbol=eq.${sym}&tf=eq.1h&select=bars`) as { bars: number[][] }[])[0]; return ((row?.bars ?? []) as number[][]).map(decodeBar).sort((a, b) => a.ts - b.ts).slice(-2500); }
  /* D-823b: the live intraday series (Yahoo 60m, symbol.yh1h) first; the Dukascopy research series is a day behind by construction */
  const live = await q(`trd_fx_hourly?symbol=eq.${sym}.yh1h&select=ts,o,h,l,c,vol&order=ts.desc&limit=2500`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  const rows = live.length >= 100 ? live : await q(`trd_fx_hourly?symbol=eq.${sym}&select=ts,o,h,l,c,vol&order=ts.desc&limit=2500`) as { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  SRC.set(sym, live.length >= 100 ? "yahoo60m" : "dukascopy(day-file, lags)");
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol })).sort((a, b) => a.ts - b.ts);
}
const SRC = new Map<string, string>();
const now = Math.floor(Date.now() / 1000);
console.log(`==> MICRO SHEET ${new Date().toISOString().slice(0, 16)}Z — rule micro-psl-fade-k24 (D-763/764/767, admitted D-823). Fills are yours, by hand; this prints.`);
console.log(`    THERE IS NO MEASURED EDGE ON THE PLACEABLE INSTRUMENTS (D-825 retracted same-day by D-826b). Pooled gross 8.50bp against an unconditional 24h hold of 9.85bp over the SAME period = excess -1.35bp; per instrument XAUUSD -3.14bp, USA500 0.00bp, USATECH -1.03bp. The rule UNDERPERFORMS simply holding for 24 hours on all three.`);
console.log(`    So a fill here buys EXECUTION INFORMATION (spread, slippage, platform, your own behaviour) at a small negative expected return. That can be worth paying for; it is not a trade with an edge, and it must be sized as a cost, not as a position.`);
console.log(`    12-instrument pooled model, for context only: rvol-hi K24 +7.15bp t 3.15 (D-767); unconditioned +2.09bp t 2.09. REGIME PRIOR: 2025+ negative at every horizon (D-764); FX majors flat.`);
console.log(budget > 0 ? `    budget $${budget.toLocaleString()} -> max notional per position $${(0.10 * budget).toFixed(0)} (0.10x, D-767 sizer); P(DD<=-50% of budget) 7-47% at that size - the budget must be losable.` : `    MICRO_BUDGET unset: sizing not printed (MICRO_BUDGET=<usd> to size at 0.10x per position).`);
console.log(`    ${"instrument".padEnd(14)} ${"last bar (UTC)".padEnd(17)} ${"age".padStart(6)}  ${"PSL".padStart(11)}  ${"close".padStart(11)}  ${"rvol".padStart(5)}  state`);
let candidates = 0, stale = 0, ok = 0;
for (const sym of Object.keys(RT)) {
  const b = await loadBars(sym);
  if (b.length < 500) { console.log(`    ${sym.padEnd(14)} ${"(no bars)".padEnd(17)}`); stale++; continue; }
  const i = b.length - 1; const age = now - b[i].ts; const ageH = (age / 3600).toFixed(1) + "h";
  const psl = priorSessionLevels(b); const lvl = psl[i]?.low;
  const sameHour = b.slice(Math.max(0, i - 24 * 60), i).filter((x) => new Date(x.ts * 1000).getUTCHours() === new Date(b[i].ts * 1000).getUTCHours()).slice(-30).map((x) => x.v);
  const rvol = sameHour.length >= 10 ? b[i].v / (median(sameHour) || 1e-9) : NaN;
  const sweep = lvl !== undefined && b[i - 1].c >= lvl && b[i].c < lvl;
  const isStale = age > STALE_S;
  let state: string;
  if (isStale) { state = `STALE (${ageH} > ${K.STALE_H}h) - no candidate on frozen bars`; stale++; }
  else if (sweep) {
    const cond = Number.isFinite(rvol) && rvol > 0 && rvol >= RVOL_HI; const fx = RT[sym] === 2;
    /* D-764: the four FX majors were FLAT in the OOS measurement (EUR +0.09bp, JPY -1.67bp); the edge lived in crypto/indices. Said on the line, not hidden. */
    const m = D825[sym];
    const expect = m
      ? `- NO MEASURED EDGE HERE (D-825 RETRACTED, D-826b): ${m.net.toFixed(2)}bp/event net looks positive but the excess over simply holding 24h in the same period is ${m.excess.toFixed(2)}bp - this instrument's fade UNDERPERFORMS a random hold${cond ? "; the rvol-hi conditioner does not help either (pooled t 0.92)" : ""}`
      : (cond ? "- rvol-hi MET (+7.15bp, 12-instrument pooled model)" : (rvol > 0 ? "- unconditioned (+2.09bp, 12-instrument pooled model)" : "- rvol n/a on this feed (no volume): unconditioned"));
    state = `CANDIDATE: LONG at next open, exit close +24 bars, RT ${RT[sym]}bp ${expect}${fx ? " - FX MAJOR: measured FLAT in D-764, expectancy ~0 here" : ""}${budget > 0 ? `, notional <= $${(0.10 * budget).toFixed(0)}` : ""}`;
    candidates++; ok++;
  }
  else { state = "no setup"; ok++; }
  console.log(`    ${sym.padEnd(14)} ${new Date(b[i].ts * 1000).toISOString().slice(0, 16).padEnd(17)} ${ageH.padStart(6)}  ${(lvl ?? NaN).toFixed(lvl && lvl > 100 ? 2 : 5).padStart(11)}  ${b[i].c.toFixed(b[i].c > 100 ? 2 : 5).padStart(11)}  ${Number.isFinite(rvol) ? rvol.toFixed(2).padStart(5) : "  n/a"}  ${state}${SRC.has(sym) ? ` [${SRC.get(sym)}]` : ""}`);
  if (!isStale && sweep) console.log(`    ${"".padEnd(14)} UK retail: ${UK_PLACEABLE[sym]}`);
  if (!isStale) {
    const recent: string[] = [];
    for (let j = Math.max(1, i - LOOK); j < i; j++) { const L = psl[j]?.low; if (L !== undefined && b[j - 1].c >= L && b[j].c < L) recent.push(`${new Date(b[j].ts * 1000).toISOString().slice(5, 16)} (${i - j}h ago${i - j <= 24 ? ", position would still be OPEN" : ""})`); }
    if (recent.length) console.log(`    ${"".padEnd(14)} recent sweeps: ${recent.join("; ")}`);
  }
}
/* D-823d: a UK retail CFD venue's PUBLISHED costs as the reference for the sheet's RT assumptions (IG, read 2026-09-08): spreads US 500 0.4pt,
   spot gold 0.3pt, EUR/USD 0.6pt (minimums); overnight funding = benchmark rate + 3%/yr admin (indices) or tom-next + 1.5%/yr (FX, metals),
   charged once per 10pm UK crossing - a K24 hold crosses it once. Benchmark ASSUMED 4%/yr here; the first real statement replaces it. */
const BENCH = 0.04; const fundIdx = (BENCH + 0.03) / 365 * 1e4, fundFx = (BENCH + 0.015) / 365 * 1e4;
console.log(`\n  venue cost reference (IG UK published, 2026-09-08; benchmark assumed ${(BENCH * 100).toFixed(0)}%/yr): US500 spread ~${(0.4 / 7700 * 1e4).toFixed(1)}bp + funding ~${fundIdx.toFixed(1)}bp/day = ~${(0.4 / 7700 * 1e4 + fundIdx).toFixed(1)}bp per K24 (model RT 4bp); gold ~${(0.3 / 4400 * 1e4).toFixed(2)}bp + ${fundFx.toFixed(1)}bp = ~${(0.3 / 4400 * 1e4 + fundFx).toFixed(1)}bp (model 4bp); EURUSD ~${(0.6 / 1.16 / 1e4 * 1e4).toFixed(1)}bp + ${fundFx.toFixed(1)}bp = ~${(0.6 / 1.16 / 1e4 * 1e4 + fundFx).toFixed(1)}bp (model 2bp: AT-FEE on FX). Crypto perps are not open to UK retail; spot crypto RT is venue-specific.`);
console.log(`\n  UK retail placeability (D-823f): the 5 perps are NOT placeable (FCA COBS 22.6, crypto derivatives banned for retail); gold + 2 indices + 4 FX are, at spread-bet minimums only. D-764 measured the FX majors FLAT and D-825/826b measured the other three as BELOW an unconditional 24h hold — so on this rule there is currently NO placeable instrument with a measured edge.`);
console.log(`\n  ${candidates} candidate(s); ${stale} instrument(s) STALE; ${ok} instruments live. Record every fill: scripts/micro-ledger.ts. Kill-switch account 'micro' must read armed before any fill.`);
const ks = (await q(`trd_kill_switch?account=eq.micro&select=state`) as { state: string }[])[0]; console.log(`  kill-switch micro: ${ks?.state ?? "MISSING"}`);
if (!ks) Deno.exit(1);
