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
import { parseForm4, isOpenMarketBuy } from "../_shared/trd-edgar.ts";

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

function rankIC(xs: number[], ys: number[]) {
  // Floor at 10 (not 30): open-market insider BUYS are genuinely sparse events — one keyless SEC invocation pools ~25-30.
  // The honest-stats discipline is "report the IC next to its N": a small N speaks through a small t-stat, which is more
  // truthful than flooring the sign to zero. Anything below ~n=25 here is UNDERPOWERED and must be read as such.
  const n = xs.length; if (n < 10) return { ic: 0, t: 0, n };
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]); const r = new Array(n); for (let k = 0; k < n; k++) r[idx[k][1]] = k; return r; };
  const rx = rank(xs), ry = rank(ys); const mx = (n - 1) / 2;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - mx; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const ic = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(ic) < 1 ? ic * Math.sqrt((n - 2) / (1 - ic * ic)) : 0;
  return { ic: +ic.toFixed(4), t: +t.toFixed(2), n };
}
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

    // pooled (value, fwd) pairs per horizon + PIT value rows
    const pool: Record<string, { x: number[]; y: number[] }> = { "5d": { x: [], y: [] }, "21d": { x: [], y: [] } };
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
        for (const [hk, hd] of [["5d", 5], ["21d", 21]] as [string, number][]) {
          const fr = fwdRet(bars, filingDate, hd); if (fr === null) continue;
          pool[hk].x.push(value); pool[hk].y.push(fr);
        }
      }
      per.push({ sym, cik: c, events: symEvents });
    }

    const ics: Record<string, { ic: number; t: number; n: number }> = {};
    for (const hk of ["5d", "21d"]) ics[hk] = rankIC(pool[hk].x, pool[hk].y);

    // Dedupe by PK (factor_id,symbol,ts): two distinct Form-4 filings can share the same earliest transaction date, which
    // would make ON CONFLICT try to update the same target row twice in one batch (pg 21000). Keep the max-conviction ($) row.
    const dedup = new Map<string, Record<string, unknown>>();
    for (const r of valRows) { const k = `${r.symbol}|${r.ts}`; const prev = dedup.get(k); if (!prev || (r.value as number) > (prev.value as number)) dedup.set(k, r); }
    const uniqRows = [...dedup.values()];
    let written = 0; let writeErr: string | null = null;
    if (!dry) {
      for (let i = 0; i < uniqRows.length; i += 1000) { const res = await fetch(`${SB}/rest/v1/trd_factor_value?on_conflict=factor_id,symbol,ts`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(uniqRows.slice(i, i + 1000)) }); if (res.ok) written += uniqRows.slice(i, i + 1000).length; else if (!writeErr) writeErr = `${res.status}:${(await res.text()).slice(0, 200)}`; }
      for (const hk of ["5d", "21d"]) {
        const ic = ics[hk];
        await fetch(`${SB}/rest/v1/trd_factor_ic`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ factor_id: FACTOR, symbol_set: `${SYMSET}${syms.length}`, horizon: hk, ic: ic.ic, ic_t: ic.t, n: ic.n, regime: null, n_trials: 1, detail: `pooled rank-IC of log10($ open-market insider buys) vs fwd ret from FILING DATE; hypo sign +1; ${events} events / ${syms.length} tickers; opportunistic-vs-routine classifier DEFERRED (measures all code-P buys)` }) }).catch(() => {});
        await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }).catch(() => {});
      }
      await fetch(`${SB}/rest/v1/trd_factor?id=eq.${FACTOR}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "measuring" }) }).catch(() => {});
    }
    await beat(`ic5d=${ics["5d"].ic}(n${ics["5d"].n}) ic21d=${ics["21d"].ic}(n${ics["21d"].n}) events=${events} leak=${leak} dry=${dry}`);
    return new Response(JSON.stringify({ ok: true, factor: FACTOR, hypothesized_sign: 1, symbol_set: `${SYMSET}${syms.length}`, caps: { tickers: NT, filings_per_ticker: NF }, budget_capped: capped, elapsed_s: +((Date.now() - t0) / 1000).toFixed(1), ic: ics, events, values_written: written, write_err: writeErr, leakage_skipped: leak, opportunistic_classifier: "deferred", per_symbol: per }, null, 2), { headers: cors });
  } catch (e) { await beat(`err ${String(e).slice(0, 120)}`); return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
