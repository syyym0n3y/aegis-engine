// trd-gex-name (D-354) — PER-NAME dealer gamma (GEX), FREE + KEYLESS via Nasdaq's public option-chain (no crumb, no key,
// no OPRA spend). Nasdaq gives per-strike bid/ask/OI; we solve implied vol from the mid-price (bisection) → Black-Scholes
// gamma → net GEX = Σ[call:+Γ·OI, put:−Γ·OI]·S²·100·0.01. Positive = dealers long gamma (vol-suppress/pin), negative =
// short gamma (amplify). Snapshots a universe daily into trd_gex_name to ACCUMULATE the series needed to backtest per-name
// GEX (the chain is a live snapshot; we build the history ourselves, free). Complements the proven market-level GEX (IC −0.49).
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", "Accept": "application/json, text/plain, */*" };
const UNIV = ["SPY","QQQ","AAPL","MSFT","NVDA","TSLA","AMD","META","AMZN","GOOGL","JPM","XOM","INTC","BAC","F"];
const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const ncdf = (x: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = npdf(x); let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); if (x > 0) p = 1 - p; return p; };
function bsPrice(S: number, K: number, T: number, iv: number, isCall: boolean) { if (iv <= 0 || T <= 0) return Math.max(0, isCall ? S - K : K - S); const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T)), d2 = d1 - iv * Math.sqrt(T); return isCall ? S * ncdf(d1) - K * ncdf(d2) : K * ncdf(-d2) - S * ncdf(-d1); }
function impliedVol(price: number, S: number, K: number, T: number, isCall: boolean) { if (!(price > 0) || T <= 0) return 0; let lo = 0.01, hi = 5; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; (bsPrice(S, K, T, mid, isCall) > price) ? hi = mid : lo = mid; } const iv = (lo + hi) / 2; return iv > 0.02 && iv < 4.9 ? iv : 0; }
function bsGamma(S: number, K: number, T: number, iv: number) { if (!(S > 0) || !(K > 0) || !(T > 0) || !(iv > 0)) return 0; const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T)); return npdf(d1) / (S * iv * Math.sqrt(T)); }

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const today = new Date().toISOString().slice(0, 10), now = Date.now();
    const rows: Record<string, unknown>[] = [], out: Record<string, unknown>[] = [];
    for (const sym of UNIV) {
      try {
        // spot (keyless Yahoo chart)
        const qj = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`, { headers: UA }).then((r) => r.json()).catch(() => null);
        const S = qj?.chart?.result?.[0]?.meta?.regularMarketPrice; if (!(S > 0)) { out.push({ sym, skip: "no spot" }); continue; }
        // Nasdaq option chain (keyless)
        const aclass = ["SPY", "QQQ", "IWM", "DIA", "GLD", "TLT"].includes(sym) ? "etf" : "stocks";
        const cj = await fetch(`https://api.nasdaq.com/api/quote/${sym}/option-chain?assetclass=${aclass}&limit=200&fromdate=all&excode=oprac&callput=callput&money=all&type=all`, { headers: UA }).then((r) => r.json()).catch(() => null);
        const rowsN = cj?.data?.table?.rows as Record<string, string>[] | undefined; if (!rowsN?.length) { out.push({ sym, skip: "no chain" }); continue; }
        // use the nearest expiry only (near-term gamma dominates)
        const exps = [...new Set(rowsN.map((r) => r.expiryDate).filter(Boolean))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        const nearExp = exps[0]; const expMs = new Date(nearExp).getTime();
        const T = (Number.isFinite(expMs) && expMs > now) ? (expMs - now) / (365.25 * 86400 * 1000) : 1 / 52;
        let gex = 0, contracts = 0;
        for (const r of rowsN) {
          if (r.expiryDate !== nearExp) continue; const K = +r.strike; if (!(K > 0)) continue;
          const cMid = (+r.c_Bid + +r.c_Ask) / 2, pMid = (+r.p_Bid + +r.p_Ask) / 2;
          const cOI = +(r.c_Openinterest || "0").replace(/,/g, ""), pOI = +(r.p_Openinterest || "0").replace(/,/g, "");
          if (cMid > 0 && cOI > 0) { const iv = impliedVol(cMid, S, K, T, true); gex += bsGamma(S, K, T, iv) * cOI; contracts++; }
          if (pMid > 0 && pOI > 0) { const iv = impliedVol(pMid, S, K, T, false); gex -= bsGamma(S, K, T, iv) * pOI; contracts++; }
        }
        if (!contracts) { out.push({ sym, skip: "no priced OI" }); continue; }
        const netGex = +(gex * S * S * 100 * 0.01).toFixed(0);
        rows.push({ symbol: sym, date: today, spot: +S.toFixed(2), net_gex: netGex, sign: netGex >= 0 ? "long-gamma" : "short-gamma", updated_at: new Date().toISOString() });
        out.push({ sym, net_gex: netGex, sign: netGex >= 0 ? "long" : "short", contracts });
      } catch (e) { out.push({ sym, err: String(e).slice(0, 60) }); }
    }
    if (rows.length) await fetch(`${SB}/rest/v1/trd_gex_name?on_conflict=symbol,date`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-gex-name", p_outcome: `${rows.length}/${UNIV.length} names (free Nasdaq chain)` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, source: "nasdaq option-chain (free, keyless) + BS IV", snapshotted: rows.length, results: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
