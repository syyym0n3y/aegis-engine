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
    const rows = await fetch(`${SB}/rest/v1/trd_insider?select=ticker,disclosed_date&order=ticker`, { headers: H }).then((r) => r.json()).catch(() => []);
    const byT = new Map<string, string[]>();
    for (const r of (Array.isArray(rows) ? rows : []) as { ticker: string; disclosed_date: string }[]) (byT.get(r.ticker) ?? byT.set(r.ticker, []).get(r.ticker)!).push(r.disclosed_date);
    const fwd: number[] = []; let nT = 0, posT = 0;
    for (const [tkr, dates] of byT) {
      const p2 = Math.floor(Date.now() / 1000);
      const j = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tkr)}?interval=1d&period1=${p2 - 800 * 86400}&period2=${p2}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
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
