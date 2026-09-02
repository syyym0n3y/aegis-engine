#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// cef-discount.ts — CLOSED-END FUND DISCOUNT MEAN-REVERSION (Pontiff 1996), tested honestly.
//
// WHY THIS AND NOT ANOTHER RETURN PREDICTION. This programme has spent ~2.9M trials inside one paradigm: predict
// the next return of a liquid instrument from its own or its peers' price history. It has found nothing. A CEF
// discount is a DIFFERENT PAYMENT MECHANISM: the fund's assets have an observable, independently-published value
// (NAV), the share trades at a price, and the two are not equal. The payment, if it exists, is the CONVERGENCE of
// two prices for the same assets, not a forecast of what those assets will do. It is long-only, retail-placeable,
// and small enough that capacity is not the binding constraint — the three properties every prior survivor lacked.
//
// THE PRIOR, STATED BEFORE THE NUMBERS (THE SIGN LAW, D-553): Pontiff (1996) reports that funds trading at wide
// discounts subsequently EARN MORE than funds at narrow discounts. So the pre-registered sign is POSITIVE: wide
// discount -> higher next-month price return. A negative or flat result is MISSED and is not re-narrated as a
// short signal; a post-hoc flip is not claimable (D-511b / D-553).
//
// WHICH LAWS BIND AND HOW THEY ARE SATISFIED HERE:
//  UNIVERSE  (D-535/645) — universe from scripts/cef-universe.ts (EDGAR N-CEN, no hand-picking); universe
//            sensitivity is measured across four defensible definitions and the SPREAD is reported.
//  BENCHMARK (D-627/630) — every bucket return is reported beside the UNIVERSE MEAN over the same months and the
//            EXCESS against it. A tercile spread alone says nothing about whether either leg earned anything.
//  LIQUIDITY (D-419/423) — the book is decomposed by dollar-volume tercile, BOTH halves measured (D-634).
//  BREADTH   (D-443) — mean names per rebalance is printed; under 50 the cross-section is UNTESTED.
//  EXECUTION (D-498) — signal from month-end t, entry at the NEXT month-end -> the return used is t..t+1 and the
//            signal uses only data through t. No same-bar action.
//  TURNOVER  (D-654) — drag = 2 x one-way turnover x 12 x RT_BP, reported beside the gross. CEFs are wide-spread,
//            so RT_BP defaults to 30, not to an equity-like 10.
//  COST-INFL (D-661) — the GROSS t is printed beside the net everywhere, so a cost assumption can never be what
//            makes a losing book "significant".
//  HOLDABILITY (D-565) — worst drawdown AND longest time underwater.
//  EFFECT-SIZE (D-426) — the per-1sd effect is stated in bp against the round-trip cost it must beat.
//  POSITIVE-CONTROL (D-641) — a zero here would be indistinguishable from a broken join, so the panel prints
//            counts that MUST be non-zero and a known-wide-discount fund's discount is spot-checked.
//
// DESCRIPTIVE ONLY (THE MECHANISM LAW, D-597): no mechanism claim is pre-registered, nothing is written to
// trd_lineage, and nothing here is a promotion.
import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { spendTrials } from "../supabase/functions/_shared/trial-ledger.ts";

const K = declareKnobs("cef-discount", [
  { name: "RT_BP", def: "30", note: "round-trip cost in bp; CEFs are wide-spread, 30 is not conservative-by-accident" },
  { name: "CEFD_SRC", def: "data/cef-universe.json" },
  { name: "CEFD_LOOKBACK", def: "36", note: "months of own-history for the discount z-score" },
  { name: "CEFD_Z", def: "-1", note: "z threshold defining an EXTREME (wide) discount in Test A" },
  { name: "CEFD_ERA_SPLIT", def: "2016-01", note: "pre/post era boundary" },
  { name: "CEFD_SLEEP_MS", def: "260", note: "Yahoo courtesy pacing, sequential" },
  { name: "CEFD_CACHE", def: "data/cef-bars.json", note: "price+NAV cache so a re-run is not a fetch storm" },
]);
const RT_BP = Number(K.RT_BP), LOOKBACK = Number(K.CEFD_LOOKBACK), ZTHRESH = Number(K.CEFD_Z);
const ERA = K.CEFD_ERA_SPLIT, SLEEP = Number(K.CEFD_SLEEP_MS);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "cefd", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tstat = (a: number[]) => (a.length < 3 ? 0 : mean(a) / ((sd(a) || 1e-12) / Math.sqrt(a.length)));
const pctPos = (a: number[]) => (100 * a.filter((x) => x > 0).length) / a.length;

// ---------------- data ----------------
type YF = { d: string[]; c: number[]; a: number[]; v: number[] };
async function yahoo(sym: string): Promise<YF | null> {
  try {
    const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now() / 1000)}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.json() : null);
    const r = j?.chart?.result?.[0];
    if (!r?.timestamp?.length) return null;
    const q = r.indicators.quote[0];
    const adj = r.indicators?.adjclose?.[0]?.adjclose;
    const d: string[] = [], c: number[] = [], a: number[] = [], v: number[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const px = q.close?.[i];
      if (px == null || !Number.isFinite(px) || px <= 0) continue;
      const ap = adj?.[i];
      d.push(new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10)); c.push(px);
      a.push(ap != null && Number.isFinite(ap) && ap > 0 ? ap : px);   // fall back to raw where Yahoo serves no adjclose
      v.push(Number(q.volume?.[i]) || 0);
    }
    return d.length ? { d, c, a, v } : null;
  } catch { return null; }
}

const uni = JSON.parse(await Deno.readTextFile(K.CEFD_SRC)) as { method: string; universe: { ticker: string }[] };
const tickers = uni.universe.map((u) => u.ticker);
assertNonEmpty("CEF universe tickers", tickers, 20);

// Cache so re-runs are cheap and the fetch is genuinely sequential.
let cache: Record<string, { px: YF; nav: YF }> = {};
try { cache = JSON.parse(await Deno.readTextFile(K.CEFD_CACHE)); } catch { /* first run */ }
let fetched = 0, dropped = 0;
for (const t of tickers) {
  if (cache[t]) continue;
  const px = await yahoo(t); await sleep(SLEEP);
  if (!px) { dropped++; continue; }
  const nav = await yahoo(`X${t}X`); await sleep(SLEEP);
  if (!nav) { dropped++; continue; }
  cache[t] = { px, nav }; fetched++;
  if (fetched % 25 === 0) { await Deno.writeTextFile(K.CEFD_CACHE, JSON.stringify(cache)); console.log(`    ...${fetched} fetched`); }
}
await Deno.writeTextFile(K.CEFD_CACHE, JSON.stringify(cache));

// ---------------- monthly panel ----------------
// Month-end close of price, NAV and 21d mean dollar volume. Discount = price/NAV - 1 (negative = trading BELOW NAV).
interface MRow { t: string; m: string; px: number; apx: number; nav: number; anav: number; disc: number; dv: number }
const monthEnd = (s: YF): Map<string, { c: number; a: number; dv: number }> => {
  const out = new Map<string, { c: number; a: number; dv: number }>();
  for (let i = 0; i < s.d.length; i++) {
    const m = s.d[i].slice(0, 7);
    let dv = 0, n = 0;
    for (let k = Math.max(0, i - 20); k <= i; k++) { dv += s.c[k] * s.v[k]; n++; }
    out.set(m, { c: s.c[i], a: s.a[i], dv: dv / n });  // ascending -> last obs of the month wins
  }
  return out;
};

const rows: MRow[] = [];
for (const t of Object.keys(cache)) {
  const P = monthEnd(cache[t].px), N = monthEnd(cache[t].nav);
  for (const [m, p] of P) {
    const nv = N.get(m); if (!nv || !(nv.c > 0) || !(p.c > 0)) continue;
    const disc = p.c / nv.c - 1;
    if (!Number.isFinite(disc) || Math.abs(disc) > 0.75) continue;   // |75%| is a data error, not a discount
    rows.push({ t, m, px: p.c, apx: p.a, nav: nv.c, anav: nv.a, disc, dv: p.dv });
  }
}
assertNonEmpty("CEF month observations", rows, 1000);

// POSITIVE CONTROL: a zero result must not be confusable with a broken join. These MUST be non-zero.
const nWide = rows.filter((r) => r.disc < -0.05).length, nPrem = rows.filter((r) => r.disc > 0.02).length;
console.log(`\n    POSITIVE CONTROL — obs at a discount worse than -5%: ${nWide.toLocaleString()} | at a premium >+2%: ${nPrem.toLocaleString()}`);
console.log(`      (both must be non-zero; a panel where nothing trades away from NAV means the NAV join is broken, not that CEFs are efficient)`);
if (!nWide || !nPrem) { console.log(`    !! CONTROL FAILED — the discount series is degenerate. Everything below would be UNTESTED, not a finding.`); Deno.exit(2); }

// per fund, indexed by month, with the NEXT month's price and NAV so returns decompose
const byT = new Map<string, MRow[]>();
for (const r of rows) { const a = byT.get(r.t) ?? []; a.push(r); byT.set(r.t, a); }
for (const a of byT.values()) a.sort((x, y) => x.m < y.m ? -1 : 1);

interface Obs { t: string; m: string; disc: number; z: number | null; dv: number; retPx: number; retPxRaw: number; retNav: number; dDisc: number }
const obs: Obs[] = [];
for (const [t, a] of byT) {
  for (let i = 0; i < a.length - 1; i++) {
    const c = a[i], n = a[i + 1];
    // consecutive calendar months only — a gap is a halted/illiquid stretch, not a held position
    const dm = (Number(n.m.slice(0, 4)) - Number(c.m.slice(0, 4))) * 12 + (Number(n.m.slice(5)) - Number(c.m.slice(5)));
    if (dm !== 1) continue;
    const retPx = n.apx / c.apx - 1, retNav = n.anav / c.anav - 1;   // TOTAL return: adjclose, so distributions are included
    const retPxRaw = n.px / c.px - 1;                                   // ex-distribution, kept only for the decomposition identity
    if (!Number.isFinite(retPx) || !Number.isFinite(retNav) || Math.abs(retPx) > 0.6) continue;
    // z-score vs the fund's OWN trailing LOOKBACK months, strictly BEFORE and INCLUDING t (no future)
    const hist = a.slice(Math.max(0, i - LOOKBACK + 1), i + 1).map((x) => x.disc);
    const z = hist.length >= LOOKBACK ? (c.disc - mean(hist)) / (sd(hist) || 1e-9) : null;
    obs.push({ t, m: c.m, disc: c.disc, z, dv: c.dv, retPx, retPxRaw, retNav, dDisc: (n.disc - c.disc) });
  }
}
assertNonEmpty("CEF forward observations", obs, 1000);

const months = [...new Set(obs.map((o) => o.m))].sort();
const perMonth = new Map<string, Obs[]>();
for (const o of obs) { const a = perMonth.get(o.m) ?? []; a.push(o); perMonth.set(o.m, a); }
const breadth = mean(months.map((m) => perMonth.get(m)!.length));

console.log(`\n==> CEF DISCOUNT MEAN-REVERSION — Pontiff (1996), tested on our own N-CEN-built universe`);
console.log(`    universe method: ${uni.method}`);
console.log(`    funds in universe ${tickers.length} | with price+NAV bars ${Object.keys(cache).length} | dropped (no price or no NAV) ${dropped}`);
console.log(`    panel: ${obs.length.toLocaleString()} fund-months over ${months.length} months (${months[0]} .. ${months[months.length - 1]})`);
console.log(`    mean names per rebalance (BREADTH LAW, D-443): ${breadth.toFixed(1)} -> ${breadth < 50 ? "UNTESTED as a cross-section" : "adequate breadth"}`);
console.log(`    discount distribution: mean ${(100 * mean(obs.map((o) => o.disc))).toFixed(2)}%  sd ${(100 * sd(obs.map((o) => o.disc))).toFixed(2)}%  |  z available on ${obs.filter((o) => o.z !== null).length.toLocaleString()} obs`);

// ================= TEST A — time series, per fund, pooled =================
// Does an extreme OWN-HISTORY discount (z < ZTHRESH) predict a higher next-month PRICE return than the same fund's
// unconditional mean? Measured as a PAIRED per-fund difference, so it cannot be a cross-sectional level effect.
console.log(`\n  TEST A — TIME SERIES (own-history z < ${ZTHRESH}), paired within fund`);
const zObs = obs.filter((o) => o.z !== null);
const diffs: number[] = []; const uncond: number[] = []; const cond: number[] = [];
let fundsWithBoth = 0;
const zByT = new Map<string, Obs[]>();
for (const o of zObs) { const a = zByT.get(o.t) ?? []; a.push(o); zByT.set(o.t, a); }
for (const [_t, mine] of zByT) {
  const ext = mine.filter((o) => o.z! < ZTHRESH).map((o) => o.retPx);
  if (ext.length < 6 || mine.length < 24) continue;
  fundsWithBoth++;
  const u = mean(mine.map((o) => o.retPx));
  diffs.push(mean(ext) - u); uncond.push(u); cond.push(mean(ext));
}
if (diffs.length < 20) {
  console.log(`    UNTESTED — only ${diffs.length} funds have >=6 extreme-discount months and >=24 months of history.`);
} else {
  console.log(`    funds with both a conditional and unconditional mean: ${diffs.length}`);
  console.log(`    unconditional mean next-month price return   ${(100 * mean(uncond)).toFixed(3)}%/mo`);
  console.log(`    conditional on z < ${ZTHRESH}                        ${(100 * mean(cond)).toFixed(3)}%/mo`);
  console.log(`    PAIRED DIFFERENCE                            ${(100 * mean(diffs)).toFixed(3)}%/mo   t ${tstat(diffs).toFixed(2)}  (N=${diffs.length} funds)  ${pctPos(diffs).toFixed(0)}% of funds positive`);
  // EFFECT-SIZE LAW: state the magnitude against the cost it must beat, not only the significance.
  console.log(`    EFFECT SIZE: ${(1e4 * mean(diffs)).toFixed(1)}bp per month vs a ${RT_BP}bp round trip = ${(1e4 * mean(diffs) / RT_BP).toFixed(2)}x the cost of one entry+exit.`);
}
// pooled slope of next-month price return on z, for magnitude per 1sd (the OLS/mean effect the EFFECT-SIZE LAW
// requires beside any rank-style claim)
{
  const xs = zObs.map((o) => o.z!), ys = zObs.map((o) => o.retPx);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxy / sxx;
  console.log(`    pooled OLS slope d(next-month price return)/d(z) = ${(1e4 * slope).toFixed(2)}bp per 1sd of own-history z`);
  console.log(`      (prior says NEGATIVE slope — a LOWER z, i.e. a wider-than-usual discount, should pay MORE)`);
}

// ================= TEST B — cross-section, monthly =================
// Long the widest-discount tercile; the BENCHMARK LAW comparison is the equal-weight UNIVERSE MEAN over the same
// months, and the long-short is reported beside it, never instead of it.
console.log(`\n  TEST B — CROSS-SECTION (raw discount rank, monthly, lag-1 by construction: signal at t, return t..t+1)`);
interface MB { m: string; wide: number; narrow: number; uni: number; wideNav: number; wideDisc: number; wideRaw: number; ls: number; toWide: number; n: number }
const book: MB[] = [];
let prevWide = new Set<string>();
for (const m of months) {
  const a = perMonth.get(m)!;
  if (a.length < 9) continue;
  const s = [...a].sort((x, y) => x.disc - y.disc);       // most negative (widest discount) first
  const k = Math.floor(s.length / 3);
  const wide = s.slice(0, k), narrow = s.slice(s.length - k);
  const nowWide = new Set(wide.map((o) => o.t));
  let churn = 0; for (const t of nowWide) if (!prevWide.has(t)) churn++;
  const to = prevWide.size ? churn / nowWide.size : 1;    // one-way turnover of the long leg
  book.push({
    m, n: a.length,
    wide: mean(wide.map((o) => o.retPx)), narrow: mean(narrow.map((o) => o.retPx)),
    uni: mean(a.map((o) => o.retPx)),
    wideNav: mean(wide.map((o) => o.retNav)), wideDisc: mean(wide.map((o) => o.dDisc)), wideRaw: mean(wide.map((o) => o.retPxRaw)),
    ls: mean(wide.map((o) => o.retPx)) - mean(narrow.map((o) => o.retPx)),
    toWide: to,
  });
  prevWide = nowWide;
}
assertNonEmpty("cross-sectional months", book, 24);

const ls = book.map((b) => b.ls), wideR = book.map((b) => b.wide), narrowR = book.map((b) => b.narrow), uniR = book.map((b) => b.uni);
const excess = book.map((b) => b.wide - b.uni);
const ann = (a: number[]) => mean(a) * 12 * 100;
const shp = (a: number[]) => (mean(a) / (sd(a) || 1e-12)) * Math.sqrt(12);
const avgTO = mean(book.map((b) => b.toWide));
const dragLO = 2 * avgTO * 12 * (RT_BP / 1e4) * 100;      // long-only: 2 x one-way x 12 x RT
const dragLS = 2 * dragLO;                                 // long-short trades both legs

console.log(`    months ${book.length} (${book[0].m} .. ${book[book.length - 1].m}) | mean names/month ${mean(book.map((b) => b.n)).toFixed(1)}`);
console.log(`\n    BENCHMARK LAW (D-627/630) — the universe is the comparison, not the other tercile:`);
console.log(`      UNIVERSE (equal-weight, all funds)   ${ann(uniR).toFixed(2)}%/yr   SR ${shp(uniR).toFixed(2)}   t ${tstat(uniR).toFixed(2)}`);
console.log(`      WIDEST-discount tercile              ${ann(wideR).toFixed(2)}%/yr   SR ${shp(wideR).toFixed(2)}   t ${tstat(wideR).toFixed(2)}`);
console.log(`      NARROWEST-discount tercile           ${ann(narrowR).toFixed(2)}%/yr   SR ${shp(narrowR).toFixed(2)}   t ${tstat(narrowR).toFixed(2)}`);
console.log(`      EXCESS of widest over the universe   ${ann(excess).toFixed(2)}%/yr   t ${tstat(excess).toFixed(2)}   ${pctPos(excess).toFixed(0)}% of months positive`);
console.log(`      LONG-SHORT (widest - narrowest)      ${ann(ls).toFixed(2)}%/yr   SR ${shp(ls).toFixed(2)}   t ${tstat(ls).toFixed(2)}`);
console.log(`      months the WIDEST tercile is NEGATIVE: ${(100 - pctPos(wideR)).toFixed(0)}%  (a bucket that rises most months is not a short leg)`);

// COST-INFLATION COROLLARY (D-661): gross beside net, always.
console.log(`\n    TURNOVER + COST (D-654 / D-661) — gross printed beside net so cost can never manufacture the finding:`);
console.log(`      long-leg one-way turnover ${(100 * avgTO).toFixed(1)}%/month`);
console.log(`      LONG-ONLY widest tercile:  GROSS ${ann(wideR).toFixed(2)}%/yr  drag ${dragLO.toFixed(2)}%/yr @${RT_BP}bp RT  ->  NET ${(ann(wideR) - dragLO).toFixed(2)}%/yr`);
console.log(`      EXCESS over universe:      GROSS ${ann(excess).toFixed(2)}%/yr (t ${tstat(excess).toFixed(2)})  ->  NET ${(ann(excess) - dragLO).toFixed(2)}%/yr   [universe drag not netted: the buy-and-hold comparison trades far less]`);
console.log(`      LONG-SHORT:                GROSS ${ann(ls).toFixed(2)}%/yr (t ${tstat(ls).toFixed(2)})  drag ${dragLS.toFixed(2)}%/yr  ->  NET ${(ann(ls) - dragLS).toFixed(2)}%/yr`);

// DECOMPOSITION — where does the money come from?
const wNav = book.map((b) => b.wideNav), wDisc = book.map((b) => b.wideDisc);
console.log(`\n    DECOMPOSITION of the widest-discount tercile's return (price return ~= NAV return + discount change):`);
console.log(`      (identity holds on EX-DISTRIBUTION prices; the headline book above is TOTAL return via adjclose)`);
console.log(`      ex-distribution price return ${ann(book.map((b) => b.wideRaw)).toFixed(2)}%/yr  vs total ${ann(wideR).toFixed(2)}%/yr -> distributions worth ${(ann(wideR) - ann(book.map((b) => b.wideRaw))).toFixed(2)}%/yr`);
console.log(`      NAV return component        ${ann(wNav).toFixed(2)}%/yr   t ${tstat(wNav).toFixed(2)}`);
console.log(`      DISCOUNT-CHANGE component   ${(mean(wDisc) * 12 * 100).toFixed(2)}%/yr   t ${tstat(wDisc).toFixed(2)}   <- this is the convergence the hypothesis is about`);
console.log(`      residual (compounding/cross term) ${(ann(book.map((b) => b.wideRaw)) - ann(wNav) - mean(wDisc) * 12 * 100).toFixed(2)}%/yr`);

// LIQUIDITY LAW — both halves measured (D-634), never one inferred from the other.
console.log(`\n    LIQUIDITY LAW (D-419/423/634) — dollar-volume terciles, BOTH ends measured:`);
for (const [lab, pick] of [["LIQUID (top 1/3 $vol)", 2], ["MID", 1], ["ILLIQUID (bottom 1/3)", 0]] as [string, number][]) {
  const ex: number[] = [], wd: number[] = [];
  for (const m of months) {
    const a = perMonth.get(m)!; if (a.length < 12) continue;
    const byDv = [...a].sort((x, y) => x.dv - y.dv);
    const k = Math.floor(byDv.length / 3);
    const seg = pick === 0 ? byDv.slice(0, k) : pick === 1 ? byDv.slice(k, byDv.length - k) : byDv.slice(byDv.length - k);
    if (seg.length < 4) continue;
    const s = [...seg].sort((x, y) => x.disc - y.disc);
    const kk = Math.max(1, Math.floor(s.length / 3));
    const w = mean(s.slice(0, kk).map((o) => o.retPx));
    wd.push(w); ex.push(w - mean(seg.map((o) => o.retPx)));
  }
  if (ex.length < 24) { console.log(`      ${lab.padEnd(22)} UNTESTED — only ${ex.length} months`); continue; }
  console.log(`      ${lab.padEnd(22)} widest tercile ${ann(wd).toFixed(2)}%/yr | EXCESS over its own liquidity bucket ${ann(ex).toFixed(2)}%/yr  SR ${shp(ex).toFixed(2)}  t ${tstat(ex).toFixed(2)}  n=${ex.length}mo`);
}

// HOLDABILITY LAW — duration, not just depth.
const dd = (a: number[]) => { let c = 1, p = 1, worst = 0, uw = 0, longest = 0; for (const r of a) { c *= 1 + r; if (c >= p) { p = c; uw = 0; } else { uw++; longest = Math.max(longest, uw); } worst = Math.min(worst, c / p - 1); } return { worst: worst * 100, longest }; };
const hLO = dd(wideR), hEX = dd(excess), hLS = dd(ls);
console.log(`\n    HOLDABILITY LAW (D-565) — duration is the constraint, not depth:`);
console.log(`      LONG-ONLY widest tercile  worst DD ${hLO.worst.toFixed(1)}%   longest underwater ${hLO.longest} months (${(hLO.longest / 12).toFixed(1)}y)`);
console.log(`      EXCESS series             worst DD ${hEX.worst.toFixed(1)}%   longest underwater ${hEX.longest} months (${(hEX.longest / 12).toFixed(1)}y)`);
console.log(`      LONG-SHORT                worst DD ${hLS.worst.toFixed(1)}%   longest underwater ${hLS.longest} months (${(hLS.longest / 12).toFixed(1)}y)`);

// ERA HALVES
console.log(`\n    ERAS (split ${ERA}):`);
for (const [lab, sel] of [[`pre-${ERA}`, (b: MB) => b.m < ERA], [`post-${ERA}`, (b: MB) => b.m >= ERA]] as [string, (b: MB) => boolean][]) {
  const s = book.filter(sel);
  if (s.length < 12) { console.log(`      ${lab.padEnd(14)} UNTESTED — ${s.length} months`); continue; }
  const e = s.map((b) => b.wide - b.uni), l = s.map((b) => b.ls);
  console.log(`      ${lab.padEnd(14)} n=${String(s.length).padStart(3)}mo | universe ${ann(s.map((b) => b.uni)).toFixed(2)}%/yr | excess ${ann(e).toFixed(2)}%/yr t ${tstat(e).toFixed(2)} | L-S ${ann(l).toFixed(2)}%/yr t ${tstat(l).toFixed(2)}`);
}

// UNIVERSE LAW — sensitivity across defensible definitions of the same idea.
console.log(`\n    UNIVERSE SENSITIVITY (D-535) — the same rule on four defensible universes:`);
const variants: [string, (o: Obs) => boolean][] = [
  ["all funds", () => true],
  ["$vol > $250k/day", (o) => o.dv > 250_000],
  ["$vol > $1m/day", (o) => o.dv > 1_000_000],
  ["discount-only (excl. premium names)", (o) => o.disc < 0],
];
const variantSR: number[] = [];
for (const [lab, f] of variants) {
  const ex: number[] = [];
  for (const m of months) {
    const a = perMonth.get(m)!.filter(f); if (a.length < 9) continue;
    const s = [...a].sort((x, y) => x.disc - y.disc);
    const k = Math.floor(s.length / 3);
    ex.push(mean(s.slice(0, k).map((o) => o.retPx)) - mean(a.map((o) => o.retPx)));
  }
  if (ex.length < 24) { console.log(`      ${lab.padEnd(36)} UNTESTED — ${ex.length} months`); continue; }
  variantSR.push(Math.abs(shp(ex)));
  console.log(`      ${lab.padEnd(36)} excess ${ann(ex).toFixed(2)}%/yr  SR ${shp(ex).toFixed(2)}  t ${tstat(ex).toFixed(2)}  n=${ex.length}mo`);
}
const spread = variantSR.length > 1 ? Math.max(...variantSR) / Math.max(1e-9, Math.min(...variantSR)) : NaN;
console.log(`      SHARPE SPREAD across universes: ${Number.isFinite(spread) ? spread.toFixed(2) + "x" : "n/a"} ${Number.isFinite(spread) && spread > 1.5 ? "-> NOT IDENTIFIED (D-535 rule 2)" : "-> within the 1.5x identification band"}`);

// SIGN LAW
const signOK = mean(excess) > 0;
console.log(`\n    SIGN LAW (D-553) — prior stated before the numbers: WIDE discount -> HIGHER next-month price return.`);
console.log(`      OUTCOME: ${signOK ? "MATCHED in sign" : "MISSED"} (widest-tercile excess over the universe is ${ann(excess).toFixed(2)}%/yr, t ${tstat(excess).toFixed(2)}).`);
if (!signOK) console.log(`      A post-hoc flip to the narrow-discount side is NOT claimable (D-511b/D-553) and is not made here.`);

// TRIALS
const spend = await spendTrials({ rest: OWNED, headers: hdr, family: "cef-discount", runId: `cefd|z${ZTHRESH}|lb${LOOKBACK}|rt${RT_BP}`, spent: 12 });
console.log(`\n    TRIALS: 12 spent — Test A z-threshold, pooled slope, 3 liquidity buckets, 2 eras, 4 universe variants,`);
console.log(`    and the cross-sectional book itself. Every variant costs a trial (D-535 rule 3); none is free.`);
console.log(`    trials ${spend.before.toLocaleString()} -> ${spend.N.toLocaleString()} | deflation ceiling (psr_z to beat) ${spend.ceiling.toFixed(4)}`);


// ---------------- SURVIVORSHIP — the largest threat to everything above, stated before the verdict ----------------
// The universe is funds that FILED AN N-CEN BETWEEN 2019 AND 2025, backtested to 1998. A closed-end fund that
// liquidated, open-ended, or was merged away before 2019 is STRUCTURALLY ABSENT and cannot be recovered from this
// construction. The selection mechanism is named, per D-645 rule 6, because "72% coverage" alone is uninformative:
// the missing cohort is exactly the funds whose discounts did NOT resolve well enough to keep them alive, and a
// persistently wide discount is the single most common trigger for activist pressure, tender offers and
// liquidation. The bias therefore runs IN FAVOUR of the result reported here, not against it. Its size is UNKNOWN
// and is not estimated, because an unmeasured hole guessed at is worse than one stated.
const startYr = new Map<string, string>();
for (const [t, a] of byT) startYr.set(t, a[0].m);
const pre2005 = [...startYr.values()].filter((m) => m < "2005-01").length;
const lastM = new Map<string, string>();
for (const [t, a] of byT) lastM.set(t, a[a.length - 1].m);
const stillLive = [...lastM.values()].filter((m) => m >= "2026-01").length;
console.log(`\n    SURVIVORSHIP (the largest unquantified threat to every number above):`);
console.log(`      the universe is CEFs that filed an N-CEN in 2019-2025, and it is run back to ${months[0]}.`);
console.log(`      funds with panel history starting before 2005: ${pre2005} of ${byT.size}`);
console.log(`      funds still reporting in 2026: ${stillLive} of ${byT.size} (within-panel attrition ${(100 * (1 - stillLive / byT.size)).toFixed(1)}%)`);
console.log(`      WITHIN-PANEL ATTRITION IS NOT A COVERAGE MEASURE (D-645 rule 7): it counts who left, never who`);
console.log(`      never joined. Every CEF liquidated, open-ended or merged before 2019 is absent, and those are`);
console.log(`      disproportionately the persistently-wide-discount funds. The bias runs TOWARD the reported`);
console.log(`      result. Its magnitude is UNMEASURED, and the number below is therefore an UPPER BOUND.`);

// ---------------- VERDICT ----------------
const tEx = tstat(excess), netEx = ann(excess) - dragLO;
const verdict = breadth < 50
  ? `UNTESTED AS A CROSS-SECTION — mean breadth ${breadth.toFixed(1)} names/month is below the ~50 floor (BREADTH LAW, D-443).`
  : Math.abs(tEx) < 2
  ? `NULL — the widest-discount tercile's excess over the universe is ${ann(excess).toFixed(2)}%/yr at t ${tEx.toFixed(2)}, inside noise. Recorded as DRIFT (BENCHMARK LAW), not as an edge, and not as a short.`
  : netEx <= 0
  ? `SUB-COST — gross excess ${ann(excess).toFixed(2)}%/yr (t ${tEx.toFixed(2)}) is real in-sample but ${dragLO.toFixed(2)}%/yr of turnover drag at ${RT_BP}bp leaves ${netEx.toFixed(2)}%/yr. A rebalancing schedule, not an edge (TURNOVER LAW, D-654).`
  : spread > 1.5
  ? `NOT IDENTIFIED (D-535 rule 2) — the excess Sharpe ranges ${Math.min(...variantSR).toFixed(2)}-${Math.max(...variantSR).toFixed(2)} (${spread.toFixed(2)}x) across four defensible universes, past the 1.5x identification band. Gross excess ${ann(excess).toFixed(2)}%/yr at t ${tEx.toFixed(2)}, net ${netEx.toFixed(2)}%/yr, is SURVIVORSHIP-INFLATED BY AN UNMEASURED AMOUNT and no universe definition is principled enough to carry it.`
  : spend.ceiling > Math.abs(tEx)
  ? `BELOW THE DEFLATION CEILING — net excess ${netEx.toFixed(2)}%/yr at t ${tEx.toFixed(2)}, against a ${spend.N.toLocaleString()}-trial ceiling of ${spend.ceiling.toFixed(2)}. Not distinguishable from the best of many tries.`
  : `SURVIVES THIS PASS — net excess ${netEx.toFixed(2)}%/yr at t ${tEx.toFixed(2)}, above the ${spend.ceiling.toFixed(2)} deflation ceiling. NOT a promotion: no walk-forward, no PBO, no forward clock, and the survivorship hole above is unmeasured.`;
console.log(`\n  VERDICT: ${verdict}`);
console.log(`\n  DESCRIPTIVE ONLY (THE MECHANISM LAW, D-597) — no mechanism is pre-registered for these numbers, no`);
console.log(`  trd_lineage row is written, no gate is claimed and no forward clock is started by this script.`);
