// trd-insider-ic (D-349) — event study: after an opportunistic open-market insider BUY (disclosed_date = legally-knowable),
// does the stock outperform over the next 21 trading days? Mean forward return + t-stat + %positive + breadth, deflated.
// Forward returns from KEYLESS Yahoo. Reads meaningfully once the backfill cron has accumulated (hours). Hypothesis +.
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
const HORIZON = 21;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // D-467: this fetch was limit=250000 with NO order against a table holding 278,456 rows — 28,456 rows (10%) were
    // silently dropped, and WHICH rows depended on physical layout. The insider-IC verdict computed here therefore ran on
    // an arbitrary 90% sample. Fixed to paginate the FULL table in a deterministic order; the verdict should be re-run
    // when the rented org is restored.
    const rows: { ticker: string; disclosed_date: string; value_usd: number }[] = [];
    for (let off = 0; ; off += 50000) {
      const page = await fetch(`${SB}/rest/v1/trd_insider?select=ticker,disclosed_date,value_usd&disclosed_date=gte.2005-01-01&order=disclosed_date,accession&offset=${off}&limit=50000`, { headers: H }).then((r) => r.json()).catch(() => []);
      if (!Array.isArray(page) || !page.length) break;
      rows.push(...page); if (page.length < 50000) break;
    }
    const byTall = new Map<string, string[]>(); const tval = new Map<string, number>();
    for (const r of (Array.isArray(rows) ? rows : []) as { ticker: string; disclosed_date: string; value_usd: number }[]) { if (!r.disclosed_date || r.disclosed_date < "2005-01-01" || r.disclosed_date > "2027-01-01" || !/^[A-Z]{1,5}$/.test(r.ticker) || r.ticker === "NONE") continue; (byTall.get(r.ticker) ?? byTall.set(r.ticker, []).get(r.ticker)!).push(r.disclosed_date); tval.set(r.ticker, (tval.get(r.ticker) || 0) + (r.value_usd || 0)); }
    // sample highest-DOLLAR-conviction tickers with buys spanning the decades (big buys = larger, Yahoo-covered companies).
    const span = (ds: string[]) => (Math.max(...ds.map((x) => +new Date(x))) - Math.min(...ds.map((x) => +new Date(x)))) / 864e5;
    const cand = [...byTall.entries()].filter(([, ds]) => ds.length >= 2 && span(ds) > 300);
    const byT = new Map(cand.sort((a, b) => (tval.get(b[0]) || 0) - (tval.get(a[0]) || 0)).slice(0, 90));
    const fwd: number[] = []; let nT = 0, posT = 0;
    for (const [tkr, dates] of byT) {
      await new Promise((r) => setTimeout(r, 350)); // pace to avoid Yahoo IP rate-limiting
      const p2 = Math.floor(Date.now() / 1000);
      const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tkr)}?interval=1d&period1=0&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
      const res = j?.chart?.result?.[0]; if (!res?.timestamp) continue;
      const c = res.indicators.quote[0].close as number[]; const ds = res.timestamp.map((t: number) => new Date(t * 1000).toISOString().slice(0, 10));
      const idxOf = new Map<string, number>(); ds.forEach((d: string, i: number) => idxOf.set(d, i));
      const tf: number[] = [];
      for (const d of dates) {
        const gi = idxOf.get(d);
        const i = gi != null ? gi : ds.findIndex((x: string) => x >= d);
        if (i < 0 || i + HORIZON >= c.length || c[i] == null || c[i + HORIZON] == null) continue;
        tf.push(c[i + HORIZON] / c[i] - 1);
      }
      if (tf.length) { nT++; if (mean(tf) > 0) posT++; fwd.push(...tf); }
    }
    const n = fwd.length, m = n ? mean(fwd) : 0;
    const sd = n > 1 ? Math.sqrt(fwd.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
    const t = n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : 0;
    const winPct = n ? 100 * fwd.filter((x) => x > 0).length / n : 0;
    await fetch(`${SB}/rest/v1/rpc/trd_bump_trials`, { method: "POST", headers: H, body: JSON.stringify({ n: 1 }) }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, horizon_days: HORIZON, n_events: n, n_tickers: nT, mean_fwd_ret: +(100 * m).toFixed(3) + "%", t_stat: +t.toFixed(2), win_pct: +winPct.toFixed(0), breadth_ticker_positive: `${posT}/${nT}`, note: n < 100 ? "underpowered — backfill still accumulating" : "" }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
