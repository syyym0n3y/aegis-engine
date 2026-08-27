#!/usr/bin/env -S deno run --allow-net --allow-env
// shortvol-surprise.ts (D-624)
// MAINTENANCE NOTE: this file was DERIVED from ftd-persistence.ts. Derived scripts do not inherit later fixes to
// their source — the D-627 absolute diagnostic was added to the parent and silently missing here, which produced a
// run that looked complete and answered a different question than intended. Any fix to the parent must be checked
// against this file. — the only MECHANICAL forced-flow event in any dataset we hold.
//
// Everything tested on this board is a statistical tendency: a signal that has historically preceded returns.
// Reg SHO close-out is different in kind — once a security persists on the threshold list, brokers are REQUIRED to
// buy in the fail after 13 settlement days. That is compelled flow on a regulatory deadline, and mechanisms with
// deadlines are exactly where an effect can survive after the statistical ones have been arbitraged away.
//
// trd_ftd covers 39,316 symbols daily across 2018-2026 (10,787,275 rows). The board uses only a LEVEL signal
// (ftd_stress = -fails/shares). PERSISTENCE — the thing Reg SHO actually keys on — has never been tested.
//
// THE CONSTRAINT THAT PROBABLY DECIDES IT, pre-registered as the expected outcome: the SEC publishes FTD data
// TWICE MONTHLY with a 15-30 day lag, while the close-out deadline is ~18 calendar days. The forced buying is
// therefore COMPLETE BEFORE THE DATA IS PUBLIC. Returns are measured from the publication date (conservatively
// settle + 30 days), never from the settle date, because measuring from settle would be a look-ahead of exactly the
// kind that has produced this programme's retractions.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";
import { bySymbol } from "../supabase/functions/_shared/paged-fetch.ts";
import { stampDataVersion } from "../supabase/functions/_shared/data-version.ts";

const K = declareKnobs("shortvol-surprise", [
  { name: "PUB_LAG_D", def: "30", note: "calendar days from settle_date to public availability" },
  { name: "PERSIST_D", def: "5", note: "consecutive settle dates with elevated fails" },
  { name: "HOLD_D", def: "20", note: "sessions held from publication" },
  { name: "COST_BP", def: "25", note: "round trip; fails concentrate in small caps" },
  { name: "BUCKETS", def: "4" },
  { name: "LIQUID_ONLY", def: "", note: "1 = liquid half, the confound control" },
  { name: "LIQ_HALF", def: "", note: "D-634: hi | lo — measure a liquidity half DIRECTLY. Without a counterpart the illiquid half was never measurable at all, and D-633 showed the two halves can carry OPPOSITE signs." },
  { name: "MIN_NAMES", def: "50", note: "per rebalance" },
  { name: "FROM_D", def: "", note: "D-618: restrict to publication dates >= this, for era stability" },
  { name: "UNTIL_D", def: "", note: "D-618: restrict to publication dates < this" },
  { name: "MIN_PERIODS", def: "20", note: "lowered only for deliberately short era windows" },
  { name: "SIGCOMP", def: "both", note: "D-621: both = runLen x failRatio | persist = runLen only | surprise = failRatio only" },
  { name: "VOLCTRL", def: "", note: "D-623: 1 = rank by VOLUME spike vs own 60d median instead of fails (matched control)" },
  { name: "DUMP", def: "", note: "path to write per-period returns" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "sv", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const plus = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const bd = await fetch(`${OWNED}/trd_bars_deep?select=symbol`, { headers: hdr }).then((r) => r.json()).catch(() => []) as { symbol: string }[];
const priced = new Set((Array.isArray(bd) ? bd : []).map((x) => x.symbol));
assertNonEmpty("priced symbols", [...priced], 500);

// D-624: SHORT VOLUME instead of fails. Same shape — a daily quantity per symbol — so the surprise construction
// (today vs the name's own trailing 60-day median) transfers exactly. short_vol/total_vol is the standard ratio and
// is what the board's existing svr_* specs use.
// D-629: this loop used to page the WHOLE 19,173,126-row table with `order=d&offset=${off}`, then discard most of
// it client-side with `if (!priced.has(...)) continue`. Two compounding defects: OFFSET pagination is quadratic
// (measured 0.22s at offset 0 rising to 1.91s at 15M, several billion discarded row-scans across ~380 pages), and
// only 5,822,317 rows (30.4%) belong to priced symbols, so ~70% of a ~1GB transfer was fetched and thrown away.
// Asking the database for the symbols we actually want uses the (symbol, d) index and removes the offset entirely.
const ftd = new Map<string, { d: string; q: number }[]>();
await bySymbol({
  rest: OWNED, headers: hdr, table: "trd_short_volume",
  select: "symbol,d,short_vol,total_vol",
  symbols: [...priced], orderBy: "symbol,d",
  onPage: (rows) => {
    for (const r of rows as unknown as { symbol: string; d: string; short_vol: number; total_vol: number }[]) {
      const tv = +r.total_vol, sv = +r.short_vol;
      if (!(tv > 0) || !(sv >= 0)) continue;
      const ratio = sv / tv; if (!Number.isFinite(ratio) || ratio <= 0) continue;
      (ftd.get(r.symbol) ?? ftd.set(r.symbol, []).get(r.symbol)!).push({ d: r.d, q: ratio });
    }
  },
});
// The surprise construction needs each name's own history in date order; server-side batching returns per symbol,
// so sort explicitly rather than relying on arrival order.
for (const arr of ftd.values()) arr.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
assertNonEmpty("symbols with short volume and prices", [...ftd.keys()], 200);

// Prices
const px = new Map<string, { d: string[]; c: number[]; v: number[] }>();
const need = [...ftd.keys()];
for (let i = 0; i < need.length; i += 40) {
  const part = need.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; bars: unknown }[];
  for (const r of Array.isArray(rows) ? rows : []) {
    const raw = r.bars as (number | string)[][]; if (!Array.isArray(raw) || raw.length < 300) continue;
    const d: string[] = [], c: number[] = [], v: number[] = [];
    for (const b of raw) {
      const dd = typeof b[0] === "string" ? String(b[0]).slice(0, 10) : new Date(Number(b[0]) * 1000).toISOString().slice(0, 10);
      const cc = Number(b[4]), vv = Number(b[5]);
      if (cc > 0) { d.push(dd); c.push(cc); v.push(Number.isFinite(vv) ? vv : 0); }
    }
    if (d.length > 300) px.set(r.symbol, { d, c, v });
  }
}
assertNonEmpty("priced FTD symbols", [...px.keys()], 200);

const LAG = Number(K.PUB_LAG_D), PERSIST = Number(K.PERSIST_D), HOLD = Number(K.HOLD_D);
const COST = Number(K.COST_BP) / 1e4, NB = Number(K.BUCKETS), MINN = Number(K.MIN_NAMES);
const idxAt = (s: string, d: string) => { const p = px.get(s)!; let lo = 0, hi = p.d.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { at = m; lo = m + 1; } else hi = m - 1; } return at; };

// For each symbol, find runs of consecutive settle dates with fails, and score PERSISTENCE as the run length at
// each point. The event is the END of a qualifying run — the moment Reg SHO close-out pressure would peak.
interface Ev { s: string; pubD: string; runLen: number; failRatio: number }
const evs: Ev[] = [];
for (const [s, arr] of ftd) {
  arr.sort((a, b) => a.d < b.d ? -1 : 1);
  let run = 1;
  for (let i = 1; i < arr.length; i++) {
    // consecutive settle dates = within 5 calendar days (weekends)
    const gap = (Date.parse(arr[i].d) - Date.parse(arr[i - 1].d)) / 86400000;
    run = gap <= 5 ? run + 1 : 1;
    if (run >= PERSIST) {
      const med = arr.slice(Math.max(0, i - 60), i).map((x) => x.q).sort((a, b) => a - b);
      const base = med.length ? med[Math.floor(med.length / 2)] : arr[i].q;
      evs.push({ s, pubD: plus(arr[i].d, LAG), runLen: run, failRatio: base > 0 ? arr[i].q / base : 1 });
      run = 1;   // one event per run, no overlapping duplicates
    }
  }
}
assertNonEmpty("persistence events", evs, 500);

// Group events by publication month so the portfolio statistic is a time series, never an event-level t.
const byM = new Map<string, Ev[]>();
for (const e of evs) (byM.get(e.pubD.slice(0, 7)) ?? byM.set(e.pubD.slice(0, 7), []).get(e.pubD.slice(0, 7))!).push(e);

const periodRets: number[] = [];
const bucketRets: number[][] = Array.from({ length: NB }, () => []);
let breadth = 0, periods = 0;
for (const [mkey, group] of [...byM.entries()].sort()) {
  if (K.FROM_D && mkey < K.FROM_D.slice(0, 7)) continue;
  if (K.UNTIL_D && mkey >= K.UNTIL_D.slice(0, 7)) continue;
  const cands: { sig: number; ret: number; dvol: number }[] = [];
  for (const e of group) {
    const p = px.get(e.s); if (!p) continue;
    const i0 = idxAt(e.s, e.pubD), i1 = i0 + HOLD;
    if (i0 < 40 || i1 >= p.d.length) continue;
    const r = p.c[i1] / p.c[i0] - 1;
    if (!Number.isFinite(r) || Math.abs(r) > 3) continue;
    let dv = 0, k = 0;
    for (let j = i0 - 40; j < i0; j++) if (p.v[j] > 0) { dv += p.c[j] * p.v[j]; k++; }
    // D-621: decompose the composite. runLen is raw persistence; failRatio is how anomalous the fail is versus the
    // name's OWN 60-day baseline. The liquidity result (stronger in liquid names) fits the second better than the first.
    let sigv = K.SIGCOMP === "persist" ? e.runLen : K.SIGCOMP === "surprise" ? e.failRatio : e.runLen * e.failRatio;
    if (K.VOLCTRL === "1") {
      // D-623 MATCHED CONTROL: identical events, dates, holds and costs — rank on today's VOLUME relative to the
      // name's own trailing 60-session median, the exact analogue of failRatio computed on volume instead of fails.
      const vw: number[] = [];
      for (let j = Math.max(0, i0 - 60); j < i0; j++) if (p.v[j] > 0) vw.push(p.v[j]);
      if (vw.length < 20) continue;
      vw.sort((a, b2) => a - b2);
      const vmed = vw[Math.floor(vw.length / 2)];
      const vnow = p.v[i0] > 0 ? p.v[i0] : vmed;
      sigv = vmed > 0 ? vnow / vmed : 1;
    }
    cands.push({ sig: sigv, ret: r, dvol: k ? dv / k : 0 });
  }
  if (cands.length < MINN) continue;
  let pool = cands;
  // D-634: same one-sided-filter defect as D-633. LIQUID_ONLY kept the top half and offered no way to ask for the
  // bottom, so the illiquid half of this signal had never been measured — only inferred. On the fails book that
  // inference turned out to be wrong in SIGN.
  const wantHalf = K.LIQ_HALF === "hi" || K.LIQ_HALF === "lo" ? K.LIQ_HALF : (K.LIQUID_ONLY === "1" ? "hi" : "");
  if (wantHalf) {
    const med = [...pool.map((x) => x.dvol)].sort((a, b) => a - b)[Math.floor(pool.length / 2)];
    pool = wantHalf === "hi" ? pool.filter((x) => x.dvol >= med) : pool.filter((x) => x.dvol < med);
    if (pool.length < MINN / 2) continue;
  }
  pool.sort((a, b) => a.sig - b.sig);
  const per = Math.floor(pool.length / NB); if (per < 10) continue;
  for (let q = 0; q < NB; q++) bucketRets[q].push(mean(pool.slice(q * per, (q + 1) * per).map((x) => x.ret)));
  // Book: LONG the most persistent fails (the pre-registered direction), short the least.
  periodRets.push(mean(pool.slice(-per).map((x) => x.ret)) - mean(pool.slice(0, per).map((x) => x.ret)) - 2 * COST);
  breadth += pool.length; periods++;
}
assertNonEmpty("monthly periods", periodRets, Number(K.MIN_PERIODS));
if (K.DUMP) {
  const dk = [...byM.keys()].sort().filter((m2) => (!K.FROM_D || m2 >= K.FROM_D.slice(0, 7)) && (!K.UNTIL_D || m2 < K.UNTIL_D.slice(0, 7)));
  await Deno.writeTextFile(K.DUMP, periodRets.map((r, i) => `${dk[i] ?? i}\t${r}`).join("\n"));
}

const m = mean(periodRets), s2 = sd(periodRets) || 1e-12;
const tPort = m / (s2 / Math.sqrt(periodRets.length));
console.log(`\n==> SHORT-VOLUME SURPRISE — measured from PUBLICATION (settle + ${LAG}d), not settle date`);
console.log(`    ${evs.length.toLocaleString()} persistence events (run >= ${PERSIST} consecutive fail days), ${periodRets.length} monthly periods, mean breadth ${(breadth / periods).toFixed(0)}${(K.LIQ_HALF === "hi" || K.LIQUID_ONLY === "1") ? ", LIQUID HALF" : K.LIQ_HALF === "lo" ? ", ILLIQUID HALF" : ""}`);
console.log(`    ${HOLD}-session return by persistence bucket (b0 = least persistent -> b${NB - 1} = most):`);
for (let q = 0; q < NB; q++) console.log(`      b${q}  ${(mean(bucketRets[q]) * 100).toFixed(3)}%`);
const monotone = bucketRets.every((_, q) => q === 0 || mean(bucketRets[q]) >= mean(bucketRets[q - 1]));
console.log(`    monotone INCREASING in persistence (the prediction): ${monotone ? "YES" : "NO"}`);
// D-627 ABSOLUTE DIAGNOSTIC — THE BENCHMARK LAW. A long-short spread says nothing about whether either LEG is
// viable alone. If every bucket earns a positive return, the short leg loses money standalone and the book requires
// the long leg to fund it. Report the extreme bucket against the cross-sectional mean of the SAME periods.
{
  const universe = bucketRets[0].map((_, i) => mean(bucketRets.map((b2) => b2[i])));
  const hi = bucketRets[NB - 1], lo = bucketRets[0];
  const excessHi = hi.map((v, i) => v - universe[i]);
  const negPeriods = hi.filter((v) => v < 0).length;
  const tEx = mean(excessHi) / ((sd(excessHi) / Math.sqrt(excessHi.length)) || 1e-12);
  console.log(`\n    ABSOLUTE DIAGNOSTIC (Benchmark Law):`);
  console.log(`      universe mean (all buckets)      ${(mean(universe) * 100).toFixed(3)}% per ${HOLD} sessions`);
  console.log(`      HIGH-surprise bucket raw         ${(mean(hi) * 100).toFixed(3)}%   negative in ${negPeriods}/${hi.length} periods (${(100 * negPeriods / hi.length).toFixed(0)}%)`);
  console.log(`      HIGH-surprise EXCESS vs universe ${(mean(excessHi) * 100).toFixed(3)}%   t ${tEx.toFixed(2)}`);
  console.log(`      LOW-surprise bucket raw          ${(mean(lo) * 100).toFixed(3)}%`);
  console.log(`      => short leg standalone is ${mean(hi) > 0 ? "LOSS-MAKING (bucket rises); the book needs the long leg" : "profitable standalone"}`);
}
console.log(`\n    BOOK long-most-persistent: ${(m * 12 * 100).toFixed(2)}%/yr  PORTFOLIO t ${tPort.toFixed(2)}  [bar: t >= 2.0, POSITIVE]`);
const supported = tPort >= 2.0 && monotone;
console.log(`\n    ${supported ? "SUPPORTED — close-out pressure is still capturable at publication." :
  tPort <= -2.0 ? "SIGN MISS — persistent fails predict UNDERPERFORMANCE (competing explanation b: shorts are right)." :
  `NOT SUPPORTED — portfolio |t| ${Math.abs(tPort).toFixed(2)}${monotone ? "" : ", not monotone"}. Consistent with (a): the forced buying completes before the data is public.`}`);

// D-635: pin the number to the data it was computed on. D-622's -9.69%/yr does not reproduce (-9.56%/yr today) and
// the cause cannot be established, because no recorded result stated its data version. Prices are not append-only —
// vendors restate splits and adjusted closes retroactively — so "the same query" legitimately returns different
// history over time. Without this stamp a reader who gets a different number cannot tell whose mistake it is.
await stampDataVersion(OWNED, hdr, { trd_short_volume: "d", trd_bars_deep: "updated_at" });
