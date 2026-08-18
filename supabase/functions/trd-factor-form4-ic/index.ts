// trd-factor-form4-ic (D-331) — the FIRST EQUITY factor wired through the modular causal engine.
// Force: opportunistic insider conviction (SEC Form-4 open-market PURCHASES, code 'P'/acquired). Mechanism: an insider
// spending own cash on the open market is the most credible legal information signal (Cohen-Malloy: the OPPORTUNISTIC —
// irregular-timing — subset predicts; routine/scheduled buys do not). Pre-registered hypothesized_sign = +1 (insider
// buying → positive forward return). Point-in-time honesty is STRUCTURAL: effective_date = the SEC filing/disclosure
// date (legally knowable), ts = the transaction date; the trd_factor_value CHECK (effective_date >= ts) makes the STOCK
// Act-style lag impossible to engineer away. Forward returns from keyless Yahoo daily bars. Keyless, $0, paper-only.
//
// Reuses supabase/functions/_shared/trd-edgar.ts (parseForm4 / isOpenMarketBuy) for the ownership-XML parsing.
// NOTE on the opportunistic-vs-routine classifier: DEFERRED to a follow-up (recorded in detail). Classifying a buy as
// opportunistic per Cohen-Malloy requires each insider's multi-year trade calendar (irregular timing) — too heavy for a
// single edge-function invocation. This first cut measures ALL open-market buys; the classifier is the next iteration.
//
// D-341 — the IC is now reported through the EFFECTIVE-N gate (`_shared/trd-effective-n.ts`). D-336 concluded from a
// pooled 21d IC of −0.515 at "N=18" whose pool was dominated by ONE issuer (BAC 15/24 events) with heavily overlapping
// 21-day forward windows: that naive t=−2.40 was one name's buy-timing counted many times. `ic_t` written here is
// computed on the number of INDEPENDENT (symbol, horizon-block) clusters, and the per-symbol grid is written alongside
// the pool because ANALYSIS_CONTRACT Rule 8 forbids a verdict from an aggregate.
import { parseForm4, isOpenMarketBuy } from "../_shared/trd-edgar.ts";
import { dayIndex, effectiveRankIC, type ICObs } from "../_shared/trd-effective-n.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UA = { "User-Agent": "aegis-research ona@revitalise.io" }; // SEC requires a descriptive UA (<=10 req/s)
const FACTOR = "form4_opportunistic";
const SYMSET = "us_insider";

// Universe: liquid names with genuine open-market-insider-BUY propensity. Verified empirically (dry runs): mega-caps
// (AAPL/MSFT/NVDA/...) produce ~zero code-P open-market buys — their insiders receive grants and SELL, they do not buy
// on the open market — so pooling them contributes only dead fetches and no signal. Per Cohen-Malloy the opportunistic
// signal concentrates in financials/energy/mid-caps where insiders deploy their own cash. Still fully liquid + large.
const UNIVERSE = [
  "BAC","WFC","C","USB","PNC","TFC","KEY","HBAN","RF","CFG",                // banks — highest open-market-buy propensity
  "FITB","ZION","COF","ALLY","SYF","SCHW","MS","OXY","DVN","APA",           // more financials + energy
  "EQT","F","PFE","GM","T","VZ","GE","BA","INTC","CMCSA",                   // higher-insider-turnover large caps
];

const HORIZONS: [string, number][] = [["5d", 5], ["21d", 21]];
// Independence floor for a WRITTEN significance claim. Kept at 10 for the same reason the old local rankIC used 10 —
// open-market insider buys are genuinely sparse — but it now counts INDEPENDENT CLUSTERS, not raw filings, so it is a
// far harder floor to clear than the number it replaces. Below it, effectiveRankIC returns tEff = 0 (fails closed).
const MIN_EFF_N = 10;
// A per-symbol cut needs at least this many observations before a row is written, so the disaggregated grid Rule 8
// requires does not fill trd_factor_ic with one-observation cells.
const MIN_MEMBER_OBS = 5;
async function jget(u: string, headers: Record<string, string>) { try { const r = await fetch(u, { headers }); return r.ok ? await r.json() : null; } catch { return null; } }
async function tget(u: string, headers: Record<string, string>) { try { const r = await fetch(u, { headers }); return r.ok ? await r.text() : null; } catch { return null; } }
const beat = (o: string) => fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-factor-form4-ic", p_outcome: o.slice(0, 180) }) }).catch(() => {});

// Yahoo daily closes as [{d:'YYYY-MM-DD', c:number}] ascending.
async function dailyBars(sym: string): Promise<{ d: string; c: number }[]> {
  const j = await jget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y`, { "User-Agent": "Mozilla/5.0" });
  const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const cl = res.indicators?.quote?.[0]?.close ?? []; const out: { d: string; c: number }[] = [];
  for (let i = 0; i < res.timestamp.length; i++) { const c = cl[i]; if (c != null && Number.isFinite(c)) out.push({ d: new Date(res.timestamp[i] * 1000).toISOString().slice(0, 10), c }); }
  return out;
}
// forward simple return H trading days after the first bar on/after effective date D; null if window unavailable.
function fwdRet(bars: { d: string; c: number }[], D: string, Hd: number): number | null {
  let e = bars.findIndex((b) => b.d >= D); if (e < 0 || e + Hd >= bars.length) return null;
  const p0 = bars[e].c, p1 = bars[e + Hd].c; return p0 > 0 ? (p1 - p0) / p0 : null;
}

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const q = new URL(req.url).searchParams;
    const dry = q.get("dry") === "1";
    const NT = Math.min(UNIVERSE.length, +(q.get("nt") ?? "20"));           // ticker cap (CPU/wall bound)
    const NF = +(q.get("nf") ?? "18");                                       // Form-4 filings parsed per ticker
    const syms = UNIVERSE.slice(0, NT);

    // ticker -> zero-padded CIK from the keyless SEC map (one fetch, filtered to our universe)
    const map = await jget("https://www.sec.gov/files/company_tickers.json", UA) as Record<string, { cik_str: number; ticker: string }> | null;
    if (!map) { await beat("sec ticker map fetch failed"); return new Response(JSON.stringify({ ok: false, err: "sec company_tickers fetch failed" }), { status: 502, headers: cors }); }
    const cik = new Map<string, string>();
    for (const v of Object.values(map)) if (syms.includes(v.ticker)) cik.set(v.ticker, String(v.cik_str).padStart(10, "0"));

    // pooled observations per horizon (each tagged with its symbol + the day its forward window starts, so the
    // effective-N gate can count independent clusters) + PIT value rows
    const pool: Record<string, ICObs[]> = { "5d": [], "21d": [] };
    const valRows: Record<string, unknown>[] = []; const per: Record<string, unknown>[] = [];
    let leak = 0, events = 0;
    // Hard wall-clock budget: the edge runtime kills the request at 150s. Stop fetching new filings at 120s and compute
    // the IC on whatever was pooled — a completing, honest partial beats a 504 with no result. Records budget_capped.
    const t0 = Date.now(); const BUDGET_MS = +(q.get("budget_ms") ?? "120000"); let capped = false;

    for (const sym of syms) {
      if (Date.now() - t0 > BUDGET_MS) { capped = true; per.push({ sym, skip: "budget" }); continue; }
      const c = cik.get(sym); if (!c) { per.push({ sym, skip: "no_cik" }); continue; }
      const sub = await jget(`https://data.sec.gov/submissions/CIK${c}.json`, UA);
      const r = sub?.filings?.recent; if (!r?.form) { per.push({ sym, skip: "no_submissions" }); continue; }
      const bars = await dailyBars(sym); if (bars.length < 40) { per.push({ sym, skip: "thin_bars" }); continue; }

      // most-recent Form-4 filings, capped
      const idxs: number[] = []; for (let i = 0; i < r.form.length && idxs.length < NF; i++) if (r.form[i] === "4") idxs.push(i);
      let symEvents = 0;
      for (const i of idxs) {
        if (Date.now() - t0 > BUDGET_MS) { capped = true; break; }
        const acc = r.accessionNumber[i] as string; const filingDate = r.filingDate[i] as string; // legally-knowable disclosure date
        const accNoDash = acc.replace(/-/g, "");
        const txt = await tget(`https://www.sec.gov/Archives/edgar/data/${Number(c)}/${accNoDash}/${acc}.txt`, UA);
        if (!txt) continue;
        const f4 = parseForm4(txt);
        const buys = f4.transactions.filter(isOpenMarketBuy);
        if (buys.length === 0) continue;                                     // only open-market conviction PURCHASES
        const notional = buys.reduce((s, t) => s + (t.shares ?? 0) * (t.price ?? 0), 0);
        const shares = buys.reduce((s, t) => s + (t.shares ?? 0), 0);
        if (notional <= 0) continue;
        const txnDate = buys.map((t) => t.date).filter(Boolean).sort()[0] as string | undefined; // earliest P transaction date = ts
        if (!txnDate) continue;
        if (!(filingDate >= txnDate)) { leak++; continue; }                  // structural PIT guard: disclosure never precedes trade
        const value = Math.log10(1 + notional);                             // buy-intensity signal (conviction $, log-scaled)
        events++; symEvents++;
        valRows.push({ factor_id: FACTOR, symbol: sym, ts: `${txnDate}T00:00:00Z`, effective_date: `${filingDate}T00:00:00Z`, value: +value.toFixed(4), raw: { notional: +notional.toFixed(2), shares, n_buys: buys.length, accession: acc, filing_date: filingDate, txn_date: txnDate, opportunistic_classified: false } });
        // pool value vs forward return measured FROM the disclosure date (what a strategy could actually trade)
        for (const [hk, hd] of HORIZONS) {
          const fr = fwdRet(bars, filingDate, hd); if (fr === null) continue;
          pool[hk].push({ member: sym, day: dayIndex(filingDate), x: value, y: fr });
        }
      }
      per.push({ sym, cik: c, events: symEvents });
    }

    // Rule 8 (D-334): the DISAGGREGATED grid is the evidence; the pool is a footnote to it. Every cell is a trial.
    const ics: Record<string, ReturnType<typeof effectiveRankIC>> = {};
    const grid: Record<string, unknown>[] = [];   // one row per (horizon × symbol) cut, for trd_factor_ic + the response
    for (const [hk, hd] of HORIZONS) {
      ics[hk] = effectiveRankIC(pool[hk], hd, MIN_EFF_N);
      const byMember = new Map<string, ICObs[]>();
      for (const o of pool[hk]) { const a = byMember.get(o.member) ?? []; a.push(o); byMember.set(o.member, a); }
      for (const [sym, obs] of byMember) {
        if (obs.length < MIN_MEMBER_OBS) continue;
        const r = effectiveRankIC(obs, hd, MIN_EFF_N);
        grid.push({ symbol_set: `sym:${sym}`, horizon: hk, ...r });
      }
    }

    // Dedupe by PK (factor_id,symbol,ts): two distinct Form-4 filings can share the same earliest transaction date, which
    // would make ON CONFLICT try to update the same target row twice in one batch (pg 21000). Keep the max-conviction ($) row.
    const dedup = new Map<string, Record<string, unknown>>();
    for (const r of valRows) { const k = `${r.symbol}|${r.ts}`; const prev = dedup.get(k); if (!prev || (r.value as number) > (prev.value as number)) dedup.set(k, r); }
    const uniqRows = [...dedup.values()];
    let written = 0; let writeErr: string | null = null;
    let icWritten = 0; let icErr: string | null = null;
    if (!dry) {
      for (let i = 0; i < uniqRows.length; i += 1000) { const res = await fetch(`${SB}/rest/v1/trd_factor_value?on_conflict=factor_id,symbol,ts`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(uniqRows.slice(i, i + 1000)) }); if (res.ok) written += uniqRows.slice(i, i + 1000).length; else if (!writeErr) writeErr = `${res.status}:${(await res.text()).slice(0, 200)}`; }
      // `n` written is the EFFECTIVE cluster count, not the raw filing count, so the (ic, ic_t, n) triple in the row is
      // internally consistent — a reader can recompute ic_t from ic and n. The raw count and the inflation factor live
      // in `detail`, which is where D-336's "N=18" belonged. The write outcome is CAPTURED, not swallowed: a
      // `.catch(() => {})` on an evidence write is the D-300b/D-302 silent-failure class that already cost this repo
      // an "ok:true" run that wrote nothing.
      const cells = [...HORIZONS.map(([hk]) => ({ symbol_set: `${SYMSET}${syms.length}`, horizon: hk, ...ics[hk] })), ...grid] as Record<string, number | string | boolean>[];
      for (const r of cells) {
        try {
          const res = await fetch(`${SB}/rest/v1/trd_factor_ic`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ factor_id: FACTOR, symbol_set: r.symbol_set, horizon: r.horizon, ic: r.ic, ic_t: r.tEff, n: r.effN, regime: null, n_trials: cells.length, detail: `rank-IC of log10($ open-market insider buys) vs fwd ret from FILING DATE; hypo sign +1. n = effN (independent symbol × horizon-block clusters) of raw ${r.n} obs, VIF ${r.vif}x, top member ${r.maxMemberShare} of n; naive t would be ${r.tNaive} (D-341 effective-N gate). ${events} events / ${syms.length} tickers; opportunistic-vs-routine classifier DEFERRED (measures all code-P buys)` }) });
          if (res.ok) icWritten++; else if (!icErr) icErr = `${res.status}:${(await res.text()).slice(0, 200)}`;
        } catch (e) { if (!icErr) icErr = String(e).slice(0, 200); }
      }
      // Every cut is a comparison (Rule 8.3) — the trial counter takes the WHOLE grid, not one bump per horizon.
      await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: cells.length }) }).catch(() => {});
      await fetch(`${SB}/rest/v1/trd_factor?id=eq.${FACTOR}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "measuring" }) }).catch(() => {});
    }
    await beat(`ic5d=${ics["5d"].ic}(effN${ics["5d"].effN}/n${ics["5d"].n} t${ics["5d"].tEff}) ic21d=${ics["21d"].ic}(effN${ics["21d"].effN}/n${ics["21d"].n} t${ics["21d"].tEff}) events=${events} leak=${leak} vals=${written} ics=${icWritten} dry=${dry}`);
    return new Response(JSON.stringify({ ok: true, factor: FACTOR, hypothesized_sign: 1, symbol_set: `${SYMSET}${syms.length}`, caps: { tickers: NT, filings_per_ticker: NF }, budget_capped: capped, elapsed_s: +((Date.now() - t0) / 1000).toFixed(1), ic_pooled: ics, ic_grid: grid, events, values_written: written, write_err: writeErr, ic_rows_written: icWritten, ic_write_err: icErr, leakage_skipped: leak, opportunistic_classifier: "deferred", per_symbol: per }, null, 2), { headers: cors });
  } catch (e) { await beat(`err ${String(e).slice(0, 120)}`); return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
