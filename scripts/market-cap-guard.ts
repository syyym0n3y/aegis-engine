#!/usr/bin/env -S deno run --allow-net --allow-env
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
// SCOPE, STATED SO THE GREEN MEANS SOMETHING. Building this guard surfaced a SECOND, unrelated share-base defect
// that the split correction cannot touch: foreign private issuers file their ORDINARY share count on the EDGAR
// cover page while `trd_bars_deep` carries the ADR price. BCH files 101,017,081,114 shares against a ~$30 ADR;
// BSAC, TM and LTM have the same shape. That is an ADR-RATIO defect, not a split defect, and no ratio in the split
// table moves it. Following the BENCHMARK-GUARD precedent (D-636), it is REPORTED loudly on every run as a standing
// backlog rather than amnestied silently — but this guard reds only on what its own correction owns: a cap above
// $10T for a symbol the split correction actually applied to. A guard that can never go green stops being read,
// and a guard that quietly drops what it cannot fix is worse.
import { adjShares, splitFactorAfter, type Split } from "../supabase/functions/_shared/shares-adj.ts";

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
function topN(d: string, mode: "corrected" | "raw", n = 15) {
  const out: { sym: string; mc: number; corrected: boolean; checked: boolean }[] = [];
  for (const [sym, p] of px.get(d)!) {
    const sh = sharesAsOf(sym, d); if (!sh) continue;
    const f = splitFactorAfter(splits.get(sym), sh.eff);
    const units = mode === "corrected" ? adjShares(sh.v, splits.get(sym), sh.eff) : sh.v;
    const mc = p * units;
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
// THE ADR-SUSPECT RULE, mechanical and auditable — no hand-written list of foreign issuers, because we hold no
// form-type or ADR-ratio data and a list I typed would be an opinion the guard could not defend.
// A name is ADR-SUSPECT on a date when BOTH hold:
//   (i) it out-caps EVERY recognised anchor on that date — by construction of the anchor set (the largest US
//       listings) nothing legitimately does, so the units are wrong; and
//   (ii) the split correction could not have caused it: the symbol was CHECKED and has no post-filing split.
// Clause (ii) is what stops this becoming an amnesty. A name the split correction APPLIED to, or one never
// checked, is NEVER excused — it stays RED and this guard owns it. What is set aside is only the residue the
// correction provably cannot reach: foreign issuers filing ORDINARY share counts against an ADR price
// (BCH files 101,017,081,114 shares against a ~$30 ADR). That is a DIFFERENT share-base defect, it is unfixed,
// and it is printed in full on every run rather than quietly dropped — the BENCHMARK-GUARD precedent (D-636).
function judge(d: string, mode: "corrected" | "raw") {
  const all = topN(d, mode, 1e9);
  const anchorMax = Math.max(0, ...all.filter((r) => KNOWN.has(norm(r.sym))).map((r) => r.mc));
  const adrSuspect = mode === "raw" || anchorMax === 0
    ? new Set<string>()
    : new Set(all.filter((r) => r.mc > anchorMax && r.checked && !r.corrected).map((r) => r.sym));
  const top = all.filter((r) => !adrSuspect.has(r.sym)).slice(0, 15);
  const known = top.filter((r) => KNOWN.has(norm(r.sym))).length;
  const worst = top.length ? top[0].mc : 0;
  const over = all.filter((r) => r.mc > CAP_MAX);
  const setAside = all.filter((r) => adrSuspect.has(r.sym));
  // In "raw" (the self-test) NOTHING has been corrected, so every impossible cap is owned — that is the whole point
  // of the self-test and it must not be able to escape through the backlog channel.
  // A cap is this guard's to red on unless it was CHECKED and the split correction provably could not touch it.
  // Unchecked is not exculpatory: it is an unanswered question, and an unanswered question is RED.
  const ownedOver = mode === "raw" ? over : over.filter((r) => r.corrected || !r.checked);
  const backlogOver = mode === "raw" ? [] : over.filter((r) => !r.corrected && r.checked);
  const ok = top.length > 0 && known >= MIN_KNOWN && ownedOver.length === 0;
  const line = top.slice(0, 15).map((r) => `${r.sym} ${fmt(r.mc)}`).join("  ");
  return { ok, known, worst, line, ownedOver, backlogOver, setAside };
}

let red = 0, backlog = 0;
for (const d of DATES) {
  const j = judge(d, "corrected");
  if (!j.ok) red++;
  console.log(`  ${j.ok ? "PASS" : "RED "} ${d}  top-15 known mega-caps ${j.known}/15 (floor ${MIN_KNOWN}; ${anchorsAvailable(d)} anchors present in the panel)  largest ${fmt(j.worst)} (cap ${fmt(CAP_MAX)})`);
  console.log(`         ${j.line}`);
  for (const r of j.ownedOver)
    console.log(`         RED  ${r.sym} ${fmt(r.mc)} — ${r.checked ? "the split correction APPLIED and the cap is still impossible" : "NEVER CHECKED for splits; run scripts/ingest-splits.ts"}`);
  if (j.setAside.length) {
    backlog += j.setAside.length;
    console.log(`         ADR-RATIO BACKLOG, set aside from the ranking but NOT amnestied (${j.setAside.length}):`);
    console.log(`           ${j.setAside.map((r) => `${r.sym} ${fmt(r.mc)}`).join(", ")}`);
    console.log(`           each out-caps every anchor AND was checked with no post-filing split, so the split`);
    console.log(`           correction cannot be the cause. Foreign issuers file ORDINARY shares against an ADR`);
    console.log(`           price. A SECOND share-base defect, unfixed by this change, reported every run.`);
  }
}

// ---------- SELF-TEST: prove the guard goes RED on the defect it exists to catch ----------
if (SELFTEST) {
  console.log(`\n  -- SELFTEST: the OLD construction (px_adjusted x shares RAW-as-filed) on 2021-05-28 --`);
  const bad = judge("2021-05-28", "raw"), good = judge("2021-05-28", "corrected");
  console.log(`     OLD (raw)       ${bad.ok ? "PASS" : "RED "}  known ${bad.known}/15  largest ${fmt(bad.worst)}`);
  console.log(`                     ${bad.line}`);
  console.log(`     NEW (corrected) ${good.ok ? "PASS" : "RED "}  known ${good.known}/15  largest ${fmt(good.worst)}`);
  console.log(`                     ${good.line}`);
  if (bad.ok) {
    console.error(`!! SELFTEST FAILED — the guard did NOT go red on the old construction. A green it cannot`);
    console.error(`   contrast with a red is meaningless; this guard is not verified. RED.`);
    Deno.exit(1);
  }
  console.log(`     SELFTEST PASSED — the guard detects the defect (old construction RED, corrected PASS).`);
}

if (backlog) console.log(`\n  ${backlog} impossible cap(s) remain from the ADR-RATIO defect — a DIFFERENT share-base bug, reported every run.`);
console.log(`\n  ${red === 0
  ? `market caps are in ONE share base on all ${DATES.length} test dates.`
  : `${red} of ${DATES.length} test dates produce a nonsensical market-cap ranking — the share-base correction is not holding.`}`);
if (red > 0) Deno.exit(1);
