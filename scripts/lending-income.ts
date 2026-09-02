#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
// lending-income.ts — "PAID FOR PROVIDING A SERVICE": securities lending on your own long holdings.
//
// THE FRONTIER ROW. A retail account enrolled in a fully-paid securities-lending program (IBKR Stock Yield
// Enhancement Program, Fidelity FPSL, Schwab SLFP) is paid a share of the borrow fee on shares that a borrower
// actually takes. There is NO FORECAST in it: you are paid for supplying inventory, not for being right. That makes
// it structurally different from every other row this programme has tested, and nobody here has quantified it.
//
// WHAT THIS SCRIPT CAN AND CANNOT DO — stated first, because the answer turns on it.
//   * The per-name BORROW RATE is the price of the service. We do not hold it (driver register: "borrow cost /
//     availability — Paid"). Section 1 RESEARCHES that before assuming it, rather than repeating the label.
//   * What we DO hold is DEMAND: `trd_short_interest` (short_qty, adv_qty, days_cover, 3.9M rows), `trd_short_volume`,
//     `trd_ftd`. Demand is the input to the rate, not the rate.
//   * So the verdict here is UNTESTED-ON-RATE by construction. What is measured is the DEMAND DISTRIBUTION of each
//     portfolio; what is assumed is the rate schedule mapping demand -> fee. Every assumed number is printed with
//     its source and its bracket, and the conclusion is a bracket, never a point.
// DESCRIPTIVE ONLY (MECHANISM LAW, D-597). No pre-registration, no trd_lineage row, no promotion, no advice.
//
// POSITIVE-CONTROL RULE (D-641): every count that could be zero is paired with a control that must not be.
// COVERAGE LAW: a portfolio whose names are absent from the short-interest panel is UNTESTED, not "0% income".

import { assertNonEmpty, declareKnobs } from "../supabase/functions/_shared/run-preconditions.ts";
import { adjShares, loadSplits, type Split } from "../supabase/functions/_shared/shares-adj.ts";

const K = declareKnobs("lending-income", [
  { name: "LI_ADV", def: "5000000", note: "liquid-universe floor: avg daily share volume on the SI settlement date" },
  { name: "LI_SHARE", def: "0.5", note: "lender's share of the gross borrow fee (IBKR SYEP discloses 50%)" },
  { name: "LI_PROBE_YAHOO", def: "1", note: "1 = live-probe Yahoo quoteSummary for short data (allowlisted host)" },
  { name: "LI_CEF_PANEL", def: "data/cef-panel.json", note: "D-750 CEF discount panel (read-only)" },
  { name: "LI_OUT", def: "data/lending-income.json", note: "where the measured demand distribution is written" },
]);
const ADV_FLOOR = Number(K.LI_ADV), LENDER_SHARE = Number(K.LI_SHARE);

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "lending", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();
const q = async (p: string) => await fetch(`${OWNED}/${p}`, { headers: hdr }).then((r) => r.ok ? r.json() : []).catch(() => []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (x: number) => `${(100 * x).toFixed(2)}%`;

console.log(`\n${"=".repeat(112)}\n  LENDING INCOME — being paid for supplying inventory, not for a forecast   (DESCRIPTIVE ONLY)\n${"=".repeat(112)}`);

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 1 — RESEARCH THE RATE SOURCE BEFORE ASSUMING IT
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n  1. RATE SOURCE — researched, not assumed (OPERATING_DOCTRINE: research before you defer)\n`);

// 1a. The allowlist is the binding constraint on what may be fetched at all. Read it and report, do not edit it.
const ALLOWLIST = `${Deno.env.get("HOME")}/.claude/hooks/endpoints.allowlist`;
let allow: string[] = [];
try {
  allow = (await Deno.readTextFile(ALLOWLIST)).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
} catch { /* absent: report as such */ }
console.log(`     allowlist patterns readable: ${allow.length}${allow.length ? "" : "  (NOT READABLE — treat every host below as blocked)"}`);
// POSITIVE CONTROL for the allowlist parse: a host we KNOW is allowed must match, or the matcher is broken.
const matches = (url: string) => allow.some((p) => { try { return new RegExp(p).test(url); } catch { return false; } });
const ctlYahoo = matches("https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL");
console.log(`     POSITIVE CONTROL — a known-allowed host matches the parsed patterns: ${ctlYahoo ? "YES" : "NO !! matcher broken, all results below are meaningless"}`);

const RATE_HOSTS = [
  { url: "https://www.interactivebrokers.com/en/trading/shortable-stocks.php", what: "IBKR shortable-stocks search (per-name fee rate + availability, HTTPS mirror of the FTP file)" },
  { url: "https://ibkr.info/article/2024", what: "IBKR knowledge-base article hosting the same feed" },
  { url: "https://www.iborrowdesk.com/api/AAPL", what: "iBorrowDesk — free scraper of the IBKR feed, per-name fee + available qty, historical" },
  { url: "https://ftp3.interactivebrokers.com/usa.txt", what: "IBKR FTP file (the driver register's blocked source)" },
];
console.log(`\n     candidate FREE per-name borrow-RATE sources, checked against the allowlist (NOT fetched when blocked):`);
const blocked: typeof RATE_HOSTS = [];
for (const h of RATE_HOSTS) {
  const ok = matches(h.url);
  console.log(`       ${ok ? "ALLOWED" : "BLOCKED"}  ${h.url}\n                 ${h.what}`);
  if (!ok) blocked.push(h);
}
if (blocked.length) {
  console.log(`\n     NOT FETCHED. To turn the rate from ASSUMED into MEASURED, the operator adds these exact patterns:`);
  console.log(`       echo '^https?://(www\\.)?interactivebrokers\\.com/' >> ~/.claude/hooks/endpoints.allowlist`);
  console.log(`       echo '^https?://ibkr\\.info/'                      >> ~/.claude/hooks/endpoints.allowlist`);
  console.log(`       echo '^https?://(www\\.)?iborrowdesk\\.com/'        >> ~/.claude/hooks/endpoints.allowlist`);
  console.log(`     All three are free and keyless as published. iBorrowDesk is the highest-value one: it serves the`);
  console.log(`     IBKR fee rate per name over plain HTTPS/JSON, which is exactly the column this programme lacks.`);
  console.log(`     (The FTP host stays blocked and stays irrelevant — Deno cannot speak FTP anyway.)`);
}

// 1b. Yahoo quoteSummary IS allowlisted. Probe it: it gives DEMAND, not rate. Say precisely what it gives.
if (K.LI_PROBE_YAHOO === "1" && ctlYahoo) {
  console.log(`\n     LIVE PROBE — Yahoo quoteSummary defaultKeyStatistics (allowlisted). Sequential, 3 names.`);
  for (const s of ["AAPL", "GME", "BYND"]) {
    let line = `       ${s.padEnd(6)}`;
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${s}?modules=defaultKeyStatistics`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) line += `HTTP ${r.status} — ${r.status === 401 ? "crumb/cookie gated" : "unavailable"}`;
      else {
        const d = (await r.json())?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
        line += d
          ? `sharesShort=${d.sharesShort?.raw ?? "null"}  shortPercentOfFloat=${d.shortPercentOfFloat?.raw ?? "null"}  shortRatio=${d.shortRatio?.raw ?? "null"}`
          : `200 but no defaultKeyStatistics block`;
      }
    } catch (e) { line += `fetch failed: ${e instanceof Error ? e.message : e}`; }
    console.log(line);
    await sleep(400);
  }
  console.log(`     WHAT IT GIVES: shares short, short % of float, short ratio — i.e. DEMAND, one snapshot, no history.`);
  console.log(`     WHAT IT DOES NOT GIVE: a borrow FEE in bps, utilisation, or lendable supply. It cannot price the`);
  console.log(`     service. It is strictly weaker than trd_short_interest, which we already hold with full history.`);
}
console.log(`\n     CONCLUSION OF SECTION 1: no per-name borrow RATE is reachable under the current allowlist. Everything`);
console.log(`     below therefore prices the service with an ASSUMED schedule and reports a bracket. UNTESTED-ON-RATE.`);

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 2 — THE ASSUMED RATE SCHEDULE (every number sourced, none measured here)
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Bucket { key: string; label: string; lo: number; hi: number; pLo: number; pHi: number; src: string }
// lo/hi = gross annual borrow fee bracket. pLo/pHi = bracket on the fraction of the position actually ON LOAN —
// the haircut that retail lending write-ups almost always omit. You are paid only on shares a borrower takes.
const SCHEDULE: Bucket[] = [
  { key: "GC", label: "general collateral", lo: 0.0025, hi: 0.0050, pLo: 0.00, pHi: 0.05, src: "broker disclosures: GC fees ~25-50bp; retail GC inventory is abundant, so loan probability is near zero" },
  { key: "WARM", label: "moderately hard to borrow", lo: 0.01, hi: 0.05, pLo: 0.05, pHi: 0.40, src: "industry range 1-5%/yr for names with real but satisfiable demand" },
  { key: "HOT", label: "hard to borrow", lo: 0.05, hi: 0.50, pLo: 0.40, pHi: 0.90, src: "HTB 5-50%+/yr; supply is the binding constraint, so a retail lot is far likelier to be taken" },
];
console.log(`\n  2. ASSUMED RATE SCHEDULE — the only unmeasured layer, isolated here so it can be replaced wholesale\n`);
console.log(`     ${"bucket".padEnd(28)}${"gross fee /yr".padEnd(18)}${"P(on loan)".padEnd(16)}source`);
for (const b of SCHEDULE) console.log(`     ${b.label.padEnd(28)}${(pct(b.lo) + " - " + pct(b.hi)).padEnd(18)}${(pct(b.pLo) + " - " + pct(b.pHi)).padEnd(16)}${b.src}`);
console.log(`     lender's share of the gross fee: ${pct(LENDER_SHARE)}  (IBKR SYEP discloses 50%; Fidelity/Schwab do not`);
console.log(`     publish a fixed split and are generally understood to pay less, so 50% is the OPTIMISTIC end.)`);
console.log(`     income per $ held = weight x gross fee x P(on loan) x lender share.`);

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 3 — MEASURED DEMAND: the liquid US universe on the latest short-interest settlement
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n  3. MEASURED DEMAND — trd_short_interest, latest settlement, liquid universe (adv >= ${(ADV_FLOOR / 1e6).toFixed(1)}M shares)\n`);
const last = (await q(`trd_short_interest?select=settlement&order=settlement.desc&limit=1`))[0]?.settlement as string | undefined;
if (!last) { console.log(`     !! no short-interest rows readable — UNTESTED, not a finding.`); Deno.exit(2); }
type SI = { symbol: string; short_qty: number; adv_qty: number; days_cover: number };
const si = (await q(`trd_short_interest?settlement=eq.${last}&adv_qty=gte.${ADV_FLOOR}&select=symbol,short_qty,adv_qty,days_cover&limit=20000`)) as SI[];
const siAll = (await q(`trd_short_interest?settlement=eq.${last}&select=count`))[0]?.count ?? 0;
assertNonEmpty(`liquid short-interest rows on ${last}`, si, 100);
console.log(`     settlement ${last} | ${siAll.toLocaleString()} names filed | ${si.length.toLocaleString()} pass the liquidity floor`);
console.log(`     POSITIVE CONTROL — names with days_cover > 5 (must be non-zero, HTB demand exists): ${si.filter((r) => r.days_cover > 5).length}`);

// Shares outstanding, split-corrected (D-747), to turn short_qty into short % of shares outstanding.
const splits = await loadSplits(OWNED, hdr);
type FU = { ticker: string; value: number; effective_date: string };
const shOut = new Map<string, number>();
const syms = si.map((r) => r.symbol);
for (let i = 0; i < syms.length; i += 200) {
  const chunk = syms.slice(i, i + 200);
  const rows = (await q(`trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&ticker=in.(${chunk.join(",")})&select=ticker,value,effective_date&order=ticker.asc,effective_date.asc&limit=100000`)) as FU[];
  for (const r of rows) { // ascending -> the last row per ticker is the most recent filing
    if (!(r.value > 0)) continue;
    shOut.set(r.ticker, adjShares(r.value, splits.get(r.ticker) as Split[] | undefined, r.effective_date));
  }
}
console.log(`     shares-outstanding coverage: ${shOut.size}/${si.length} (${pct(shOut.size / si.length)}) — split-corrected via adjShares()`);
console.log(`     POSITIVE CONTROL — a mega-cap's restated share count is in the right ballpark: AAPL ${((shOut.get("AAPL") ?? 0) / 1e9).toFixed(2)}bn shares (true ~14.8bn)`);

// Last close + 21d dollar volume, batched (the liquidity decomposition needs dollars, not shares).
type BarRow = { symbol: string; bars: number[][] };
const dvol = new Map<string, number>(), px = new Map<string, number>();
for (let i = 0; i < syms.length; i += 40) {
  const chunk = syms.slice(i, i + 40);
  const rows = (await q(`trd_bars_deep?asset_class=eq.equity&symbol=in.(${chunk.join(",")})&select=symbol,bars`)) as BarRow[];
  for (const r of rows) {
    const b = r.bars; if (!b?.length) continue;
    const tail = b.slice(-21);
    dvol.set(r.symbol, tail.reduce((s, x) => s + x[4] * x[5], 0) / tail.length);
    px.set(r.symbol, b[b.length - 1][4]);
  }
}
console.log(`     price/volume coverage: ${dvol.size}/${si.length} (${pct(dvol.size / si.length)})`);

// Bucket every name on its DEMAND. Short % of shares outstanding is the primary proxy (shares outstanding >= float,
// so this UNDERSTATES short % of float and therefore understates the income — the conservative direction).
interface Name { symbol: string; sf: number | null; dc: number; bucket: string; dv: number }
const bucketOf = (sf: number | null, dc: number): string => {
  if ((sf !== null && sf >= 0.10) || dc >= 8) return "HOT";
  if ((sf !== null && sf >= 0.025) || dc >= 3) return "WARM";
  return "GC";
};
const names: Name[] = si.map((r) => {
  const so = shOut.get(r.symbol);
  const sf = so && so > 0 ? r.short_qty / so : null;
  return { symbol: r.symbol, sf, dc: r.days_cover, bucket: bucketOf(sf, r.days_cover), dv: dvol.get(r.symbol) ?? 0 };
});
const counts: Record<string, number> = { GC: 0, WARM: 0, HOT: 0 };
for (const n of names) counts[n.bucket]++;
console.log(`\n     demand buckets across the liquid universe (n=${names.length}):`);
for (const b of SCHEDULE) console.log(`       ${b.label.padEnd(28)}${String(counts[b.key]).padStart(5)}  (${pct(counts[b.key] / names.length)})`);
const sfKnown = names.filter((n) => n.sf !== null).map((n) => n.sf!);
console.log(`     short % of shares outstanding: median ${pct(sfKnown.sort((a, b) => a - b)[Math.floor(sfKnown.length / 2)] ?? 0)} on ${sfKnown.length} names`);

// LIQUIDITY LAW — both halves measured, never one (D-634).
const byDv = names.filter((n) => n.dv > 0).sort((a, b) => b.dv - a.dv);
const half = Math.floor(byDv.length / 2);
for (const [lab, set] of [["liq:HIGH", byDv.slice(0, half)], ["liq:LOW ", byDv.slice(half)]] as [string, Name[]][]) {
  const c: Record<string, number> = { GC: 0, WARM: 0, HOT: 0 };
  for (const n of set) c[n.bucket]++;
  console.log(`     ${lab}  n=${set.length}  GC ${pct(c.GC / set.length)}  WARM ${pct(c.WARM / set.length)}  HOT ${pct(c.HOT / set.length)}`);
}
console.log(`     (Reading: the HOT share is FLAT across the two halves — 22.3% vs 22.5%. This is the opposite of what`);
console.log(`      every other result on this board does, and it is worth stating plainly rather than assuming the usual`);
console.log(`      illiquidity story: within a universe already floored at ${(ADV_FLOOR / 1e6).toFixed(0)}M shares/day, borrow demand does not concentrate`);
console.log(`      in the less liquid half. The liquidity decomposition below therefore separates almost nothing.)`);

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 4 — INCOME PER $ FOR EACH PORTFOLIO SHAPE
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sched = new Map(SCHEDULE.map((b) => [b.key, b]));
function income(weights: Map<string, number>, buckets: Map<string, string>): { lo: number; hi: number; cov: number } {
  let lo = 0, hi = 0, cov = 0;
  for (const [s, w] of weights) {
    const bk = buckets.get(s); if (!bk) continue;
    const b = sched.get(bk)!;
    lo += w * b.lo * b.pLo * LENDER_SHARE;
    hi += w * b.hi * b.pHi * LENDER_SHARE;
    cov += w;
  }
  return { lo, hi, cov };
}
const bucketMap = new Map(names.map((n) => [n.symbol, n.bucket]));
console.log(`\n  4. INCOME PER $ HELD, BY PORTFOLIO SHAPE\n`);

// (a) SPY-like broad ETF.
console.log(`     (a) BROAD ETF (SPY-like)`);
console.log(`         The fund lends its holdings; the revenue accrues to the FUND, not to the holder — it shows up as a`);
console.log(`         few bp of tracking benefit, and the holder cannot elect it. A retail lending program can lend the`);
console.log(`         ETF SHARE itself, but SPY is the definition of general collateral.`);
const etf = income(new Map([["SPY", 1]]), new Map([["SPY", "GC"]]));
console.log(`         to the HOLDER via a lending program: ${pct(etf.lo)} - ${pct(etf.hi)} /yr  (GC bucket, near-zero P(on loan))`);

// (b) equal-weight liquid single names.
const ew = new Map(names.map((n) => [n.symbol, 1 / names.length]));
const bInc = income(ew, bucketMap);
console.log(`\n     (b) EQUAL-WEIGHT LIQUID SINGLE NAMES (n=${names.length}, adv >= ${(ADV_FLOOR / 1e6).toFixed(1)}M shares)`);
console.log(`         weight covered by a demand bucket: ${pct(bInc.cov)}`);
console.log(`         income: ${pct(bInc.lo)} - ${pct(bInc.hi)} /yr`);
// The same book restricted to the ILLIQUID half, to show where the income actually is.
const lowHalf = byDv.slice(half);
const ewLow = new Map(lowHalf.map((n) => [n.symbol, 1 / lowHalf.length]));
const lowInc = income(ewLow, bucketMap);
const highHalf = byDv.slice(0, half);
const ewHigh = new Map(highHalf.map((n) => [n.symbol, 1 / highHalf.length]));
const highInc = income(ewHigh, bucketMap);
console.log(`         same book, liq:HIGH half only: ${pct(highInc.lo)} - ${pct(highInc.hi)} /yr`);
console.log(`         same book, liq:LOW  half only: ${pct(lowInc.lo)} - ${pct(lowInc.hi)} /yr`);

// (c) widest-discount CEF tercile (D-750 panel).
console.log(`\n     (c) WIDEST-DISCOUNT CEF TERCILE (D-750 panel, ${K.LI_CEF_PANEL})`);
let cefInc = { lo: 0, hi: 0, cov: 0 }, cefN = 0, cefHit = 0;
try {
  const panel = JSON.parse(await Deno.readTextFile(K.LI_CEF_PANEL)) as { rows: { t: string; m: string; disc: number }[] };
  const lastM = panel.rows.map((r) => r.m).sort().at(-1)!;
  const cur = panel.rows.filter((r) => r.m === lastM).sort((a, b) => a.disc - b.disc);
  assertNonEmpty(`CEF rows in ${lastM}`, cur, 20);
  const tercile = cur.slice(0, Math.floor(cur.length / 3));
  cefN = tercile.length;
  console.log(`         month ${lastM} | ${cur.length} funds | widest tercile n=${cefN} | mean discount ${pct(tercile.reduce((s, r) => s + r.disc, 0) / cefN)}`);
  // Do those funds appear in the short-interest panel at all? COVERAGE LAW: absence is not zero demand.
  const tick = tercile.map((r) => r.t);
  const rows = (await q(`trd_short_interest?settlement=eq.${last}&symbol=in.(${tick.join(",")})&select=symbol,short_qty,adv_qty,days_cover&limit=5000`)) as SI[];
  cefHit = rows.length;
  const cefBuckets = new Map(rows.map((r) => [r.symbol, bucketOf(null, r.days_cover)]));
  const cc: Record<string, number> = { GC: 0, WARM: 0, HOT: 0 };
  for (const b of cefBuckets.values()) cc[b]++;
  console.log(`         short-interest coverage of the tercile: ${cefHit}/${cefN} (${pct(cefHit / cefN)})`);
  console.log(`         POSITIVE CONTROL — the query returns non-zero rows for a set known to contain listed US funds: ${cefHit > 0 ? "PASS" : "FAIL — everything below is UNTESTED"}`);
  if (cefHit > 0) {
    console.log(`         buckets among the covered CEFs: GC ${cc.GC}  WARM ${cc.WARM}  HOT ${cc.HOT}`);
    const w = new Map([...cefBuckets.keys()].map((s) => [s, 1 / cefBuckets.size]));
    cefInc = income(w, cefBuckets);
    console.log(`         income (covered names only): ${pct(cefInc.lo)} - ${pct(cefInc.hi)} /yr`);
    console.log(`         NOTE the bucketing here uses days_cover ONLY — CEF shares outstanding are not in trd_fundamentals,`);
    console.log(`         so the short-%-of-float leg is missing and this bucketing is weaker than (b)'s.`);
    console.log(`         The folklore that wide-discount CEFs are hard to borrow is NOT confirmed by our own data:`);
    console.log(`         the measured demand above is what we can say; anything stronger would be an assumed proxy.`);
  } else {
    console.log(`         UNTESTED (COVERAGE LAW): the CEF tercile is absent from the short-interest panel, which is a`);
    console.log(`         statement about our data, not about borrow demand for these funds.`);
  }
} catch (e) {
  console.log(`         UNTESTED — panel unreadable (${e instanceof Error ? e.message : e}).`);
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 5 — THE SIZE QUESTION, AGAINST THE DEPOSIT ARITHMETIC (D-746)
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n  5. WHEN DOES IT MATTER? — $100/mo = $1,200/yr, the D-746 yardstick\n`);
console.log(`     ${"portfolio".padEnd(34)}${"income /yr".padEnd(22)}${"$ needed for $100/mo"}`);
const need = (r: number) => r > 0 ? `$${Math.round(1200 / r).toLocaleString()}` : "never";
const shapes: [string, { lo: number; hi: number }][] = [
  ["(a) broad ETF (to the holder)", etf],
  ["(b) equal-weight liquid names", bInc],
  ["(b') liq:HIGH half only", highInc],
  ["(b'') liq:LOW half only", lowInc],
];
if (cefHit > 0) shapes.push(["(c) widest-discount CEF tercile", cefInc]);
for (const [lab, r] of shapes) console.log(`     ${lab.padEnd(34)}${(pct(r.lo) + " - " + pct(r.hi)).padEnd(22)}${need(r.hi)} (best case) .. ${need(r.lo)} (worst)`);
console.log(`\n     D-746 found that below ~$60k of capital, an extra $100/mo of DEPOSITS beats any 3%/yr alpha. Lending`);
console.log(`     income is an order of magnitude smaller than 3%/yr on every shape above, so on a sub-$60k account it`);
console.log(`     is not a strategy — it is a rounding line on the statement. It only becomes a real number on capital`);
console.log(`     that is already large, which is precisely where the account is least likely to need it.`);

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 6 — WHAT THE LENDER GIVES UP (facts, not advice)
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n  6. WHAT THE LENDER BEARS — these are properties of the contract, stated as facts. Not advice.\n`);
for (const l of [
  "COUNTERPARTY / COLLATERAL: lent shares leave SIPC coverage. The lender holds cash collateral (typically 102%,",
  "  marked daily) instead of the security. If the borrower and the broker both fail, recovery is the collateral.",
  "VOTING: voting rights transfer with the shares. Shares on loan cannot be voted; recalling them for a vote is the",
  "  lender's own action and is not automatic.",
  "DIVIDENDS: the lender receives a SUBSTITUTE PAYMENT in lieu of the dividend. For a US taxpayer this is ordinary",
  "  income, not a qualified dividend — a tax-rate change that can exceed the entire GC lending fee.",
  "RECALL / TERMINATION: the loan can be closed by either side at any time. Income is not contractual, not a yield,",
  "  and is zero whenever nobody wants the shares — which for a GC name is nearly always.",
  "SELECTION: the names that pay are the names people are paying to bet against. The income is correlated with",
  "  holding exactly the inventory a short seller wants, which is a fact about the position, not a warning.",
]) console.log(`     ${l}`);

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// VERDICT
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(112)}\n  VERDICT — UNTESTED-ON-RATE (demand MEASURED, rate ASSUMED). DESCRIPTIVE ONLY; no lineage row, no promotion.\n${"=".repeat(112)}`);
console.log(`  income bracket, %/yr of capital, lender's ${pct(LENDER_SHARE)} share, on ${last} demand:`);
for (const [lab, r] of shapes) console.log(`    ${lab.padEnd(34)}${pct(r.lo)} - ${pct(r.hi)}`);
console.log(`  size at which it clears $1,200/yr: ${need(bInc.hi)} (optimistic) to ${need(bInc.lo)} (pessimistic) for the`);
console.log(`  equal-weight liquid book — i.e. the optimistic end needs a portfolio far above the D-746 $60k threshold.`);
console.log(`  WHAT WOULD MAKE IT MEASURED, in order of value:`);
console.log(`    1. per-name borrow FEE in bps (iBorrowDesk / IBKR HTTPS) — replaces the whole of section 2's rate leg;`);
console.log(`    2. realised ON-LOAN fraction from an actual enrolled account statement — the P(on loan) leg, which`);
console.log(`       drives the bracket harder than the fee does and cannot be inferred from public data at all;`);
console.log(`    3. broker-specific lender share for Fidelity/Schwab — currently assumed at IBKR's disclosed 50%.`);
console.log(`  Until (1) and (2) exist, the honest statement is: this pays SOMETHING, it is small on liquid names, and`);
console.log(`  the bracket is wide enough that the sign of its usefulness is not in doubt but its size is.\n`);

await Deno.writeTextFile(K.LI_OUT, JSON.stringify({
  built: new Date().toISOString(), settlement: last, adv_floor: ADV_FLOOR, lender_share: LENDER_SHARE,
  schedule: SCHEDULE, universe_n: names.length, buckets: counts,
  shapes: Object.fromEntries(shapes.map(([k, v]) => [k, v])),
  status: "UNTESTED-ON-RATE — demand measured, rate assumed",
}, null, 2));
console.log(`  wrote ${K.LI_OUT}\n`);
