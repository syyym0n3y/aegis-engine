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
console.log(`    model expectancy (per event, net of RT): rvol-hi K24 +7.15bp t 3.15 OOS (7/12 instruments); unconditioned +2.09bp t 2.09 (12-panel). REGIME PRIOR: 2025+ negative at every horizon (D-764); FX majors flat.`);
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
    state = `CANDIDATE: LONG at next open, exit close +24 bars, RT ${RT[sym]}bp ${cond ? "- rvol-hi MET (+7.15bp model)" : (rvol > 0 ? "- unconditioned (+2.09bp model, weaker)" : "- rvol n/a on this feed (no volume): unconditioned")}${fx ? " - FX MAJOR: measured FLAT in D-764, expectancy ~0 here" : ""}${budget > 0 ? `, notional <= $${(0.10 * budget).toFixed(0)}` : ""}`;
    candidates++; ok++;
  }
  else { state = "no setup"; ok++; }
  console.log(`    ${sym.padEnd(14)} ${new Date(b[i].ts * 1000).toISOString().slice(0, 16).padEnd(17)} ${ageH.padStart(6)}  ${(lvl ?? NaN).toFixed(lvl && lvl > 100 ? 2 : 5).padStart(11)}  ${b[i].c.toFixed(b[i].c > 100 ? 2 : 5).padStart(11)}  ${Number.isFinite(rvol) ? rvol.toFixed(2).padStart(5) : "  n/a"}  ${state}${SRC.has(sym) ? ` [${SRC.get(sym)}]` : ""}`);
  if (!isStale) {
    const recent: string[] = [];
    for (let j = Math.max(1, i - LOOK); j < i; j++) { const L = psl[j]?.low; if (L !== undefined && b[j - 1].c >= L && b[j].c < L) recent.push(`${new Date(b[j].ts * 1000).toISOString().slice(5, 16)} (${i - j}h ago${i - j <= 24 ? ", position would still be OPEN" : ""})`); }
    if (recent.length) console.log(`    ${"".padEnd(14)} recent sweeps: ${recent.join("; ")}`);
  }
}
console.log(`\n  ${candidates} candidate(s); ${stale} instrument(s) STALE; ${ok} instruments live. Record every fill: scripts/micro-ledger.ts. Kill-switch account 'micro' must read armed before any fill.`);
const ks = (await q(`trd_kill_switch?account=eq.micro&select=state`) as { state: string }[])[0]; console.log(`  kill-switch micro: ${ks?.state ?? "MISSING"}`);
if (!ks) Deno.exit(1);
