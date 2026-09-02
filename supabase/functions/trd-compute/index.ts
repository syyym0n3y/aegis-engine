// trd-compute — the COMPUTE-NODE BROKER. The standalone uncapped worker (scripts/aegis-worker.ts) talks ONLY to this
// edge fn, so the worker holds NO secret (safe to run on any box). This does light I/O only; the heavy compute is on the
// worker. Endpoints (no-verify-jwt):
//   GET  ?claim=1&worker=<id>   → atomically claim one pending job (trd_claim_job skip-locked) → job JSON or {job:null}
//   GET  ?bars=<SYMBOL>         → deep daily bars for a symbol from trd_bars_deep (worker's input data)
//   GET  ?splits=1              → split ratios (trd_macro_series "split:*") so the worker can restate raw share counts
//   POST {job_id,status,result,error,signals[]} → mark job done/error (+ optionally upsert computed trd_signal rows)
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.get("claim")) {
      const worker = url.searchParams.get("worker") || "anon";
      const j = await fetch(`${SB}/rest/v1/rpc/trd_claim_job`, { method: "POST", headers: H, body: JSON.stringify({ p_worker: worker }) }).then((r) => r.json()).catch(() => []);
      return new Response(JSON.stringify({ ok: true, job: Array.isArray(j) && j.length ? j[0] : null }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("bars")) {
      const sym = url.searchParams.get("bars")!;
      const b = await fetch(`${SB}/rest/v1/trd_bars_deep?symbol=eq.${encodeURIComponent(sym)}&select=symbol,asset_class,bars`, { headers: H }).then((r) => r.json()).catch(() => []);
      return new Response(JSON.stringify({ ok: true, row: Array.isArray(b) && b.length ? b[0] : null }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("insider")) {
      const n = Number(url.searchParams.get("insider")) || 300;
      const rpc = url.searchParams.get("opp") === "1" ? "trd_insider_sample_opp" : "trd_insider_sample";
      const s = await fetch(`${SB}/rest/v1/rpc/${rpc}`, { method: "POST", headers: H, body: JSON.stringify({ p_limit: n }) }).then((r) => r.json()).catch(() => []);
      return new Response(JSON.stringify({ ok: true, sample: Array.isArray(s) ? s : [] }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("universe")) {
      // all accumulated equity symbols — lets a sweep self-pull the full universe instead of a hardcoded list (D-360b)
      const cls = url.searchParams.get("class") || "equity";
      const rows: string[] = [];
      for (let off = 0; ; off += 1000) {
        const p = await fetch(`${SB}/rest/v1/trd_bars_deep?select=symbol&asset_class=eq.${cls}&order=symbol&offset=${off}&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
        if (!Array.isArray(p) || !p.length) break; for (const r of p as { symbol: string }[]) rows.push(r.symbol); if (p.length < 1000) break;
      }
      return new Response(JSON.stringify({ ok: true, symbols: rows }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("barsbatch")) {
      // many symbols' bars in ONE call — collapses a sweep's ~4,400 round-trips into ~200 (D-362b speedup)
      const syms = url.searchParams.get("barsbatch")!.split(",").filter(Boolean);
      const inList = syms.map((s) => `"${s}"`).join(",");
      const b = await fetch(`${SB}/rest/v1/trd_bars_deep?symbol=in.(${encodeURIComponent(inList)})&select=symbol,bars`, { headers: H }).then((r) => r.json()).catch(() => []);
      return new Response(JSON.stringify({ ok: true, rows: Array.isArray(b) ? b : [] }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("ff")) {
      // Fama-French factor returns (D-364) — the 99-year canon for the century-scale deflated gate
      const rows: { month: string; factor: string; ret: number }[] = [];
      for (let off = 0; ; off += 1000) {
        const p = await fetch(`${SB}/rest/v1/trd_ff_factors?select=month,factor,ret&order=month&offset=${off}&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
        if (!Array.isArray(p) || !p.length) break; rows.push(...p as typeof rows); if (p.length < 1000) break;
      }
      return new Response(JSON.stringify({ ok: true, rows }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("allclasses")) {
      // every symbol + its asset_class — for the multi-class × multi-timeframe ladder (D-376)
      const rows: { symbol: string; asset_class: string }[] = [];
      for (let off = 0; ; off += 1000) {
        const p = await fetch(`${SB}/rest/v1/trd_bars_deep?select=symbol,asset_class&order=symbol&offset=${off}&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
        if (!Array.isArray(p) || !p.length) break; rows.push(...p as typeof rows); if (p.length < 1000) break;
      }
      return new Response(JSON.stringify({ ok: true, rows }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("insider_all")) {
      // per-name Form-4 open-market buys (D-373 residual attribution): ticker, disclosed_date, value_usd — point-in-time
      const rows: { t: string; d: string; v: number }[] = [];
      for (let off = 0; ; off += 1000) {
        const p = await fetch(`${SB}/rest/v1/trd_insider?disclosed_date=not.is.null&select=ticker,disclosed_date,value_usd&order=ticker&offset=${off}&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
        if (!Array.isArray(p) || !p.length) break;
        for (const r of p as { ticker: string; disclosed_date: string; value_usd: number }[]) rows.push({ t: r.ticker, d: r.disclosed_date, v: +r.value_usd });
        if (p.length < 1000) break;
      }
      return new Response(JSON.stringify({ ok: true, rows }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("fundamentals")) {
      // serve point-in-time fundamentals to the worker for the cross-sectional value/quality/investment test (D-362)
      const rows: { t: string; c: string; e: string; p: string; v: number }[] = [];
      for (let off = 0; ; off += 1000) {
        const p = await fetch(`${SB}/rest/v1/trd_fundamentals?ticker=not.is.null&select=ticker,concept,effective_date,period_end,value&order=ticker&offset=${off}&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
        if (!Array.isArray(p) || !p.length) break;
        for (const r of p as { ticker: string; concept: string; effective_date: string; period_end: string; value: number }[]) rows.push({ t: r.ticker, c: r.concept, e: r.effective_date, p: r.period_end, v: r.value });
        if (p.length < 1000) break;
      }
      return new Response(JSON.stringify({ ok: true, rows }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("splits")) {
      // D-747: trd_bars_deep closes are SPLIT-ADJUSTED while EntityCommonStockSharesOutstanding is RAW AS FILED, so the
      // worker cannot form a market cap without the split ratios. Served here because the worker holds no secret.
      const rows: { s: string; d: string; v: number }[] = [];
      for (let off = 0; ; off += 10000) {
        const p = await fetch(`${SB}/rest/v1/trd_macro_series?series=like.split:*&select=series,d,v&order=series.asc,d.asc&offset=${off}&limit=10000`, { headers: H }).then((r) => r.json()).catch(() => []);
        if (!Array.isArray(p) || !p.length) break;
        for (const r of p as { series: string; d: string; v: number }[]) rows.push({ s: r.series.slice(6), d: r.d, v: r.v });
        if (p.length < 10000) break;
      }
      return new Response(JSON.stringify({ ok: true, rows }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("worklist")) {
      // hand the worker the next batch of fundamentals tickers still lacking deep daily bars (D-360b price accumulation)
      const n = Number(url.searchParams.get("worklist")) || 200;
      const w = await fetch(`${SB}/rest/v1/rpc/trd_price_worklist`, { method: "POST", headers: H, body: JSON.stringify({ p_n: n }) }).then((r) => r.json()).catch(() => []);
      return new Response(JSON.stringify({ ok: true, tickers: (Array.isArray(w) ? w : []).map((r: { ticker: string }) => r.ticker) }), { headers: cors });
    }
    if (req.method === "GET" && url.searchParams.get("intraday")) {
      const sym = url.searchParams.get("intraday")!, tf = url.searchParams.get("tf") || "1m";
      const b = await fetch(`${SB}/rest/v1/trd_bars_intraday?symbol=eq.${encodeURIComponent(sym)}&tf=eq.${tf}&select=symbol,bars`, { headers: H }).then((r) => r.json()).catch(() => []);
      return new Response(JSON.stringify({ ok: true, row: Array.isArray(b) && b.length ? b[0] : null }), { headers: cors });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { job_id, status, result, error, signals, attribution, bars_upsert } = body as { job_id: number; status?: string; result?: unknown; error?: string; signals?: Record<string, unknown>[]; attribution?: Record<string, unknown>[]; bars_upsert?: { symbol: string; asset_class: string; bars: number[][] }[] };
      // mid-job data flush from the price-accumulation worker → upsert deep daily bars (D-360b). Works with/without job_id.
      if (Array.isArray(bars_upsert) && bars_upsert.length) {
        const rows = bars_upsert.map((b) => ({ symbol: b.symbol, asset_class: b.asset_class || "equity", bars: b.bars, updated_at: new Date().toISOString() }));
        await fetch(`${SB}/rest/v1/trd_bars_deep?on_conflict=symbol`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
        if (!job_id) return new Response(JSON.stringify({ ok: true, upserted: rows.length }), { headers: cors });
      }
      if (job_id) await fetch(`${SB}/rest/v1/trd_compute_jobs?id=eq.${job_id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ status: status || "done", result: result ?? null, error: error ?? null, done_at: new Date().toISOString() }) }).catch(() => {});
      if (Array.isArray(signals) && signals.length) {
        const rows = signals.map((s) => ({ ...s, updated_at: new Date().toISOString() }));
        await fetch(`${SB}/rest/v1/trd_signal?on_conflict=symbol`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }).catch(() => {});
      }
      if (Array.isArray(attribution) && attribution.length) {
        // full rows (have r2) → upsert; partial rows (e.g. intraday-only {symbol, per_tf_intraday}) → PATCH existing row
        const full = attribution.filter((a) => a.r2 != null).map((a) => ({ ...a, updated_at: new Date().toISOString() }));
        const partial = attribution.filter((a) => a.r2 == null);
        if (full.length) await fetch(`${SB}/rest/v1/trd_attribution?on_conflict=symbol`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(full) }).catch(() => {});
        for (const a of partial) { const { symbol, ...rest } = a as Record<string, unknown>; await fetch(`${SB}/rest/v1/trd_attribution?symbol=eq.${encodeURIComponent(String(symbol))}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ ...rest, updated_at: new Date().toISOString() }) }).catch(() => {}); }
      }
      await fetch(`${SB}/rest/v1/rpc/trd_beat`, { method: "POST", headers: H, body: JSON.stringify({ p_fn: "trd-compute", p_outcome: `job ${job_id} ${status || "done"}; ${signals?.length || 0} signals` }) }).catch(() => {});
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }
    // status snapshot
    const jobs = await fetch(`${SB}/rest/v1/trd_compute_jobs?select=status&limit=1000`, { headers: H }).then((r) => r.json()).catch(() => []);
    const by: Record<string, number> = {}; for (const j of (Array.isArray(jobs) ? jobs : []) as { status: string }[]) by[j.status] = (by[j.status] || 0) + 1;
    return new Response(JSON.stringify({ ok: true, jobs_by_status: by }), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
