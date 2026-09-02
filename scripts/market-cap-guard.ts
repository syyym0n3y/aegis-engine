#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// market-cap-guard.ts — THE MACHINE GUARD for the share-base defect.
//
// THE DEFECT. `trd_bars_deep` closes are SPLIT-ADJUSTED (today's share units); `trd_fundamentals` concept
// `EntityCommonStockSharesOutstanding` is RAW AS FILED (the share units of the filing date). `mc = px_adj * sh_raw`
// mixes the two bases and is wrong by the product of every split AFTER the filing date. Verified on live rows:
//     GWAV 2021-05-28: $163,350 adjusted close x 493.7M raw shares = "$80.7T"
//     AAPL 2021-05-28: $121.36 x 16.788B = $2.04T — correct only because AAPL had not split since that filing.
// The contamination is DIRECTIONAL, which is why it needed a guard and not a footnote: names that forward-split
// later are past winners, so their past caps were inflated and every past yield built on them (bm, ep, cfo_yield,
// fcf_yield, buyback_yield, div_yield, shareholder_yield) was deflated for exactly the names that went on to win.
// That is a look-ahead-shaped tilt toward "value works", produced by a units bug rather than by a market.
//
// WHAT IS ENFORCED. On three fixed dates the top-15 by market cap is computed with the CORRECTED construction —
// `adjShares()` from supabase/functions/_shared/shares-adj.ts, the same helper aegis-factory.ts calls, not a copy —
// and the guard goes RED if:
//   (a) fewer than 8 of the top 15 are recognisable mega-caps  (the ranking is nonsense),
//   (b) any market cap exceeds $10T                            (the $80T shape, in units that cannot exist),
//   (c) the split table is empty                               (the correction is a no-op and nobody noticed).
//
// POSITIVE-CONTROL RULE (D-641) / "a green never made to go red is meaningless": with GUARD_SELFTEST=1 the guard
// re-runs 2021-05-28 under the OLD construction (px x RAW shares) and REQUIRES that to fail. It prints both
// rankings side by side and exits non-zero if the old construction does NOT go red — so the guard is proven to
// detect the defect it was written for, rather than merely proven to pass on today's data.
//
// THE SECOND SHARE-BASE DEFECT, NOW ENFORCED RATHER THAN REPORTED (D-747b). Building this guard surfaced a defect
// the split correction cannot touch: a foreign private issuer files its ORDINARY share count on the EDGAR cover
// page while `trd_bars_deep` carries the ADR price. BCH files 101,017,081,114 shares against a ~$30 ADR; LTM
// priced out at $29.05T and BSAC at $6.63T. Until 2026-09-02 that residue was SET ASIDE from the ranking and
// printed as a standing "ADR-RATIO BACKLOG" — honest, but an escape hatch: a cap above $10T could avoid RED by
// being attributable to a defect this guard did not own.
// It is now owned. `scripts/fpi-flags.ts` classifies every ticker from EDGAR submissions (a 20-F/40-F filer is an
// FPI by definition) and MEASURES the ADR ratio where a free source gives one; `mcFpi()` divides the ratio out,
// and an FPI with no usable ratio gets mc = NULL — excluded, not guessed (a missing input is not a zero, D-423).
// So the guard now reds on:
//   (d) any FPI-without-a-ratio appearing in the top-15 (the exclusion did not actually happen), and
//   (e) ANY residual cap above $10T, with no set-aside channel at all.
// The second self-test proves this is not decorative: it recomputes LTM under the PRE-FIX construction (split
// correction applied, ADR correction absent) and REQUIRES that to go red.
import { adjShares, cleanShareSeries, splitFactorAfter, type Split } from "../supabase/functions/_shared/shares-adj.ts";
import { loadFpiFlags, mcFpi } from "../supabase/functions/_shared/fpi-adr.ts";

const OWNED = Deno.env.get("OWNED_REST") || "http://localhost:33000";
const SECRET = Deno.env.get("JWT_SECRET")!;
async function jwt() {
  const e = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = e({ alg: "HS256", typ: "JWT" }), b = e({ role: "service_role", iss: "mcg", exp: 4102444800 });
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${h}.${b}`)));
  return `${h}.${b}.${btoa(String.fromCharCode(...s)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
const hdr = await (async () => { const t = await jwt(); return { Authorization: `Bearer ${t}`, apikey: t }; })();

// D-584: a guard that cannot READ has verified NOTHING and must never certify.
async function mustFetch(path: string, what: string): Promise<Record<string, unknown>[]> {
  let r: Response;
  try { r = await fetch(`${OWNED}/${path}`, { headers: hdr }); }
  catch (e) { console.error(`!! cannot reach ${what}: ${e instanceof Error ? e.message : e} — verified nothing. RED.`); Deno.exit(1); }
  if (!r.ok) { console.error(`!! ${what} returned HTTP ${r.status} — verified nothing. RED.`); Deno.exit(1); }
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) { console.error(`!! ${what} did not return rows — RED.`); Deno.exit(1); }
  return j;
}

const SELFTEST = (Deno.env.get("SELFTEST") || Deno.env.get("GUARD_SELFTEST")) === "1";
const CAP_MAX = 1e13;            // $10T — above any real listed market cap by a wide margin
const MIN_KNOWN = 8;             // of the top 15
// Recognisable mega-caps. Deliberately a fixed list rather than a computed one: the point is an EXTERNAL anchor
// the database cannot move. It spans the three test dates (XOM/JNJ/PG/WMT/BAC top the 2015 board; NVDA/AVGO/LLY
// the recent one), so the same threshold is meaningful at both ends.
// It spans ALL THREE test dates, which the first version did not: anchored only on today's leaders it scored
// 2015-01-02 at 6/15 and red, because the genuine 2015 board is GE, ORCL, WFC, CVX, PFE, KO, T — companies that
// were unambiguously among the largest US listings then and are simply absent from a 2026-flavoured list. That was
// an error in the ANCHOR, not a defect in the data, and fixing it is not loosening the gate: the gate's teeth are
// the $10T ceiling and the self-test below, and every name here is externally, uncontroversially large.
const KNOWN = new Set(["AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "FB", "NVDA", "BRKB", "JPM", "JNJ", "XOM",
  "V", "PG", "UNH", "HD", "WMT", "MA", "BAC", "TSLA", "AVGO", "LLY",
  // era-appropriate large caps, so the 2015 board is judged against the 2015 market
  "GE", "ORCL", "WFC", "CVX", "PFE", "KO", "T", "VZ", "DIS", "INTC", "CSCO", "IBM", "MRK", "PEP", "C", "CMCSA",
  "ABBV", "AMGN", "MCD", "BA", "MMM", "UNP", "HON", "COST", "ADBE", "CRM", "NFLX", "TMO", "ABT", "NKE", "QCOM",
  "TXN", "LIN", "PM", "MO", "SLB", "GILD", "SBUX", "LOW", "CAT", "GS", "MS", "USB", "AXP", "BMY", "DHR", "NEE"]);
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

console.log("==> MARKET CAP GUARD — is px(split-adjusted) x shares(raw-as-filed) being corrected to one share base?");

// ---------- FPI / ADR flags (D-747b) ----------
// A guard that cannot READ its own correction has verified nothing (D-584). An absent flags file makes the ADR
// correction a NO-OP, so it is RED here rather than a quiet pass — the whole point of this change is that the
// residue can no longer be set aside.
const fpi = await loadFpiFlags();
if (!fpi.loaded) {
  console.error(`  RED  data/fpi-flags.json is MISSING — the ADR-ratio correction is a no-op and every foreign-issuer`);
  console.error(`       market cap is still px_adr x shares_ordinary. Run scripts/fpi-flags.ts.`);
  Deno.exit(1);
}
console.log(`    fpi/adr: ${fpi.fpiCount} foreign private issuers — ${fpi.ratio.size} with a MEASURED ratio, ${fpi.exclude.size} excluded (mc=null)`);
if (fpi.fpiCount === 0) {
  console.error(`  RED  the flags file classifies ZERO foreign private issuers — a classifier that separates nothing`);
  console.error(`       is indistinguishable from one that never ran (D-641). Re-run scripts/fpi-flags.ts.`);
  Deno.exit(1);
}

// ---------- splits ----------
const splits = new Map<string, Split[]>();
// Every symbol the ingest has looked at, INCLUDING the "checked, no splits" sentinels. This set is the difference
// between "this name has no post-filing split" and "nobody has ever asked" — and conflating them is exactly the
// POSITIVE-CONTROL failure (D-641), because both look like an empty split list. The first version of this guard
// routed unchecked names into the ADR backlog and so quietly excused GWAV, the very name the defect is named for.
const checked = new Set<string>();
{
  let n = 0;
  for (let off = 0;; off += 10000) {
    const p = await mustFetch(`trd_macro_series?series=like.split:*&select=series,d,v&order=series.asc,d.asc&offset=${off}&limit=10000`, "split table") as unknown as { series: string; d: string; v: number }[];
    if (!p.length) break;
    for (const r of p) {
      checked.add(r.series.slice(6));
      if (r.d === "1900-01-01") continue;                    // "checked, no splits" sentinel
      if (!Number.isFinite(r.v) || !(r.v > 0)) continue;
      const sym = r.series.slice(6);
      (splits.get(sym) ?? splits.set(sym, []).get(sym)!).push({ d: r.d, v: r.v });
      n++;
    }
    if (p.length < 10000) break;
  }
  console.log(`    split table: ${n.toLocaleString()} split events across ${splits.size.toLocaleString()} symbols; ${checked.size.toLocaleString()} symbols checked`);
  if (n === 0) {
    console.error(`  RED  the split table is EMPTY — the share-base correction is a no-op and every market cap in`);
    console.error(`       this database is in mixed units. Run scripts/ingest-splits.ts.`);
    Deno.exit(1);
  }
}

// ---------- shares outstanding, point-in-time (value AND its filing date) ----------
const shares = new Map<string, { eff: string; v: number }[]>();
for (let off = 0;; off += 10000) {
  const p = await mustFetch(`trd_fundamentals?concept=eq.EntityCommonStockSharesOutstanding&select=ticker,effective_date,value&order=effective_date.asc&offset=${off}&limit=10000`, "shares outstanding") as unknown as { ticker: string | null; effective_date: string | null; value: number }[];
  if (!p.length) break;
  for (const r of p) {
    if (!r.ticker || !r.effective_date || !(r.value > 0)) continue;
    (shares.get(r.ticker) ?? shares.set(r.ticker, []).get(r.ticker)!).push({ eff: r.effective_date, v: r.value });
  }
  if (p.length < 10000) break;
}
for (const a of shares.values()) a.sort((x, y) => x.eff < y.eff ? -1 : 1);
// THE THIRD SHARE-BASE DEFECT (D-747f). Neither correction above touches a fact that is corrupt AS FILED: CCL's
// 2021-03-30 filing carries 9.32e11 shares between neighbours of 5.28e8 and 9.86e8, and BTI files 2.46e15 between
// neighbours of 2.46e9 — exactly 1e6, the filer's units error. Those produced the residual RED this guard carried.
// The fix is in the READER (the stored fact is append-only evidence and is not mutated), and it is applied here
// through THE SAME shared helper aegis-factory.ts and factory-forward-score.ts call — a private copy here is how
// D-747 survived its first fix. This is a correction, NOT an escape hatch: a corrupt point is REMOVED from the
// series, so if the resulting cap is still impossible the guard still reds on it.
{
  let nd = 0; const tk: string[] = [];
  for (const [sym, a] of shares) {
    const { kept, dropped } = cleanShareSeries(a.map((x) => ({ eff: x.eff, value: x.v })));
    if (!dropped.length) continue;
    nd += dropped.length; tk.push(sym);
    shares.set(sym, kept.map((x) => ({ eff: x.eff, v: x.value })));
    for (const d of dropped) console.log(`    scrub ${sym} ${d.eff} ${d.value.toExponential(3)} — ${d.reason}`);
  }
  console.log(`    share-fact scrub (D-747f): dropped ${nd} corrupt fact(s) across ${tk.length} ticker(s)${tk.length ? ": " + tk.sort().join(",") : ""}`);
}
function sharesAsOf(sym: string, d: string) {
  const a = shares.get(sym); if (!a?.length) return null;
  let lo = 0, hi = a.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].eff <= d) { best = m; lo = m + 1; } else hi = m - 1; }
  return best < 0 ? null : a[best];
}
console.log(`    share counts: ${shares.size.toLocaleString()} tickers`);
if (shares.size < 1000) { console.error("!! fewer than 1000 tickers carry a share count — cannot certify. RED."); Deno.exit(1); }

// ---------- closes on the test dates ----------
// The universe is exactly the share-carrying tickers: a name with no share count has no market cap either way, so
// including it would change nothing and cost 13,000 bar arrays. Bars are streamed chunk by chunk and only the
// three closes are retained — the full equity panel is 657MB and does not fit in memory.
const SYMS = [...shares.keys()].sort();
const LATEST = await (async () => {
  const r = await mustFetch(`trd_bars_deep?asset_class=eq.equity&symbol=eq.AAPL&select=bars`, "AAPL bars") as unknown as { bars: number[][] }[];
  const b = r[0]?.bars;
  if (!b?.length) { console.error("!! no AAPL bars — cannot establish the latest bar date. RED."); Deno.exit(1); }
  return new Date(b[b.length - 1][0] * 1000).toISOString().slice(0, 10);
})();
const DATES = ["2015-01-02", "2021-05-28", LATEST];
const px = new Map<string, Map<string, number>>();            // date -> sym -> last close on/before date
for (const d of DATES) px.set(d, new Map());

for (let i = 0; i < SYMS.length; i += 100) {
  const part = SYMS.slice(i, i + 100).map((s) => `"${s}"`).join(",");
  const rows = await mustFetch(`trd_bars_deep?asset_class=eq.equity&symbol=in.(${encodeURIComponent(part)})&select=symbol,bars`, "equity bars") as unknown as { symbol: string; bars: number[][] }[];
  for (const r of rows) {
    const b = r.bars; if (!b?.length) continue;
    for (const d of DATES) {
      const cut = Date.parse(d + "T23:59:59Z") / 1000;
      // last bar at or before the date; bars are chronological, so a backward scan from a binary search is exact.
      let lo = 0, hi = b.length - 1, best = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m][0] <= cut) { best = m; lo = m + 1; } else hi = m - 1; }
      if (best < 0) continue;
      // a close more than ~10 days stale means the name was not trading on that date
      if (cut - b[best][0] > 10 * 86400) continue;
      const c = b[best][4];
      if (Number.isFinite(c) && c > 0) px.get(d)!.set(r.symbol, c);
    }
  }
}

// ---------- the ranking, under either construction ----------
// `mode` is the ONLY difference between the guard's check and its self-test: "corrected" restates the raw filed
// count into today's share units via the shared helper; "raw" is the defect exactly as aegis-factory.ts had it.
type Mode = "corrected" | "raw" | "nofpi";
function topN(d: string, mode: Mode, n = 15) {
  const out: { sym: string; mc: number; corrected: boolean; checked: boolean }[] = [];
  for (const [sym, p] of px.get(d)!) {
    const sh = sharesAsOf(sym, d); if (!sh) continue;
    const f = splitFactorAfter(splits.get(sym), sh.eff);
    // "raw"       = the original D-747 defect: price x shares exactly as filed, no correction at all.
    // "nofpi"     = the PRE-FIX construction of D-747b: split correction applied, ADR correction absent. This is
    //               what produced LTM $29.05T, and selftest 2 requires it to go red.
    // "corrected" = both corrections: split-restated shares, then the measured ADR ratio divided out, and NULL
    //               (dropped entirely) for a foreign issuer whose ratio is unknown.
    const units = mode === "raw" ? sh.v : adjShares(sh.v, splits.get(sym), sh.eff);
    const mc = mode === "corrected" ? mcFpi(p, units, sym, fpi) : p * units;
    if (mc == null) continue;
    // `corrected` records whether the split correction actually did anything to this name. It is what separates a
    // cap this guard OWNS (the correction applied and the number is still impossible -> RED) from one it cannot
    // reach (factor 1.0, so the remaining error has a different cause -> reported as backlog).
    if (Number.isFinite(mc) && mc > 0) out.push({ sym, mc, corrected: mode === "corrected" && f !== 1, checked: checked.has(sym) });
  }
  out.sort((a, b) => b.mc - a.mc);
  return out.slice(0, n);
}
const fmt = (x: number) => x >= 1e12 ? `$${(x / 1e12).toFixed(2)}T` : x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : `$${(x / 1e6).toFixed(0)}M`;
// COVERAGE LAW: before reading a low anchor count as a defect, state how many anchors the data could have
// produced at all. On 2015-01-02 only 1,425 of 6,151 tickers carry a share count and GOOGL/BRK-B/META carry none
// ever, so a shortfall there may be an absent INPUT rather than a broken construction — the guard says which.
function anchorsAvailable(d: string): number {
  let n = 0;
  for (const [sym] of px.get(d)!) if (KNOWN.has(norm(sym)) && sharesAsOf(sym, d)) n++;
  return n;
}
// THE ADR RESIDUE IS NO LONGER SET ASIDE (D-747b). The previous version excused a cap above $10T when it
// out-capped every anchor AND the split correction provably could not have caused it, printing it as a standing
// "ADR-RATIO BACKLOG". That was honest about the defect and still an escape hatch — a number in impossible units
// could stay out of RED by being attributed to a defect the guard did not own. Now it is owned: foreign private
// issuers are classified from EDGAR and either CORRECTED by a measured ADR ratio or EXCLUDED (mc = null), so under
// "corrected" there is no residue to set aside and no channel through which one could hide.
// Under "corrected" the guard reds on:
//   (a) fewer than MIN_KNOWN of the top 15 recognisable,
//   (b) ANY cap above $10T — no exemption, whatever caused it,
//   (d) an FPI-without-a-ratio appearing in the top 15, which would mean the exclusion did not actually happen.
function judge(d: string, mode: Mode) {
  const all = topN(d, mode, 1e9);
  const top = all.slice(0, 15);
  const known = top.filter((r) => KNOWN.has(norm(r.sym))).length;
  const worst = top.length ? top[0].mc : 0;
  // (b) EVERY cap above the ceiling is this guard's, in every mode. The old `ownedOver`/`backlogOver` split is
  // deliberately gone: that split is exactly what let LTM's $29.05T sit green for as long as it did.
  const over = all.filter((r) => r.mc > CAP_MAX);
  // (d) the exclusion actually happened. `corrected` mode routes an FPI without a ratio through mcFpi -> null, so
  // this list must be empty; a non-empty one means the flags were loaded and then not applied.
  const fpiInTop = mode === "corrected" ? top.filter((r) => fpi.exclude.has(r.sym)) : [];
  const ok = top.length > 0 && known >= MIN_KNOWN && over.length === 0 && fpiInTop.length === 0;
  const line = top.slice(0, 15).map((r) => `${r.sym} ${fmt(r.mc)}`).join("  ");
  return { ok, known, worst, line, over, fpiInTop };
}

let red = 0;
for (const d of DATES) {
  const j = judge(d, "corrected");
  if (!j.ok) red++;
  console.log(`  ${j.ok ? "PASS" : "RED "} ${d}  top-15 known mega-caps ${j.known}/15 (floor ${MIN_KNOWN}; ${anchorsAvailable(d)} anchors present in the panel)  largest ${fmt(j.worst)} (cap ${fmt(CAP_MAX)})`);
  console.log(`         ${j.line}`);
  for (const r of j.over)
    console.log(`         RED  ${r.sym} ${fmt(r.mc)} — above the $10T ceiling. ${r.checked ? (r.corrected ? "The split correction APPLIED and the cap is still impossible" : "Checked for splits, none after the filing; and it is not an excluded foreign issuer, so the ADR correction does not explain it either") : "NEVER CHECKED for splits; run scripts/ingest-splits.ts"}`);
  for (const r of j.fpiInTop)
    console.log(`         RED  ${r.sym} ${fmt(r.mc)} — a foreign private issuer with NO measured ADR ratio is in the top 15; it should have been excluded (mc=null), so the flags were read and not applied.`);
}

// ---------- SELF-TESTS: prove the guard goes RED on both defects it exists to catch ----------
// A green never made to go red is meaningless (D-641). There are TWO defects here and therefore two self-tests:
// one per correction. Test 2 exists because test 1 could not have caught D-747b at all — the split construction
// was already correct for LTM and the guard still let $29.05T through.
if (SELFTEST) {
  let stFail = 0;
  console.log(`\n  -- SELFTEST 1: the ORIGINAL construction (px_adjusted x shares RAW-as-filed) on 2021-05-28 --`);
  const bad = judge("2021-05-28", "raw"), good = judge("2021-05-28", "corrected");
  console.log(`     OLD (raw)       ${bad.ok ? "PASS" : "RED "}  known ${bad.known}/15  largest ${fmt(bad.worst)}`);
  console.log(`                     ${bad.line}`);
  console.log(`     NEW (corrected) ${good.ok ? "PASS" : "RED "}  known ${good.known}/15  largest ${fmt(good.worst)}`);
  console.log(`                     ${good.line}`);
  if (bad.ok) {
    console.error(`!! SELFTEST 1 FAILED — the guard did NOT go red on the original construction.`);
    stFail++;
  } else {
    // Report what the corrected side ACTUALLY did. The first version of this line printed "corrected PASS"
    // unconditionally, which was false on any date where a DIFFERENT defect still reds the corrected board —
    // exactly the narration failure this repo keeps catching, committed inside the guard meant to prevent it.
    console.log(`     SELFTEST 1 PASSED — the split defect is detected (raw RED; corrected ${good.ok ? "PASS" : "still RED for an unrelated reason, see above"}).`);
  }

  // SELFTEST 2 (D-747b). The PRE-FIX construction: split correction fully applied, ADR correction absent. This is
  // exactly what the guard ran under until today, and it is what printed LTM at $29.05T while passing. The test is
  // written on LTM by name because LTM is the specific number that motivated the change — an anonymous "some cap
  // is large" assertion would pass on any noise and prove nothing.
  console.log(`\n  -- SELFTEST 2: the PRE-FIX construction (split-corrected shares, NO ADR ratio) — LTM --`);
  const preAll = topN(LATEST, "nofpi", 1e9), postAll = topN(LATEST, "corrected", 1e9);
  const preLTM = preAll.find((r) => r.sym === "LTM"), postLTM = postAll.find((r) => r.sym === "LTM");
  const pre = judge(LATEST, "nofpi");
  console.log(`     PRE  (no ADR fix) ${pre.ok ? "PASS" : "RED "}  LTM ${preLTM ? fmt(preLTM.mc) : "absent"}  largest ${fmt(pre.worst)}  caps over $10T: ${pre.over.length}`);
  console.log(`                       ${pre.line}`);
  const post = judge(LATEST, "corrected");
  console.log(`     POST (ADR fixed)  ${post.ok ? "PASS" : "RED "}  LTM ${postLTM ? fmt(postLTM.mc) : "EXCLUDED (mc=null)"}  largest ${fmt(post.worst)}  caps over $10T: ${post.over.length}`);
  console.log(`                       ${post.line}`);
  if (!preLTM) {
    console.error(`!! SELFTEST 2 INCONCLUSIVE — LTM carries no cap under the pre-fix construction, so the test`);
    console.error(`   asserted nothing. A test that cannot fire is not a test (D-641).`);
    stFail++;
  } else if (preLTM.mc <= CAP_MAX) {
    console.error(`!! SELFTEST 2 FAILED — LTM prices at ${fmt(preLTM.mc)} pre-fix, under the $10T ceiling, so the`);
    console.error(`   guard would not have red-ed on the defect this change exists to fix.`);
    stFail++;
  } else if (pre.ok) {
    console.error(`!! SELFTEST 2 FAILED — LTM is ${fmt(preLTM.mc)} pre-fix and the guard still PASSED. The residue`);
    console.error(`   is escaping the ceiling; the set-aside channel has not actually been closed.`);
    stFail++;
  } else if (!post.ok) {
    console.error(`!! SELFTEST 2 FAILED — the guard is red under the CORRECTED construction too, so the red above`);
    console.error(`   is not evidence the ADR fix works. A guard that cannot go green after a fix gets ignored.`);
    stFail++;
  } else {
    console.log(`     SELFTEST 2 PASSED — pre-fix RED (LTM ${fmt(preLTM.mc)} > $10T), corrected PASS (LTM ${postLTM ? fmt(postLTM.mc) : "excluded"}).`);
  }
  if (stFail) { console.error(`!! ${stFail} selftest(s) failed — this guard is NOT verified. RED.`); Deno.exit(1); }
}

console.log(`\n  ${red === 0
  ? `market caps are in ONE share base on all ${DATES.length} test dates.`
  : `${red} of ${DATES.length} test dates produce a nonsensical market-cap ranking — the share-base correction is not holding.`}`);
if (red > 0) Deno.exit(1);
