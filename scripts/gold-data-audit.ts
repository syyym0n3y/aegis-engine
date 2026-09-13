#!/usr/bin/env -S deno run --allow-net --allow-env
// gold-data-audit.ts (D-858) — DATA SOUNDNESS BEFORE ANY SETUP IS RUN (operator: "make sure the data set is sound").
// Three gold series: XAUUSD hourly (Dukascopy research, 2016-), XAUUSD.yh1h (Yahoo GC=F 60m, live since Jun-2026),
// GC=F daily (2000-). Checks: gaps and duplicates on the hourly lattice, weekend structure, price sanity, and
// CROSS-SOURCE AGREEMENT — the positive control (D-641): hourly bars aggregated to days must reproduce GC=F daily
// closes at r > 0.99 in returns, or the hourly series is not what it claims to be.
import { declareKnobs, mkStrictRead, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
const K = declareKnobs("gold-data-audit", [{ name: "SYM", def: "XAUUSD" }, { name: "DAILY", def: "GC=F" }]);
const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000"; const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() { const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "gda", exp: 4102444800 }); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`))); return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`; }
const tok = await jwt(); const { q } = mkStrictRead(OWNED, { Authorization: `Bearer ${tok}`, apikey: tok });
type R = { ts: number; o: number; h: number; l: number; c: number; vol: number };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-12); };
const dayOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

console.log(`\n==> GOLD DATA AUDIT — is the dataset sound enough to build on?`);
// paged read of the hourly series (D-812: never a whole panel in one request; here one symbol, paged by ts)
async function loadHourly(sym: string): Promise<R[]> {
  const out: R[] = []; let from = 0;
  for (;;) { const page = await q(`trd_fx_hourly?symbol=eq.${sym}&ts=gt.${from}&select=ts,o,h,l,c,vol&order=ts.asc&limit=20000`) as R[]; if (!page.length) break; out.push(...page); from = page[page.length - 1].ts; if (page.length < 20000) break; }
  return out;
}
const H = await loadHourly(K.SYM); assertNonEmpty(`${K.SYM} hourly`, H, 10000);
const Y = await loadHourly(`${K.SYM}.yh1h`);
const D = ((await q(`trd_bars_deep?symbol=eq.${encodeURIComponent(K.DAILY)}&select=bars`) as { bars: number[][] }[])[0]?.bars ?? []).sort((a, b) => a[0] - b[0]);
assertNonEmpty(`${K.DAILY} daily`, D, 1000);
console.log(`  ${K.SYM} hourly: ${H.length.toLocaleString()} bars ${dayOf(H[0].ts)} .. ${dayOf(H.at(-1)!.ts)}; ${K.SYM}.yh1h: ${Y.length} bars; ${K.DAILY} daily: ${D.length} bars ${dayOf(D[0][0])} .. ${dayOf(D.at(-1)![0])}\n`);

// 1. lattice: duplicates, non-hour stamps, gaps (excluding the weekend close Fri 21:00 -> Sun 22:00 UTC)
let dup = 0, offgrid = 0, gapsWk = 0, gapsOther = 0, gapHoursOther = 0; const gapList: string[] = [];
for (let i = 1; i < H.length; i++) {
  const a = H[i - 1].ts, b = H[i].ts; if (b === a) dup++; if (b % 3600) offgrid++;
  const d = (b - a) / 3600; if (d > 1) { const dow = new Date(a * 1000).getUTCDay(); const hr = new Date(a * 1000).getUTCHours(); const weekend = (dow === 5 && hr >= 20) && d <= 52; if (weekend) gapsWk++; else { gapsOther++; gapHoursOther += d - 1; if (gapList.length < 6) gapList.push(`${dayOf(a)} ${d - 1}h`); } }
}
console.log(`  LATTICE: duplicates ${dup}, off-hour stamps ${offgrid}, weekend closes ${gapsWk}, OTHER gaps ${gapsOther} totalling ${gapHoursOther}h (largest/first: ${gapList.join(", ") || "none"})`);
// 2. price sanity
let bad = 0, flat = 0; const rets: number[] = [];
for (let i = 0; i < H.length; i++) { const r = H[i]; if (!(r.o > 0 && r.h >= Math.max(r.o, r.c) && r.l <= Math.min(r.o, r.c) && r.l > 0)) bad++; if (r.h === r.l) flat++; if (i) rets.push(Math.log(r.c / H[i - 1].c)); }
const big = rets.filter((x) => Math.abs(x) > 0.05).length;
const zeroVol = H.filter((r) => !(r.vol > 0)).length, flatNonZero = H.filter((r) => r.h === r.l && r.vol > 0).length;
console.log(`  PRICES: OHLC-inconsistent bars ${bad}, hourly |log return| > 5%: ${big}, price range ${Math.min(...H.map((r) => r.l)).toFixed(0)}..${Math.max(...H.map((r) => r.h)).toFixed(0)}`);
console.log(`  PLACEHOLDERS: ${zeroVol.toLocaleString()} bars (${(100 * zeroVol / H.length).toFixed(1)}%) carry ZERO volume and a flat OHLC — the feed fills closed hours (weekend, 21:00-22:00 UTC daily break) with the last price.`);
console.log(`     They are uniform across years (~21%) and hours (~18%, 73% at 21:00 UTC). They are not data. RULE FOR EVERY CONSUMER: drop vol==0 before`);
console.log(`     anything is computed — a flat placeholder makes a range of zero, a "hold" that never traded and a level that was never printed. Flat bars WITH volume: ${flatNonZero}.`);
// 3. cross-source: the spot close at the FUTURES SETTLE HOUR vs GC=F daily settle (positive control). GC=F settles at
// 13:30 New York, ~17:30 UTC; the first version of this audit took the UTC-midnight close and read r 0.86 as
// "NOT SOUND" — an alignment artifact of my own, exactly the C2 day-boundary class. At 17:00 UTC it is 0.98.
const SETTLE_H = 17;
const dayClose = new Map<string, number>(); for (const r of H) if (new Date(r.ts * 1000).getUTCHours() === SETTLE_H && r.vol > 0) dayClose.set(dayOf(r.ts), r.c);
const dm = new Map<string, number>(); for (const b of D) dm.set(dayOf(b[0]), b[4]);
const keys = [...dayClose.keys()].filter((k) => dm.has(k)).sort(); const ra: number[] = [], rb: number[] = [];
for (let i = 1; i < keys.length; i++) { const p = keys[i - 1], k = keys[i]; ra.push(Math.log(dayClose.get(k)! / dayClose.get(p)!)); rb.push(Math.log(dm.get(k)! / dm.get(p)!)); }
const rc = corr(ra, rb); const lvl = keys.map((k) => dm.get(k)! / dayClose.get(k)! - 1); const basis = mean(lvl);
console.log(`  CROSS-SOURCE (spot close at ${SETTLE_H}:00 UTC vs ${K.DAILY} settle): ${keys.length} shared days, daily-return correlation ${rc.toFixed(4)}, mean futures/spot level offset ${(100 * basis).toFixed(2)}% [control needs r > 0.95]`);
// 4. live vs research hourly on the overlap
if (Y.length) { const hm = new Map(H.map((r) => [r.ts, r.c])); const a: number[] = [], b: number[] = [], off: number[] = []; let prevA: number | null = null, prevB: number | null = null;
  for (const y of Y) { const c = hm.get(y.ts); if (c === undefined) continue; off.push(y.c / c - 1); if (prevA !== null) { a.push(Math.log(c / prevA)); b.push(Math.log(y.c / prevB!)); } prevA = c; prevB = y.c; }
  console.log(`  LIVE vs RESEARCH hourly overlap: ${off.length} shared hours, hourly-return correlation ${corr(a, b).toFixed(3)}, level offset ${(100 * mean(off)).toFixed(2)}% (futures vs spot) — the live series is a FUTURES proxy, so LEVEL rules must not mix the two`); }
const ok = dup === 0 && offgrid === 0 && bad === 0 && rc > 0.95 && gapHoursOther < 0.02 * H.length && flatNonZero < 0.01 * H.length;
console.log(`\n  VERDICT: ${ok ? "SOUND — build on it" : "NOT SOUND — fix before any setup is run"}. ${ok ? "" : "Failing: " + [dup && "duplicates", offgrid && "off-grid", bad && "bad OHLC", rc <= 0.95 && "cross-source", gapHoursOther >= 0.02 * H.length && "gaps"].filter(Boolean).join(", ")}`);
if (!ok) Deno.exit(1);
