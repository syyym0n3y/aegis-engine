// trd-forward-tick — autonomous forward PAPER tracker for the D-170/D-171 RSI mean-reversion survivors.
// For each active row in trd_forward it pulls fresh Yahoo bars (edge-runtime-reachable; Binance geo-blocks the
// datacenter), runs the BYTE-IDENTICAL setup code that found the edge (_shared/trd-forward-setup.ts, unit-tested),
// and appends ONLY trades ENTERED strictly after registered_at — a single, un-deflated forward trial. Idempotent
// (unique candidate+entry_ts), append-only evidence, kill-switch-gated, keyless, $0, NO order path exists.
import { type Bar, detectTrades, type SetupParams } from "./trd-forward-setup.ts";
const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

async function yahoo(sym: string, tf: string, range: string): Promise<Bar[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${tf}&range=${range}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return [];
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const t = res.timestamp as number[]; const q = res.indicators.quote[0]; const out: Bar[] = [];
  for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some((x) => x === null || !Number.isFinite(x))) continue; out.push({ ts: new Date(t[i] * 1000).toISOString(), o, h, l, c }); }
  return out;
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

Deno.serve(async () => {
  const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  try {
    // KILL-SWITCH: durable circuit breaker — halts even paper accrual, survives restarts (fail-closed).
    const ks = await fetch(`${SB}/rest/v1/trd_killswitch?id=eq.default&select=active`, { headers: hdr }).then((r) => r.json()).catch(() => []);
    if (ks?.[0]?.active) return new Response(JSON.stringify({ ok: true, skipped: "kill-switch active" }), { headers: cors });

    const cands = await fetch(`${SB}/rest/v1/trd_forward?active=eq.true&select=*`, { headers: hdr }).then((r) => r.json());
    const report: unknown[] = [];
    for (const c of cands as Record<string, unknown>[]) {
      const setup = c.setup as SetupParams;
      const bars = await yahoo(c.symbol as string, c.timeframe as string, (c.yahoo_range as string) ?? "60d");
      if (bars.length < (setup.maLen + 50)) { report.push({ candidate: c.candidate, err: `only ${bars.length} bars` }); continue; }

      // forward floor = strictly after registration AND after the last entry we already recorded
      const stRows = await fetch(`${SB}/rest/v1/trd_forward_state?candidate=eq.${c.candidate}&select=last_entry_ts`, { headers: hdr }).then((r) => r.json()).catch(() => []);
      const lastTs = stRows?.[0]?.last_entry_ts as string | null;
      const floor = lastTs && lastTs > (c.registered_at as string) ? lastTs : (c.registered_at as string);

      const fresh = detectTrades(bars, setup, Number(c.fee_bps_side ?? 5), floor);
      if (fresh.length) {
        const rows = fresh.map((t) => ({ candidate: c.candidate, entry_ts: t.entryTs, exit_ts: t.exitTs, side: t.side, entry: t.entry, stop: t.stop, target: t.target, exit_price: t.exit, gross_r: t.grossR, cost_r: t.costR, net_r: t.netR, outcome: t.outcome }));
        // idempotent append: duplicates on (candidate, entry_ts) are ignored
        await fetch(`${SB}/rest/v1/trd_forward_trade`, { method: "POST", headers: { ...hdr, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) });
      }

      // recompute rollup from the ledger (source of truth), not from this tick's delta
      const all = await fetch(`${SB}/rest/v1/trd_forward_trade?candidate=eq.${c.candidate}&select=net_r,entry_ts&order=entry_ts.asc`, { headers: hdr }).then((r) => r.json());
      const rs = (all as { net_r: number }[]).map((x) => Number(x.net_r));
      const n = rs.length, tot = rs.reduce((a, b) => a + b, 0), m = mean(rs), wins = rs.filter((x) => x > 0).length;
      const lastEntry = n ? (all as { entry_ts: string }[])[n - 1].entry_ts : floor;
      const verdict = n < 30 ? `accumulating (${n}/30 forward trades before a read)` : m > 0 ? `forward-POSITIVE (mean ${m.toFixed(3)}R, ${(wins / n * 100).toFixed(0)}% win) — holds out of sample` : `forward-NEGATIVE (mean ${m.toFixed(3)}R) — the lead does not hold`;
      await fetch(`${SB}/rest/v1/trd_forward_state?on_conflict=candidate`, { method: "POST", headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ candidate: c.candidate, fwd_n: n, fwd_wins: wins, fwd_net_r_total: +tot.toFixed(4), fwd_net_r_mean: +m.toFixed(4), last_entry_ts: lastEntry, verdict, updated_at: new Date().toISOString() }) });
      report.push({ candidate: c.candidate, newThisTick: fresh.length, forwardN: n, forwardMeanR: +m.toFixed(4), forwardTotalR: +tot.toFixed(3), inSample: c.in_sample_evidence, verdict });
    }
    return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString(), candidates: report }, null, 2), { headers: cors });
  } catch (e) { return new Response(JSON.stringify({ ok: false, err: String(e).slice(0, 300) }), { status: 500, headers: cors }); }
});
