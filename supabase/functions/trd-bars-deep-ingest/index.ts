// trd-bars-deep-ingest (D-337) — ingests DEEP multi-cycle daily history (keyless Yahoo, period1=0) into trd_bars_deep,
// the foundation for HONEST era-disaggregated testing. Yahoo verified keyless depth: ^GSPC→1970 (56y), ^IXIC→1971,
// AAPL→1980, ^VIX→1990, GC/CL→2000, FX→2003. Idempotent/resumable: each invocation stores up to BATCH symbols not yet
// present (or stale >7d), so a cron drains the universe without ever exceeding the ~2s edge CPU budget. $0.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const BATCH = 6;
// deep-history universe by asset class (Yahoo symbol, our key, class)
const UNIVERSE: [string, string, string][] = [
  ["^GSPC","^GSPC","index"],["^IXIC","^IXIC","index"],["^DJI","^DJI","index"],["^RUT","^RUT","index"],["^NYA","^NYA","index"],
  ["^VIX","^VIX","index"],["^N225","^N225","index"],["^FTSE","^FTSE","index"],["^GDAXI","^GDAXI","index"],
  ["XLK","XLK","sector"],["XLF","XLF","sector"],["XLE","XLE","sector"],["XLV","XLV","sector"],["XLY","XLY","sector"],
  ["XLI","XLI","sector"],["XLP","XLP","sector"],["XLU","XLU","sector"],["XLB","XLB","sector"],
  ["AAPL","AAPL","equity"],["MSFT","MSFT","equity"],["IBM","IBM","equity"],["GE","GE","equity"],["KO","KO","equity"],
  ["JPM","JPM","equity"],["XOM","XOM","equity"],["CVX","CVX","equity"],["JNJ","JNJ","equity"],["PG","PG","equity"],
  ["WMT","WMT","equity"],["MCD","MCD","equity"],["DIS","DIS","equity"],["INTC","INTC","equity"],["CSCO","CSCO","equity"],
  ["ORCL","ORCL","equity"],["T","T","equity"],["VZ","VZ","equity"],["MMM","MMM","equity"],["CAT","CAT","equity"],
  ["BA","BA","equity"],["HD","HD","equity"],["AMGN","AMGN","equity"],["NKE","NKE","equity"],["AXP","AXP","equity"],
  ["GC=F","GC=F","commodity"],["CL=F","CL=F","commodity"],["SI=F","SI=F","commodity"],["HG=F","HG=F","commodity"],["NG=F","NG=F","commodity"],
  ["EURUSD=X","EURUSD=X","fx"],["JPY=X","JPY=X","fx"],["GBPUSD=X","GBPUSD=X","fx"],
  ["AUDUSD=X","AUDUSD=X","fx"],["CAD=X","CAD=X","fx"],["CHF=X","CHF=X","fx"],["NZDUSD=X","NZDUSD=X","fx"],["MXN=X","MXN=X","fx"],
  ["^TNX","^TNX","rate"],["^TYX","^TYX","rate"],["^IRX","^IRX","rate"],
  ["SPY","SPY","etf"],["QQQ","QQQ","etf"],["IWM","IWM","etf"],["DIA","DIA","etf"],["GLD","GLD","etf"],["TLT","TLT","etf"],
  ["BTC-USD","BTC-USD","crypto"],["ETH-USD","ETH-USD","crypto"],["SOL-USD","SOL-USD","crypto"],["BNB-USD","BNB-USD","crypto"],["XRP-USD","XRP-USD","crypto"],["ADA-USD","ADA-USD","crypto"],["DOGE-USD","DOGE-USD","crypto"],["AVAX-USD","AVAX-USD","crypto"],["LINK-USD","LINK-USD","crypto"],["DOT-USD","DOT-USD","crypto"],["LTC-USD","LTC-USD","crypto"],["MATIC-USD","MATIC-USD","crypto"],
];

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const url = new URL(req.url); const force = url.searchParams.get("force") === "1";
    const only = url.searchParams.get("syms"); // optional CSV to target specific keys
    const have = await fetch(`${SB}/rest/v1/trd_bars_deep?select=symbol,updated_at`, { headers: H }).then((r) => r.json()).catch(() => []);
    const freshCut = Date.now() - 7 * 864e5;
    const haveFresh = new Set((Array.isArray(have) ? have : []).filter((r: { updated_at: string }) => !force && new Date(r.updated_at).getTime() > freshCut).map((r: { symbol: string }) => r.symbol));
    let pool = UNIVERSE.filter(([, key]) => !haveFresh.has(key));
    if (only) { const want = new Set(only.split(",")); pool = pool.filter(([, key]) => want.has(key)); }
    const todo = pool.slice(0, BATCH);
    const P2 = Math.floor(Date.now() / 1000); const out: Record<string, unknown>[] = [];
    for (const [ysym, key, klass] of todo) {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=1d&period1=0&period2=${P2}`, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) { out.push({ key, err: `http ${r.status}` }); continue; }
        const j = await r.json(); const res = j?.chart?.result?.[0]; const ts = res?.timestamp; const q = res?.indicators?.quote?.[0];
        if (!ts || !q) { out.push({ key, err: "no data" }); continue; }
        const bars: number[][] = [];
        for (let i = 0; i < ts.length; i++) {
          const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
          if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue;
          bars.push([ts[i], +(+o).toFixed(4), +(+h).toFixed(4), +(+l).toFixed(4), +(+c).toFixed(4), v == null ? 0 : Math.round(v)]);
        }
        if (bars.length < 100) { out.push({ key, err: `thin ${bars.length}` }); continue; }
        const fd = new Date(bars[0][0] * 1000).toISOString().slice(0, 10), ld = new Date(bars[bars.length - 1][0] * 1000).toISOString().slice(0, 10);
        await fetch(`${SB}/rest/v1/trd_bars_deep?on_conflict=symbol`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ symbol: key, asset_class: klass, first_date: fd, last_date: ld, n_bars: bars.length, bars, updated_at: new Date().toISOString() }) }).catch(() => {});
        out.push({ key, first: fd, last: ld, n: bars.length });
      } catch (e) { out.push({ key, err: String(e).slice(0, 60) }); }
    }
    const remaining = pool.length - todo.length;
    await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-bars-deep-ingest", p_outcome: `stored ${out.filter((o) => o.n).length}; ${remaining} remaining` }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, processed: out.length, remaining, results: out }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
