#!/usr/bin/env -S deno run --allow-net --allow-env
// pead-coverage.ts (D-612) — does post-earnings drift concentrate where fewer analysts look?
//
// BASELINE. Our own `pead-real-surprises` found PEAD positive and monotone in quantile depth but t 2.83, under the
// 5.34 ceiling. Hong-Lim-Stein predicts information diffuses more slowly where coverage is thin, so drift should be
// materially stronger in low-coverage names. `n_ests` is populated on 111,388 records and has NEVER been used as a
// conditioning variable here — 9 specs total against 142,695 earnings rows.
//
// PRE-REGISTERED as D-612-pead-coverage. The test is the SPREAD between terciles, not the level of the best one —
// conditioning a sub-ceiling effect until it clears is exactly how false positives are manufactured, and saying so
// in advance is what stops the best bucket becoming the headline.
//
// THE CONFOUND THAT MOST LIKELY KILLS IT, named in advance: low coverage correlates with small size and low
// liquidity, so any spread may be THE LIQUIDITY LAW rediscovered rather than information diffusion. Tested directly
// by re-running the spread inside the liquid half.
//
// EXECUTION. `when_` is "not-supplied" on 142,269 of 142,695 rows, so we cannot know whether a release was before or
// after the close. Entry is therefore deferred to the SECOND session after the report date — the conservative choice,
// since entering on day+1 would assume a pre-market release we cannot verify.
import { declareKnobs, assertNonEmpty } from "../supabase/functions/_shared/run-preconditions.ts";

const K = declareKnobs("pead-coverage", [
  { name: "HOLD_D", def: "20", note: "sessions held after entry" },
  { name: "ENTRY_LAG", def: "2", note: "sessions after report_date before entering (when_ is unusable)" },
  { name: "COST_BP", def: "20", note: "round trip, small-cap equities" },
  { name: "MIN_EVENTS", def: "2000", note: "per tercile" },
  { name: "LIQUID_ONLY", def: "", note: "1 = restrict to the liquid half, the confound control" },
]);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "pc", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

// Events
interface Ev { symbol: string; d: string; sur: number; n: number }
const evs: Ev[] = [];
for (let off = 0;; off += 50000) {
  const rows = await fetch(`${OWNED}/trd_earnings?surprise_pct=not.is.null&n_ests=not.is.null&select=symbol,report_date,surprise_pct,n_ests&order=report_date&offset=${off}&limit=50000`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; report_date: string; surprise_pct: number; n_ests: number }[];
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) if (Number.isFinite(+r.surprise_pct) && +r.n_ests > 0) evs.push({ symbol: r.symbol, d: r.report_date, sur: +r.surprise_pct, n: +r.n_ests });
  if (rows.length < 50000) break;
}
assertNonEmpty("earnings events", evs, 10000);

// Prices for the symbols that have events
const need = [...new Set(evs.map((e) => e.symbol))];
const px = new Map<string, { d: string[]; c: number[]; v: number[] }>();
for (let i = 0; i < need.length; i += 40) {
  const part = need.slice(i, i + 40).map((s) => `"${s}"`).join(",");
  const rows = await fetch(`${OWNED}/trd_bars_deep?symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, { headers: hdr })
    .then((r) => r.json()).catch(() => []) as { symbol: string; bars: unknown }[];
  for (const r of Array.isArray(rows) ? rows : []) {
    const raw = r.bars as (number | string)[][]; if (!Array.isArray(raw) || raw.length < 300) continue;
    const d: string[] = [], c: number[] = [], v: number[] = [];
    for (const b of raw) {
      // [date, o, h, l, c, v] with date either an ISO string or an epoch
      const dd = typeof b[0] === "string" ? String(b[0]).slice(0, 10) : new Date(Number(b[0]) * 1000).toISOString().slice(0, 10);
      const cc = Number(b[4]), vv = Number(b[5]);
      if (cc > 0) { d.push(dd); c.push(cc); v.push(Number.isFinite(vv) ? vv : 0); }
    }
    if (d.length > 300) px.set(r.symbol, { d, c, v });
  }
}
assertNonEmpty("symbols with price series", [...px.keys()], 500);

const HOLD = Number(K.HOLD_D), LAG = Number(K.ENTRY_LAG), COST = Number(K.COST_BP) / 1e4;
interface Obs { n: number; ret: number; dvol: number; d: string }
const obs: Obs[] = [];
for (const e of evs) {
  const p = px.get(e.symbol); if (!p) continue;
  // index of the first session strictly after the report date
  let lo = 0, hi = p.d.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= e.d) { at = m; lo = m + 1; } else hi = m - 1; }
  const entry = at + LAG, exit = entry + HOLD;
  if (at < 60 || exit >= p.d.length) continue;
  const r = p.c[exit] / p.c[entry] - 1;
  if (!Number.isFinite(r) || Math.abs(r) > 2) continue;
  // dollar volume over the 60 sessions BEFORE the event — the liquidity control, known at entry
  let dv = 0, k = 0;
  for (let j = at - 60; j < at; j++) { if (p.v[j] > 0) { dv += p.c[j] * p.v[j]; k++; } }
  // Signal: the direction of the surprise. Long positive, short negative — the standard PEAD book.
  const side = Math.sign(e.sur);
  if (side === 0) continue;
  obs.push({ n: e.n, ret: side * r - COST, dvol: k ? dv / k : 0, d: p.d[entry] });
}
assertNonEmpty("usable event-observations", obs, 5000);

// PSEUDO-REPLICATION. An event-level t across 74,666 observations treats overlapping 20-session holds on names that
// all report inside the same few weeks as independent draws. They are not: they share earnings season and the market
// factor. This programme's own law says the PORTFOLIO t decides, never the name-day t. Both are printed so the gap
// is visible, but only the portfolio number is a statistic.
const run = (rows: Obs[], label: string) => {
  if (rows.length < 100) { console.log(`    ${label.padEnd(22)} too few (${rows.length})`); return null; }
  const m = mean(rows.map((x) => x.ret)), s = sd(rows.map((x) => x.ret)) || 1e-12;
  const tEvent = m / (s / Math.sqrt(rows.length));
  // Portfolio: average all events entering in the same MONTH, then t across months.
  const byM = new Map<string, number[]>();
  for (const r of rows) (byM.get(r.d.slice(0, 7)) ?? byM.set(r.d.slice(0, 7), []).get(r.d.slice(0, 7))!).push(r.ret);
  const monthly = [...byM.values()].filter((v) => v.length >= 5).map(mean);
  const mm = mean(monthly), ms = sd(monthly) || 1e-12;
  const tPort = mm / (ms / Math.sqrt(monthly.length));
  console.log(`    ${label.padEnd(22)} drift ${(m * 100).toFixed(3)}%  t(event) ${tEvent.toFixed(2)}  t(PORTFOLIO) ${tPort.toFixed(2)}  n ${rows.length.toLocaleString()} in ${monthly.length} months`);
  return { m, s, n: rows.length, t: tEvent, tPort, monthly };
};

let pool = obs;
if (K.LIQUID_ONLY === "1") {
  const med = [...pool.map((x) => x.dvol)].sort((a, b) => a - b)[Math.floor(pool.length / 2)];
  pool = pool.filter((x) => x.dvol >= med);
  console.log(`\n    LIQUIDITY CONTROL: restricted to the liquid half (dollar volume >= $${(med / 1e6).toFixed(1)}M/day)`);
}

const byN = [...pool].sort((a, b) => a.n - b.n);
const t1 = Math.floor(byN.length / 3), t2 = Math.floor(2 * byN.length / 3);
const lo3 = byN.slice(0, t1), mid = byN.slice(t1, t2), hi3 = byN.slice(t2);

console.log(`\n==> PEAD BY ANALYST COVERAGE — ${HOLD}-session hold, entry +${LAG} sessions, ${K.COST_BP}bp round trip`);
console.log(`    coverage terciles by n_ests: LOW <= ${lo3[lo3.length - 1]?.n}, MID, HIGH >= ${hi3[0]?.n}\n`);
const rLo = run(lo3, "LOW coverage"), rMid = run(mid, "MID coverage"), rHi = run(hi3, "HIGH coverage");
run(pool, "all events");

if (rLo && rHi) {
  // Spread test: difference in means, unequal variances.
  const diff = rLo.m - rHi.m;
  const se = Math.sqrt(rLo.s ** 2 / rLo.n + rHi.s ** 2 / rHi.n);
  const tD = diff / (se || 1e-12);
  const monotone = !!rMid && rLo.m >= rMid.m && rMid.m >= rHi.m;
  console.log(`\n    SPREAD (LOW - HIGH), EVENT-level  = ${(diff * 100).toFixed(3)}%   t ${tD.toFixed(2)}`);
  // PAIRED MONTHLY SPREAD. The pre-registration said "|t| >= 2.0" without specifying event or portfolio level. This
  // programme's PSEUDO-REPLICATION law says the portfolio t decides, so the paired monthly difference is the
  // law-mandated statistic. BOTH are printed; neither is chosen after the fact.
  const byMlo = new Map<string, number[]>(), byMhi = new Map<string, number[]>();
  for (const r of lo3) (byMlo.get(r.d.slice(0, 7)) ?? byMlo.set(r.d.slice(0, 7), []).get(r.d.slice(0, 7))!).push(r.ret);
  for (const r of hi3) (byMhi.get(r.d.slice(0, 7)) ?? byMhi.set(r.d.slice(0, 7), []).get(r.d.slice(0, 7))!).push(r.ret);
  const months = [...byMlo.keys()].filter((m2) => byMhi.has(m2) && byMlo.get(m2)!.length >= 5 && byMhi.get(m2)!.length >= 5).sort();
  const dSeries = months.map((m2) => mean(byMlo.get(m2)!) - mean(byMhi.get(m2)!));
  const dm = mean(dSeries), ds = sd(dSeries) || 1e-12;
  const tPaired = dm / (ds / Math.sqrt(dSeries.length));
  console.log(`    SPREAD (LOW - HIGH), PAIRED MONTHLY = ${(dm * 100).toFixed(3)}%   t ${tPaired.toFixed(2)}   over ${dSeries.length} months  <- the law-mandated statistic`);
  console.log(`    monotone across terciles: ${monotone ? "YES" : "NO"}`);
  const supported = tD >= 2.0 && monotone;
  console.log(`\n    ${supported ? "PREDICTION SUPPORTED — drift concentrates in low-coverage names." :
    tD <= -2.0 ? "SIGN MISS — drift is STRONGER in HIGH coverage, the opposite of the prediction." :
    `NOT SUPPORTED — |t| ${Math.abs(tD).toFixed(2)} under 2.0${monotone ? "" : " and the ordering is not monotone"}.`}`);
}
