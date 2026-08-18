// trd-compute — the COMPUTE-NODE BROKER. The standalone uncapped worker (scripts/aegis-worker.ts) talks ONLY to this
// edge fn, so the worker holds NO secret (safe to run on any box). This does light I/O only; the heavy compute is on the
// worker. Endpoints (no-verify-jwt):
//   GET  ?claim=1&worker=<id>   → atomically claim one pending job (trd_claim_job skip-locked) → job JSON or {job:null}
//   GET  ?bars=<SYMBOL>         → deep daily bars for a symbol from trd_bars_deep (worker's input data)
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
    if (req.method === "GET" && url.searchParams.get("intraday")) {
      const sym = url.searchParams.get("intraday")!, tf = url.searchParams.get("tf") || "1m";
      const b = await fetch(`${SB}/rest/v1/trd_bars_intraday?symbol=eq.${encodeURIComponent(sym)}&tf=eq.${tf}&select=symbol,bars`, { headers: H }).then((r) => r.json()).catch(() => []);
      return new Response(JSON.stringify({ ok: true, row: Array.isArray(b) && b.length ? b[0] : null }), { headers: cors });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { job_id, status, result, error, signals, attribution } = body as { job_id: number; status?: string; result?: unknown; error?: string; signals?: Record<string, unknown>[]; attribution?: Record<string, unknown>[] };
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
