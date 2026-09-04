#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// mtf-nq-10am.ts (D-779) — the operator's direct ask: mark the Nasdaq (NQ, via USATECHIDXUSD 1h bars,
// 79,992 hours 2016-01 → 2026-05) at 10AM Eastern each trading day, and analyse if anything is CONSISTENT
// about that hour's behaviour using MTF context: previous-day high/low (PDH/PDL) and prior-session
// (asia/london) highs/lows.
//
// 10AM ET handling. Operator wrote "10AM EST" but US ET switches between EDT (Mar-Nov, UTC-4) and
// EST (Nov-Mar, UTC-5). We use REAL 10AM ET for each date via a simple DST rule (2nd Sun of Mar to 1st Sun
// of Nov) — the bar that STARTS at 14:00 UTC (EDT) or 15:00 UTC (EST). Both variants are also reported
// separately so the reader can verify.
//
// LEVELS (no look-ahead):
//   PDH / PDL — prior UTC-day highest H / lowest L (known from 00:00 UTC of current day)
//   asiaH/L   — sum of highs/lows over previous asia session (00-08 UTC), known when that session closes
//   londonH/L — previous london session (07-16 UTC) — but at 10AM ET (14/15 UTC) london is STILL RUNNING;
//               use "london-so-far" high/low from that session's start up to the 10AM bar's start
//
// ANALYSIS PER 10AM ET BAR:
//   1. distance from PDH/PDL (bp)
//   2. distance from asiaH/asiaL (bp)
//   3. is 10AM bar SWEEPING (making a new HH/LL vs a level) — PDH/PDL/asiaH/asiaL/londonH-so-far/londonL-so-far
//   4. bar direction (green/red), body size, wick shape
//   5. forward return from 10AM bar CLOSE to session-end close (21:00 UTC EDT / 22:00 UTC EST = 4PM ET)
//   6. forward returns at K1/K3/K6 hours
//
// COST charged at 4bp round-trip (IDX_RT_BP) for any traded-hypothesis test.
// SELECTION LAW: many descriptive slices printed; the "trade" hypothesis is stated up front (fade the 10AM
// bar's direction vs continue with it) — both directions reported so the reader sees the asymmetry.
import { Bar } from "../supabase/functions/_shared/mtf-structure.ts";
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("mtf-nq-10am", [
  { name: "IDX_RT_BP", def: "4" },
  { name: "SWEEP_TOL_BP", def: "0", note: "close beyond level by >= this bp counts as sweep (0 = any close beyond)" },
]);
const SWEEP_TOL = Number(K.SWEEP_TOL_BP) / 1e4;
const rt = Number(K.IDX_RT_BP) / 1e4;

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "nq10", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const { q } = mkStrictRead(OWNED, hdr);

async function loadNq(): Promise<Bar[]> {
  const rows = await q(`trd_fx_hourly?symbol=eq.USATECHIDXUSD&select=ts,o,h,l,c,vol&order=ts.asc`) as
    { ts: number; o: number; h: number; l: number; c: number; vol: number }[];
  return rows.filter((r) => r.h !== r.l).map((r) => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, v: r.vol }));
}

// US DST: 2nd Sunday of March 02:00 → 1st Sunday of November 02:00
function isDstUS(ts: number): boolean {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  // 2nd Sunday of March
  const mar = new Date(Date.UTC(y, 2, 1));
  const marOffset = (7 - mar.getUTCDay()) % 7 + 7;   // 1st Sun offset + 7 = 2nd Sun day-of-month (1-indexed then +offset)
  const dstStart = Date.UTC(y, 2, 1 + marOffset - 1 + 0, 7);   // 07:00 UTC (2AM ET)
  // 1st Sunday of November
  const nov = new Date(Date.UTC(y, 10, 1));
  const novOffset = (7 - nov.getUTCDay()) % 7;
  const dstEnd = Date.UTC(y, 10, 1 + novOffset, 6);   // 06:00 UTC (2AM ET during EDT)
  const t = ts * 1000;
  return t >= dstStart && t < dstEnd;
}
function tenAmEtUtcHour(ts: number): number { return isDstUS(ts) ? 14 : 15; }
const utcHour = (ts: number) => new Date(ts * 1000).getUTCHours();
const utcDayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const dow = (ts: number) => new Date(ts * 1000).getUTCDay();   // 0=Sun

const bars = await loadNq();
assertNonEmpty("nq bars", bars, 20000);
console.log(`==> MTF NQ 10AM ET — ${bars.length} 1h bars (h!=l, drops synthetic closed-session bars) from ${utcDayKey(bars[0].ts)} to ${utcDayKey(bars[bars.length - 1].ts)}`);

// index by ts for quick lookup
const tsIdx = new Map<number, number>(); bars.forEach((b, i) => tsIdx.set(b.ts, i));

// build per-UTC-day rolling PDH/PDL known AT the start of each day (i.e. from bars of yesterday's UTC day)
// and per-session (asia 00-08, london 07-16) high/low known when that session closes
interface DayLevel { pdh: number; pdl: number }
const dayHiLo = new Map<string, { hi: number; lo: number }>();
for (const b of bars) {
  const k = utcDayKey(b.ts);
  const cur = dayHiLo.get(k);
  if (!cur) dayHiLo.set(k, { hi: b.h, lo: b.l });
  else { cur.hi = Math.max(cur.hi, b.h); cur.lo = Math.min(cur.lo, b.l); }
}
function prevDayKey(k: string): string { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

// pick the "10AM ET" bar per US trading day (Mon-Fri, and not a suspiciously-flat day)
interface Ev {
  ts: number; day: string; ampm14or15: 14 | 15;
  entryOpen: number; entryClose: number; entryHigh: number; entryLow: number;
  pdh: number; pdl: number;
  asiaHi: number; asiaLo: number;
  londonHiSoFar: number; londonLoSoFar: number;
  distPdhBp: number; distPdlBp: number;
  brokePdh: boolean; brokePdl: boolean; sweptPdhReclaim: boolean; sweptPdlReclaim: boolean;
  green: boolean; bodyBp: number; upperWickBp: number; lowerWickBp: number;
  fwdK1: number; fwdK3: number; fwdK6: number;      // net-of-cost log returns from entry CLOSE
  fwdToNy16: number;                                 // close-to-close from 10AM to 21:00 UTC (EDT) / 22:00 UTC (EST) - approx 4PM ET
}
const evs: Ev[] = [];
for (let i = 30; i < bars.length - 12; i++) {
  const b = bars[i];
  const hr = utcHour(b.ts);
  const wantHr = tenAmEtUtcHour(b.ts);
  if (hr !== wantHr) continue;
  const dow_ = dow(b.ts);
  if (dow_ === 0 || dow_ === 6) continue;               // weekends
  // PDH/PDL from prior UTC day (known)
  const pdk = prevDayKey(utcDayKey(b.ts));
  const pd = dayHiLo.get(pdk); if (!pd) continue;
  // asia session (00-08 UTC of TODAY) high/low — closed by 10AM ET (14/15 UTC)
  let asiaHi = -Infinity, asiaLo = Infinity;
  for (let j = i - 1; j >= 0 && utcDayKey(bars[j].ts) === utcDayKey(b.ts); j--) {
    if (utcHour(bars[j].ts) < 8) { asiaHi = Math.max(asiaHi, bars[j].h); asiaLo = Math.min(asiaLo, bars[j].l); }
  }
  // london-so-far (07-16 UTC of today) up to but not including b's bar
  let lonHi = -Infinity, lonLo = Infinity;
  for (let j = i - 1; j >= 0 && utcDayKey(bars[j].ts) === utcDayKey(b.ts); j--) {
    if (utcHour(bars[j].ts) >= 7) { lonHi = Math.max(lonHi, bars[j].h); lonLo = Math.min(lonLo, bars[j].l); }
  }
  if (!isFinite(asiaHi) || !isFinite(lonHi)) continue;

  const entryOpen = b.o, entryClose = b.c, entryHigh = b.h, entryLow = b.l;
  const brokePdh = entryClose > pd.hi + SWEEP_TOL * pd.hi;
  const brokePdl = entryClose < pd.lo - SWEEP_TOL * pd.lo;
  const sweptPdhReclaim = entryHigh > pd.hi && entryClose <= pd.hi;   // wicked above then closed back
  const sweptPdlReclaim = entryLow < pd.lo && entryClose >= pd.lo;   // wicked below then reclaimed

  // forward closes at K1/K3/K6 and 4PM ET (21:00 UTC EDT = i + (21-14) = i+7; 22:00 UTC EST = i + (22-15) = i+7 → same offset 7)
  const kIdx = (k: number) => i + k;
  if (kIdx(6) >= bars.length) continue;
  const fwdK1 = Math.log(bars[kIdx(1)].c / entryClose);
  const fwdK3 = Math.log(bars[kIdx(3)].c / entryClose);
  const fwdK6 = Math.log(bars[kIdx(6)].c / entryClose);
  const fwdToNy16 = Math.log(bars[kIdx(6)].c / entryClose);   // approx to 4PM ET
  const bodyBp = Math.abs(entryClose - entryOpen) / entryOpen * 1e4;
  const upperWickBp = (entryHigh - Math.max(entryOpen, entryClose)) / entryOpen * 1e4;
  const lowerWickBp = (Math.min(entryOpen, entryClose) - entryLow) / entryOpen * 1e4;
  evs.push({
    ts: b.ts, day: utcDayKey(b.ts), ampm14or15: wantHr as 14 | 15,
    entryOpen, entryClose, entryHigh, entryLow,
    pdh: pd.hi, pdl: pd.lo, asiaHi, asiaLo, londonHiSoFar: lonHi, londonLoSoFar: lonLo,
    distPdhBp: (entryClose - pd.hi) / pd.hi * 1e4,
    distPdlBp: (entryClose - pd.lo) / pd.lo * 1e4,
    brokePdh, brokePdl, sweptPdhReclaim, sweptPdlReclaim,
    green: entryClose > entryOpen, bodyBp, upperWickBp, lowerWickBp,
    fwdK1, fwdK3, fwdK6, fwdToNy16,
  });
}
console.log(`  10AM ET bars extracted: ${evs.length} (weekdays only, non-synthetic bars, ~1200-2400 typical for 10 years)`);
console.log(`  variant counts: 14:00 UTC (EDT) ${evs.filter((e) => e.ampm14or15 === 14).length}, 15:00 UTC (EST) ${evs.filter((e) => e.ampm14or15 === 15).length}`);

function stats(xs: number[]) {
  const n = xs.length; if (n === 0) return { n: 0, mean: 0, t: 0, sd: 0 };
  const m = xs.reduce((a, c) => a + c, 0) / n;
  const s2 = n > 1 ? xs.reduce((a, c) => a + (c - m) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(s2);
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : 0, sd };
}
const bp = (x: number) => (x * 1e4).toFixed(2);
const winPct = (xs: number[]) => xs.length ? (xs.filter((x) => x > 0).length / xs.length * 100).toFixed(0) : "-";

// D1: pure 10AM ET bar characteristics
console.log(`\n  D1 10AM ET BAR — pure descriptive averages`);
{
  const green = evs.filter((e) => e.green).length;
  const bodyAvg = stats(evs.map((e) => e.bodyBp)).mean;
  const upperAvg = stats(evs.map((e) => e.upperWickBp)).mean;
  const lowerAvg = stats(evs.map((e) => e.lowerWickBp)).mean;
  console.log(`     bars green: ${green}/${evs.length} = ${(green / evs.length * 100).toFixed(1)}%  (50% = random)`);
  console.log(`     avg body ${bodyAvg.toFixed(1)}bp, avg upper wick ${upperAvg.toFixed(1)}bp, avg lower wick ${lowerAvg.toFixed(1)}bp`);
}

// D2: unconditional forward returns from 10AM close
console.log(`\n  D2 FORWARD RETURNS from 10AM ET close (unconditional, ALL 10AM bars)`);
for (const [tag, xs] of [
  ["+1h", evs.map((e) => e.fwdK1)],
  ["+3h", evs.map((e) => e.fwdK3)],
  ["+6h ≈ 4PM ET", evs.map((e) => e.fwdK6)],
] as const) {
  const s = stats(xs);
  console.log(`     ${tag.padEnd(15)} n ${String(s.n).padStart(5)} / mean ${bp(s.mean).padStart(7)}bp / t ${s.t.toFixed(2).padStart(6)} / win% ${winPct(xs)}`);
}

// D3: conditional on 10AM bar direction (continuation vs reversal)
console.log(`\n  D3 CONDITIONAL ON 10AM BAR DIRECTION (does the direction PERSIST or FADE for the rest of the day)`);
for (const dir of ["green", "red"] as const) {
  const cell = evs.filter((e) => (dir === "green") === e.green);
  const fwd = cell.map((e) => e.fwdK6);
  const signed = cell.map((e) => (dir === "green" ? 1 : -1) * e.fwdK6);  // +ve = continues in bar direction
  const s = stats(fwd), sSigned = stats(signed);
  console.log(`     ${dir.padEnd(6)} bars n ${cell.length}  6h fwd mean ${bp(s.mean).padStart(7)}bp t ${s.t.toFixed(2).padStart(6)}   |  in-direction mean ${bp(sSigned.mean).padStart(7)}bp t ${sSigned.t.toFixed(2).padStart(6)}`);
}

// D4: LEVELS — where is 10AM close relative to PDH/PDL?
console.log(`\n  D4 POSITION RELATIVE TO PDH/PDL`);
const bucket = [
  ["above PDH (broke)", (e: Ev) => e.brokePdh],
  ["swept PDH & reclaimed", (e: Ev) => e.sweptPdhReclaim],
  ["between PDH and PDL", (e: Ev) => !e.brokePdh && !e.brokePdl && !e.sweptPdhReclaim && !e.sweptPdlReclaim],
  ["swept PDL & reclaimed", (e: Ev) => e.sweptPdlReclaim],
  ["below PDL (broke)", (e: Ev) => e.brokePdl],
] as const;
for (const [name, fn] of bucket) {
  const cell = evs.filter(fn);
  const s = stats(cell.map((e) => e.fwdK6));
  console.log(`     ${name.padEnd(28)} n ${String(cell.length).padStart(4)}  6h mean ${bp(s.mean).padStart(7)}bp t ${s.t.toFixed(2).padStart(6)}   win% ${winPct(cell.map((e) => e.fwdK6))}`);
}

// D5: sweep-and-fade hypothesis at 10AM
console.log(`\n  D5 SWEEP-AND-FADE at 10AM ET — if 10AM sweeps PDH/PDL then reclaims, does the FADE (opposite of sweep direction) work?`);
{
  // sweep of PDH (wicked above then closed back below PDH) — hypothesis: SHORT for 6h
  const swpH = evs.filter((e) => e.sweptPdhReclaim);
  const shortNet = swpH.map((e) => -e.fwdK6 - rt);
  const sH = stats(shortNet);
  console.log(`     PDH sweep & reclaim -> SHORT 6h    n ${sH.n}  mean ${bp(sH.mean).padStart(7)}bp (net of ${(rt * 1e4).toFixed(0)}bp RT) t ${sH.t.toFixed(2)}  win% ${winPct(shortNet)}`);
  const swpL = evs.filter((e) => e.sweptPdlReclaim);
  const longNet = swpL.map((e) => e.fwdK6 - rt);
  const sL = stats(longNet);
  console.log(`     PDL sweep & reclaim -> LONG 6h     n ${sL.n}  mean ${bp(sL.mean).padStart(7)}bp (net of ${(rt * 1e4).toFixed(0)}bp RT) t ${sL.t.toFixed(2)}  win% ${winPct(longNet)}`);
}

// D6: asia H/L context at 10AM
console.log(`\n  D6 ASIA SESSION LEVEL context at 10AM ET`);
{
  const aboveAsiaH = evs.filter((e) => e.entryClose > e.asiaHi);
  const belowAsiaL = evs.filter((e) => e.entryClose < e.asiaLo);
  const inside = evs.filter((e) => e.entryClose >= e.asiaLo && e.entryClose <= e.asiaHi);
  for (const [name, cell] of [["10AM above asiaH", aboveAsiaH], ["10AM inside asia range", inside], ["10AM below asiaL", belowAsiaL]] as const) {
    const s = stats(cell.map((e) => e.fwdK6));
    console.log(`     ${name.padEnd(28)} n ${String(cell.length).padStart(4)}  6h mean ${bp(s.mean).padStart(7)}bp t ${s.t.toFixed(2).padStart(6)}   win% ${winPct(cell.map((e) => e.fwdK6))}`);
  }
}

// D7: era stability of the D2 unconditional
console.log(`\n  D7 UNCONDITIONAL 6h FORWARD BY YEAR (is any pattern era-stable?)`);
for (const yr of [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]) {
  const cell = evs.filter((e) => new Date(e.ts * 1000).getUTCFullYear() === yr);
  if (!cell.length) continue;
  const s = stats(cell.map((e) => e.fwdK6));
  console.log(`     ${yr}  n ${String(cell.length).padStart(4)}  mean ${bp(s.mean).padStart(7)}bp  t ${s.t.toFixed(2).padStart(6)}   win% ${winPct(cell.map((e) => e.fwdK6))}`);
}

console.log(`\n  ================================ VERDICT ================================`);
console.log(`  10AM ET NQ analysis is DESCRIPTIVE — no forward clock, no promotion. If any D5 cell (sweep+reclaim`);
console.log(`  fade) shows |t| >= 2 with era stability and win% >= 55, it warrants pre-registration with operator`);
console.log(`  sign-off. All numbers are gross-of-cost except D5 (which explicitly subtracts the ${(rt * 1e4).toFixed(0)}bp RT).`);
